import {
  acquireAppStateLock,
  approveReviewCandidate,
  discardExternalSourceSyncItems,
  discardExternalSourceSyncItemsCreatedBefore,
  getAppState,
  getItemActivityTypeClassifications,
  getItemRelevanceClassifications,
  getExternalSourceSyncItemCount,
  getOfficialItemVerifications,
  getPendingReviewCandidates,
  getReviewCandidateById,
  getSnapshotRowsPageBySourceGroups,
  getSnapshotRowsBySourceGroups,
  getVisitDailyStats,
  incrementVisitDailyStat,
  recordClassificationFeedback,
  insertReviewRule,
  publishExternalSourceSyncItems,
  rejectReviewCandidate,
  releaseAppStateLock,
  setAppState,
  stageExternalSourceSyncItems,
  unsubscribeByToken,
  upsertItemActivityTypeClassifications,
  upsertItemRelevanceClassifications,
  upsertOfficialItemVerifications,
  upsertManualItem,
  upsertReviewCandidates,
  upsertSnapshots
} from "./db";
import {
  buildDdlResponse,
  doesOfficialVerificationResolveDeadline,
  getDdlEntryNormalizedUrls,
  getDdlEntryOfficialVerificationTargets
} from "./ddl";
import { LAST_SOURCE_STATS_STATE_KEY } from "./checker";
import { sha256Hex } from "./crypto";
import {
  BAOYAN_AREA_OPTIONS,
  AUTOMATIC_SOURCE_GROUPS,
  MANUAL_SOURCE_GROUP,
  canonicalizeNotificationUrl,
  createManualItemFromReviewPayload,
  normalizeBaoyanXinxiDeadline
} from "./source";
import type { SourceReviewCandidateInput } from "./source";
import type {
  ActivityType,
  DeadlinePrecision,
  Env,
  ItemActivityTypeClassification,
  ClassificationFeedback,
  ClassificationFeedbackSource,
  ClassificationKind,
  ItemRelevanceClassification,
  NormalizedItem,
  OfficialItemVerification,
  Relevance,
  ReviewCandidatePayload,
  SourceStats,
  VisitDailyStatRow
} from "./types";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REVIEW_COOKIE_NAME = "baoyan_review_auth";
const REVIEW_SESSION_MAX_AGE_SECONDS = 6 * 60 * 60;
const EXTERNAL_SYNC_STATE_KEY = "external_source_sync_active_run";
const EXTERNAL_SYNC_BATCH_LIMIT = 20;
const EXTERNAL_SYNC_INDEX_LIMIT = 100;
const EXTERNAL_SYNC_LOCK_TIMEOUT_MS = 30 * 60 * 1000;
const EXTERNAL_SYNC_STAGING_RETENTION_MS = 24 * 60 * 60 * 1000;
const VERIFICATION_CANDIDATE_LIMIT = 100;
const COUNTRY_NAMES: Record<string, string> = {
  AU: "澳大利亚",
  CA: "加拿大",
  CN: "中国大陆",
  DE: "德国",
  FR: "法国",
  GB: "英国",
  HK: "中国香港",
  JP: "日本",
  KR: "韩国",
  MO: "中国澳门",
  MY: "马来西亚",
  NL: "荷兰",
  NZ: "新西兰",
  SG: "新加坡",
  TH: "泰国",
  TW: "中国台湾",
  US: "美国"
};

