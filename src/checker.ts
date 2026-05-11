import {
  countActiveSubscribers,
  getActiveSubscribers,
  getPendingNotifications,
  getSnapshotCount,
  getSnapshots,
  insertNotifications,
  logMailSend,
  markNotificationsSent,
  upsertSnapshots
} from "./db";
import { sendSummaryEmails } from "./email";
import { fetchSourceItems } from "./source";
import type { Env, NormalizedItem, RunCheckResult } from "./types";

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_ITEMS_PER_EMAIL = 30;

export async function runCheck(env: Env, baseUrl?: string): Promise<RunCheckResult> {
  const now = new Date().toISOString();
  const items = await fetchSourceItems(env);
  const snapshotCount = await getSnapshotCount(env);

  if (snapshotCount === 0) {
    await upsertSnapshots(env, items, now);
    return {
      initialized: true,
      scanned: items.length,
      detected: 0,
      pendingSent: 0,
      subscriberCount: 0
    };
  }

  const snapshots = await getSnapshots(env);
  const detected = detectChanges(items, snapshots);
  if (detected.length > 0) {
    await insertNotifications(env, detected, now);
    await upsertSnapshots(env, items, now);
  }

  const sendResult = await sendPendingNotifications(env, baseUrl, now);
  return {
    initialized: false,
    scanned: items.length,
    detected: detected.length,
    pendingSent: sendResult.pendingSent,
    subscriberCount: sendResult.subscriberCount
  };
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

async function sendPendingNotifications(
  env: Env,
  baseUrl: string | undefined,
  now: string
): Promise<{ pendingSent: number; subscriberCount: number }> {
  const itemsPerEmail = readPositiveInteger(env.ITEMS_PER_EMAIL, DEFAULT_ITEMS_PER_EMAIL);
  const pending = await getPendingNotifications(env, itemsPerEmail);
  if (pending.length === 0) {
    return { pendingSent: 0, subscriberCount: await countActiveSubscribers(env) };
  }

  const subscriberCount = await countActiveSubscribers(env);
  const notificationIds = pending.map((entry) => entry.id);
  if (subscriberCount === 0) {
    await markNotificationsSent(env, notificationIds, now);
    await logMailSend(env, notificationIds, 0, "skipped", null, "没有 active 订阅者", now);
    return { pendingSent: pending.length, subscriberCount };
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
      const result = await sendSummaryEmails(env, subscribers, pending, resolvedBaseUrl, chunkIndex);
      await logMailSend(
        env,
        notificationIds,
        subscribers.length,
        "sent",
        result.messageId,
        null,
        now
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await logMailSend(env, notificationIds, subscribers.length, "failed", null, message, now);
      throw error;
    }
    offset += subscribers.length;
    chunkIndex += 1;
  }

  await markNotificationsSent(env, notificationIds, now);
  return { pendingSent: pending.length, subscriberCount };
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
