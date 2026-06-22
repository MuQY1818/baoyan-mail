import type {
  Env,
  ItemSnapshotRow,
  NewDeadlineNotificationRow,
  NewDeadlineNotificationWithItem,
  NormalizedItem,
  ReviewCandidatePayload,
  SourceReviewCandidateRow,
  SourceReviewCandidateWithPayload,
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

export async function getAppState(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM app_state WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function setAppState(
  env: Env,
  key: string,
  value: string,
  now: string
): Promise<void> {
  await env.DB.prepare(
    `
      INSERT INTO app_state (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `
  )
    .bind(key, value, now)
    .run();
}

export async function getSnapshots(env: Env): Promise<Map<string, ItemSnapshotRow>> {
  const result = await env.DB.prepare("SELECT * FROM item_snapshots").all<ItemSnapshotRow>();
  const rows = result.results ?? [];
  return new Map(rows.map((row) => [row.item_key, row]));
}

export async function getSnapshotRows(env: Env): Promise<ItemSnapshotRow[]> {
  const result = await env.DB.prepare("SELECT * FROM item_snapshots").all<ItemSnapshotRow>();
  return result.results ?? [];
}

export async function getSnapshotItems(env: Env): Promise<NormalizedItem[]> {
  return (await getSnapshotRows(env)).map((row) => JSON.parse(row.payload) as NormalizedItem);
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
          updated_at,
          last_seen_at,
          missing_since
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(item_key) DO UPDATE SET
          content_hash = excluded.content_hash,
          payload = excluded.payload,
          source_group = excluded.source_group,
          updated_at = CASE
            WHEN item_snapshots.content_hash <> excluded.content_hash THEN excluded.updated_at
            ELSE item_snapshots.updated_at
          END,
          last_seen_at = excluded.last_seen_at,
          missing_since = NULL
      `
    ).bind(item.key, item.contentHash, JSON.stringify(item), item.sourceGroup, now, now, now)
  );
  await runBatchInChunks(env, statements);
}

export async function getUnmissingSnapshotRefs(
  env: Env
): Promise<Array<{ item_key: string; source_group: string }>> {
  const result = await env.DB.prepare(
    "SELECT item_key, source_group FROM item_snapshots WHERE missing_since IS NULL"
  ).all<{ item_key: string; source_group: string }>();
  return result.results ?? [];
}

export async function markSnapshotsMissing(
  env: Env,
  itemKeys: string[],
  now: string
): Promise<number> {
  const statements = itemKeys.map((itemKey) =>
    env.DB.prepare(
      `
        UPDATE item_snapshots
        SET missing_since = ?
        WHERE item_key = ? AND missing_since IS NULL
      `
    ).bind(now, itemKey)
  );
  const results = await runBatchInChunks(env, statements);
  return results.reduce((count, result) => count + (result.meta.changes ?? 0), 0);
}

export async function upsertReviewCandidates(
  env: Env,
  candidates: Array<{
    normalizedUrl: string;
    sourceGroup: string;
    reason: string;
    payload: ReviewCandidatePayload;
  }>,
  now: string
): Promise<number> {
  const statements = candidates.map((candidate) =>
    env.DB.prepare(
      `
        INSERT INTO source_review_candidates (
          normalized_url,
          source_group,
          status,
          reason,
          payload,
          created_at,
          updated_at
        )
        VALUES (?, ?, 'pending', ?, ?, ?, ?)
        ON CONFLICT(normalized_url, source_group) DO UPDATE SET
          reason = CASE
            WHEN source_review_candidates.status = 'pending' THEN excluded.reason
            ELSE source_review_candidates.reason
          END,
          payload = CASE
            WHEN source_review_candidates.status = 'pending' THEN excluded.payload
            ELSE source_review_candidates.payload
          END,
          updated_at = CASE
            WHEN source_review_candidates.status = 'pending' THEN excluded.updated_at
            ELSE source_review_candidates.updated_at
          END
      `
    ).bind(
      candidate.normalizedUrl,
      candidate.sourceGroup,
      candidate.reason,
      JSON.stringify(candidate.payload),
      now,
      now
    )
  );
  const results = await runBatchInChunks(env, statements);
  return results.reduce((count, result) => count + (result.meta.changes ?? 0), 0);
}

export async function getPendingReviewCandidates(
  env: Env
): Promise<SourceReviewCandidateWithPayload[]> {
  const result = await env.DB.prepare(
    `
      SELECT *
      FROM source_review_candidates
      WHERE status = 'pending'
      ORDER BY updated_at DESC, id DESC
      LIMIT 200
    `
  ).all<SourceReviewCandidateRow>();
  return (result.results ?? []).map(hydrateReviewCandidate);
}

export async function getReviewCandidateById(
  env: Env,
  id: number
): Promise<SourceReviewCandidateWithPayload | null> {
  const row = await env.DB.prepare("SELECT * FROM source_review_candidates WHERE id = ?")
    .bind(id)
    .first<SourceReviewCandidateRow>();
  return row === null ? null : hydrateReviewCandidate(row);
}

export async function approveReviewCandidate(
  env: Env,
  id: number,
  note: string | null,
  now: string
): Promise<void> {
  await env.DB.prepare(
    `
      UPDATE source_review_candidates
      SET status = 'approved', reviewed_at = ?, review_note = ?, updated_at = ?
      WHERE id = ?
    `
  )
    .bind(now, note, now, id)
    .run();
}

export async function rejectReviewCandidate(
  env: Env,
  id: number,
  note: string | null,
  now: string
): Promise<void> {
  await env.DB.prepare(
    `
      UPDATE source_review_candidates
      SET status = 'rejected', reviewed_at = ?, review_note = ?, updated_at = ?
      WHERE id = ?
    `
  )
    .bind(now, note, now, id)
    .run();
}

export async function insertReviewRule(
  env: Env,
  ruleType: "allow" | "reject",
  normalizedUrl: string,
  note: string | null,
  now: string
): Promise<void> {
  await env.DB.prepare(
    `
      INSERT OR IGNORE INTO source_review_rules (rule_type, normalized_url, note, created_at)
      VALUES (?, ?, ?, ?)
    `
  )
    .bind(ruleType, normalizedUrl, note, now)
    .run();
}

export async function getManualItems(env: Env): Promise<NormalizedItem[]> {
  const result = await env.DB.prepare(
    "SELECT payload FROM manual_items ORDER BY updated_at DESC, id DESC"
  ).all<{ payload: string }>();
  return (result.results ?? []).map((row) => JSON.parse(row.payload) as NormalizedItem);
}

export async function upsertManualItem(
  env: Env,
  item: NormalizedItem,
  now: string
): Promise<void> {
  await env.DB.prepare(
    `
      INSERT INTO manual_items (item_key, payload, source_group, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(item_key) DO UPDATE SET
        payload = excluded.payload,
        source_group = excluded.source_group,
        updated_at = excluded.updated_at
    `
  )
    .bind(item.key, JSON.stringify(item), item.sourceGroup, now, now)
    .run();
}

export async function insertNewDeadlineNotifications(
  env: Env,
  notifications: Array<{
    item: NormalizedItem;
    deadlineAt: string;
  }>,
  now: string
): Promise<number> {
  const statements = notifications.map((notification) =>
    env.DB.prepare(
      `
        INSERT OR IGNORE INTO new_deadline_notifications (
          item_key,
          deadline_at,
          payload,
          created_at
        )
        VALUES (?, ?, ?, ?)
      `
    ).bind(
      notification.item.key,
      notification.deadlineAt,
      JSON.stringify(notification.item),
      now
    )
  );
  const results = await runBatchInChunks(env, statements);
  return results.reduce((count, result) => count + (result.meta.changes ?? 0), 0);
}

export async function getPendingNewDeadlineNotifications(
  env: Env,
  now: string
): Promise<NewDeadlineNotificationWithItem[]> {
  const result = await env.DB.prepare(
    `
      SELECT *
      FROM new_deadline_notifications
      WHERE sent_at IS NULL AND deadline_at > ?
      ORDER BY deadline_at ASC, id ASC
    `
  )
    .bind(now)
    .all<NewDeadlineNotificationRow>();

  return (result.results ?? []).map((row) => ({
    ...row,
    item: JSON.parse(row.payload) as NormalizedItem
  }));
}

export async function markNewDeadlineNotificationsSent(
  env: Env,
  ids: number[],
  now: string
): Promise<void> {
  const statements = ids.map((id) =>
    env.DB.prepare("UPDATE new_deadline_notifications SET sent_at = ? WHERE id = ?").bind(now, id)
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

function hydrateReviewCandidate(
  row: SourceReviewCandidateRow
): SourceReviewCandidateWithPayload {
  return {
    ...row,
    candidate: JSON.parse(row.payload) as ReviewCandidatePayload
  };
}
