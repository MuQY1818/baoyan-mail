import {
  ACTIVITY_TYPE_OPTIONS,
  AREA_OPTIONS,
  RANGE_OPTIONS,
  RECENT_OPTIONS,
  RELEVANCE_OPTIONS,
  SOURCE_OPTIONS,
  TIER_OPTIONS
} from "../constants";
import type {
  ActivityTypeFilter,
  AreaFilter,
  MainTab,
  RangeFilter,
  RecentFilter,
  RelevanceFilter,
  SourceFilter,
  TierFilter,
  ViewMode
} from "../types";
import { matchesMobileViewport, readStoredMainTab, readStoredViewMode } from "./storage";

export function readFiltersFromUrl(): {
  mainTab: MainTab;
  query: string;
  range: RangeFilter;
  source: SourceFilter;
  relevance: RelevanceFilter;
  activityType: ActivityTypeFilter;
  recent: RecentFilter;
  viewMode: ViewMode;
  tiers: Set<TierFilter>;
  areas: Set<AreaFilter>;
} {
  const params = new URLSearchParams(window.location.search);
  const urlViewMode = params.get("view");
  return {
    mainTab: readOption(params.get("tab"), ["ddl", "applications", "calendar"], readStoredMainTab()),
    query: params.get("q") ?? "",
    range: readOption(params.get("range"), RANGE_OPTIONS.map((option) => option.value), "future"),
    source: readOption(params.get("source"), SOURCE_OPTIONS.map((option) => option.value), "all"),
    relevance: readOption(
      params.get("relevance"),
      RELEVANCE_OPTIONS.map((option) => option.value),
      "strong"
    ),
    activityType: readOption(
      params.get("type"),
      ACTIVITY_TYPE_OPTIONS.map((option) => option.value),
      "all"
    ),
    recent: readOption(params.get("recent"), RECENT_OPTIONS.map((option) => option.value), "all"),
    viewMode: readOption(
      urlViewMode,
      ["cards", "table"],
      readStoredViewMode("ddl", matchesMobileViewport())
    ),
    tiers: readTierSet(params.get("tiers")),
    areas: readAreaSet(params.get("areas"))
  };
}

export function writeFiltersToUrl(filters: {
  activeAreas: Set<AreaFilter>;
  activeTiers: Set<TierFilter>;
  query: string;
  range: RangeFilter;
  recent: RecentFilter;
  relevance: RelevanceFilter;
  activityType: ActivityTypeFilter;
  source: SourceFilter;
  viewMode: ViewMode;
  mainTab: MainTab;
}): void {
  const params = new URLSearchParams();
  if (filters.mainTab !== "ddl") {
    params.set("tab", filters.mainTab);
  }
  if (filters.query.trim() !== "") {
    params.set("q", filters.query.trim());
  }
  if (filters.range !== "future") {
    params.set("range", filters.range);
  }
  if (filters.source !== "all") {
    params.set("source", filters.source);
  }
  if (filters.relevance !== "strong") {
    params.set("relevance", filters.relevance);
  }
  if (filters.activityType !== "all") {
    params.set("type", filters.activityType);
  }
  if (filters.recent !== "all") {
    params.set("recent", filters.recent);
  }
  params.set("view", filters.viewMode);
  if (filters.activeTiers.size !== TIER_OPTIONS.length) {
    params.set("tiers", TIER_OPTIONS.filter((tier) => filters.activeTiers.has(tier)).join(","));
  }
  if (filters.activeAreas.size > 0) {
    params.set("areas", AREA_OPTIONS.filter((area) => filters.activeAreas.has(area)).join(","));
  }
  const nextQuery = params.toString();
  const nextUrl = `${window.location.pathname}${nextQuery === "" ? "" : `?${nextQuery}`}`;
  if (nextUrl !== `${window.location.pathname}${window.location.search}`) {
    window.history.replaceState(null, "", nextUrl);
  }
}

function readOption<T extends string>(value: string | null, options: T[], fallback: T): T {
  return value !== null && options.includes(value as T) ? (value as T) : fallback;
}

function readTierSet(value: string | null): Set<TierFilter> {
  if (value === null || value.trim() === "") {
    return new Set(TIER_OPTIONS);
  }
  const tiers = value
    .split(",")
    .filter((entry): entry is TierFilter => TIER_OPTIONS.includes(entry as TierFilter));
  return new Set(tiers.length === 0 ? TIER_OPTIONS : tiers);
}

function readAreaSet(value: string | null): Set<AreaFilter> {
  if (value === null || value.trim() === "") {
    return new Set();
  }
  return new Set(
    value
      .split(",")
      .filter((entry): entry is AreaFilter => AREA_OPTIONS.includes(entry as AreaFilter))
  );
}
