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
  getBaoyanXinxiAreas,
  getSchoolTierTags,
  isBaoyanXinxiRelevant,
  normalizeBaoyanXinxiDeadline,
  normalizeBaoyanXinxiHtml,
  normalizeSourceData
} from "../src/source";
import { buildDdlResponse } from "../src/ddl";
import { handleRequest, isValidEmail } from "../src/routes";
import type { Env, NormalizedItem } from "../src/types";

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
  readonly appState = new Map<string, string>();
  readonly relevanceClassifications = new Map<string, unknown[]>();
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
    if (sql.includes("SELECT * FROM item_snapshots")) {
      const rows = Array.from(this.itemSnapshots.values());
      if (sql.includes("WHERE source_group IN")) {
        const sourceGroups = new Set(bindings.map(String));
        return rows.filter((row) => sourceGroups.has(row.source_group)) as T[];
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
    if (sql.includes("INSERT INTO item_snapshots")) {
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
    } else if (sql.includes("INSERT INTO app_state")) {
      this.appState.set(String(bindings[0]), String(bindings[1]));
      changes = 1;
    } else if (sql.includes("INSERT OR IGNORE INTO new_deadline_notifications")) {
      const itemKey = String(bindings[0]);
      if (!this.newDeadlineNotifications.some((entry) => String(entry[0]) === itemKey)) {
        this.newDeadlineNotifications.push(bindings);
        changes = 1;
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
    expect(isBaoyanXinxiRelevant("复旦大学", "公共卫生学院")).toBe(false);
    expect(isBaoyanXinxiRelevant("浙江大学", "材料科学与工程学院")).toBe(false);
    expect(isBaoyanXinxiRelevant("北京大学", "光华管理学院")).toBe(false);
  });

  it("classifies borderline records but still publishes them for user-side filtering", () => {
    expect(classifyBaoyanXinxiRecord("北京大学深圳研究生院", "科学智能学院")).toBe("review");
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
      } as Env);
      const second = await runCheck({
        DB: db as unknown as D1Database,
        BAOYANXINXI_SOURCE_URL: "https://example.com/baoyanxinxi.html",
        APP_BASE_URL: "https://example.com"
      } as Env);

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
      } as Env);

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
      } as Env);
      const second = await runCheck({
        DB: db as unknown as D1Database,
        BAOYANXINXI_SOURCE_URL: "https://example.com/baoyanxinxi.html",
        APP_BASE_URL: "https://example.com"
      } as Env);

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
      } as Env);
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
      } as Env);
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

    expect(response.total).toBe(1);
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
});
