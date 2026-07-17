import { RotateCcw, X } from "lucide-react";
import type React from "react";
import {
  RANGE_OPTIONS,
  RECENT_OPTIONS,
  RELEVANCE_OPTIONS,
  SOURCE_OPTIONS,
  TIER_OPTIONS
} from "../constants";
import type {
  ActivityTypeFilter,
  AreaFilter,
  RangeFilter,
  RecentFilter,
  RelevanceFilter,
  SourceFilter,
  TierFilter
} from "../types";
import { formatActivityType, truncate } from "../utils/ddl";

export function DdlActiveFilters({
  activeAreas,
  activeTiers,
  activityType,
  count,
  onClearAll,
  onClearAreas,
  onClearQuery,
  onClearRecent,
  onClearSource,
  onClearTiers,
  onResetActivityType,
  onResetRange,
  onResetRelevance,
  query,
  range,
  recent,
  relevance,
  source
}: {
  activeAreas: Set<AreaFilter>;
  activeTiers: Set<TierFilter>;
  activityType: ActivityTypeFilter;
  count: number;
  onClearAll: () => void;
  onClearAreas: () => void;
  onClearQuery: () => void;
  onClearRecent: () => void;
  onClearSource: () => void;
  onClearTiers: () => void;
  onResetActivityType: () => void;
  onResetRange: () => void;
  onResetRelevance: () => void;
  query: string;
  range: RangeFilter;
  recent: RecentFilter;
  relevance: RelevanceFilter;
  source: SourceFilter;
}): React.ReactElement | null {
  if (count === 0) {
    return null;
  }
  const tags: Array<{ key: string; label: string; onRemove: () => void }> = [];
  if (query.trim() !== "") {
    tags.push({ key: "query", label: `搜索：${truncate(query.trim(), 18)}`, onRemove: onClearQuery });
  }
  if (activityType !== "all") {
    tags.push({ key: "activity", label: formatActivityType(activityType), onRemove: onResetActivityType });
  }
  if (relevance !== "strong") {
    tags.push({
      key: "relevance",
      label: RELEVANCE_OPTIONS.find((option) => option.value === relevance)?.label ?? relevance,
      onRemove: onResetRelevance
    });
  }
  if (range !== "future") {
    tags.push({
      key: "range",
      label: `截止：${RANGE_OPTIONS.find((option) => option.value === range)?.label ?? range}`,
      onRemove: onResetRange
    });
  }
  if (activeTiers.size !== TIER_OPTIONS.length) {
    tags.push({ key: "tiers", label: `层次：${activeTiers.size} 项`, onRemove: onClearTiers });
  }
  if (activeAreas.size > 0) {
    tags.push({ key: "areas", label: `方向：${activeAreas.size} 项`, onRemove: onClearAreas });
  }
  if (source !== "all") {
    tags.push({
      key: "source",
      label: SOURCE_OPTIONS.find((option) => option.value === source)?.label ?? source,
      onRemove: onClearSource
    });
  }
  if (recent !== "all") {
    tags.push({
      key: "recent",
      label: RECENT_OPTIONS.find((option) => option.value === recent)?.label ?? recent,
      onRemove: onClearRecent
    });
  }

  return (
    <div className="active-filter-row" aria-label="已启用筛选">
      <span className="active-filter-label">已筛选</span>
      {tags.map((tag) => (
        <button className="active-filter-tag" key={tag.key} onClick={tag.onRemove} type="button">
          {tag.label}
          <X aria-hidden="true" size={14} />
        </button>
      ))}
      <button className="clear-filter-button" onClick={onClearAll} type="button">
        <RotateCcw aria-hidden="true" size={14} />
        全部清除
      </button>
    </div>
  );
}