export async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (request.method === "GET" && url.pathname === "/") {
      return htmlResponse(renderSubscribePage());
    }
    if (request.method === "POST" && url.pathname === "/api/subscribe") {
      return await handleSubscribe(request, env);
    }
    if (request.method === "GET" && url.pathname === "/api/confirm") {
      return await handleConfirm(url, env);
    }
    if (request.method === "GET" && url.pathname === "/api/unsubscribe") {
      return await handleUnsubscribe(url, env);
    }
    if (request.method === "GET" && url.pathname === "/api/health") {
      return jsonResponse({ ok: true, time: new Date().toISOString() });
    }
    if (request.method === "GET" && url.pathname === "/api/ddl") {
      return await handleDdl(env, url);
    }
    if (
      request.method === "OPTIONS" &&
      (url.pathname === "/api/ddl" ||
        url.pathname === "/api/missing-link" ||
        url.pathname === "/api/analytics/visit" ||
        url.pathname === "/api/analytics/summary")
    ) {
      return handleDdlPreflight();
    }
    if (request.method === "POST" && url.pathname === "/api/analytics/visit") {
      return await handleAnalyticsVisit(request, env);
    }
    if (request.method === "GET" && url.pathname === "/api/analytics/summary") {
      return await handleAnalyticsSummary(env);
    }
    if (request.method === "POST" && url.pathname === "/api/missing-link") {
      return await handleMissingLink(request, env);
    }
    if (request.method === "GET" && url.pathname === "/api/admin/run-check") {
      return await handleManualRun(request, env);
    }
    if (request.method === "GET" && url.pathname === "/api/admin/sync-sources") {
      return await handleSyncSources(request, env);
    }
    if (request.method === "GET" && url.pathname === "/api/admin/source-health") {
      return await handleSourceHealth(request, env);
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/admin/verification-candidates"
    ) {
      return await handleVerificationCandidates(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/admin/source-sync/start") {
      return await handleExternalSourceSyncStart(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/admin/source-sync/index") {
      return await handleExternalSourceSyncIndex(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/admin/source-sync/items") {
      return await handleExternalSourceSyncItems(request, env);
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/admin/source-sync/review-candidates"
    ) {
      return await handleExternalSourceSyncReviewCandidates(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/admin/source-sync/finalize") {
      return await handleExternalSourceSyncFinalize(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/admin/source-sync/abort") {
      return await handleExternalSourceSyncAbort(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/admin/relevance-classifications") {
      return await handleRelevanceClassifications(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/admin/activity-type-classifications") {
      return await handleActivityTypeClassifications(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/admin/official-verifications") {
      return await handleOfficialItemVerifications(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/admin/classification-feedback") {
      return await handleClassificationFeedback(request, env);
    }
    if (request.method === "GET" && url.pathname === "/api/admin/review") {
      return await handleReviewPage(request, env);
    }
    if (request.method === "GET" && url.pathname === "/api/admin/review/candidates") {
      return await handleReviewCandidatesJson(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/admin/review/login") {
      return await handleReviewLogin(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/admin/review/approve") {
      return await handleReviewApprove(request, env);
    }
    if (request.method === "POST" && url.pathname === "/api/admin/review/reject") {
      return await handleReviewReject(request, env);
    }
    return htmlResponse(renderMessagePage("页面不存在", "请检查访问地址。"), 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return htmlResponse(renderMessagePage("服务暂时不可用", message), 500);
  }
}

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email) && email.length <= 254;
}

async function handleSubscribe(_request: Request, _env: Env): Promise<Response> {
  return htmlResponse(
    renderMessagePage("邮件推送已关闭", "当前不再接受新的邮件订阅，请使用 DDL 网站查看最新信息。"),
    410
  );
}

async function handleConfirm(_url: URL, _env: Env): Promise<Response> {
  return htmlResponse(
    renderMessagePage("邮件推送已关闭", "确认订阅入口已经停用，请使用 DDL 网站查看最新信息。"),
    410
  );
}

async function handleUnsubscribe(url: URL, env: Env): Promise<Response> {
  const token = url.searchParams.get("token");
  if (token === null || token.trim() === "") {
    return htmlResponse(renderMessagePage("退订链接无效", "链接缺少退订参数。"), 400);
  }

  const subscriber = await unsubscribeByToken(env, token, new Date().toISOString());
  if (subscriber === null) {
    return htmlResponse(renderMessagePage("退订链接无效", "链接可能已经失效。"), 400);
  }

  return htmlResponse(renderMessagePage("退订成功", "该邮箱之后不会再收到保研通知邮件。"));
}

async function handleManualRun(
  request: Request,
  env: Env
): Promise<Response> {
  if (!isAuthorizedAdmin(request, env)) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }
  return externalSyncRequiredResponse();
}

async function handleSyncSources(
  request: Request,
  env: Env
): Promise<Response> {
  if (!isAuthorizedAdmin(request, env)) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }
  return externalSyncRequiredResponse();
}

function externalSyncRequiredResponse(): Response {
  return jsonResponse(
    {
      ok: false,
      error: "external_sync_required",
      message: "Worker 不执行重型抓取，请使用 npm run sync:sources:external 分批同步。"
    },
    409
  );
}

async function handleSourceHealth(request: Request, env: Env): Promise<Response> {
  if (!isAuthorizedAdmin(request, env)) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }
  const rawStats = await getAppState(env, LAST_SOURCE_STATS_STATE_KEY);
  let sourceStats: unknown[] = [];
  if (rawStats !== null) {
    try {
      const parsed = JSON.parse(rawStats) as unknown;
      sourceStats = Array.isArray(parsed) ? parsed : [];
    } catch {
      sourceStats = [];
    }
  }
  return jsonResponse({
    ok: true,
    syncMode: "external-batched",
    lastSyncedAt: await getAppState(env, "last_synced_at"),
    sourceStats
  });
}

async function handleVerificationCandidates(
  request: Request,
  env: Env
): Promise<Response> {
  if (!isAuthorizedAdmin(request, env)) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }
  const body = (await request.json()) as Record<string, unknown>;
  const cursor = readString(body.cursor);
  const requestedLimit = readInteger(body.limit) ?? VERIFICATION_CANDIDATE_LIMIT;
  if (
    cursor.length > 200 ||
    requestedLimit < 1 ||
    requestedLimit > VERIFICATION_CANDIDATE_LIMIT
  ) {
    return jsonResponse({ ok: false, error: "invalid_candidate_request" }, 400);
  }
  const rows = await getSnapshotRowsPageBySourceGroups(
    env,
    [...AUTOMATIC_SOURCE_GROUPS],
    cursor,
    requestedLimit + 1
  );
  const pageRows = rows.slice(0, requestedLimit);
  const normalizedUrls = getDdlEntryNormalizedUrls(pageRows);
  const [relevanceClassifications, activityTypeClassifications, officialVerifications] =
    await Promise.all([
      getItemRelevanceClassifications(env, normalizedUrls),
      getItemActivityTypeClassifications(env, normalizedUrls),
      getOfficialItemVerifications(env, getDdlEntryOfficialVerificationTargets(pageRows), false)
    ]);
  const candidates = pageRows.flatMap((row) => {
    if (row.missing_since !== null) {
      return [];
    }
    try {
      const item = JSON.parse(row.payload) as NormalizedItem;
      const urls = [item.website, ...(item.alternateWebsites ?? [])]
        .map(canonicalizeNotificationUrl)
        .filter((url) => url !== "");
      const relevance = urls.map((url) => relevanceClassifications.get(url)).find(Boolean);
      const activityType = urls.map((url) => activityTypeClassifications.get(url)).find(Boolean);
      const verification = officialVerifications.get(row.item_key);
      const sourceUpdatedAt = getLatestSourcePublishedAt(item) || row.updated_at;
      const verificationResolvesDeadline =
        verification !== undefined &&
        doesOfficialVerificationResolveDeadline(item, verification, sourceUpdatedAt);
      const reasons: string[] = [];
      if (item.deadline === "") {
        reasons.push("unknown-deadline");
      } else if (item.deadlinePrecision !== "exact") {
        reasons.push("date-level-deadline");
      }
      if (item.deadlineConflict === true) {
        reasons.push("deadline-conflict");
      }
      if (relevance === undefined) {
        reasons.push("unclassified-relevance");
      } else if (relevance.classifiedAt < sourceUpdatedAt) {
        reasons.push("stale-relevance-classification");
      }
      if (activityType === undefined) {
        reasons.push("unclassified-activity-type");
      } else if (activityType.classifiedAt < sourceUpdatedAt) {
        reasons.push("stale-activity-type-classification");
      }
      if (
        /预推免|预免推|九推|推荐免试|免试攻读研究生|推免生接收|推免研究生|推免面试/u.test(
          `${item.name} ${item.institute} ${item.description}`
        ) &&
        activityType?.activityType !== "pre_recommendation"
      ) {
        reasons.push("activity-type-rule-feedback");
      }
      if (
        verificationResolvesDeadline
      ) {
        const deadlineIndex = reasons.indexOf("unknown-deadline");
        if (deadlineIndex >= 0) {
          reasons.splice(deadlineIndex, 1);
        }
        const dateLevelIndex = reasons.indexOf("date-level-deadline");
        if (dateLevelIndex >= 0) {
          reasons.splice(dateLevelIndex, 1);
        }
        const conflictIndex = reasons.indexOf("deadline-conflict");
        if (conflictIndex >= 0) {
          reasons.splice(conflictIndex, 1);
        }
      }
      if (verification !== undefined && !verificationResolvesDeadline) {
        if (verification.verifiedAt < sourceUpdatedAt) {
          reasons.push("stale-official-verification");
        } else if (verification.deadline === "" && item.deadline !== "") {
          reasons.push("official-deadline-unknown");
        } else if (
          item.deadline !== "" &&
          verification.deadline !== "" &&
          new Date(verification.deadline).getTime() > new Date(item.deadline).getTime()
        ) {
          reasons.push("official-deadline-later-than-source");
        }
      }
      if (reasons.length === 0) {
        return [];
      }
      return [
        {
          key: row.item_key,
          school: item.name,
          institute: item.institute,
          title: item.description,
          website: item.website,
          alternateWebsites: item.alternateWebsites ?? [],
          deadline: item.deadline,
          deadlinePrecision: item.deadlinePrecision ?? "unknown",
          deadlineConflict: item.deadlineConflict ?? false,
          activityType: item.activityType ?? "unknown",
          areas: item.areas ?? [],
          sourceGroups: item.sourceGroups ?? [item.sourceGroup],
          sourceUpdatedAt,
          officialDeadline: verification?.deadline ?? null,
          officialVerifiedAt: verification?.verifiedAt ?? null,
          reasons
        }
      ];
    } catch {
      return [];
    }
  });
  return jsonResponse({
    ok: true,
    candidates,
    nextCursor: rows.length > requestedLimit ? pageRows.at(-1)?.item_key ?? null : null
  });
}

function getLatestSourcePublishedAt(item: NormalizedItem): string {
  return (item.sourceObservations ?? []).reduce(
    (latest, observation) =>
      observation.publishedAt > latest ? observation.publishedAt : latest,
    ""
  );
}

interface ExternalSourceSyncRun {
  runId: string;
  expectedCount: number;
  reviewCandidateCount: number;
  sourceStats: SourceStats[];
  activityTypeCounts: Record<ActivityType, number>;
}

async function handleExternalSourceSyncStart(request: Request, env: Env): Promise<Response> {
  if (!isAuthorizedAdmin(request, env)) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }
  const metadata = readExternalSourceSyncRun(await request.json());
  if (metadata === null) {
    return jsonResponse({ ok: false, error: "invalid_sync_run" }, 400);
  }
  const now = new Date().toISOString();
  const serializedMetadata = JSON.stringify(metadata);
  const staleBefore = new Date(Date.now() - EXTERNAL_SYNC_LOCK_TIMEOUT_MS).toISOString();
  const acquired = await acquireAppStateLock(
    env,
    EXTERNAL_SYNC_STATE_KEY,
    serializedMetadata,
    now,
    staleBefore
  );
  if (!acquired) {
    const activeRun = await getActiveExternalSourceSyncRun(env, metadata.runId);
    if (activeRun === null) {
      return jsonResponse({ ok: false, error: "sync_run_active" }, 409);
    }
  } else {
    await discardExternalSourceSyncItemsCreatedBefore(
      env,
      new Date(Date.now() - EXTERNAL_SYNC_STAGING_RETENTION_MS).toISOString()
    );
    await discardExternalSourceSyncItems(env, metadata.runId);
  }
  return jsonResponse({
    ok: true,
    runId: metadata.runId,
    expectedCount: metadata.expectedCount
  });
}

async function handleExternalSourceSyncIndex(
  request: Request,
  env: Env
): Promise<Response> {
  if (!isAuthorizedAdmin(request, env)) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }
  const body = (await request.json()) as Record<string, unknown>;
  const metadata = await getActiveExternalSourceSyncRun(env, readString(body.runId));
  const cursor = readString(body.cursor);
  const requestedLimit = readInteger(body.limit) ?? EXTERNAL_SYNC_INDEX_LIMIT;
  if (
    metadata === null ||
    cursor.length > 200 ||
    requestedLimit < 1 ||
    requestedLimit > EXTERNAL_SYNC_INDEX_LIMIT
  ) {
    return jsonResponse({ ok: false, error: "invalid_index_request" }, 400);
  }
  const rows = await getSnapshotRowsPageBySourceGroups(
    env,
    [...AUTOMATIC_SOURCE_GROUPS],
    cursor,
    requestedLimit
  );
  const items = rows.flatMap((row) => {
    try {
      const item = JSON.parse(row.payload) as NormalizedItem;
      return [
        {
          key: row.item_key,
          school: item.name,
          institute: item.institute,
          deadlineAt: item.deadline,
          website: item.website,
          alternateWebsites: item.alternateWebsites ?? [],
          active: row.missing_since === null,
          lastSeenAt: row.last_seen_at ?? ""
        }
      ];
    } catch {
      return [];
    }
  });
  return jsonResponse({
    ok: true,
    items,
    nextCursor: rows.length === requestedLimit ? rows.at(-1)?.item_key ?? null : null
  });
}

async function handleExternalSourceSyncItems(request: Request, env: Env): Promise<Response> {
  if (!isAuthorizedAdmin(request, env)) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }
  const body = (await request.json()) as Record<string, unknown>;
  const metadata = await getActiveExternalSourceSyncRun(env, readString(body.runId));
  if (metadata === null) {
    return jsonResponse({ ok: false, error: "sync_run_not_active" }, 409);
  }
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (rawItems.length === 0 || rawItems.length > EXTERNAL_SYNC_BATCH_LIMIT) {
    return jsonResponse({ ok: false, error: "invalid_items" }, 400);
  }
  const items = rawItems.map(readExternalSourceSyncItem);
  if (
    items.some((item) => item === null) ||
    new Set(items.map((item) => item?.key)).size !== items.length
  ) {
    return jsonResponse({ ok: false, error: "invalid_sync_item" }, 400);
  }
  await stageExternalSourceSyncItems(
    env,
    metadata.runId,
    items as NormalizedItem[],
    new Date().toISOString()
  );
  return jsonResponse({ ok: true, runId: metadata.runId, accepted: items.length });
}

async function handleExternalSourceSyncReviewCandidates(
  request: Request,
  env: Env
): Promise<Response> {
  if (!isAuthorizedAdmin(request, env)) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }
  const body = (await request.json()) as Record<string, unknown>;
  const metadata = await getActiveExternalSourceSyncRun(env, readString(body.runId));
  if (metadata === null) {
    return jsonResponse({ ok: false, error: "sync_run_not_active" }, 409);
  }
  const rawCandidates = Array.isArray(body.items) ? body.items : [];
  if (rawCandidates.length === 0 || rawCandidates.length > EXTERNAL_SYNC_BATCH_LIMIT) {
    return jsonResponse({ ok: false, error: "invalid_items" }, 400);
  }
  const candidates = rawCandidates.map(readExternalSourceReviewCandidate);
  if (candidates.some((candidate) => candidate === null)) {
    return jsonResponse({ ok: false, error: "invalid_review_candidate" }, 400);
  }
  await upsertReviewCandidates(
    env,
    candidates as SourceReviewCandidateInput[],
    metadata.runId
  );
  return jsonResponse({ ok: true, runId: metadata.runId, accepted: candidates.length });
}

