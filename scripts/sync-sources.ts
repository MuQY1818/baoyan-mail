import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  canonicalizeNotificationUrl,
  fetchSourceItemsWithStats
} from "../src/source";
import type { ActivityType, Env, NormalizedItem, SourceStats } from "../src/types";

const DEFAULT_BASE_URL = "https://baoyan-mail.weijuebu.workers.dev";
const UPLOAD_BATCH_SIZE = 20;
const UPLOAD_CONCURRENCY = 4;
const REQUEST_TIMEOUT_MS = 120_000;
const SHANGHAI_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

interface DdlIndexItem {
  key: string;
  school: string;
  institute: string;
  deadlineAt: string;
  website: string;
  alternateWebsites?: string[];
  active?: boolean;
  lastSeenAt?: string;
}

interface SnapshotIndexResponse {
  ok: boolean;
  items?: DdlIndexItem[];
  nextCursor?: string | null;
}

interface SourceHealthResponse {
  ok: boolean;
  sourceStats?: SourceStats[];
}

interface SyncOptions {
  baseUrl: string;
  authHelper: string | null;
  token: string | null;
}

async function main(): Promise<void> {
  const options = readOptions(process.argv.slice(2));
  const runId = new Date().toISOString();
  const sourceResult = await fetchSourceItemsWithStats({
    BAOYANXINXI_SOURCE_URL: process.env.BAOYANXINXI_SOURCE_URL,
    BAOYANXINXI_PRE_RECOMMENDATION_SOURCE_URL:
      process.env.BAOYANXINXI_PRE_RECOMMENDATION_SOURCE_URL,
    XINGKE_SOURCE_URL: process.env.XINGKE_SOURCE_URL,
    ZSCAMPUS_SOURCE_URL: process.env.ZSCAMPUS_SOURCE_URL,
    SOURCE_YEAR: process.env.SOURCE_YEAR
  } as Env);
  assertHealthySources(sourceResult.stats);
  const previousHealth = (await sendAdminRequest(
    options,
    "source-health"
  )) as unknown as SourceHealthResponse;
  assertNoUnexpectedSourceDrop(sourceResult.stats, previousHealth.sourceStats ?? []);

  const activityTypeCounts = countActivityTypes(sourceResult.items);
  let started = false;
  let finalized = false;
  try {
    await sendAdminRequest(options, "source-sync-start", {
      runId,
      expectedCount: sourceResult.items.length,
      reviewCandidateCount: sourceResult.reviewCandidates.length,
      sourceStats: sourceResult.stats,
      activityTypeCounts
    });
    started = true;

    const archiveItems = await fetchSnapshotIndex(options, runId);
    const items = reuseExistingKeys(sourceResult.items, archiveItems);
    assertNoUnexpectedMergedDrop(items.length, archiveItems);
    assertUniqueKeys(items);
    await processWithConcurrency(
      chunks(items, UPLOAD_BATCH_SIZE),
      UPLOAD_CONCURRENCY,
      (batch) => sendAdminRequest(options, "source-sync-items", { runId, items: batch })
    );
    await processWithConcurrency(
      chunks(sourceResult.reviewCandidates, UPLOAD_BATCH_SIZE),
      UPLOAD_CONCURRENCY,
      (batch) =>
        sendAdminRequest(options, "source-sync-review-candidates", {
          runId,
          items: batch
        })
    );
    const finalResponse = await sendAdminRequest(options, "source-sync-finalize", { runId });
    finalized = true;
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          runId,
          scanned: items.length,
          historyKeys: archiveItems.length,
          reviewCandidates: sourceResult.reviewCandidates.length,
          sourceStats: sourceResult.stats,
          activityTypeCounts,
          result: finalResponse.result ?? null
        },
        null,
        2
      )}\n`
    );
  } finally {
    if (started && !finalized) {
      try {
        await sendAdminRequest(options, "source-sync-abort", { runId });
      } catch {
        // The lock also expires automatically; keep the original sync error.
      }
    }
  }
}

function readOptions(args: string[]): SyncOptions {
  const baseUrl = (readArgument(args, "--base-url") ?? process.env.BAOYAN_SYNC_BASE_URL ?? DEFAULT_BASE_URL)
    .trim()
    .replace(/\/+$/u, "");
  const authHelper = readArgument(args, "--auth-helper")?.trim() || null;
  const token = process.env.BAOYAN_ADMIN_TOKEN?.trim() || null;
  if (!/^https:\/\//u.test(baseUrl) && !/^http:\/\/127\.0\.0\.1(?::\d+)?$/u.test(baseUrl)) {
    throw new Error("同步地址必须使用 HTTPS，或指向本机 127.0.0.1");
  }
  if (authHelper === null && token === null) {
    throw new Error("缺少 BAOYAN_ADMIN_TOKEN 或 --auth-helper");
  }
  return { baseUrl, authHelper, token };
}

function readArgument(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1] ?? null;
}

function assertHealthySources(stats: SourceStats[]): void {
  if (stats.length < 3) {
    throw new Error(`配置的数据源不足：${stats.length}`);
  }
  const unhealthy = stats.filter(
    (entry) => entry.error !== undefined || entry.rawCount <= 0 || entry.acceptedCount <= 0
  );
  if (unhealthy.length > 0) {
    throw new Error(
      `数据源异常，未开始上传：${unhealthy
        .map((entry) => `${entry.sourceGroup}:${entry.error ?? "empty"}`)
        .join("；")}`
    );
  }
}

function assertNoUnexpectedSourceDrop(
  currentStats: SourceStats[],
  previousStats: SourceStats[]
): void {
  const previousByGroup = new Map(
    previousStats.map((entry) => [entry.sourceGroup, entry])
  );
  const suspicious = currentStats.flatMap((current) => {
    const previous = previousByGroup.get(current.sourceGroup);
    if (previous === undefined || previous.error !== undefined) {
      return [];
    }
    const reasons: string[] = [];
    if (previous.rawCount >= 10 && current.rawCount < previous.rawCount * 0.65) {
      reasons.push(`raw ${previous.rawCount}->${current.rawCount}`);
    }
    if (
      previous.acceptedCount >= 10 &&
      current.acceptedCount < previous.acceptedCount * 0.7
    ) {
      reasons.push(`accepted ${previous.acceptedCount}->${current.acceptedCount}`);
    }
    return reasons.length === 0
      ? []
      : [`${current.sourceGroup}(${reasons.join(", ")})`];
  });
  if (suspicious.length > 0) {
    throw new Error(`数据源数量异常骤降，已停止同步：${suspicious.join("；")}`);
  }
}

export function assertNoUnexpectedMergedDrop(
  currentCount: number,
  archiveItems: DdlIndexItem[]
): void {
  const previousActiveCount = archiveItems.filter((item) => item.active === true).length;
  if (previousActiveCount >= 100 && currentCount < previousActiveCount * 0.65) {
    throw new Error(
      `合并后条目数量异常骤降，已停止同步：${previousActiveCount}->${currentCount}`
    );
  }
}

async function fetchSnapshotIndex(
  options: SyncOptions,
  runId: string
): Promise<DdlIndexItem[]> {
  const items: DdlIndexItem[] = [];
  const seenCursors = new Set<string>();
  let cursor = "";
  while (true) {
    if (seenCursors.has(cursor)) {
      throw new Error("历史快照索引游标重复，已停止同步");
    }
    seenCursors.add(cursor);
    const response = (await sendAdminRequest(options, "source-sync-index", {
      runId,
      cursor,
      limit: 100
    })) as unknown as SnapshotIndexResponse;
    if (!Array.isArray(response.items)) {
      throw new Error("历史快照索引不可用，已停止同步以保护现有 key");
    }
    items.push(...response.items);
    if (items.length > 100_000) {
      throw new Error("历史快照索引超过安全上限");
    }
    if (typeof response.nextCursor !== "string" || response.nextCursor === "") {
      return items;
    }
    cursor = response.nextCursor;
  }
}

export function reuseExistingKeys(
  items: NormalizedItem[],
  archiveItems: DdlIndexItem[]
): NormalizedItem[] {
  const archiveByIdentity = new Map<string, DdlIndexItem[]>();
  const archiveByStableIdentity = new Map<string, DdlIndexItem[]>();
  const reservedKeys = new Set<string>();
  for (const item of archiveItems) {
    reservedKeys.add(item.key);
    for (const website of [item.website, ...(item.alternateWebsites ?? [])]) {
      addIdentityMatch(
        archiveByIdentity,
        buildIdentity(website, item.school, item.institute, item.deadlineAt),
        item
      );
      addIdentityMatch(
        archiveByStableIdentity,
        buildStableIdentity(website, item.school, item.institute),
        item
      );
    }
  }

  const assignedKeys = new Set<string>();
  return items.map((item) => {
    const websites = [item.website, ...(item.alternateWebsites ?? [])];
    const exactMatch = choosePreferredHistoryItem(
      websites.flatMap((website) => {
        const identity = buildIdentity(website, item.name, item.institute, item.deadline);
        return archiveByIdentity.get(identity) ?? [];
      }),
      assignedKeys,
      true
    );
    const stableCandidates = dedupeIndexItems(
      websites.flatMap(
        (website) =>
          archiveByStableIdentity.get(
            buildStableIdentity(website, item.name, item.institute)
          ) ?? []
      )
    );
    const matched =
      exactMatch ??
      choosePreferredHistoryItem(stableCandidates, assignedKeys, false);
    const key =
      matched?.key ?? allocateExternalKey(item.key, reservedKeys, assignedKeys);
    assignedKeys.add(key);
    reservedKeys.add(key);
    return key === item.key ? item : { ...item, key };
  });
}

function addIdentityMatch(
  index: Map<string, DdlIndexItem[]>,
  identity: string,
  item: DdlIndexItem
): void {
  const matches = index.get(identity) ?? [];
  if (!matches.some((candidate) => candidate.key === item.key)) {
    matches.push(item);
    index.set(identity, matches);
  }
}

function dedupeIndexItems(items: DdlIndexItem[]): DdlIndexItem[] {
  return Array.from(new Map(items.map((item) => [item.key, item])).values());
}

function choosePreferredHistoryItem(
  items: DdlIndexItem[],
  assignedKeys: Set<string>,
  allowMultipleInactive: boolean
): DdlIndexItem | undefined {
  const candidates = dedupeIndexItems(items).filter(
    (candidate) => !assignedKeys.has(candidate.key)
  );
  const active = candidates.filter((candidate) => candidate.active === true);
  if (active.length === 1) {
    return active[0];
  }
  if (active.length > 1) {
    return [...active].sort(compareHistoryItems)[0];
  }
  if (candidates.length === 1) {
    return candidates[0];
  }
  return allowMultipleInactive
    ? [...candidates].sort(compareHistoryItems)[0]
    : undefined;
}

function compareHistoryItems(left: DdlIndexItem, right: DdlIndexItem): number {
  const lastSeenCompare = (right.lastSeenAt ?? "").localeCompare(left.lastSeenAt ?? "");
  return lastSeenCompare !== 0 ? lastSeenCompare : left.key.localeCompare(right.key);
}

function buildIdentity(
  website: string,
  school: string,
  institute: string,
  deadline: string
): string {
  const deadlineDate = new Date(deadline);
  const day = Number.isNaN(deadlineDate.getTime())
    ? deadline.trim()
    : SHANGHAI_DATE_FORMATTER.format(deadlineDate);
  return [
    canonicalizeNotificationUrl(website),
    normalizeIdentityText(school),
    normalizeIdentityText(institute),
    day
  ].join("\u0000");
}

function normalizeIdentityText(value: string): string {
  return value.replace(/\s+/gu, "").replace(/[（(].*?[）)]/gu, "").toLowerCase();
}

function buildStableIdentity(
  website: string,
  school: string,
  institute: string
): string {
  return [
    canonicalizeNotificationUrl(website),
    normalizeIdentityText(school),
    normalizeIdentityText(institute)
  ].join("\u0000");
}

function allocateExternalKey(
  baseKey: string,
  reservedKeys: Set<string>,
  assignedKeys: Set<string>
): string {
  if (!reservedKeys.has(baseKey) && !assignedKeys.has(baseKey)) {
    return baseKey;
  }
  let suffix = 2;
  while (
    reservedKeys.has(`${baseKey}-external-${suffix}`) ||
    assignedKeys.has(`${baseKey}-external-${suffix}`)
  ) {
    suffix += 1;
  }
  return `${baseKey}-external-${suffix}`;
}

function assertUniqueKeys(items: NormalizedItem[]): void {
  const keys = new Set(items.map((item) => item.key));
  if (keys.size !== items.length) {
    throw new Error(`本地合并结果存在重复 key：${items.length - keys.size}`);
  }
}

function countActivityTypes(items: NormalizedItem[]): Record<ActivityType, number> {
  const counts: Record<ActivityType, number> = {
    summer_camp: 0,
    pre_recommendation: 0,
    unknown: 0
  };
  for (const item of items) {
    counts[item.activityType ?? "unknown"] += 1;
  }
  return counts;
}

async function sendAdminRequest(
  options: SyncOptions,
  action: string,
  payload?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (options.authHelper !== null) {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await sendThroughAuthHelper(options.authHelper, action, payload);
      } catch (error) {
        lastError = error;
        if (attempt < 3) {
          await delay(attempt * 1_000);
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
  const routeByAction: Record<string, { method: "GET" | "POST"; path: string }> = {
    "source-health": { method: "GET", path: "/api/admin/source-health" },
    "source-sync-start": { method: "POST", path: "/api/admin/source-sync/start" },
    "source-sync-index": { method: "POST", path: "/api/admin/source-sync/index" },
    "source-sync-items": { method: "POST", path: "/api/admin/source-sync/items" },
    "source-sync-review-candidates": {
      method: "POST",
      path: "/api/admin/source-sync/review-candidates"
    },
    "source-sync-finalize": { method: "POST", path: "/api/admin/source-sync/finalize" },
    "source-sync-abort": { method: "POST", path: "/api/admin/source-sync/abort" }
  };
  const route = routeByAction[action];
  if (route === undefined || options.token === null) {
    throw new Error(`不支持的同步操作：${action}`);
  }
  return adminRequestWithRetry(
    `${options.baseUrl}${route.path}`,
    route.method,
    payload,
    options.token
  );
}

function sendThroughAuthHelper(
  helperPath: string,
  action: string,
  payload?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [helperPath, action], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const output = Buffer.concat(stdout).toString("utf8").trim();
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString("utf8").trim();
        reject(new Error(detail || `认证助手操作失败：${action}`));
        return;
      }
      try {
        const parsed = JSON.parse(output) as Record<string, unknown>;
        if (parsed.ok !== true) {
          reject(new Error(`认证助手返回失败：${action}`));
          return;
        }
        resolve(parsed);
      } catch {
        reject(new Error(`认证助手返回了无效 JSON：${action}`));
      }
    });
    child.stdin.end(payload === undefined ? undefined : JSON.stringify(payload));
  });
}

async function adminRequestWithRetry(
  url: string,
  method: "GET" | "POST",
  payload: Record<string, unknown> | undefined,
  token: string
): Promise<Record<string, unknown>> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const requestInit: RequestInit = {
        method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          ...(payload === undefined ? {} : { "Content-Type": "application/json" })
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      };
      if (payload !== undefined) {
        requestInit.body = JSON.stringify(payload);
      }
      const response = await fetch(url, requestInit);
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
      }
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (parsed.ok !== true) {
        throw new Error(`接口返回失败：${text.slice(0, 500)}`);
      }
      return parsed;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await delay(attempt * 1_000);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function processWithConcurrency<T>(
  items: T[],
  concurrency: number,
  operation: (item: T) => Promise<unknown>
): Promise<void> {
  for (let index = 0; index < items.length; index += concurrency) {
    await Promise.all(items.slice(index, index + concurrency).map(operation));
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
