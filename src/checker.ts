import {
  countActiveSubscribers,
  getActiveSubscribers,
  getAppState,
  getManualItems,
  getPendingNewDeadlineNotifications,
  getSnapshotCount,
  getSnapshotRows,
  getSnapshots,
  getUnmissingSnapshotRefs,
  insertNewDeadlineNotifications,
  logMailSend,
  markSnapshotsMissing,
  markNewDeadlineNotificationsSent,
  setAppState,
  upsertReviewCandidates,
  upsertSnapshots
} from "./db";
import {
  sendDailyDeadlineDigestEmails,
  sendNewDeadlineNotificationEmails
} from "./email";
import {
  BAOYANXINXI_SOURCE_GROUP,
  canonicalizeNotificationUrl,
  fetchSourceItemsWithStats,
  getBaoyanXinxiAreas
} from "./source";
import type { Env, NormalizedItem, RunCheckResult, SourceStats } from "./types";

const DEFAULT_BATCH_SIZE = 50;
const DAILY_DEADLINE_DIGEST_DAYS = 15;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SHANGHAI_TIME_ZONE = "Asia/Shanghai";
const UNKNOWN_DEADLINE_VALUES = new Set(["", "暂无", "待定", "无明确说明"]);
const DAILY_DEADLINE_DIGEST_STATE_KEY = "daily_deadline_digest_sent_date";
const LAST_SYNC_STATE_KEY = "last_synced_at";
const STALE_GRACE_HOURS = 48;
const STALE_GRACE_MS = STALE_GRACE_HOURS * 60 * 60 * 1000;
const SHANGHAI_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: SHANGHAI_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export interface DeadlineReminderCandidate {
  item: NormalizedItem;
  deadlineAt: string;
  reminderWindowDays: number;
}

export interface RunCheckOptions {
  sendEmails?: boolean;
}

export async function runCheck(
  env: Env,
  baseUrl?: string,
  options: RunCheckOptions = {}
): Promise<RunCheckResult> {
  const sendEmails = options.sendEmails ?? true;
  const now = new Date().toISOString();
  const nowDate = new Date(now);
  const today = formatShanghaiDate(nowDate);
  const sourceResult = await fetchSourceItemsWithStats(env);
  const manualItems = await getManualItems(env);
  const items = [...sourceResult.items, ...manualItems];
  const sourceStats = sourceResult.stats.map((stats) => ({ ...stats }));
  await upsertReviewCandidates(env, sourceResult.reviewCandidates, now);
  const snapshotCount = await getSnapshotCount(env);
  const snapshots = snapshotCount === 0 ? new Map() : await getSnapshots(env);
  let initialized = false;
  let newDeadlineItems: NormalizedItem[] = [];
  let addedCount = 0;
  let changedCount = 0;
  let missingCount = 0;

  if (snapshotCount === 0) {
    await upsertSnapshots(env, items, now);
    initialized = true;
    addedCount = items.length;
  } else {
    const detected = detectChanges(items, snapshots);
    addedCount = detected.filter((change) => change.kind === "added").length;
    changedCount = detected.filter((change) => change.kind === "changed").length;
    if (sendEmails) {
      newDeadlineItems = detected
        .filter((change) => change.kind === "added")
        .filter((change) => !hasEquivalentSnapshot(change.item, snapshots))
        .map((change) => change.item);
    }
    await upsertSnapshots(env, items, now);
    missingCount = await markMissingForSuccessfulSources(env, items, sourceStats, now);
  }

  await setAppState(env, LAST_SYNC_STATE_KEY, now, now);
  const dailyDeadlineDigest = collectDailyDeadlineDigestItems(
    getEmailRelevantItems(items),
    DAILY_DEADLINE_DIGEST_DAYS,
    nowDate
  );
  const dailyDeadlineResult = sendEmails
    ? await sendDailyDeadlineDigestIfNeeded(env, baseUrl, dailyDeadlineDigest, today, now, nowDate)
    : { sent: 0, subscriberCount: 0 };
  const newDeadlineCandidates = sendEmails
    ? collectNewDeadlineNotificationCandidates(getEmailRelevantItems(newDeadlineItems), nowDate)
    : [];
  const newDeadlineDetected =
    newDeadlineCandidates.length === 0
      ? 0
      : await insertNewDeadlineNotifications(env, newDeadlineCandidates, now);
  const newDeadlineSendResult = sendEmails
    ? await sendPendingNewDeadlineNotifications(env, baseUrl, now, nowDate)
    : { sent: 0, subscriberCount: 0 };
  const staleCounts = countStaleSnapshotRows(await getSnapshotRows(env), nowDate);
  return {
    initialized,
    scanned: items.length,
    detected: 0,
    pendingSent: 0,
    deadlineDetected: 0,
    deadlinePendingSent: 0,
    dailyDeadlineDetected: dailyDeadlineDigest.length,
    dailyDeadlineSent: dailyDeadlineResult.sent,
    newDeadlineDetected,
    newDeadlineSent: newDeadlineSendResult.sent,
    subscriberCount: Math.max(
      dailyDeadlineResult.subscriberCount,
      newDeadlineSendResult.subscriberCount
    ),
    addedCount,
    changedCount,
    missingCount,
    staleVisibleCount: staleCounts.visible,
    staleHiddenCount: staleCounts.hidden,
    lastSyncedAt: now,
    sourceStats
  };
}

