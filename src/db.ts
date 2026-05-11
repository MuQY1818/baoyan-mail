import type {
  Env,
  ItemSnapshotRow,
  NormalizedItem,
  NotificationRow,
  NotificationWithItem,
  SubscriberRow
} from "./types";

const SQL_BATCH_SIZE = 50;

export async function findSubscriberByEmail(env: Env, email: string): Promise<SubscriberRow | null> {
  return env.DB.prepare("SELECT * FROM subscribers WHERE email = ?")
    .bind(email)
    .first<SubscriberRow>();
}

export async function upsertPendingSubscriber(
  env: Env,
  email: string,
  confirmTokenHash: string,
  unsubscribeToken: string,
  now: string
): Promise<void> {
  await env.DB.prepare(
    `
      INSERT INTO subscribers (
        email,
        status,
        confirm_token_hash,
        unsubscribe_token,
        created_at,
        updated_at
      )
      VALUES (?, 'pending', ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        status = CASE
          WHEN status = 'active' THEN status
          ELSE 'pending'
        END,
        confirm_token_hash = CASE
          WHEN status = 'active' THEN confirm_token_hash
          ELSE excluded.confirm_token_hash
        END,
        unsubscribe_token = CASE
          WHEN status = 'active' THEN unsubscribe_token
          ELSE excluded.unsubscribe_token
        END,
        updated_at = excluded.updated_at,
        unsubscribed_at = CASE
          WHEN status = 'active' THEN unsubscribed_at
          ELSE NULL
        END
    `
  )
    .bind(email, confirmTokenHash, unsubscribeToken, now, now)
    .run();
}

export async function confirmSubscriberByToken(
  env: Env,
  confirmTokenHash: string,
  now: string
): Promise<SubscriberRow | null> {
  const subscriber = await env.DB.prepare(
    "SELECT * FROM subscribers WHERE confirm_token_hash = ? AND status = 'pending'"
  )
    .bind(confirmTokenHash)
    .first<SubscriberRow>();
  if (subscriber === null) {
    return null;
  }

  await env.DB.prepare(
    `
      UPDATE subscribers
      SET status = 'active', confirmed_at = ?, updated_at = ?, unsubscribed_at = NULL
      WHERE id = ?
    `
  )
    .bind(now, now, subscriber.id)
    .run();

  return { ...subscriber, status: "active", confirmed_at: now, updated_at: now };
}

export async function unsubscribeByToken(
  env: Env,
  unsubscribeToken: string,
  now: string
): Promise<SubscriberRow | null> {
  const subscriber = await env.DB.prepare(
    "SELECT * FROM subscribers WHERE unsubscribe_token = ?"
  )
    .bind(unsubscribeToken)
    .first<SubscriberRow>();
  if (subscriber === null) {
    return null;
  }

  await env.DB.prepare(
    `
      UPDATE subscribers
      SET status = 'unsubscribed', unsubscribed_at = ?, updated_at = ?
      WHERE id = ?
    `
  )
    .bind(now, now, subscriber.id)
    .run();

  return { ...subscriber, status: "unsubscribed", unsubscribed_at: now, updated_at: now };
}

export async function getActiveSubscribers(
  env: Env,
  limit: number,
  offset: number
): Promise<SubscriberRow[]> {
  const result = await env.DB.prepare(
    "SELECT * FROM subscribers WHERE status = 'active' ORDER BY id ASC LIMIT ? OFFSET ?"
  )
    .bind(limit, offset)
    .all<SubscriberRow>();
  return result.results ?? [];
}

export async function countActiveSubscribers(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM subscribers WHERE status = 'active'"
  ).first<{ count: number }>();
  return row?.count ?? 0;
}

export async function getSnapshotCount(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM item_snapshots").first<{
    count: number;
  }>();
  return row?.count ?? 0;
}

export async function getSnapshots(env: Env): Promise<Map<string, ItemSnapshotRow>> {
  const result = await env.DB.prepare("SELECT * FROM item_snapshots").all<ItemSnapshotRow>();
  const rows = result.results ?? [];
  return new Map(rows.map((row) => [row.item_key, row]));
}

export async function upsertSnapshots(
  env: Env,
  items: NormalizedItem[],
  now: string
): Promise<void> {
  const statements = items.map((item) =>
    env.DB.prepare(
      `
        INSERT INTO item_snapshots (
          item_key,
          content_hash,
          payload,
          source_group,
          first_seen_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(item_key) DO UPDATE SET
          content_hash = excluded.content_hash,
          payload = excluded.payload,
          source_group = excluded.source_group,
          updated_at = excluded.updated_at
      `
    ).bind(item.key, item.contentHash, JSON.stringify(item), item.sourceGroup, now, now)
  );
  await runBatchInChunks(env, statements);
}

export async function insertNotifications(
  env: Env,
  notifications: Array<{ item: NormalizedItem; kind: "added" | "changed" }>,
  now: string
): Promise<number> {
  const statements = notifications.map(({ item, kind }) =>
    env.DB.prepare(
      `
        INSERT OR IGNORE INTO notifications (
          item_key,
          kind,
          content_hash,
          payload,
          created_at
        )
        VALUES (?, ?, ?, ?, ?)
      `
    ).bind(item.key, kind, item.contentHash, JSON.stringify(item), now)
  );
  const results = await runBatchInChunks(env, statements);
  return results.reduce((count, result) => count + (result.meta.changes ?? 0), 0);
}

export async function getPendingNotifications(
  env: Env,
  limit: number
): Promise<NotificationWithItem[]> {
  const result = await env.DB.prepare(
    `
      SELECT *
      FROM notifications
      WHERE sent_at IS NULL
      ORDER BY id ASC
      LIMIT ?
    `
  )
    .bind(limit)
    .all<NotificationRow>();

  return (result.results ?? []).map((row) => ({
    ...row,
    item: JSON.parse(row.payload) as NormalizedItem
  }));
}

export async function markNotificationsSent(
  env: Env,
  ids: number[],
  now: string
): Promise<void> {
  const statements = ids.map((id) =>
    env.DB.prepare("UPDATE notifications SET sent_at = ? WHERE id = ?").bind(now, id)
  );
  await runBatchInChunks(env, statements);
}

export async function logMailSend(
  env: Env,
  notificationIds: number[],
  subscriberCount: number,
  status: "sent" | "failed" | "skipped",
  providerMessageIds: string | null,
  error: string | null,
  now: string
): Promise<void> {
  await env.DB.prepare(
    `
      INSERT INTO mail_logs (
        notification_ids,
        subscriber_count,
        status,
        provider_message_ids,
        error,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `
  )
    .bind(JSON.stringify(notificationIds), subscriberCount, status, providerMessageIds, error, now)
    .run();
}

async function runBatchInChunks(
  env: Env,
  statements: D1PreparedStatement[]
): Promise<D1Result[]> {
  const results: D1Result[] = [];
  for (let index = 0; index < statements.length; index += SQL_BATCH_SIZE) {
    const chunk = statements.slice(index, index + SQL_BATCH_SIZE);
    if (chunk.length === 0) {
      continue;
    }
    results.push(...(await env.DB.batch(chunk)));
  }
  return results;
}