async function handleExternalSourceSyncFinalize(
  request: Request,
  env: Env
): Promise<Response> {
  if (!isAuthorizedAdmin(request, env)) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }
  const body = (await request.json()) as Record<string, unknown>;
  const metadata = await getActiveExternalSourceSyncRun(env, readString(body.runId));
  if (metadata === null) {
    return jsonResponse({ ok: false, error: "sync_run_not_active" }, 409);
  }
  const writtenCount = await getExternalSourceSyncItemCount(env, metadata.runId);
  if (writtenCount !== metadata.expectedCount) {
    return jsonResponse(
      {
        ok: false,
        error: "sync_item_count_mismatch",
        expectedCount: metadata.expectedCount,
        writtenCount
      },
      409
    );
  }
  const now = new Date().toISOString();
  const missingCount = await publishExternalSourceSyncItems(
    env,
    metadata.runId,
    [...AUTOMATIC_SOURCE_GROUPS],
    now,
    metadata.sourceStats,
    EXTERNAL_SYNC_STATE_KEY,
    JSON.stringify(metadata)
  );
  return jsonResponse({
    ok: true,
    result: {
      scanned: metadata.expectedCount,
      missingCount,
      lastSyncedAt: now,
      sourceStats: metadata.sourceStats,
      activityTypeCounts: metadata.activityTypeCounts
    }
  });
}

async function handleExternalSourceSyncAbort(
  request: Request,
  env: Env
): Promise<Response> {
  if (!isAuthorizedAdmin(request, env)) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }
  const body = (await request.json()) as Record<string, unknown>;
  const metadata = await getActiveExternalSourceSyncRun(env, readString(body.runId));
  if (metadata === null) {
    return jsonResponse({ ok: false, error: "sync_run_not_active" }, 409);
  }
  await discardExternalSourceSyncItems(env, metadata.runId);
  const released = await releaseAppStateLock(
    env,
    EXTERNAL_SYNC_STATE_KEY,
    JSON.stringify(metadata),
    new Date().toISOString()
  );
  return jsonResponse({ ok: released, runId: metadata.runId }, released ? 200 : 409);
}

async function handleDdl(env: Env, url: URL): Promise<Response> {
  const rows = await getSnapshotRowsBySourceGroups(env, [
    ...AUTOMATIC_SOURCE_GROUPS,
    MANUAL_SOURCE_GROUP
  ]);
  const normalizedUrls = getDdlEntryNormalizedUrls(rows);
  const [classifications, activityTypeClassifications, officialVerifications] = await Promise.all([
    getItemRelevanceClassifications(env, normalizedUrls),
    getItemActivityTypeClassifications(env, normalizedUrls),
    getOfficialItemVerifications(env, getDdlEntryOfficialVerificationTargets(rows))
  ]);
  const response = buildDdlResponse(
    rows,
    new Date(),
    await getAppState(env, "last_synced_at"),
    classifications,
    {
      includeExpired: isTruthyQueryParam(url.searchParams.get("includeExpired")),
      activityTypeClassifications,
      officialVerifications
    }
  );
  return jsonResponse(response, 200, {
    "cache-control": "public, max-age=300, s-maxage=900",
    // 允许 LLM / Agent 在浏览器端跨域抓取结构化数据
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS"
  });
}