function getEmailRelevantItems(items: NormalizedItem[]): NormalizedItem[] {
  return items.filter((item) => {
    const areas = item.areas ?? getBaoyanXinxiAreas(item.name, item.institute);
    return areas.some((area) => area !== "其他");
  });
}

async function markMissingForSuccessfulSources(
  env: Env,
  items: NormalizedItem[],
  sourceStats: SourceStats[],
  now: string
): Promise<number> {
  const seenKeys = new Set(items.map((item) => item.key));
  const baoyanXinxiStat = sourceStats.find(
    (stats) => stats.sourceGroup === BAOYANXINXI_SOURCE_GROUP
  );
  const canMarkBaoyanXinxi =
    baoyanXinxiStat?.error === undefined && (baoyanXinxiStat?.rawCount ?? 0) > 0;
  const refs = await getUnmissingSnapshotRefs(env);
  const missingKeys = refs
    .filter((ref) => !seenKeys.has(ref.item_key))
    .filter((ref) => shouldMarkSourceGroupMissing(ref.source_group, canMarkBaoyanXinxi))
    .map((ref) => ref.item_key);
  return markSnapshotsMissing(env, missingKeys, now);
}

function shouldMarkSourceGroupMissing(sourceGroup: string, canMarkBaoyanXinxi: boolean): boolean {
  if (sourceGroup === "manual") {
    return false;
  }
  if (sourceGroup === BAOYANXINXI_SOURCE_GROUP) {
    return canMarkBaoyanXinxi;
  }
  return true;
}

function countStaleSnapshotRows(
  rows: Array<{ payload: string; missing_since: string | null }>,
  now: Date
): { visible: number; hidden: number } {
  let visible = 0;
  let hidden = 0;
  for (const row of rows) {
    if (row.missing_since === null) {
      continue;
    }
    const item = JSON.parse(row.payload) as NormalizedItem;
    const deadline = parseDeadline(item.deadline);
    if (deadline === null || deadline.getTime() <= now.getTime()) {
      continue;
    }
    const missingSince = new Date(row.missing_since);
    if (!Number.isNaN(missingSince.getTime()) && now.getTime() - missingSince.getTime() <= STALE_GRACE_MS) {
      visible += 1;
    } else {
      hidden += 1;
    }
  }
  return { visible, hidden };
}

export function detectChanges(
  items: NormalizedItem[],
  snapshots: Map<string, { content_hash: string }>
): Array<{ item: NormalizedItem; kind: "added" | "changed" }> {
  const changes: Array<{ item: NormalizedItem; kind: "added" | "changed" }> = [];
  for (const item of items) {
    const snapshot = snapshots.get(item.key);
    if (snapshot === undefined) {
      changes.push({ item, kind: "added" });
      continue;
    }
    if (snapshot.content_hash !== item.contentHash) {
      changes.push({ item, kind: "changed" });
    }
  }
  return changes;
}

