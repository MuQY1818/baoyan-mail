import { sha256Hex } from "./crypto";
import type { Env, NormalizedItem, SourceStats } from "./types";

const DEFAULT_SOURCE_URL =
  "https://raw.githubusercontent.com/CS-BAOYAN/CS-BAOYAN-DDL/main/src/data/schools.json";
const DEFAULT_BAOYANXINXI_SOURCE_URL = "https://www.baoyanxinxi.cn/2026jsjby/";
export const BAOYANXINXI_SOURCE_GROUP = "baoyanxinxi2026jsjby";

const UNKNOWN_DEADLINE_VALUES = new Set([
  "",
  "N/A",
  "n/a",
  "暂无",
  "待定",
  "无明确说明",
  "Loading…",
  "Loading..."
]);

const URL_TRACKING_PARAMS = new Set([
  "scene",
  "click_id",
  "from",
  "isappinstalled",
  "share_token",
  "timestamp",
  "version",
  "platform"
]);

const NON_TIER_TAG_KEYWORDS = ["保研信息平台", "计算机大类"];
const TOP2_SCHOOLS = ["北京大学", "清华大学"];
const HUAWU_SCHOOLS = ["复旦大学", "上海交通大学", "南京大学", "浙江大学", "中国科学技术大学"];

const INCLUDE_PATTERNS = [
  /计算机/u,
  /软件/u,
  /人工智能|智能科学|智能学部|智能工程|智能制造|智能产业/u,
  /网络空间安全|网安|信息安全|密码/u,
  /信息工程|信息科学|电子信息|电子工程|电子科学|信息光电子|交叉信息|数据与信息/u,
  /通信|信息与通信|信通/u,
  /集成电路|微电子|半导体|芯片/u,
  /自动化|控制科学|控制工程|控制学院/u,
  /数据科学|大数据|机器学习|LAMDA/u,
  /机器人/u,
  /光电学院|光电科学|光电信息/u,
  /信息管理系/u
];

const SCHOOL_INCLUDE_PATTERNS = [
  /电子科技大学/u,
  /北京邮电大学/u,
  /西安电子科技大学/u,
  /杭州电子科技大学/u,
  /北京信息科技大学/u
];

const EXCLUDE_PATTERNS = [
  /医学|医学院|临床|药学院|药学|护理|公共卫生/u,
  /生命|生物(?!医学工程)/u,
  /材料(?!科学与光电)|化学|高分子/u,
  /环境(?!与能源学院)|地球系统|地球科学|空间地球|城市环境|海洋/u,
  /法学院|经济|金融|商学院|管理学院|公共管理/u,
  /心理|地理科学|建筑|城市规划|人文|社会科学|教育/u,
  /食品|农学|航空航天|宇航|力学|土木|交通(?!学域)/u,
  /机械(?!与电子信息)|能源环境|新材料/u,
  /物理学院|数学科学|统计科学|统计与数据科学系/u,
  /口腔|中医|中山医学院|华西/u
];

const C9_SCHOOLS = [
  "北京大学",
  "清华大学",
  "复旦大学",
  "上海交通大学",
  "南京大学",
  "浙江大学",
  "中国科学技术大学",
  "哈尔滨工业大学",
  "西安交通大学"
];

const PROJECT_985_SCHOOLS = [
  ...C9_SCHOOLS,
  "中国人民大学",
  "北京航空航天大学",
  "北京理工大学",
  "中国农业大学",
  "北京师范大学",
  "中央民族大学",
  "南开大学",
  "天津大学",
  "大连理工大学",
  "东北大学",
  "吉林大学",
  "同济大学",
  "华东师范大学",
  "东南大学",
  "厦门大学",
  "山东大学",
  "中国海洋大学",
  "武汉大学",
  "华中科技大学",
  "湖南大学",
  "中南大学",
  "国防科技大学",
  "中国人民解放军国防科技大学",
  "中山大学",
  "华南理工大学",
  "四川大学",
  "重庆大学",
  "电子科技大学",
  "西北工业大学",
  "兰州大学"
];

