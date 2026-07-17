import type { ActivityType } from "../applicationTracker";
import {
  AREA_OPTIONS,
  RANGE_OPTIONS,
  RECENT_DAYS,
  TIER_OPTIONS,
  TIER_RANK
} from "../constants";
import type {
  ActivityTypeFilter,
  AreaFilter,
  DdlItem,
  RangeFilter,
  RecentFilter,
  Relevance,
  RelevanceFilter,
  SourceFilter,
  TierFilter,
  TimelineStop
} from "../types";
import { formatTimelineDate } from "./datetime";

export function getAreaClass(area: string): string {
  switch (area) {
    case "人工智能": return "area-ai";
    case "数据科学": return "area-data";
    case "计算机": return "area-cs";
    case "软件": return "area-software";
    case "网络安全": return "area-security";
    case "电子信息": return "area-ee";
    case "通信": return "area-telecom";
    case "集成电路": return "area-ic";
    case "自动化控制": return "area-control";
    case "机器人光电": return "area-robot";
    default: return "area-other";
  }
}

export function filterItems(
  items: DdlItem[],
  query: string,
  range: RangeFilter,
  source: SourceFilter,
  relevance: RelevanceFilter,
  activityType: ActivityTypeFilter,
  tiers: Set<TierFilter>,
  areas: Set<AreaFilter>,
  recent: RecentFilter
): DdlItem[] {
  const keyword = query.trim().toLowerCase();
  const rangeConfig = RANGE_OPTIONS.find((option) => option.value === range);
  return items.filter((item) => {
    if (!matchesRelevance(item, relevance)) {
      return false;
    }
    if (activityType !== "all" && item.activityType !== activityType) {
      return false;
    }
    if (!tiers.has(item.tier)) {
      return false;
    }
    if (areas.size > 0 && !getItemAreas(item).some((area) => areas.has(area as AreaFilter))) {
      return false;
    }
    if (rangeConfig?.maxDays !== null && rangeConfig?.maxDays !== undefined) {
      if (item.remainingDays > rangeConfig.maxDays) {
        return false;
      }
    }
    if (source === "baoyanxinxi" && item.sourceGroup !== "baoyanxinxi2026jsjby") {
      return false;
    }
    if (source === "manual" && item.sourceGroup !== "manual") {
      return false;
    }
    if (recent === "new" && !isWithinRecentDays(item.firstSeenAt)) {
      return false;
    }
    if (recent === "updated" && !isRecentlyUpdated(item)) {
      return false;
    }
    if (keyword === "") {
      return true;
    }
    return `${item.school} ${item.institute} ${item.description} ${getItemAreas(item).join(" ")}`
      .toLowerCase()
      .includes(keyword);
  });
}

function matchesRelevance(item: DdlItem, relevance: RelevanceFilter): boolean {
  if (relevance === "all") {
    return true;
  }
  if (relevance === "possible") {
    return item.relevance === "strong" || item.relevance === "possible";
  }
  return item.relevance === "strong";
}

export function buildActivityTypeStats(items: DdlItem[]): Record<ActivityType, number> {
  const stats: Record<ActivityType, number> = {
    summer_camp: 0,
    pre_recommendation: 0,
    unknown: 0
  };
  for (const item of items) {
    stats[item.activityType] += 1;
  }
  return stats;
}

export function getAdvancedFilterCount(filters: {
  activeAreas: Set<AreaFilter>;
  activeTiers: Set<TierFilter>;
  recent: RecentFilter;
  source: SourceFilter;
}): number {
  let count = 0;
  if (filters.activeAreas.size > 0) count += 1;
  if (filters.activeTiers.size !== TIER_OPTIONS.length) count += 1;
  if (filters.source !== "all") count += 1;
  if (filters.recent !== "all") count += 1;
  return count;
}

