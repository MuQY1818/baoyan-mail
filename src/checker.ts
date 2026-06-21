import {
  countActiveSubscribers,
  getActiveSubscribers,
  getAppState,
  getPendingNewDeadlineNotifications,
  getSnapshotCount,
  getSnapshots,
  insertNewDeadlineNotifications,
  logMailSend,
  markNewDeadlineNotificationsSent,
  setAppState,
  upsertSnapshots
} from "./db";
import {
  sendDailyDeadlineDigestEmails,
  sendNewDeadlineNotificationEmails
} from "./email";
import {
  BAOYANXINXI_SOURCE_GROUP,
  fetchSourceItemsWithStats
} from "./source";
import type { Env, NormalizedItem, RunCheckResult, SourceStats } from "./types";

const DEFAULT_BATCH_SIZE = 50;
const DAILY_DEADLINE_DIGEST_DAYS = 15;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SHANGHAI_TIME_ZONE = "Asia/Shanghai";
const UNKNOWN_DEADLINE_VALUES = new Set(["", "暂无", "待定", "无明确说明"]);
const BAOYANXINXI_INIT_STATE_KEY = BAOYANXINXI_SOURCE_GROUP;
const DAILY_DEADLINE_DIGEST_STATE_KEY = "daily_deadline_digest_sent_date";
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

export async function runCheck(env: Env, baseUrl?: string): Promise<RunCheckResult> {
  const now = new Date().toISOString();
  const nowDate = new Date(now);
  const today = formatShanghaiDate(nowDate);
  const sourceResult = await fetchSourceItemsWithStats(env);
  const items = sourceResult.items;
  const sourceStats = sourceResult.stats.map((stats) => ({ ...stats }));
  const snapshotCount = await getSnapshotCount(env);
  const snapshots = snapshotCount === 0 ? new Map() : await getSnapshots(env);
  const baoyanXinxiState = await getAppState(env, BAOYANXINXI_INIT_STATE_KEY);
  const baoyanXinxiStat = sourceStats.find(
    (stats) => stats.sourceGroup === BAOYANXINXI_SOURCE_GROUP
  );
  const canInitializeBaoyanXinxi =
    baoyanXinxiStat?.error === undefined && (baoyanXinxiStat?.rawCount ?? 0) > 0;
  const shouldInitializeBaoyanXinxi =
    snapshotCount > 0 &&
    baoyanXinxiState === null &&
    canInitializeBaoyanXinxi;
  let initialized = false;
  let baoyanXinxiInitializedThisRun = false;
  let newDeadlineItems: NormalizedItem[] = [];
  const baoyanXinxiSupplementedKeys = new Set(sourceResult.baoyanXinxiSupplementedItemKeys);

  if (snapshotCount === 0) {
    await upsertSnapshots(env, items, now);
    initialized = true;
    if (canInitializeBaoyanXinxi) {
      await setAppState(env, BAOYANXINXI_INIT_STATE_KEY, now, now);
      baoyanXinxiInitializedThisRun = true;
    }
  } else {
    const itemsForChangeDetection = shouldInitializeBaoyanXinxi
      ? items.filter(
          (item) =>
            item.sourceGroup !== BAOYANXINXI_SOURCE_GROUP &&
            !baoyanXinxiSupplementedKeys.has(item.key)
        )
      : items;

    if (shouldInitializeBaoyanXinxi) {
      const baoyanXinxiInitializedItems = items.filter(
        (item) =>
          item.sourceGroup === BAOYANXINXI_SOURCE_GROUP || baoyanXinxiSupplementedKeys.has(item.key)
      );
      await upsertSnapshots(env, baoyanXinxiInitializedItems, now);
      await setAppState(env, BAOYANXINXI_INIT_STATE_KEY, now, now);
      baoyanXinxiInitializedThisRun = true;
    }

    const detected = detectChanges(itemsForChangeDetection, snapshots);
    newDeadlineItems = detected
      .filter((change) => change.kind === "added")
      .map((change) => change.item);
    await upsertSnapshots(env, items, now);
  }

  const dailyDeadlineDigest = collectDailyDeadlineDigestItems(
    items,
    DAILY_DEADLINE_DIGEST_DAYS,
    nowDate
  );
  const dailyDeadlineResult = await sendDailyDeadlineDigestIfNeeded(
    env,
    baseUrl,
    dailyDeadlineDigest,
    today,
    now,
    nowDate
  );
  const newDeadlineCandidates = collectNewDeadlineNotificationCandidates(newDeadlineItems, nowDate);
  const newDeadlineDetected = await insertNewDeadlineNotifications(env, newDeadlineCandidates, now);
  const newDeadlineSendResult = await sendPendingNewDeadlineNotifications(
    env,
    baseUrl,
    now,
    nowDate
  );
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
    sourceStats: annotateSourceStats(
      sourceStats,
      baoyanXinxiState !== null || baoyanXinxiInitializedThisRun,
      baoyanXinxiInitializedThisRun
    )
  };
}

function annotateSourceStats(
  sourceStats: SourceStats[],
  baoyanXinxiInitialized: boolean,
  baoyanXinxiInitializedThisRun: boolean
): SourceStats[] {
  return sourceStats.map((stats) => {
    if (stats.sourceGroup !== BAOYANXINXI_SOURCE_GROUP) {
      return stats;
    }
    return {
      ...stats,
      initialized: baoyanXinxiInitialized,
      initializedThisRun: baoyanXinxiInitializedThisRun
    };
  });
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
