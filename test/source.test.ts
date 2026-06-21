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
  fetchSourceItemsWithStats,
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
  readonly newDeadlineNotifications: unknown[][] = [];
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
      return Array.from(this.itemSnapshots.values()) as T[];
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
        updated_at: String(bindings[5])
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

  it("parses and filters BaoyanXinxi HTML records", () => {
    const html = `
      <h2 id="清华大学"><a href="#清华大学"></a>清华大学</h2>
      <p>【报名截止：<span class="deadline" data-deadline="2026-6-20T24:00:00">Loading…</span>】<a target="_blank" href="https://example.com/cs?scene=1&amp;click_id=20">计算机系</a></p>
      <p>【报名截止：<span class="deadline" data-deadline="N/A">Loading…</span>】<a target="_blank" href="https://example.com/life">生命科学学院</a></p>
      <h2 id="中国科学技术大学"><a href="#中国科学技术大学"></a>中国科学技术大学</h2>
      <p>【报名截止：<span class="deadline" data-deadline="2026-06-23T23:59:59">Loading…</span>】<a target="_blank" href="/notice">网络空间安全学院</a></p>
    `;

    const result = normalizeBaoyanXinxiHtml(html, "https://www.baoyanxinxi.cn/2026jsjby/");

    expect(result.stats.rawCount).toBe(3);
    expect(result.stats.acceptedCount).toBe(2);
    expect(result.stats.filteredCount).toBe(1);
    expect(result.items.map((item) => item.institute)).toEqual(["计算机系", "网络空间安全学院"]);
    expect(result.items[0]?.deadline).toBe("2026-06-20T16:00:00.000Z");
    expect(result.items[0]?.tags).toEqual(["Top2"]);
    expect(result.items[1]?.website).toBe("https://www.baoyanxinxi.cn/notice");
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
    expect(isBaoyanXinxiRelevant("北京邮电大学", "未来学院")).toBe(true);
    expect(isBaoyanXinxiRelevant("复旦大学", "公共卫生学院")).toBe(false);
    expect(isBaoyanXinxiRelevant("浙江大学", "材料科学与工程学院")).toBe(false);
    expect(isBaoyanXinxiRelevant("北京大学", "光华管理学院")).toBe(false);
  });

  it("adds conservative school tier tags", () => {
    expect(getSchoolTierTags("北京大学")).toEqual(["Top2"]);
    expect(getSchoolTierTags("中国科学技术大学")).toEqual(["华五"]);
    expect(getSchoolTierTags("哈尔滨工业大学")).toEqual(["C9"]);
    expect(getSchoolTierTags("电子科技大学")).toEqual(["985"]);
    expect(getSchoolTierTags("北京邮电大学")).toEqual(["211"]);
    expect(getSchoolTierTags("中国科学院大学")).toEqual(["其他"]);
  });

  it("canonicalizes notification URLs for cross-source dedupe", () => {
    expect(
      canonicalizeNotificationUrl(
        "https://mp.weixin.qq.com/s/example?scene=1&click_id=20&utm_source=test&a=1#wechat_redirect"
      )
    ).toBe("https://mp.weixin.qq.com/s/example?a=1");
  });

  it("dedupes BaoyanXinxi records by canonical source URL", async () => {
    const sourceData = {
      camp2026: [
        {
          name: "清华大学",
          institute: "计算机系",
          description: "夏令营",
          deadline: "",
          website: "https://mp.weixin.qq.com/s/example?scene=1",
          tags: ["985"]
        }
      ]
    };
    const html = `
      <h2 id="清华大学"><a href="#清华大学"></a>清华大学</h2>
      <p>【报名截止：<span class="deadline" data-deadline="2026-06-20T23:59:59">Loading…</span>】<a target="_blank" href="https://mp.weixin.qq.com/s/example?click_id=20">计算机系</a></p>
    `;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("schools.json")) {
        return new Response(JSON.stringify(sourceData), { status: 200 });
      }
      return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    };

    try {
      const result = await fetchSourceItemsWithStats({
        SOURCE_URL:
          "https://raw.githubusercontent.com/CS-BAOYAN/CS-BAOYAN-DDL/main/src/data/schools.json",
        BAOYANXINXI_SOURCE_URL: "https://www.baoyanxinxi.cn/2026jsjby/"
      } as Env);

      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.sourceGroup).toBe("camp2026");
      expect(result.items[0]?.deadline).toBe("2026-06-20T15:59:59.000Z");
      expect(result.stats[1]).toMatchObject({
        duplicateCount: 1,
        supplementedDeadlineCount: 1
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("initializes BaoyanXinxi supplemental snapshots without historical notifications", async () => {
    const db = new FakeD1Database();
    const originalSourceItems = await normalizeSourceData({
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
    const originalItem = originalSourceItems[0];
    expect(originalItem).toBeDefined();
    db.itemSnapshots.set(originalItem!.key, {
      item_key: originalItem!.key,
      content_hash: originalItem!.contentHash,
      payload: JSON.stringify(originalItem),
      source_group: originalItem!.sourceGroup,
      first_seen_at: "2026-06-18T00:00:00.000Z",
      updated_at: "2026-06-18T00:00:00.000Z"
    });

    const sourceData = {
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
    };
    const html = `
      <h2 id="浙江大学"><a href="#浙江大学"></a>浙江大学</h2>
      <p>【报名截止：<span class="deadline" data-deadline="2099-06-20T23:59:59">Loading…</span>】<a target="_blank" href="https://example.com/zju-cs">计算机学院</a></p>
    `;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("schools.json")) {
        return new Response(JSON.stringify(sourceData), { status: 200 });
      }
      return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    };

    try {
      const result = await runCheck({
        DB: db as unknown as D1Database,
        SOURCE_URL:
          "https://raw.githubusercontent.com/CS-BAOYAN/CS-BAOYAN-DDL/main/src/data/schools.json",
        BAOYANXINXI_SOURCE_URL: "https://www.baoyanxinxi.cn/2026jsjby/",
        APP_BASE_URL: "https://example.com"
      } as Env);

      expect(result.detected).toBe(0);
      expect(result.deadlineDetected).toBe(0);
      expect(result.dailyDeadlineDetected).toBe(0);
      expect(result.newDeadlineDetected).toBe(0);
      expect(db.newDeadlineNotifications).toHaveLength(0);
      expect(result.sourceStats?.[1]).toMatchObject({
        sourceGroup: "baoyanxinxi2026jsjby",
        acceptedCount: 1,
        initialized: true,
        initializedThisRun: true
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("sends the daily 15-day digest at most once per Shanghai date", async () => {
    const db = new FakeD1Database();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T01:00:00.000Z"));
    const sourceData = {
      camp2026: [
        {
          name: "南京大学",
          institute: "计算机学院",
          description: "夏令营",
          deadline: "2026-06-10T23:59:59+08:00",
          website: "https://example.com/cs",
          tags: ["C9"]
        }
      ]
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify(sourceData), { status: 200 });

    try {
      const first = await runCheck({
        DB: db as unknown as D1Database,
        SOURCE_URL: "https://example.com/schools.json",
        APP_BASE_URL: "https://example.com"
      } as Env);
      const second = await runCheck({
        DB: db as unknown as D1Database,
        SOURCE_URL: "https://example.com/schools.json",
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
      updated_at: "2026-06-18T00:00:00.000Z"
    });

    const sourceData = {
      camp2026: [
        {
          name: "南京大学",
          institute: "计算机学院",
          description: "夏令营",
          deadline: "",
          website: "https://example.com/cs",
          tags: ["C9"]
        },
        {
          name: "浙江大学",
          institute: "计算机学院",
          description: "夏令营",
          deadline: "2026-06-10T23:59:59+08:00",
          website: "https://example.com/zju",
          tags: ["C9"]
        },
        {
          name: "复旦大学",
          institute: "计算机学院",
          description: "夏令营",
          deadline: "",
          website: "https://example.com/fdu",
          tags: ["C9"]
        }
      ]
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify(sourceData), { status: 200 });

    try {
      const first = await runCheck({
        DB: db as unknown as D1Database,
        SOURCE_URL: "https://example.com/schools.json",
        APP_BASE_URL: "https://example.com"
      } as Env);
      const second = await runCheck({
        DB: db as unknown as D1Database,
        SOURCE_URL: "https://example.com/schools.json",
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

  it("serves public DDL data without admin authorization", async () => {
    const db = new FakeD1Database();
    const item: NormalizedItem = {
      key: "future",
      contentHash: "hash",
      sourceGroup: "baoyanxinxi2026jsjby",
      name: "浙江大学",
      institute: "计算机学院",
      description: "补充源",
      deadline: "2026-06-10T00:00:00+08:00",
      website: "https://example.com/zju",
      tags: []
    };
    db.itemSnapshots.set(item.key, {
      item_key: item.key,
      content_hash: item.contentHash,
      payload: JSON.stringify(item),
      source_group: item.sourceGroup,
      first_seen_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z"
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
});
