import { afterEach, describe, expect, it, vi } from "vitest";
import { SqliteD1 } from "./sqliteD1";
import { handleRequest } from "../src/routes";
import { claimSync, isWatchdogWindow, requestSourceSync } from "../src/pipeline";
import { getWriteBudget, reserveWriteBudget, setAppState } from "../src/db";
import { buildDdlResponse } from "../src/ddl";
import { normalizeZscampusData, validateZscampusPages } from "../src/source";
import { adminRequestWithRetry } from "../scripts/sync-sources";
import type { Env, NormalizedItem } from "../src/types";

const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;
const databases: SqliteD1[] = [];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); databases.splice(0).forEach((db) => db.sqlite.close()); });
function fixture() {
  const db = new SqliteD1(); databases.push(db);
  const env = { DB: db as unknown as D1Database, ADMIN_TOKEN: "test-secret" } as Env;
  const post = async (path: string, body: unknown) => handleRequest(new Request(`https://example.test/api/admin/${path}`, {
    method: "POST", headers: { authorization: "Bearer test-secret" }, body: JSON.stringify(body)
  }), env, ctx);
  return { db, env, post };
}
function item(key = "item"): NormalizedItem {
  return { key, contentHash: "a".repeat(64), name: "测试大学", institute: "计算机学院", description: "2027年预推免报名",
    sourceGroup: "xingkebaoyan", sourceGroups: ["xingkebaoyan"], website: `https://example.test/notice/${key}.html`,
    deadline: "2099-09-10T09:00:00.000Z", deadlinePrecision: "exact", tags: [], activityType: "pre_recommendation", sourceObservations: [], alternateWebsites: [] };
}
function seed(db: SqliteD1, value = item()) {
  db.itemSnapshots.set(value.key, { item_key: value.key, content_hash: value.contentHash, payload: JSON.stringify(value),
    source_group: value.sourceGroup, first_seen_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(), missing_since: null });
}
function metadata(runId: string, reviewCandidateCount = 0, expectedCount = 1) {
  return { runId, expectedCount, reviewCandidateCount, activityTypeCounts: { pre_recommendation: expectedCount, summer_camp: 0, unknown: 0 },
    sourceStats: ["baoyanxinxi2026jsjby", "xingkebaoyan", "zscampus"].map((sourceGroup) => ({ sourceGroup,
      url: `https://example.test/${sourceGroup}`, rawCount: 1, acceptedCount: 1, filteredCount: 0, duplicateCount: 0, supplementedDeadlineCount: 0 })) };
}
function classification(overrides = {}) {
  return { snapshotVersion: "unpublished", submissionId: "classify-1", runId: "ai-1", model: "gpt-5.6-luna",
    targets: [{ key: "item", contentHash: "a".repeat(64) }],
    items: [{ website: item().website, activityType: "pre_recommendation", reason: "官方通知明确预推免", classifier: "gpt-5.6-luna" }], ...overrides };
}

