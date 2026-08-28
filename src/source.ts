import { sha256Hex } from "./crypto";
import type {
  ActivityType,
  ActivityTypeSource,
  DeadlinePrecision,
  Env,
  NormalizedItem,
  ReviewCandidatePayload,
  SourceMergeReason,
  SourceObservation,
  SourceStats
} from "./types";

const DEFAULT_BAOYANXINXI_SOURCE_URL = "https://www.baoyanxinxi.cn/2026jsjby/";
const DEFAULT_XINGKE_SOURCE_URL = "https://xingkebaoyan.com/data.json";
const DEFAULT_ZSCAMPUS_SOURCE_URL =
  "https://api.zscampus.com/zs-baoyan-summer/summer/getListWithConditions";
const SOURCE_PAGE_SIZE = 100;
const MAX_ZSCAMPUS_PAGES = 30;
const SOURCE_FETCH_TIMEOUT_MS = 30_000;
const SOURCE_FETCH_MAX_ATTEMPTS = 3;
const SOURCE_FETCH_RETRY_DELAYS_MS = [1_000, 3_000] as const;
const MIN_COMPARABLE_TITLE_LENGTH = 5;
const MIN_CORROBORATED_ALIAS_TITLE_LENGTH = 8;
export const BAOYANXINXI_SOURCE_GROUP = "baoyanxinxi2026jsjby";
export const BAOYANXINXI_PRE_RECOMMENDATION_SOURCE_GROUP =
  "baoyanxinxi2026yutuimian";
export const XINGKE_SOURCE_GROUP = "xingkebaoyan";
export const ZSCAMPUS_SOURCE_GROUP = "zscampus";
export const MANUAL_SOURCE_GROUP = "manual";
export const AUTOMATIC_SOURCE_GROUPS = [
  BAOYANXINXI_SOURCE_GROUP,
  BAOYANXINXI_PRE_RECOMMENDATION_SOURCE_GROUP,
  XINGKE_SOURCE_GROUP,
  ZSCAMPUS_SOURCE_GROUP
] as const;
const SHANGHAI_TIME_ZONE = "Asia/Shanghai";
const SHANGHAI_YEAR_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: SHANGHAI_TIME_ZONE,
  year: "numeric"
});
const SHANGHAI_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: SHANGHAI_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

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

const EXACT_URL_SCHOOL_ALIASES = new Map<string, string>([
  ["清华大学深圳国际研究生院", "清华大学"],
  ["东北大学秦皇岛分校", "东北大学"],
  ["中国人民解放军军事科学院", "军事科学院"],
  ["中国海军工程大学", "海军工程大学"],
  ["中国人民解放军国防科技大学", "国防科技大学"],
  ["国防科学技术大学", "国防科技大学"]
]);

const NON_TIER_TAG_KEYWORDS = ["保研信息平台", "计算机大类"];
const TOP2_SCHOOLS = ["北京大学", "清华大学"];
const HUAWU_SCHOOLS = ["复旦大学", "上海交通大学", "南京大学", "浙江大学", "中国科学技术大学"];

const INCLUDE_PATTERNS = [
  /计算机/u,
  /软件/u,
  /人工智能|智能科学|智能学部|智能工程|智能产业/u,
  /网络空间安全|网安|信息安全|密码/u,
  /信息学院|信院|信息工程|信息科学|信息与电子|电子与信息|电子与通信|电子信息|电子工程|电子学院|电子科学|信息光电子|交叉信息|数据与信息/u,
  /通信|信息与通信|信通/u,
  /集成电路|微电子|半导体|芯片/u,
  /自动化|控制科学|控制工程|控制学院/u,
  /数据科学|大数据|机器学习|LAMDA/u,
  /机器人/u,
  /光电学院|光电科学|光电信息/u,
  /信息管理系/u,
  /鹏城国家实验室|北京通用人工智能研究院|上海人工智能实验室|中国电信人工智能研究院/u
];