async function handleAnalyticsVisit(request: Request, env: Env): Promise<Response> {
  const now = new Date();
  const geo = readRequestGeo(request);
  await incrementVisitDailyStat(
    env,
    {
      visitDate: formatShanghaiDate(now),
      countryCode: geo.countryCode,
      regionCode: geo.regionCode,
      countryName: geo.countryName,
      regionName: geo.regionName
    },
    now.toISOString()
  );
  return jsonResponse({ ok: true }, 200, {
    "cache-control": "no-store",
    ...corsHeaders()
  });
}

async function handleAnalyticsSummary(env: Env): Promise<Response> {
  const sinceDate = formatShanghaiDate(addDays(new Date(), -29));
  const rows = await getVisitDailyStats(env, sinceDate);
  return jsonResponse(buildAnalyticsSummary(rows), 200, {
    "cache-control": "public, max-age=300, s-maxage=900",
    ...corsHeaders()
  });
}

async function handleRelevanceClassifications(request: Request, env: Env): Promise<Response> {
  if (!isAuthorizedAdmin(request, env)) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }

  const body = (await request.json()) as Record<string, unknown>;
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (rawItems.length === 0 || rawItems.length > 500) {
    return jsonResponse({ ok: false, error: "invalid_items" }, 400);
  }

  const now = new Date().toISOString();
  const entries = rawItems.map((entry) => readRelevanceClassification(entry, now));
  if (entries.some((entry) => entry === null)) {
    return jsonResponse({ ok: false, error: "invalid_classification" }, 400);
  }

  const changed = await upsertItemRelevanceClassifications(
    env,
    entries as ItemRelevanceClassification[],
    now
  );
  const feedbackWritten = await recordClassificationFeedback(
    env,
    (entries as ItemRelevanceClassification[]).map((entry) => ({
      normalizedUrl: entry.normalizedUrl,
      classificationKind: "relevance" as const,
      modelValue: entry.relevance,
      correctedValue: entry.relevance,
      reason: entry.reason,
      source: "model" as const,
      classifier: entry.classifier,
      createdAt: now
    }))
  );
  return jsonResponse({
    ok: true,
    accepted: entries.length,
    changed,
    feedbackWritten
  });
}

async function handleActivityTypeClassifications(request: Request, env: Env): Promise<Response> {
  if (!isAuthorizedAdmin(request, env)) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }

  const body = (await request.json()) as Record<string, unknown>;
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (rawItems.length === 0 || rawItems.length > 500) {
    return jsonResponse({ ok: false, error: "invalid_items" }, 400);
  }

  const now = new Date().toISOString();
  const entries = rawItems.map((entry) => readActivityTypeClassification(entry, now));
  if (entries.some((entry) => entry === null)) {
    return jsonResponse({ ok: false, error: "invalid_classification" }, 400);
  }

  const changed = await upsertItemActivityTypeClassifications(
    env,
    entries as ItemActivityTypeClassification[],
    now
  );
  const feedbackWritten = await recordClassificationFeedback(
    env,
    (entries as ItemActivityTypeClassification[]).map((entry) => ({
      normalizedUrl: entry.normalizedUrl,
      classificationKind: "activity_type" as const,
      modelValue: entry.activityType,
      correctedValue: entry.activityType,
      reason: entry.reason,
      source: "model" as const,
      classifier: entry.classifier,
      createdAt: now
    }))
  );
  return jsonResponse({
    ok: true,
    accepted: entries.length,
    changed,
    feedbackWritten
  });
}

async function handleOfficialItemVerifications(request: Request, env: Env): Promise<Response> {
  if (!isAuthorizedAdmin(request, env)) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }

  const body = (await request.json()) as Record<string, unknown>;
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (rawItems.length === 0 || rawItems.length > 500) {
    return jsonResponse({ ok: false, error: "invalid_items" }, 400);
  }

  const now = new Date().toISOString();
  const entries = rawItems.map((entry) => readOfficialItemVerification(entry, now));
  if (entries.some((entry) => entry === null)) {
    return jsonResponse({ ok: false, error: "invalid_verification" }, 400);
  }

  const changed = await upsertOfficialItemVerifications(
    env,
    entries as OfficialItemVerification[],
    now
  );
  return jsonResponse({ ok: true, accepted: entries.length, changed });
}

async function handleClassificationFeedback(request: Request, env: Env): Promise<Response> {
  if (!isAuthorizedAdmin(request, env)) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }

  const body = (await request.json()) as Record<string, unknown>;
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (rawItems.length === 0 || rawItems.length > 500) {
    return jsonResponse({ ok: false, error: "invalid_items" }, 400);
  }

  const now = new Date().toISOString();
  const entries = rawItems.map((entry) => readClassificationFeedback(entry, now));
  if (entries.some((entry) => entry === null)) {
    return jsonResponse({ ok: false, error: "invalid_feedback" }, 400);
  }
  const accepted = entries as ClassificationFeedback[];
  const written = await recordClassificationFeedback(env, accepted);
  return jsonResponse({ ok: true, accepted: accepted.length, written });
}

async function handleMissingLink(request: Request, env: Env): Promise<Response> {
  const body = await readReviewPayloadFromRequest(request);
  const website = body.website.trim();
  const normalizedUrl = canonicalizeNotificationUrl(website);
  if (normalizedUrl === "") {
    return jsonResponse({ ok: false, error: "invalid_url" }, 400, corsHeaders());
  }

  const now = new Date().toISOString();
  await upsertReviewCandidates(
    env,
    [
      {
        normalizedUrl,
        sourceGroup: "user-submission",
        reason: "user-submitted",
        payload: {
          sourceGroup: "user-submission",
          name: body.name.trim(),
          institute: body.institute.trim(),
          description: body.description.trim() || "用户提交缺漏链接",
          deadline: normalizeBaoyanXinxiDeadline(body.deadline.trim()),
          website,
          submittedBy: (body.submittedBy ?? "").trim(),
          note: (body.note ?? "").trim()
        }
      }
    ],
    now
  );
  return jsonResponse({ ok: true }, 200, corsHeaders());
}

async function handleReviewPage(request: Request, env: Env): Promise<Response> {
  if (!(await isAuthorizedReviewAdmin(request, env))) {
    return htmlResponse(renderReviewLoginPage());
  }

  return htmlResponse(renderReviewPage(await getPendingReviewCandidates(env)));
}

async function handleReviewCandidatesJson(request: Request, env: Env): Promise<Response> {
  if (!(await isAuthorizedReviewAdmin(request, env))) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }
  return jsonResponse({ ok: true, candidates: await getPendingReviewCandidates(env) });
}

async function handleReviewLogin(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  if (!(await isValidReviewPassword(env, password))) {
    return htmlResponse(renderMessagePage("无法进入审核页", "管理员密码不正确。"), 401);
  }

  return redirectResponse("/api/admin/review", {
    "set-cookie": buildReviewSessionCookie(request, await getReviewSessionValue(env))
  });
}

