import { sha256Hex } from "./crypto";
import type { Env, NormalizedItem } from "./types";

const DEFAULT_SOURCE_URL =
  "https://raw.githubusercontent.com/CS-BAOYAN/CS-BAOYAN-DDL/main/src/data/schools.json";

interface RawSchoolRecord {
  name?: unknown;
  institute?: unknown;
  description?: unknown;
  deadline?: unknown;
  website?: unknown;
  tags?: unknown;
}

export async function fetchSourceItems(env: Env): Promise<NormalizedItem[]> {
  const sourceUrl = env.SOURCE_URL ?? DEFAULT_SOURCE_URL;
  const response = await fetch(sourceUrl, {
    headers: {
      "User-Agent": "baoyan-mail-worker"
    }
  });
  if (!response.ok) {
    throw new Error(`拉取数据源失败：${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  return normalizeSourceData(data);
}

export async function normalizeSourceData(data: unknown): Promise<NormalizedItem[]> {
  const records = extractRecords(data);
  const baseKeyCounts = new Map<string, number>();
  const prepared = [];

  for (const record of records) {
    const normalized = normalizeRecord(record.sourceGroup, record.value);
    if (normalized === null) {
      continue;
    }
    const baseKey = await sha256Hex(
      stableStringify({
        sourceGroup: normalized.sourceGroup,
        name: normalized.name,
        institute: normalized.institute
      })
    );
    prepared.push({ baseKey, item: normalized });
  }

  prepared.sort((left, right) => {
    const groupCompare = left.item.sourceGroup.localeCompare(right.item.sourceGroup);
    if (groupCompare !== 0) {
      return groupCompare;
    }
    const nameCompare = left.item.name.localeCompare(right.item.name);
    if (nameCompare !== 0) {
      return nameCompare;
    }
    const instituteCompare = left.item.institute.localeCompare(right.item.institute);
    if (instituteCompare !== 0) {
      return instituteCompare;
    }
    return `${left.item.website}|${left.item.deadline}|${left.item.description}`.localeCompare(
      `${right.item.website}|${right.item.deadline}|${right.item.description}`
    );
  });

  const items: NormalizedItem[] = [];
  for (const preparedItem of prepared) {
    const count = baseKeyCounts.get(preparedItem.baseKey) ?? 0;
    baseKeyCounts.set(preparedItem.baseKey, count + 1);
    const key = count === 0 ? preparedItem.baseKey : `${preparedItem.baseKey}-${count + 1}`;
    const item = {
      ...preparedItem.item,
      key,
      contentHash: await sha256Hex(stableStringify(preparedItem.item))
    };
    items.push(item);
  }

  return items;
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function extractRecords(data: unknown): Array<{ sourceGroup: string; value: RawSchoolRecord }> {
  if (Array.isArray(data)) {
    return data.map((value) => ({ sourceGroup: "default", value: value as RawSchoolRecord }));
  }

  if (data === null || typeof data !== "object") {
    return [];
  }

  const records: Array<{ sourceGroup: string; value: RawSchoolRecord }> = [];
  for (const [sourceGroup, value] of Object.entries(data)) {
    if (!Array.isArray(value)) {
      continue;
    }
    for (const entry of value) {
      records.push({ sourceGroup, value: entry as RawSchoolRecord });
    }
  }
  return records;
}

function normalizeRecord(sourceGroup: string, record: RawSchoolRecord): Omit<NormalizedItem, "key" | "contentHash"> | null {
  const name = toCleanString(record.name);
  const institute = toCleanString(record.institute);
  if (name === "" && institute === "") {
    return null;
  }

  return {
    sourceGroup,
    name,
    institute,
    description: toCleanString(record.description),
    deadline: toCleanString(record.deadline),
    website: toCleanString(record.website),
    tags: Array.isArray(record.tags)
      ? record.tags.map(toCleanString).filter((tag) => tag !== "")
      : []
  };
}

function toCleanString(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}
