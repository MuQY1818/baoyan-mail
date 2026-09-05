import type {
  Env,
  ClassificationFeedback,
  ItemActivityTypeClassification,
  ItemActivityTypeClassificationRow,
  ItemRelevanceClassification,
  ItemRelevanceClassificationRow,
  ItemSnapshotRow,
  NewDeadlineNotificationRow,
  NewDeadlineNotificationWithItem,
  NormalizedItem,
  OfficialItemVerification,
  OfficialItemVerificationRow,
  OfficialItemVerificationTarget,
  ReviewCandidatePayload,
  SourceStats,
  SourceReviewCandidateRow,
  SourceReviewCandidateWithPayload,
  SubscriberRow,
  VisitDailyStatRow
} from "./types";
import { sha256Hex } from "./crypto";
import type { SourceReviewCandidateInput } from "./source";

const SQL_BATCH_SIZE = 50;

export function writeBudgetLimit(env: Env): number {
  const configured = Number(env.PIPELINE_DAILY_WRITE_BUDGET ?? 60_000);
  return Number.isSafeInteger(configured) && configured >= 0 && configured <= 60_000 ? configured : 60_000;
}

export function reserveWriteBudget(env: Env, cost: number, now: string): D1PreparedStatement {
  if (!Number.isSafeInteger(cost) || cost < 0) throw new Error("invalid_write_budget_cost");
  return env.DB.prepare(`INSERT INTO pipeline_write_budget (utc_day, reserved, daily_limit)
    VALUES (?, ?, ?) ON CONFLICT(utc_day) DO UPDATE SET
      reserved = pipeline_write_budget.reserved + excluded.reserved,
      daily_limit = MIN(pipeline_write_budget.daily_limit, excluded.daily_limit)`)
    .bind(now.slice(0, 10), cost, writeBudgetLimit(env));
}

export async function getWriteBudget(env: Env, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const row = await env.DB.prepare("SELECT reserved, daily_limit FROM pipeline_write_budget WHERE utc_day = ?")
    .bind(day).first<{ reserved: number; daily_limit: number }>();
  const limit = Math.min(row?.daily_limit ?? writeBudgetLimit(env), writeBudgetLimit(env));
  return { scope: "pipeline-estimate", utcDay: day, reserved: row?.reserved ?? 0, limit,
    remaining: Math.max(0, limit - (row?.reserved ?? 0)),
    resetsAt: new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString() };
}

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

