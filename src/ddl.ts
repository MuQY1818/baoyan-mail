import { getSchoolTierTags } from "./source";
import type { NormalizedItem } from "./types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SHANGHAI_TIME_ZONE = "Asia/Shanghai";
const UNKNOWN_DEADLINE_VALUES = new Set(["", "暂无", "待定", "无明确说明"]);
const SHANGHAI_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: SHANGHAI_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export interface DdlApiItem {
  key: string;
  school: string;
  institute: string;
  description: string;
  deadlineAt: string;
  deadlineText: string;
  remainingDays: number;
  remainingText: string;
  status: "today" | "future" | "expired";
  tier: string;
  sourceGroup: string;
  sourceLabel: string;
  website: string;
}

export interface DdlApiResponse {
  ok: true;
  generatedAt: string;
  timezone: "Asia/Shanghai";
  total: number;
  items: DdlApiItem[];
}

export function buildDdlResponse(items: NormalizedItem[], now = new Date()): DdlApiResponse {
  const ddlItems = items
    .map((item) => serializeDdlItem(item, now))
    .filter((item): item is DdlApiItem => item !== null)
    .sort(compareDdlItems);

  return {
    ok: true,
    generatedAt: now.toISOString(),
    timezone: SHANGHAI_TIME_ZONE,
    total: ddlItems.length,
    items: ddlItems
  };
}

export function serializeDdlItem(item: NormalizedItem, now = new Date()): DdlApiItem | null {
  const deadline = parseDeadline(item.deadline);
  if (deadline === null) {
    return null;
  }

  const remainingDays = getShanghaiCalendarDaysUntil(now, deadline);
  const status = getDeadlineStatus(deadline, remainingDays, now);
  const tier = getSchoolTierTags(item.name)[0] ?? "其他";

  return {
    key: item.key,
    school: item.name,
    institute: item.institute,
    description: item.description === "_No response_" ? "" : item.description,
    deadlineAt: deadline.toISOString(),
    deadlineText: formatShanghaiDateTime(deadline),
    remainingDays,
    remainingText: formatRemainingText(status, remainingDays),
    status,
    tier,
    sourceGroup: item.sourceGroup,
    sourceLabel: formatSourceGroup(item.sourceGroup),
    website: item.website
  };
}

export function parseDeadline(value: string): Date | null {
  const trimmed = value.trim();
  if (UNKNOWN_DEADLINE_VALUES.has(trimmed)) {
    return null;
  }

  const candidates = [trimmed, normalizeDeadlineString(trimmed)];
  for (const candidate of candidates) {
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  return null;
}

export function getShanghaiCalendarDaysUntil(now: Date, deadline: Date): number {
  return (
    toUtcDayNumber(getShanghaiDateParts(deadline)) - toUtcDayNumber(getShanghaiDateParts(now))
  );
}

export function formatShanghaiDate(date: Date): string {
  return SHANGHAI_DATE_FORMATTER.format(date);
}

function compareDdlItems(left: DdlApiItem, right: DdlApiItem): number {
  const deadlineCompare = left.deadlineAt.localeCompare(right.deadlineAt);
  if (deadlineCompare !== 0) {
    return deadlineCompare;
  }
  const tierCompare = getTierRank(left.tier) - getTierRank(right.tier);
  if (tierCompare !== 0) {
    return tierCompare;
  }
  return `${left.school}${left.institute}`.localeCompare(`${right.school}${right.institute}`);
}

function getDeadlineStatus(
  deadline: Date,
  remainingDays: number,
  now: Date
): "today" | "future" | "expired" {
  if (deadline.getTime() <= now.getTime()) {
    return "expired";
  }
  return remainingDays <= 0 ? "today" : "future";
}

function formatRemainingText(status: DdlApiItem["status"], remainingDays: number): string {
  if (status === "expired") {
    return "已截止";
  }
  if (remainingDays <= 0) {
    return "今日截止";
  }
  return `${remainingDays} 天后截止`;
}

function formatShanghaiDateTime(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: SHANGHAI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function formatSourceGroup(sourceGroup: string): string {
  if (sourceGroup === "baoyanxinxi2026jsjby") {
    return "保研信息平台";
  }
  const match = /^(camp|yutuimian)(\d{4})$/u.exec(sourceGroup);
  if (match === null) {
    return sourceGroup;
  }
  const type = match[1] === "camp" ? "夏令营" : "预推免";
  return `${match[2]} ${type}`;
}

function getTierRank(tier: string): number {
  const rank = ["Top2", "华五", "C9", "985", "211", "其他"].indexOf(tier);
  return rank === -1 ? Number.MAX_SAFE_INTEGER : rank;
}

function normalizeDeadlineString(value: string): string {
  let normalized = value.trim();
  normalized = normalized.replace(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(.*)$/u,
    (_match, year: string, month: string, day: string, rest: string) =>
      `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}${rest}`
  );
  normalized = normalized.replace(
    /([+-])(\d{1,2}):(\d{2})$/u,
    (_match, sign: string, hour: string, minute: string) =>
      `${sign}${hour.padStart(2, "0")}:${minute}`
  );
  return normalized.replace(/T(\d{2}:\d{2}:\d{2}):00([+-]\d{2}:\d{2})$/u, "T$1$2");
}

function getShanghaiDateParts(date: Date): { year: number; month: number; day: number } {
  const parts = SHANGHAI_DATE_FORMATTER.formatToParts(date);
  const year = readDatePart(parts, "year");
  const month = readDatePart(parts, "month");
  const day = readDatePart(parts, "day");
  return { year, month, day };
}

function readDatePart(parts: Intl.DateTimeFormatPart[], type: string): number {
  const value = parts.find((part) => part.type === type)?.value;
  return value === undefined ? 0 : Number.parseInt(value, 10);
}

function toUtcDayNumber(parts: { year: number; month: number; day: number }): number {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / MS_PER_DAY);
}