function hasEquivalentSnapshot(
  item: NormalizedItem,
  snapshots: Map<string, { content_hash: string; payload?: string }>
): boolean {
  const targetUrl = canonicalizeNotificationUrl(item.website);
  if (targetUrl === "") {
    return false;
  }

  for (const [snapshotKey, snapshot] of snapshots.entries()) {
    if (snapshotKey === item.key || snapshot.payload === undefined) {
      continue;
    }
    try {
      const existing = JSON.parse(snapshot.payload) as NormalizedItem;
      if (canonicalizeNotificationUrl(existing.website) === targetUrl) {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

export function collectDailyDeadlineDigestItems(
  items: NormalizedItem[],
  days: number,
  now: Date
): DeadlineReminderCandidate[] {
  const reminders: DeadlineReminderCandidate[] = [];

  for (const item of items) {
    const deadline = parseDeadline(item.deadline);
    if (deadline === null || deadline.getTime() <= now.getTime()) {
      continue;
    }

    const daysUntil = getShanghaiCalendarDaysUntil(now, deadline);
    if (daysUntil > days) {
      continue;
    }

    reminders.push({
      item,
      deadlineAt: deadline.toISOString(),
      reminderWindowDays: selectDailyDigestBucket(daysUntil)
    });
  }

  return reminders.sort((left, right) => {
    const deadlineCompare = left.deadlineAt.localeCompare(right.deadlineAt);
    if (deadlineCompare !== 0) {
      return deadlineCompare;
    }
    return left.item.name.localeCompare(right.item.name);
  });
}

export function collectNewDeadlineNotificationCandidates(
  items: NormalizedItem[],
  now: Date
): Array<{ item: NormalizedItem; deadlineAt: string }> {
  return items
    .map((item) => {
      const deadline = parseDeadline(item.deadline);
      if (deadline === null || deadline.getTime() <= now.getTime()) {
        return null;
      }
      return { item, deadlineAt: deadline.toISOString() };
    })
    .filter((entry): entry is { item: NormalizedItem; deadlineAt: string } => entry !== null)
    .sort((left, right) => {
      const deadlineCompare = left.deadlineAt.localeCompare(right.deadlineAt);
      if (deadlineCompare !== 0) {
        return deadlineCompare;
      }
      return left.item.name.localeCompare(right.item.name);
    });
}

export function parseDeadline(value: string): Date | null {
  const trimmed = value.trim();
  if (UNKNOWN_DEADLINE_VALUES.has(trimmed)) {
    return null;
  }

  const candidates = [trimmed, normalizeDeadlineString(trimmed)];
  for (const candidate of candidates) {
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  return null;
}

async function sendDailyDeadlineDigestIfNeeded(
  env: Env,
  baseUrl: string | undefined,
  items: DeadlineReminderCandidate[],
  today: string,
  now: string,
  nowDate: Date
): Promise<{ sent: number; subscriberCount: number }> {
  const subscriberCount = await countActiveSubscribers(env);
  if (items.length === 0) {
    return { sent: 0, subscriberCount };
  }

  const lastSentDate = await getAppState(env, DAILY_DEADLINE_DIGEST_STATE_KEY);
  if (lastSentDate === today) {
    return { sent: 0, subscriberCount };
  }

  const syntheticRows = items.map((item, index) => ({
    id: index + 1,
    item_key: item.item.key,
    deadline_at: item.deadlineAt,
    reminder_window_days: item.reminderWindowDays,
    payload: "",
    created_at: now,
    sent_at: null,
    item: item.item
  }));

  const mailLogIds = syntheticRows.map((row) => row.id);
  if (subscriberCount === 0) {
    await setAppState(env, DAILY_DEADLINE_DIGEST_STATE_KEY, today, now);
    await logMailSend(env, mailLogIds, 0, "skipped", null, "没有 active 订阅者", now);
    return { sent: items.length, subscriberCount };
  }

  const resolvedBaseUrl = resolveBaseUrl(env, baseUrl);
  const batchSize = readPositiveInteger(env.BATCH_SIZE, DEFAULT_BATCH_SIZE);
  let offset = 0;
  let chunkIndex = 0;
  while (offset < subscriberCount) {
    const subscribers = await getActiveSubscribers(env, batchSize, offset);
    if (subscribers.length === 0) {
      break;
    }
    try {
      const result = await sendDailyDeadlineDigestEmails(
        env,
        subscribers,
        syntheticRows,
        resolvedBaseUrl,
        chunkIndex,
        nowDate
      );
      await logMailSend(env, mailLogIds, subscribers.length, "sent", result.messageId, null, now);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await logMailSend(env, mailLogIds, subscribers.length, "failed", null, message, now);
      throw error;
    }
    offset += subscribers.length;
    chunkIndex += 1;
  }

  await setAppState(env, DAILY_DEADLINE_DIGEST_STATE_KEY, today, now);
  return { sent: items.length, subscriberCount };
}

async function sendPendingNewDeadlineNotifications(
  env: Env,
  baseUrl: string | undefined,
  now: string,
  nowDate: Date
): Promise<{ sent: number; subscriberCount: number }> {
  const pending = await getPendingNewDeadlineNotifications(env, now);
  const subscriberCount = await countActiveSubscribers(env);
  if (pending.length === 0) {
    return { sent: 0, subscriberCount };
  }

  const ids = pending.map((entry) => entry.id);
  if (subscriberCount === 0) {
    await markNewDeadlineNotificationsSent(env, ids, now);
    await logMailSend(env, ids, 0, "skipped", null, "没有 active 订阅者", now);
    return { sent: pending.length, subscriberCount };
  }

  const resolvedBaseUrl = resolveBaseUrl(env, baseUrl);
  const batchSize = readPositiveInteger(env.BATCH_SIZE, DEFAULT_BATCH_SIZE);
  let offset = 0;
  let chunkIndex = 0;
  while (offset < subscriberCount) {
    const subscribers = await getActiveSubscribers(env, batchSize, offset);
    if (subscribers.length === 0) {
      break;
    }
    try {
      const result = await sendNewDeadlineNotificationEmails(
        env,
        subscribers,
        pending,
        resolvedBaseUrl,
        chunkIndex,
        nowDate
      );
      await logMailSend(env, ids, subscribers.length, "sent", result.messageId, null, now);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await logMailSend(env, ids, subscribers.length, "failed", null, message, now);
      throw error;
    }
    offset += subscribers.length;
    chunkIndex += 1;
  }

  await markNewDeadlineNotificationsSent(env, ids, now);
  return { sent: pending.length, subscriberCount };
}

function resolveBaseUrl(env: Env, baseUrl: string | undefined): string {
  const resolved = baseUrl ?? env.APP_BASE_URL;
  if (resolved === undefined || resolved.trim() === "") {
    throw new Error("缺少 APP_BASE_URL，无法生成退订链接");
  }
  return resolved.replace(/\/+$/, "");
}

function readPositiveInteger(value: string | undefined, defaultValue: number): number {
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultValue;
  }
  return parsed;
}

function selectDailyDigestBucket(daysUntil: number): number {
  if (daysUntil <= 1) {
    return 1;
  }
  if (daysUntil <= 3) {
    return 3;
  }
  if (daysUntil <= 7) {
    return 7;
  }
  return 15;
}

function normalizeDeadlineString(value: string): string {
  let normalized = value.trim();
  normalized = normalized.replace(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(.*)$/,
    (_match, year: string, month: string, day: string, rest: string) =>
      `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}${rest}`
  );
  normalized = normalized.replace(
    /([+-])(\d{1,2}):(\d{2})$/,
    (_match, sign: string, hour: string, minute: string) =>
      `${sign}${hour.padStart(2, "0")}:${minute}`
  );
  return normalized.replace(/T(\d{2}:\d{2}:\d{2}):00([+-]\d{2}:\d{2})$/, "T$1$2");
}

function getShanghaiCalendarDaysUntil(now: Date, deadline: Date): number {
  return (
    toUtcDayNumber(getShanghaiDateParts(deadline)) - toUtcDayNumber(getShanghaiDateParts(now))
  );
}

function formatShanghaiDate(date: Date): string {
  return SHANGHAI_DATE_FORMATTER.format(date);
}

function getShanghaiDateParts(date: Date): { year: number; month: number; day: number } {
  const parts = SHANGHAI_DATE_FORMATTER.formatToParts(date);
  const year = readDatePart(parts, "year");
  const month = readDatePart(parts, "month");
  const day = readDatePart(parts, "day");
  return { year, month, day };
}

function readDatePart(parts: Intl.DateTimeFormatPart[], type: string): number {
  const value = parts.find((part) => part.type === type)?.value;
  return value === undefined ? 0 : Number.parseInt(value, 10);
}

function toUtcDayNumber(parts: { year: number; month: number; day: number }): number {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / MS_PER_DAY);
}
