import { describe, expect, it, vi } from "vitest";
import {
  collectDailyDeadlineDigestItems,
  collectNewDeadlineNotificationCandidates,
  detectChanges,
  parseDeadline,
  runCheck
} from "../src/checker";
import {
  canonicalizeNotificationUrl,
  classifyBaoyanXinxiRecord,
  fetchSourceItemsWithStats,
  getActivityTypeFromSourceGroup,
  getActivityTypeFromText,
  getBaoyanXinxiAreas,
  getSchoolTierTags,
  isBaoyanXinxiRelevant,
  mergeSourceItems,
  normalizeBaoyanXinxiDeadline,
  normalizeBaoyanXinxiHtml,
  normalizeXingkeData,
  normalizeZscampusData,
  normalizeSourceData
} from "../src/source";
import type { SourceItemInput } from "../src/source";
import { applyActivityTypeClassification, buildDdlResponse } from "../src/ddl";
import { handleRequest, isValidEmail } from "../src/routes";
import { assertNoUnexpectedMergedDrop, reuseExistingKeys } from "../scripts/sync-sources";
import type { Env, NormalizedItem, OfficialItemVerification } from "../src/types";

interface FakeSnapshotRow {
  item_key: string;
  content_hash: string;
  payload: string;
  source_group: string;
  first_seen_at: string;
  updated_at: string;
  last_seen_at: string | null;
  missing_since: string | null;
}

class FakeD1Statement {
  private bindings: unknown[] = [];

  constructor(
    private readonly db: FakeD1Database,
    private readonly sql: string
  ) {}

  bind(...values: unknown[]): FakeD1Statement {
    this.bindings = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    return this.db.first<T>(this.sql, this.bindings);
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.db.all<T>(this.sql, this.bindings) };
  }

  async run(): Promise<D1Result> {
    return this.db.run(this.sql, this.bindings);
  }
}

class FakeD1Database {
  readonly itemSnapshots = new Map<string, FakeSnapshotRow>();
  readonly externalSourceSyncItems = new Map<
    string,
    {
      runId: string;
      itemKey: string;
      contentHash: string;
      payload: string;
      sourceGroup: string;
      createdAt: string;
    }
  >();
  readonly appState = new Map<string, string>();
  readonly appStateUpdatedAt = new Map<string, string>();
  readonly relevanceClassifications = new Map<string, unknown[]>();
  readonly activityTypeClassifications = new Map<string, unknown[]>();
  readonly officialItemVerifications = new Map<string, unknown[]>();
  readonly newDeadlineNotifications: unknown[][] = [];
  readonly visitDailyStats = new Map<string, unknown[]>();
  readonly mailLogs: unknown[][] = [];
  activeSubscriberCount = 0;

  prepare(sql: string): FakeD1Statement {
    return new FakeD1Statement(this, sql);
  }

  async batch(statements: FakeD1Statement[]): Promise<D1Result[]> {
    return Promise.all(statements.map((statement) => statement.run()));
  }

  first<T>(sql: string, bindings: unknown[]): T | null {
    if (sql.includes("COUNT(*) AS count FROM external_source_sync_items")) {
      const runId = String(bindings[0]);
      return {
        count: Array.from(this.externalSourceSyncItems.values()).filter(
          (row) => row.runId === runId
        ).length
      } as T;
    }
    if (sql.includes("COUNT(*) AS count FROM item_snapshots WHERE last_seen_at")) {
      const lastSeenAt = String(bindings[0]);
      return {
        count: Array.from(this.itemSnapshots.values()).filter(
          (row) => row.last_seen_at === lastSeenAt
        ).length
      } as T;
    }
    if (sql.includes("COUNT(*) AS count FROM item_snapshots")) {
      return { count: this.itemSnapshots.size } as T;
    }
    if (sql.includes("SELECT value FROM app_state")) {
      const value = this.appState.get(String(bindings[0]));
      return value === undefined ? null : ({ value } as T);
    }
    if (sql.includes("COUNT(*) AS count FROM subscribers")) {
      return { count: this.activeSubscriberCount } as T;
    }
    return null;
  }

  all<T>(sql: string, bindings: unknown[]): T[] {
    if (/SELECT\s+\*\s+FROM item_snapshots/u.test(sql)) {
      let rows = Array.from(this.itemSnapshots.values());
      if (sql.includes("WHERE source_group IN")) {
        if (sql.includes("item_key >")) {
          const cursor = String(bindings.at(-2));
          const limit = Number(bindings.at(-1));
          const sourceGroups = new Set(bindings.slice(0, -2).map(String));
          rows = rows
            .filter(
              (row) => sourceGroups.has(row.source_group) && row.item_key > cursor
            )
            .sort((left, right) => left.item_key.localeCompare(right.item_key))
            .slice(0, limit);
        } else {
          const sourceGroups = new Set(bindings.map(String));
          rows = rows.filter((row) => sourceGroups.has(row.source_group));
        }
      }
      return rows as T[];
    }
    if (sql.includes("SELECT item_key, source_group FROM item_snapshots")) {
      return Array.from(this.itemSnapshots.values())
        .filter((row) => row.missing_since === null)
        .map((row) => ({
          item_key: row.item_key,
          source_group: row.source_group
        })) as T[];
    }
    if (sql.includes("SELECT payload FROM item_snapshots")) {
      return Array.from(this.itemSnapshots.values()).map((row) => ({
        payload: row.payload
      })) as T[];
    }
    if (sql.includes("FROM subscribers")) {
      return Array.from({ length: this.activeSubscriberCount }, (_value, index) => ({
        id: index + 1,
        email: `student${index + 1}@example.com`,
        status: "active",
        confirm_token_hash: "hash",
        unsubscribe_token: `token-${index + 1}`,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-01T00:00:00.000Z",
        confirmed_at: "2026-06-01T00:00:00.000Z",
        unsubscribed_at: null
      })) as T[];
    }
    if (sql.includes("FROM new_deadline_notifications")) {
      const now = String(bindings[0]);
      return this.newDeadlineNotifications
        .map((entry, index) => ({
          id: index + 1,
          item_key: String(entry[0]),
          deadline_at: String(entry[1]),
          payload: String(entry[2]),
          created_at: String(entry[3]),
          sent_at: entry[4] === undefined ? null : String(entry[4])
        }))
        .filter((row) => row.sent_at === null && row.deadline_at > now) as T[];
    }
    if (sql.includes("FROM item_relevance_classifications")) {
      const urls = new Set(bindings.map(String));
      return Array.from(this.relevanceClassifications.entries())
        .filter(([url]) => urls.has(url))
        .map(([url, entry]) => ({
          normalized_url: url,
          relevance: String(entry[1]),
          areas: String(entry[2]),
          reason: String(entry[3]),
          classifier: String(entry[4]),
          classified_at: String(entry[5]),
          created_at: String(entry[6]),
          updated_at: String(entry[7])
        })) as T[];
    }
    if (sql.includes("FROM item_activity_type_classifications")) {
      const urls = new Set(bindings.map(String));
      return Array.from(this.activityTypeClassifications.entries())
        .filter(([url]) => urls.has(url))
        .map(([url, entry]) => ({
          normalized_url: url,
          activity_type: String(entry[1]),
          reason: String(entry[2]),
          classifier: String(entry[3]),
          classified_at: String(entry[4]),
          created_at: String(entry[5]),
          updated_at: String(entry[6])
        })) as T[];
    }
    if (sql.includes("FROM item_official_item_verifications")) {
      const itemKeys = new Set(bindings.map(String));
      return Array.from(this.officialItemVerifications.entries())
        .filter(([itemKey]) => itemKeys.has(itemKey))
        .map(([itemKey, entry]) => ({
          item_key: itemKey,
          normalized_url: String(entry[1]),
          title: String(entry[2]),
          deadline: String(entry[3]),
          deadline_precision: String(entry[4]),
          reason: String(entry[5]),
          verifier: String(entry[6]),
          verified_at: String(entry[7]),
          created_at: String(entry[8]),
          updated_at: String(entry[9])
        })) as T[];
    }
    if (sql.includes("FROM visit_daily_stats")) {
      const sinceDate = String(bindings[0]);
      return Array.from(this.visitDailyStats.values())
        .map((entry) => ({
          visit_date: String(entry[0]),
          country_code: String(entry[1]),
          region_code: String(entry[2]),
          country_name: String(entry[3]),
          region_name: String(entry[4]),
          visit_count: Number(entry[5]),
          created_at: String(entry[6]),
          updated_at: String(entry[7])
        }))
        .filter((row) => row.visit_date >= sinceDate) as T[];
    }
    return [];
  }

  async run(sql: string, bindings: unknown[]): Promise<D1Result> {
    let changes = 0;
    if (
      sql.includes("INSERT INTO item_snapshots") &&
      sql.includes("FROM external_source_sync_items")
    ) {
      const runId = String(bindings[3]);
      for (const staged of this.externalSourceSyncItems.values()) {
        if (staged.runId !== runId) {
          continue;
        }
        const existing = this.itemSnapshots.get(staged.itemKey);
        this.itemSnapshots.set(staged.itemKey, {
          item_key: staged.itemKey,
          content_hash: staged.contentHash,
          payload: staged.payload,
          source_group: staged.sourceGroup,
          first_seen_at: existing?.first_seen_at ?? String(bindings[0]),
          updated_at:
            existing !== undefined && existing.content_hash === staged.contentHash
              ? existing.updated_at
              : String(bindings[1]),
          last_seen_at: String(bindings[2]),
          missing_since: null
        });
        changes += 1;
      }
    } else if (sql.includes("INSERT INTO item_snapshots")) {
      const row = {
        item_key: String(bindings[0]),
        content_hash: String(bindings[1]),
        payload: String(bindings[2]),
        source_group: String(bindings[3]),
        first_seen_at: String(bindings[4]),
        updated_at: String(bindings[5]),
        last_seen_at: String(bindings[6] ?? bindings[5]),
        missing_since: null
      };
      this.itemSnapshots.set(row.item_key, row);
      changes = 1;
    } else if (sql.includes("INSERT INTO external_source_sync_items")) {
      const row = {
        runId: String(bindings[0]),
        itemKey: String(bindings[1]),
        contentHash: String(bindings[2]),
        payload: String(bindings[3]),
        sourceGroup: String(bindings[4]),
        createdAt: String(bindings[5])
      };
      this.externalSourceSyncItems.set(`${row.runId}\u0000${row.itemKey}`, row);
      changes = 1;
    } else if (
      sql.includes("DELETE FROM external_source_sync_items") &&
      sql.includes("created_at <")
    ) {
      const createdBefore = String(bindings[0]);
      for (const [key, row] of this.externalSourceSyncItems.entries()) {
        if (row.createdAt < createdBefore) {
          this.externalSourceSyncItems.delete(key);
          changes += 1;
        }
      }
    } else if (sql.includes("DELETE FROM external_source_sync_items")) {
      const runId = String(bindings[0]);
      for (const [key, row] of this.externalSourceSyncItems.entries()) {
        if (row.runId === runId) {
          this.externalSourceSyncItems.delete(key);
          changes += 1;
        }
      }
    } else if (sql.includes("VALUES ('last_synced_at'")) {
      this.appState.set("last_synced_at", String(bindings[0]));
      this.appStateUpdatedAt.set("last_synced_at", String(bindings[1]));
      changes = 1;
    } else if (sql.includes("VALUES ('last_source_stats'")) {
      this.appState.set("last_source_stats", String(bindings[0]));
      this.appStateUpdatedAt.set("last_source_stats", String(bindings[1]));
      changes = 1;
    } else if (
      sql.includes("INSERT INTO app_state") &&
      sql.includes("WHERE app_state.value = ''")
    ) {
      const key = String(bindings[0]);
      const existingValue = this.appState.get(key);
      const existingUpdatedAt = this.appStateUpdatedAt.get(key) ?? "";
      if (
        existingValue === undefined ||
        existingValue === "" ||
        existingUpdatedAt < String(bindings[3])
      ) {
        this.appState.set(key, String(bindings[1]));
        this.appStateUpdatedAt.set(key, String(bindings[2]));
        changes = 1;
      }
    } else if (sql.includes("INSERT INTO app_state")) {
      this.appState.set(String(bindings[0]), String(bindings[1]));
      this.appStateUpdatedAt.set(String(bindings[0]), String(bindings[2]));
      changes = 1;
    } else if (sql.includes("UPDATE app_state") && sql.includes("value = ''")) {
      const key = String(bindings[1]);
      if (this.appState.get(key) === String(bindings[2])) {
        this.appState.set(key, "");
        this.appStateUpdatedAt.set(key, String(bindings[0]));
        changes = 1;
      }
    } else if (sql.includes("INSERT OR IGNORE INTO new_deadline_notifications")) {
      const itemKey = String(bindings[0]);
      if (!this.newDeadlineNotifications.some((entry) => String(entry[0]) === itemKey)) {
        this.newDeadlineNotifications.push(bindings);
        changes = 1;
      }
    } else if (
      sql.includes("UPDATE item_snapshots") &&
      sql.includes("COALESCE(last_seen_at, '')")
    ) {
      const now = String(bindings[0]);
      const lastSeenAt = String(bindings.at(-1));
      const sourceGroups = new Set(bindings.slice(1, -1).map(String));
      for (const row of this.itemSnapshots.values()) {
        if (
          sourceGroups.has(row.source_group) &&
          row.last_seen_at !== lastSeenAt &&
          row.missing_since === null
        ) {
          row.missing_since = now;
          changes += 1;
        }
      }
    } else if (sql.includes("UPDATE item_snapshots") && sql.includes("missing_since")) {
      const itemKey = String(bindings[1]);
      const row = this.itemSnapshots.get(itemKey);
      if (row !== undefined && row.missing_since === null) {
        row.missing_since = String(bindings[0]);
        changes = 1;
      }
    } else if (sql.includes("UPDATE new_deadline_notifications SET sent_at")) {
      const id = Number(bindings[1]);
      const entry = this.newDeadlineNotifications[id - 1];
      if (entry !== undefined) {
        entry[4] = bindings[0];
        changes = 1;
      }
    } else if (sql.includes("INSERT INTO mail_logs")) {
      this.mailLogs.push(bindings);
      changes = 1;
    } else if (sql.includes("INSERT INTO item_relevance_classifications")) {
      this.relevanceClassifications.set(String(bindings[0]), bindings);
      changes = 1;
    } else if (sql.includes("INSERT INTO item_activity_type_classifications")) {
      this.activityTypeClassifications.set(String(bindings[0]), bindings);
      changes = 1;
    } else if (sql.includes("INSERT INTO item_official_item_verifications")) {
      this.officialItemVerifications.set(String(bindings[0]), bindings);
      changes = 1;
    } else if (sql.includes("INSERT INTO visit_daily_stats")) {
      const key = `${String(bindings[0])}:${String(bindings[1])}:${String(bindings[2])}`;
      const existing = this.visitDailyStats.get(key);
      if (existing === undefined) {
        this.visitDailyStats.set(key, [
          bindings[0],
          bindings[1],
          bindings[2],
          bindings[3],
          bindings[4],
          1,
          bindings[5],
          bindings[6]
        ]);
      } else {
        existing[3] = bindings[3];
        existing[4] = bindings[4];
        existing[5] = Number(existing[5]) + 1;
        existing[7] = bindings[6];
      }
      changes = 1;
    }

    return {
      success: true,
      meta: { changes },
      results: []
    } as unknown as D1Result;
  }
}