const PROJECT_211_SCHOOLS = [
  ...PROJECT_985_SCHOOLS,
  "北京交通大学",
  "北京工业大学",
  "北京科技大学",
  "北京化工大学",
  "北京邮电大学",
  "北京林业大学",
  "北京中医药大学",
  "北京外国语大学",
  "中国传媒大学",
  "中央财经大学",
  "对外经济贸易大学",
  "北京体育大学",
  "中央音乐学院",
  "中国政法大学",
  "华北电力大学",
  "天津医科大学",
  "河北工业大学",
  "太原理工大学",
  "内蒙古大学",
  "辽宁大学",
  "大连海事大学",
  "延边大学",
  "东北师范大学",
  "哈尔滨工程大学",
  "东北农业大学",
  "东北林业大学",
  "华东理工大学",
  "东华大学",
  "上海外国语大学",
  "上海财经大学",
  "上海大学",
  "苏州大学",
  "南京航空航天大学",
  "南京理工大学",
  "中国矿业大学",
  "河海大学",
  "江南大学",
  "南京农业大学",
  "中国药科大学",
  "南京师范大学",
  "安徽大学",
  "合肥工业大学",
  "福州大学",
  "南昌大学",
  "中国石油大学",
  "郑州大学",
  "武汉理工大学",
  "华中农业大学",
  "华中师范大学",
  "中南财经政法大学",
  "湖南师范大学",
  "暨南大学",
  "华南师范大学",
  "海南大学",
  "广西大学",
  "西南交通大学",
  "四川农业大学",
  "西南大学",
  "西南财经大学",
  "贵州大学",
  "云南大学",
  "西藏大学",
  "西北大学",
  "西安电子科技大学",
  "长安大学",
  "陕西师范大学",
  "青海大学",
  "宁夏大学",
  "新疆大学",
  "石河子大学",
  "第二军医大学",
  "第四军医大学"
];

interface RawSchoolRecord {
  name?: unknown;
  institute?: unknown;
  description?: unknown;
  deadline?: unknown;
  website?: unknown;
  tags?: unknown;
}

type SourceItemInput = Omit<NormalizedItem, "key" | "contentHash">;

interface TaggedSourceItem {
  item: SourceItemInput;
  supplementedByBaoyanXinxi: boolean;
}

interface FinalizeResult {
  items: NormalizedItem[];
  baoyanXinxiSupplementedItemKeys: string[];
}

export interface FetchSourceItemsResult {
  items: NormalizedItem[];
  stats: SourceStats[];
  baoyanXinxiSupplementedItemKeys: string[];
}

interface BaoyanXinxiRecord {
  name: string;
  institute: string;
  deadline: string;
  website: string;
}

interface BaoyanXinxiParseResult {
  rawCount: number;
  records: BaoyanXinxiRecord[];
}

export async function fetchSourceItems(env: Env): Promise<NormalizedItem[]> {
  return (await fetchSourceItemsWithStats(env)).items;
}

export async function fetchSourceItemsWithStats(env: Env): Promise<FetchSourceItemsResult> {
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
  const csRecords = extractRecords(data);
  const csItems = normalizeCsRecords(csRecords);
  const baoyanXinxiUrl = env.BAOYANXINXI_SOURCE_URL ?? DEFAULT_BAOYANXINXI_SOURCE_URL;
  const baoyanXinxiResult = await fetchBaoyanXinxiItems(baoyanXinxiUrl);
  const merged = mergeSourceItems(csItems, baoyanXinxiResult.items, baoyanXinxiResult.stats);
  const finalized = await finalizeSourceItems(merged.items);

  return {
    items: finalized.items,
    stats: [
      {
        sourceGroup: "cs-baoyan-ddl",
        url: sourceUrl,
        rawCount: csRecords.length,
        acceptedCount: csItems.length,
        filteredCount: csRecords.length - csItems.length,
        duplicateCount: 0,
        supplementedDeadlineCount: 0
      },
      merged.baoyanXinxiStats
    ],
    baoyanXinxiSupplementedItemKeys: finalized.baoyanXinxiSupplementedItemKeys
  };
}

export async function normalizeSourceData(data: unknown): Promise<NormalizedItem[]> {
  return (await finalizeSourceItems(normalizeCsRecords(extractRecords(data)))).items;
}