export async function acquireAppStateLock(
  env: Env,
  key: string,
  value: string,
  now: string,
  staleBefore: string
): Promise<boolean> {
  const result = await env.DB.prepare(
    `
      INSERT INTO app_state (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
      WHERE app_state.value = '' OR app_state.updated_at < ?
    `
  )
    .bind(key, value, now, staleBefore)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function releaseAppStateLock(
  env: Env,
  key: string,
  expectedValue: string,
  now: string
): Promise<boolean> {
  const result = await env.DB.prepare(
    `
      UPDATE app_state
      SET value = '', updated_at = ?
      WHERE key = ? AND value = ?
    `
  )
    .bind(now, key, expectedValue)
    .run();
  return (result.meta.changes ?? 0) > 0;
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

export async function getSnapshotLastSeenCount(env: Env, lastSeenAt: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM item_snapshots WHERE last_seen_at = ?"
  )
    .bind(lastSeenAt)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function getExternalSourceSyncItemCount(
  env: Env,
  runId: string
): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM external_source_sync_item_rows WHERE run_id = ?"
  )
    .bind(runId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function stageExternalSourceSyncItems(
  env: Env,
  runId: string,
  items: NormalizedItem[],
  now: string
): Promise<void> {
  await stageExternalSourceSyncBatch(env, runId, "items", items, now);
}

export async function stageExternalSourceSyncBatch(
  env: Env, runId: string, kind: "items" | "reviews",
  items: NormalizedItem[] | SourceReviewCandidateInput[], now: string
): Promise<void> {
  const keyOf = (item: NormalizedItem | SourceReviewCandidateInput) => "key" in item ? item.key : `${item.normalizedUrl}\u0000${item.sourceGroup}`;
  const sorted = [...items].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
  const keys = sorted.map(keyOf);
  if (new Set(keys).size !== keys.length) throw new Error("duplicate_batch_keys");
  const payload = JSON.stringify(sorted);
  const batchKey = await sha256Hex(JSON.stringify(keys));
  const previous = await env.DB.prepare(`SELECT payload FROM external_source_sync_batches
    WHERE run_id = ? AND kind = ? AND batch_key = ?`).bind(runId, kind, batchKey).first<{ payload: string }>();
  if (previous?.payload === payload) return;
  const rowView = kind === "items" ? "external_source_sync_item_rows" : "external_source_sync_review_rows";
  const keyExpression = kind === "items" ? "item_key" : "normalized_url || char(0) || source_group";
  await env.DB.batch([
    env.DB.prepare(`INSERT OR REPLACE INTO pipeline_assertions (id, valid)
      SELECT 'stage-batch', CASE WHEN EXISTS (SELECT 1 FROM app_state
        WHERE key = 'external_source_sync_active_run' AND json_extract(NULLIF(value, ''), '$.runId') = ?)
        AND (EXISTS (SELECT 1 FROM external_source_sync_batches WHERE run_id = ? AND kind = ?
          AND batch_key = ? AND payload = ?) OR NOT EXISTS (
            SELECT 1 FROM ${rowView} WHERE run_id = ? AND ${keyExpression} IN (SELECT value FROM json_each(?))))
        THEN 1 ELSE 0 END`).bind(runId, runId, kind, batchKey, payload, runId, JSON.stringify(keys)),
    // 包含批次、预算、断言和日后清理开销，重复成功请求走上面的只读返回。
    reserveWriteBudget(env, 12, now),
    env.DB.prepare(`INSERT INTO external_source_sync_batches (run_id, kind, batch_key, payload, created_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(run_id, kind, batch_key) DO NOTHING`)
      .bind(runId, kind, batchKey, payload, now)
  ]);
}

export async function discardExternalSourceSyncItems(
  env: Env,
  runId: string
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM external_source_sync_batches WHERE run_id = ?").bind(runId),
    env.DB.prepare("DELETE FROM external_source_sync_items WHERE run_id = ?").bind(runId),
    env.DB.prepare("DELETE FROM external_source_sync_reviews WHERE run_id = ?").bind(runId)
  ]);
}

export async function discardExternalSourceSyncItemsCreatedBefore(
  env: Env,
  createdBefore: string
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM external_source_sync_batches WHERE created_at < ?").bind(createdBefore),
    env.DB.prepare("DELETE FROM external_source_sync_items WHERE created_at < ?").bind(createdBefore),
    env.DB.prepare("DELETE FROM external_source_sync_reviews WHERE created_at < ?").bind(createdBefore)
  ]);
}