describe("采集完整性", () => {
  it("保研岛无截止项目保持可发现且统计未知数量", () => {
    const result = normalizeZscampusData([{ summerid: "unknown", universityname: "测试大学", collegename: "计算机学院",
      summername: "2027年预推免通知", websiteUrl: "https://example.test/notice/unknown.html", endtime: "" }]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.deadline).toBe("");
    expect(result.stats.unknownDeadlineCount).toBe(1);
  });
  it("接受完整分页", () => expect(validateZscampusPages([{ total: 3, records: [{ summerid: 1 }, { summerid: 2 }] }, { total: 3, records: [{ summerid: 3 }] }], 2)).toHaveLength(3));
  it("拒绝漏页", () => expect(() => validateZscampusPages([{ total: 3, records: [{ summerid: 1 }, { summerid: 2 }] }], 2)).toThrow());
  it("拒绝跨页重复 ID", () => expect(() => validateZscampusPages([{ total: 2, records: [{ summerid: 1 }] }, { total: 2, records: [{ summerid: 1 }] }], 1)).toThrow("重复"));
  it("拒绝异常空页", () => expect(() => validateZscampusPages([{ total: 2, records: [{ summerid: 1 }] }, { total: 2, records: [] }], 1)).toThrow());
  it("拒绝 total 漂移", () => expect(() => validateZscampusPages([{ total: 2, records: [{ summerid: 1 }] }, { total: 3, records: [{ summerid: 2 }] }], 1)).toThrow());
  it("400 不重复请求", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("invalid", { status: 400 })); vi.stubGlobal("fetch", fetcher);
    await expect(adminRequestWithRetry("https://example.test", "POST", {}, "test")).rejects.toThrow("400");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("发布事务", () => {
  it("服务端也拦截骤降，客户端检查不可绕过", async () => {
    const { db, env, post } = fixture(); seed(db, item("old"));
    await setAppState(env, "last_source_stats", JSON.stringify(metadata("").sourceStats.map((stat) => ({ ...stat, rawCount: 100, acceptedCount: 100 }))), new Date().toISOString());
    expect((await post("source-sync/start", metadata(new Date().toISOString()))).status).toBe(409);
    expect(db.itemSnapshots.get("old")?.missing_since).toBeNull();
  });
  it("已发布后abort不会撤销结果", async () => {
    const { db, post } = fixture(); const runId = new Date().toISOString();
    await post("source-sync/start", metadata(runId)); await post("source-sync/items", { runId, items: [item()] });
    await post("source-sync/finalize", { runId });
    expect(await (await post("source-sync/abort", { runId })).json()).toMatchObject({ alreadyPublished: true });
    expect(db.itemSnapshots.has("item")).toBe(true);
  });
  it("相同 finalize 重试返回原发布结果，不重复标记缺失", async () => {
    const { db, post } = fixture(); seed(db, item("old"));
    const runId = new Date().toISOString();
    expect((await post("source-sync/start", metadata(runId))).status).toBe(200);
    expect((await post("source-sync/items", { runId, items: [item()] })).status).toBe(200);
    const first = await (await post("source-sync/finalize", { runId })).json();
    const again = await (await post("source-sync/finalize", { runId })).json();
    expect(again).toEqual(first);
    expect(first).toMatchObject({ ok: true, result: { scanned: 1, missingCount: 1, snapshotVersion: runId } });
  });
  it("缺失审核候选阻止整个发布，旧快照不变", async () => {
    const { db, post } = fixture(); seed(db, item("old")); const runId = new Date().toISOString();
    await post("source-sync/start", metadata(runId, 1)); await post("source-sync/items", { runId, items: [item()] });
    expect((await post("source-sync/finalize", { runId })).status).toBe(409);
    expect(db.itemSnapshots.get("old")?.missing_since).toBeNull(); expect(db.itemSnapshots.has("item")).toBe(false);
  });
  it("审核池与快照一起发布", async () => {
    const { db, post } = fixture(); const runId = new Date().toISOString();
    await post("source-sync/start", metadata(runId, 1)); await post("source-sync/items", { runId, items: [item()] });
    const candidate = { normalizedUrl: "https://example.test/review", sourceGroup: "multi-source-merge", reason: "deadline-conflict",
      payload: { sourceGroup: "multi-source-merge", name: "大学", institute: "院系", description: "通知", deadline: "", website: "https://example.test/review" } };
    expect((await post("source-sync/review-candidates", { runId, items: [candidate] })).status).toBe(200);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM source_review_candidates").get()?.count).toBe(0);
    expect((await post("source-sync/finalize", { runId })).status).toBe(200);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM source_review_candidates").get()?.count).toBe(1);
  });
  it("重复上传幂等，不同内容复用 key 拒绝", async () => {
    const { db, post } = fixture(); const runId = new Date().toISOString(); await post("source-sync/start", metadata(runId));
    await post("source-sync/items", { runId, items: [item()] });
    expect((await post("source-sync/items", { runId, items: [item()] })).status).toBe(200);
    expect((await post("source-sync/items", { runId, items: [{ ...item(), description: "changed" }] })).status).toBe(409);
    expect(db.externalSourceSyncItems.size).toBe(1);
  });
  it("失去共享锁时事务回滚", async () => {
    const { db, env, post } = fixture(); const runId = new Date().toISOString(); seed(db, item("old"));
    await post("source-sync/start", metadata(runId)); await post("source-sync/items", { runId, items: [item()] });
    await setAppState(env, "external_source_sync_active_run", "", new Date().toISOString());
    expect((await post("source-sync/finalize", { runId })).status).toBe(409);
    expect(db.itemSnapshots.get("old")?.missing_since).toBeNull();
  });
});

describe("写入额度与增量发布", () => {
  it("20 个项目只保存一行批次，乱序重试不写入也不重复计费", async () => {
    const { db, env, post } = fixture(); const runId = new Date().toISOString();
    const items = Array.from({ length: 20 }, (_, index) => item(`item-${index}`));
    expect((await post("source-sync/start", metadata(runId, 0, 20))).status).toBe(200);
    expect((await post("source-sync/items", { runId, items })).status).toBe(200);
    const before = db.sqlite.prepare("SELECT total_changes() AS count").get()?.count;
    expect((await post("source-sync/items", { runId, items: [...items].reverse() })).status).toBe(200);
    expect(db.sqlite.prepare("SELECT total_changes() AS count").get()?.count).toBe(before);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM external_source_sync_batches").get()?.count).toBe(1);
    expect(db.externalSourceSyncItems.size).toBe(20);
    expect((await getWriteBudget(env)).reserved).toBe(12);
  });
  it("不同批次发生部分重叠时拒绝，不隐藏漏传", async () => {
    const { db, post } = fixture(); const runId = new Date().toISOString();
    expect((await post("source-sync/start", metadata(runId, 0, 3))).status).toBe(200);
    await post("source-sync/items", { runId, items: [item("a"), item("b")] });
    expect((await post("source-sync/items", { runId, items: [item("b"), item("c")] })).status).toBe(409);
    expect(db.externalSourceSyncItems.size).toBe(2);
    expect((await post("source-sync/finalize", { runId })).status).toBe(409);
  });
  it("完整发布不重写未变快照，消失标记和重现仍正确", async () => {
    const { db, post } = fixture(); seed(db); seed(db, item("old"));
    db.sqlite.exec("UPDATE item_snapshots SET last_seen_at = '2000-01-01T00:00:00.000Z'");
    db.sqlite.exec("CREATE TABLE snapshot_write_test (id TEXT); CREATE TRIGGER count_snapshot_update AFTER UPDATE ON item_snapshots BEGIN INSERT INTO snapshot_write_test VALUES (NEW.item_key); END");
    const runId = new Date().toISOString();
    await post("source-sync/start", metadata(runId)); await post("source-sync/items", { runId, items: [item()] });
    const first = await (await post("source-sync/finalize", { runId })).json();
    expect(first).toMatchObject({ ok: true, result: { changedItems: 0, missingCount: 1 } });
    expect(db.itemSnapshots.get("item")?.last_seen_at).toBe("2000-01-01T00:00:00.000Z");
    expect(db.itemSnapshots.get("item")?.missing_since).toBeNull();
    expect(db.sqlite.prepare("SELECT * FROM snapshot_write_test").all()).toEqual([{ id: "old" }]);
    const response = buildDdlResponse([db.itemSnapshots.get("item") as never], new Date(), runId);
    expect(response.items[0]?.lastSeenAt).toBe(runId);
    const nextId = new Date(Date.now() + 1_000).toISOString();
    expect((await post("source-sync/start", metadata(nextId, 0, 2))).status).toBe(200);
    await post("source-sync/items", { runId: nextId, items: [item(), item("old")] });
    expect(await (await post("source-sync/finalize", { runId: nextId })).json()).toMatchObject({ result: { changedItems: 1, missingCount: 0 } });
    expect(db.itemSnapshots.get("old")?.missing_since).toBeNull();
  });
  it("发布预算不足时整个事务回滚，保留上一健康版本与审核池", async () => {
    const { db, env, post } = fixture(); seed(db, item("old")); env.PIPELINE_DAILY_WRITE_BUDGET = "12";
    await setAppState(env, "snapshot_version", "healthy", new Date().toISOString());
    const runId = new Date().toISOString(); await post("source-sync/start", metadata(runId));
    await post("source-sync/items", { runId, items: [item()] });
    const response = await post("source-sync/finalize", { runId });
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: "pipeline_write_budget_exhausted" });
    expect(db.appState.get("snapshot_version")).toBe("healthy");
    expect(db.itemSnapshots.get("old")?.missing_since).toBeNull(); expect(db.itemSnapshots.has("item")).toBe(false);
    expect((await getWriteBudget(env)).reserved).toBe(12);
    expect((await post("source-sync/abort", { runId })).status).toBe(200);
    expect(db.externalSourceSyncItems.size).toBe(0);
  });
  it("并发预留不能超预算，UTC 零点重置且旧日预留不会丢失", async () => {
    const { env } = fixture(); env.PIPELINE_DAILY_WRITE_BUDGET = "100";
    const now = "2026-09-05T23:59:59.000Z";
    const results = await Promise.allSettled([env.DB.batch([reserveWriteBudget(env, 70, now)]), env.DB.batch([reserveWriteBudget(env, 70, now)])]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await getWriteBudget(env, new Date(now))).toMatchObject({ reserved: 70, remaining: 30, resetsAt: "2026-09-06T00:00:00.000Z" });
    expect(await getWriteBudget(env, new Date("2026-09-06T00:00:00Z"))).toMatchObject({ reserved: 0, remaining: 100 });
  });
  it("分类也受预算约束，失败不追加反馈", async () => {
    const { db, env, post } = fixture(); seed(db); env.PIPELINE_DAILY_WRITE_BUDGET = "0";
    expect((await post("activity-type-classifications", classification())).status).toBe(429);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM classification_feedback").get()?.count).toBe(0);
  });
  it("预算不足的 429 不自动重试", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"ok":false,"error":"pipeline_write_budget_exhausted"}', { status: 429 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(adminRequestWithRetry("https://example.test", "POST", {}, "test")).rejects.toThrow("预算不足");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("分类闭环", () => {
  it("不能把整批中另一项目链接配给当前itemKey", async () => {
    const { db, post } = fixture(); seed(db); seed(db, item("other"));
    const body = classification({ targets: [{ key: "item", contentHash: item().contentHash }, { key: "other", contentHash: item().contentHash }],
      items: [{ itemKey: "other", website: item().website, activityType: "pre_recommendation", reason: "wrong", classifier: "gpt-5.6-luna" }] });
    expect((await post("activity-type-classifications", body)).status).toBe(400);
  });
  it("即使本批只有一个目标也拒绝同链接跨批次传播", async () => {
    const { db, post } = fixture(); seed(db); seed(db, { ...item("second-batch"), website: item().website });
    const response = await post("activity-type-classifications", classification());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "shared_classification_url" });
  });
  it("通用报名门户不能写入 URL 级分类", async () => {
    const { db, post } = fixture(); const website = "https://example.test/apply/";
    seed(db, { ...item(), website });
    const response = await post("activity-type-classifications", classification({ items: [{ website,
      activityType: "pre_recommendation", reason: "portal", classifier: "gpt-5.6-luna" }] }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "ambiguous_classification_url" });
  });
  it("null 分类与进度请求返回400而不是500", async () => {
    const { post } = fixture();
    expect((await post("activity-type-classifications", null)).status).toBe(400);
    expect((await post("classification-progress", null)).status).toBe(400);
  });
  it("语义重复反馈的实际新增数量为0", async () => {
    const { db, post } = fixture(); seed(db);
    const first = await (await post("activity-type-classifications", classification())).json();
    const second = await (await post("activity-type-classifications", classification({ submissionId: "another" }))).json();
    expect(first).toMatchObject({ feedbackWritten: 1 }); expect(second).toMatchObject({ feedbackWritten: 0 });
  });
  it("同一runId不能中途更换实际模型", async () => {
    const { db, post } = fixture(); seed(db); await post("activity-type-classifications", classification());
    expect((await post("activity-type-classifications", classification({ submissionId: "second", model: "other" }))).status).toBe(409);
  });
  it("没有完整分页凭证不能标记成功", async () => {
    const { post } = fixture();
    expect((await post("classification-progress", { runId: "ai-1", snapshotVersion: "unpublished", model: "gpt-5.6-luna",
      status: "succeeded", cursor: null, processed: 0, retry: [], paginationComplete: true })).status).toBe(409);
  });
  it("完整分页记录和已处理数量允许完成", async () => {
    const { db, post } = fixture(); seed(db);
    await post("verification-candidates", { runId: "ai-1", cursor: "", limit: 1 });
    expect((await post("classification-progress", { runId: "ai-1", snapshotVersion: "unpublished", model: "gpt-5.6-luna",
      status: "succeeded", cursor: null, processed: 1, retry: [], paginationComplete: true })).status).toBe(200);
  });
  it("过期版本拒绝，不能写回", async () => {
    const { db, env, post } = fixture(); seed(db); await setAppState(env, "snapshot_version", "new", new Date().toISOString());
    expect((await post("activity-type-classifications", classification())).status).toBe(409);
    expect(db.activityTypeClassifications.size).toBe(0);
  });
  it("同版本内容变化也拒绝", async () => {
    const { db, post } = fixture(); seed(db, { ...item(), contentHash: "different" });
    expect((await post("activity-type-classifications", classification())).status).toBe(409);
  });
  it("候选分页期间发布变化返回409", async () => {
    const { db, env, post } = fixture(); seed(db);
    const page = await (await post("verification-candidates", { cursor: "", limit: 1 })).json() as { snapshotVersion: string };
    await setAppState(env, "snapshot_version", "new", new Date().toISOString());
    expect((await post("verification-candidates", { cursor: "item", snapshotVersion: page.snapshotVersion })).status).toBe(409);
  });
  it("重复提交不重复分类或反馈，发布后重试仍返回原结果", async () => {
    const { db, env, post } = fixture(); seed(db);
    const first = await (await post("activity-type-classifications", classification())).json();
    await setAppState(env, "snapshot_version", "new", new Date().toISOString());
    const again = await (await post("activity-type-classifications", classification())).json();
    expect(first).toEqual(again); expect(first).toMatchObject({ ok: true, accepted: 1 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM classification_feedback").get()?.count).toBe(1);
  });
  it("相同 submissionId 不得用于另一请求", async () => {
    const { db, post } = fixture(); seed(db); await post("activity-type-classifications", classification());
    expect((await post("activity-type-classifications", classification({ model: "other" }))).status).toBe(409);
  });
  it("记录实际模型、接受数和未完成原因", async () => {
    const { db, post } = fixture(); seed(db); await post("activity-type-classifications", classification());
    const response = await post("classification-progress", { runId: "ai-1", snapshotVersion: "unpublished", model: "gpt-5.6-luna",
      status: "partial", cursor: null, processed: 1, retry: [{ key: "item", reason: "official_page_blocked" }] });
    expect(response.status).toBe(200);
    const run = db.sqlite.prepare("SELECT * FROM pipeline_runs WHERE run_id = 'ai-1'").get();
    expect(JSON.parse(String(run?.result))).toEqual({ accepted: 1 }); expect(String(run?.metadata)).toContain("official_page_blocked");
  });
});