const SCHOOL_INCLUDE_PATTERNS = [
  /北京邮电大学/u,
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

const REVIEW_PATTERNS = [
  /科学智能/u,
  /智能制造/u,
  /智能创意/u,
  /交互/u,
  /信息/u,
  /电子/u,
  /系统/u,
  /遥感/u,
  /电气/u,
  /仪器/u,
  /物联网/u,
  /量子/u,
  /中国电子科技集团/u,
  /信息支援部队/u
];

export const BAOYAN_AREA_OPTIONS = [
  "计算机",
  "软件",
  "人工智能",
  "网络安全",
  "电子信息",
  "通信",
  "集成电路",
  "自动化控制",
  "数据科学",
  "机器人光电",
  "其他"
] as const;

const AREA_RULES = [
  {
    label: "计算机",
    patterns: [/计算机|计科|计算/u]
  },
  {
    label: "软件",
    patterns: [/软件/u]
  },
  {
    label: "人工智能",
    patterns: [/人工智能|智能科学|智能学部|智能工程|智能制造|智能产业|科学智能/u]
  },
  {
    label: "网络安全",
    patterns: [/网络空间安全|网安|信息安全|密码/u]
  },
  {
    label: "电子信息",
    patterns: [
      /信息学院|信院|信息工程|信息科学|信息与电子|电子与信息|电子与通信|信息电子|电子信息|电子工程|电子学院|电子科学|信息光电子|数据与信息|交叉信息|鹏城国家实验室/u
    ]
  },
  {
    label: "通信",
    patterns: [/通信|信息与通信|信通/u]
  },
  {
    label: "集成电路",
    patterns: [/集成电路|微电子|半导体|芯片/u]
  },
  {
    label: "自动化控制",
    patterns: [/自动化|控制科学|控制工程|控制学院|电气/u]
  },
  {
    label: "数据科学",
    patterns: [/数据科学|大数据|机器学习|LAMDA/u]
  },
  {
    label: "机器人光电",
    patterns: [/机器人|光电学院|光电科学|光电信息/u]
  }
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
  "西北农林科技大学",
  "国防科学技术大学",
  "中国人民解放军国防科学技术大学",
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
  "中国地质大学",
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

export type SourceItemInput = Omit<NormalizedItem, "key" | "contentHash">;

export interface FetchSourceItemsResult {
  items: NormalizedItem[];
  stats: SourceStats[];
  reviewCandidates: SourceReviewCandidateInput[];
}

export interface SourceReviewCandidateInput {
  normalizedUrl: string;
  sourceGroup: string;
  reason: string;
  payload: ReviewCandidatePayload;
}

interface BaoyanXinxiRecord {
  name: string;
  institute: string;
  deadline: string;
  website: string;
  activityType: ActivityType;
  activityTypeSource: ActivityTypeSource;
}

interface BaoyanXinxiParseResult {
  rawCount: number;
  records: BaoyanXinxiRecord[];
}

interface SourceFetchResult {
  items: SourceItemInput[];
  stats: SourceStats;
  reviewCandidates: SourceReviewCandidateInput[];
}

interface SourceDefinition {
  sourceGroup: string;
  url: string;
  activityType?: ActivityType;
  fetchItems: () => Promise<SourceFetchResult>;
}

interface MergeSourceItemsResult {
  items: SourceItemInput[];
  duplicateCountsBySource: Map<string, number>;
}

interface XingkeRecord {
  id?: unknown;
  school?: unknown;
  department?: unknown;
  title?: unknown;
  category?: unknown;
  signup_end?: unknown;
  signup_end_text?: unknown;
  url?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
}

interface ZscampusRecord {
  summerid?: unknown;
  summername?: unknown;
  universityname?: unknown;
  collegename?: unknown;
  websiteUrl?: unknown;
  recruitType?: unknown;
  publishTime?: unknown;
  createTime?: unknown;
  endtime?: unknown;
}

export async function fetchSourceItems(env: Env): Promise<NormalizedItem[]> {
  return (await fetchSourceItemsWithStats(env)).items;
}

export async function fetchSourceItemsWithStats(env: Env): Promise<FetchSourceItemsResult> {
  const baoyanSourceUrl = env.BAOYANXINXI_SOURCE_URL ?? DEFAULT_BAOYANXINXI_SOURCE_URL;
  const sourceDefinitions: SourceDefinition[] = [
    {
      activityType: "unknown",
      sourceGroup: BAOYANXINXI_SOURCE_GROUP,
      url: baoyanSourceUrl,
      fetchItems: () =>
        fetchBaoyanXinxiItems({
          activityType: "unknown",
          sourceGroup: BAOYANXINXI_SOURCE_GROUP,
          url: baoyanSourceUrl
        })
    },
    {
      sourceGroup: XINGKE_SOURCE_GROUP,
      url: env.XINGKE_SOURCE_URL ?? DEFAULT_XINGKE_SOURCE_URL,
      fetchItems: () => fetchXingkeItems(env.XINGKE_SOURCE_URL ?? DEFAULT_XINGKE_SOURCE_URL)
    },
    {
      sourceGroup: ZSCAMPUS_SOURCE_GROUP,
      url: env.ZSCAMPUS_SOURCE_URL ?? DEFAULT_ZSCAMPUS_SOURCE_URL,
      fetchItems: () =>
        fetchZscampusItems(
          env.ZSCAMPUS_SOURCE_URL ?? DEFAULT_ZSCAMPUS_SOURCE_URL,
          getSourceYear(env)
        )
    }
  ];
  const preRecommendationUrl = env.BAOYANXINXI_PRE_RECOMMENDATION_SOURCE_URL?.trim();
  if (preRecommendationUrl !== undefined && preRecommendationUrl !== "") {
    sourceDefinitions.push({
      activityType: "pre_recommendation",
      sourceGroup: BAOYANXINXI_PRE_RECOMMENDATION_SOURCE_GROUP,
      url: preRecommendationUrl,
      fetchItems: () =>
        fetchBaoyanXinxiItems({
          activityType: "pre_recommendation",
          sourceGroup: BAOYANXINXI_PRE_RECOMMENDATION_SOURCE_GROUP,
          url: preRecommendationUrl
        })
    });
  }

  const settledResults = await Promise.allSettled(
    sourceDefinitions.map((definition) => definition.fetchItems())
  );
  const sourceResults = settledResults.map((result, index) =>
    result.status === "fulfilled"
      ? result.value
      : createSourceErrorResult(sourceDefinitions[index]!, result.reason)
  );
  const mergedItems = mergeSourceItems(sourceResults.flatMap((result) => result.items));
  const finalized = await finalizeSourceItems(mergedItems.items);

  return {
    items: finalized.items,
    stats: enrichSourceStats(sourceResults.map((result) => result.stats), mergedItems),
    reviewCandidates: [
      ...sourceResults.flatMap((result) => result.reviewCandidates),
      ...buildMergeReviewCandidates(mergedItems.items)
    ]
  };
}

export async function normalizeSourceData(data: unknown): Promise<NormalizedItem[]> {
  return (await finalizeSourceItems(mergeSourceItems(normalizeCsRecords(extractRecords(data))).items))
    .items;
}

export function normalizeBaoyanXinxiHtml(
  html: string,
  sourceUrl = DEFAULT_BAOYANXINXI_SOURCE_URL,
  options: BaoyanXinxiSourceOptions = {}
): { items: SourceItemInput[]; stats: SourceStats; reviewCandidates: SourceReviewCandidateInput[] } {
  const sourceGroup = options.sourceGroup ?? BAOYANXINXI_SOURCE_GROUP;
  const defaultActivityType = options.activityType ?? "unknown";
  const parsed = parseBaoyanXinxiHtml(html, sourceUrl, sourceGroup, defaultActivityType);
  const items: SourceItemInput[] = [];

  for (const record of parsed.records) {
    const deadline = normalizeBaoyanXinxiDeadline(record.deadline);
    const deadlinePrecision = inferDeadlinePrecision(record.deadline, deadline);
    items.push({
      sourceGroup,
      sourceGroups: [sourceGroup],
      name: record.name,
      institute: record.institute,
      description: "保研信息平台补充源",
      deadline,
      deadlinePrecision,
      deadlineConflict: false,
      deadlineSource: sourceGroup,
      website: record.website,
      sourceObservations: [
        createSourceObservation({
          sourceGroup,
          sourceItemId: canonicalizeNotificationUrl(record.website),
          title: "",
          website: record.website,
          deadlineRaw: record.deadline,
          deadline,
          deadlinePrecision,
          publishedAt: ""
        })
      ],
      alternateWebsites: [],
      mergeReason: "single",
      tags: getSchoolTierTags(record.name),
      activityType: record.activityType,
      activityTypeSource: record.activityTypeSource,
      areas: getBaoyanXinxiAreas(record.name, record.institute)
    });
  }

  return {
    items,
    stats: {
      sourceGroup,
      url: sourceUrl,
      rawCount: parsed.rawCount,
      acceptedCount: items.length,
      filteredCount: parsed.rawCount - items.length,
      reviewCandidateCount: 0,
      duplicateCount: 0,
      supplementedDeadlineCount: 0,
      activityType: defaultActivityType
    },
    reviewCandidates: []
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
  return classifyBaoyanXinxiRecord(name, institute) === "accepted";
}

export interface ActivityTypeDetails {
  activityType: ActivityType;
  activityTypeSource: ActivityTypeSource;
}

export interface BaoyanXinxiSourceOptions {
  activityType?: ActivityType;
  sourceGroup?: string;
}

interface BaoyanXinxiSourceDefinition {
  activityType: ActivityType;
  sourceGroup: string;
  url: string;
}

export function getActivityTypeDetails(
  item: Pick<NormalizedItem, "activityType" | "activityTypeSource" | "sourceGroup" | "description" | "institute">
): ActivityTypeDetails {
  const textDetails = getActivityTypeFromText(`${item.institute} ${item.description}`);
  if (item.activityType !== undefined) {
    // Explicit official wording for pre-recommendation must override a stale
    // model classification, while preserving an already authoritative source label.
    if (
      item.activityType !== "pre_recommendation" &&
      textDetails.activityType === "pre_recommendation"
    ) {
      return textDetails;
    }
    return {
      activityType: item.activityType,
      activityTypeSource: item.activityTypeSource ?? "unknown"
    };
  }

  const sourceGroupDetails = getActivityTypeFromSourceGroup(item.sourceGroup);
  if (sourceGroupDetails.activityType !== "unknown") {
    return sourceGroupDetails;
  }

  return textDetails;
}

export function getActivityTypeFromSourceGroup(sourceGroup: string): ActivityTypeDetails {
  if (/^(camp|summer)[-_]?\d{4}$/u.test(sourceGroup)) {
    return { activityType: "summer_camp", activityTypeSource: "source_group" };
  }
  if (/^(yutuimian|pre[-_]?recommendation)[-_]?\d{4}$/u.test(sourceGroup)) {
    return { activityType: "pre_recommendation", activityTypeSource: "source_group" };
  }
  if (sourceGroup === BAOYANXINXI_PRE_RECOMMENDATION_SOURCE_GROUP) {
    return { activityType: "pre_recommendation", activityTypeSource: "source_group" };
  }
  return { activityType: "unknown", activityTypeSource: "unknown" };
}

export function getActivityTypeFromText(value: string): ActivityTypeDetails {
  const hasPreRecommendation =
    /预推免|预免推|九推|推荐免试|免试攻读研究生|推免生接收|推免研究生|推免面试/u.test(
      value
    );
  const hasSummerCamp =
    /夏令营|暑期学校|暑期开放营|夏季学校|暑期研学营|暑期创新训练班|学术交流营|校园开放日|科学营|研修班/u.test(
      value
    );
  if (hasPreRecommendation) {
    return { activityType: "pre_recommendation", activityTypeSource: "text" };
  }
  if (hasSummerCamp) {
    return { activityType: "summer_camp", activityTypeSource: "text" };
  }
  return { activityType: "unknown", activityTypeSource: "unknown" };
}

export function classifyBaoyanXinxiRecord(
  name: string,
  institute: string
): "accepted" | "review" | "rejected" {
  const text = `${name} ${institute}`;
  const hasIncludeMatch =
    INCLUDE_PATTERNS.some((pattern) => pattern.test(text)) ||
    SCHOOL_INCLUDE_PATTERNS.some((pattern) => pattern.test(name));
  const hasExcludeMatch = EXCLUDE_PATTERNS.some((pattern) => pattern.test(text));
  const reviewText = `${institute} ${
    /中国电子科技集团|信息支援部队/u.test(name) ? name : ""
  }`;

  if (hasIncludeMatch && !hasExcludeMatch) {
    return "accepted";
  }
  if (REVIEW_PATTERNS.some((pattern) => pattern.test(reviewText))) {
    return "review";
  }
  return "rejected";
}

export function getBaoyanXinxiAreas(name: string, institute: string): string[] {
  const text = `${name} ${institute}`;
  const areas = AREA_RULES.filter((rule) =>
    rule.patterns.some((pattern) => pattern.test(text))
  ).map((rule) => rule.label);
  return areas.length === 0 ? ["其他"] : areas;
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
    const applicationHash = /^#(?:!\/|\/)/u.test(url.hash) ? url.hash : "";
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
    url.hash = applicationHash;
    return url.toString();
  } catch {
    return trimmed.replace(/#.*$/u, "");
  }
}

export function getNotificationUrlMatchKey(value: string): string {
  const canonicalUrl = canonicalizeNotificationUrl(value);
  if (canonicalUrl === "") {
    return "";
  }

  try {
    const url = new URL(canonicalUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return canonicalUrl;
    }
    url.protocol = "https:";
    url.hostname = url.hostname.replace(/^www\./u, "");
    return url.toString();
  } catch {
    return canonicalUrl;
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

export async function createManualItemFromReviewPayload(
  payload: ReviewCandidatePayload
): Promise<NormalizedItem> {
  const activityTypeDetails = getActivityTypeFromText(
    `${payload.institute} ${payload.description}`
  );
  const deadline = normalizeBaoyanXinxiDeadline(payload.deadline.trim());
  const deadlinePrecision = inferManualDeadlinePrecision(deadline);
  const website = payload.website.trim();
  const itemInput: SourceItemInput = {
    sourceGroup: MANUAL_SOURCE_GROUP,
    sourceGroups: [MANUAL_SOURCE_GROUP],
    name: payload.name.trim(),
    institute: payload.institute.trim(),
    description: payload.description.trim(),
    deadline,
    deadlinePrecision,
    deadlineConflict: false,
    deadlineSource: MANUAL_SOURCE_GROUP,
    website,
    sourceObservations: [
      createSourceObservation({
        sourceGroup: MANUAL_SOURCE_GROUP,
        sourceItemId: canonicalizeNotificationUrl(website),
        title: payload.description.trim(),
        website,
        deadlineRaw: payload.deadline.trim(),
        deadline,
        deadlinePrecision,
        publishedAt: ""
      })
    ],
    alternateWebsites: [],
    mergeReason: "single",
    tags: getSchoolTierTags(payload.name),
    activityType: activityTypeDetails.activityType,
    activityTypeSource: activityTypeDetails.activityTypeSource
  };
  const key = await sha256Hex(
    stableStringify({
      sourceGroup: MANUAL_SOURCE_GROUP,
      name: itemInput.name,
      institute: itemInput.institute,
      website: canonicalizeNotificationUrl(itemInput.website)
    })
  );
  return {
    ...itemInput,
    key,
    contentHash: await sha256Hex(stableStringify(itemInput))
  };
}

async function fetchBaoyanXinxiItems(
  definition: BaoyanXinxiSourceDefinition
): Promise<SourceFetchResult> {
  const html = await fetchSourceBody(definition.url, "text/html", (response) =>
    response.text()
  );
  return normalizeBaoyanXinxiHtml(html, definition.url, {
    activityType: definition.activityType,
    sourceGroup: definition.sourceGroup
  });
}

async function fetchXingkeItems(sourceUrl: string): Promise<SourceFetchResult> {
  const data = await fetchSourceBody(sourceUrl, "application/json", (response) =>
    response.json()
  );
  return normalizeXingkeData(data, sourceUrl);
}

export function normalizeXingkeData(
  data: unknown,
  sourceUrl = DEFAULT_XINGKE_SOURCE_URL,
  now = new Date()
): SourceFetchResult {
  const records = readObjectArray(data, "items") as XingkeRecord[];
  const items: SourceItemInput[] = [];
  let latestPublishedAt = "";

  for (const record of records) {
    const name = toCleanString(record.school);
    const institute = toCleanString(record.department);
    const title = toCleanString(record.title);
    const website = toCleanString(record.url);
    const structuredDeadline = toCleanString(record.signup_end);
    const deadlineNote = toCleanString(record.signup_end_text);
    const deadlineRaw = structuredDeadline || deadlineNote;
    const deadline = normalizeBaoyanXinxiDeadline(structuredDeadline);
    const deadlineAt = parseComparableDeadline(deadline);
    if (
      name === "" ||
      title === "" ||
      canonicalizeNotificationUrl(website) === "" ||
      (deadlineAt !== null && deadlineAt.getTime() <= now.getTime())
    ) {
      continue;
    }

    const category = toCleanString(record.category);
    const activityTypeDetails = getAggregateActivityType(category, title);
    const publishedAt = normalizePublishedAt(
      toCleanString(record.updated_at) || toCleanString(record.created_at)
    );
    latestPublishedAt = getLatestTimestamp(latestPublishedAt, publishedAt);
    const deadlinePrecision = inferDeadlinePrecision(deadlineRaw, deadline);
    items.push({
      sourceGroup: XINGKE_SOURCE_GROUP,
      sourceGroups: [XINGKE_SOURCE_GROUP],
      name,
      institute,
      description: title,
      deadline,
      deadlinePrecision,
      deadlineConflict: false,
      deadlineSource: XINGKE_SOURCE_GROUP,
      website,
      sourceObservations: [
        createSourceObservation({
          sourceGroup: XINGKE_SOURCE_GROUP,
          sourceItemId: toSourceItemId(record.id),
          title,
          website,
          deadlineRaw,
          deadline,
          deadlinePrecision,
          publishedAt
        })
      ],
      alternateWebsites: [],
      mergeReason: "single",
      tags: getSchoolTierTags(name),
      activityType: activityTypeDetails.activityType,
      activityTypeSource: activityTypeDetails.activityTypeSource,
      areas: getBaoyanXinxiAreas(`${name} ${title}`, institute)
    });
  }

  return {
    items,
    stats: {
      sourceGroup: XINGKE_SOURCE_GROUP,
      url: sourceUrl,
      rawCount: records.length,
      acceptedCount: items.length,
      filteredCount: records.length - items.length,
      reviewCandidateCount: 0,
      duplicateCount: 0,
      supplementedDeadlineCount: 0,
      unknownDeadlineCount: items.filter((item) => item.deadline === "").length,
      pageCount: 1,
      latestPublishedAt
    },
    reviewCandidates: []
  };
}

async function fetchZscampusItems(
  sourceUrl: string,
  sourceYear: number
): Promise<SourceFetchResult> {
  const firstPage = await fetchZscampusPage(sourceUrl, sourceYear, 1);
  const pageCount = Math.max(1, Math.ceil(firstPage.total / SOURCE_PAGE_SIZE));
  if (pageCount > MAX_ZSCAMPUS_PAGES) {
    throw new Error(`分页数量 ${pageCount} 超过安全上限 ${MAX_ZSCAMPUS_PAGES}`);
  }

  const remainingPages = await Promise.all(
    Array.from({ length: pageCount - 1 }, (_value, index) =>
      fetchZscampusPage(sourceUrl, sourceYear, index + 2)
    )
  );
  const records = [firstPage, ...remainingPages].flatMap((page) => page.records);
  return normalizeZscampusData(records, sourceUrl, pageCount);
}

export function normalizeZscampusData(
  data: unknown,
  sourceUrl = DEFAULT_ZSCAMPUS_SOURCE_URL,
  pageCount = 1,
  now = new Date()
): SourceFetchResult {
  const records = Array.isArray(data) ? (data as ZscampusRecord[]) : [];
  const items: SourceItemInput[] = [];
  let latestPublishedAt = "";

  for (const record of records) {
    const name = toCleanString(record.universityname);
    const institute = toCleanString(record.collegename);
    const title = toCleanString(record.summername);
    const website = toCleanString(record.websiteUrl);
    const deadlineRaw = toCleanString(record.endtime);
    const deadline = normalizeBaoyanXinxiDeadline(deadlineRaw);
    const deadlineAt = parseComparableDeadline(deadline);
    if (
      name === "" ||
      title === "" ||
      canonicalizeNotificationUrl(website) === "" ||
      deadlineAt === null ||
      deadlineAt.getTime() <= now.getTime()
    ) {
      continue;
    }

    const activityTypeDetails = getAggregateActivityType(
      toCleanString(record.recruitType),
      title
    );
    const publishedAt = normalizePublishedAt(
      toCleanString(record.publishTime) || toCleanString(record.createTime)
    );
    latestPublishedAt = getLatestTimestamp(latestPublishedAt, publishedAt);
    const deadlinePrecision = inferDeadlinePrecision(deadlineRaw, deadline);
    items.push({
      sourceGroup: ZSCAMPUS_SOURCE_GROUP,
      sourceGroups: [ZSCAMPUS_SOURCE_GROUP],
      name,
      institute,
      description: title,
      deadline,
      deadlinePrecision,
      deadlineConflict: false,
      deadlineSource: ZSCAMPUS_SOURCE_GROUP,
      website,
      sourceObservations: [
        createSourceObservation({
          sourceGroup: ZSCAMPUS_SOURCE_GROUP,
          sourceItemId: toSourceItemId(record.summerid),
          title,
          website,
          deadlineRaw,
          deadline,
          deadlinePrecision,
          publishedAt
        })
      ],
      alternateWebsites: [],
      mergeReason: "single",
      tags: getSchoolTierTags(name),
      activityType: activityTypeDetails.activityType,
      activityTypeSource: activityTypeDetails.activityTypeSource,
      areas: getBaoyanXinxiAreas(`${name} ${title}`, institute)
    });
  }

  return {
    items,
    stats: {
      sourceGroup: ZSCAMPUS_SOURCE_GROUP,
      url: sourceUrl,
      rawCount: records.length,
      acceptedCount: items.length,
      filteredCount: records.length - items.length,
      reviewCandidateCount: 0,
      duplicateCount: 0,
      supplementedDeadlineCount: 0,
      pageCount,
      latestPublishedAt
    },
    reviewCandidates: []
  };
}

async function fetchZscampusPage(
  sourceUrl: string,
  sourceYear: number,
  page: number
): Promise<{ total: number; records: ZscampusRecord[] }> {
  const url = new URL(
    `${sourceUrl.replace(/\/+$/u, "")}/${page}/${SOURCE_PAGE_SIZE}/`
  );
  const query: Record<string, string> = {
    key: "all",
    recruitType: "all",
    year: String(sourceYear),
    universityLevel: "all",
    location: "all",
    majorType: "all",
    overDeadline: "1",
    probabilityStr: "all",
    tipType: "all",
    tipContent: "all",
    fields:
      "college,createTime,delFlag,id,majorType,msgType,officialSubject,publishTime,recruitType,tipType,title,universityId,universityName,website"
  };
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  const payload = await fetchSourceBody<Record<string, unknown>>(
    url.toString(),
    "application/json",
    (response) => response.json() as Promise<Record<string, unknown>>
  );
  if (Number(payload.code) !== 10000 || !isRecord(payload.data)) {
    throw new Error(`第 ${page} 页返回格式异常`);
  }
  const pageData = payload.data;
  const records = Array.isArray(pageData.list) ? (pageData.list as ZscampusRecord[]) : [];
  const total = Number(pageData.total);
  if (!Number.isFinite(total) || total < 0) {
    throw new Error(`第 ${page} 页缺少有效 total`);
  }
  return { total, records };
}

async function fetchSourceBody<T>(
  url: string,
  accept: string,
  readBody: (response: Response) => Promise<T>
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= SOURCE_FETCH_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: accept,
          "User-Agent": "baoyan-mail-worker"
        },
        signal: AbortSignal.timeout(SOURCE_FETCH_TIMEOUT_MS)
      });
      if (!response.ok) {
        const error = new Error(`${response.status} ${response.statusText}`.trim());
        if (!isRetryableSourceStatus(response.status)) {
          throw error;
        }
        lastError = error;
      } else {
        return await readBody(response);
      }
    } catch (error) {
      if (!isRetryableSourceError(error)) {
        throw error;
      }
      lastError = error;
    }

    if (attempt < SOURCE_FETCH_MAX_ATTEMPTS) {
      await delaySourceRetry(SOURCE_FETCH_RETRY_DELAYS_MS[attempt - 1]!);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function isRetryableSourceStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isRetryableSourceError(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === "AbortError" || error.name === "TimeoutError";
}

function delaySourceRetry(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createSourceErrorResult(
  definition: SourceDefinition,
  error: unknown
): SourceFetchResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    items: [],
    stats: {
      sourceGroup: definition.sourceGroup,
      url: definition.url,
      rawCount: 0,
      acceptedCount: 0,
      filteredCount: 0,
      reviewCandidateCount: 0,
      duplicateCount: 0,
      supplementedDeadlineCount: 0,
      ...(definition.activityType === undefined
        ? {}
        : { activityType: definition.activityType }),
      error: `拉取来源失败：${message}`
    },
    reviewCandidates: []
  };
}

export function mergeSourceItems(entries: SourceItemInput[]): MergeSourceItemsResult {
  const duplicateCountsBySource = new Map<string, number>();
  const byNoticeIdentity = new Map<string, SourceItemInput[]>();

  for (const [index, entry] of entries.entries()) {
    const urlMatchKey = getNotificationUrlMatchKey(entry.website);
    const key =
      urlMatchKey === ""
        ? `empty:${index}`
        : [
            urlMatchKey,
            normalizeDuplicateText(entry.name),
            normalizeDuplicateText(entry.institute),
            getDeadlineDay(entry.deadline)
          ].join("\u0000");
    const group = byNoticeIdentity.get(key);
    if (group === undefined) {
      byNoticeIdentity.set(key, [entry]);
      continue;
    }
    if (group.some((existing) => existing.sourceGroup === entry.sourceGroup)) {
      duplicateCountsBySource.set(
        entry.sourceGroup,
        (duplicateCountsBySource.get(entry.sourceGroup) ?? 0) + 1
      );
    }
    group.push(entry);
  }

  const clusters = Array.from(byNoticeIdentity.values());
  const parent = clusters.map((_cluster, index) => index);
  const clusterSourceGroups = clusters.map(
    (cluster) =>
      new Set(
        cluster.flatMap((entry) => entry.sourceGroups ?? [entry.sourceGroup])
      )
  );
  const titleMatchedIndices = new Set<number>();
  const exactUrlBuckets = new Map<string, number[]>();
  for (const [index, cluster] of clusters.entries()) {
    const profile = getExactUrlMatchProfile(cluster);
    if (profile === null) {
      continue;
    }
    const bucket = exactUrlBuckets.get(profile.bucketKey) ?? [];
    for (const otherIndex of bucket) {
      const otherProfile = getExactUrlMatchProfile(clusters[otherIndex]!);
      const allowSourceOverlap =
        otherProfile !== null &&
        areStrongSameSourceExactUrlDuplicates(profile, otherProfile);
      if (
        otherProfile !== null &&
        areCrossSourceExactUrlMatches(profile, otherProfile) &&
        (allowSourceOverlap
          ? unionClusters(parent, clusterSourceGroups, index, otherIndex)
          : unionClustersIfSourceDisjoint(
              parent,
              clusterSourceGroups,
              index,
              otherIndex
            ))
      ) {
        break;
      }
    }
    bucket.push(index);
    exactUrlBuckets.set(profile.bucketKey, bucket);
  }
  const matchBuckets = new Map<string, number[]>();
  for (const [index, cluster] of clusters.entries()) {
    const profile = getClusterMatchProfile(cluster);
    if (profile === null) {
      continue;
    }
    const bucket = matchBuckets.get(profile.bucketKey) ?? [];
    for (const otherIndex of bucket) {
      const otherProfile = getClusterMatchProfile(clusters[otherIndex]!);
      if (
        otherProfile !== null &&
        areConservativeTitleMatches(profile, otherProfile) &&
        (unionClustersIfSourceDisjoint(
          parent,
          clusterSourceGroups,
          index,
          otherIndex
        ) ||
          (areCorroboratedSameSourceTitleAliases(profile, otherProfile) &&
            unionClusters(parent, clusterSourceGroups, index, otherIndex)))
      ) {
        titleMatchedIndices.add(index);
        titleMatchedIndices.add(otherIndex);
      }
    }
    bucket.push(index);
    matchBuckets.set(profile.bucketKey, bucket);
  }

  const groupedClusters = new Map<number, { entries: SourceItemInput[]; titleMatched: boolean }>();
  for (const [index, cluster] of clusters.entries()) {
    const root = findClusterRoot(parent, index);
    const current = groupedClusters.get(root);
    if (current === undefined) {
      groupedClusters.set(root, {
        entries: [...cluster],
        titleMatched: titleMatchedIndices.has(index)
      });
      continue;
    }
    current.entries.push(...cluster);
    current.titleMatched ||= titleMatchedIndices.has(index);
  }

  return {
    items: Array.from(groupedClusters.values()).map((cluster) =>
      mergeSourceCluster(cluster.entries, cluster.titleMatched)
    ),
    duplicateCountsBySource
  };
}

function mergeSourceCluster(
  entries: SourceItemInput[],
  titleMatched: boolean
): SourceItemInput {
  const primary = entries.reduce((current, entry) =>
    shouldPreferMergedSourceItem(entry, current) ? entry : current
  );
  const observations = dedupeObservations(entries.flatMap(getSourceObservations));
  const sourceGroups = Array.from(
    new Set([
      ...entries.map((entry) => entry.sourceGroup),
      ...observations.map((observation) => observation.sourceGroup)
    ])
  ).sort(compareSourceGroups);
  const website = choosePreferredWebsite(entries, primary);
  const alternateWebsites = getAlternateWebsites(entries, website);
  const deadline = selectMergedDeadline(observations);
  const title = chooseMergedDescription(entries, observations, primary);
  const name = chooseMergedField(entries, primary, "name");
  const institute = chooseMergedField(entries, primary, "institute");
  const activityTypeDetails = selectMergedActivityType(entries, title, institute);
  const distinctSourceUrls = new Set(
    observations.map((observation) => canonicalizeNotificationUrl(observation.website)).filter(Boolean)
  );
  const mergeReason: SourceMergeReason = titleMatched
    ? "title_match"
    : observations.length > 1 || distinctSourceUrls.size > 1
      ? "exact_url"
      : "single";

  return {
    ...primary,
    sourceGroup: primary.sourceGroup,
    sourceGroups,
    sourceObservations: observations,
    alternateWebsites,
    mergeReason,
    name,
    institute,
    description: title,
    deadline: deadline.value,
    deadlinePrecision: deadline.precision,
    deadlineConflict: deadline.conflict,
    deadlineSource: deadline.source,
    website,
    tags: mergeTags([], entries.flatMap((entry) => entry.tags)),
    activityType: activityTypeDetails.activityType,
    activityTypeSource: activityTypeDetails.activityTypeSource,
    areas: getBaoyanXinxiAreas(`${name} ${title}`, institute)
  };
}

function getExactUrlMatchProfile(entries: SourceItemInput[]): {
  bucketKey: string;
  canonicalUrl: string;
  urlMatchKey: string;
  school: string;
  schoolMatchKey: string;
  institute: string;
  title: string;
  placeholderTitle: boolean;
  deadlineDay: string;
  deadlineTimestamp: number | null;
} | null {
  const primary = entries.reduce((current, entry) =>
    shouldPreferMergedSourceItem(entry, current) ? entry : current
  );
  const canonicalUrl = canonicalizeNotificationUrl(primary.website);
  const urlMatchKey = getNotificationUrlMatchKey(primary.website);
  const school = normalizeDuplicateText(primary.name);
  const schoolMatchKey = getNotificationSchoolMatchKey(primary.name);
  const institute = normalizeDuplicateText(primary.institute);
  const mergedTitle = chooseMergedDescription(
    entries,
    entries.flatMap(getSourceObservations),
    primary
  );
  const deadline = parseComparableDeadline(primary.deadline);
  if (
    canonicalUrl === "" ||
    urlMatchKey === "" ||
    school === "" ||
    schoolMatchKey === ""
  ) {
    return null;
  }
  return {
    bucketKey: `${urlMatchKey}\u0000${schoolMatchKey}`,
    canonicalUrl,
    urlMatchKey,
    school,
    schoolMatchKey,
    institute,
    title: normalizeComparableTitle(mergedTitle, primary.name, ""),
    placeholderTitle: isAggregatePlaceholderTitle(mergedTitle),
    deadlineDay: getDeadlineDay(primary.deadline),
    deadlineTimestamp: deadline?.getTime() ?? null
  };
}

function areCrossSourceExactUrlMatches(
  left: NonNullable<ReturnType<typeof getExactUrlMatchProfile>>,
  right: NonNullable<ReturnType<typeof getExactUrlMatchProfile>>
): boolean {
  if (
    left.urlMatchKey !== right.urlMatchKey ||
    left.schoolMatchKey !== right.schoolMatchKey
  ) {
    return false;
  }
  const exactSchoolMatch = left.school === right.school;
  if (isSpecificNoticeUrl(left.canonicalUrl)) {
    const institutesCompatible = areInstituteAliasesOrEmpty(
      left.institute,
      right.institute
    );
    return (
      left.institute === right.institute ||
      haveEquivalentDeadline(left, right) ||
      (institutesCompatible &&
        (left.placeholderTitle ||
          right.placeholderTitle ||
          haveEquivalentExactUrlTitles(left, right)))
    );
  }
  if (
    !exactSchoolMatch ||
    left.institute !== right.institute ||
    left.deadlineDay === "" ||
    left.deadlineDay !== right.deadlineDay ||
    left.title === "" ||
    right.title === ""
  ) {
    return false;
  }
  const shorterLength = Math.min(left.title.length, right.title.length);
  return (
    left.title === right.title ||
    (shorterLength >= 12 &&
      (left.title.includes(right.title) || right.title.includes(left.title)))
  );
}

function areStrongSameSourceExactUrlDuplicates(
  left: NonNullable<ReturnType<typeof getExactUrlMatchProfile>>,
  right: NonNullable<ReturnType<typeof getExactUrlMatchProfile>>
): boolean {
  return (
    left.urlMatchKey === right.urlMatchKey &&
    left.school === right.school &&
    isSpecificNoticeUrl(left.canonicalUrl) &&
    !left.placeholderTitle &&
    !right.placeholderTitle &&
    areInstituteAliasesOrEmpty(left.institute, right.institute) &&
    haveEquivalentExactUrlTitles(left, right)
  );
}

function haveEquivalentDeadline(
  left: NonNullable<ReturnType<typeof getExactUrlMatchProfile>>,
  right: NonNullable<ReturnType<typeof getExactUrlMatchProfile>>
): boolean {
  if (
    left.deadlineDay !== "" &&
    left.deadlineDay === right.deadlineDay
  ) {
    return true;
  }
  return (
    left.deadlineTimestamp !== null &&
    right.deadlineTimestamp !== null &&
    Math.abs(left.deadlineTimestamp - right.deadlineTimestamp) <= 1_000
  );
}

function haveEquivalentExactUrlTitles(
  left: NonNullable<ReturnType<typeof getExactUrlMatchProfile>>,
  right: NonNullable<ReturnType<typeof getExactUrlMatchProfile>>
): boolean {
  const institutes = [left.institute, right.institute].filter(Boolean);
  const normalize = (value: string): string => {
    let normalized = value;
    for (const institute of institutes) {
      normalized = normalized.replaceAll(normalizeComparableEntity(institute), "");
    }
    return normalized.replace(/20\d{2}年/gu, "");
  };
  const leftTitle = normalize(left.title);
  const rightTitle = normalize(right.title);
  return (
    leftTitle.length >= MIN_COMPARABLE_TITLE_LENGTH && leftTitle === rightTitle
  );
}

function areInstituteAliasesOrEmpty(left: string, right: string): boolean {
  const normalizedLeft = normalizeComparableEntity(left);
  const normalizedRight = normalizeComparableEntity(right);
  if (normalizedLeft === "" || normalizedRight === "") {
    return true;
  }
  if (normalizedLeft === normalizedRight) {
    return true;
  }
  const shorterLength = Math.min(normalizedLeft.length, normalizedRight.length);
  return (
    shorterLength >= 4 &&
    (normalizedLeft.includes(normalizedRight) ||
      normalizedRight.includes(normalizedLeft))
  );
}

function normalizeComparableEntity(value: string): string {
  return normalizeDuplicateText(value).replace(/[^\p{L}\p{N}]/gu, "");
}

export function getNotificationSchoolMatchKey(value: string): string {
  const normalized = normalizeComparableEntity(value);
  if (normalized.startsWith("中国科学院")) {
    return "中国科学院";
  }
  return EXACT_URL_SCHOOL_ALIASES.get(normalized) ?? normalized;
}

function isAggregatePlaceholderTitle(value: string): boolean {
  const normalized = normalizeComparableEntity(value);
  return (
    normalized === "" ||
    normalized === "保研信息平台补充源" ||
    normalized === "noresponse"
  );
}

export function isSpecificNoticeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const path = url.pathname.toLowerCase();
    if (url.hostname === "mp.weixin.qq.com" && path.startsWith("/s/")) {
      return true;
    }
    const hasDetailId = Array.from(url.searchParams.entries()).some(
      ([key, entryValue]) =>
        /^(?:id|article_?id|news_?id|xqid)$/iu.test(key) &&
        /^\d+$/u.test(entryValue)
    );
    const hasCmsNewsId = /^\d+$/u.test(url.searchParams.get("wbnewsid") ?? "");
    const hasDetailAction = Array.from(url.searchParams.entries()).some(
      ([key, entryValue]) =>
        /^(?:a|action|m|q|type)$/iu.test(key) &&
        /^(?:show|detail|moredetail|content)$/iu.test(entryValue)
    );
    if (
      hasCmsNewsId ||
      (hasDetailId && hasDetailAction) ||
      /\/(?:[^/?#]*detail[^/?#]*)(?:[/?#]|$)/iu.test(url.hash)
    ) {
      return true;
    }
    if (
      /(?:^|\/)(?:index|default|login|logon|signin|signup|sign_up|apply|application)(?:\.[a-z0-9]+)?$/iu.test(
        path
      ) ||
      /\/(?:sign_up|signup|application|apply)\//u.test(path)
    ) {
      return false;
    }
    if (
      /(?:\/info\/|\/notice(?:\/|$)|\/news(?:\/|$)|\/(?:home\/)?detail(?:\/|$)|\/node\/\d+(?:\/|$)|\/20\d{2}\/|\.(?:html?|shtml)$)/iu.test(
        path
      ) ||
      /\/pages?_\d+_\d+\.aspx$/iu.test(path) ||
      /\/\d{3,}(?:[-_]\d{2,})+(?:\.[a-z0-9]+)?$/iu.test(path)
    ) {
      return true;
    }
    return path === "/" && /^\d+$/u.test(url.searchParams.get("p") ?? "");
  } catch {
    return false;
  }
}

function getClusterMatchProfile(entries: SourceItemInput[]): {
  bucketKey: string;
  canonicalUrl: string;
  school: string;
  institute: string;
  title: string;
  activityType: ActivityType;
  sourceGroups: Set<string>;
} | null {
  const primary = entries.reduce((current, entry) =>
    shouldPreferMergedSourceItem(entry, current) ? entry : current
  );
  const title = normalizeComparableTitle(
    chooseMergedDescription(entries, entries.flatMap(getSourceObservations), primary),
    primary.name,
    primary.institute
  );
  const deadlineDay = getDeadlineDay(primary.deadline);
  const school = normalizeDuplicateText(primary.name);
  if (
    title.length < MIN_COMPARABLE_TITLE_LENGTH ||
    deadlineDay === "" ||
    school === ""
  ) {
    return null;
  }
  const activityType = getActivityTypeDetails(primary).activityType;
  return {
    bucketKey: `${school}\u0000${deadlineDay}`,
    canonicalUrl: canonicalizeNotificationUrl(primary.website),
    school,
    institute: normalizeDuplicateText(primary.institute),
    title,
    activityType,
    sourceGroups: new Set(entries.flatMap((entry) => entry.sourceGroups ?? [entry.sourceGroup]))
  };
}

function areConservativeTitleMatches(
  left: NonNullable<ReturnType<typeof getClusterMatchProfile>>,
  right: NonNullable<ReturnType<typeof getClusterMatchProfile>>
): boolean {
  if (left.school !== right.school) {
    return false;
  }
  if (
    left.institute === "" ||
    right.institute === "" ||
    left.institute !== right.institute
  ) {
    return false;
  }
  if (
    left.activityType !== "unknown" &&
    right.activityType !== "unknown" &&
    left.activityType !== right.activityType
  ) {
    return false;
  }
  return left.title === right.title;
}

function areCorroboratedSameSourceTitleAliases(
  left: NonNullable<ReturnType<typeof getClusterMatchProfile>>,
  right: NonNullable<ReturnType<typeof getClusterMatchProfile>>
): boolean {
  if (
    left.title.length < MIN_CORROBORATED_ALIAS_TITLE_LENGTH ||
    !isSpecificNoticeUrl(left.canonicalUrl) ||
    !isSpecificNoticeUrl(right.canonicalUrl)
  ) {
    return false;
  }
  const leftIsSubset = Array.from(left.sourceGroups).every((sourceGroup) =>
    right.sourceGroups.has(sourceGroup)
  );
  const rightIsSubset = Array.from(right.sourceGroups).every((sourceGroup) =>
    left.sourceGroups.has(sourceGroup)
  );
  return (
    (left.sourceGroups.size > 1 || right.sourceGroups.size > 1) &&
    (leftIsSubset || rightIsSubset)
  );
}

function findClusterRoot(parent: number[], index: number): number {
  const value = parent[index]!;
  if (value === index) {
    return value;
  }
  const root = findClusterRoot(parent, value);
  parent[index] = root;
  return root;
}

function unionClustersIfSourceDisjoint(
  parent: number[],
  sourceGroups: Set<string>[],
  left: number,
  right: number
): boolean {
  const leftRoot = findClusterRoot(parent, left);
  const rightRoot = findClusterRoot(parent, right);
  if (leftRoot === rightRoot) {
    return false;
  }
  const leftSources = sourceGroups[leftRoot]!;
  const rightSources = sourceGroups[rightRoot]!;
  if (Array.from(leftSources).some((sourceGroup) => rightSources.has(sourceGroup))) {
    return false;
  }
  return unionClusterRoots(parent, sourceGroups, leftRoot, rightRoot);
}

function unionClusters(
  parent: number[],
  sourceGroups: Set<string>[],
  left: number,
  right: number
): boolean {
  const leftRoot = findClusterRoot(parent, left);
  const rightRoot = findClusterRoot(parent, right);
  if (leftRoot === rightRoot) {
    return false;
  }
  return unionClusterRoots(parent, sourceGroups, leftRoot, rightRoot);
}

function unionClusterRoots(
  parent: number[],
  sourceGroups: Set<string>[],
  leftRoot: number,
  rightRoot: number
): boolean {
  const leftSources = sourceGroups[leftRoot]!;
  const rightSources = sourceGroups[rightRoot]!;
  parent[rightRoot] = leftRoot;
  for (const sourceGroup of rightSources) {
    leftSources.add(sourceGroup);
  }
  return true;
}

function getSourceObservations(item: SourceItemInput): SourceObservation[] {
  if (item.sourceObservations !== undefined && item.sourceObservations.length > 0) {
    return item.sourceObservations;
  }
  const deadlinePrecision = item.deadlinePrecision ?? inferDeadlinePrecision(item.deadline, item.deadline);
  return [
    createSourceObservation({
      sourceGroup: item.sourceGroup,
      sourceItemId: canonicalizeNotificationUrl(item.website),
      title: getUsefulTextLength(item.description) === 0 ? "" : item.description,
      website: item.website,
      deadlineRaw: item.deadline,
      deadline: item.deadline,
      deadlinePrecision,
      publishedAt: ""
    })
  ];
}

function dedupeObservations(observations: SourceObservation[]): SourceObservation[] {
  const seen = new Set<string>();
  return observations
    .filter((observation) => {
      const key = [
        observation.sourceGroup,
        observation.sourceItemId || canonicalizeNotificationUrl(observation.website),
        canonicalizeNotificationUrl(observation.website),
        observation.deadline,
        observation.title
      ].join("\u0000");
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((left, right) => {
      const sourceCompare = compareSourceGroups(left.sourceGroup, right.sourceGroup);
      if (sourceCompare !== 0) {
        return sourceCompare;
      }
      return `${left.website}\u0000${left.deadline}`.localeCompare(`${right.website}\u0000${right.deadline}`);
    });
}

function chooseMergedField(
  entries: SourceItemInput[],
  primary: SourceItemInput,
  field: "name" | "institute"
): string {
  if (field === "institute") {
    return entries
      .filter((entry) => entry.institute.trim() !== "")
      .sort((left, right) => {
        const annotationCompare =
          getInstituteAnnotationPenalty(left.institute) -
          getInstituteAnnotationPenalty(right.institute);
        if (annotationCompare !== 0) {
          return annotationCompare;
        }
        const sourceCompare =
          getSourcePriority(right.sourceGroup) - getSourcePriority(left.sourceGroup);
        if (sourceCompare !== 0) {
          return sourceCompare;
        }
        return (
          right.institute.trim().length - left.institute.trim().length ||
          left.institute.localeCompare(right.institute)
        );
      })[0]?.institute.trim() ?? "";
  }
  const primaryValue = primary[field].trim();
  if (primaryValue !== "") {
    return primaryValue;
  }
  return entries
    .map((entry) => entry[field].trim())
    .sort((left, right) => right.length - left.length || left.localeCompare(right))[0] ?? "";
}

function getInstituteAnnotationPenalty(value: string): number {
  return /[-—–].*(?:发布|报名|审核|活动时间|举办|招生简介|本校学生|即刻报名|截止|考核|分批|\d{1,2}月|\d{1,2}日)/u.test(
    value
  )
    ? 1
    : 0;
}

function chooseMergedDescription(
  entries: SourceItemInput[],
  observations: SourceObservation[],
  primary: SourceItemInput
): string {
  const titles = observations
    .map((observation) => observation.title.trim())
    .filter((title) => title !== "" && title !== "保研信息平台补充源");
  if (titles.length > 0) {
    return titles.sort((left, right) => right.length - left.length || left.localeCompare(right))[0]!;
  }
  if (getUsefulTextLength(primary.description) > 0) {
    return primary.description.trim();
  }
  return entries
    .map((entry) => entry.description.trim())
    .sort((left, right) => right.length - left.length || left.localeCompare(right))[0] ?? "";
}

function choosePreferredWebsite(entries: SourceItemInput[], primary: SourceItemInput): string {
  return entries
    .map((entry) => entry.website.trim())
    .filter((website) => canonicalizeNotificationUrl(website) !== "")
    .sort((left, right) => {
      const qualityCompare = getWebsiteQuality(right) - getWebsiteQuality(left);
      if (qualityCompare !== 0) {
        return qualityCompare;
      }
      const leftPrimary = left === primary.website ? 1 : 0;
      const rightPrimary = right === primary.website ? 1 : 0;
      if (leftPrimary !== rightPrimary) {
        return rightPrimary - leftPrimary;
      }
      return left.localeCompare(right);
    })[0] ?? primary.website;
}

function getAlternateWebsites(entries: SourceItemInput[], selectedWebsite: string): string[] {
  const selected = canonicalizeNotificationUrl(selectedWebsite);
  const byCanonicalUrl = new Map<string, string>();
  for (const entry of entries) {
    for (const website of [entry.website, ...(entry.alternateWebsites ?? [])]) {
      const canonical = canonicalizeNotificationUrl(website);
      if (canonical !== "" && canonical !== selected && !byCanonicalUrl.has(canonical)) {
        byCanonicalUrl.set(canonical, website);
      }
    }
  }
  return Array.from(byCanonicalUrl.values()).sort((left, right) => left.localeCompare(right));
}

function selectMergedDeadline(observations: SourceObservation[]): {
  value: string;
  precision: DeadlinePrecision;
  conflict: boolean;
  source: string;
} {
  const groups = new Map<
    string,
    { observations: SourceObservation[]; precision: DeadlinePrecision }
  >();
  for (const observation of observations) {
    const deadline = parseComparableDeadline(observation.deadline);
    if (deadline === null) {
      continue;
    }
    const key = deadline.toISOString();
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, {
        observations: [observation],
        precision: observation.deadlinePrecision
      });
      continue;
    }
    group.observations.push(observation);
    if (getDeadlinePrecisionRank(observation.deadlinePrecision) > getDeadlinePrecisionRank(group.precision)) {
      group.precision = observation.deadlinePrecision;
    }
  }
  const candidates = Array.from(groups.entries());
  if (candidates.length === 0) {
    return { value: "", precision: "unknown", conflict: false, source: "" };
  }
  candidates.sort(([leftKey, left], [rightKey, right]) => {
    const precisionCompare =
      getDeadlinePrecisionRank(right.precision) - getDeadlinePrecisionRank(left.precision);
    if (precisionCompare !== 0) {
      return precisionCompare;
    }
    const countCompare = right.observations.length - left.observations.length;
    if (countCompare !== 0) {
      return countCompare;
    }
    const priorityCompare =
      getHighestObservationPriority(right.observations) -
      getHighestObservationPriority(left.observations);
    if (priorityCompare !== 0) {
      return priorityCompare;
    }
    return leftKey.localeCompare(rightKey);
  });
  const [value, selected] = candidates[0]!;
  const selectedSourceGroups = Array.from(
    new Set(selected.observations.map((observation) => observation.sourceGroup))
  );
  return {
    value,
    precision: selected.precision,
    conflict: candidates.length > 1,
    source:
      selectedSourceGroups.length > 1
        ? "multi-source-consensus"
        : selectedSourceGroups[0] ?? ""
  };
}

function selectMergedActivityType(
  entries: SourceItemInput[],
  title: string,
  institute: string
): ActivityTypeDetails {
  const textDetails = getActivityTypeFromText(`${title} ${institute}`);
  if (textDetails.activityType !== "unknown") {
    return textDetails;
  }
  return entries
    .map((entry) => getActivityTypeDetails(entry))
    .filter((details) => details.activityType !== "unknown")
    .sort((left, right) => {
      const sourceCompare = getActivityTypeSourceRank(right.activityTypeSource) -
        getActivityTypeSourceRank(left.activityTypeSource);
      if (sourceCompare !== 0) {
        return sourceCompare;
      }
      return left.activityType.localeCompare(right.activityType);
    })[0] ?? { activityType: "unknown", activityTypeSource: "unknown" };
}

function getActivityTypeSourceRank(source: ActivityTypeSource): number {
  if (source === "classification") {
    return 4;
  }
  if (source === "text") {
    return 3;
  }
  if (source === "source") {
    return 2;
  }
  if (source === "source_group") {
    return 1;
  }
  return 0;
}

function shouldPreferMergedSourceItem(candidate: SourceItemInput, current: SourceItemInput): boolean {
  const priorityCompare = getSourcePriority(candidate.sourceGroup) - getSourcePriority(current.sourceGroup);
  if (priorityCompare !== 0) {
    return priorityCompare > 0;
  }
  const websiteQualityCompare = getWebsiteQuality(candidate.website) - getWebsiteQuality(current.website);
  if (websiteQualityCompare !== 0) {
    return websiteQualityCompare > 0;
  }
  const precisionCompare =
    getDeadlinePrecisionRank(candidate.deadlinePrecision ?? "unknown") -
    getDeadlinePrecisionRank(current.deadlinePrecision ?? "unknown");
  if (precisionCompare !== 0) {
    return precisionCompare > 0;
  }
  return shouldPreferSourceItem(candidate, current);
}

function getSourcePriority(sourceGroup: string): number {
  if (sourceGroup === MANUAL_SOURCE_GROUP) {
    return 1_000;
  }
  if (
    sourceGroup === BAOYANXINXI_SOURCE_GROUP ||
    sourceGroup === BAOYANXINXI_PRE_RECOMMENDATION_SOURCE_GROUP
  ) {
    return 900;
  }
  if (sourceGroup === XINGKE_SOURCE_GROUP) {
    return 800;
  }
  if (sourceGroup === ZSCAMPUS_SOURCE_GROUP) {
    return 700;
  }
  return 0;
}

function compareSourceGroups(left: string, right: string): number {
  const priorityCompare = getSourcePriority(right) - getSourcePriority(left);
  return priorityCompare !== 0 ? priorityCompare : left.localeCompare(right);
}

function getWebsiteQuality(value: string): number {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    let quality = url.protocol === "https:" ? 20 : 0;
    if (/\.edu\.cn$|\.ac\.cn$|\.cas\.cn$|\.org\.cn$/u.test(host)) {
      quality += 40;
    }
    if (host === "mp.weixin.qq.com") {
      quality += 10;
    }
    if (host.includes("baoyan") || host.includes("zscampus")) {
      quality -= 30;
    }
    return quality;
  } catch {
    return 0;
  }
}

function getDeadlinePrecisionRank(precision: DeadlinePrecision): number {
  if (precision === "exact") {
    return 2;
  }
  if (precision === "date") {
    return 1;
  }
  return 0;
}

function getHighestObservationPriority(observations: SourceObservation[]): number {
  return observations.reduce(
    (highest, observation) => Math.max(highest, getSourcePriority(observation.sourceGroup)),
    0
  );
}

function normalizeComparableTitle(value: string, school: string, institute: string): string {
  let normalized = stripComparableTitleSiteSuffix(
    decodeHtml(value),
    school,
    institute
  )
    .replaceAll(school, "")
    .replaceAll(institute, "")
    .replace(/[（(]\s*(?:含|包括)?\s*(?:本科)?(?:直博生?|直接攻博|直博)\s*[）)]/gu, "")
    .replace(/(?:含|包括)(?:本科)?(?:直博生?|直接攻博|直博)/gu, "")
    .replace(/20\d{2}\s*[年级]?/gu, "")
    .replace(
      /优秀应届本科毕业生(?:推荐)?免试攻读(?:硕士)?研究生/gu,
      "推免生"
    )
    .replace(
      /(?:推荐免试(?:攻读)?(?:硕士)?研究生|推荐免试生|推免(?:硕士)?研究生)/gu,
      "推免生"
    )
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase();

  for (const entity of [school, institute]) {
    const entityKey = normalizeComparableEntity(entity);
    if (entityKey !== "") {
      normalized = normalized.replaceAll(entityKey, "");
    }
  }

  return normalized
    .replace(/^(?:(?:重要|报名|招生)通知|关于(?:举办)?)/u, "")
    .replace(/(?:的)?(?:通知|公告|说明)$/u, "");
}

function stripComparableTitleSiteSuffix(
  value: string,
  school: string,
  institute: string
): string {
  const entities = [school, institute]
    .map((entity) => normalizeComparableEntity(entity))
    .filter((entity) => entity !== "");
  if (entities.length === 0) {
    return value;
  }

  const delimiters = Array.from(value.matchAll(/-{1,4}|—{1,4}|–{1,4}/gu));
  for (let index = delimiters.length - 1; index >= 0; index -= 1) {
    const delimiter = delimiters[index]!;
    const delimiterIndex = delimiter.index ?? -1;
    if (delimiterIndex <= 0) {
      continue;
    }
    const suffix = normalizeComparableEntity(
      value.slice(delimiterIndex + delimiter[0].length)
    );
    if (entities.some((entity) => suffix.includes(entity))) {
      return value.slice(0, delimiterIndex);
    }
  }
  return value;
}

function getDeadlineDay(value: string): string {
  const deadline = parseComparableDeadline(value);
  return deadline === null ? "" : SHANGHAI_DATE_FORMATTER.format(deadline);
}

function buildMergeReviewCandidates(items: SourceItemInput[]): SourceReviewCandidateInput[] {
  return items
    .filter((item) => item.deadlineConflict === true || item.mergeReason === "title_match")
    .flatMap((item) => {
      const normalizedUrl = canonicalizeNotificationUrl(item.website);
      if (normalizedUrl === "") {
        return [];
      }
      const sourceSummary = (item.sourceObservations ?? [])
        .map((observation) => `${observation.sourceGroup}:${observation.deadlineRaw || "未给出"}`)
        .join("；");
      return [
        {
          normalizedUrl,
          sourceGroup: "multi-source-merge",
          reason: item.deadlineConflict === true ? "deadline-conflict" : "title-match",
          payload: {
            sourceGroup: "multi-source-merge",
            name: item.name,
            institute: item.institute,
            description: item.description,
            deadline: item.deadline,
            website: item.website,
            note: `待核验合并：${sourceSummary}`
          }
        }
      ];
    });
}

function enrichSourceStats(
  sourceStats: SourceStats[],
  merged: MergeSourceItemsResult
): SourceStats[] {
  return sourceStats.map((stats) => {
    const matchingItems = merged.items.filter((item) =>
      (item.sourceGroups ?? [item.sourceGroup]).includes(stats.sourceGroup)
    );
    return {
      ...stats,
      duplicateCount:
        stats.duplicateCount + (merged.duplicateCountsBySource.get(stats.sourceGroup) ?? 0),
      exclusiveCount: matchingItems.filter(
        (item) => (item.sourceGroups ?? [item.sourceGroup]).length === 1
      ).length,
      crossSourceDuplicateCount: matchingItems.filter(
        (item) => (item.sourceGroups ?? [item.sourceGroup]).length > 1
      ).length,
      conflictCount: matchingItems.filter((item) => item.deadlineConflict === true).length,
      reviewCandidateCount: matchingItems.filter(
        (item) => item.deadlineConflict === true || item.mergeReason === "title_match"
      ).length
    };
  });
}

function getSourceYear(env: Env): number {
  const configured = Number.parseInt(env.SOURCE_YEAR?.trim() ?? "", 10);
  if (Number.isInteger(configured) && configured >= 2020 && configured <= 2100) {
    return configured;
  }
  return Number.parseInt(SHANGHAI_YEAR_FORMATTER.format(new Date()), 10);
}

function readObjectArray(data: unknown, key: string): Array<Record<string, unknown>> {
  if (!isRecord(data) || !Array.isArray(data[key])) {
    throw new Error(`缺少 ${key} 数组`);
  }
  return data[key] as Array<Record<string, unknown>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function getAggregateActivityType(category: string, title: string): ActivityTypeDetails {
  const textDetails = getActivityTypeFromText(title);
  if (textDetails.activityType !== "unknown") {
    return textDetails;
  }
  if (/预推免|预免推|九推|推荐免试/u.test(category)) {
    return { activityType: "pre_recommendation", activityTypeSource: "source" };
  }
  if (/夏令营|暑期学校|开放日/u.test(category)) {
    return { activityType: "summer_camp", activityTypeSource: "source" };
  }
  return { activityType: "unknown", activityTypeSource: "unknown" };
}

function normalizePublishedAt(value: string): string {
  if (value === "") {
    return "";
  }
  const normalized = normalizeBaoyanXinxiDeadline(value);
  return parseComparableDeadline(normalized) === null ? "" : normalized;
}

function getLatestTimestamp(current: string, candidate: string): string {
  return candidate > current ? candidate : current;
}

function inferDeadlinePrecision(value: string, normalized: string): DeadlinePrecision {
  if (normalized === "" || parseComparableDeadline(normalized) === null) {
    return "unknown";
  }
  const compact = decodeHtml(value).trim().replace(/\s+/gu, "T");
  if (/^\d{4}-\d{1,2}-\d{1,2}$/u.test(compact)) {
    return "date";
  }
  if (/T?23:59(?::59)?(?:Z|[+-]\d{1,2}:?\d{2})?$/u.test(compact)) {
    return "date";
  }
  return "exact";
}

function inferManualDeadlinePrecision(normalized: string): DeadlinePrecision {
  return normalized === "" ? "unknown" : "exact";
}

function createSourceObservation(observation: SourceObservation): SourceObservation {
  return {
    ...observation,
    sourceItemId:
      observation.sourceItemId.trim() === ""
        ? canonicalizeNotificationUrl(observation.website)
        : observation.sourceItemId.trim(),
    title: observation.title.trim(),
    website: observation.website.trim(),
    deadlineRaw: observation.deadlineRaw.trim(),
    deadline: observation.deadline.trim(),
    publishedAt: observation.publishedAt.trim()
  };
}

function shouldPreferSourceItem(candidate: SourceItemInput, current: SourceItemInput): boolean {
  const candidateYearDistance = getSourceDeadlineYearDistance(candidate);
  const currentYearDistance = getSourceDeadlineYearDistance(current);
  if (candidateYearDistance !== currentYearDistance) {
    return candidateYearDistance < currentYearDistance;
  }

  const candidateDescriptionLength = getUsefulTextLength(candidate.description);
  const currentDescriptionLength = getUsefulTextLength(current.description);
  if (candidateDescriptionLength !== currentDescriptionLength) {
    return candidateDescriptionLength > currentDescriptionLength;
  }

  return candidate.sourceGroup.localeCompare(current.sourceGroup) < 0;
}

function getSourceDeadlineYearDistance(item: SourceItemInput): number {
  const sourceYear = getSourceGroupYear(item.sourceGroup);
  const deadlineYear = getDeadlineYear(item.deadline);
  if (sourceYear === null || deadlineYear === null) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Math.abs(sourceYear - deadlineYear);
}

function getSourceGroupYear(sourceGroup: string): number | null {
  const match = /\d{4}/u.exec(sourceGroup);
  return match === null ? null : Number.parseInt(match[0], 10);
}

function getDeadlineYear(value: string): number | null {
  const deadline = parseComparableDeadline(value);
  if (deadline === null) {
    return null;
  }
  return Number.parseInt(SHANGHAI_YEAR_FORMATTER.format(deadline), 10);
}

function getComparableDeadlineKey(value: string): string {
  const deadline = parseComparableDeadline(value);
  return deadline === null ? decodeHtml(value).trim() : deadline.toISOString();
}

function normalizeDuplicateText(value: string): string {
  return value.replace(/\s+/gu, "").replace(/[（(].*?[）)]/gu, "").toLowerCase();
}

function getUsefulTextLength(value: string): number {
  const trimmed = value.trim();
  return trimmed === "_No response_" ? 0 : trimmed.length;
}

async function finalizeSourceItems(items: SourceItemInput[]): Promise<{ items: NormalizedItem[] }> {
  const baseKeyCounts = new Map<string, number>();
  const prepared = [];

  for (const item of items) {
    const canonicalUrl = canonicalizeNotificationUrl(item.website);
    const baseKey = await sha256Hex(
      stableStringify({
        identity:
          canonicalUrl === ""
            ? {
                sourceGroup: item.sourceGroup,
                name: normalizeDuplicateText(item.name),
                institute: normalizeDuplicateText(item.institute),
                deadline: getComparableDeadlineKey(item.deadline)
              }
            : canonicalUrl
      })
    );
    prepared.push({ baseKey, item });
  }

  prepared.sort((left, right) => {
    const urlCompare = canonicalizeNotificationUrl(left.item.website).localeCompare(
      canonicalizeNotificationUrl(right.item.website)
    );
    if (urlCompare !== 0) {
      return urlCompare;
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
  }

  return { items: finalized };
}

export async function mergeNormalizedItems(items: NormalizedItem[]): Promise<NormalizedItem[]> {
  const sourceItems = items.map(({ key: _key, contentHash: _contentHash, ...item }) => item);
  return (await finalizeSourceItems(mergeSourceItems(sourceItems).items)).items;
}

export async function rehashNormalizedItem(item: NormalizedItem): Promise<NormalizedItem> {
  const { key: _key, contentHash: _contentHash, ...sourceItem } = item;
  return {
    ...item,
    contentHash: await sha256Hex(stableStringify(sourceItem))
  };
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

  const textDetails = getActivityTypeFromText(
    `${name} ${institute} ${toCleanString(record.description)}`
  );
  const sourceDetails = getActivityTypeFromSourceGroup(sourceGroup);
  const activityTypeDetails =
    textDetails.activityTypeSource === "text" ? textDetails : sourceDetails;

  return {
    sourceGroup,
    name,
    institute,
    description: toCleanString(record.description),
    deadline: toCleanString(record.deadline),
    website: toCleanString(record.website),
    activityType: activityTypeDetails.activityType,
    activityTypeSource: activityTypeDetails.activityTypeSource,
    tags: Array.isArray(record.tags)
      ? sanitizeDisplayTags(record.tags.map(toCleanString).filter((tag) => tag !== ""))
      : []
  };
}

function parseBaoyanXinxiHtml(
  html: string,
  sourceUrl: string,
  sourceGroup: string,
  defaultActivityType: ActivityType
): BaoyanXinxiParseResult {
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
      const deadlineMatches = Array.from(
        paragraph.matchAll(/<span\b[^>]*\bdeadline\b[^>]*>[\s\S]*?<\/span>/giu)
      );
      rawCount += Math.max(deadlineMatches.length, 1);

      for (const [index, deadlineMatch] of deadlineMatches.entries()) {
        const recordStart = deadlineMatch.index ?? 0;
        const recordEnd = deadlineMatches[index + 1]?.index ?? paragraph.length;
        const recordHtml = paragraph.slice(recordStart, recordEnd);
        const linkMatch = /<a\b[^>]*>([\s\S]*?)<\/a>/iu.exec(recordHtml);
        const linkTag = linkMatch?.[0] ?? "";
        const href = extractAttribute(linkTag, "href");
        const institute = linkMatch?.[1] === undefined ? "" : stripTags(linkMatch[1]);
        if (name === "" || institute === "" || href === "") {
          continue;
        }
        records.push({
          name,
          institute,
          deadline: extractDeadline(deadlineMatch[0]),
          website: resolveRecordUrl(href, sourceUrl),
          ...resolveBaoyanXinxiActivityType(
            `${recordHtml} ${institute}`,
            sourceGroup,
            defaultActivityType
          )
        });
      }
    }
  }

  return { rawCount, records };
}

function resolveBaoyanXinxiActivityType(
  text: string,
  sourceGroup: string,
  defaultActivityType: ActivityType
): Pick<BaoyanXinxiRecord, "activityType" | "activityTypeSource"> {
  const textDetails = getActivityTypeFromText(text);
  if (textDetails.activityTypeSource === "text") {
    return textDetails;
  }
  const sourceGroupDetails = getActivityTypeFromSourceGroup(sourceGroup);
  if (sourceGroupDetails.activityType !== "unknown") {
    return sourceGroupDetails;
  }
  return {
    activityType: defaultActivityType,
    activityTypeSource: defaultActivityType === "unknown" ? "unknown" : "source"
  };
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

function parseComparableDeadline(value: string): Date | null {
  const trimmed = value.trim();
  if (UNKNOWN_DEADLINE_VALUES.has(trimmed)) {
    return null;
  }
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isFutureDeadline(value: string): boolean {
  const deadline = parseComparableDeadline(value);
  return deadline !== null && deadline.getTime() > Date.now();
}


function toCleanString(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function toSourceItemId(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
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
  return schools.some(
    (school) =>
      name === school || name.startsWith(school) || (name.length >= 4 && school.includes(name))
  );
}

function isNonTierTag(tag: string): boolean {
  return NON_TIER_TAG_KEYWORDS.some((keyword) => tag.includes(keyword));
}

function stripTags(value: string): string {
  return toCleanString(decodeHtml(value.replace(/<[^>]*>/gu, "")));
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