export async function publishExternalSourceSyncItems(
  env: Env,
  runId: string,
  sourceGroups: string[],
  now: string,
  sourceStats: SourceStats[],
  lockKey: string,
  expectedLockValue: string,
  expectedCount: number,
  reviewCount: number,
  publication: Record<string, unknown>
): Promise<void> {
  const placeholders = sourceGroups.map(() => "?").join(", ");
  const changedItems = `(SELECT COUNT(*) FROM external_source_sync_item_rows s
    LEFT JOIN item_snapshots t ON t.item_key = s.item_key WHERE s.run_id = ?
    AND (t.item_key IS NULL OR t.content_hash <> s.content_hash OR t.payload <> s.payload OR t.missing_since IS NOT NULL))`;
  const changedReviews = `(SELECT COUNT(*) FROM external_source_sync_review_rows s
    LEFT JOIN source_review_candidates t ON t.normalized_url = s.normalized_url AND t.source_group = s.source_group
    WHERE s.run_id = ? AND (t.id IS NULL OR (t.status = 'pending' AND (t.reason <> s.reason OR t.payload <> s.payload))))`;
  const missingItems = `(SELECT COUNT(*) FROM item_snapshots WHERE source_group IN (${placeholders})
    AND missing_since IS NULL AND item_key NOT IN (SELECT item_key FROM external_source_sync_item_rows WHERE run_id = ?))`;
  const estimatedCost = `(64 + 10 * ${changedItems} + 8 * ${changedReviews} + 4 * ${missingItems})`;
  await env.DB.batch([
    env.DB.prepare(`INSERT OR REPLACE INTO pipeline_assertions (id, valid)
      SELECT 'publish', CASE WHEN
        EXISTS (SELECT 1 FROM app_state WHERE key = ? AND value = ?)
        AND (SELECT COUNT(DISTINCT item_key) FROM external_source_sync_item_rows WHERE run_id = ?) = ?
        AND (SELECT COUNT(*) FROM external_source_sync_item_rows WHERE run_id = ?) = ?
        AND (SELECT COUNT(*) FROM external_source_sync_review_rows WHERE run_id = ?) = ?
        AND (SELECT COUNT(*) FROM (SELECT normalized_url, source_group FROM external_source_sync_review_rows
          WHERE run_id = ? GROUP BY normalized_url, source_group)) = ?
        AND EXISTS (SELECT 1 FROM pipeline_runs WHERE run_id = ? AND status = 'running')
      THEN 1 ELSE 0 END`).bind(lockKey, expectedLockValue, runId, expectedCount, runId, expectedCount,
        runId, reviewCount, runId, reviewCount, runId),
    env.DB.prepare(`INSERT INTO pipeline_write_budget (utc_day, reserved, daily_limit)
      SELECT ?, ${estimatedCost}, ? ON CONFLICT(utc_day) DO UPDATE SET
        reserved = pipeline_write_budget.reserved + excluded.reserved,
        daily_limit = MIN(pipeline_write_budget.daily_limit, excluded.daily_limit)`)
      .bind(now.slice(0, 10), runId, runId, ...sourceGroups, runId, writeBudgetLimit(env)),
    env.DB.prepare(`UPDATE pipeline_runs SET status = 'succeeded', updated_at = ?,
      result = json_set(?, '$.missingCount', ${missingItems}, '$.changedItems', ${changedItems},
        '$.changedReviews', ${changedReviews}, '$.estimatedPublishWrites', ${estimatedCost}) WHERE run_id = ?`)
      .bind(now, JSON.stringify(publication), ...sourceGroups, runId, runId, runId,
        runId, runId, ...sourceGroups, runId, runId),
    env.DB.prepare(`INSERT INTO source_review_candidates
      (normalized_url, source_group, status, reason, payload, created_at, updated_at)
      SELECT normalized_url, source_group, 'pending', reason, payload, ?, ?
      FROM external_source_sync_review_rows WHERE run_id = ?
      ON CONFLICT(normalized_url, source_group) DO UPDATE SET
        reason = excluded.reason, payload = excluded.payload, updated_at = excluded.updated_at
      WHERE source_review_candidates.status = 'pending' AND
        (source_review_candidates.reason <> excluded.reason OR source_review_candidates.payload <> excluded.payload)`)
      .bind(now, now, runId),
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
        SELECT
          item_key,
          content_hash,
          payload,
          source_group,
          ?,
          ?,
          ?,
          NULL
        FROM external_source_sync_item_rows
        WHERE run_id = ?
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
        WHERE item_snapshots.content_hash <> excluded.content_hash
          OR item_snapshots.payload <> excluded.payload OR item_snapshots.missing_since IS NOT NULL
      `
    ).bind(now, now, now, runId),
    env.DB.prepare(
      `
        UPDATE item_snapshots
        SET missing_since = ?
        WHERE source_group IN (${placeholders})
          AND item_key NOT IN (SELECT item_key FROM external_source_sync_item_rows WHERE run_id = ?)
          AND missing_since IS NULL
      `
    ).bind(now, ...sourceGroups, runId),
    env.DB.prepare(
      `
        INSERT INTO app_state (key, value, updated_at)
        VALUES ('last_synced_at', ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `
    ).bind(now, now),
    env.DB.prepare(
      `
        INSERT INTO app_state (key, value, updated_at)
        VALUES ('last_source_stats', ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `
    ).bind(JSON.stringify(sourceStats), now),
    env.DB.prepare("DELETE FROM external_source_sync_items WHERE run_id = ?").bind(runId),
    env.DB.prepare("DELETE FROM external_source_sync_reviews WHERE run_id = ?").bind(runId),
    env.DB.prepare("DELETE FROM external_source_sync_batches WHERE run_id = ?").bind(runId),
    env.DB.prepare(`INSERT INTO app_state (key, value, updated_at) VALUES ('snapshot_version', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(runId, now),
    env.DB.prepare(
      `
        UPDATE app_state
        SET value = '', updated_at = ?
        WHERE key = ? AND value = ?
      `
    ).bind(now, lockKey, expectedLockValue)
  ]);
}

export async function getSnapshotRowsBySourceGroups(
  env: Env,
  sourceGroups: string[]
): Promise<ItemSnapshotRow[]> {
  if (sourceGroups.length === 0) {
    return [];
  }
  const placeholders = sourceGroups.map(() => "?").join(", ");
  const result = await env.DB.prepare(
    `SELECT * FROM item_snapshots WHERE source_group IN (${placeholders})`
  )
    .bind(...sourceGroups)
    .all<ItemSnapshotRow>();
  return result.results ?? [];
}

export async function getSnapshotRowsPageBySourceGroups(
  env: Env,
  sourceGroups: string[],
  cursor: string,
  limit: number
): Promise<ItemSnapshotRow[]> {
  if (sourceGroups.length === 0) {
    return [];
  }
  const placeholders = sourceGroups.map(() => "?").join(", ");
  const result = await env.DB.prepare(
    `
      SELECT *
      FROM item_snapshots
      WHERE source_group IN (${placeholders}) AND item_key > ?
      ORDER BY item_key ASC
      LIMIT ?
    `
  )
    .bind(...sourceGroups, cursor, limit)
    .all<ItemSnapshotRow>();
  return result.results ?? [];
}

export async function getSnapshotItems(env: Env): Promise<NormalizedItem[]> {
  return (await getSnapshotRows(env)).map((row) => JSON.parse(row.payload) as NormalizedItem);
}

export async function incrementVisitDailyStat(
  env: Env,
  stat: {
    visitDate: string;
    countryCode: string;
    regionCode: string;
    countryName: string;
    regionName: string;
  },
  now: string
): Promise<void> {
  await env.DB.prepare(
    `
      INSERT INTO visit_daily_stats (
        visit_date,
        country_code,
        region_code,
        country_name,
        region_name,
        visit_count,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(visit_date, country_code, region_code) DO UPDATE SET
        country_name = excluded.country_name,
        region_name = excluded.region_name,
        visit_count = visit_count + 1,
        updated_at = excluded.updated_at
    `
  )
    .bind(
      stat.visitDate,
      stat.countryCode,
      stat.regionCode,
      stat.countryName,
      stat.regionName,
      now,
      now
    )
    .run();
}

export async function getVisitDailyStats(
  env: Env,
  sinceDate: string
): Promise<VisitDailyStatRow[]> {
  const result = await env.DB.prepare(
    `
      SELECT
        visit_date,
        country_code,
        region_code,
        country_name,
        region_name,
        visit_count,
        created_at,
        updated_at
      FROM visit_daily_stats
      WHERE visit_date >= ?
      ORDER BY visit_date DESC, visit_count DESC
    `
  )
    .bind(sinceDate)
    .all<VisitDailyStatRow>();
  return result.results ?? [];
}

export async function getItemRelevanceClassifications(
  env: Env,
  normalizedUrls: string[]
): Promise<Map<string, ItemRelevanceClassification>> {
  const uniqueUrls = Array.from(new Set(normalizedUrls.filter((url) => url !== "")));
  if (uniqueUrls.length > SQL_BATCH_SIZE * 8) {
    const result = await env.DB.prepare(
      "SELECT * FROM item_relevance_classifications"
    ).all<ItemRelevanceClassificationRow>();
    const requested = new Set(uniqueUrls);
    return new Map(
      (result.results ?? [])
        .filter((row) => requested.has(row.normalized_url))
        .map((row) => [row.normalized_url, hydrateItemRelevanceClassification(row)])
    );
  }
  const rows: ItemRelevanceClassificationRow[] = [];
  for (let index = 0; index < uniqueUrls.length; index += SQL_BATCH_SIZE) {
    const chunk = uniqueUrls.slice(index, index + SQL_BATCH_SIZE);
    if (chunk.length === 0) {
      continue;
    }
    const placeholders = chunk.map(() => "?").join(", ");
    const result = await env.DB.prepare(
      `SELECT * FROM item_relevance_classifications WHERE normalized_url IN (${placeholders})`
    )
      .bind(...chunk)
      .all<ItemRelevanceClassificationRow>();
    rows.push(...(result.results ?? []));
  }
  return new Map(rows.map((row) => [row.normalized_url, hydrateItemRelevanceClassification(row)]));
}

export async function upsertItemRelevanceClassifications(
  env: Env,
  entries: ItemRelevanceClassification[],
  now: string,
  pending?: D1PreparedStatement[]
): Promise<number> {
  const statements = entries.map((entry) =>
    env.DB.prepare(
      `
        INSERT INTO item_relevance_classifications (
          normalized_url,
          relevance,
          areas,
          reason,
          classifier,
          classified_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(normalized_url) DO UPDATE SET
          relevance = excluded.relevance,
          areas = excluded.areas,
          reason = excluded.reason,
          classifier = excluded.classifier,
          classified_at = excluded.classified_at,
          updated_at = excluded.updated_at
      `
    ).bind(
      entry.normalizedUrl,
      entry.relevance,
      JSON.stringify(entry.areas),
      entry.reason,
      entry.classifier,
      entry.classifiedAt,
      now,
      now
    )
  );
  if (pending !== undefined) { pending.push(...statements); return entries.length; }
  const results = await runBatchInChunks(env, statements);
  return results.reduce((count, result) => count + (result.meta.changes ?? 0), 0);
}

export async function getItemActivityTypeClassifications(
  env: Env,
  normalizedUrls: string[]
): Promise<Map<string, ItemActivityTypeClassification>> {
  const uniqueUrls = Array.from(new Set(normalizedUrls.filter((url) => url !== "")));
  if (uniqueUrls.length > SQL_BATCH_SIZE * 8) {
    const result = await env.DB.prepare(
      "SELECT * FROM item_activity_type_classifications"
    ).all<ItemActivityTypeClassificationRow>();
    const requested = new Set(uniqueUrls);
    return new Map(
      (result.results ?? [])
        .filter((row) => requested.has(row.normalized_url))
        .map((row) => [row.normalized_url, hydrateItemActivityTypeClassification(row)])
    );
  }
  const rows: ItemActivityTypeClassificationRow[] = [];
  for (let index = 0; index < uniqueUrls.length; index += SQL_BATCH_SIZE) {
    const chunk = uniqueUrls.slice(index, index + SQL_BATCH_SIZE);
    if (chunk.length === 0) {
      continue;
    }
    const placeholders = chunk.map(() => "?").join(", ");
    const result = await env.DB.prepare(
      `SELECT * FROM item_activity_type_classifications WHERE normalized_url IN (${placeholders})`
    )
      .bind(...chunk)
      .all<ItemActivityTypeClassificationRow>();
    rows.push(...(result.results ?? []));
  }
  return new Map(
    rows.map((row) => [row.normalized_url, hydrateItemActivityTypeClassification(row)])
  );
}

export async function upsertItemActivityTypeClassifications(
  env: Env,
  entries: ItemActivityTypeClassification[],
  now: string,
  pending?: D1PreparedStatement[]
): Promise<number> {
  const statements = entries.map((entry) =>
    env.DB.prepare(
      `
        INSERT INTO item_activity_type_classifications (
          normalized_url,
          activity_type,
          reason,
          classifier,
          classified_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(normalized_url) DO UPDATE SET
          activity_type = excluded.activity_type,
          reason = excluded.reason,
          classifier = excluded.classifier,
          classified_at = excluded.classified_at,
          updated_at = excluded.updated_at
      `
    ).bind(
      entry.normalizedUrl,
      entry.activityType,
      entry.reason,
      entry.classifier,
      entry.classifiedAt,
      now,
      now
    )
  );
  if (pending !== undefined) { pending.push(...statements); return entries.length; }
  const results = await runBatchInChunks(env, statements);
  return results.reduce((count, result) => count + (result.meta.changes ?? 0), 0);
}

export async function getOfficialItemVerifications(
  env: Env,
  targets: OfficialItemVerificationTarget[],
  includeLegacyByUrl = true
): Promise<Map<string, OfficialItemVerification>> {
  const uniqueTargets = Array.from(
    new Map(targets.filter((target) => target.itemKey !== "").map((target) => [target.itemKey, target])).values()
  );
  const itemKeys = uniqueTargets.map((target) => target.itemKey);
  const exactRows: OfficialItemVerificationRow[] = [];
  if (itemKeys.length > SQL_BATCH_SIZE * 8) {
    const result = await env.DB.prepare(
      "SELECT * FROM item_official_item_verifications"
    ).all<OfficialItemVerificationRow>();
    const requested = new Set(itemKeys);
    exactRows.push(...(result.results ?? []).filter((row) => requested.has(row.item_key)));
  } else {
    for (let index = 0; index < itemKeys.length; index += SQL_BATCH_SIZE) {
      const chunk = itemKeys.slice(index, index + SQL_BATCH_SIZE);
      if (chunk.length === 0) {
        continue;
      }
      const placeholders = chunk.map(() => "?").join(", ");
      const result = await env.DB.prepare(
        `SELECT * FROM item_official_item_verifications WHERE item_key IN (${placeholders})`
      )
        .bind(...chunk)
        .all<OfficialItemVerificationRow>();
      exactRows.push(...(result.results ?? []));
    }
  }
  const verifications = new Map(
    exactRows.map((row) => [row.item_key, hydrateOfficialItemVerification(row)])
  );

  const urlOwners = new Map<string, Set<string>>();
  if (!includeLegacyByUrl) {
    return verifications;
  }
  for (const target of uniqueTargets) {
    for (const url of target.normalizedUrls.filter((value) => value !== "")) {
      const owners = urlOwners.get(url) ?? new Set<string>();
      owners.add(target.itemKey);
      urlOwners.set(url, owners);
    }
  }
  const uniqueUrls = Array.from(urlOwners.keys()).filter(
    (url) => Array.from(urlOwners.get(url) ?? []).length === 1
  );
  const legacyRows: LegacyOfficialItemVerificationRow[] = [];
  if (uniqueUrls.length > SQL_BATCH_SIZE * 8) {
    const result = await env.DB.prepare(
      "SELECT * FROM item_official_verifications"
    ).all<LegacyOfficialItemVerificationRow>();
    const requested = new Set(uniqueUrls);
    legacyRows.push(...(result.results ?? []).filter((row) => requested.has(row.normalized_url)));
  } else {
    for (let index = 0; index < uniqueUrls.length; index += SQL_BATCH_SIZE) {
      const chunk = uniqueUrls.slice(index, index + SQL_BATCH_SIZE);
      if (chunk.length === 0) {
        continue;
      }
      const placeholders = chunk.map(() => "?").join(", ");
      const result = await env.DB.prepare(
        `SELECT * FROM item_official_verifications WHERE normalized_url IN (${placeholders})`
      )
        .bind(...chunk)
        .all<LegacyOfficialItemVerificationRow>();
      legacyRows.push(...(result.results ?? []));
    }
  }
  const legacyByUrl = new Map(
    legacyRows.map((row) => [row.normalized_url, hydrateLegacyOfficialItemVerification(row)])
  );
  for (const target of uniqueTargets) {
    if (verifications.has(target.itemKey)) {
      continue;
    }
    const legacy = target.normalizedUrls
      .filter((url) => (urlOwners.get(url)?.size ?? 0) === 1)
      .map((url) => legacyByUrl.get(url))
      .find((entry): entry is OfficialItemVerification => entry !== undefined);
    if (legacy !== undefined) {
      verifications.set(target.itemKey, { ...legacy, itemKey: target.itemKey });
    }
  }
  return verifications;
}

export async function recordClassificationFeedback(
  env: Env,
  entries: ClassificationFeedback[],
  pending?: D1PreparedStatement[]
): Promise<number> {
  if (entries.length === 0) {
    return 0;
  }
  const statements = entries.map((entry) =>
    env.DB.prepare(
      `
        INSERT OR IGNORE INTO classification_feedback (
          normalized_url,
          classification_kind,
          model_value,
          corrected_value,
          reason,
          source,
          classifier,
          created_at,
          feedback_key
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).bind(
      entry.normalizedUrl,
      entry.classificationKind,
      entry.modelValue,
      entry.correctedValue,
      entry.reason,
      entry.source,
      entry.classifier,
      entry.createdAt,
      JSON.stringify([entry.normalizedUrl, entry.classificationKind, entry.modelValue,
        entry.correctedValue, entry.reason, entry.source, entry.classifier])
    )
  );
  if (pending !== undefined) { pending.push(...statements); return entries.length; }
  const results = await runBatchInChunks(env, statements);
  return results.reduce((count, result) => count + (result.meta.changes ?? 0), 0);
}

export async function upsertOfficialItemVerifications(
  env: Env,
  entries: OfficialItemVerification[],
  now: string,
  pending?: D1PreparedStatement[]
): Promise<number> {
  const statements = entries.map((entry) =>
    env.DB.prepare(
      `
        INSERT INTO item_official_item_verifications (
          item_key,
          normalized_url,
          title,
          deadline,
          deadline_precision,
          reason,
          verifier,
          verified_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(item_key) DO UPDATE SET
          normalized_url = excluded.normalized_url,
          title = excluded.title,
          deadline = excluded.deadline,
          deadline_precision = excluded.deadline_precision,
          reason = excluded.reason,
          verifier = excluded.verifier,
          verified_at = excluded.verified_at,
          updated_at = excluded.updated_at
    `
    ).bind(
      entry.itemKey,
      entry.normalizedUrl,
      entry.title,
      entry.deadline,
      entry.deadlinePrecision,
      entry.reason,
      entry.verifier,
      entry.verifiedAt,
      now,
      now
    )
  );
  if (pending !== undefined) { pending.push(...statements); return entries.length; }
  const results = await runBatchInChunks(env, statements);
  return results.reduce((count, result) => count + (result.meta.changes ?? 0), 0);
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

export async function markSnapshotsMissingExceptLastSeenAt(
  env: Env,
  sourceGroups: string[],
  lastSeenAt: string,
  now: string
): Promise<number> {
  if (sourceGroups.length === 0) {
    return 0;
  }
  const placeholders = sourceGroups.map(() => "?").join(", ");
  const result = await env.DB.prepare(
    `
      UPDATE item_snapshots
      SET missing_since = ?
      WHERE source_group IN (${placeholders})
        AND COALESCE(last_seen_at, '') <> ?
        AND missing_since IS NULL
    `
  )
    .bind(now, ...sourceGroups, lastSeenAt)
    .run();
  return result.meta.changes ?? 0;
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

function hydrateItemRelevanceClassification(
  row: ItemRelevanceClassificationRow
): ItemRelevanceClassification {
  return {
    normalizedUrl: row.normalized_url,
    relevance: row.relevance,
    areas: parseStringArray(row.areas),
    reason: row.reason,
    classifier: row.classifier,
    classifiedAt: row.classified_at
  };
}

function hydrateItemActivityTypeClassification(
  row: ItemActivityTypeClassificationRow
): ItemActivityTypeClassification {
  return {
    normalizedUrl: row.normalized_url,
    activityType: row.activity_type,
    reason: row.reason,
    classifier: row.classifier,
    classifiedAt: row.classified_at
  };
}

function hydrateOfficialItemVerification(
  row: OfficialItemVerificationRow
): OfficialItemVerification {
  return {
    itemKey: row.item_key,
    normalizedUrl: row.normalized_url,
    title: row.title,
    deadline: row.deadline,
    deadlinePrecision: row.deadline_precision,
    reason: row.reason,
    verifier: row.verifier,
    verifiedAt: row.verified_at
  };
}

interface LegacyOfficialItemVerificationRow {
  normalized_url: string;
  title: string;
  deadline: string;
  deadline_precision: OfficialItemVerification["deadlinePrecision"];
  reason: string;
  verifier: string;
  verified_at: string;
}

function hydrateLegacyOfficialItemVerification(
  row: LegacyOfficialItemVerificationRow
): OfficialItemVerification {
  return {
    itemKey: "",
    normalizedUrl: row.normalized_url,
    title: row.title,
    deadline: row.deadline,
    deadlinePrecision: row.deadline_precision,
    reason: row.reason,
    verifier: row.verifier,
    verifiedAt: row.verified_at
  };
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}