describe("云端采集兜底", () => {
  it.each([["2026-09-05T00:00:00Z", true], ["2026-09-05T15:59:00Z", true], ["2026-09-05T16:00:00Z", false], ["2026-09-04T23:59:00Z", false]])("北京时间窗口 %s", (date, expected) => expect(isWatchdogWindow(new Date(date as string))).toBe(expected));
  it("未开启时不访问 GitHub", async () => {
    const { env } = fixture(); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect(await requestSourceSync(env, "watchdog")).toMatchObject({ skipped: "disabled" }); expect(fetcher).not.toHaveBeenCalled();
  });
  it("共享锁只允许一个不同 runId", async () => {
    const { env } = fixture(); const now = new Date();
    const results = await Promise.all([claimSync(env, now.toISOString(), now), claimSync(env, new Date(now.getTime() + 1).toISOString(), now)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
  it("相同计划时间并发 watchdog 只触发一次，保持冷却", async () => {
    const { env } = fixture(); Object.assign(env, { SOURCE_WATCHDOG_ENABLED: "true", GITHUB_REPOSITORY: "owner/repo", GITHUB_ACTIONS_TOKEN: "test-only" });
    const fetcher = vi.fn(async (url: string) => url.endsWith("dispatches") ? new Response(null, { status: 204 }) : Response.json({ total_count: 0 }));
    vi.stubGlobal("fetch", fetcher); const now = new Date("2026-09-05T01:00:00Z");
    await Promise.all([requestSourceSync(env, "watchdog", now), requestSourceSync(env, "watchdog", now)]);
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith("dispatches"))).toHaveLength(1);
    expect(await requestSourceSync(env, "watchdog", new Date(now.getTime() + 10 * 60_000))).toMatchObject({ skipped: "cooldown" });
  });
  it("GitHub 在运行时不重复派发", async () => {
    const { env, db } = fixture(); Object.assign(env, { SOURCE_WATCHDOG_ENABLED: "true", GITHUB_REPOSITORY: "owner/repo", GITHUB_ACTIONS_TOKEN: "test-only" });
    const fetcher = vi.fn(async () => Response.json({ total_count: 1 })); vi.stubGlobal("fetch", fetcher);
    expect(await requestSourceSync(env, "watchdog", new Date("2026-09-05T01:00:00Z"))).toMatchObject({ skipped: "github_run_active" });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(db.appState.get("external_source_sync_active_run")).toBe("");
  });
  it("配置缺失记录明确故障且不触网", async () => {
    const { env, db } = fixture(); env.SOURCE_WATCHDOG_ENABLED = "true";
    expect(await requestSourceSync(env, "watchdog", new Date("2026-09-05T01:00:00Z"))).toMatchObject({ ok: false, error: "github_actions_not_configured" });
    expect(db.sqlite.prepare("SELECT status FROM pipeline_runs").get()?.status).toBe("failed");
  });
  it("dispatch响应丢失仍保留运行锁，Actions可以接续同一runId", async () => {
    const { env, db } = fixture(); Object.assign(env, { SOURCE_WATCHDOG_ENABLED: "true", GITHUB_REPOSITORY: "owner/repo", GITHUB_ACTIONS_TOKEN: "test-only" });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("dispatches")) throw new Error("response lost");
      return Response.json({ total_count: 0 });
    }));
    const now = new Date("2026-09-05T01:00:00Z");
    expect(await requestSourceSync(env, "watchdog", now)).toMatchObject({ error: "github_dispatch_outcome_unknown" });
    expect(db.sqlite.prepare("SELECT status FROM pipeline_runs").get()?.status).toBe("running");
    expect(await claimSync(env, now.toISOString(), now)).toBe(true);
  });
});