async function handleReviewApprove(request: Request, env: Env): Promise<Response> {
  if (!(await isAuthorizedReviewAdmin(request, env))) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }

  const form = await request.formData();
  const id = Number.parseInt(String(form.get("id") ?? ""), 10);
  const candidate = Number.isFinite(id) ? await getReviewCandidateById(env, id) : null;
  if (candidate === null) {
    return htmlResponse(renderMessagePage("候选不存在", "请返回审核页刷新后再试。"), 404);
  }

  const payload = mergeCandidatePayload(candidate.candidate, {
    sourceGroup: candidate.candidate.sourceGroup,
    name: String(form.get("name") ?? ""),
    institute: String(form.get("institute") ?? ""),
    description: String(form.get("description") ?? ""),
    deadline: String(form.get("deadline") ?? ""),
    website: String(form.get("website") ?? "")
  });
  if (payload.name === "" || payload.website === "") {
    return htmlResponse(renderMessagePage("字段不完整", "学校和原始链接不能为空。"), 400);
  }

  const now = new Date().toISOString();
  const item = await createManualItemFromReviewPayload(payload);
  await upsertManualItem(env, item, now);
  await upsertSnapshots(env, [item], now);
  await approveReviewCandidate(env, candidate.id, toNullableString(form.get("note")), now);
  await insertReviewRule(env, "allow", candidate.normalized_url, toNullableString(form.get("note")), now);
  return redirectResponse("/api/admin/review");
}

async function handleReviewReject(request: Request, env: Env): Promise<Response> {
  if (!(await isAuthorizedReviewAdmin(request, env))) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }

  const form = await request.formData();
  const id = Number.parseInt(String(form.get("id") ?? ""), 10);
  const candidate = Number.isFinite(id) ? await getReviewCandidateById(env, id) : null;
  if (candidate === null) {
    return htmlResponse(renderMessagePage("候选不存在", "请返回审核页刷新后再试。"), 404);
  }

  const now = new Date().toISOString();
  const note = toNullableString(form.get("note"));
  await rejectReviewCandidate(env, candidate.id, note, now);
  await insertReviewRule(env, "reject", candidate.normalized_url, note, now);
  return redirectResponse("/api/admin/review");
}

function handleDdlPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(),
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "*",
      "access-control-max-age": "86400"
    }
  });
}

async function readReviewPayloadFromRequest(request: Request): Promise<ReviewCandidatePayload> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as Record<string, unknown>;
    return {
      sourceGroup: "user-submission",
      name: readString(body.name),
      institute: readString(body.institute),
      description: readString(body.description),
      deadline: readString(body.deadline),
      website: readString(body.website),
      submittedBy: readString(body.submittedBy),
      note: readString(body.note)
    };
  }

  const form = await request.formData();
  return {
    sourceGroup: "user-submission",
    name: String(form.get("name") ?? ""),
    institute: String(form.get("institute") ?? ""),
    description: String(form.get("description") ?? ""),
    deadline: String(form.get("deadline") ?? ""),
    website: String(form.get("website") ?? ""),
    submittedBy: String(form.get("submittedBy") ?? ""),
    note: String(form.get("note") ?? "")
  };
}

function isAuthorizedAdmin(request: Request, env: Env): boolean {
  if (env.ADMIN_TOKEN === undefined || env.ADMIN_TOKEN.trim() === "") {
    return false;
  }
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token");
  const authHeader = request.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  return queryToken === env.ADMIN_TOKEN || bearerToken === env.ADMIN_TOKEN;
}

async function isAuthorizedReviewAdmin(request: Request, env: Env): Promise<boolean> {
  const cookie = getCookie(request, REVIEW_COOKIE_NAME);
  if (cookie === null) {
    return false;
  }
  return cookie === (await getReviewSessionValue(env));
}

async function isValidReviewPassword(env: Env, password: string): Promise<boolean> {
  const configured = env.ADMIN_REVIEW_PASSWORD?.trim();
  if (configured === undefined || configured === "") {
    return false;
  }
  return (await sha256Hex(`review-password:${password}`)) ===
    (await sha256Hex(`review-password:${configured}`));
}

async function getReviewSessionValue(env: Env): Promise<string> {
  const configured = env.ADMIN_REVIEW_PASSWORD?.trim() ?? "";
  const salt = env.ADMIN_TOKEN?.trim() ?? "review";
  return sha256Hex(`review-session:${configured}:${salt}`);
}

function getCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (cookieHeader === null) {
    return null;
  }
  for (const entry of cookieHeader.split(";")) {
    const [key, ...valueParts] = entry.trim().split("=");
    if (key === name) {
      return valueParts.join("=");
    }
  }
  return null;
}

function buildReviewSessionCookie(request: Request, value: string): string {
  const isHttps = new URL(request.url).protocol === "https:";
  return [
    `${REVIEW_COOKIE_NAME}=${value}`,
    "Path=/api/admin/review",
    `Max-Age=${REVIEW_SESSION_MAX_AGE_SECONDS}`,
    "HttpOnly",
    isHttps ? "Secure" : "",
    "SameSite=Lax"
  ]
    .filter((part) => part !== "")
    .join("; ");
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8"
    }
  });
}

function redirectResponse(location: string, headers: Record<string, string> = {}): Response {
  return new Response(null, {
    status: 303,
    headers: {
      location,
      ...headers
    }
  });
}

function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders
    }
  });
}

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*"
  };
}

function buildAnalyticsSummary(rows: VisitDailyStatRow[]): {
  ok: true;
  generatedAt: string;
  windowDays: number;
  totalVisits: number;
  todayVisits: number;
  countryCount: number;
  regionCount: number;
  countries: Array<{
    countryCode: string;
    countryName: string;
    visitCount: number;
    share: number;
  }>;
  regions: Array<{
    countryCode: string;
    regionCode: string;
    regionName: string;
    visitCount: number;
    share: number;
  }>;
  daily: Array<{ date: string; visitCount: number }>;
} {
  const today = formatShanghaiDate(new Date());
  const countryCounts = new Map<string, { countryCode: string; countryName: string; count: number }>();
  const regionCounts = new Map<
    string,
    { countryCode: string; regionCode: string; regionName: string; count: number }
  >();
  const dailyCounts = new Map<string, number>();
  let totalVisits = 0;

  for (const row of rows) {
    const visitCount = readNonNegativeCount(row.visit_count);
    totalVisits += visitCount;
    dailyCounts.set(row.visit_date, (dailyCounts.get(row.visit_date) ?? 0) + visitCount);
    const countryCode = normalizeCountryCode(row.country_code);
    const countryName = row.country_name.trim() || getCountryName(countryCode);
    const current = countryCounts.get(countryCode) ?? {
      countryCode,
      countryName,
      count: 0
    };
    current.count += visitCount;
    if (current.countryName === "未知地区" && countryName !== "未知地区") {
      current.countryName = countryName;
    }
    countryCounts.set(countryCode, current);

    const regionCode = normalizeRegionCode(row.region_code);
    const regionName = formatRegionName(countryName, regionCode, row.region_name);
    const regionKey = `${countryCode}:${regionCode}:${regionName}`;
    const currentRegion = regionCounts.get(regionKey) ?? {
      countryCode,
      regionCode,
      regionName,
      count: 0
    };
    currentRegion.count += visitCount;
    regionCounts.set(regionKey, currentRegion);
  }

  const countries = Array.from(countryCounts.values())
    .sort((left, right) => right.count - left.count || left.countryCode.localeCompare(right.countryCode))
    .slice(0, 24)
    .map((entry) => ({
      countryCode: entry.countryCode,
      countryName: entry.countryName,
      visitCount: entry.count,
      share: totalVisits === 0 ? 0 : Math.round((entry.count / totalVisits) * 1000) / 10
    }));

  const regions = Array.from(regionCounts.values())
    .sort((left, right) => right.count - left.count || left.regionName.localeCompare(right.regionName, "zh-CN"))
    .slice(0, 12)
    .map((entry) => ({
      countryCode: entry.countryCode,
      regionCode: entry.regionCode,
      regionName: entry.regionName,
      visitCount: entry.count,
      share: totalVisits === 0 ? 0 : Math.round((entry.count / totalVisits) * 1000) / 10
    }));

  const daily = Array.from(dailyCounts.entries())
    .sort(([leftDate], [rightDate]) => leftDate.localeCompare(rightDate))
    .map(([date, visitCount]) => ({ date, visitCount }));

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    windowDays: 30,
    totalVisits,
    todayVisits: dailyCounts.get(today) ?? 0,
    countryCount: countryCounts.size,
    regionCount: regionCounts.size,
    countries,
    regions,
    daily
  };
}