export function normalizeBaoyanXinxiHtml(
  html: string,
  sourceUrl = DEFAULT_BAOYANXINXI_SOURCE_URL
): { items: SourceItemInput[]; stats: SourceStats } {
  const parsed = parseBaoyanXinxiHtml(html, sourceUrl);
  const items: SourceItemInput[] = [];

  for (const record of parsed.records) {
    if (!isBaoyanXinxiRelevant(record.name, record.institute)) {
      continue;
    }
    items.push({
      sourceGroup: BAOYANXINXI_SOURCE_GROUP,
      name: record.name,
      institute: record.institute,
      description: "保研信息平台补充源",
      deadline: normalizeBaoyanXinxiDeadline(record.deadline),
      website: record.website,
      tags: getSchoolTierTags(record.name)
    });
  }

  return {
    items,
    stats: {
      sourceGroup: BAOYANXINXI_SOURCE_GROUP,
      url: sourceUrl,
      rawCount: parsed.rawCount,
      acceptedCount: items.length,
      filteredCount: parsed.rawCount - items.length,
      duplicateCount: 0,
      supplementedDeadlineCount: 0
    }
  };
}

export function normalizeBaoyanXinxiDeadline(value: string): string {
  const trimmed = decodeHtml(value).trim();
  if (UNKNOWN_DEADLINE_VALUES.has(trimmed)) {
    return "";
  }

  let normalized = trimmed.replace(/\s+/, "T");
  normalized = normalized.replace(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(.*)$/u,
    (_match, year: string, month: string, day: string, rest: string) =>
      `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}${rest}`
  );
  normalized = normalizeTwentyFourHourDeadline(normalized);
  normalized = normalized.replace(
    /([+-])(\d{1,2}):?(\d{2})$/u,
    (_match, sign: string, hour: string, minute: string) =>
      `${sign}${hour.padStart(2, "0")}:${minute}`
  );

  if (/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) {
    normalized = `${normalized}T23:59:59`;
  }
  normalized = normalized.replace(/T(\d{2}:\d{2})(Z|[+-]\d{2}:\d{2})?$/u, "T$1:00$2");

  if (!/(Z|[+-]\d{2}:\d{2})$/u.test(normalized)) {
    normalized = `${normalized}+08:00`;
  }

  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? trimmed : date.toISOString();
}

export function isBaoyanXinxiRelevant(name: string, institute: string): boolean {
  const text = `${name} ${institute}`;
  if (EXCLUDE_PATTERNS.some((pattern) => pattern.test(text))) {
    return false;
  }
  return (
    INCLUDE_PATTERNS.some((pattern) => pattern.test(text)) ||
    SCHOOL_INCLUDE_PATTERNS.some((pattern) => pattern.test(name))
  );
}

export function getSchoolTierTags(name: string): string[] {
  const normalized = normalizeSchoolName(name);
  if (schoolNameMatches(normalized, TOP2_SCHOOLS)) {
    return ["Top2"];
  }
  if (schoolNameMatches(normalized, HUAWU_SCHOOLS)) {
    return ["华五"];
  }
  if (schoolNameMatches(normalized, C9_SCHOOLS)) {
    return ["C9"];
  }
  if (schoolNameMatches(normalized, PROJECT_985_SCHOOLS)) {
    return ["985"];
  }
  if (schoolNameMatches(normalized, PROJECT_211_SCHOOLS)) {
    return ["211"];
  }
  return ["其他"];
}

export function sanitizeDisplayTags(tags: string[]): string[] {
  return mergeTags(
    [],
    tags.map((tag) => tag.trim()).filter((tag) => tag !== "" && !isNonTierTag(tag))
  );
}

