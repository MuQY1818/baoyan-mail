import { acquireAppStateLock, getAppState, releaseAppStateLock, setAppState } from "./db";
import type { Env } from "./types";

export const SYNC_LOCK_KEY = "external_source_sync_active_run";
export const SYNC_LEASE_MS = 30 * 60_000;

export interface PipelineRun {
  run_id: string;
  kind: string;
  status: string;
  metadata: string;
  result: string | null;
  error: string | null;
  workflow_run_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function getPipelineRun(env: Env, runId: string): Promise<PipelineRun | null> {
  return env.DB.prepare("SELECT * FROM pipeline_runs WHERE run_id = ?").bind(runId).first<PipelineRun>();
}

export async function getSnapshotVersion(env: Env): Promise<string> {
  return (await getAppState(env, "snapshot_version")) ?? (await getAppState(env, "last_synced_at")) ?? "unpublished";
}

export function publicationGuard(env: Env, version: string): D1PreparedStatement {
  return env.DB.prepare(`INSERT OR REPLACE INTO pipeline_assertions (id, valid)
    SELECT 'classification-version', CASE WHEN COALESCE(
      (SELECT value FROM app_state WHERE key = 'snapshot_version'),
      (SELECT value FROM app_state WHERE key = 'last_synced_at'), 'unpublished') = ? THEN 1 ELSE 0 END`).bind(version);
}

export function classificationRunGuard(env: Env, runId: string, version: string, model: string): D1PreparedStatement {
  return env.DB.prepare(`INSERT OR REPLACE INTO pipeline_assertions (id, valid)
    SELECT 'classification-run', CASE WHEN NOT EXISTS (SELECT 1 FROM pipeline_runs WHERE run_id = ?
      AND (kind <> 'classification' OR json_extract(metadata, '$.model') IS NOT ?
        OR json_extract(metadata, '$.snapshotVersion') IS NOT ?)) THEN 1 ELSE 0 END`)
    .bind(runId, model, version);
}

export async function claimSync(env: Env, runId: string, now = new Date(), allowResume = true): Promise<boolean> {
  const existing = await getPipelineRun(env, runId);
  if (existing !== null && (existing.kind !== "sync" || existing.status !== "running")) return false;
  const raw = JSON.stringify({ runId, phase: "collecting" });
  const acquired = await acquireAppStateLock(env, SYNC_LOCK_KEY, raw, now.toISOString(),
    new Date(now.getTime() - SYNC_LEASE_MS).toISOString());
  if (!acquired) {
    if (!allowResume) return false;
    const active = await getAppState(env, SYNC_LOCK_KEY);
    if (active === null || JSON.parse(active || "{}").runId !== runId) return false;
  }
  await env.DB.prepare(`UPDATE pipeline_runs SET status = 'failed', error = 'sync_lease_expired', updated_at = ?
    WHERE kind = 'sync' AND status = 'running' AND run_id <> ? AND updated_at < ?`)
    .bind(now.toISOString(), runId, new Date(now.getTime() - SYNC_LEASE_MS).toISOString()).run();
  await env.DB.prepare(`INSERT INTO pipeline_runs (run_id, kind, status, metadata, created_at, updated_at)
    VALUES (?, 'sync', 'running', ?, ?, ?) ON CONFLICT(run_id) DO NOTHING`)
    .bind(runId, raw, now.toISOString(), now.toISOString()).run();
  return true;
}

export function isWatchdogWindow(now: Date): boolean {
  return (now.getUTCHours() + 8) % 24 >= 8;
}

export async function requestSourceSync(env: Env, reason: "watchdog" | "manual", now = new Date()): Promise<Record<string, unknown>> {
  if (env.SOURCE_WATCHDOG_ENABLED !== "true") return { ok: true, skipped: "disabled" };
  if (reason === "watchdog" && !isWatchdogWindow(now)) return { ok: true, skipped: "outside_window" };
  const last = await getAppState(env, "last_synced_at");
  if (reason === "watchdog" && last !== null && now.getTime() - Date.parse(last) <= 90 * 60_000) {
    return { ok: true, skipped: "fresh" };
  }
  const lastAttempt = await getAppState(env, "last_sync_dispatch_at");
  if (lastAttempt !== null && now.getTime() - Date.parse(lastAttempt) < SYNC_LEASE_MS) {
    return { ok: true, skipped: "cooldown" };
  }
  const runId = now.toISOString();
  if (!await claimSync(env, runId, now, false)) return { ok: true, skipped: "run_active" };
  const currentAttempt = await getAppState(env, "last_sync_dispatch_at");
  if (currentAttempt !== null && now.getTime() - Date.parse(currentAttempt) < SYNC_LEASE_MS) {
    await finishDispatch(env, runId, "skipped", "cooldown");
    return { ok: true, skipped: "cooldown", runId };
  }
  await setAppState(env, "last_sync_dispatch_at", runId, runId);
  let dispatchPending = false;
  try {
    if (!env.GITHUB_ACTIONS_TOKEN || !env.GITHUB_REPOSITORY || !/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY)) {
      throw new Error("github_actions_not_configured");
    }
    const workflow = env.GITHUB_SYNC_WORKFLOW ?? "sync-sources.yml";
    const base = `https://api.github.com/repos/${env.GITHUB_REPOSITORY}/actions/workflows/${encodeURIComponent(workflow)}`;
    const headers = { Authorization: `Bearer ${env.GITHUB_ACTIONS_TOKEN}`, Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "baoyan-mail", "Content-Type": "application/json" };
    // queued/in_progress/waiting 等非终态都不重复触发，查询失败也不盲目 dispatch。
    for (const status of ["queued", "in_progress", "waiting", "requested", "pending"]) {
      const response = await fetch(`${base}/runs?status=${status}&per_page=1`, { headers, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`github_runs_http_${response.status}`);
      const body = await response.json() as { total_count?: number };
      if (!Number.isInteger(body.total_count) || Number(body.total_count) < 0) throw new Error("github_runs_invalid_response");
      if ((body.total_count ?? 0) > 0) {
        await finishDispatch(env, runId, "skipped", "github_run_active");
        return { ok: true, skipped: "github_run_active", runId };
      }
    }
    dispatchPending = true;
    const response = await fetch(`${base}/dispatches`, {
      method: "POST", headers, signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ ref: env.GITHUB_SYNC_REF ?? "main", inputs: { sync_run_id: runId } })
    });
    dispatchPending = response.status >= 500;
    if (response.status !== 204) throw new Error(`github_dispatch_http_${response.status}`);
    await env.DB.prepare("UPDATE pipeline_runs SET metadata = ?, updated_at = ? WHERE run_id = ?")
      .bind(JSON.stringify({ runId, phase: "dispatched", reason }), runId, runId).run();
    return { ok: true, runId, status: "dispatched" };
  } catch (error) {
    // 网络响应丢失也保留冷却记录，下一轮先检查 GitHub 在途任务。
    const message = error instanceof Error ? error.message : "dispatch_failed";
    if (dispatchPending) {
      await env.DB.prepare("UPDATE pipeline_runs SET metadata = ?, error = ?, updated_at = ? WHERE run_id = ? AND status = 'running'")
        .bind(JSON.stringify({ runId, phase: "dispatch-uncertain", reason }), `github_dispatch_outcome_unknown: ${message}`, runId, runId).run();
      return { ok: false, runId, error: "github_dispatch_outcome_unknown" };
    }
    await finishDispatch(env, runId, "failed", message);
    return { ok: false, runId, error: message };
  }
}

async function finishDispatch(env: Env, runId: string, status: string, error: string): Promise<void> {
  await env.DB.prepare("UPDATE pipeline_runs SET status = ?, error = ?, updated_at = ? WHERE run_id = ?")
    .bind(status, error, new Date().toISOString(), runId).run();
  await releaseAppStateLock(env, SYNC_LOCK_KEY, JSON.stringify({ runId, phase: "collecting" }), new Date().toISOString());
}