function readRequestGeo(request: Request): {
  countryCode: string;
  regionCode: string;
  countryName: string;
  regionName: string;
} {
  const cf = request.cf as IncomingRequestCfProperties | undefined;
  const countryCode = normalizeCountryCode(
    readHeaderString(request, "x-vercel-ip-country") || readCfString(cf?.country)
  );
  const regionCode = normalizeRegionCode(
    readHeaderString(request, "x-vercel-ip-country-region") || readCfString(cf?.regionCode)
  );
  const countryName = getCountryName(countryCode);
  const regionName =
    readVercelGeoHeader(request, "x-vercel-ip-city") ||
    readCfString(cf?.region) ||
    regionCode;
  return {
    countryCode,
    regionCode,
    countryName,
    regionName
  };
}

function readCfString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readHeaderString(request: Request, name: string): string {
  return request.headers.get(name)?.trim() ?? "";
}

function readVercelGeoHeader(request: Request, name: string): string {
  const rawValue = readHeaderString(request, name);
  if (rawValue === "") {
    return "";
  }
  try {
    return decodeURIComponent(rawValue).trim();
  } catch {
    return rawValue;
  }
}

function normalizeCountryCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{2}$/u.test(normalized) ? normalized : "XX";
}

function normalizeRegionCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  return /^[A-Z0-9-]{1,16}$/u.test(normalized) ? normalized : "";
}

function getCountryName(countryCode: string): string {
  const name = COUNTRY_NAMES[countryCode];
  return name ?? (countryCode === "XX" ? "未知地区" : countryCode);
}

function formatRegionName(countryName: string, regionCode: string, regionName: string): string {
  const name = regionName.trim();
  if (name !== "") {
    return `${countryName} / ${name}`;
  }
  if (regionCode !== "") {
    return `${countryName} / ${regionCode}`;
  }
  return countryName;
}

function readNonNegativeCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function isTruthyQueryParam(value: string | null): boolean {
  return value === "1" || value === "true" || value === "yes";
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function formatShanghaiDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function renderSubscribePage(): string {
  return renderPage(
    "保研 DDL 数据服务",
    `
      <p class="lead">邮件推送已经关闭，当前系统只维护 DDL 查询网站和公开数据接口。</p>
      <p><a href="https://csddl.muqyy.top/">打开 DDL 查询网站</a></p>
      <p class="note">历史邮件的退订链接仍然有效；新的 DDL 数据会继续每天同步到网站。</p>
    `
  );
}

function renderMessagePage(title: string, message: string): string {
  return renderPage(
    title,
    `
      <p class="lead">${escapeHtml(message)}</p>
      <p><a href="/">返回首页</a></p>
    `
  );
}

function renderReviewLoginPage(): string {
  return renderPage(
    "候选审核登录",
    `
      <p class="lead">请输入管理员密码进入候选审核页面。</p>
      <form action="/api/admin/review/login" method="post">
        <label for="password">管理员密码</label>
        <div class="field">
          <input id="password" name="password" type="password" autocomplete="current-password" required>
          <button type="submit">进入审核</button>
        </div>
      </form>
    `
  );
}

function renderReviewPage(
  candidates: Array<{
    id: number;
    reason: string;
    updated_at: string;
    candidate: ReviewCandidatePayload;
  }>
): string {
  const body =
    candidates.length === 0
      ? '<p class="lead">当前没有待审核候选。</p>'
      : candidates.map(renderReviewCandidate).join("");
  return renderPage(
    "候选条目审核",
    `
      <p class="lead">审核通过后会进入公开 DDL 数据；拒绝后不会重复进入候选池。</p>
      <div class="review-list">${body}</div>
    `
  );
}

function renderReviewCandidate(candidate: {
  id: number;
  reason: string;
  updated_at: string;
  candidate: ReviewCandidatePayload;
}): string {
  const payload = candidate.candidate;
  return `
    <section class="review-card">
      <div class="review-meta">
        <strong>#${candidate.id}</strong>
        <span>${escapeHtml(candidate.reason)}</span>
        <span>${escapeHtml(formatReviewTime(candidate.updated_at))}</span>
      </div>
      <form action="/api/admin/review/approve" method="post">
        <input type="hidden" name="id" value="${candidate.id}">
        <label>学校
          <input name="name" value="${escapeHtml(payload.name)}" required>
        </label>
        <label>院系
          <input name="institute" value="${escapeHtml(payload.institute)}">
        </label>
        <label>截止时间
          <input name="deadline" value="${escapeHtml(payload.deadline)}">
        </label>
        <label>原始链接
          <input name="website" value="${escapeHtml(payload.website)}" required>
        </label>
        <label>简介
          <textarea name="description" rows="2">${escapeHtml(payload.description)}</textarea>
        </label>
        <label>备注
          <input name="note" value="">
        </label>
        <div class="review-actions">
          <button type="submit">批准公开</button>
        </div>
      </form>
      <form action="/api/admin/review/reject" method="post">
        <input type="hidden" name="id" value="${candidate.id}">
        <div class="review-actions">
          <input name="note" placeholder="拒绝备注，可选">
          <button class="secondary" type="submit">拒绝</button>
        </div>
      </form>
    </section>
  `;
}

function renderPage(title: string, body: string): string {
  return `
    <!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${escapeHtml(title)}</title>
        <style>
          :root {
            color-scheme: light;
            --bg: #eef2f6;
            --panel: #ffffff;
            --text: #1f2937;
            --muted: #596579;
            --border: #d7dde8;
            --accent: #0f766e;
            --accent-dark: #115e59;
          }
          * {
            box-sizing: border-box;
          }
          body {
            margin: 0;
            min-height: 100vh;
            background: var(--bg);
            color: var(--text);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            line-height: 1.6;
          }
          main {
            width: min(720px, calc(100% - 32px));
            margin: 0 auto;
            padding: 64px 0;
          }
          .panel {
            background: var(--panel);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 28px;
          }
          h1 {
            margin: 0 0 12px;
            font-size: 28px;
            line-height: 1.25;
          }
          .lead {
            color: var(--muted);
            margin: 0 0 24px;
          }
          label {
            display: block;
            font-weight: 700;
            margin-bottom: 8px;
          }
          .field {
            display: flex;
            gap: 10px;
          }
          input {
            flex: 1 1 auto;
            min-width: 0;
            border: 1px solid var(--border);
            border-radius: 6px;
            color: var(--text);
            font: inherit;
            padding: 11px 12px;
          }
          textarea {
            border: 1px solid var(--border);
            border-radius: 6px;
            color: var(--text);
            font: inherit;
            min-height: 72px;
            padding: 10px 12px;
            resize: vertical;
            width: 100%;
          }
          button {
            flex: 0 0 auto;
            border: 0;
            border-radius: 6px;
            background: var(--accent);
            color: #ffffff;
            cursor: pointer;
            font: inherit;
            font-weight: 700;
            padding: 11px 18px;
          }
          button:hover {
            background: var(--accent-dark);
          }
          button.secondary {
            background: #475569;
          }
          button.secondary:hover {
            background: #334155;
          }
          a {
            color: var(--accent);
          }
          .note {
            color: var(--muted);
            font-size: 14px;
            margin: 16px 0 0;
          }
          .review-list {
            display: grid;
            gap: 16px;
          }
          .review-card {
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 16px;
          }
          .review-card form {
            display: grid;
            gap: 12px;
            margin-top: 12px;
          }
          .review-card label {
            display: grid;
            gap: 6px;
          }
          .review-meta {
            align-items: center;
            color: var(--muted);
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            font-size: 13px;
          }
          .review-actions {
            align-items: center;
            display: flex;
            gap: 10px;
          }
          .review-actions input {
            flex: 1 1 auto;
          }
          @media (max-width: 560px) {
            main {
              padding: 32px 0;
            }
            .panel {
              padding: 22px;
            }
            .field {
              flex-direction: column;
            }
            button {
              width: 100%;
            }
            .review-actions {
              align-items: stretch;
              flex-direction: column;
            }
          }
        </style>
      </head>
      <body>
        <main>
          <section class="panel">
            <h1>${escapeHtml(title)}</h1>
            ${body}
          </section>
        </main>
      </body>
    </html>
  `;
}

function mergeCandidatePayload(
  original: ReviewCandidatePayload,
  updates: ReviewCandidatePayload
): ReviewCandidatePayload {
  return {
    ...original,
    name: updates.name.trim(),
    institute: updates.institute.trim(),
    description: updates.description.trim() || original.description,
    deadline: normalizeBaoyanXinxiDeadline(updates.deadline.trim()),
    website: updates.website.trim()
  };
}

function toNullableString(value: FormDataEntryValue | null): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" ? null : text;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readClassificationFeedback(
  value: unknown,
  now: string
): ClassificationFeedback | null {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const normalizedUrl = canonicalizeNotificationUrl(
    readString(record.normalizedUrl) || readString(record.website)
  );
  const classificationKind = readString(record.classificationKind) as ClassificationKind;
  const modelValue = readString(record.modelValue).trim();
  const correctedValue = readString(record.correctedValue).trim();
  const reason = readString(record.reason).trim();
  const source = readString(record.source) as ClassificationFeedbackSource;
  const classifier = readString(record.classifier).trim() || "luna-high-feedback";
  const createdAt = readString(record.createdAt).trim() || now;

  if (
    normalizedUrl === "" ||
    !isValidClassificationKind(classificationKind) ||
    !isValidFeedbackValue(classificationKind, modelValue) ||
    !isValidFeedbackValue(classificationKind, correctedValue) ||
    !isValidFeedbackSource(source) ||
    reason === "" ||
    reason.length > 500 ||
    classifier.length > 64 ||
    Number.isNaN(new Date(createdAt).getTime())
  ) {
    return null;
  }
  return {
    normalizedUrl,
    classificationKind,
    modelValue,
    correctedValue,
    reason,
    source,
    classifier,
    createdAt
  };
}