describe("source normalization", () => {
  it("classifies project type only from explicit source or text evidence", () => {
    expect(getActivityTypeFromSourceGroup("camp2026").activityType).toBe("summer_camp");
    expect(getActivityTypeFromSourceGroup("yutuimian2026").activityType).toBe(
      "pre_recommendation"
    );
    expect(getActivityTypeFromText("计算机学院预推免通知")).toMatchObject({
      activityType: "pre_recommendation",
      activityTypeSource: "text"
    });
    expect(getActivityTypeFromText("计算机学院暑期夏令营通知")).toMatchObject({
      activityType: "summer_camp",
      activityTypeSource: "text"
    });
    expect(getActivityTypeFromText("暑期开放日暨2027年预推免报名通知")).toMatchObject({
      activityType: "pre_recommendation",
      activityTypeSource: "text"
    });
    expect(getActivityTypeFromText("研究生招生预报名通知").activityType).toBe("unknown");
    expect(getActivityTypeFromText("推免面试第一批通知").activityType).toBe(
      "pre_recommendation"
    );
    expect(getActivityTypeFromSourceGroup("baoyanxinxi2026jsjby").activityType).toBe(
      "unknown"
    );
    expect(getActivityTypeFromText("计算机学院 2026 招生通知").activityType).toBe("unknown");
  });

  it("uses item text instead of forcing a type for the mixed source page", () => {
    const result = normalizeBaoyanXinxiHtml(
      `
        <h2 id="测试大学"><a href="#测试大学"></a>测试大学</h2>
        <p>【报名截止：<span class="deadline" data-deadline="2026-09-01T23:59:59">Loading…</span>】<a href="https://example.com/pre">计算机学院预推免</a></p>
      `,
      "https://www.baoyanxinxi.cn/2026jsjby/"
    );

    expect(result.items[0]).toMatchObject({
      activityType: "pre_recommendation",
      activityTypeSource: "text"
    });

    const unknown = normalizeBaoyanXinxiHtml(
      `
        <h2 id="测试大学"><a href="#测试大学"></a>测试大学</h2>
        <p>【报名截止：<span class="deadline" data-deadline="2026-09-01T23:59:59">Loading…</span>】<a href="https://example.com/unknown">计算机学院招生通知</a></p>
      `,
      "https://www.baoyanxinxi.cn/2026jsjby/"
    );
    expect(unknown.items[0]).toMatchObject({
      activityType: "unknown",
      activityTypeSource: "unknown"
    });
  });

  it("flattens grouped CS-BAOYAN records", async () => {
    const items = await normalizeSourceData({
      camp2026: [
        {
          name: "北京大学",
          institute: "计算机学院",
          description: "夏令营",
          deadline: "2026-06-01T00:00:00+08:00",
          website: "https://example.com/a",
          tags: ["TOP2", "985", "保研信息平台/计算机大类"]
        }
      ]
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      sourceGroup: "camp2026",
      name: "北京大学",
      institute: "计算机学院",
      tags: ["TOP2", "985"]
    });
    expect(items[0]?.key).toMatch(/^[a-f0-9]{64}$/);
    expect(items[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("detects added and changed records", async () => {
    const [original] = await normalizeSourceData({
      camp2026: [
        {
          name: "南京大学",
          institute: "计算机学院",
          description: "夏令营",
          deadline: "2026-06-01T00:00:00+08:00",
          website: "https://example.com/a",
          tags: ["C9"]
        }
      ]
    });
    const [changed] = await normalizeSourceData({
      camp2026: [
        {
          name: "南京大学",
          institute: "计算机学院",
          description: "夏令营",
          deadline: "2026-06-03T00:00:00+08:00",
          website: "https://example.com/a",
          tags: ["C9"]
        }
      ]
    });

    expect(original).toBeDefined();
    expect(changed).toBeDefined();
    const changes = detectChanges([changed!], new Map([[original!.key, { content_hash: original!.contentHash }]]));

    expect(changes).toHaveLength(1);
    expect(changes[0]?.kind).toBe("changed");
  });

  it("parses BaoyanXinxi HTML records without hiding unrelated records", () => {
    const html = `
      <h2 id="清华大学"><a href="#清华大学"></a>清华大学</h2>
      <p>【报名截止：<span class="deadline" data-deadline="2026-6-20T24:00:00">Loading…</span>】<a target="_blank" href="https://example.com/cs?scene=1&amp;click_id=20">计算机系</a></p>
      <p>【报名截止：<span class="deadline" data-deadline="N/A">Loading…</span>】<a target="_blank" href="https://example.com/life">生命科学学院</a></p>
      <h2 id="中国科学技术大学"><a href="#中国科学技术大学"></a>中国科学技术大学</h2>
      <p>【报名截止：<span class="deadline" data-deadline="2026-06-23T23:59:59">Loading…</span>】<a target="_blank" href="/notice">网络空间安全学院</a></p>
    `;

    const result = normalizeBaoyanXinxiHtml(html, "https://www.baoyanxinxi.cn/2026jsjby/");

    expect(result.stats.rawCount).toBe(3);
    expect(result.stats.acceptedCount).toBe(3);
    expect(result.stats.filteredCount).toBe(0);
    expect(result.items.map((item) => item.institute)).toEqual([
      "计算机系",
      "生命科学学院",
      "网络空间安全学院"
    ]);
    expect(result.items[0]?.deadline).toBe("2026-06-20T16:00:00.000Z");
    expect(result.items[0]?.tags).toEqual(["Top2"]);
    expect(result.items[0]?.areas).toEqual(["计算机"]);
    expect(result.items[1]?.areas).toEqual(["其他"]);
    expect(result.items[2]?.website).toBe("https://www.baoyanxinxi.cn/notice");
  });

  it("parses every deadline-link pair when one paragraph contains multiple records", () => {
    const html = `
      <h2 id="清华大学"><a href="#清华大学"></a>清华大学</h2>
      <p>【报名截止：<span class="deadline" data-deadline="2026-07-28T15:00:00">Loading…</span>】<a href="https://example.com/tsinghua-all">全校类</a>|【报名截止：<span class="deadline" data-deadline="2026-07-28T15:00:00">Loading…</span>】<a href="https://example.com/tsinghua-sigs">深圳国际研究生院</a></p>
      <h2 id="同济大学"><a href="#同济大学"></a>同济大学</h2>
      <p>【报名截止：<span class="deadline" data-deadline="2026-09-19T24:00:00">Loading…</span>】<a href="https://example.com/tongji-all">全校类</a>|【报名截止：<span class="deadline" data-deadline="2026-10-07T24:00:00">Loading…</span>】<a href="https://example.com/tongji-plan">国优计划</a></p>
    `;

    const result = normalizeBaoyanXinxiHtml(html, "https://www.baoyanxinxi.cn/2026jsjby/");

    expect(result.stats.rawCount).toBe(4);
    expect(result.stats.acceptedCount).toBe(4);
    expect(result.items.map((item) => item.institute)).toEqual([
      "全校类",
      "深圳国际研究生院",
      "全校类",
      "国优计划"
    ]);
    expect(result.items.map((item) => item.deadline)).toEqual([
      "2026-07-28T07:00:00.000Z",
      "2026-07-28T07:00:00.000Z",
      "2026-09-19T16:00:00.000Z",
      "2026-10-07T16:00:00.000Z"
    ]);
    expect(result.items.map((item) => item.website)).toEqual([
      "https://example.com/tsinghua-all",
      "https://example.com/tsinghua-sigs",
      "https://example.com/tongji-all",
      "https://example.com/tongji-plan"
    ]);
  });

  it("normalizes BaoyanXinxi deadlines", () => {
    expect(normalizeBaoyanXinxiDeadline("N/A")).toBe("");
    expect(normalizeBaoyanXinxiDeadline("暂无")).toBe("");
    expect(normalizeBaoyanXinxiDeadline("2026-6-20T00:00:00+8:00")).toBe(
      "2026-06-19T16:00:00.000Z"
    );
    expect(normalizeBaoyanXinxiDeadline("2026-06-20T24:00:00")).toBe(
      "2026-06-20T16:00:00.000Z"
    );
    expect(normalizeBaoyanXinxiDeadline("2026-06-20T23:59:59")).toBe(
      "2026-06-20T15:59:59.000Z"
    );
  });

  it("keeps computer and electronic information records and filters unrelated records", () => {
    expect(isBaoyanXinxiRelevant("南京大学", "人工智能学院-LAMDA实验室")).toBe(true);
    expect(isBaoyanXinxiRelevant("中国科学技术大学", "网络空间安全学院")).toBe(true);
    expect(isBaoyanXinxiRelevant("哈尔滨工业大学", "电子与信息工程学院")).toBe(true);
    expect(isBaoyanXinxiRelevant("浙江大学", "信息与电子工程学院")).toBe(true);
    expect(isBaoyanXinxiRelevant("中国人民大学", "信息学院")).toBe(true);
    expect(isBaoyanXinxiRelevant("鹏城国家实验室", "鹏城国家实验室")).toBe(true);
    expect(isBaoyanXinxiRelevant("北京邮电大学", "未来学院")).toBe(true);
    expect(isBaoyanXinxiRelevant("电子科技大学", "电子工程系")).toBe(true);
    expect(isBaoyanXinxiRelevant("复旦大学", "公共卫生学院")).toBe(false);
    expect(isBaoyanXinxiRelevant("浙江大学", "材料科学与工程学院")).toBe(false);
    expect(isBaoyanXinxiRelevant("北京大学", "光华管理学院")).toBe(false);
    expect(isBaoyanXinxiRelevant("电子科技大学", "基础与前沿研究院")).toBe(false);
  });

  it("classifies borderline records but still publishes them for user-side filtering", () => {
    expect(classifyBaoyanXinxiRecord("北京大学深圳研究生院", "科学智能学院")).toBe("review");
    expect(classifyBaoyanXinxiRecord("香港科技大学（广州）", "智能制造理学硕士项目")).toBe("review");
    const html = `
      <h2 id="北京大学深圳研究生院"><a href="#北京大学深圳研究生院"></a>北京大学深圳研究生院</h2>
      <p>【报名截止：<span class="deadline" data-deadline="2099-06-20T23:59:59">Loading…</span>】<a target="_blank" href="https://example.com/pku-smart">科学智能学院</a></p>
    `;
    const result = normalizeBaoyanXinxiHtml(html, "https://www.baoyanxinxi.cn/2026jsjby/");

    expect(result.items).toHaveLength(1);
    expect(result.reviewCandidates).toHaveLength(0);
    expect(result.stats.reviewCandidateCount).toBe(0);
    expect(result.items[0]).toMatchObject({
      name: "北京大学深圳研究生院",
      institute: "科学智能学院",
      website: "https://example.com/pku-smart",
      areas: ["人工智能"]
    });
  });

  it("assigns direction areas for user-side filtering", () => {
    expect(getBaoyanXinxiAreas("浙江大学", "网络空间安全学院")).toEqual(["网络安全"]);
    expect(getBaoyanXinxiAreas("浙江大学", "信息与电子工程学院")).toEqual(["电子信息"]);
    expect(getBaoyanXinxiAreas("中山大学", "电子与通信工程学院")).toEqual([
      "电子信息",
      "通信"
    ]);
    expect(getBaoyanXinxiAreas("复旦大学", "公共卫生学院")).toEqual(["其他"]);
  });

  it("adds conservative school tier tags", () => {
    expect(getSchoolTierTags("北京大学")).toEqual(["Top2"]);
    expect(getSchoolTierTags("中国科学技术大学")).toEqual(["华五"]);
    expect(getSchoolTierTags("哈尔滨工业大学")).toEqual(["C9"]);
    expect(getSchoolTierTags("东北大学")).toEqual(["985"]);
    expect(getSchoolTierTags("湖南大学")).toEqual(["985"]);
    expect(getSchoolTierTags("电子科技大学")).toEqual(["985"]);
    expect(getSchoolTierTags("西北工业大学")).toEqual(["985"]);
    expect(getSchoolTierTags("西北农林科技大学")).toEqual(["985"]);
    expect(getSchoolTierTags("国防科学技术大学")).toEqual(["985"]);
    expect(getSchoolTierTags("北京邮电大学")).toEqual(["211"]);
    expect(getSchoolTierTags("华北电力大学")).toEqual(["211"]);
    expect(getSchoolTierTags("华北电力大学（保定）")).toEqual(["211"]);
    expect(getSchoolTierTags("北京科技大学")).toEqual(["211"]);
    expect(getSchoolTierTags("北京交通大学")).toEqual(["211"]);
    expect(getSchoolTierTags("西安电子科技大学")).toEqual(["211"]);
    expect(getSchoolTierTags("南京航空航天大学")).toEqual(["211"]);
    expect(getSchoolTierTags("中国地质大学（武汉）")).toEqual(["211"]);
    expect(getSchoolTierTags("中国政法大学")).toEqual(["211"]);
    expect(getSchoolTierTags("中央财经大学")).toEqual(["211"]);
    expect(getSchoolTierTags("郑州大学")).toEqual(["211"]);
    expect(getSchoolTierTags("新疆大学")).toEqual(["211"]);
    expect(getSchoolTierTags("中国科学院大学")).toEqual(["其他"]);
    expect(getSchoolTierTags("杭州电子科技大学")).toEqual(["其他"]);
  });

  it("canonicalizes notification URLs for cross-source dedupe", () => {
    expect(
      canonicalizeNotificationUrl(
        "https://mp.weixin.qq.com/s/example?scene=1&click_id=20&utm_source=test&a=1#wechat_redirect"
      )
    ).toBe("https://mp.weixin.qq.com/s/example?a=1");
    expect(
      canonicalizeNotificationUrl(
        "https://yjszs.neu.edu.cn/entrance#/detail?a=100&b=200"
      )
    ).toBe("https://yjszs.neu.edu.cn/entrance#/detail?a=100&b=200");
    expect(canonicalizeNotificationUrl("--help")).toBe("");
    expect(canonicalizeNotificationUrl("javascript:alert(1)")).toBe("");
  });

  it("dedupes BaoyanXinxi records by canonical source URL", async () => {
    const html = `
      <h2 id="清华大学"><a href="#清华大学"></a>清华大学</h2>
      <p>【报名截止：<span class="deadline" data-deadline="2026-06-20T23:59:59">Loading…</span>】<a target="_blank" href="https://mp.weixin.qq.com/s/example?click_id=20">计算机系</a></p>
      <p>【报名截止：<span class="deadline" data-deadline="2026-06-20T23:59:59">Loading…</span>】<a target="_blank" href="https://mp.weixin.qq.com/s/example?scene=1">计算机系</a></p>
    `;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(html, { status: 200, headers: { "content-type": "text/html" } });

    try {
      const result = await fetchSourceItemsWithStats({
        BAOYANXINXI_SOURCE_URL: "https://www.baoyanxinxi.cn/2026jsjby/"
      } as Env);

      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.sourceGroup).toBe("baoyanxinxi2026jsjby");
      expect(result.items[0]?.deadline).toBe("2026-06-20T15:59:59.000Z");
      expect(result.stats[0]).toMatchObject({
        duplicateCount: 1,
        supplementedDeadlineCount: 0
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("retries a transient source network failure", async () => {
    vi.useFakeTimers();
    const originalFetch = globalThis.fetch;
    let xingkeAttempts = 0;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("xingkebaoyan")) {
        xingkeAttempts += 1;
        if (xingkeAttempts === 1) {
          throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
        }
        return Response.json({
          items: [
            {
              school: "北京邮电大学",
              department: "计算机学院",
              title: "预推免报名通知",
              signup_end: "2099-09-10 17:00",
              url: "https://example.com/bupt-recommendation"
            }
          ]
        });
      }
      if (url.includes("baoyanxinxi")) {
        return new Response("", { status: 200 });
      }
      return Response.json({ code: 10000, data: { total: 0, list: [] } });
    };

    try {
      const resultPromise = fetchSourceItemsWithStats({} as Env);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(xingkeAttempts).toBe(2);
      expect(result.stats.find((stats) => stats.sourceGroup === "xingkebaoyan"))
        .toMatchObject({ acceptedCount: 1 });
    } finally {
      globalThis.fetch = originalFetch;
      vi.useRealTimers();
    }
  });

  it("retries a transient source response-body timeout", async () => {
    vi.useFakeTimers();
    const originalFetch = globalThis.fetch;
    let xingkeAttempts = 0;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("xingkebaoyan")) {
        xingkeAttempts += 1;
        return {
          ok: true,
          json: async () => {
            if (xingkeAttempts === 1) {
              throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
            }
            return {
              items: [
                {
                  school: "北京邮电大学",
                  department: "计算机学院",
                  title: "预推免报名通知",
                  signup_end: "2099-09-10 17:00",
                  url: "https://example.com/bupt-recommendation"
                }
              ]
            };
          }
        } as unknown as Response;
      }
      if (url.includes("baoyanxinxi")) {
        return new Response("", { status: 200 });
      }
      return Response.json({ code: 10000, data: { total: 0, list: [] } });
    };

    try {
      const resultPromise = fetchSourceItemsWithStats({} as Env);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(xingkeAttempts).toBe(2);
      expect(result.stats.find((stats) => stats.sourceGroup === "xingkebaoyan"))
        .toMatchObject({ acceptedCount: 1 });
    } finally {
      globalThis.fetch = originalFetch;
      vi.useRealTimers();
    }
  });

  it("stops after three retryable source failures", async () => {
    vi.useFakeTimers();
    const originalFetch = globalThis.fetch;
    let xingkeAttempts = 0;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("xingkebaoyan")) {
        xingkeAttempts += 1;
        throw new TypeError("fetch failed");
      }
      if (url.includes("baoyanxinxi")) {
        return new Response("", { status: 200 });
      }
      return Response.json({ code: 10000, data: { total: 0, list: [] } });
    };

    try {
      const resultPromise = fetchSourceItemsWithStats({} as Env);
      await vi.runAllTimersAsync();
      const result = await resultPromise;
      const xingkeStats = result.stats.find(
        (stats) => stats.sourceGroup === "xingkebaoyan"
      );

      expect(xingkeAttempts).toBe(3);
      expect(xingkeStats?.error).toContain("fetch failed");
    } finally {
      globalThis.fetch = originalFetch;
      vi.useRealTimers();
    }
  });

  it("does not retry a deterministic source client error", async () => {
    const originalFetch = globalThis.fetch;
    let xingkeAttempts = 0;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("xingkebaoyan")) {
        xingkeAttempts += 1;
        return new Response("not found", { status: 404, statusText: "Not Found" });
      }
      if (url.includes("baoyanxinxi")) {
        return new Response("", { status: 200 });
      }
      return Response.json({ code: 10000, data: { total: 0, list: [] } });
    };

    try {
      const result = await fetchSourceItemsWithStats({} as Env);
      const xingkeStats = result.stats.find(
        (stats) => stats.sourceGroup === "xingkebaoyan"
      );

      expect(xingkeAttempts).toBe(1);
      expect(xingkeStats?.error).toContain("404 Not Found");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("dedupes CS records with the same URL, school, institute, and deadline across groups", async () => {
    const items = await normalizeSourceData({
      camp2027: [
        {
          name: "中国科学技术大学",
          institute: "网络空间安全学院",
          description: "简短介绍",
          deadline: "2026-06-23T23:59:59+08:00",
          website: "https://cybersec.ustc.edu.cn/2026/0520/c23826a741220/page.htm",
          tags: ["华五"]
        }
      ],
      camp2026: [
        {
          name: "中国科学技术大学",
          institute: "网络空间安全学院",
          description: "更完整的网信安全科学营介绍",
          deadline: "2026-06-23T23:59:59+08:00",
          website: "https://cybersec.ustc.edu.cn/2026/0520/c23826a741220/page.htm",
          tags: ["华五"]
        }
      ]
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      sourceGroup: "camp2026",
      description: "更完整的网信安全科学营介绍"
    });
  });

  it("suppresses new DDL mail when a BaoyanXinxi record matches an old CS snapshot URL", async () => {
    const db = new FakeD1Database();
    const originalSourceItems = await normalizeSourceData({
      camp2026: [
        {
          name: "南京大学",
          institute: "计算机学院",
          description: "夏令营",
          deadline: "",
          website: "https://example.com/zju-cs",
          tags: ["C9"]
        }
      ]
    });
    const originalItem = originalSourceItems[0];
    expect(originalItem).toBeDefined();
    db.itemSnapshots.set(originalItem!.key, {
      item_key: originalItem!.key,
      content_hash: originalItem!.contentHash,
      payload: JSON.stringify(originalItem),
      source_group: originalItem!.sourceGroup,
      first_seen_at: "2026-06-18T00:00:00.000Z",
      updated_at: "2026-06-18T00:00:00.000Z",
      last_seen_at: "2026-06-18T00:00:00.000Z",
      missing_since: null
    });

    const html = `
      <h2 id="浙江大学"><a href="#浙江大学"></a>浙江大学</h2>
      <p>【报名截止：<span class="deadline" data-deadline="2099-06-20T23:59:59">Loading…</span>】<a target="_blank" href="https://example.com/zju-cs">计算机学院</a></p>
    `;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(html, { status: 200, headers: { "content-type": "text/html" } });

    try {
      const result = await runCheck({
        DB: db as unknown as D1Database,
        BAOYANXINXI_SOURCE_URL: "https://www.baoyanxinxi.cn/2026jsjby/",
        APP_BASE_URL: "https://example.com"
      } as Env);

      expect(result.detected).toBe(0);
      expect(result.deadlineDetected).toBe(0);
      expect(result.dailyDeadlineDetected).toBe(0);
      expect(result.newDeadlineDetected).toBe(0);
      expect(db.newDeadlineNotifications).toHaveLength(0);
      expect(result.sourceStats?.[0]).toMatchObject({
        sourceGroup: "baoyanxinxi2026jsjby",
        acceptedCount: 1
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("sends the daily 15-day digest at most once per Shanghai date", async () => {
    const db = new FakeD1Database();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T01:00:00.000Z"));
    const html = `
      <h2 id="南京大学"><a href="#南京大学"></a>南京大学</h2>
      <p>【报名截止：<span class="deadline" data-deadline="2026-06-10T23:59:59">Loading…</span>】<a target="_blank" href="https://example.com/cs">计算机学院</a></p>
    `;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(html, { status: 200, headers: { "content-type": "text/html" } });

    try {
      const first = await runCheck({
        DB: db as unknown as D1Database,
        BAOYANXINXI_SOURCE_URL: "https://example.com/baoyanxinxi.html",
        APP_BASE_URL: "https://example.com"
      } as Env, undefined, { sendEmails: true });
      const second = await runCheck({
        DB: db as unknown as D1Database,
        BAOYANXINXI_SOURCE_URL: "https://example.com/baoyanxinxi.html",
        APP_BASE_URL: "https://example.com"
      } as Env, undefined, { sendEmails: true });

      expect(first.dailyDeadlineDetected).toBe(1);
      expect(first.dailyDeadlineSent).toBe(1);
      expect(second.dailyDeadlineDetected).toBe(1);
      expect(second.dailyDeadlineSent).toBe(0);
      expect(db.appState.get("daily_deadline_digest_sent_date")).toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
      vi.useRealTimers();
    }
  });

  it("syncs sources by default without queuing or sending DDL mail", async () => {
    const db = new FakeD1Database();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T01:00:00.000Z"));
    const html = `
      <h2 id="南京大学"><a href="#南京大学"></a>南京大学</h2>
      <p>【报名截止：<span class="deadline" data-deadline="2026-06-10T23:59:59">Loading…</span>】<a target="_blank" href="https://example.com/cs">计算机学院</a></p>
    `;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(html, { status: 200, headers: { "content-type": "text/html" } });

    try {
      const result = await runCheck({
        DB: db as unknown as D1Database,
        BAOYANXINXI_SOURCE_URL: "https://example.com/baoyanxinxi.html",
        APP_BASE_URL: "https://example.com"
      } as Env);

      expect(result.scanned).toBe(1);
      expect(result.dailyDeadlineDetected).toBe(1);
      expect(result.dailyDeadlineSent).toBe(0);
      expect(result.newDeadlineDetected).toBe(0);
      expect(result.newDeadlineSent).toBe(0);
      expect(result.subscriberCount).toBe(0);
      expect(db.itemSnapshots.size).toBe(1);
      expect(db.newDeadlineNotifications).toHaveLength(0);
      expect(db.mailLogs).toHaveLength(0);
      expect(db.appState.get("last_synced_at")).toBeDefined();
      expect(db.appState.get("daily_deadline_digest_sent_date")).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
      vi.useRealTimers();
    }
  });

  it("keeps unrelated source records public but excludes them from email digests", async () => {
    const db = new FakeD1Database();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T01:00:00.000Z"));
    const html = `
      <h2 id="南京大学"><a href="#南京大学"></a>南京大学</h2>
      <p>【报名截止：<span class="deadline" data-deadline="2026-06-10T23:59:59">Loading…</span>】<a target="_blank" href="https://example.com/cs">计算机学院</a></p>
      <h2 id="复旦大学"><a href="#复旦大学"></a>复旦大学</h2>
      <p>【报名截止：<span class="deadline" data-deadline="2026-06-10T23:59:59">Loading…</span>】<a target="_blank" href="https://example.com/public-health">公共卫生学院</a></p>
    `;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(html, { status: 200, headers: { "content-type": "text/html" } });

    try {
      const result = await runCheck({
        DB: db as unknown as D1Database,
        BAOYANXINXI_SOURCE_URL: "https://example.com/baoyanxinxi.html",
        APP_BASE_URL: "https://example.com"
      } as Env, undefined, { sendEmails: true });

      expect(result.scanned).toBe(2);
      expect(result.dailyDeadlineDetected).toBe(1);
      expect(result.dailyDeadlineSent).toBe(1);
      expect(Array.from(db.itemSnapshots.values()).map((row) => row.source_group)).toEqual([
        "baoyanxinxi2026jsjby",
        "baoyanxinxi2026jsjby"
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      vi.useRealTimers();
    }
  });

  it("queues new DDL only for first-seen future-deadline items", async () => {
    const db = new FakeD1Database();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T01:00:00.000Z"));
    const originalItems = await normalizeSourceData({
      camp2026: [
        {
          name: "南京大学",
          institute: "计算机学院",
          description: "夏令营",
          deadline: "",
          website: "https://example.com/cs",
          tags: ["C9"]
        }
      ]
    });
    const originalItem = originalItems[0];
    expect(originalItem).toBeDefined();
    db.itemSnapshots.set(originalItem!.key, {
      item_key: originalItem!.key,
      content_hash: originalItem!.contentHash,
      payload: JSON.stringify(originalItem),
      source_group: originalItem!.sourceGroup,
      first_seen_at: "2026-06-18T00:00:00.000Z",
      updated_at: "2026-06-18T00:00:00.000Z",
      last_seen_at: "2026-06-18T00:00:00.000Z",
      missing_since: null
    });

    const html = `
      <h2 id="南京大学"><a href="#南京大学"></a>南京大学</h2>
      <p>【报名截止：<span class="deadline" data-deadline="N/A">Loading…</span>】<a target="_blank" href="https://example.com/cs">计算机学院</a></p>
      <h2 id="浙江大学"><a href="#浙江大学"></a>浙江大学</h2>
      <p>【报名截止：<span class="deadline" data-deadline="2026-06-10T23:59:59">Loading…</span>】<a target="_blank" href="https://example.com/zju">计算机学院</a></p>
      <h2 id="复旦大学"><a href="#复旦大学"></a>复旦大学</h2>
      <p>【报名截止：<span class="deadline" data-deadline="N/A">Loading…</span>】<a target="_blank" href="https://example.com/fdu">计算机学院</a></p>
    `;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(html, { status: 200, headers: { "content-type": "text/html" } });

    try {
      const first = await runCheck({
        DB: db as unknown as D1Database,
        BAOYANXINXI_SOURCE_URL: "https://example.com/baoyanxinxi.html",
        APP_BASE_URL: "https://example.com"
      } as Env, undefined, { sendEmails: true });
      const second = await runCheck({
        DB: db as unknown as D1Database,
        BAOYANXINXI_SOURCE_URL: "https://example.com/baoyanxinxi.html",
        APP_BASE_URL: "https://example.com"
      } as Env, undefined, { sendEmails: true });

      expect(first.newDeadlineDetected).toBe(1);
      expect(first.newDeadlineSent).toBe(1);
      expect(second.newDeadlineDetected).toBe(0);
      expect(second.newDeadlineSent).toBe(0);
      expect(db.newDeadlineNotifications).toHaveLength(1);
    } finally {
      globalThis.fetch = originalFetch;
      vi.useRealTimers();
    }
  });

  it("keeps unrelated source records public but out of email queues", async () => {
    const db = new FakeD1Database();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T01:00:00.000Z"));
    const html = `
      <h2 id="南京大学"><a href="#南京大学"></a>南京大学</h2>
      <p>【报名截止：<span class="deadline" data-deadline="2026-06-10T23:59:59">Loading…</span>】<a target="_blank" href="https://example.com/cs">计算机学院</a></p>
      <h2 id="复旦大学"><a href="#复旦大学"></a>复旦大学</h2>
      <p>【报名截止：<span class="deadline" data-deadline="2026-06-10T23:59:59">Loading…</span>】<a target="_blank" href="https://example.com/public-health">公共卫生学院</a></p>
    `;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(html, { status: 200, headers: { "content-type": "text/html" } });

    try {
      const result = await runCheck({
        DB: db as unknown as D1Database,
        BAOYANXINXI_SOURCE_URL: "https://example.com/baoyanxinxi.html",
        APP_BASE_URL: "https://example.com"
      } as Env, undefined, { sendEmails: true });
      const publicResponse = buildDdlResponse(Array.from(db.itemSnapshots.values()), new Date());

      expect(result.scanned).toBe(2);
      expect(result.dailyDeadlineDetected).toBe(1);
      expect(result.newDeadlineDetected).toBe(0);
      expect(publicResponse.items.map((entry) => entry.institute).sort()).toEqual([
        "公共卫生学院",
        "计算机学院"
      ]);
      expect(publicResponse.items.find((entry) => entry.institute === "公共卫生学院")?.areas).toEqual([
        "其他"
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      vi.useRealTimers();
    }
  });

  it("uses AI relevance classifications before email filtering", async () => {
    const db = new FakeD1Database();
    db.relevanceClassifications.set("https://example.com/public-health", [
      "https://example.com/public-health",
      "strong",
      JSON.stringify(["数据科学"]),
      "公共卫生项目包含医疗数据科学方向",
      "codex-ai",
      "2026-06-07T00:00:00.000Z",
      "2026-06-07T00:00:00.000Z",
      "2026-06-07T00:00:00.000Z"
    ]);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T01:00:00.000Z"));
    const html = `
      <h2 id="复旦大学"><a href="#复旦大学"></a>复旦大学</h2>
      <p>【报名截止：<span class="deadline" data-deadline="2026-06-10T23:59:59">Loading…</span>】<a target="_blank" href="https://example.com/public-health">公共卫生学院</a></p>
    `;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(html, { status: 200, headers: { "content-type": "text/html" } });

    try {
      const result = await runCheck({
        DB: db as unknown as D1Database,
        BAOYANXINXI_SOURCE_URL: "https://example.com/baoyanxinxi.html",
        APP_BASE_URL: "https://example.com"
      } as Env, undefined, { sendEmails: true });
      const publicResponse = buildDdlResponse(
        Array.from(db.itemSnapshots.values()),
        new Date(),
        null,
        new Map([
          [
            "https://example.com/public-health",
            {
              normalizedUrl: "https://example.com/public-health",
              relevance: "strong",
              areas: ["数据科学"],
              reason: "公共卫生项目包含医疗数据科学方向",
              classifier: "codex-ai",
              classifiedAt: "2026-06-07T00:00:00.000Z"
            }
          ]
        ])
      );

      expect(result.scanned).toBe(1);
      expect(result.dailyDeadlineDetected).toBe(1);
      expect(publicResponse.items[0]).toMatchObject({
        institute: "公共卫生学院",
        relevance: "strong",
        areas: ["数据科学"],
        relevanceReason: "公共卫生项目包含医疗数据科学方向"
      });
    } finally {
      globalThis.fetch = originalFetch;
      vi.useRealTimers();
    }
  });

  it("guards relevant rule matches from unrelated AI classifications", () => {
    const item: NormalizedItem = {
      key: "nwpu-cs",
      contentHash: "hash",
      sourceGroup: "baoyanxinxi2026jsjby",
      name: "西北工业大学",
      institute: "计算机学院",
      description: "保研信息平台补充源",
      deadline: "2026-07-02T03:59:59.000Z",
      website: "https://jsj.nwpu.edu.cn/info/1599/29795.htm",
      tags: ["985"],
      areas: ["计算机"]
    };
    const response = buildDdlResponse(
      [item],
      new Date("2026-06-26T04:00:00.000Z"),
      null,
      new Map([
        [
          "https://jsj.nwpu.edu.cn/info/1599/29795.htm",
          {
            normalizedUrl: "https://jsj.nwpu.edu.cn/info/1599/29795.htm",
            relevance: "unrelated",
            areas: ["其他"],
            reason: "AI 误判为无关",
            classifier: "codex-ai",
            classifiedAt: "2026-06-26T00:00:00.000Z"
          }
        ]
      ])
    );

    expect(response.items[0]).toMatchObject({
      school: "西北工业大学",
      institute: "计算机学院",
      relevance: "strong",
      areas: ["计算机"],
      relevanceClassifier: "codex-ai+rule-guard"
    });
  });

  it("promotes strong rule matches over possible AI classifications", () => {
    const item: NormalizedItem = {
      key: "ruc-info",
      contentHash: "hash",
      sourceGroup: "baoyanxinxi2026jsjby",
      name: "中国人民大学",
      institute: "信息学院",
      description: "保研信息平台补充源",
      deadline: "2026-07-05T13:59:59.000Z",
      website: "http://info.ruc.edu.cn/xwgg/xygg/0917bac9d080474ba20e5f024e9344e5.htm",
      tags: ["985"],
      areas: ["电子信息"]
    };
    const response = buildDdlResponse(
      [item],
      new Date("2026-06-30T04:00:00.000Z"),
      null,
      new Map([
        [
          "http://info.ruc.edu.cn/xwgg/xygg/0917bac9d080474ba20e5f024e9344e5.htm",
          {
            normalizedUrl: "http://info.ruc.edu.cn/xwgg/xygg/0917bac9d080474ba20e5f024e9344e5.htm",
            relevance: "possible",
            areas: ["其他"],
            reason: "标题含可能相关方向词，但缺少明确计算机类强相关院系表述",
            classifier: "codex-ai",
            classifiedAt: "2026-06-30T00:00:00.000Z"
          }
        ]
      ])
    );

    expect(response.items[0]).toMatchObject({
      school: "中国人民大学",
      institute: "信息学院",
      relevance: "strong",
      areas: ["电子信息"],
      relevanceClassifier: "codex-ai+rule-guard"
    });
  });

  it("treats Pengcheng National Laboratory as a strong AI related source", () => {
    const item: NormalizedItem = {
      key: "pcl",
      contentHash: "hash",
      sourceGroup: "baoyanxinxi2026jsjby",
      name: "鹏城国家实验室",
      institute: "鹏城国家实验室",
      description: "保研信息平台补充源",
      deadline: "2026-06-30T07:00:00.000Z",
      website: "https://mp.weixin.qq.com/s/9CWrI4ZAsc7kbcRRyPJxMw?scene=1&click_id=12",
      tags: ["其他"],
      areas: ["电子信息"]
    };
    const response = buildDdlResponse(
      [item],
      new Date("2026-06-30T04:00:00.000Z"),
      null,
      new Map([
        [
          "https://mp.weixin.qq.com/s/9CWrI4ZAsc7kbcRRyPJxMw",
          {
            normalizedUrl: "https://mp.weixin.qq.com/s/9CWrI4ZAsc7kbcRRyPJxMw",
            relevance: "possible",
            areas: ["电子信息"],
            reason: "命中可能相关关键词：电子信息",
            classifier: "codex-ai",
            classifiedAt: "2026-06-30T00:00:00.000Z"
          }
        ]
      ])
    );

    expect(response.items[0]).toMatchObject({
      school: "鹏城国家实验室",
      relevance: "strong",
      areas: ["电子信息"],
      relevanceClassifier: "codex-ai+rule-guard"
    });
  });

  it("does not promote broad electronic schools or intelligent manufacturing over AI classifications", () => {
    const items: NormalizedItem[] = [
      {
        key: "uestc-frontier",
        contentHash: "hash",
        sourceGroup: "baoyanxinxi2026jsjby",
        name: "电子科技大学",
        institute: "基础与前沿研究院",
        description: "保研信息平台补充源",
        deadline: "2026-07-15T15:59:59.000Z",
        website: "https://example.com/uestc-frontier",
        tags: ["985"],
        areas: ["其他"]
      },
      {
        key: "hkust-gz-manufacturing",
        contentHash: "hash",
        sourceGroup: "baoyanxinxi2026jsjby",
        name: "香港科技大学（广州）",
        institute: "智能制造理学硕士项目",
        description: "保研信息平台补充源",
        deadline: "2026-07-15T15:59:59.000Z",
        website: "https://example.com/hkust-gz-manufacturing",
        tags: ["其他"],
        areas: ["人工智能"]
      }
    ];
    const response = buildDdlResponse(
      items,
      new Date("2026-07-01T04:00:00.000Z"),
      null,
      new Map([
        [
          "https://example.com/uestc-frontier",
          {
            normalizedUrl: "https://example.com/uestc-frontier",
            relevance: "unrelated",
            areas: ["其他"],
            reason: "基础研究院未明确命中计算机类方向",
            classifier: "codex-ai",
            classifiedAt: "2026-07-01T00:00:00.000Z"
          }
        ],
        [
          "https://example.com/hkust-gz-manufacturing",
          {
            normalizedUrl: "https://example.com/hkust-gz-manufacturing",
            relevance: "possible",
            areas: ["人工智能"],
            reason: "智能制造可能相关但不够明确",
            classifier: "codex-ai",
            classifiedAt: "2026-07-01T00:00:00.000Z"
          }
        ]
      ])
    );

    expect(response.items[0]).toMatchObject({
      school: "电子科技大学",
      institute: "基础与前沿研究院",
      relevance: "unrelated",
      relevanceClassifier: "codex-ai"
    });
    expect(response.items[1]).toMatchObject({
      school: "香港科技大学（广州）",
      institute: "智能制造理学硕士项目",
      relevance: "possible",
      relevanceClassifier: "codex-ai"
    });
  });

  it("marks disappeared source records as missing without sending mail in sync-only mode", async () => {
    const db = new FakeD1Database();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        `
          <h2 id="南京大学"><a href="#南京大学"></a>南京大学</h2>
          <p>【报名截止：<span class="deadline" data-deadline="2099-06-10T23:59:59">Loading…</span>】<a target="_blank" href="https://example.com/nju">计算机学院</a></p>
        `,
        { status: 200, headers: { "content-type": "text/html" } }
      );
    const [finalizedItem] = (
      await fetchSourceItemsWithStats({
        BAOYANXINXI_SOURCE_URL: "https://example.com/baoyanxinxi.html"
      } as Env)
    ).items;
    expect(finalizedItem).toBeDefined();
    db.itemSnapshots.set(finalizedItem!.key, {
      item_key: finalizedItem!.key,
      content_hash: finalizedItem!.contentHash,
      payload: JSON.stringify(finalizedItem),
      source_group: finalizedItem!.sourceGroup,
      first_seen_at: "2026-06-18T00:00:00.000Z",
      updated_at: "2026-06-18T00:00:00.000Z",
      last_seen_at: "2026-06-18T00:00:00.000Z",
      missing_since: null
    });

    globalThis.fetch = async () =>
      new Response(`
        <h2 id="复旦大学"><a href="#复旦大学"></a>复旦大学</h2>
        <p>【报名截止：<span class="deadline" data-deadline="2099-06-10T23:59:59">Loading…</span>】<a target="_blank" href="https://example.com/life">生命科学学院</a></p>
      `, {
        status: 200,
        headers: { "content-type": "text/html" }
      });

    try {
      const result = await runCheck(
        {
          DB: db as unknown as D1Database,
          BAOYANXINXI_SOURCE_URL: "https://example.com/baoyanxinxi.html",
          APP_BASE_URL: "https://example.com"
        } as Env,
        "https://example.com",
        { sendEmails: false }
      );

      expect(result.missingCount).toBe(1);
      expect(result.newDeadlineDetected).toBe(0);
      expect(db.itemSnapshots.get(finalizedItem!.key)?.missing_since).toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("normalizes the Xingke JSON feed and keeps only upcoming records", () => {
    const result = normalizeXingkeData(
      {
        items: [
          {
            id: 1,
            school: "北京邮电大学",
            department: "计算机学院",
            title: "北京邮电大学计算机学院 2027 年推免预报名通知",
            category: "预推免",
            signup_end: "2026-09-10",
            url: "https://scs.bupt.edu.cn/info/1050/4416.htm",
            updated_at: "2026-07-27T08:00:00"
          },
          {
            id: 2,
            school: "北京邮电大学",
            department: "计算机学院",
            title: "已截止通知",
            category: "夏令营",
            signup_end: "2026-07-01",
            url: "https://example.com/expired"
          }
        ]
      },
      "https://xingkebaoyan.com/data.json",
      new Date("2026-07-27T00:00:00.000Z")
    );

    expect(result.stats).toMatchObject({ rawCount: 2, acceptedCount: 1, filteredCount: 1 });
    expect(result.items[0]).toMatchObject({
      sourceGroup: "xingkebaoyan",
      activityType: "pre_recommendation",
      deadlinePrecision: "date",
      sourceGroups: ["xingkebaoyan"]
    });
    expect(result.items[0]?.sourceObservations?.[0]).toMatchObject({
      sourceItemId: "1",
      publishedAt: "2026-07-27T00:00:00.000Z"
    });
  });

  it("removes invisible control characters from aggregate source text", () => {
    const result = normalizeXingkeData(
      {
        items: [
          {
            id: 1,
            school: "天津大学",
            department: "材料科学与工程学院",
            title: "2027年\u0007接收优秀应届本科毕业生免试攻读研究生预报名",
            category: "预推免",
            signup_end: "2026-09-10",
            url: "https://mse.tju.edu.cn/info/1133/6136.htm"
          }
        ]
      },
      "https://xingkebaoyan.com/data.json",
      new Date("2026-07-27T00:00:00.000Z")
    );

    expect(result.items[0]?.description).toBe(
      "2027年 接收优秀应届本科毕业生免试攻读研究生预报名"
    );
  });

  it("filters invalid URLs but retains valid placeholders for official verification", () => {
    const result = normalizeXingkeData(
      {
        items: [
          {
            id: 1,
            school: "待识别",
            department: "",
            title: "待补全",
            category: "",
            signup_end: "",
            url: "https://example.com/placeholder"
          },
          {
            id: 2,
            school: "测试大学",
            department: "计算机学院",
            title: "2027年推免预报名通知",
            category: "预推免",
            signup_end: "",
            url: "--help"
          }
        ]
      },
      "https://xingkebaoyan.com/data.json",
      new Date("2026-07-27T00:00:00.000Z")
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      name: "待识别",
      description: "待补全",
      website: "https://example.com/placeholder"
    });
    expect(result.stats).toMatchObject({ rawCount: 2, acceptedCount: 1, filteredCount: 1 });
  });

  it("retains Xingke notices without a structured deadline for official verification", () => {
    const result = normalizeXingkeData(
      {
        items: [
          {
            id: 2,
            school: "西安电子科技大学",
            department: "机电工程学院",
            title: "机电工程学院2027年推免生预报名通知",
            category: "预推免",
            signup_end: "",
            signup_end_text: "预报名系统预计开放至9月上旬，未公布具体日期",
            url: "https://eme.xidian.edu.cn/info/1012/16196.htm",
            updated_at: "2026-07-26T01:34:32"
          }
        ]
      },
      "https://xingkebaoyan.com/data.json",
      new Date("2026-07-27T00:00:00.000Z")
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      deadline: "",
      deadlinePrecision: "unknown"
    });
    expect(result.items[0]?.sourceObservations?.[0]?.deadlineRaw).toContain(
      "未公布具体日期"
    );
    expect(result.stats.unknownDeadlineCount).toBe(1);
  });

  it("normalizes the Baoyan Island API records without treating default end-of-day as exact", () => {
    const result = normalizeZscampusData(
      [
        {
          summerid: 100,
          universityname: "北京邮电大学",
          collegename: "计算机学院",
          summername: "北京邮电大学计算机学院 2027 年推免预报名通知",
          websiteUrl: "https://scs.bupt.edu.cn/info/1050/4416.htm",
          recruitType: "预推免",
          publishTime: "2026-07-27 08:00:00",
          endtime: "2026-09-10 23:59:59"
        }
      ],
      "https://api.zscampus.com/zs-baoyan-summer/summer/getListWithConditions",
      1,
      new Date("2026-07-27T00:00:00.000Z")
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      sourceGroup: "zscampus",
      activityType: "pre_recommendation",
      deadlinePrecision: "date"
    });
  });

  it("merges exact URLs, prefers an explicit time, and retains the conflict for review", () => {
    const entries: SourceItemInput[] = [
      {
        sourceGroup: "xingkebaoyan",
        name: "北京邮电大学",
        institute: "计算机学院",
        description: "北京邮电大学计算机学院 2027 年推免预报名通知",
        deadline: "2026-09-10T15:59:59.000Z",
        deadlinePrecision: "date",
        website: "https://scs.bupt.edu.cn/info/1050/4416.htm?utm_source=xingke",
        tags: ["211"],
        activityType: "pre_recommendation",
        activityTypeSource: "source"
      },
      {
        sourceGroup: "zscampus",
        name: "北京邮电大学",
        institute: "计算机学院",
        description: "北京邮电大学计算机学院 2027 年推免预报名通知",
        deadline: "2026-09-10T09:00:00.000Z",
        deadlinePrecision: "exact",
        website: "https://scs.bupt.edu.cn/info/1050/4416.htm",
        tags: ["211"],
        activityType: "pre_recommendation",
        activityTypeSource: "source"
      }
    ];

    const merged = mergeSourceItems(entries).items;
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      deadline: "2026-09-10T09:00:00.000Z",
      deadlinePrecision: "exact",
      deadlineConflict: true,
      mergeReason: "exact_url",
      sourceGroups: ["xingkebaoyan", "zscampus"]
    });
  });

  it("merges cross-source exact notice URLs even when deadline dates conflict", () => {
    const base = {
      name: "北京邮电大学",
      institute: "计算机学院",
      description: "北京邮电大学计算机学院2027年推免预报名通知",
      deadlinePrecision: "date" as const,
      website: "https://scs.bupt.edu.cn/info/1050/4416.htm",
      tags: ["211"],
      activityType: "pre_recommendation" as const,
      activityTypeSource: "text" as const
    };
    const merged = mergeSourceItems([
      {
        ...base,
        sourceGroup: "xingkebaoyan",
        deadline: "2026-09-10T15:59:59.000Z"
      },
      {
        ...base,
        sourceGroup: "zscampus",
        deadline: "2026-09-11T15:59:59.000Z"
      }
    ]).items;

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      deadline: "2026-09-10T15:59:59.000Z",
      deadlineConflict: true,
      mergeReason: "exact_url",
      sourceGroups: ["xingkebaoyan", "zscampus"]
    });
  });

  it("uses a later conflicting deadline only when the notice explicitly extends报名", () => {
    const base = {
      name: "中央财经大学",
      deadlinePrecision: "date" as const,
      website: "https://gs.cufe.edu.cn/info/1028/7101.htm",
      tags: ["211"],
      activityType: "pre_recommendation" as const,
      activityTypeSource: "text" as const
    };
    const merged = mergeSourceItems([
      {
        ...base,
        sourceGroup: "zscampus",
        institute: "全校类",
        description: "中央财经大学接收2027年推免生工作的通知",
        deadline: "2026-08-31T15:59:59.000Z"
      },
      {
        ...base,
        sourceGroup: "xingkebaoyan",
        institute: "",
        description: "关于延长中央财经大学接收2027年推免生报名时间至9月6日的通知",
        deadline: "2026-09-06T04:00:00.000Z"
      }
    ]).items;

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      deadline: "2026-09-06T04:00:00.000Z",
      deadlineConflict: true,
      mergeReason: "exact_url"
    });
  });

  it("title-matches after exact-url clusters have first been combined", () => {
    const base = {
      name: "中国科学院",
      institute: "上海高等研究院",
      deadline: "2026-09-18T15:59:59.000Z",
      deadlinePrecision: "date" as const,
      tags: [],
      activityType: "pre_recommendation" as const,
      activityTypeSource: "text" as const
    };
    const merged = mergeSourceItems([
      {
        ...base,
        sourceGroup: "baoyanxinxi2026jsjby",
        description: "保研信息平台补充源",
        website: "https://mp.weixin.qq.com/s/sari"
      },
      {
        ...base,
        sourceGroup: "xingkebaoyan",
        description: "中国科学院上海高等研究院接收2027年推荐免试研究生招生简章",
        website: "https://mp.weixin.qq.com/s/sari"
      },
      {
        ...base,
        sourceGroup: "zscampus",
        description: "2026年中国科学院上海高等研究院接收2027年推荐免试研究生招生简章",
        website: "https://sari.cas.cn/gradedu/202608/notice.html"
      }
    ]).items;

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      mergeReason: "title_match",
      sourceGroups: ["baoyanxinxi2026jsjby", "xingkebaoyan", "zscampus"]
    });
  });

  it("merges a mislabeled placeholder with the same specific official notice", () => {
    const website =
      "https://yjsy.ecnu.edu.cn/c7/d5/c42082a772053/page.htm";
    const merged = mergeSourceItems([
      {
        sourceGroup: "baoyanxinxi2026jsjby",
        name: "同济大学",
        institute: "卓越工程师学院",
        description: "保研信息平台补充源",
        deadline: "2026-09-10T09:00:00.000Z",
        deadlinePrecision: "exact",
        website,
        tags: ["985"]
      },
      {
        sourceGroup: "zscampus",
        name: "华东师范大学",
        institute: "卓越工程师学院",
        description: "华东师范大学卓越工程师学院2027年推免预报名通知",
        deadline: "2026-09-10T15:59:59.000Z",
        deadlinePrecision: "date",
        website,
        tags: ["985"]
      }
    ]).items;

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      name: "华东师范大学",
      deadline: "2026-09-10T09:00:00.000Z",
      sourceGroups: ["baoyanxinxi2026jsjby", "zscampus"]
    });
  });

  it("merges equivalent http and www variants without changing the preferred URL", () => {
    const base = {
      name: "中国科学院",
      institute: "国家空间科学中心",
      description: "中国科学院国家空间科学中心2027年招收推免研究生公告",
      deadline: "2026-09-28T15:59:59.000Z",
      deadlinePrecision: "date" as const,
      tags: []
    };
    const merged = mergeSourceItems([
      {
        ...base,
        sourceGroup: "baoyanxinxi2026jsjby",
        website:
          "https://nssc.cas.cn/yjsb/zsxx/zsdt/202607/t20260703_8241596.html"
      },
      {
        ...base,
        sourceGroup: "zscampus",
        website:
          "http://www.nssc.cas.cn/yjsb/zsxx/zsdt/202607/t20260703_8241596.html"
      }
    ]).items;

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      website: "https://nssc.cas.cn/yjsb/zsxx/zsdt/202607/t20260703_8241596.html",
      mergeReason: "exact_url",
      sourceGroups: ["baoyanxinxi2026jsjby", "zscampus"]
    });
  });

  it("merges controlled school aliases on the same specific notice", () => {
    const base = {
      institute: "国家空间科学中心",
      description: "中国科学院国家空间科学中心2027年招收推免研究生公告",
      deadlinePrecision: "date" as const,
      website:
        "https://nssc.cas.cn/yjsb/zsxx/zsdt/202607/t20260703_8241596.html",
      tags: []
    };
    const merged = mergeSourceItems([
      {
        ...base,
        sourceGroup: "zscampus",
        name: "中国科学院",
        deadline: "2026-09-28T15:59:59.000Z"
      },
      {
        ...base,
        sourceGroup: "xingkebaoyan",
        name: "中国科学院大学",
        deadline: "2026-09-30T15:59:59.000Z"
      }
    ]).items;

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      deadlineConflict: true,
      mergeReason: "exact_url",
      sourceGroups: ["xingkebaoyan", "zscampus"]
    });
  });

  it("recognizes query-parameter article pages as specific notices", () => {
    const base = {
      description: "中国科学院沈阳计算技术研究所接收2027年推荐免试硕士研究生的通知",
      deadline: "2026-10-20T15:59:59.000Z",
      deadlinePrecision: "date" as const,
      website:
        "https://yjs.sict.ac.cn/index.php?m=content&c=index&a=show&catid=15&id=189",
      tags: []
    };
    const merged = mergeSourceItems([
      {
        ...base,
        sourceGroup: "zscampus",
        name: "中国科学院",
        institute: "沈阳计算技术研究所"
      },
      {
        ...base,
        sourceGroup: "xingkebaoyan",
        name: "中国科学院沈阳计算技术研究所",
        institute: ""
      }
    ]).items;

    expect(merged).toHaveLength(1);
    expect(merged[0]?.sourceGroups).toEqual(["xingkebaoyan", "zscampus"]);
  });

  it("recognizes wbnewsid JSP article pages across institute aliases", () => {
    const base = {
      description:
        "哈尔滨工业大学（深圳）智能学部低空科学技术研究院关于2027年接收推免生报名的通知",
      deadline: "2026-09-10T15:59:59.000Z",
      deadlinePrecision: "date" as const,
      website:
        "http://intelligence.hitsz.edu.cn/currency.jsp?urltype=news.NewsContentUrl&wbnewsid=1921&wbtreeid=1259",
      tags: ["C9"]
    };
    const merged = mergeSourceItems([
      {
        ...base,
        sourceGroup: "baoyanxinxi2026jsjby",
        name: "哈尔滨工业大学",
        institute: "（深圳）智能学部低空科学技术研究院"
      },
      {
        ...base,
        sourceGroup: "xingkebaoyan",
        name: "哈尔滨工业大学（深圳）",
        institute: "低空科学技术研究院"
      },
      {
        ...base,
        sourceGroup: "zscampus",
        name: "哈尔滨工业大学（深圳）",
        institute: "智能学部"
      }
    ]).items;

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      mergeReason: "exact_url",
      sourceGroups: ["baoyanxinxi2026jsjby", "xingkebaoyan", "zscampus"]
    });
  });

  it("recognizes SPA detail routes when merging controlled school aliases", () => {
    const base = {
      description: "东北大学秦皇岛分校2027年推免预报名通知",
      deadlinePrecision: "date" as const,
      website:
        "https://yjszs.neu.edu.cn/yjszs/plugins/zs/ytmxsd/entrance#/tmfwksdExemptionEntranceDetail?a=1784261498698001298&b=1784085098695001298",
      tags: []
    };
    const merged = mergeSourceItems([
      {
        ...base,
        sourceGroup: "xingkebaoyan",
        name: "东北大学",
        institute: "秦皇岛分校",
        deadline: "2026-09-16T04:00:00.000Z"
      },
      {
        ...base,
        sourceGroup: "zscampus",
        name: "东北大学秦皇岛分校",
        institute: "全校类",
        deadline: "2026-09-16T15:59:59.000Z"
      }
    ]).items;

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      deadlineConflict: true,
      sourceGroups: ["xingkebaoyan", "zscampus"]
    });
  });

  it("keeps genuinely different institutions separate on a shared official notice", () => {
    const base = {
      institute: "合肥物质科学研究院",
      description: "2026年优秀大学生夏令营通知",
      deadline: "2026-07-30T15:59:59.000Z",
      deadlinePrecision: "date" as const,
      website:
        "https://hf.cas.cn/sbpy/yjsc/zs/zs_zsxc/zsxc_dxsxly/202607/t20260702_8237108.html",
      tags: []
    };
    const merged = mergeSourceItems([
      {
        ...base,
        sourceGroup: "baoyanxinxi2026jsjby",
        name: "中国科学技术大学"
      },
      {
        ...base,
        sourceGroup: "zscampus",
        name: "中国科学院"
      }
    ]).items;

    expect(merged).toHaveLength(2);
  });

  it("merges the controlled USTC and CAS metal-institute affiliation notice", () => {
    const website =
      "https://gs.imr.ac.cn/zs/zs_sszs/zs_sszs_tzgg/202608/t20260824_854503.html";
    const merged = mergeSourceItems([
      {
        sourceGroup: "zscampus",
        name: "中国科学技术大学",
        institute: "材料科学与工程学院",
        description: "中国科学技术大学材料科学与工程学院2027年接收推免生的通知",
        deadline: "2026-09-08T15:59:59.000Z",
        deadlinePrecision: "date",
        website,
        tags: []
      },
      {
        sourceGroup: "xingkebaoyan",
        name: "中国科学院金属研究所",
        institute: "材料科学与工程学院（金属所）",
        description: "中国科学院金属研究所2027年接收推荐免试研究生报名通知",
        deadline: "2026-09-08T15:59:59.000Z",
        deadlinePrecision: "date",
        website,
        tags: []
      }
    ]).items;

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      name: "中国科学技术大学",
      sourceGroups: ["xingkebaoyan", "zscampus"]
    });
  });

  it("merges an unidentified aggregate placeholder into its official notice", () => {
    const website = "https://www.cam.com.cn/YJSY/contents/1866/1888.html";
    const merged = mergeSourceItems([
      {
        sourceGroup: "baoyanxinxi2026jsjby",
        name: "中国机械科学研究总院集团有限公司",
        institute: "中国机械科学研究总院集团有限公司",
        description: "保研信息平台补充源",
        deadline: "2026-07-05T03:59:59.000Z",
        deadlinePrecision: "exact",
        website,
        tags: []
      },
      {
        sourceGroup: "xingkebaoyan",
        name: "待识别",
        institute: "",
        description: "待补全",
        deadline: "",
        deadlinePrecision: "unknown",
        website,
        tags: []
      }
    ]).items;

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      name: "中国机械科学研究总院集团有限公司",
      deadline: "2026-07-05T03:59:59.000Z",
      sourceGroups: ["baoyanxinxi2026jsjby", "xingkebaoyan"]
    });
  });

  it("treats numeric article paths as specific notices across deadline conflicts", () => {
    const base = {
      name: "中国科学院大学",
      institute: "数学科学学院",
      description: "中国科学院大学数学科学学院2027年接收推荐免试研究生公告",
      deadlinePrecision: "date" as const,
      website: "https://math.ucas.ac.cn/index.php/zh-CN/zsjy/sszs/3317-2027",
      tags: []
    };
    const merged = mergeSourceItems([
      {
        ...base,
        sourceGroup: "xingkebaoyan",
        deadline: "2026-08-18T15:59:59.000Z"
      },
      {
        ...base,
        sourceGroup: "zscampus",
        description:
          "2026年中国科学院大学数学科学学院2027年接收推荐免试研究生公告",
        deadline: "2026-08-30T15:59:59.000Z"
      }
    ]).items;

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      deadlineConflict: true,
      mergeReason: "exact_url",
      sourceGroups: ["xingkebaoyan", "zscampus"]
    });
  });

  it("merges a specific official notice despite different aggregator titles", () => {
    const merged = mergeSourceItems([
      {
        sourceGroup: "xingkebaoyan",
        name: "北京邮电大学",
        institute: "计算机学院",
        description: "2027 年推免预报名通知",
        deadline: "2026-09-10T15:59:59.000Z",
        deadlinePrecision: "date",
        website: "https://scs.bupt.edu.cn/info/1050/4416.htm",
        tags: ["211"]
      },
      {
        sourceGroup: "zscampus",
        name: "北京邮电大学",
        institute: "计算机学院",
        description: "接收优秀应届本科毕业生免试攻读研究生办法",
        deadline: "2026-09-11T15:59:59.000Z",
        deadlinePrecision: "date",
        website: "https://scs.bupt.edu.cn/info/1050/4416.htm?scene=1",
        tags: ["211"]
      }
    ]).items;

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      deadlineConflict: true,
      mergeReason: "exact_url",
      sourceGroups: ["xingkebaoyan", "zscampus"]
    });
  });

  it("merges cross-source institute aliases on the same specific notice and day", () => {
    const base = {
      name: "南京理工大学",
      description: "智能科学与技术学院优秀大学生校园开放日活动公告",
      deadline: "2026-07-30T15:59:59.000Z",
      deadlinePrecision: "date" as const,
      website: "https://mp.weixin.qq.com/s/specific-notice",
      tags: ["211"]
    };
    const merged = mergeSourceItems([
      {
        ...base,
        sourceGroup: "xingkebaoyan",
        institute: "智能制造学院"
      },
      {
        ...base,
        sourceGroup: "zscampus",
        institute: "智能科学与技术学院"
      }
    ]).items;

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      mergeReason: "exact_url",
      sourceGroups: ["xingkebaoyan", "zscampus"]
    });
  });

  it("merges institute aliases on a specific notice when one source has no deadline", () => {
    const base = {
      name: "哈尔滨工业大学",
      deadlinePrecision: "unknown" as const,
      website: "https://ise.hit.edu.cn/2026/0722/c16271a398085/page.htm",
      tags: ["C9"]
    };
    const merged = mergeSourceItems([
      {
        ...base,
        sourceGroup: "baoyanxinxi2026jsjby",
        institute: "仪器科学与工程学院-7月22日发布，分批审核",
        description: "保研信息平台补充源",
        deadline: ""
      },
      {
        ...base,
        sourceGroup: "xingkebaoyan",
        institute: "仪器科学与工程学院",
        description: "哈尔滨工业大学仪器科学与工程学院2027年接收推免生报名通知",
        deadline: ""
      }
    ]).items;

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      mergeReason: "exact_url",
      institute: "仪器科学与工程学院",
      sourceGroups: ["baoyanxinxi2026jsjby", "xingkebaoyan"]
    });
  });

  it("merges exact notice duplicates when one source supplies the missing deadline", () => {
    const merged = mergeSourceItems([
      {
        sourceGroup: "baoyanxinxi2026jsjby",
        name: "哈尔滨工业大学",
        institute: "（威海）汽车工程学院-7月23日发布，分两批审核",
        description: "保研信息平台补充源",
        deadline: "",
        deadlinePrecision: "unknown",
        website: "https://auto.hitwh.edu.cn/2026/0723/c189a216251/page.htm",
        tags: ["C9"]
      },
      {
        sourceGroup: "xingkebaoyan",
        name: "哈尔滨工业大学（威海）",
        institute: "汽车工程学院",
        description: "哈尔滨工业大学（威海）汽车工程学院2027年接收推免生报名通知",
        deadline: "2026-09-13T15:59:59.000Z",
        deadlinePrecision: "date",
        website: "https://auto.hitwh.edu.cn/2026/0723/c189a216251/page.htm",
        tags: ["C9"]
      }
    ]).items;

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      deadline: "2026-09-13T15:59:59.000Z",
      deadlinePrecision: "date",
      sourceGroups: ["baoyanxinxi2026jsjby", "xingkebaoyan"]
    });
  });

  it("merges same-source duplicate variants only when their exact notice titles agree", () => {
    const merged = mergeSourceItems([
      {
        sourceGroup: "xingkebaoyan",
        name: "上海财经大学",
        institute: "",
        description: "上海财经大学法学院2027年接收推荐免试研究生预报名的通知",
        deadline: "2026-08-20T15:59:59.000Z",
        deadlinePrecision: "date",
        website: "https://law.sufe.edu.cn/14/93/c7989a267411/page.htm",
        tags: ["211"]
      },
      {
        sourceGroup: "xingkebaoyan",
        name: "上海财经大学",
        institute: "法学院",
        description: "2026年上海财经大学法学院2027年接收推荐免试研究生预报名的通知",
        deadline: "2026-08-20T15:59:59.000Z",
        deadlinePrecision: "date",
        website: "https://law.sufe.edu.cn/14/93/c7989a267411/page.htm",
        tags: ["211"]
      }
    ]).items;

    expect(merged).toHaveLength(1);
  });

  it("keeps similar school-wide and institute-specific notices separate", () => {
    const base = {
      sourceGroup: "xingkebaoyan",
      name: "北京工业大学",
      deadlinePrecision: "unknown" as const,
      website: "https://yanzhao.bjut.edu.cn/info/1019/18119.htm",
      tags: ["211"]
    };
    const merged = mergeSourceItems([
      {
        ...base,
        institute: "",
        description: "北京工业大学2027年研究生招生宣传研学活动通知",
        deadline: ""
      },
      {
        ...base,
        institute: "建筑与城市规划学院",
        description: "北京工业大学建筑与城市规划学院2027年研究生招生宣传研学活动方案",
        deadline: ""
      }
    ]).items;

    expect(merged).toHaveLength(2);
  });

  it("treats adjacent midnight representations as the same deadline", () => {
    const base = {
      name: "同济大学",
      description: "同济大学2027年国优计划研究生招生报名通知",
      website: "https://cdibb.tongji.edu.cn/ca/ce/c37918a379598/page.htm",
      tags: ["985"]
    };
    const merged = mergeSourceItems([
      {
        ...base,
        sourceGroup: "baoyanxinxi2026jsjby",
        institute: "国优计划",
        deadline: "2026-10-07T16:00:00.000Z",
        deadlinePrecision: "exact"
      },
      {
        ...base,
        sourceGroup: "zscampus",
        institute: "全校类",
        deadline: "2026-10-07T15:59:59.000Z",
        deadlinePrecision: "date"
      }
    ]).items;

    expect(merged).toHaveLength(1);
    expect(merged[0]?.deadlineConflict).toBe(true);
  });

  it("keeps institute aliases separate when a specific notice has different deadline days", () => {
    const base = {
      name: "东南大学",
      description: "接收推荐免试研究生报名通知",
      deadlinePrecision: "date" as const,
      website: "https://example.edu.cn/2026/notice.html",
      tags: ["985"]
    };
    const merged = mergeSourceItems([
      {
        ...base,
        sourceGroup: "xingkebaoyan",
        institute: "计算机科学与工程学院",
        deadline: "2026-08-10T15:59:59.000Z"
      },
      {
        ...base,
        sourceGroup: "zscampus",
        institute: "软件学院",
        deadline: "2026-08-11T15:59:59.000Z"
      }
    ]).items;

    expect(merged).toHaveLength(2);
  });

  it("keeps same-source projects separate despite sharing a specific notice and day", () => {
    const base = {
      sourceGroup: "baoyanxinxi2026jsjby",
      name: "东南大学",
      description: "保研信息平台补充源",
      deadline: "2026-08-10T15:59:59.000Z",
      deadlinePrecision: "date" as const,
      website: "https://example.edu.cn/2026/notice.html",
      tags: ["985"]
    };
    const merged = mergeSourceItems([
      { ...base, institute: "计算机科学与工程学院" },
      { ...base, institute: "软件学院" }
    ]).items;

    expect(merged).toHaveLength(2);
  });

  it("keeps a generic application portal separate across deadline days", () => {
    const base = {
      name: "中国科学院大学",
      institute: "计算机学院",
      description: "2027 年接收推荐免试研究生报名通知",
      deadlinePrecision: "date" as const,
      website: "https://zhaosheng.ucas.ac.cn/sign_up/TMS/views/index.aspx",
      tags: []
    };
    const merged = mergeSourceItems([
      {
        ...base,
        sourceGroup: "xingkebaoyan",
        deadline: "2026-09-10T15:59:59.000Z"
      },
      {
        ...base,
        sourceGroup: "zscampus",
        deadline: "2026-09-11T15:59:59.000Z"
      }
    ]).items;

    expect(merged).toHaveLength(2);
  });

  it("keeps a generic application portal separate on the same day", () => {
    const base = {
      name: "中国科学院大学",
      description: "2027 年接收推荐免试研究生报名通知",
      deadline: "2026-09-10T15:59:59.000Z",
      deadlinePrecision: "date" as const,
      website: "https://zhaosheng.ucas.ac.cn/sign_up/TMS/views/index.aspx",
      tags: []
    };
    const merged = mergeSourceItems([
      {
        ...base,
        sourceGroup: "xingkebaoyan",
        institute: "计算机学院"
      },
      {
        ...base,
        sourceGroup: "zscampus",
        institute: "人工智能学院"
      }
    ]).items;

    expect(merged).toHaveLength(2);
  });

  it("does not merge generic application portals across conflicting notices", () => {
    const base = {
      name: "中国科学院大学",
      institute: "计算机学院",
      description: "",
      deadlinePrecision: "date" as const,
      website: "https://zhaosheng.ucas.ac.cn/sign_up/TMS/views/index.aspx",
      tags: [],
      activityType: "unknown" as const,
      activityTypeSource: "unknown" as const
    };
    const merged = mergeSourceItems([
      {
        ...base,
        sourceGroup: "xingkebaoyan",
        deadline: "2026-09-10T15:59:59.000Z"
      },
      {
        ...base,
        sourceGroup: "zscampus",
        deadline: "2026-09-11T15:59:59.000Z"
      }
    ]).items;

    expect(merged).toHaveLength(2);
  });

  it("only merges different URLs when school, institute, deadline, and title all agree", () => {
    const base: Omit<SourceItemInput, "sourceGroup" | "website"> = {
      name: "北京邮电大学",
      institute: "计算机学院",
      description: "北京邮电大学计算机学院 2027 年推免预报名通知",
      deadline: "2026-09-10T15:59:59.000Z",
      deadlinePrecision: "date",
      tags: ["211"],
      activityType: "pre_recommendation",
      activityTypeSource: "text"
    };
    const merged = mergeSourceItems([
      {
        ...base,
        sourceGroup: "xingkebaoyan",
        website: "https://mp.weixin.qq.com/s/example"
      },
      {
        ...base,
        sourceGroup: "zscampus",
        website: "https://scs.bupt.edu.cn/info/1050/4416.htm"
      }
    ]).items;

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      mergeReason: "title_match",
      website: "https://scs.bupt.edu.cn/info/1050/4416.htm"
    });
    expect(merged[0]?.alternateWebsites).toEqual(["https://mp.weixin.qq.com/s/example"]);
  });

  it("merges cross-source titles that differ only by fixed notice boilerplate", () => {
    const base = {
      name: "厦门大学",
      institute: "新闻传播学院",
      deadline: "2026-08-20T15:59:59.000Z",
      deadlinePrecision: "date" as const,
      tags: ["985"],
      activityType: "pre_recommendation" as const,
      activityTypeSource: "text" as const
    };
    const merged = mergeSourceItems([
      {
        ...base,
        sourceGroup: "xingkebaoyan",
        description:
          "厦门大学新闻传播学院关于2027年接收推荐免试研究生（含直博生）预报名的通知",
        website: "https://mp.weixin.qq.com/s/2SX2j6asHAimqWYvNS0UGw"
      },
      {
        ...base,
        sourceGroup: "zscampus",
        description:
          "2026年厦门大学新闻传播学院关于2027年接收推荐免试研究生预报名通知",
        website: "https://comm.xmu.edu.cn/info/1451/67382.htm"
      }
    ]).items;

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      website: "https://comm.xmu.edu.cn/info/1451/67382.htm",
      mergeReason: "title_match",
      sourceGroups: ["xingkebaoyan", "zscampus"]
    });
    expect(merged[0]?.alternateWebsites).toEqual([
      "https://mp.weixin.qq.com/s/2SX2j6asHAimqWYvNS0UGw"
    ]);
  });

  it("merges site-title suffixes and about-hosting boilerplate conservatively", () => {
    const base = {
      name: "吉林大学",
      institute: "药学院",
      deadline: "2026-09-01T15:59:59.000Z",
      deadlinePrecision: "date" as const,
      tags: ["985"]
    };
    const merged = mergeSourceItems([
      {
        ...base,
        sourceGroup: "xingkebaoyan",
        description:
          "关于举办吉林大学药学院2026年校园学术活动开放日的通知-吉林大学药学院",
        website: "https://yxy.jlu.edu.cn/info/1059/3785.htm"
      },
      {
        ...base,
        sourceGroup: "zscampus",
        description: "2026年吉林大学药学院2026年校园学术活动开放日的通知",
        website: "https://yxy.jlu.edu.cn/info/1257/3784.htm"
      }
    ]).items;

    expect(merged).toHaveLength(1);
    expect(merged[0]?.mergeReason).toBe("title_match");
  });

  it("keeps named special programs separate after title normalization", () => {
    const base = {
      name: "上海财经大学",
      institute: "数字经济学院",
      deadline: "2026-08-20T15:59:59.000Z",
      deadlinePrecision: "date" as const,
      tags: ["211"],
      activityType: "pre_recommendation" as const,
      activityTypeSource: "text" as const
    };
    const merged = mergeSourceItems([
      {
        ...base,
        sourceGroup: "xingkebaoyan",
        description:
          "2026年上海财经大学数字经济学院2027年接收推荐免试研究生预报名通知",
        website: "https://example.edu.cn/standard"
      },
      {
        ...base,
        sourceGroup: "zscampus",
        description:
          "2026年上海财经大学数字经济学院2027年接收推荐免试研究生（住企培养专项）预报名通知",
        website: "https://example.edu.cn/enterprise-program"
      }
    ]).items;

    expect(merged).toHaveLength(2);
    expect(merged.every((item) => item.mergeReason === "single")).toBe(true);
  });

  it("does not let a school-wide notice bridge separate institute notices", () => {
    const base = {
      name: "东南大学",
      deadline: "2026-07-31T15:59:59.000Z",
      deadlinePrecision: "date" as const,
      tags: ["985"],
      activityType: "pre_recommendation" as const,
      activityTypeSource: "text" as const
    };
    const merged = mergeSourceItems([
      {
        ...base,
        sourceGroup: "xingkebaoyan",
        institute: "自动化学院",
        description: "东南大学自动化学院2027年接收推荐免试研究生报名通知",
        website: "https://automation.seu.edu.cn/notice"
      },
      {
        ...base,
        sourceGroup: "xingkebaoyan",
        institute: "电气工程学院",
        description: "东南大学电气工程学院2027年接收推荐免试研究生报名通知",
        website: "https://ee.seu.edu.cn/notice"
      },
      {
        ...base,
        sourceGroup: "zscampus",
        institute: "",
        description: "2026年东南大学2027年接收推荐免试研究生报名通知",
        website: "https://yzb.seu.edu.cn/notice"
      }
    ]).items;

    expect(merged).toHaveLength(3);
    expect(merged.every((item) => item.mergeReason === "single")).toBe(true);
  });

  it("does not merge a parent institute notice with a sub-program notice", () => {
    const base = {
      name: "同济大学",
      deadline: "2026-08-01T15:59:59.000Z",
      deadlinePrecision: "date" as const,
      tags: ["985"],
      activityType: "pre_recommendation" as const,
      activityTypeSource: "text" as const
    };
    const merged = mergeSourceItems([
      {
        ...base,
        sourceGroup: "xingkebaoyan",
        institute: "交通学院",
        description: "交通学院2027年接收推荐免试研究生预报名通知",
        website: "https://tjjt.tongji.edu.cn/notice/college"
      },
      {
        ...base,
        sourceGroup: "zscampus",
        institute: "交通学院低空技术与工程",
        description: "低空技术与工程2027年接收推荐免试研究生预报名通知",
        website: "https://tjjt.tongji.edu.cn/notice/low-altitude"
      }
    ]).items;

    expect(merged).toHaveLength(2);
  });

  it("keeps title matching one-to-one for records from the same source", () => {
    const base = {
      name: "北京邮电大学",
      institute: "计算机学院",
      description: "北京邮电大学计算机学院2027年推免预报名通知",
      deadline: "2026-09-10T15:59:59.000Z",
      deadlinePrecision: "date" as const,
      tags: ["211"],
      activityType: "pre_recommendation" as const,
      activityTypeSource: "text" as const
    };
    const merged = mergeSourceItems([
      {
        ...base,
        sourceGroup: "xingkebaoyan",
        website: "https://example.com/xingke-one"
      },
      {
        ...base,
        sourceGroup: "xingkebaoyan",
        website: "https://example.com/xingke-two"
      },
      {
        ...base,
        sourceGroup: "zscampus",
        description: "2026年北京邮电大学计算机学院2027年推免预报名通知",
        website: "https://example.com/zscampus"
      }
    ]).items;

    expect(merged).toHaveLength(2);
    expect(
      merged.every(
        (item) => new Set(item.sourceGroups ?? [item.sourceGroup]).size ===
          (item.sourceGroups ?? [item.sourceGroup]).length
      )
    ).toBe(true);
  });

  it("merges a same-source alias only after another source corroborates it", () => {
    const base = {
      name: "同济大学",
      institute: "数学科学学院",
      deadline: "2026-09-08T15:59:59.000Z",
      deadlinePrecision: "date" as const,
      tags: ["985"],
      activityType: "pre_recommendation" as const,
      activityTypeSource: "text" as const
    };
    const merged = mergeSourceItems([
      {
        ...base,
        sourceGroup: "xingkebaoyan",
        description:
          "同济大学数学科学学院2027年接收推荐免试研究生（含直接攻博）预报名通知-同济大学数学科学学院",
        website: "https://math.tongji.edu.cn/info/1037/13364.htm"
      },
      {
        ...base,
        sourceGroup: "zscampus",
        description:
          "2026年同济大学数学科学学院2027年接收推荐免试研究生（含直接攻博）预报名通知",
        website: "https://math.tongji.edu.cn/info/1037/13364.htm"
      },
      {
        ...base,
        sourceGroup: "zscampus",
        description:
          "2026年同济大学数学科学学院2027年接收推荐免试研究生（含直接攻博）预报名通知",
        website: "https://math.tongji.edu.cn/info/1180/13366.htm"
      }
    ]).items;

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      mergeReason: "title_match",
      sourceGroups: ["xingkebaoyan", "zscampus"]
    });
    expect(merged[0]?.alternateWebsites).toEqual([
      "https://math.tongji.edu.cn/info/1180/13366.htm"
    ]);
  });

  it("keeps notices separate when a school reuses one application URL", () => {
    const base = {
      sourceGroup: "xingkebaoyan",
      name: "东南大学",
      deadline: "2026-07-31T15:59:59.000Z",
      deadlinePrecision: "date" as const,
      website: "https://yzb.seu.edu.cn/application",
      tags: ["985"],
      activityType: "pre_recommendation" as const,
      activityTypeSource: "text" as const
    };
    const merged = mergeSourceItems([
      {
        ...base,
        institute: "自动化学院",
        description: "东南大学自动化学院2027年接收推荐免试研究生报名通知"
      },
      {
        ...base,
        institute: "电气工程学院",
        description: "东南大学电气工程学院2027年接收推荐免试研究生报名通知"
      }
    ]).items;

    expect(merged).toHaveLength(2);
  });

  it("keeps distinct SPA hash routes as distinct notification URLs", () => {
    const base = {
      sourceGroup: "xingkebaoyan",
      name: "东北大学",
      institute: "计算机科学与工程学院",
      description: "东北大学2027年推免预报名通知",
      deadline: "2026-09-14T15:59:59.000Z",
      deadlinePrecision: "date" as const,
      tags: ["985"],
      activityType: "pre_recommendation" as const,
      activityTypeSource: "text" as const
    };
    const merged = mergeSourceItems([
      {
        ...base,
        website: "https://yjszs.neu.edu.cn/entrance#/detail?a=100&b=200"
      },
      {
        ...base,
        institute: "机器人科学与工程学院",
        deadline: "2026-09-09T15:59:59.000Z",
        website: "https://yjszs.neu.edu.cn/entrance#/detail?a=101&b=200"
      }
    ]).items;

    expect(merged).toHaveLength(2);
  });

  it("does not mark a multi-source snapshot missing while one of its observed sources failed", async () => {
    const db = new FakeD1Database();
    const previous: NormalizedItem = {
      key: "stable-key",
      contentHash: "previous-hash",
      sourceGroup: "baoyanxinxi2026jsjby",
      sourceGroups: ["baoyanxinxi2026jsjby", "xingkebaoyan"],
      name: "北京邮电大学",
      institute: "计算机学院",
      description: "通知",
      deadline: "2099-09-10T15:59:59.000Z",
      website: "https://example.com/previous",
      tags: ["211"]
    };
    db.itemSnapshots.set(previous.key, {
      item_key: previous.key,
      content_hash: previous.contentHash,
      payload: JSON.stringify(previous),
      source_group: previous.sourceGroup,
      first_seen_at: "2026-07-27T00:00:00.000Z",
      updated_at: "2026-07-27T00:00:00.000Z",
      last_seen_at: "2026-07-27T00:00:00.000Z",
      missing_since: null
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("baoyanxinxi")) {
        return new Response(
          `
            <h2 id="复旦大学"><a href="#复旦大学"></a>复旦大学</h2>
            <p>【报名截止：<span class="deadline" data-deadline="2099-10-10T23:59:59">Loading…</span>】<a href="https://example.com/current">生命科学学院</a></p>
          `,
          { status: 200 }
        );
      }
      if (url.includes("xingkebaoyan")) {
        throw new Error("temporary source failure");
      }
      return new Response(JSON.stringify({ code: 10000, data: { total: 0, list: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };

    try {
      const result = await runCheck({ DB: db as unknown as D1Database } as Env);
      expect(result.missingCount).toBe(0);
      expect(db.itemSnapshots.get(previous.key)?.missing_since).toBeNull();
      expect(result.sourceStats?.find((stats) => stats.sourceGroup === "xingkebaoyan")?.error).toContain(
        "temporary source failure"
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reuses an old merged snapshot key only once when notices split apart", async () => {
    const db = new FakeD1Database();
    const previous: NormalizedItem = {
      key: "old-merged-key",
      contentHash: "old-hash",
      sourceGroup: "baoyanxinxi2026jsjby",
      name: "东南大学",
      institute: "自动化学院",
      description: "保研信息平台补充源",
      deadline: "2099-07-31T15:59:59.000Z",
      website: "https://yzb.seu.edu.cn/application",
      tags: ["985"]
    };
    db.itemSnapshots.set(previous.key, {
      item_key: previous.key,
      content_hash: previous.contentHash,
      payload: JSON.stringify(previous),
      source_group: previous.sourceGroup,
      first_seen_at: "2099-07-01T00:00:00.000Z",
      updated_at: "2099-07-01T00:00:00.000Z",
      last_seen_at: "2099-07-01T00:00:00.000Z",
      missing_since: null
    });
    const html = `
      <h2 id="东南大学"><a href="#东南大学"></a>东南大学</h2>
      <p>【报名截止：<span class="deadline" data-deadline="2099-07-31T23:59:59">Loading…</span>】<a target="_blank" href="https://yzb.seu.edu.cn/application">自动化学院</a></p>
      <p>【报名截止：<span class="deadline" data-deadline="2099-07-31T23:59:59">Loading…</span>】<a target="_blank" href="https://yzb.seu.edu.cn/application">电气工程学院</a></p>
    `;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("baoyanxinxi")) {
        return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
      }
      if (url.includes("xingkebaoyan")) {
        return Response.json({ items: [] });
      }
      return Response.json({ code: 10000, data: { list: [], total: 0 } });
    };

    try {
      const result = await runCheck({ DB: db as unknown as D1Database } as Env);
      const activeItems = Array.from(db.itemSnapshots.values())
        .filter((row) => row.missing_since === null)
        .map((row) => JSON.parse(row.payload) as NormalizedItem);

      expect(result.scanned).toBe(2);
      expect(activeItems).toHaveLength(2);
      expect(new Set(activeItems.map((item) => item.key)).size).toBe(2);
      expect(activeItems.map((item) => item.institute).sort()).toEqual([
        "电气工程学院",
        "自动化学院"
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("email validation", () => {
  it("accepts ordinary email addresses", () => {
    expect(isValidEmail("student@example.com")).toBe(true);
  });

  it("rejects invalid email addresses", () => {
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
  });
});

describe("deadline reminders", () => {
  const now = new Date("2026-06-07T01:00:00.000Z");
  const item: NormalizedItem = {
    key: "item-key",
    contentHash: "content-hash",
    sourceGroup: "camp2026",
    name: "南京大学",
    institute: "计算机学院",
    description: "夏令营",
    deadline: "2026-06-10T00:00:00+08:00",
    website: "https://example.com/a",
    tags: ["C9"]
  };

  it("parses common deadline formats", () => {
    expect(parseDeadline("2026-06-20T00:00:00+08:00")?.toISOString()).toBe(
      "2026-06-19T16:00:00.000Z"
    );
    expect(parseDeadline("2026-6-20T00:00:00+8:00")?.toISOString()).toBe(
      "2026-06-19T16:00:00.000Z"
    );
    expect(parseDeadline("2025-09-10T16:00:00:00+08:00")?.toISOString()).toBe(
      "2025-09-10T08:00:00.000Z"
    );
    expect(parseDeadline("暂无")).toBeNull();
    expect(parseDeadline("待定")).toBeNull();
    expect(parseDeadline("")).toBeNull();
  });

  it("collects all valid future deadlines for the daily 15-day digest", () => {
    const digestItems = collectDailyDeadlineDigestItems(
      [
        item,
        {
          ...item,
          key: "future-15",
          deadline: "2026-06-22T00:00:00+08:00"
        },
        {
          ...item,
          key: "future-16",
          deadline: "2026-06-23T00:00:00+08:00"
        },
        {
          ...item,
          key: "expired",
          deadline: "2026-06-07T08:00:00+08:00"
        },
        {
          ...item,
          key: "unknown",
          deadline: "暂无"
        }
      ],
      15,
      now
    );

    expect(digestItems.map((entry) => entry.item.key)).toEqual(["item-key", "future-15"]);
  });

  it("uses the one-day label for same-day digest deadlines that have not passed", () => {
    const digestItems = collectDailyDeadlineDigestItems(
      [
        {
          ...item,
          deadline: "2026-06-07T17:00:00+08:00"
        }
      ],
      15,
      now
    );

    expect(digestItems).toHaveLength(1);
    expect(digestItems[0]?.reminderWindowDays).toBe(1);
  });

  it("collects new deadline notification candidates only for future deadlines", () => {
    const candidates = collectNewDeadlineNotificationCandidates(
      [
        item,
        {
          ...item,
          key: "expired",
          deadline: "2026-06-07T08:00:00+08:00"
        },
        {
          ...item,
          key: "unknown",
          deadline: ""
        }
      ],
      now
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.item.key).toBe("item-key");
  });
});

describe("DDL API", () => {
  const now = new Date("2026-06-07T01:00:00.000Z");

  it("serializes snapshot items for the public DDL API", () => {
    const response = buildDdlResponse(
      [
        {
          key: "future",
          contentHash: "hash",
          sourceGroup: "camp2026",
          name: "北京大学",
          institute: "计算机学院",
          description: "夏令营通知",
          deadline: "2026-06-10T00:00:00+08:00",
          website: "https://example.com/pku",
          tags: []
        },
        {
          key: "unknown",
          contentHash: "hash",
          sourceGroup: "camp2026",
          name: "清华大学",
          institute: "软件学院",
          description: "夏令营通知",
          deadline: "暂无",
          website: "https://example.com/thu",
          tags: []
        }
      ],
      now
    );

    expect(response.total).toBe(2);
    expect(response.items[0]).toMatchObject({
      key: "future",
      school: "北京大学",
      institute: "计算机学院",
      deadlineAt: "2026-06-09T16:00:00.000Z",
      remainingDays: 3,
      remainingText: "3 天后截止",
      status: "future",
      tier: "Top2",
      sourceLabel: "2026 夏令营"
    });
    expect(response.items[0]).not.toHaveProperty("contentHash");
    expect(response.items[0]).not.toHaveProperty("payload");
    expect(response.items[1]).toMatchObject({
      key: "unknown",
      deadlineAt: "",
      deadlineText: "待确认",
      remainingDays: null,
      remainingText: "截止时间待确认",
      status: "unknown",
      deadlinePrecision: "unknown"
    });
  });

  it("uses verified official deadlines over conflicting aggregate values", () => {
    const item: NormalizedItem = {
      key: "multi-source",
      contentHash: "hash",
      sourceGroup: "xingkebaoyan",
      sourceGroups: ["xingkebaoyan", "zscampus"],
      name: "北京邮电大学",
      institute: "计算机学院",
      description: "聚合站标题",
      deadline: "2026-09-10T15:59:59.000Z",
      deadlinePrecision: "date",
      deadlineConflict: true,
      website: "https://scs.bupt.edu.cn/info/1050/4416.htm",
      tags: ["211"]
    };
    const verification: OfficialItemVerification = {
      itemKey: "multi-source",
      normalizedUrl: "https://scs.bupt.edu.cn/info/1050/4416.htm",
      title: "官方预报名通知",
      deadline: "2026-09-10T09:00:00.000Z",
      deadlinePrecision: "exact",
      reason: "官方页面写明 17:00 截止",
      verifier: "luna-high",
      verifiedAt: "2026-07-27T08:00:00.000Z"
    };

    const response = buildDdlResponse(
      [item],
      now,
      null,
      new Map(),
      { officialVerifications: new Map([[verification.itemKey, verification]]) }
    );

    expect(response.items[0]).toMatchObject({
      description: "官方预报名通知",
      deadlineAt: "2026-09-10T09:00:00.000Z",
      deadlinePrecision: "exact",
      deadlineConflict: false,
      deadlineSource: "official-verification",
      officialVerifiedAt: "2026-07-27T08:00:00.000Z",
      sourceCount: 2,
      sourceLabels: ["星刻保研", "保研岛"]
    });
  });

  it("keeps a conservative source deadline when official verification has no deadline", () => {
    const item: NormalizedItem = {
      key: "no-fixed-deadline",
      contentHash: "hash",
      sourceGroup: "xingkebaoyan",
      sourceGroups: ["xingkebaoyan"],
      name: "哈尔滨工业大学（威海）",
      institute: "信息科学与工程学院",
      description: "接收推免生报名通知",
      deadline: "2026-09-20T15:59:59.000Z",
      deadlinePrecision: "date",
      website: "https://siee.hitwh.edu.cn/2026/0723/c1677a216258/page.htm",
      tags: ["C9"]
    };
    const verification: OfficialItemVerification = {
      itemKey: "no-fixed-deadline",
      normalizedUrl: item.website,
      title: item.description,
      deadline: "",
      deadlinePrecision: "unknown",
      reason: "官方通知仅说明分批审核，没有固定报名截止时间",
      verifier: "luna-high",
      verifiedAt: "2026-07-28T00:00:00.000Z"
    };

    const response = buildDdlResponse(
      [item],
      now,
      null,
      new Map(),
      { officialVerifications: new Map([[verification.itemKey, verification]]) }
    );

    expect(response.items[0]).toMatchObject({
      key: "no-fixed-deadline",
      deadlineAt: "2026-09-20T15:59:59.000Z",
      deadlineConflict: true,
      deadlineSource: "xingkebaoyan",
      officialVerifiedAt: "2026-07-28T00:00:00.000Z"
    });
  });

  it("ignores a stale official verification after source data changes", () => {
    const item: NormalizedItem = {
      key: "nankai-ai",
      contentHash: "hash",
      sourceGroup: "baoyanxinxi2026jsjby",
      name: "南开大学",
      institute: "人工智能学院",
      description: "预推免报名通知",
      deadline: "2026-08-24T04:00:00.000Z",
      deadlinePrecision: "exact",
      deadlineSource: "baoyanxinxi2026jsjby",
      website: "https://ai.nankai.edu.cn/info/1024/6632.htm",
      tags: []
    };
    const verification: OfficialItemVerification = {
      itemKey: item.key,
      normalizedUrl: item.website,
      title: "官方预推免报名通知",
      deadline: "2026-08-25T04:00:00.000Z",
      deadlinePrecision: "exact",
      reason: "错误选择了材料上传截止时间",
      verifier: "luna-high",
      verifiedAt: "2026-08-17T01:47:56.334Z"
    };
    const row = {
      item_key: item.key,
      content_hash: item.contentHash,
      payload: JSON.stringify(item),
      source_group: item.sourceGroup,
      first_seen_at: "2026-08-17T00:00:00.000Z",
      updated_at: "2026-08-25T00:38:17.142Z",
      last_seen_at: "2026-08-28T07:47:02.678Z",
      missing_since: null
    };

    const response = buildDdlResponse(
      [row],
      new Date("2026-08-20T00:00:00.000Z"),
      null,
      new Map(),
      { officialVerifications: new Map([[verification.itemKey, verification]]) }
    );

    expect(response.items[0]).toMatchObject({
      description: item.description,
      deadlineAt: "2026-08-24T04:00:00.000Z",
      deadlineSource: "baoyanxinxi2026jsjby",
      officialVerifiedAt: null
    });
  });

  it("keeps the earlier source deadline when a fresh verification selects a later stage", () => {
    const item: NormalizedItem = {
      key: "multi-stage",
      contentHash: "hash",
      sourceGroup: "baoyanxinxi2026jsjby",
      name: "测试大学",
      institute: "人工智能学院",
      description: "预推免报名通知",
      deadline: "2026-08-24T04:00:00.000Z",
      deadlinePrecision: "exact",
      deadlineSource: "baoyanxinxi2026jsjby",
      website: "https://example.com/multi-stage",
      tags: []
    };
    const verification: OfficialItemVerification = {
      itemKey: item.key,
      normalizedUrl: item.website,
      title: "官方预推免报名通知",
      deadline: "2026-08-25T04:00:00.000Z",
      deadlinePrecision: "exact",
      reason: "材料上传截止晚于系统报名截止",
      verifier: "luna-high",
      verifiedAt: "2026-08-20T00:00:00.000Z"
    };

    const response = buildDdlResponse(
      [item],
      new Date("2026-08-20T00:00:00.000Z"),
      null,
      new Map(),
      { officialVerifications: new Map([[verification.itemKey, verification]]) }
    );

    expect(response.items[0]).toMatchObject({
      description: verification.title,
      deadlineAt: "2026-08-24T04:00:00.000Z",
      deadlineConflict: true,
      deadlineSource: "baoyanxinxi2026jsjby",
      officialVerifiedAt: verification.verifiedAt
    });
  });

  it("accepts a later official deadline only when the official title says registration was extended", () => {
    const item: NormalizedItem = {
      key: "extended-deadline",
      contentHash: "hash",
      sourceGroup: "xingkebaoyan",
      name: "中央财经大学",
      institute: "金融学院",
      description: "2027年接收推荐免试研究生预报名通知",
      deadline: "2026-08-25T15:59:59.000Z",
      deadlinePrecision: "date",
      website: "https://example.com/extended-deadline",
      tags: []
    };
    const verification: OfficialItemVerification = {
      itemKey: item.key,
      normalizedUrl: item.website,
      title: "2027年接收推荐免试研究生预报名延期通知",
      deadline: "2026-08-31T15:59:59.000Z",
      deadlinePrecision: "date",
      reason: "官方标题明确说明报名延期",
      verifier: "luna-high",
      verifiedAt: "2026-08-26T00:00:00.000Z"
    };

    const response = buildDdlResponse(
      [item],
      new Date("2026-08-20T00:00:00.000Z"),
      null,
      new Map(),
      { officialVerifications: new Map([[verification.itemKey, verification]]) }
    );

    expect(response.items[0]).toMatchObject({
      description: verification.title,
      deadlineAt: verification.deadline,
      deadlineConflict: false,
      deadlineSource: "official-verification"
    });
  });

  it("treats a one-second source boundary difference as the same deadline", () => {
    const item: NormalizedItem = {
      key: "one-second-boundary",
      contentHash: "hash",
      sourceGroup: "baoyanxinxi2026jsjby",
      name: "南开大学",
      institute: "人工智能学院",
      description: "预推免报名通知",
      deadline: "2026-08-24T03:59:59.000Z",
      deadlinePrecision: "exact",
      deadlineSource: "baoyanxinxi2026jsjby",
      website: "https://example.com/one-second-boundary",
      tags: []
    };
    const verification: OfficialItemVerification = {
      itemKey: item.key,
      normalizedUrl: item.website,
      title: "官方预推免报名通知",
      deadline: "2026-08-24T04:00:00.000Z",
      deadlinePrecision: "exact",
      reason: "官网写明12:00截止",
      verifier: "luna-high",
      verifiedAt: "2026-08-20T00:00:00.000Z"
    };

    const response = buildDdlResponse(
      [item],
      new Date("2026-08-20T00:00:00.000Z"),
      null,
      new Map(),
      { officialVerifications: new Map([[verification.itemKey, verification]]) }
    );

    expect(response.items[0]).toMatchObject({
      deadlineAt: verification.deadline,
      deadlineConflict: false,
      deadlineSource: "official-verification",
      officialVerifiedAt: verification.verifiedAt
    });
  });

  it("does not share an official verification between items with the same URL", () => {
    const sharedWebsite = "https://gsas.fudan.edu.cn/shared-portal";
    const firstItem: NormalizedItem = {
      key: "fudan-forensic",
      contentHash: "hash-1",
      sourceGroup: "xingkebaoyan",
      name: "复旦大学",
      institute: "法医学与法庭科学学院",
      description: "法医学推免预报名通知",
      deadline: "2026-08-15T15:59:59.000Z",
      deadlinePrecision: "date",
      website: sharedWebsite,
      tags: []
    };
    const secondItem: NormalizedItem = {
      ...firstItem,
      key: "fudan-software",
      institute: "软件学院",
      description: "软件学院推免预报名通知",
      deadline: "2026-08-20T15:59:59.000Z"
    };
    const verification: OfficialItemVerification = {
      itemKey: firstItem.key,
      normalizedUrl: sharedWebsite,
      title: "法医学官方通知",
      deadline: "2026-08-10T09:00:00.000Z",
      deadlinePrecision: "exact",
      reason: "官方页面明确截止时间",
      verifier: "luna-high",
      verifiedAt: "2026-08-08T00:00:00.000Z"
    };

    const response = buildDdlResponse(
      [firstItem, secondItem],
      now,
      null,
      new Map(),
      { officialVerifications: new Map([[verification.itemKey, verification]]) }
    );

    expect(response.items).toHaveLength(2);
    expect(response.items.find((item) => item.key === firstItem.key)).toMatchObject({
      description: "法医学官方通知",
      deadlinePrecision: "exact"
    });
    expect(response.items.find((item) => item.key === secondItem.key)).toMatchObject({
      description: secondItem.description,
      deadlinePrecision: "date"
    });
  });

  it("can include expired items for local application link hydration", () => {
    const expiredItem = {
      key: "expired",
      contentHash: "hash",
      sourceGroup: "camp2026",
      name: "西安交通大学",
      institute: "软件学院",
      description: "夏令营通知",
      deadline: "2026-06-01T00:00:00+08:00",
      website: "https://example.com/xjtu-software",
      tags: []
    };

    const defaultResponse = buildDdlResponse([expiredItem], now);
    const archiveResponse = buildDdlResponse(
      [expiredItem],
      now,
      null,
      new Map(),
      { includeExpired: true }
    );

    expect(defaultResponse.items).toHaveLength(0);
    expect(archiveResponse.items[0]).toMatchObject({
      key: "expired",
      status: "expired",
      website: "https://example.com/xjtu-software"
    });
  });

  it("keeps stale expired items available for archived link hydration", () => {
    const response = buildDdlResponse(
      [
        {
          item_key: "stale-expired",
          content_hash: "hash",
          payload: JSON.stringify({
            key: "stale-expired",
            contentHash: "hash",
            sourceGroup: "baoyanxinxi2026jsjby",
            name: "西安交通大学",
            institute: "软件学院",
            description: "夏令营通知",
            deadline: "2026-06-01T00:00:00+08:00",
            website: "https://example.com/stale-expired",
            tags: []
          }),
          source_group: "baoyanxinxi2026jsjby",
          first_seen_at: "2026-06-01T00:00:00.000Z",
          updated_at: "2026-06-01T00:00:00.000Z",
          last_seen_at: "2026-06-01T00:00:00.000Z",
          missing_since: "2026-06-01T00:00:00.000Z"
        }
      ],
      now,
      null,
      new Map(),
      { includeExpired: true }
    );

    expect(response.items[0]).toMatchObject({
      key: "stale-expired",
      status: "expired",
      sourceVisibility: "stale",
      website: "https://example.com/stale-expired"
    });
  });

  it("dedupes existing snapshots with the same URL, school, institute, and deadline", () => {
    const response = buildDdlResponse(
      [
        {
          key: "wrong-year",
          contentHash: "hash",
          sourceGroup: "camp2027",
          name: "中国科学技术大学",
          institute: "网络空间安全学院",
          description: "简短介绍",
          deadline: "2026-06-23T23:59:59+08:00",
          website: "https://cybersec.ustc.edu.cn/2026/0520/c23826a741220/page.htm",
          tags: []
        },
        {
          key: "right-year",
          contentHash: "hash",
          sourceGroup: "camp2026",
          name: "中国科学技术大学",
          institute: "网络空间安全学院",
          description: "更完整的网信安全科学营介绍",
          deadline: "2026-06-23T23:59:59+08:00",
          website: "https://cybersec.ustc.edu.cn/2026/0520/c23826a741220/page.htm",
          tags: []
        }
      ],
      now
    );

    expect(response.total).toBe(1);
    expect(response.items[0]).toMatchObject({
      key: "right-year",
      sourceGroup: "camp2026",
      sourceLabel: "2026 夏令营"
    });
  });

  it("keeps different institutes that share an application URL", () => {
    const response = buildDdlResponse(
      [
        {
          key: "automation",
          contentHash: "hash-a",
          sourceGroup: "xingkebaoyan",
          name: "东南大学",
          institute: "自动化学院",
          description: "自动化学院推免通知",
          deadline: "2026-07-31T23:59:59+08:00",
          website: "https://yzb.seu.edu.cn/application",
          tags: []
        },
        {
          key: "electrical",
          contentHash: "hash-b",
          sourceGroup: "xingkebaoyan",
          name: "东南大学",
          institute: "电气工程学院",
          description: "电气工程学院推免通知",
          deadline: "2026-07-31T23:59:59+08:00",
          website: "https://yzb.seu.edu.cn/application",
          tags: []
        }
      ],
      new Date("2026-07-27T00:00:00.000Z")
    );

    expect(response.total).toBe(2);
  });

  it("hides grace aliases covered by a current exact-url multi-source merge", () => {
    const response = buildDdlResponse(
      [
        {
          item_key: "active-merged",
          content_hash: "a".repeat(64),
          payload: JSON.stringify({
            key: "active-merged",
            contentHash: "a".repeat(64),
            sourceGroup: "baoyanxinxi2026jsjby",
            sourceGroups: ["baoyanxinxi2026jsjby", "xingkebaoyan"],
            mergeReason: "exact_url",
            name: "哈尔滨工业大学",
            institute: "仪器科学与工程学院",
            description: "2027年接收推免生报名通知",
            deadline: "2026-09-10T15:59:59.000Z",
            website: "https://ise.hit.edu.cn/2026/0722/c16271a398085/page.htm",
            tags: []
          }),
          source_group: "baoyanxinxi2026jsjby",
          first_seen_at: "2026-07-27T00:00:00.000Z",
          updated_at: "2026-07-27T00:00:00.000Z",
          last_seen_at: "2026-07-27T00:00:00.000Z",
          missing_since: null
        },
        {
          item_key: "grace-alias",
          content_hash: "b".repeat(64),
          payload: JSON.stringify({
            key: "grace-alias",
            contentHash: "b".repeat(64),
            sourceGroup: "baoyanxinxi2026jsjby",
            sourceGroups: ["baoyanxinxi2026jsjby"],
            name: "哈尔滨工业大学",
            institute: "仪器科学与工程学院-7月22日发布",
            description: "保研信息平台补充源",
            deadline: "2026-09-10T15:59:59.000Z",
            website: "https://ise.hit.edu.cn/2026/0722/c16271a398085/page.htm",
            tags: []
          }),
          source_group: "baoyanxinxi2026jsjby",
          first_seen_at: "2026-07-26T00:00:00.000Z",
          updated_at: "2026-07-26T00:00:00.000Z",
          last_seen_at: "2026-07-26T00:00:00.000Z",
          missing_since: "2026-07-27T00:00:00.000Z"
        }
      ],
      new Date("2026-07-27T01:00:00.000Z")
    );

    expect(response.total).toBe(1);
    expect(response.items[0]?.key).toBe("active-merged");
  });

  it("hides grace aliases covered by a current title-match alternate URL", () => {
    const response = buildDdlResponse(
      [
        {
          item_key: "active-title-merge",
          content_hash: "c".repeat(64),
          payload: JSON.stringify({
            key: "active-title-merge",
            contentHash: "c".repeat(64),
            sourceGroup: "xingkebaoyan",
            sourceGroups: ["xingkebaoyan", "zscampus"],
            mergeReason: "title_match",
            name: "厦门大学",
            institute: "新闻传播学院",
            description: "2027年接收推荐免试研究生预报名通知",
            deadline: "2026-08-20T15:59:59.000Z",
            website: "https://comm.xmu.edu.cn/info/1451/67382.htm",
            alternateWebsites: [
              "https://mp.weixin.qq.com/s/2SX2j6asHAimqWYvNS0UGw"
            ],
            tags: []
          }),
          source_group: "xingkebaoyan",
          first_seen_at: "2026-07-28T00:00:00.000Z",
          updated_at: "2026-07-28T00:00:00.000Z",
          last_seen_at: "2026-07-28T00:00:00.000Z",
          missing_since: null
        },
        {
          item_key: "grace-title-alias",
          content_hash: "d".repeat(64),
          payload: JSON.stringify({
            key: "grace-title-alias",
            contentHash: "d".repeat(64),
            sourceGroup: "xingkebaoyan",
            sourceGroups: ["xingkebaoyan"],
            name: "厦门大学",
            institute: "新闻传播学院",
            description: "2027年接收推荐免试研究生预报名通知",
            deadline: "2026-08-20T15:59:59.000Z",
            website: "https://mp.weixin.qq.com/s/2SX2j6asHAimqWYvNS0UGw",
            tags: []
          }),
          source_group: "xingkebaoyan",
          first_seen_at: "2026-07-27T00:00:00.000Z",
          updated_at: "2026-07-27T00:00:00.000Z",
          last_seen_at: "2026-07-27T00:00:00.000Z",
          missing_since: "2026-07-28T00:00:00.000Z"
        }
      ],
      new Date("2026-07-28T01:00:00.000Z")
    );

    expect(response.total).toBe(1);
    expect(response.items[0]?.key).toBe("active-title-merge");
  });

  it("hides grace aliases that use a controlled school-name variant", () => {
    const website =
      "https://nssc.cas.cn/yjsb/zsxx/zsdt/202607/t20260703_8241596.html";
    const response = buildDdlResponse(
      [
        {
          item_key: "active-school-alias-merge",
          content_hash: "e".repeat(64),
          payload: JSON.stringify({
            key: "active-school-alias-merge",
            contentHash: "e".repeat(64),
            sourceGroup: "xingkebaoyan",
            sourceGroups: ["xingkebaoyan", "zscampus"],
            mergeReason: "exact_url",
            name: "中国科学院",
            institute: "国家空间科学中心",
            description: "2027年招收推免研究生公告",
            deadline: "2026-09-28T15:59:59.000Z",
            website,
            tags: []
          }),
          source_group: "xingkebaoyan",
          first_seen_at: "2026-07-28T00:00:00.000Z",
          updated_at: "2026-07-28T00:00:00.000Z",
          last_seen_at: "2026-07-28T00:00:00.000Z",
          missing_since: null
        },
        {
          item_key: "grace-school-alias",
          content_hash: "f".repeat(64),
          payload: JSON.stringify({
            key: "grace-school-alias",
            contentHash: "f".repeat(64),
            sourceGroup: "xingkebaoyan",
            sourceGroups: ["xingkebaoyan"],
            name: "中国科学院大学",
            institute: "国家空间科学中心",
            description: "2027年招收推免研究生公告",
            deadline: "2026-09-30T15:59:59.000Z",
            website,
            tags: []
          }),
          source_group: "xingkebaoyan",
          first_seen_at: "2026-07-27T00:00:00.000Z",
          updated_at: "2026-07-27T00:00:00.000Z",
          last_seen_at: "2026-07-27T00:00:00.000Z",
          missing_since: "2026-07-28T00:00:00.000Z"
        }
      ],
      new Date("2026-07-28T01:00:00.000Z")
    );

    expect(response.total).toBe(1);
    expect(response.items[0]?.key).toBe("active-school-alias-merge");
  });

  it("hides a grace record replaced at the same specific notice URL", () => {
    const website = "https://mp.weixin.qq.com/s/updated-notice";
    const response = buildDdlResponse(
      [
        {
          item_key: "current-update",
          content_hash: "1".repeat(64),
          payload: JSON.stringify({
            key: "current-update",
            contentHash: "1".repeat(64),
            sourceGroup: "xingkebaoyan",
            sourceGroups: ["xingkebaoyan"],
            name: "中央财经大学",
            institute: "国家数据工程与安全学院",
            description: "报名时间延长至9月6日的通知",
            deadline: "2026-09-06T04:00:00.000Z",
            website,
            tags: []
          }),
          source_group: "xingkebaoyan",
          first_seen_at: "2026-08-28T00:00:00.000Z",
          updated_at: "2026-08-28T00:00:00.000Z",
          last_seen_at: "2026-08-28T00:00:00.000Z",
          missing_since: null
        },
        {
          item_key: "grace-old",
          content_hash: "2".repeat(64),
          payload: JSON.stringify({
            key: "grace-old",
            contentHash: "2".repeat(64),
            sourceGroup: "xingkebaoyan",
            sourceGroups: ["xingkebaoyan"],
            name: "错误聚合站校名",
            institute: "金融学院",
            description: "报名补充说明",
            deadline: "2026-08-31T04:00:00.000Z",
            website,
            tags: []
          }),
          source_group: "xingkebaoyan",
          first_seen_at: "2026-08-27T00:00:00.000Z",
          updated_at: "2026-08-27T00:00:00.000Z",
          last_seen_at: "2026-08-27T00:00:00.000Z",
          missing_since: "2026-08-28T00:00:00.000Z"
        }
      ],
      new Date("2026-08-28T01:00:00.000Z")
    );

    expect(response.total).toBe(1);
    expect(response.items[0]?.key).toBe("current-update");
  });

  it("does not publish malformed or unusable placeholder records", () => {
    const response = buildDdlResponse(
      [
        {
          key: "invalid-url",
          contentHash: "hash-1",
          sourceGroup: "xingkebaoyan",
          name: "测试大学",
          institute: "计算机学院",
          description: "推免通知",
          deadline: "",
          website: "--help",
          tags: []
        },
        {
          key: "placeholder",
          contentHash: "hash-2",
          sourceGroup: "xingkebaoyan",
          name: "待识别",
          institute: "",
          description: "待补全",
          deadline: "",
          website: "https://example.com/placeholder",
          tags: []
        }
      ],
      new Date("2026-08-28T01:00:00.000Z")
    );

    expect(response.total).toBe(0);
  });

  it("publishes a verified placeholder record after recovering its organization from the official title", () => {
    const response = buildDdlResponse(
      [
        {
          key: "verified-placeholder",
          contentHash: "hash",
          sourceGroup: "xingkebaoyan",
          name: "待识别",
          institute: "",
          description: "关于举办中国机械总院2026年优秀大学生夏令营的通知",
          deadline: "2026-09-01T15:59:59.000Z",
          website: "https://www.cam.com.cn/YJSY/contents/1866/1888.html",
          tags: []
        }
      ],
      new Date("2026-08-28T01:00:00.000Z")
    );

    expect(response.items[0]).toMatchObject({
      school: "中国机械总院",
      description: "关于举办中国机械总院2026年优秀大学生夏令营的通知"
    });
  });

  it("reports source statistics for every source represented by a merged item", () => {
    const response = buildDdlResponse(
      [
        {
          key: "merged-source-stats",
          contentHash: "hash",
          sourceGroup: "baoyanxinxi2026jsjby",
          sourceGroups: ["baoyanxinxi2026jsjby", "xingkebaoyan", "zscampus"],
          name: "北京邮电大学",
          institute: "计算机学院",
          description: "推免预报名通知",
          deadline: "2099-09-10T15:59:59.000Z",
          website: "https://example.com/merged-source-stats",
          tags: []
        }
      ],
      new Date("2099-07-01T00:00:00.000Z")
    );

    expect(response.sourceStats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceGroup: "baoyanxinxi2026jsjby", total: 1 }),
        expect.objectContaining({ sourceGroup: "xingkebaoyan", total: 1 }),
        expect.objectContaining({ sourceGroup: "zscampus", total: 1 })
      ])
    );
  });

  it("hides stale future DDL after the visibility grace period", () => {
    const response = buildDdlResponse(
      [
        {
          item_key: "stale",
          content_hash: "hash",
          payload: JSON.stringify({
            key: "stale",
            contentHash: "hash",
            sourceGroup: "camp2026",
            name: "南京大学",
            institute: "计算机学院",
            description: "夏令营通知",
            deadline: "2026-06-10T00:00:00+08:00",
            website: "https://example.com/stale",
            tags: []
          }),
          source_group: "camp2026",
          first_seen_at: "2026-06-01T00:00:00.000Z",
          updated_at: "2026-06-01T00:00:00.000Z",
          last_seen_at: "2026-06-01T00:00:00.000Z",
          missing_since: "2026-06-01T00:00:00.000Z"
        }
      ],
      now
    );

    expect(response.total).toBe(0);
    expect(response.staleCount).toBe(1);
  });

  it("serves public DDL data without admin authorization", async () => {
    const db = new FakeD1Database();
    const item: NormalizedItem = {
      key: "future",
      contentHash: "hash",
      sourceGroup: "baoyanxinxi2026jsjby",
      name: "浙江大学",
      institute: "计算机学院",
      description: "补充源",
      deadline: "2099-06-10T00:00:00+08:00",
      website: "https://example.com/zju",
      tags: []
    };
    db.itemSnapshots.set(item.key, {
      item_key: item.key,
      content_hash: item.contentHash,
      payload: JSON.stringify(item),
      source_group: item.sourceGroup,
      first_seen_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
      last_seen_at: "2026-06-01T00:00:00.000Z",
      missing_since: null
    });
    const hiddenOldSourceItem: NormalizedItem = {
      key: "old-source",
      contentHash: "hash",
      sourceGroup: "camp2026",
      name: "清华大学",
      institute: "计算机系",
      description: "旧源条目",
      deadline: "2099-06-10T00:00:00+08:00",
      website: "https://example.com/thu",
      tags: []
    };
    db.itemSnapshots.set(hiddenOldSourceItem.key, {
      item_key: hiddenOldSourceItem.key,
      content_hash: hiddenOldSourceItem.contentHash,
      payload: JSON.stringify(hiddenOldSourceItem),
      source_group: hiddenOldSourceItem.sourceGroup,
      first_seen_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
      last_seen_at: "2026-06-01T00:00:00.000Z",
      missing_since: null
    });

    const response = await handleRequest(
      new Request("https://example.com/api/ddl"),
      { DB: db as unknown as D1Database } as Env,
      {
        waitUntil: () => undefined,
        passThroughOnException: () => undefined
      } as unknown as ExecutionContext
    );
    const body = (await response.json()) as { total: number; items: Array<{ sourceLabel: string }> };

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("max-age=300");
    expect(body.total).toBe(1);
    expect(body.items[0]?.sourceLabel).toBe("保研信息平台");
  });

  it("serves expired DDL items when includeExpired is requested", async () => {
    const db = new FakeD1Database();
    const expiredItem: NormalizedItem = {
      key: "expired-baoyanxinxi",
      contentHash: "hash",
      sourceGroup: "baoyanxinxi2026jsjby",
      name: "西安交通大学",
      institute: "软件学院",
      description: "夏令营通知",
      deadline: "2026-06-01T00:00:00+08:00",
      website: "https://example.com/xjtu-software",
      tags: []
    };
    db.itemSnapshots.set(expiredItem.key, {
      item_key: expiredItem.key,
      content_hash: expiredItem.contentHash,
      payload: JSON.stringify(expiredItem),
      source_group: expiredItem.sourceGroup,
      first_seen_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
      last_seen_at: "2026-06-01T00:00:00.000Z",
      missing_since: null
    });

    const defaultResponse = await handleRequest(
      new Request("https://example.com/api/ddl"),
      { DB: db as unknown as D1Database } as Env,
      {
        waitUntil: () => undefined,
        passThroughOnException: () => undefined
      } as unknown as ExecutionContext
    );
    const archiveResponse = await handleRequest(
      new Request("https://example.com/api/ddl?includeExpired=1"),
      { DB: db as unknown as D1Database } as Env,
      {
        waitUntil: () => undefined,
        passThroughOnException: () => undefined
      } as unknown as ExecutionContext
    );
    const defaultBody = (await defaultResponse.json()) as { items: unknown[] };
    const archiveBody = (await archiveResponse.json()) as {
      items: Array<{ key: string; status: string; website: string }>;
    };

    expect(defaultBody.items).toHaveLength(0);
    expect(archiveBody.items[0]).toMatchObject({
      key: "expired-baoyanxinxi",
      status: "expired",
      website: "https://example.com/xjtu-software"
    });
  });

  it("accepts admin relevance classifications and rejects invalid payloads", async () => {
    const db = new FakeD1Database();
    const context = {
      waitUntil: () => undefined,
      passThroughOnException: () => undefined
    } as unknown as ExecutionContext;
    const unauthorized = await handleRequest(
      new Request("https://example.com/api/admin/relevance-classifications", {
        method: "POST",
        body: JSON.stringify({ items: [] })
      }),
      { DB: db as unknown as D1Database, ADMIN_TOKEN: "secret" } as Env,
      context
    );
    const invalid = await handleRequest(
      new Request("https://example.com/api/admin/relevance-classifications", {
        method: "POST",
        headers: {
          authorization: "Bearer secret"
        },
        body: JSON.stringify({
          items: [
            {
              website: "https://example.com/notice",
              relevance: "strong",
              areas: ["心理学"],
              reason: "非法方向"
            }
          ]
        })
      }),
      { DB: db as unknown as D1Database, ADMIN_TOKEN: "secret" } as Env,
      context
    );
    const accepted = await handleRequest(
      new Request("https://example.com/api/admin/relevance-classifications", {
        method: "POST",
        headers: {
          authorization: "Bearer secret"
        },
        body: JSON.stringify({
          items: [
            {
              website: "https://example.com/notice?utm_source=test",
              relevance: "possible",
              areas: ["自动化控制", "其他"],
              reason: "电气系统方向，可能与控制相关",
              classifier: "codex-ai"
            }
          ]
        })
      }),
      { DB: db as unknown as D1Database, ADMIN_TOKEN: "secret" } as Env,
      context
    );
    const body = (await accepted.json()) as { ok: boolean; accepted: number };

    expect(unauthorized.status).toBe(401);
    expect(invalid.status).toBe(400);
    expect(accepted.status).toBe(200);
    expect(body).toMatchObject({ ok: true, accepted: 1 });
    expect(db.relevanceClassifications.has("https://example.com/notice")).toBe(true);
  });

  it("persists activity type classifications and exposes them through the public API", async () => {
    const db = new FakeD1Database();
    const context = {
      waitUntil: () => undefined,
      passThroughOnException: () => undefined
    } as unknown as ExecutionContext;
    const item: NormalizedItem = {
      key: "mixed-source-item",
      contentHash: "hash",
      sourceGroup: "baoyanxinxi2026jsjby",
      name: "测试大学",
      institute: "计算机学院",
      description: "保研信息平台补充源",
      deadline: "2099-09-01T23:59:59+08:00",
      website: "https://example.com/pre?scene=1",
      tags: [],
      activityType: "unknown",
      activityTypeSource: "unknown"
    };
    db.itemSnapshots.set(item.key, {
      item_key: item.key,
      content_hash: item.contentHash,
      payload: JSON.stringify(item),
      source_group: item.sourceGroup,
      first_seen_at: "2099-07-01T00:00:00.000Z",
      updated_at: "2099-07-01T00:00:00.000Z",
      last_seen_at: "2099-07-01T00:00:00.000Z",
      missing_since: null
    });

    const unauthorized = await handleRequest(
      new Request("https://example.com/api/admin/activity-type-classifications", {
        method: "POST",
        body: JSON.stringify({ items: [] })
      }),
      { DB: db as unknown as D1Database, ADMIN_TOKEN: "secret" } as Env,
      context
    );
    const invalid = await handleRequest(
      new Request("https://example.com/api/admin/activity-type-classifications", {
        method: "POST",
        headers: { authorization: "Bearer secret" },
        body: JSON.stringify({
          items: [{ website: item.website, activityType: "autumn_camp", reason: "非法类型" }]
        })
      }),
      { DB: db as unknown as D1Database, ADMIN_TOKEN: "secret" } as Env,
      context
    );
    const accepted = await handleRequest(
      new Request("https://example.com/api/admin/activity-type-classifications", {
        method: "POST",
        headers: { authorization: "Bearer secret" },
        body: JSON.stringify({
          items: [
            {
              website: item.website,
              activityType: "pre_recommendation",
              reason: "官方标题明确写有推荐免试研究生预报名",
              classifier: "codex-official-title"
            }
          ]
        })
      }),
      { DB: db as unknown as D1Database, ADMIN_TOKEN: "secret" } as Env,
      context
    );
    const publicResponse = await handleRequest(
      new Request("https://example.com/api/ddl"),
      { DB: db as unknown as D1Database } as Env,
      context
    );
    const body = (await publicResponse.json()) as {
      items: Array<{
        activityType: string;
        activityTypeSource: string;
        activityTypeClassifier: string;
      }>;
    };

    expect(unauthorized.status).toBe(401);
    expect(invalid.status).toBe(400);
    expect(accepted.status).toBe(200);
    expect(db.activityTypeClassifications.has("https://example.com/pre")).toBe(true);
    expect(body.items[0]).toMatchObject({
      activityType: "pre_recommendation",
      activityTypeSource: "classification",
      activityTypeClassifier: "codex-official-title"
    });
  });

  it("preserves matching public keys during external synchronization", () => {
    const item: NormalizedItem = {
      key: "generated-key",
      contentHash: "a".repeat(64),
      sourceGroup: "xingkebaoyan",
      sourceGroups: ["xingkebaoyan"],
      name: "北京邮电大学",
      institute: "计算机学院",
      description: "推免通知",
      deadline: "2099-09-10T15:59:59.000Z",
      deadlinePrecision: "date",
      deadlineConflict: false,
      deadlineSource: "xingkebaoyan",
      website: "https://example.com/notice?utm_source=test",
      sourceObservations: [],
      alternateWebsites: [],
      mergeReason: "single",
      tags: []
    };
    const result = reuseExistingKeys([item], [
      {
        key: "stable-public-key",
        school: item.name,
        institute: item.institute,
        deadlineAt: item.deadline,
        website: "https://example.com/notice"
      }
    ]);

    expect(result[0]?.key).toBe("stable-public-key");
  });

  it("stops an external sync when a healthy merge unexpectedly loses most active items", () => {
    expect(() =>
      assertNoUnexpectedMergedDrop(
        64,
        Array.from({ length: 100 }, (_, index) => ({
          key: `previous-${index}`,
          school: "测试大学",
          institute: "计算机学院",
          deadlineAt: "2099-09-10T15:59:59.000Z",
          website: `https://example.com/${index}`,
          active: true
        }))
      )
    ).toThrow("合并后条目数量异常骤降");
    expect(() =>
      assertNoUnexpectedMergedDrop(
        65,
        Array.from({ length: 100 }, (_, index) => ({
          key: `previous-${index}`,
          school: "测试大学",
          institute: "计算机学院",
          deadlineAt: "2099-09-10T15:59:59.000Z",
          website: `https://example.com/${index}`,
          active: true
        }))
      )
    ).not.toThrow();
  });

  it("accepts a complete external source sync and only then marks old rows missing", async () => {
    const db = new FakeD1Database();
    const context = {
      waitUntil: () => undefined,
      passThroughOnException: () => undefined
    } as unknown as ExecutionContext;
    const env = { DB: db as unknown as D1Database, ADMIN_TOKEN: "secret" } as Env;
    db.externalSourceSyncItems.set("abandoned\u0000stale-item", {
      runId: "abandoned",
      itemKey: "stale-item",
      contentHash: "0".repeat(64),
      payload: "{}",
      sourceGroup: "xingkebaoyan",
      createdAt: "2000-01-01T00:00:00.000Z"
    });
    db.itemSnapshots.set("old-item", {
      item_key: "old-item",
      content_hash: "b".repeat(64),
      payload: JSON.stringify({
        key: "old-item",
        contentHash: "b".repeat(64),
        sourceGroup: "xingkebaoyan",
        name: "旧大学",
        institute: "计算机学院",
        description: "旧通知",
        deadline: "2099-08-01T15:59:59.000Z",
        website: "https://example.com/old",
        tags: []
      }),
      source_group: "xingkebaoyan",
      first_seen_at: "2099-01-01T00:00:00.000Z",
      updated_at: "2099-01-01T00:00:00.000Z",
      last_seen_at: "2099-01-01T00:00:00.000Z",
      missing_since: null
    });
    const runId = new Date().toISOString();
    const sourceStats = [
      "baoyanxinxi2026jsjby",
      "xingkebaoyan",
      "zscampus"
    ].map((sourceGroup) => ({
      sourceGroup,
      url: `https://example.com/${sourceGroup}`,
      rawCount: 2,
      acceptedCount: 2,
      filteredCount: 0,
      duplicateCount: 0,
      supplementedDeadlineCount: 0
    }));
    const items: NormalizedItem[] = ["one", "two"].map((suffix, index) => ({
      key: `external-${suffix}`,
      contentHash: String(index + 1).repeat(64),
      sourceGroup: index === 0 ? "xingkebaoyan" : "zscampus",
      sourceGroups: [index === 0 ? "xingkebaoyan" : "zscampus"],
      name: `测试大学${index + 1}`,
      institute: "计算机学院",
      description: "推免通知",
      deadline: `2099-09-${10 + index}T15:59:59.000Z`,
      deadlinePrecision: "date",
      deadlineConflict: false,
      deadlineSource: index === 0 ? "xingkebaoyan" : "zscampus",
      website: `https://example.com/${suffix}`,
      sourceObservations: [],
      alternateWebsites: [],
      mergeReason: "single",
      tags: []
    }));
    const authorizedHeaders = {
      authorization: "Bearer secret",
      "content-type": "application/json"
    };

    const start = await handleRequest(
      new Request("https://example.com/api/admin/source-sync/start", {
        method: "POST",
        headers: authorizedHeaders,
        body: JSON.stringify({
          runId,
          expectedCount: 2,
          reviewCandidateCount: 0,
          sourceStats,
          activityTypeCounts: { summer_camp: 0, pre_recommendation: 0, unknown: 2 }
        })
      }),
      env,
      context
    );
    const secondRunId = new Date(new Date(runId).getTime() + 1_000).toISOString();
    const concurrentStart = await handleRequest(
      new Request("https://example.com/api/admin/source-sync/start", {
        method: "POST",
        headers: authorizedHeaders,
        body: JSON.stringify({
          runId: secondRunId,
          expectedCount: 2,
          reviewCandidateCount: 0,
          sourceStats,
          activityTypeCounts: { summer_camp: 0, pre_recommendation: 0, unknown: 2 }
        })
      }),
      env,
      context
    );
    const indexResponse = await handleRequest(
      new Request("https://example.com/api/admin/source-sync/index", {
        method: "POST",
        headers: authorizedHeaders,
        body: JSON.stringify({ runId, cursor: "", limit: 100 })
      }),
      env,
      context
    );
    const indexBody = (await indexResponse.json()) as {
      items: Array<{ key: string; active: boolean }>;
      nextCursor: string | null;
    };
    const upload = await handleRequest(
      new Request("https://example.com/api/admin/source-sync/items", {
        method: "POST",
        headers: authorizedHeaders,
        body: JSON.stringify({ runId, items })
      }),
      env,
      context
    );
    expect(db.itemSnapshots.get("old-item")?.missing_since).toBeNull();
    expect(db.itemSnapshots.has("external-one")).toBe(false);
    expect(db.externalSourceSyncItems.size).toBe(2);
    const finalize = await handleRequest(
      new Request("https://example.com/api/admin/source-sync/finalize", {
        method: "POST",
        headers: authorizedHeaders,
        body: JSON.stringify({ runId })
      }),
      env,
      context
    );

    expect(start.status).toBe(200);
    expect(
      Array.from(db.externalSourceSyncItems.values()).some(
        (row) => row.runId === "abandoned"
      )
    ).toBe(false);
    expect(concurrentStart.status).toBe(409);
    expect(indexResponse.status).toBe(200);
    expect(indexBody).toMatchObject({
      items: [{ key: "old-item", active: true }],
      nextCursor: null
    });
    expect(upload.status).toBe(200);
    expect(finalize.status).toBe(200);
    expect(db.externalSourceSyncItems.size).toBe(0);
    expect(db.itemSnapshots.has("external-one")).toBe(true);
    expect(db.itemSnapshots.get("old-item")?.missing_since).not.toBeNull();
    expect(db.itemSnapshots.get("external-one")?.first_seen_at).toBe(
      db.appState.get("last_synced_at")
    );
    expect(db.itemSnapshots.get("external-one")?.last_seen_at).toBe(
      db.appState.get("last_synced_at")
    );
    expect(db.appState.get("last_source_stats")).toBe(JSON.stringify(sourceStats));
    expect(db.appState.get("external_source_sync_active_run")).toBe("");
  });

  it("returns paginated verification candidates with explicit reasons", async () => {
    const db = new FakeD1Database();
    const context = {
      waitUntil: () => undefined,
      passThroughOnException: () => undefined
    } as unknown as ExecutionContext;
    const env = { DB: db as unknown as D1Database, ADMIN_TOKEN: "secret" } as Env;
    for (const [index, key] of ["candidate-a", "candidate-b"].entries()) {
      const item: NormalizedItem = {
        key,
        contentHash: String(index + 1).repeat(64),
        sourceGroup: "xingkebaoyan",
        sourceGroups: ["xingkebaoyan"],
        name: `测试大学${index + 1}`,
        institute: "计算机学院",
        description: "推免通知",
        deadline: `2099-09-${10 + index}T15:59:59.000Z`,
        deadlinePrecision: "date",
        deadlineConflict: index === 0,
        deadlineSource: "xingkebaoyan",
        website: `https://example.com/${key}`,
        sourceObservations: [],
        alternateWebsites: [],
        mergeReason: "single",
        tags: []
      };
      db.itemSnapshots.set(key, {
        item_key: key,
        content_hash: item.contentHash,
        payload: JSON.stringify(item),
        source_group: item.sourceGroup,
        first_seen_at: "2099-07-01T00:00:00.000Z",
        updated_at: "2099-07-01T00:00:00.000Z",
        last_seen_at: "2099-07-01T00:00:00.000Z",
        missing_since: null
      });
    }
    const headers = {
      authorization: "Bearer secret",
      "content-type": "application/json"
    };
    db.officialItemVerifications.set("candidate-a", [
      "candidate-a",
      "https://example.com/candidate-a",
      "测试大学1推免通知",
      "2099-09-20T15:59:59.000Z",
      "date",
      "旧核验记录",
      "luna-high",
      "2099-06-01T00:00:00.000Z",
      "2099-06-01T00:00:00.000Z",
      "2099-06-01T00:00:00.000Z"
    ]);

    const unauthorized = await handleRequest(
      new Request("https://example.com/api/admin/verification-candidates", {
        method: "POST",
        body: "{}"
      }),
      env,
      context
    );
    const first = await handleRequest(
      new Request("https://example.com/api/admin/verification-candidates", {
        method: "POST",
        headers,
        body: JSON.stringify({ cursor: "", limit: 1 })
      }),
      env,
      context
    );
    const firstBody = (await first.json()) as {
      candidates: Array<{ key: string; reasons: string[] }>;
      nextCursor: string | null;
    };
    const second = await handleRequest(
      new Request("https://example.com/api/admin/verification-candidates", {
        method: "POST",
        headers,
        body: JSON.stringify({ cursor: firstBody.nextCursor, limit: 1 })
      }),
      env,
      context
    );
    const secondBody = (await second.json()) as {
      candidates: Array<{ key: string; reasons: string[] }>;
      nextCursor: string | null;
    };

    expect(unauthorized.status).toBe(401);
    expect(first.status).toBe(200);
    expect(firstBody).toMatchObject({
      candidates: [
        {
          key: "candidate-a",
          reasons: [
            "date-level-deadline",
            "deadline-conflict",
            "unclassified-relevance",
            "unclassified-activity-type",
            "stale-official-verification"
          ],
          officialDeadline: "2099-09-20T15:59:59.000Z",
          officialVerifiedAt: "2099-06-01T00:00:00.000Z"
        }
      ],
      nextCursor: "candidate-a"
    });
    expect(second.status).toBe(200);
    expect(secondBody).toMatchObject({
      candidates: [{ key: "candidate-b" }],
      nextCursor: null
    });

    const missingItemKey = await handleRequest(
      new Request("https://example.com/api/admin/official-verifications", {
        method: "POST",
        headers,
        body: JSON.stringify({
          items: [
            {
              website: "https://example.com/shared",
              title: "共享入口",
              deadline: "2099-09-01 17:00",
              deadlinePrecision: "exact",
              reason: "官方页面明确截止时间"
            }
          ]
        })
      }),
      env,
      context
    );

    expect(missingItemKey.status).toBe(400);
  });

  it("rejects legacy Worker-side source sync", async () => {
    const db = new FakeD1Database();
    const context = {
      waitUntil: () => undefined,
      passThroughOnException: () => undefined
    } as unknown as ExecutionContext;
    const env = {
      DB: db as unknown as D1Database,
      ADMIN_TOKEN: "secret"
    } as Env;

    for (const path of ["run-check", "sync-sources"]) {
      const response = await handleRequest(
        new Request(`https://example.com/api/admin/${path}`, {
          headers: { authorization: "Bearer secret" }
        }),
        env,
        context
      );
      const body = (await response.json()) as { ok: boolean; error: string };

      expect(response.status).toBe(409);
      expect(body).toMatchObject({ ok: false, error: "external_sync_required" });
    }
    expect(db.itemSnapshots.size).toBe(0);
  });

  it("returns gone for disabled subscription confirmation flows", async () => {
    const db = new FakeD1Database();
    const context = {
      waitUntil: () => undefined,
      passThroughOnException: () => undefined
    } as unknown as ExecutionContext;
    const env = { DB: db as unknown as D1Database } as Env;

    const subscribe = await handleRequest(
      new Request("https://example.com/api/subscribe", {
        method: "POST",
        body: new FormData()
      }),
      env,
      context
    );
    const confirm = await handleRequest(
      new Request("https://example.com/api/confirm?token=test"),
      env,
      context
    );

    expect(subscribe.status).toBe(410);
    expect(confirm.status).toBe(410);
    expect(await subscribe.text()).toContain("邮件推送已关闭");
    expect(await confirm.text()).toContain("邮件推送已关闭");
  });

  it("aggregates anonymous visit stats from Vercel geo headers", async () => {
    const db = new FakeD1Database();
    const context = {
      waitUntil: () => undefined,
      passThroughOnException: () => undefined
    } as unknown as ExecutionContext;
    const env = { DB: db as unknown as D1Database } as Env;

    const first = await handleRequest(
      new Request("https://example.com/api/analytics/visit", {
        method: "POST",
        headers: {
          "x-vercel-ip-country": "CN",
          "x-vercel-ip-country-region": "SD",
          "x-vercel-ip-city": "Jinan"
        },
        body: "{}"
      }),
      env,
      context
    );
    const second = await handleRequest(
      new Request("https://example.com/api/analytics/visit", {
        method: "POST",
        headers: {
          "x-vercel-ip-country": "CN",
          "x-vercel-ip-country-region": "SD",
          "x-vercel-ip-city": "Jinan"
        },
        body: "{}"
      }),
      env,
      context
    );
    const summary = await handleRequest(
      new Request("https://example.com/api/analytics/summary"),
      env,
      context
    );
    const body = (await summary.json()) as {
      totalVisits: number;
      todayVisits: number;
      countryCount: number;
      regionCount: number;
      countries: Array<{ countryCode: string; visitCount: number }>;
      regions: Array<{ regionName: string; visitCount: number }>;
    };

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(summary.status).toBe(200);
    expect(summary.headers.get("cache-control")).toContain("max-age=300");
    expect(body).toMatchObject({
      totalVisits: 2,
      todayVisits: 2,
      countryCount: 1,
      regionCount: 1
    });
    expect(body.countries[0]).toMatchObject({ countryCode: "CN", visitCount: 2 });
    expect(body.regions[0]).toMatchObject({ regionName: "中国大陆 / Jinan", visitCount: 2 });
  });

  it("serializes project type fields and keeps legacy source groups compatible", () => {
    const item: NormalizedItem = {
      key: "pre-1",
      contentHash: "hash",
      sourceGroup: "yutuimian2026",
      name: "测试大学",
      institute: "计算机学院",
      description: "预推免通知",
      deadline: "2099-09-01T23:59:59+08:00",
      website: "https://example.com/pre",
      tags: [],
      areas: ["计算机"]
    };
    const response = buildDdlResponse([item], new Date("2099-07-01T00:00:00+08:00"));

    expect(response.items[0]).toMatchObject({
      activityType: "pre_recommendation",
      activityTypeLabel: "预推免",
      activityTypeSource: "source_group"
    });
  });

  it("protects explicit pre-recommendation wording from a conflicting model type", () => {
    const item: NormalizedItem = {
      key: "guarded-pre",
      contentHash: "hash",
      sourceGroup: "baoyanxinxi2026jsjby",
      name: "测试大学",
      institute: "计算机学院",
      description: "2026 年预推免报名通知",
      deadline: "2099-09-01T23:59:59+08:00",
      website: "https://example.com/guarded-pre",
      tags: []
    };
    const classified = applyActivityTypeClassification(
      item,
      new Map([
        [
          item.website,
          {
            normalizedUrl: item.website,
            activityType: "summer_camp",
            reason: "模型未找到明确类型",
            classifier: "luna-high-official",
            classifiedAt: "2099-07-01T00:00:00.000Z"
          }
        ]
      ])
    );

    expect(classified).toMatchObject({
      activityType: "pre_recommendation",
      activityTypeClassifier: "luna-high-official+rule-guard"
    });
  });
});