export function getDdlActiveFilterCount(filters: {
  activeAreas: Set<AreaFilter>;
  activeTiers: Set<TierFilter>;
  activityType: ActivityTypeFilter;
  query: string;
  range: RangeFilter;
  recent: RecentFilter;
  relevance: RelevanceFilter;
  source: SourceFilter;
}): number {
  return (
    Number(filters.query.trim() !== "") +
    Number(filters.activityType !== "all") +
    Number(filters.relevance !== "strong") +
    Number(filters.range !== "future") +
    getAdvancedFilterCount(filters)
  );
}

export function buildStats(items: DdlItem[]): {
  today: number;
  threeDays: number;
  sevenDays: number;
  fifteenDays: number;
  later: number;
} {
  return {
    today: items.filter((item) => item.remainingDays <= 0).length,
    threeDays: items.filter((item) => item.remainingDays >= 0 && item.remainingDays <= 3).length,
    sevenDays: items.filter((item) => item.remainingDays >= 0 && item.remainingDays <= 7).length,
    fifteenDays: items.filter((item) => item.remainingDays >= 0 && item.remainingDays <= 15).length,
    later: items.filter((item) => item.remainingDays > 15).length
  };
}

export function buildTimeline(items: DdlItem[]): TimelineStop[] {
  const byDay = new Map<number, DdlItem[]>();
  for (const item of items) {
    const day = Math.max(0, item.remainingDays);
    const bucket = byDay.get(day);
    if (bucket === undefined) {
      byDay.set(day, [item]);
    } else {
      bucket.push(item);
    }
  }

  return Array.from(byDay.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([day, dayItems]) => {
      const sample = dayItems[0];
      const entries = dayItems
        .slice()
        .sort((a, b) => {
          const rankDiff = TIER_RANK[a.tier] - TIER_RANK[b.tier];
          return rankDiff !== 0 ? rankDiff : a.school.localeCompare(b.school, "zh-CN");
        })
        .map((item) => ({
          key: item.key,
          school: item.school,
          institute: item.institute,
          tier: item.tier,
          activityType: item.activityType,
          website: item.website
        }));
      return {
        remainingDays: day,
        dayLabel: dayLabelFor(day),
        dateLabel: sample === undefined ? "" : formatTimelineDate(sample.deadlineAt),
        isToday: day === 0,
        entries
      };
    });
}

function dayLabelFor(day: number): string {
  if (day === 0) {
    return "今日";
  }
  if (day === 1) {
    return "明天";
  }
  if (day === 2) {
    return "后天";
  }
  return `${day} 天后`;
}

export function formatTimelineRangeLabel(range: RangeFilter): string {
  const option = RANGE_OPTIONS.find((entry) => entry.value === range);
  if (option === undefined || option.value === "future") {
    return "全部未来";
  }
  if (option.value === "today") {
    return "今日";
  }
  return `未来 ${option.label}`;
}

export function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

export function formatRelevance(value: Relevance): string {
  if (value === "strong") {
    return "强相关";
  }
  if (value === "possible") {
    return "可能相关";
  }
  return "无关";
}

export function formatActivityType(value: ActivityType): string {
  if (value === "summer_camp") {
    return "夏令营";
  }
  if (value === "pre_recommendation") {
    return "预推免";
  }
  return "未标注";
}

export function getItemAreas(item: DdlItem): AreaFilter[] {
  const areas = (Array.isArray(item.areas) ? item.areas : []).filter((area): area is AreaFilter =>
    AREA_OPTIONS.includes(area as AreaFilter)
  );
  return areas.length === 0 ? ["其他"] : areas;
}

function isWithinRecentDays(value: string | null): boolean {
  if (value === null) {
    return false;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  return Date.now() - date.getTime() <= RECENT_DAYS * 24 * 60 * 60 * 1000;
}

function isRecentlyUpdated(item: DdlItem): boolean {
  if (!isWithinRecentDays(item.updatedAt)) {
    return false;
  }
  return item.firstSeenAt === null || item.updatedAt !== item.firstSeenAt;
}