function readRelevanceClassification(
  value: unknown,
  now: string
): ItemRelevanceClassification | null {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const normalizedUrl = canonicalizeNotificationUrl(
    readString(record.normalizedUrl) || readString(record.website)
  );
  const relevance = readString(record.relevance);
  const areas = Array.isArray(record.areas)
    ? record.areas.filter((area): area is string => typeof area === "string")
    : [];
  const reason = readString(record.reason).trim();
  const classifier = readString(record.classifier).trim() || "codex-ai";
  const classifiedAt = readString(record.classifiedAt).trim() || now;

  if (
    normalizedUrl === "" ||
    !isValidRelevance(relevance) ||
    !areValidAreas(areas) ||
    reason === "" ||
    reason.length > 500 ||
    classifier.length > 64 ||
    Number.isNaN(new Date(classifiedAt).getTime())
  ) {
    return null;
  }

  return {
    normalizedUrl,
    relevance,
    areas: dedupeAreas(areas),
    reason,
    classifier,
    classifiedAt
  };
}

function readActivityTypeClassification(
  value: unknown,
  now: string
): ItemActivityTypeClassification | null {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const normalizedUrl = canonicalizeNotificationUrl(
    readString(record.normalizedUrl) || readString(record.website)
  );
  const activityType = readString(record.activityType);
  const reason = readString(record.reason).trim();
  const classifier = readString(record.classifier).trim() || "codex-official-title";
  const classifiedAt = readString(record.classifiedAt).trim() || now;

  if (
    normalizedUrl === "" ||
    !isValidActivityType(activityType) ||
    reason === "" ||
    reason.length > 500 ||
    classifier.length > 64 ||
    Number.isNaN(new Date(classifiedAt).getTime())
  ) {
    return null;
  }

  return {
    normalizedUrl,
    activityType,
    reason,
    classifier,
    classifiedAt
  };
}

function readOfficialItemVerification(
  value: unknown,
  now: string
): OfficialItemVerification | null {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const itemKey = readString(record.itemKey).trim() || readString(record.key).trim();
  const normalizedUrl = canonicalizeNotificationUrl(
    readString(record.normalizedUrl) || readString(record.website)
  );
  const title = readString(record.title).trim();
  const rawDeadline = readString(record.deadline).trim();
  const deadline = normalizeBaoyanXinxiDeadline(rawDeadline);
  const requestedPrecision = readString(record.deadlinePrecision).trim();
  const deadlinePrecision = isValidDeadlinePrecision(requestedPrecision)
    ? requestedPrecision
    : inferVerificationDeadlinePrecision(rawDeadline, deadline);
  const reason = readString(record.reason).trim();
  const verifier = readString(record.verifier).trim() || "luna-high";
  const verifiedAt = readString(record.verifiedAt).trim() || now;

  if (
    itemKey === "" ||
    itemKey.length > 128 ||
    normalizedUrl === "" ||
    title.length > 500 ||
    reason === "" ||
    reason.length > 500 ||
    verifier.length > 64 ||
    (deadline !== "" && Number.isNaN(new Date(deadline).getTime())) ||
    Number.isNaN(new Date(verifiedAt).getTime())
  ) {
    return null;
  }
  return {
    itemKey,
    normalizedUrl,
    title,
    deadline,
    deadlinePrecision,
    reason,
    verifier,
    verifiedAt
  };
}

function readExternalSourceSyncRun(value: unknown): ExternalSourceSyncRun | null {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const runId = readString(record.runId).trim();
  const expectedCount = readInteger(record.expectedCount);
  const reviewCandidateCount = readInteger(record.reviewCandidateCount);
  const sourceStats = readExternalSourceStats(record.sourceStats);
  const activityTypeCounts = readActivityTypeCounts(record.activityTypeCounts);
  const runDate = new Date(runId);
  const now = Date.now();
  if (
    runId === "" ||
    Number.isNaN(runDate.getTime()) ||
    Math.abs(now - runDate.getTime()) > 24 * 60 * 60 * 1000 ||
    expectedCount === null ||
    expectedCount <= 0 ||
    expectedCount > 10_000 ||
    reviewCandidateCount === null ||
    reviewCandidateCount < 0 ||
    reviewCandidateCount > 10_000 ||
    sourceStats === null ||
    activityTypeCounts === null ||
    Object.values(activityTypeCounts).reduce((sum, count) => sum + count, 0) !== expectedCount
  ) {
    return null;
  }
  return {
    runId: runDate.toISOString(),
    expectedCount,
    reviewCandidateCount,
    sourceStats,
    activityTypeCounts
  };
}