export function canonicalizeNotificationUrl(value: string): string {
  const trimmed = decodeHtml(value).trim();
  if (trimmed === "") {
    return "";
  }

  try {
    const url = new URL(trimmed);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();

    const queryEntries: Array<[string, string]> = [];
    url.searchParams.forEach((entryValue, key) => {
      queryEntries.push([key, entryValue]);
    });

    const entries = queryEntries
      .filter(([key]) => {
        const lowerKey = key.toLowerCase();
        return !URL_TRACKING_PARAMS.has(lowerKey) && !lowerKey.startsWith("utm_");
      })
      .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
        const keyCompare = leftKey.localeCompare(rightKey);
        return keyCompare !== 0 ? keyCompare : leftValue.localeCompare(rightValue);
      });
    url.search = "";
    for (const [key, entryValue] of entries) {
      url.searchParams.append(key, entryValue);
    }
    if (url.pathname !== "/") {
      url.pathname = url.pathname.replace(/\/+$/u, "");
    }
    return url.toString();
  } catch {
    return trimmed.replace(/#.*$/u, "");
  }
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

async function fetchBaoyanXinxiItems(
  sourceUrl: string
): Promise<{ items: SourceItemInput[]; stats: SourceStats }> {
  try {
    const response = await fetch(sourceUrl, {
      headers: {
        "User-Agent": "baoyan-mail-worker"
      }
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return normalizeBaoyanXinxiHtml(await response.text(), sourceUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      items: [],
      stats: {
        sourceGroup: BAOYANXINXI_SOURCE_GROUP,
        url: sourceUrl,
        rawCount: 0,
        acceptedCount: 0,
        filteredCount: 0,
        duplicateCount: 0,
        supplementedDeadlineCount: 0,
        error: `拉取补充源失败：${message}`
      }
    };
  }
}

function mergeSourceItems(
  csItems: SourceItemInput[],
  baoyanXinxiItems: SourceItemInput[],
  baoyanXinxiStats: SourceStats
): { items: TaggedSourceItem[]; baoyanXinxiStats: SourceStats } {
  const items = csItems.map((item) => ({ item, supplementedByBaoyanXinxi: false }));
  const stats = { ...baoyanXinxiStats };
  const urlToIndex = new Map<string, number>();

  for (const [index, entry] of items.entries()) {
    const canonicalUrl = canonicalizeNotificationUrl(entry.item.website);
    if (canonicalUrl !== "" && !urlToIndex.has(canonicalUrl)) {
      urlToIndex.set(canonicalUrl, index);
    }
  }

  for (const item of baoyanXinxiItems) {
    const canonicalUrl = canonicalizeNotificationUrl(item.website);
    const existingIndex = canonicalUrl === "" ? undefined : urlToIndex.get(canonicalUrl);
    if (existingIndex !== undefined) {
      stats.duplicateCount += 1;
      const existing = items[existingIndex];
      if (
        existing !== undefined &&
        shouldUseSupplementalDeadline(existing.item.deadline, item.deadline)
      ) {
        existing.item = { ...existing.item, deadline: item.deadline };
        existing.supplementedByBaoyanXinxi = true;
        stats.supplementedDeadlineCount += 1;
      }
      continue;
    }

    const nextIndex = items.length;
    items.push({ item, supplementedByBaoyanXinxi: false });
    if (canonicalUrl !== "") {
      urlToIndex.set(canonicalUrl, nextIndex);
    }
  }

  return { items, baoyanXinxiStats: stats };
}

async function finalizeSourceItems(
  items: SourceItemInput[] | TaggedSourceItem[]
): Promise<FinalizeResult> {
  const baseKeyCounts = new Map<string, number>();
  const prepared = [];

  for (const entry of items) {
    const tagged = toTaggedSourceItem(entry);
    const baseKey = await sha256Hex(
      stableStringify({
        sourceGroup: tagged.item.sourceGroup,
        name: tagged.item.name,
        institute: tagged.item.institute
      })
    );
    prepared.push({ baseKey, ...tagged });
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

  const finalized: NormalizedItem[] = [];
  const baoyanXinxiSupplementedItemKeys: string[] = [];
  for (const preparedItem of prepared) {
    const count = baseKeyCounts.get(preparedItem.baseKey) ?? 0;
    baseKeyCounts.set(preparedItem.baseKey, count + 1);
    const key = count === 0 ? preparedItem.baseKey : `${preparedItem.baseKey}-${count + 1}`;
    const item = {
      ...preparedItem.item,
      key,
      contentHash: await sha256Hex(stableStringify(preparedItem.item))
    };
    finalized.push(item);
    if (preparedItem.supplementedByBaoyanXinxi) {
      baoyanXinxiSupplementedItemKeys.push(key);
    }
  }

  return { items: finalized, baoyanXinxiSupplementedItemKeys };
}

function normalizeCsRecords(
  records: Array<{ sourceGroup: string; value: RawSchoolRecord }>
): SourceItemInput[] {
  const items: SourceItemInput[] = [];
  for (const record of records) {
    const normalized = normalizeRecord(record.sourceGroup, record.value);
    if (normalized !== null) {
      items.push(normalized);
    }
  }
  return items;
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

function normalizeRecord(sourceGroup: string, record: RawSchoolRecord): SourceItemInput | null {
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
      ? sanitizeDisplayTags(record.tags.map(toCleanString).filter((tag) => tag !== ""))
      : []
  };
}

function parseBaoyanXinxiHtml(html: string, sourceUrl: string): BaoyanXinxiParseResult {
  const records: BaoyanXinxiRecord[] = [];
  let rawCount = 0;
  const sectionPattern = /<h2\b[^>]*>[\s\S]*?<\/h2>[\s\S]*?(?=<h2\b|$)/giu;

  for (const sectionMatch of html.matchAll(sectionPattern)) {
    const section = sectionMatch[0];
    const h2Match = /<h2\b[^>]*>([\s\S]*?)<\/h2>/iu.exec(section);
    const name = h2Match?.[1] === undefined ? "" : stripTags(h2Match[1]);
    const paragraphPattern = /<p\b[^>]*>([\s\S]*?)<\/p>/giu;

    for (const paragraphMatch of section.matchAll(paragraphPattern)) {
      const paragraph = paragraphMatch[1] ?? "";
      if (!/<span\b[^>]*\bdeadline\b[^>]*>/iu.test(paragraph)) {
        continue;
      }
      rawCount += 1;
      const linkMatch = /<a\b[^>]*>([\s\S]*?)<\/a>/iu.exec(paragraph);
      const linkTag = linkMatch?.[0] ?? "";
      const href = extractAttribute(linkTag, "href");
      const institute = linkMatch?.[1] === undefined ? "" : stripTags(linkMatch[1]);
      if (name === "" || institute === "" || href === "") {
        continue;
      }
      records.push({
        name,
        institute,
        deadline: extractDeadline(paragraph),
        website: resolveRecordUrl(href, sourceUrl)
      });
    }
  }

  return { rawCount, records };
}

function extractDeadline(html: string): string {
  const spanMatch = /<span\b[^>]*\bdeadline\b[^>]*>/iu.exec(html);
  if (spanMatch === null) {
    return "";
  }
  return extractAttribute(spanMatch[0], "data-deadline");
}

function extractAttribute(html: string, name: string): string {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*([\"'])([\\s\\S]*?)\\1`, "iu");
  const match = pattern.exec(html);
  return match?.[2] === undefined ? "" : decodeHtml(match[2]);
}

function resolveRecordUrl(href: string, sourceUrl: string): string {
  const decoded = decodeHtml(href).trim();
  try {
    return new URL(decoded, sourceUrl).toString();
  } catch {
    return decoded;
  }
}

function normalizeTwentyFourHourDeadline(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T24:(\d{2}):(\d{2})(.*)$/u.exec(value);
  if (match === null) {
    return value;
  }

  const year = Number.parseInt(match[1] ?? "", 10);
  const month = Number.parseInt(match[2] ?? "", 10);
  const day = Number.parseInt(match[3] ?? "", 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return value;
  }

  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  const datePart = nextDay.toISOString().slice(0, 10);
  return `${datePart}T00:${match[4] ?? "00"}:${match[5] ?? "00"}${match[6] ?? ""}`;
}

function shouldUseSupplementalDeadline(
  primaryDeadline: string,
  supplementalDeadline: string
): boolean {
  const supplemental = parseComparableDeadline(supplementalDeadline);
  if (supplemental === null) {
    return false;
  }
  const primary = parseComparableDeadline(primaryDeadline);
  return primary === null || primary.toISOString() !== supplemental.toISOString();
}

function parseComparableDeadline(value: string): Date | null {
  const trimmed = value.trim();
  if (UNKNOWN_DEADLINE_VALUES.has(trimmed)) {
    return null;
  }
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toTaggedSourceItem(entry: SourceItemInput | TaggedSourceItem): TaggedSourceItem {
  if ("supplementedByBaoyanXinxi" in entry) {
    return entry;
  }
  return { item: entry, supplementedByBaoyanXinxi: false };
}

function toCleanString(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function mergeTags(baseTags: string[], extraTags: string[]): string[] {
  return Array.from(new Set([...baseTags, ...extraTags].filter((tag) => tag !== "")));
}

function normalizeSchoolName(name: string): string {
  return name.replace(/\s+/gu, "").replace(/[（(].*?[）)]/gu, "");
}

function schoolNameMatches(name: string, schools: string[]): boolean {
  if (name === "") {
    return false;
  }
  return schools.some((school) => name.includes(school) || (name.length >= 4 && school.includes(name)));
}

function isNonTierTag(tag: string): boolean {
  return NON_TIER_TAG_KEYWORDS.some((keyword) => tag.includes(keyword));
}

function stripTags(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/gu, "")).replace(/\s+/gu, " ").trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/giu, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    )
    .replace(/&#(\d+);/gu, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10))
    )
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'");
}
