import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// 使用真实 SQLite CHECK/事务/JSON 语义，避免字符串 SQL mock 漏检半发布。
export class SqliteD1 {
  readonly sqlite = new DatabaseSync(":memory:");
  readonly itemSnapshots = new TableRows(this.sqlite, "item_snapshots", "item_key");
  readonly relevanceClassifications = new TableRows(this.sqlite, "item_relevance_classifications", "normalized_url");
  readonly activityTypeClassifications = new TableRows(this.sqlite, "item_activity_type_classifications", "normalized_url");
  readonly externalSourceSyncItems = new TableRows(this.sqlite, "external_source_sync_items", "item_key", true, "external_source_sync_item_rows");
  readonly appState = { get: (key: string) => (this.sqlite.prepare("SELECT value FROM app_state WHERE key = ?").get(key) as { value: string } | undefined)?.value };
  constructor() {
    const dir = resolve("migrations");
    for (const file of readdirSync(dir).filter((file) => file.endsWith(".sql")).sort()) {
      this.sqlite.exec(readFileSync(resolve(dir, file), "utf8"));
    }
  }
  prepare(sql: string) { return new SqlStatement(this.sqlite, sql); }
  async batch(statements: SqlStatement[]) {
    this.sqlite.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.execute());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

class SqlStatement {
  private values: Array<string | number | null> = [];
  constructor(private db: DatabaseSync, private sql: string) {}
  bind(...values: Array<string | number | null>) { this.values = values; return this; }
  execute() {
    const stmt = this.db.prepare(this.sql);
    if (/^\s*(SELECT|PRAGMA)/i.test(this.sql)) return { results: stmt.all(...this.values), success: true, meta: { changes: 0 } };
    const result = stmt.run(...this.values);
    return { results: [], success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
  async run() { return this.execute(); }
  async all() { return this.execute(); }
  async first(column?: string) {
    const row = this.db.prepare(this.sql).get(...this.values);
    return column ? row?.[column] ?? null : row ?? null;
  }
}

class TableRows {
  constructor(private db: DatabaseSync, private table: string, private key: string, private camel = false, private readTable = table) {}
  set(_key: string, value: Record<string, unknown>) {
    const pairs = Object.entries(value).map(([key, value]) => [this.camel ? key.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`) : key, value] as const);
    this.db.prepare(`INSERT OR REPLACE INTO ${this.table} (${pairs.map(([key]) => key).join(",")}) VALUES (${pairs.map(() => "?").join(",")})`)
      .run(...pairs.map(([, value]) => value as string | number | null));
  }
  get(key: string) { return this.db.prepare(`SELECT * FROM ${this.readTable} WHERE ${this.key} = ?`).get(key); }
  has(key: string) { return this.get(key) !== undefined; }
  get size() { return Number(this.db.prepare(`SELECT COUNT(*) AS count FROM ${this.readTable}`).get()?.count); }
  values() { return this.db.prepare(`SELECT * FROM ${this.readTable}`).all().map((row) => this.camel ? { ...row, runId: row.run_id } : row); }
}