function readExternalSourceStats(value: unknown): SourceStats[] | null {
  if (!Array.isArray(value) || value.length < 3 || value.length > 10) {
    return null;
  }
  const allowedGroups = new Set<string>(AUTOMATIC_SOURCE_GROUPS);
  const results: SourceStats[] = [];
  const seenGroups = new Set<string>();
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") {
      return null;
    }
    const record = entry as Record<string, unknown>;
    const sourceGroup = readString(record.sourceGroup).trim();
    const url = readString(record.url).trim();
    const rawCount = readInteger(record.rawCount);
    const acceptedCount = readInteger(record.acceptedCount);
    const filteredCount = readInteger(record.filteredCount);
    const duplicateCount = readInteger(record.duplicateCount);
    const supplementedDeadlineCount = readInteger(record.supplementedDeadlineCount);
    if (
      !allowedGroups.has(sourceGroup) ||
      seenGroups.has(sourceGroup) ||
      canonicalizeNotificationUrl(url) === "" ||
      rawCount === null ||
      rawCount <= 0 ||
      acceptedCount === null ||
      acceptedCount <= 0 ||
      filteredCount === null ||
      filteredCount < 0 ||
      duplicateCount === null ||
      duplicateCount < 0 ||
      supplementedDeadlineCount === null ||
      supplementedDeadlineCount < 0 ||
      readString(record.error).trim() !== ""
    ) {
      return null;
    }
    seenGroups.add(sourceGroup);
    results.push(entry as SourceStats);
  }
  return results;
}

function readActivityTypeCounts(value: unknown): Record<ActivityType, number> | null {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const summerCamp = readInteger(record.summer_camp);
  const preRecommendation = readInteger(record.pre_recommendation);
  const unknown = readInteger(record.unknown);
  if (
    summerCamp === null ||
    summerCamp < 0 ||
    preRecommendation === null ||
    preRecommendation < 0 ||
    unknown === null ||
    unknown < 0
  ) {
    return null;
  }
  return {
    summer_camp: summerCamp,
    pre_recommendation: preRecommendation,
    unknown
  };
}

function readExternalSourceSyncItem(value: unknown): NormalizedItem | null {
  if (value === null || typeof value !== "object" || JSON.stringify(value).length > 200_000) {
    return null;
  }
  const item = value as Partial<NormalizedItem>;
  const allowedGroups = new Set<string>(AUTOMATIC_SOURCE_GROUPS);
  const sourceGroups = Array.isArray(item.sourceGroups) ? item.sourceGroups : [];
  if (
    typeof item.key !== "string" ||
    !/^[a-zA-Z0-9_-]{1,200}$/u.test(item.key) ||
    typeof item.contentHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(item.contentHash) ||
    typeof item.sourceGroup !== "string" ||
    !allowedGroups.has(item.sourceGroup) ||
    sourceGroups.length === 0 ||
    sourceGroups.some(
      (sourceGroup) => typeof sourceGroup !== "string" || !allowedGroups.has(sourceGroup)
    ) ||
    typeof item.name !== "string" ||
    item.name.trim() === "" ||
    item.name.length > 300 ||
    typeof item.institute !== "string" ||
    item.institute.length > 500 ||
    typeof item.description !== "string" ||
    item.description.length > 2_000 ||
    typeof item.deadline !== "string" ||
    (item.deadline !== "" && Number.isNaN(new Date(item.deadline).getTime())) ||
    typeof item.website !== "string" ||
    canonicalizeNotificationUrl(item.website) === "" ||
    !Array.isArray(item.tags) ||
    item.tags.some((tag) => typeof tag !== "string") ||
    !Array.isArray(item.sourceObservations) ||
    item.sourceObservations.length > 100 ||
    !Array.isArray(item.alternateWebsites) ||
    item.alternateWebsites.some((website) => typeof website !== "string")
  ) {
    return null;
  }
  return item as NormalizedItem;
}

function readExternalSourceReviewCandidate(
  value: unknown
): SourceReviewCandidateInput | null {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const normalizedUrl = canonicalizeNotificationUrl(readString(record.normalizedUrl));
  const sourceGroup = readString(record.sourceGroup).trim();
  const reason = readString(record.reason).trim();
  const payload = record.payload;
  if (
    normalizedUrl === "" ||
    sourceGroup !== "multi-source-merge" ||
    !/^(deadline-conflict|title-match)$/u.test(reason) ||
    payload === null ||
    typeof payload !== "object"
  ) {
    return null;
  }
  const payloadRecord = payload as Record<string, unknown>;
  const name = readString(payloadRecord.name).trim();
  const institute = readString(payloadRecord.institute).trim();
  const description = readString(payloadRecord.description).trim();
  const deadline = readString(payloadRecord.deadline).trim();
  const website = readString(payloadRecord.website).trim();
  const note = readString(payloadRecord.note).trim();
  if (
    name === "" ||
    name.length > 300 ||
    institute.length > 500 ||
    description.length > 2_000 ||
    (deadline !== "" && Number.isNaN(new Date(deadline).getTime())) ||
    canonicalizeNotificationUrl(website) === "" ||
    note.length > 2_000
  ) {
    return null;
  }
  return {
    normalizedUrl,
    sourceGroup,
    reason,
    payload: {
      sourceGroup,
      name,
      institute,
      description,
      deadline,
      website,
      note
    }
  };
}

async function getActiveExternalSourceSyncRun(
  env: Env,
  runId: string
): Promise<ExternalSourceSyncRun | null> {
  if (runId === "") {
    return null;
  }
  const rawMetadata = await getAppState(env, EXTERNAL_SYNC_STATE_KEY);
  if (rawMetadata === null || rawMetadata === "") {
    return null;
  }
  try {
    const metadata = readExternalSourceSyncRun(JSON.parse(rawMetadata));
    return metadata?.runId === new Date(runId).toISOString() ? metadata : null;
  } catch {
    return null;
  }
}

function readInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function isValidRelevance(value: string): value is Relevance {
  return value === "strong" || value === "possible" || value === "unrelated";
}

function isValidActivityType(value: string): value is ActivityType {
  return value === "summer_camp" || value === "pre_recommendation" || value === "unknown";
}

function isValidClassificationKind(value: string): value is ClassificationKind {
  return value === "relevance" || value === "activity_type";
}

function isValidFeedbackSource(value: string): value is ClassificationFeedbackSource {
  return value === "model" || value === "rule_guard" || value === "manual";
}

function isValidFeedbackValue(kind: ClassificationKind, value: string): boolean {
  return kind === "relevance" ? isValidRelevance(value) : isValidActivityType(value);
}

function isValidDeadlinePrecision(value: string): value is DeadlinePrecision {
  return value === "exact" || value === "date" || value === "unknown";
}

function inferVerificationDeadlinePrecision(
  rawDeadline: string,
  deadline: string
): DeadlinePrecision {
  if (deadline === "") {
    return "unknown";
  }
  return /^\d{4}-\d{1,2}-\d{1,2}$/u.test(rawDeadline) ? "date" : "exact";
}

function areValidAreas(areas: string[]): boolean {
  return areas.length > 0 && areas.every((area) => BAOYAN_AREA_OPTIONS.includes(area as never));
}

function dedupeAreas(areas: string[]): string[] {
  return BAOYAN_AREA_OPTIONS.filter((area) => areas.includes(area));
}

function formatReviewTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
