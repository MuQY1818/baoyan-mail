import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  Bookmark,
  BookmarkCheck,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Copy,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  Globe2,
  LayoutGrid,
  ListFilter,
  Moon,
  Plus,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  Sun,
  Table2,
  Trash2,
  X
} from "lucide-react";
import {
  APPLICATION_PATCH_SCHEMA,
  APPLICATION_TRACKER_SCHEMA,
  APPLICATION_TRACKER_STORAGE_KEY,
  addOrReplaceApplicationRecord,
  applyApplicationPatch,
  createApplicationRecord,
  createEmptyTrackerData,
  createAgentPatchFromOperation,
  getApplicationRecord,
  hydrateApplicationRecordLinks,
  normalizeTrackerData,
  parseApplicationPatch,
  previewApplicationPatch,
  removeApplicationRecord,
  updateApplicationRecord,
  type ActivityType,
  type ApplicationEvent,
  type ApplicationEventType,
  type ApplicationMaterial,
  type ApplicationPriority,
  type ApplicationRecord,
  type ApplicationResult,
  type ApplicationStatus,
  type ApplicationTrackerData,
  type MaterialStatus,
  type PatchPreview
} from "./applicationTracker";
import "./styles.css";
import type { GlobeCountry } from "./GlobeScene";

// three.js 较重，只有用户主动展开访问地图时才下载并挂载。
const GlobeScene = lazy(() => import("./GlobeScene"));

type DeadlineStatus = "today" | "future" | "expired";
type Relevance = "strong" | "possible" | "unrelated";

interface DdlItem {
  key: string;
  school: string;
  institute: string;
  description: string;
  deadlineAt: string;
  deadlineText: string;
  remainingDays: number;
  remainingText: string;
  status: DeadlineStatus;
  tier: TierFilter;
  areas?: string[];
  relevance: Relevance;
  relevanceReason: string | null;
  relevanceClassifier: string;
  relevanceClassifiedAt: string | null;
  activityType: ActivityType;
  activityTypeLabel: string;
  activityTypeSource: "source" | "source_group" | "text" | "classification" | "unknown";
  activityTypeReason: string | null;
  activityTypeClassifier: string;
  activityTypeClassifiedAt: string | null;
  sourceGroup: string;
  sourceLabel: string;
  website: string;
  firstSeenAt: string | null;
  updatedAt: string | null;
  lastSeenAt: string | null;
  missingSince: string | null;
  sourceVisibility: "current" | "grace" | "stale";
}

interface DdlResponse {
  ok: true;
  generatedAt: string;
  lastSyncedAt: string | null;
  timezone: "Asia/Shanghai";
  total: number;
  staleCount: number;
  graceHours: number;
  sourceStats: SourceStat[];
  items: DdlItem[];
}

declare global {
  interface Window {
    BaoyanAgent?: BaoyanAgentApi;
  }
}

interface BaoyanAgentApi {
  addFromDdlItem: (item: DdlItem) => ApplicationTrackerData;
  applyPatch: (patch: unknown) => {
    data: ApplicationTrackerData;
    errors: string[];
    summary: string[];
  };
  clearAll: () => ApplicationTrackerData;
  createApplication: (record: ApplicationRecord) => ApplicationTrackerData;
  deleteApplication: (id: string) => ApplicationTrackerData;
  exportData: () => ApplicationTrackerData;
  getApplication: (id: string) => ApplicationRecord | null;
  getSchema: () => {
    patchSchema: string;
    storageKey: string;
    trackerSchema: string;
  };
  listApplications: () => ApplicationRecord[];
  updateApplication: (id: string, values: Partial<ApplicationRecord>) => ApplicationTrackerData;
}

interface SourceStat {
  sourceGroup: string;
  sourceLabel: string;
  total: number;
  current: number;
  grace: number;
  staleHidden: number;
}

interface AnalyticsCountry {
  countryCode: string;
  countryName: string;
  visitCount: number;
  share: number;
}

interface AnalyticsDaily {
  date: string;
  visitCount: number;
}

interface AnalyticsRegion {
  countryCode: string;
  regionCode: string;
  regionName: string;
  visitCount: number;
  share: number;
}

interface AnalyticsSummary {
  ok: true;
  generatedAt: string;
  windowDays: number;
  totalVisits: number;
  todayVisits: number;
  countryCount: number;
  regionCount: number;
  countries: AnalyticsCountry[];
  regions: AnalyticsRegion[];
  daily: AnalyticsDaily[];
}

interface ApplicationStorageIssue {
  message: string;
  rawValue: string;
}

interface TimelineEntry {
  key: string;
  school: string;
  institute: string;
  tier: TierFilter;
  activityType: ActivityType;
  website: string;
}

interface TimelineStop {
  remainingDays: number;
  dayLabel: string;
  dateLabel: string;
  isToday: boolean;
  entries: TimelineEntry[];
}

type TimelineExpansion = "collapsed" | "expanded";

type TierFilter = "Top2" | "华五" | "C9" | "985" | "211" | "其他";
type RangeFilter = "today" | "3" | "7" | "15" | "future";
type SourceFilter = "all" | "baoyanxinxi" | "manual";
type RecentFilter = "all" | "new" | "updated";
type ViewMode = "cards" | "table";
type ThemeMode = "light" | "dark";
type RelevanceFilter = "strong" | "possible" | "all";
type ActivityTypeFilter = ActivityType | "all";
type MainTab = "ddl" | "applications" | "calendar";
type ApplicationViewMode = "cards" | "table";
type ApplicationRangeFilter = "all" | "today" | "3" | "7" | "15" | "expired";
type AreaFilter =
  | "计算机"
  | "软件"
  | "人工智能"
  | "网络安全"
  | "电子信息"
  | "通信"
  | "集成电路"
  | "自动化控制"
  | "数据科学"
  | "机器人光电"
  | "其他";

const TIER_OPTIONS: TierFilter[] = ["Top2", "华五", "C9", "985", "211", "其他"];
const AREA_OPTIONS: AreaFilter[] = [
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
];
const TIER_RANK: Record<TierFilter, number> = {
  Top2: 0,
  华五: 1,
  C9: 2,
  "985": 3,
  "211": 4,
  其他: 5
};
const TIMELINE_COLLAPSE_LIMIT = 4;
const RANGE_OPTIONS: Array<{ value: RangeFilter; label: string; maxDays: number | null }> = [
  { value: "today", label: "今天", maxDays: 0 },
  { value: "3", label: "3 天", maxDays: 3 },
  { value: "7", label: "7 天", maxDays: 7 },
  { value: "15", label: "15 天", maxDays: 15 },
  { value: "future", label: "全部未来", maxDays: null }
];
const SOURCE_OPTIONS: Array<{ value: SourceFilter; label: string }> = [
  { value: "all", label: "全部来源" },
  { value: "baoyanxinxi", label: "保研信息平台" },
  { value: "manual", label: "人工补充" }
];
const RECENT_OPTIONS: Array<{ value: RecentFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "new", label: "最近新增" },
  { value: "updated", label: "最近更新" }
];
const RELEVANCE_OPTIONS: Array<{ value: RelevanceFilter; label: string }> = [
  { value: "strong", label: "强相关" },
  { value: "possible", label: "强相关+可能" },
  { value: "all", label: "全部源站" }
];
const ACTIVITY_TYPE_OPTIONS: Array<{ value: ActivityTypeFilter; label: string }> = [
  { value: "all", label: "全部类型" },
  { value: "summer_camp", label: "夏令营" },
  { value: "pre_recommendation", label: "预推免" },
  { value: "unknown", label: "未标注" }
];
const API_URL = "https://baoyan-mail.weijuebu.workers.dev/api/ddl";
const LLMS_TXT_URL = "/llms.txt";
const ANALYTICS_VISIT_STORAGE_KEY = "baoyan-ddl-visit-date";
const RECENT_DAYS = 7;
const FAVORITE_STORAGE_KEY = "baoyan-ddl-favorites";
const READ_STORAGE_KEY = "baoyan-ddl-read";
const THEME_STORAGE_KEY = "baoyan-ddl-theme";
const MAIN_TAB_STORAGE_KEY = "baoyan-main-tab";
const DDL_VIEW_DESKTOP_STORAGE_KEY = "baoyan-ui/v1/ddl-view-desktop";
const DDL_VIEW_MOBILE_STORAGE_KEY = "baoyan-ui/v1/ddl-view-mobile";
const APPLICATION_VIEW_DESKTOP_STORAGE_KEY = "baoyan-ui/v1/application-view-desktop";
const APPLICATION_VIEW_MOBILE_STORAGE_KEY = "baoyan-ui/v1/application-view-mobile";
const MOBILE_VIEW_MEDIA_QUERY = "(max-width: 720px)";
const STATUS_OPTIONS: Array<{ value: ApplicationStatus; label: string }> = [
  { value: "watching", label: "关注中" },
  { value: "preparing", label: "准备中" },
  { value: "submitted", label: "已投递" },
  { value: "interview", label: "面试中" },
  { value: "waiting_result", label: "待结果" },
  { value: "admitted", label: "已录取" },
  { value: "waitlisted", label: "候补" },
  { value: "rejected", label: "未通过" },
  { value: "withdrawn", label: "已放弃" }
];
const PRIORITY_OPTIONS: Array<{ value: ApplicationPriority; label: string }> = [
  { value: "rush", label: "冲刺" },
  { value: "target", label: "主申" },
  { value: "safe", label: "保底" }
];
const RESULT_OPTIONS: Array<{ value: ApplicationResult; label: string }> = [
  { value: "pending", label: "待定" },
  { value: "accepted", label: "录取" },
  { value: "waitlisted", label: "候补" },
  { value: "rejected", label: "拒绝" },
  { value: "withdrawn", label: "放弃" }
];
const APPLICATION_RANGE_OPTIONS: Array<{ value: ApplicationRangeFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "today", label: "今天" },
  { value: "3", label: "3 天" },
  { value: "7", label: "7 天" },
  { value: "15", label: "15 天" },
  { value: "expired", label: "已过期" }
];
const EVENT_TYPE_OPTIONS: Array<{ value: ApplicationEventType; label: string }> = [
  { value: "deadline", label: "DDL" },
  { value: "interview", label: "面试" },
  { value: "camp", label: "开营" },
  { value: "result", label: "结果" },
  { value: "material", label: "补材料" },
  { value: "other", label: "其他" }
];

function App(): React.ReactElement {
  const initialFilters = useMemo(readFiltersFromUrl, []);
  const isMobileViewport = useMediaQuery(MOBILE_VIEW_MEDIA_QUERY);
  const [theme, setTheme] = useState<ThemeMode>(readInitialTheme);
  const [data, setData] = useState<DdlResponse | null>(null);
  const [archivalData, setArchivalData] = useState<DdlResponse | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState(initialFilters.query);
  const [range, setRange] = useState<RangeFilter>(initialFilters.range);
  const [source, setSource] = useState<SourceFilter>(initialFilters.source);
  const [relevance, setRelevance] = useState<RelevanceFilter>(initialFilters.relevance);
  const [activityType, setActivityType] = useState<ActivityTypeFilter>(initialFilters.activityType);
  const [recent, setRecent] = useState<RecentFilter>(initialFilters.recent);
  const [viewMode, setViewMode] = useState<ViewMode>(initialFilters.viewMode);
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [mainTab, setMainTab] = useState<MainTab>(initialFilters.mainTab);
  const [activeApplicationId, setActiveApplicationId] = useState<string | null>(null);
  const [activeTiers, setActiveTiers] = useState<Set<TierFilter>>(initialFilters.tiers);
  const [activeAreas, setActiveAreas] = useState<Set<AreaFilter>>(initialFilters.areas);
  const [favorites, toggleFavorite] = useStoredKeySet(FAVORITE_STORAGE_KEY);
  const [readItems, toggleReadItem] = useStoredKeySet(READ_STORAGE_KEY);
  const [applicationData, setApplicationData, applicationStorageIssue, resetApplicationStorage] =
    useApplicationTracker();
  const scrollTargetRef = useRef<string | null>(null);
  const [scrollNonce, setScrollNonce] = useState(0);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const filterPanelRef = useRef<HTMLElement>(null);
  const previousMobileViewport = useRef(isMobileViewport);

  useEffect(() => {
    let ignore = false;
    async function loadData(): Promise<void> {
      try {
        const [currentResponse, archivalResponse] = await Promise.all([
          fetch("/api/ddl"),
          fetch("/api/ddl?includeExpired=1")
        ]);
        if (!currentResponse.ok) {
          throw new Error(`数据接口返回 ${currentResponse.status}`);
        }
        const body = (await currentResponse.json()) as DdlResponse;
        const archivalBody = archivalResponse.ok ? ((await archivalResponse.json()) as DdlResponse) : null;
        if (!ignore) {
          setData(body);
          setArchivalData(archivalBody);
          setError(null);
        }
      } catch (loadError) {
        if (!ignore) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        if (!ignore) {
          setIsLoading(false);
        }
      }
    }

    void loadData();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    sendDailyVisitPing();
    let ignore = false;
    async function loadAnalytics(): Promise<void> {
      try {
        const response = await fetch("/api/analytics/summary");
        if (!response.ok) {
          throw new Error(`访问统计返回 ${response.status}`);
        }
        const body = (await response.json()) as AnalyticsSummary;
        if (!ignore) {
          setAnalytics(body);
        }
      } catch {
        if (!ignore) {
          setAnalytics(null);
        }
      }
    }

    void loadAnalytics();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    writeFiltersToUrl({
      activeAreas,
      activeTiers,
      query,
      range,
      recent,
      relevance,
      source,
      activityType,
      viewMode,
      mainTab
    });
  }, [activeAreas, activeTiers, activityType, mainTab, query, range, recent, relevance, source, viewMode]);

  useEffect(() => {
    if (previousMobileViewport.current === isMobileViewport) {
      return;
    }
    previousMobileViewport.current = isMobileViewport;
    setViewMode(readStoredViewMode("ddl", isMobileViewport));
  }, [isMobileViewport]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage failures; the visual state still applies for this session.
    }
  }, [theme]);

  useEffect(() => {
    try {
      window.localStorage.setItem(MAIN_TAB_STORAGE_KEY, mainTab);
    } catch {
      // Ignore storage failures; tab selection is not critical state.
    }
  }, [mainTab]);

  const futureItems = useMemo(
    () => data?.items.filter((item) => item.status !== "expired") ?? [],
    [data]
  );
  const relevanceScopedItems = useMemo(
    () =>
      filterItems(
        futureItems,
        "",
        "future",
        "all",
        relevance,
        activityType,
        new Set(TIER_OPTIONS),
        new Set(),
        "all"
      ),
    [activityType, futureItems, relevance]
  );
  const visibleItems = useMemo(
    () =>
      filterItems(
        futureItems,
        query,
        range,
        source,
        relevance,
        activityType,
        activeTiers,
        activeAreas,
        recent
      ),
    [activeAreas, activeTiers, activityType, futureItems, query, range, recent, relevance, source]
  );
  const stats = useMemo(() => buildStats(relevanceScopedItems), [relevanceScopedItems]);
  const activityStats = useMemo(
    () => buildActivityTypeStats(visibleItems),
    [visibleItems]
  );
  const activeFilterCount = getDdlActiveFilterCount({
    activeAreas,
    activeTiers,
    activityType,
    query,
    range,
    recent,
    relevance,
    source
  });
  const applicationSourceKeys = useMemo(
    () => new Set(applicationData.records.map((record) => record.sourceDdlKey).filter((key) => key !== "")),
    [applicationData.records]
  );
  useEffect(() => {
    if (archivalData === null) {
      return;
    }
    setApplicationData((current) => hydrateApplicationRecordLinks(current, archivalData.items));
  }, [archivalData, setApplicationData]);
  const applicationCount = applicationData.records.length;
  const timelineStops = useMemo(
    () =>
      buildTimeline(
        filterItems(
          futureItems,
          query,
          range,
          source,
          relevance,
          activityType,
          activeTiers,
          activeAreas,
          recent
        )
      ),
    [activeAreas, activeTiers, activityType, futureItems, query, range, recent, relevance, source]
  );

  // 点击概览后等列表渲染完成再滚动到目标卡片，滚动结束后再高亮（确保视线到位时才闪烁）
  useEffect(() => {
    const key = scrollTargetRef.current;
    if (key === null) {
      return;
    }
    const card = document.getElementById(`ddl-${key}`);
    if (card === null) {
      return;
    }
    scrollTargetRef.current = null;

    const startY = window.scrollY;
    card.scrollIntoView({ behavior: "smooth", block: "center" });

    let cleaned = false;
    let noScrollTimer = 0;
    let maxTimer = 0;
    const cleanup = (): void => {
      cleaned = true;
      window.removeEventListener("scrollend", onScrollEnd);
      window.clearTimeout(noScrollTimer);
      window.clearTimeout(maxTimer);
    };
    function fire(): void {
      if (cleaned) {
        return;
      }
      cleanup();
      setHighlightKey(key);
    }
    function onScrollEnd(): void {
      fire();
    }
    window.addEventListener("scrollend", onScrollEnd);
    // 目标已在视口、几乎无需滚动时，短延迟后直接高亮
    noScrollTimer = window.setTimeout(() => {
      if (Math.abs(window.scrollY - startY) < 4) {
        fire();
      }
    }, 180);
    // scrollend 不被支持时的硬兜底（略长于实测最长平滑滚动耗时）
    maxTimer = window.setTimeout(fire, 1800);

    return cleanup;
  }, [scrollNonce, visibleItems]);

  // 高亮命中卡片一小段时间后自动消退
  useEffect(() => {
    if (highlightKey === null) {
      return;
    }
    const timer = window.setTimeout(() => setHighlightKey(null), 1600);
    return () => window.clearTimeout(timer);
  }, [highlightKey]);

  function jumpToItem(itemKey: string): void {
    scrollTargetRef.current = itemKey;
    setScrollNonce((value) => value + 1);
  }

  function toggleTier(tier: TierFilter): void {
    setActiveTiers((previous) => {
      const next = new Set(previous);
      if (next.has(tier)) {
        next.delete(tier);
      } else {
        next.add(tier);
      }
      return next;
    });
  }

  function toggleArea(area: AreaFilter): void {
    setActiveAreas((previous) => {
      const next = new Set(previous);
      if (next.has(area)) {
        next.delete(area);
      } else {
        next.add(area);
      }
      return next;
    });
  }

  function resetFilters(): void {
    setQuery("");
    setRange("future");
    setSource("all");
    setRelevance("strong");
    setActivityType("all");
    setRecent("all");
    setActiveTiers(new Set(TIER_OPTIONS));
    setActiveAreas(new Set());
  }

  function changeViewMode(nextViewMode: ViewMode): void {
    setViewMode(nextViewMode);
    persistViewMode("ddl", isMobileViewport, nextViewMode);
  }

  function openFiltersFromMobileBar(): void {
    setMoreFiltersOpen(true);
    filterPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function toggleTheme(): void {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }

  function openApplication(recordId: string): void {
    setMainTab("applications");
    setActiveApplicationId(recordId);
  }

  function addApplication(item: DdlItem): void {
    const existing = applicationData.records.find((record) => record.sourceDdlKey === item.key);
    if (existing !== undefined) {
      openApplication(existing.id);
      return;
    }
    const record = createApplicationRecord(item);
    setApplicationData((current) => addOrReplaceApplicationRecord(current, record));
    openApplication(record.id);
  }

  function updateApplication(id: string, values: Partial<ApplicationRecord>): void {
    setApplicationData((current) => updateApplicationRecord(current, id, values));
  }

  function removeApplication(id: string): void {
    setApplicationData((current) => removeApplicationRecord(current, id));
    setActiveApplicationId((current) => (current === id ? null : current));
  }

  function replaceApplicationData(nextData: ApplicationTrackerData): void {
    setApplicationData(normalizeTrackerData(nextData));
  }

  useEffect(() => {
    const api: BaoyanAgentApi = {
      addFromDdlItem(item: DdlItem): ApplicationTrackerData {
        const record = createApplicationRecord(item);
        const nextData = addOrReplaceApplicationRecord(readStoredApplicationData(), record);
        persistApplicationData(nextData);
        setApplicationData(nextData);
        return nextData;
      },
      applyPatch(patch: unknown): {
        data: ApplicationTrackerData;
        errors: string[];
        summary: string[];
      } {
        const parsed = parseApplicationPatch(patch);
        const result = applyApplicationPatch(readStoredApplicationData(), parsed);
        if (result.errors.length === 0) {
          persistApplicationData(result.data);
          setApplicationData(result.data);
        }
        return result;
      },
      clearAll(): ApplicationTrackerData {
        const nextData = createEmptyTrackerData();
        persistApplicationData(nextData);
        setApplicationData(nextData);
        return nextData;
      },
      createApplication(record: ApplicationRecord): ApplicationTrackerData {
        const nextData = addOrReplaceApplicationRecord(readStoredApplicationData(), record);
        persistApplicationData(nextData);
        setApplicationData(nextData);
        return nextData;
      },
      deleteApplication(id: string): ApplicationTrackerData {
        const nextData = removeApplicationRecord(readStoredApplicationData(), id);
        persistApplicationData(nextData);
        setApplicationData(nextData);
        return nextData;
      },
      exportData(): ApplicationTrackerData {
        return readStoredApplicationData();
      },
      getApplication(id: string): ApplicationRecord | null {
        return getApplicationRecord(readStoredApplicationData(), id);
      },
      getSchema(): {
        patchSchema: string;
        storageKey: string;
        trackerSchema: string;
      } {
        return {
          patchSchema: APPLICATION_PATCH_SCHEMA,
          storageKey: APPLICATION_TRACKER_STORAGE_KEY,
          trackerSchema: APPLICATION_TRACKER_SCHEMA
        };
      },
      listApplications(): ApplicationRecord[] {
        return readStoredApplicationData().records;
      },
      updateApplication(id: string, values: Partial<ApplicationRecord>): ApplicationTrackerData {
        const patch = createAgentPatchFromOperation({ op: "update", id, values });
        const result = applyApplicationPatch(readStoredApplicationData(), patch);
        if (result.errors.length > 0) {
          throw new Error(result.errors.join("; "));
        }
        persistApplicationData(result.data);
        setApplicationData(result.data);
        return result.data;
      }
    };
    window.BaoyanAgent = api;
    return () => {
      if (window.BaoyanAgent === api) {
        delete window.BaoyanAgent;
      }
    };
  }, [setApplicationData]);

  return (
    <div className="app-frame">
      <AppHeader
        activeTab={mainTab}
        applicationCount={applicationCount}
        ddlCount={relevanceScopedItems.length}
        lastSyncedAt={data?.lastSyncedAt ?? data?.generatedAt}
        onSelect={setMainTab}
      />

      <main className="shell" id="main-content">
        {mainTab === "ddl" && (
          <section className="ddl-workspace" aria-labelledby="page-title">
            <header className="workspace-intro">
              <div>
                <span className="section-kicker">DEADLINE DESK</span>
                <h1 id="page-title">找到下一场值得投的项目</h1>
                <p>默认展示计算机类强相关通知，筛选、收藏并直接加入本地申请计划。</p>
              </div>
              <div className="workspace-intro-meta">
                <strong>{relevanceScopedItems.length}</strong>
                <span>条强相关 DDL</span>
              </div>
            </header>

            <section className="discovery-panel" aria-label="DDL 筛选" ref={filterPanelRef}>
              <label className="search-field search-field-main">
                <span>搜索学校、院系或研究方向</span>
                <div className="search-control">
                  <Search aria-hidden="true" size={20} strokeWidth={2} />
                  <input
                    value={query}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      setQuery(event.currentTarget.value)
                    }
                    placeholder="例如：浙江大学、网络空间安全、人工智能"
                    type="search"
                  />
                  {query !== "" && (
                    <button aria-label="清除搜索词" onClick={() => setQuery("")} type="button">
                      <X aria-hidden="true" size={18} />
                    </button>
                  )}
                </div>
              </label>

              <div className="quick-filter-grid">
                <FilterSegment
                  label="项目类型"
                  onChange={(value) => setActivityType(value as ActivityTypeFilter)}
                  options={ACTIVITY_TYPE_OPTIONS}
                  value={activityType}
                />
                <FilterSegment
                  label="相关度"
                  onChange={(value) => setRelevance(value as RelevanceFilter)}
                  options={RELEVANCE_OPTIONS}
                  value={relevance}
                />
                <FilterSegment
                  label="截止范围"
                  onChange={(value) => setRange(value as RangeFilter)}
                  options={RANGE_OPTIONS}
                  value={range}
                />
              </div>

              <div className="filter-overview">
                <div className="result-summary" aria-live="polite">
                  <strong>{visibleItems.length}</strong>
                  <span>条符合当前条件</span>
                </div>
                <div className="activity-summary" aria-label="项目类型统计">
                  <span><strong>{activityStats.summer_camp}</strong> 夏令营</span>
                  <span><strong>{activityStats.pre_recommendation}</strong> 预推免</span>
                  <span><strong>{activityStats.unknown}</strong> 未标注</span>
                </div>
                <button
                  aria-expanded={moreFiltersOpen}
                  className={moreFiltersOpen ? "secondary-action secondary-action-active" : "secondary-action"}
                  onClick={() => setMoreFiltersOpen((value) => !value)}
                  type="button"
                >
                  <SlidersHorizontal aria-hidden="true" size={17} />
                  高级筛选
                  {getAdvancedFilterCount({ activeAreas, activeTiers, recent, source }) > 0 && (
                    <span className="action-count">
                      {getAdvancedFilterCount({ activeAreas, activeTiers, recent, source })}
                    </span>
                  )}
                  <ChevronDown aria-hidden="true" className={moreFiltersOpen ? "chevron-open" : ""} size={16} />
                </button>
              </div>

              <DdlActiveFilters
                activeAreas={activeAreas}
                activeTiers={activeTiers}
                activityType={activityType}
                count={activeFilterCount}
                onClearAll={resetFilters}
                onClearAreas={() => setActiveAreas(new Set())}
                onClearQuery={() => setQuery("")}
                onClearRecent={() => setRecent("all")}
                onClearSource={() => setSource("all")}
                onClearTiers={() => setActiveTiers(new Set(TIER_OPTIONS))}
                onResetActivityType={() => setActivityType("all")}
                onResetRange={() => setRange("future")}
                onResetRelevance={() => setRelevance("strong")}
                query={query}
                range={range}
                recent={recent}
                relevance={relevance}
                source={source}
              />

              <div className={moreFiltersOpen ? "advanced-filters advanced-filters-open" : "advanced-filters"}>
                <div className="control-block">
                  <div className="control-label">学校层次</div>
                  <div className="control-row control-row-wrap" aria-label="学校层次">
                    {TIER_OPTIONS.map((tier) => (
                      <button
                        className={activeTiers.has(tier) ? "chip tier-chip chip-active" : "chip tier-chip"}
                        key={tier}
                        onClick={() => toggleTier(tier)}
                        type="button"
                      >
                        {tier}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="control-block advanced-area-filter">
                  <div className="control-label">研究方向</div>
                  <div className="control-row control-row-wrap" aria-label="方向筛选">
                    <button
                      className={activeAreas.size === 0 ? "chip area-chip chip-active" : "chip area-chip"}
                      onClick={() => setActiveAreas(new Set())}
                      type="button"
                    >
                      全部方向
                    </button>
                    {AREA_OPTIONS.map((area) => (
                      <button
                        className={activeAreas.has(area) ? "chip area-chip chip-active" : "chip area-chip"}
                        key={area}
                        onClick={() => toggleArea(area)}
                        type="button"
                      >
                        {area}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="select-field">
                  <span>数据来源</span>
                  <select
                    value={source}
                    onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
                      setSource(event.currentTarget.value as SourceFilter)
                    }
                  >
                    {SOURCE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <FilterSegment
                  label="信息变化"
                  onChange={(value) => setRecent(value as RecentFilter)}
                  options={RECENT_OPTIONS}
                  value={recent}
                />
              </div>
            </section>

            <div className="mobile-filter-bar">
              <button onClick={openFiltersFromMobileBar} type="button">
                <SlidersHorizontal aria-hidden="true" size={18} />
                筛选{activeFilterCount > 0 ? ` ${activeFilterCount}` : ""}
              </button>
              <span>{visibleItems.length} 条结果</span>
              {activeFilterCount > 0 && (
                <button aria-label="清除全部筛选" onClick={resetFilters} type="button">
                  <RotateCcw aria-hidden="true" size={17} />
                </button>
              )}
            </div>

            <Timeline
              loading={isLoading}
              onSelectItem={jumpToItem}
              range={range}
              stops={timelineStops}
            />

            <section className="results-panel" aria-labelledby="results-title">
              <header className="results-head">
                <div>
                  <span className="section-kicker">RESULTS</span>
                  <h2 id="results-title">DDL 结果</h2>
                  <p>
                    今日截止 {stats.today} 条，未来 15 天 {stats.fifteenDays} 条，
                    {formatGeneratedAt(data?.lastSyncedAt ?? data?.generatedAt)}。
                  </p>
                </div>
                <ViewSwitcher onChange={changeViewMode} value={viewMode} />
              </header>

              {isLoading ? (
                <DdlSkeleton />
              ) : error !== null ? (
                <StateMessage title="数据加载失败" message={error} />
              ) : visibleItems.length === 0 ? (
                <StateMessage
                  title="当前筛选没有结果"
                  message="放宽截止范围、相关度或搜索词后再试。"
                  actionLabel="清除筛选"
                  onAction={resetFilters}
                />
              ) : (
                <DdlResults
                  applicationSourceKeys={applicationSourceKeys}
                  favorites={favorites}
                  highlightedKey={highlightKey}
                  items={visibleItems}
                  onAddApplication={addApplication}
                  onOpenApplication={(item) => {
                    const record = applicationData.records.find((entry) => entry.sourceDdlKey === item.key);
                    if (record !== undefined) {
                      openApplication(record.id);
                    }
                  }}
                  onToggleFavorite={toggleFavorite}
                  onToggleRead={toggleReadItem}
                  readItems={readItems}
                  viewMode={viewMode}
                />
              )}
            </section>
          </section>
        )}

        {mainTab === "applications" && (
          <ApplicationWorkspace
            activeRecordId={activeApplicationId}
            data={applicationData}
            onRemoveRecord={removeApplication}
            onReplaceData={replaceApplicationData}
            onSelectRecord={setActiveApplicationId}
            onUpdateRecord={updateApplication}
            onResetStorage={resetApplicationStorage}
            storageIssue={applicationStorageIssue}
          />
        )}

        {mainTab === "calendar" && (
          <ApplicationCalendar
            activeRecordId={activeApplicationId}
            records={applicationData.records}
            onOpenRecord={openApplication}
            onSelectApplications={() => setMainTab("applications")}
          />
        )}

        <ApiHint />
        <AnalyticsPanel summary={analytics} theme={theme} />
      </main>

      <MobileNavigation
        activeTab={mainTab}
        applicationCount={applicationCount}
        ddlCount={relevanceScopedItems.length}
        onSelect={setMainTab}
      />
      <ThemeToggle theme={theme} onToggle={toggleTheme} />
    </div>
  );
}

function sendDailyVisitPing(): void {
  const today = new Date().toISOString().slice(0, 10);
  try {
    if (window.localStorage.getItem(ANALYTICS_VISIT_STORAGE_KEY) === today) {
      return;
    }
    window.localStorage.setItem(ANALYTICS_VISIT_STORAGE_KEY, today);
  } catch {
    // Still allow one anonymous aggregate ping if storage is unavailable.
  }

  const body = JSON.stringify({ page: "ddl" });
  if (navigator.sendBeacon !== undefined) {
    const blob = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon("/api/analytics/visit", blob)) {
      return;
    }
  }

  void fetch("/api/analytics/visit", {
    body,
    headers: { "content-type": "application/json" },
    keepalive: true,
    method: "POST"
  }).catch(() => undefined);
}

function AppHeader({
  activeTab,
  applicationCount,
  ddlCount,
  lastSyncedAt,
  onSelect
}: {
  activeTab: MainTab;
  applicationCount: number;
  ddlCount: number;
  lastSyncedAt: string | undefined;
  onSelect: (tab: MainTab) => void;
}): React.ReactElement {
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <button className="brand" onClick={() => onSelect("ddl")} type="button">
          <span className="brand-mark" aria-hidden="true">DDL</span>
          <span className="brand-copy">
            <strong>保研进度台</strong>
            <small>发现、规划、跟进</small>
          </span>
        </button>
        <MainTabs
          activeTab={activeTab}
          applicationCount={applicationCount}
          ddlCount={ddlCount}
          onSelect={onSelect}
        />
        <span className="updated header-updated">{formatGeneratedAt(lastSyncedAt)}</span>
      </div>
    </header>
  );
}

function MainTabs({
  activeTab,
  applicationCount,
  ddlCount,
  onSelect
}: {
  activeTab: MainTab;
  applicationCount: number;
  ddlCount: number;
  onSelect: (tab: MainTab) => void;
}): React.ReactElement {
  const tabs = buildMainTabs(ddlCount, applicationCount);
  return (
    <nav className="main-tabs desktop-tabs" aria-label="平台功能">
      {tabs.map((tab) => (
        <button
          className={activeTab === tab.value ? "main-tab main-tab-active" : "main-tab"}
          key={tab.value}
          onClick={() => onSelect(tab.value)}
          type="button"
        >
          <NavigationIcon tab={tab.value} />
          <span>{tab.label}</span>
          {tab.count > 0 && <strong>{tab.count}</strong>}
        </button>
      ))}
    </nav>
  );
}

function MobileNavigation({
  activeTab,
  applicationCount,
  ddlCount,
  onSelect
}: {
  activeTab: MainTab;
  applicationCount: number;
  ddlCount: number;
  onSelect: (tab: MainTab) => void;
}): React.ReactElement {
  return (
    <nav className="mobile-navigation" aria-label="平台功能">
      {buildMainTabs(ddlCount, applicationCount).map((tab) => (
        <button
          aria-current={activeTab === tab.value ? "page" : undefined}
          className={activeTab === tab.value ? "mobile-nav-item mobile-nav-item-active" : "mobile-nav-item"}
          key={tab.value}
          onClick={() => onSelect(tab.value)}
          type="button"
        >
          <span className="mobile-nav-icon">
            <NavigationIcon tab={tab.value} />
            {tab.value === "applications" && tab.count > 0 && <em>{tab.count}</em>}
          </span>
          <span>{tab.mobileLabel}</span>
        </button>
      ))}
    </nav>
  );
}

function buildMainTabs(
  ddlCount: number,
  applicationCount: number
): Array<{ value: MainTab; label: string; mobileLabel: string; count: number }> {
  return [
    { value: "ddl", label: "DDL 列表", mobileLabel: "DDL", count: ddlCount },
    { value: "applications", label: "我的申请", mobileLabel: "申请", count: applicationCount },
    { value: "calendar", label: "申请日历", mobileLabel: "日历", count: applicationCount }
  ];
}

function NavigationIcon({ tab }: { tab: MainTab }): React.ReactElement {
  if (tab === "applications") {
    return <ClipboardList aria-hidden="true" size={18} strokeWidth={2} />;
  }
  if (tab === "calendar") {
    return <CalendarDays aria-hidden="true" size={18} strokeWidth={2} />;
  }
  return <ListFilter aria-hidden="true" size={18} strokeWidth={2} />;
}

function FilterSegment({
  label,
  onChange,
  options,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  value: string;
}): React.ReactElement {
  return (
    <div className="control-block filter-segment">
      <div className="control-label">{label}</div>
      <div className="segmented-control" aria-label={label} role="group">
        {options.map((option) => (
          <button
            aria-pressed={value === option.value}
            className={value === option.value ? "segment-button segment-button-active" : "segment-button"}
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ViewSwitcher({
  onChange,
  value
}: {
  onChange: (value: ViewMode) => void;
  value: ViewMode;
}): React.ReactElement {
  return (
    <div className="view-switcher" aria-label="显示方式" role="group">
      <button
        aria-label="卡片视图"
        aria-pressed={value === "cards"}
        className={value === "cards" ? "view-button view-button-active" : "view-button"}
        onClick={() => onChange("cards")}
        title="卡片视图"
        type="button"
      >
        <LayoutGrid aria-hidden="true" size={18} />
      </button>
      <button
        aria-label="表格视图"
        aria-pressed={value === "table"}
        className={value === "table" ? "view-button view-button-active" : "view-button"}
        onClick={() => onChange("table")}
        title="表格视图"
        type="button"
      >
        <Table2 aria-hidden="true" size={18} />
      </button>
    </div>
  );
}

function DdlActiveFilters({
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

function ApiHint(): React.ReactElement {
  const [copied, setCopied] = useState(false);

  function copyApiUrl(): void {
    void navigator.clipboard?.writeText(API_URL).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      },
      () => setCopied(false)
    );
  }

  return (
    <section className="api-hint" aria-label="面向 LLM 与 Agent 的数据接口">
      <div className="api-hint-body">
        <span className="api-hint-badge"><Database aria-hidden="true" size={14} /> Agent API</span>
        <div className="api-hint-text">
          <strong>结构化数据接口</strong>
          <p>
            本站全部 DDL 提供机器可读的 JSON，已开启跨域访问，可直接抓取，无需解析页面。
            接口说明见 <a href={LLMS_TXT_URL} rel="noreferrer" target="_blank">/llms.txt</a>。
          </p>
        </div>
      </div>
      <div className="api-hint-actions">
        <code className="api-hint-url">{API_URL}</code>
        <button className="api-hint-copy" onClick={copyApiUrl} type="button">
          <Copy aria-hidden="true" size={15} />
          {copied ? "已复制" : "复制接口地址"}
        </button>
        <a className="api-hint-open" href={API_URL} rel="noreferrer" target="_blank">
          <ExternalLink aria-hidden="true" size={15} />
          打开 JSON
        </a>
      </div>
    </section>
  );
}

function AnalyticsPanel({
  summary,
  theme
}: {
  summary: AnalyticsSummary | null;
  theme: ThemeMode;
}): React.ReactElement {
  const [mapOpen, setMapOpen] = useState(false);
  const countries = summary?.countries ?? [];
  const topCountries = countries.slice(0, 5);
  const topRegions = summary?.regions.slice(0, 5) ?? [];
  const maxVisits = Math.max(1, ...countries.map((country) => country.visitCount));
  return (
    <footer className="analytics-panel" aria-label="访问统计">
      <div className="analytics-summary-row">
        <div className="analytics-copy">
          <span className="analytics-eyebrow">VISIT ATLAS</span>
          <strong>匿名访问统计</strong>
          <p>每日一次匿名计数，不保存 IP、邮箱或浏览器指纹。</p>
        </div>
        <div className="analytics-metrics">
          <Metric label="近 30 天访问" value={summary?.totalVisits ?? 0} />
          <Metric label="今日访问" value={summary?.todayVisits ?? 0} />
          <Metric label="覆盖地区" value={summary?.regionCount ?? 0} />
        </div>
        <div className="analytics-region-summary" aria-label="主要访问地区">
          <span>主要地区</span>
          {topRegions.length === 0 ? (
            <em>等待数据积累</em>
          ) : (
            topRegions.slice(0, 3).map((region) => (
              <strong key={`${region.countryCode}-${region.regionCode}-${region.regionName}`}>
                {region.regionName} {region.visitCount}
              </strong>
            ))
          )}
        </div>
      </div>

      <details
        className="analytics-details"
        onToggle={(event) => setMapOpen(event.currentTarget.open)}
        open={mapOpen}
      >
        <summary>
          <Globe2 aria-hidden="true" size={17} />
          {mapOpen ? "收起访问地图" : "展开访问地图与地区排行"}
          <ChevronDown aria-hidden="true" className={mapOpen ? "chevron-open" : ""} size={16} />
        </summary>
        {mapOpen && (
          <div className="analytics-board">
            <VisitGlobe countries={countries} maxVisits={maxVisits} theme={theme} />
            <div className="analytics-rank-card" aria-label="访问地区排行">
              <div className="rank-section">
                <strong className="analytics-list-title">国家或地区</strong>
                {topCountries.length === 0 ? (
                  <p className="country-empty">等待访问数据积累。</p>
                ) : (
                  topCountries.map((country) => (
                    <div className="country-row" key={country.countryCode}>
                      <span className="country-name">{country.countryName}</span>
                      <span className="country-bar" aria-hidden="true">
                        <span style={{ width: `${Math.max(8, (country.visitCount / maxVisits) * 100)}%` }} />
                      </span>
                      <strong>{country.visitCount}</strong>
                    </div>
                  ))
                )}
              </div>
              <div className="rank-section">
                <strong className="analytics-list-title">细分地区</strong>
                {topRegions.length === 0 ? (
                  <p className="country-empty">暂无细分地区。</p>
                ) : (
                  topRegions.map((region) => (
                    <div className="region-row" key={`${region.countryCode}-${region.regionCode}-${region.regionName}`}>
                      <span>{region.regionName}</span>
                      <strong>{region.visitCount}</strong>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </details>
    </footer>
  );
}

function Metric({ label, value }: { label: string; value: number }): React.ReactElement {
  return (
    <div className="analytics-metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function VisitGlobe({
  countries,
  maxVisits,
  theme
}: {
  countries: GlobeCountry[];
  maxVisits: number;
  theme: ThemeMode;
}): React.ReactElement {
  const leader = countries[0];

  return (
    <div className="visit-globe-card" aria-label="世界访问热度">
      <div className="visit-globe-stage">
        <Suspense fallback={<GlobeFallback />}>
          <GlobeScene countries={countries} maxVisits={maxVisits} theme={theme} />
        </Suspense>
        <div className="globe-legend" aria-hidden="true">
          <span className="globe-legend-dot globe-legend-hot" />
          <span>访问热度</span>
          <span className="globe-legend-dot globe-legend-cool" />
        </div>
      </div>
      <div className="visit-globe-caption">
        <strong>{leader?.countryName ?? "暂无地区"}</strong>
        <span>{leader === undefined ? "等待访问数据" : `${leader.visitCount} 次访问`}</span>
      </div>
    </div>
  );
}

function GlobeFallback(): React.ReactElement {
  return (
    <div className="globe-loading" role="status" aria-label="正在加载世界访问热度">
      <span className="globe-loading-orb" aria-hidden="true" />
    </div>
  );
}

function ThemeToggle({
  onToggle,
  theme
}: {
  onToggle: () => void;
  theme: ThemeMode;
}): React.ReactElement {
  const isDark = theme === "dark";
  return (
    <button
      aria-label={isDark ? "切换到白昼模式" : "切换到夜间模式"}
      className={isDark ? "theme-float theme-float-dark" : "theme-float"}
      onClick={onToggle}
      type="button"
    >
      {isDark ? (
        <Sun aria-hidden="true" className="theme-float-icon" size={25} strokeWidth={1.9} />
      ) : (
        <Moon aria-hidden="true" className="theme-float-icon" size={25} strokeWidth={1.9} />
      )}
      <span className="theme-float-tooltip" aria-hidden="true">换主题</span>
    </button>
  );
}

function ApplicationWorkspace({
  activeRecordId,
  data,
  onRemoveRecord,
  onReplaceData,
  onResetStorage,
  onSelectRecord,
  onUpdateRecord,
  storageIssue
}: {
  activeRecordId: string | null;
  data: ApplicationTrackerData;
  onRemoveRecord: (id: string) => void;
  onReplaceData: (data: ApplicationTrackerData) => void;
  onResetStorage: () => void;
  onSelectRecord: (id: string | null) => void;
  onUpdateRecord: (id: string, values: Partial<ApplicationRecord>) => void;
  storageIssue: ApplicationStorageIssue | null;
}): React.ReactElement {
  const isMobileViewport = useMediaQuery(MOBILE_VIEW_MEDIA_QUERY);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ApplicationStatus | "all">("all");
  const [priority, setPriority] = useState<ApplicationPriority | "all">("all");
  const [result, setResult] = useState<ApplicationResult | "all">("all");
  const [range, setRange] = useState<ApplicationRangeFilter>("all");
  const [viewMode, setViewMode] = useState<ApplicationViewMode>(() =>
    readStoredViewMode("application", isMobileViewport)
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const previousMobileViewport = useRef(isMobileViewport);
  const records = useMemo(
    () => filterApplicationRecords(data.records, { priority, query, range, result, status }),
    [data.records, priority, query, range, result, status]
  );
  const stats = useMemo(() => buildApplicationStats(data.records), [data.records]);
  const activeRecord = data.records.find((record) => record.id === activeRecordId) ?? null;
  const advancedFilterCount =
    Number(priority !== "all") + Number(result !== "all") + Number(range !== "all");

  useEffect(() => {
    if (previousMobileViewport.current === isMobileViewport) {
      return;
    }
    previousMobileViewport.current = isMobileViewport;
    setViewMode(readStoredViewMode("application", isMobileViewport));
  }, [isMobileViewport]);

  function changeViewMode(nextViewMode: ViewMode): void {
    setViewMode(nextViewMode);
    persistViewMode("application", isMobileViewport, nextViewMode);
  }

  function resetApplicationFilters(): void {
    setQuery("");
    setStatus("all");
    setPriority("all");
    setResult("all");
    setRange("all");
  }

  return (
    <section className="application-shell" aria-label="我的申请">
      <header className="workspace-intro application-intro">
        <div>
          <span className="section-kicker">APPLICATION DESK</span>
          <h2>我的申请</h2>
          <p>投递状态、材料进度和面试日程只保存在当前浏览器。</p>
        </div>
        <div className="application-head-actions">
          <button
            aria-expanded={agentOpen}
            className={agentOpen ? "secondary-action secondary-action-active" : "secondary-action"}
            onClick={() => setAgentOpen((value) => !value)}
            type="button"
          >
            <Database aria-hidden="true" size={17} />
            数据工具
            <ChevronDown aria-hidden="true" className={agentOpen ? "chevron-open" : ""} size={16} />
          </button>
          <span className="local-badge">仅存本地</span>
        </div>
      </header>

      {storageIssue !== null && (
        <StorageRecoveryBanner issue={storageIssue} onReset={onResetStorage} />
      )}

      <section className="application-metrics" aria-label="申请概览">
        <ApplicationMetric label="全部申请" value={stats.total} />
        <ApplicationMetric label="准备中" value={stats.preparing} />
        <ApplicationMetric label="已投递" value={stats.submitted} />
        <ApplicationMetric label="待处理" tone="attention" value={stats.pendingAction} />
      </section>

      {agentOpen && <AgentDataPanel data={data} onReplaceData={onReplaceData} />}

      <section className="application-toolbar" aria-label="申请筛选">
        <label className="search-field application-search">
          <span>搜索申请</span>
          <div className="search-control">
            <Search aria-hidden="true" size={19} />
            <input
              value={query}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.currentTarget.value)}
              placeholder="学校、院系或备注"
              type="search"
            />
          </div>
        </label>
        <label className="select-field">
          <span>当前状态</span>
          <select
            value={status}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
              setStatus(event.currentTarget.value as ApplicationStatus | "all")
            }
          >
            <option value="all">全部状态</option>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <button
          aria-expanded={advancedOpen}
          className={advancedOpen ? "secondary-action secondary-action-active" : "secondary-action"}
          onClick={() => setAdvancedOpen((value) => !value)}
          type="button"
        >
          <SlidersHorizontal aria-hidden="true" size={17} />
          更多条件
          {advancedFilterCount > 0 && <span className="action-count">{advancedFilterCount}</span>}
          <ChevronDown aria-hidden="true" className={advancedOpen ? "chevron-open" : ""} size={16} />
        </button>
        <div className="application-toolbar-result">
          <strong>{records.length}</strong>
          <span>条记录</span>
        </div>
        <ViewSwitcher onChange={changeViewMode} value={viewMode} />

        <div className={advancedOpen ? "application-advanced application-advanced-open" : "application-advanced"}>
          <label className="select-field">
            <span>优先级</span>
            <select
              value={priority}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
                setPriority(event.currentTarget.value as ApplicationPriority | "all")
              }
            >
              <option value="all">全部优先级</option>
              {PRIORITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="select-field">
            <span>申请结果</span>
            <select
              value={result}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
                setResult(event.currentTarget.value as ApplicationResult | "all")
              }
            >
              <option value="all">全部结果</option>
              {RESULT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <FilterSegment
            label="截止范围"
            onChange={(value) => setRange(value as ApplicationRangeFilter)}
            options={APPLICATION_RANGE_OPTIONS}
            value={range}
          />
          {advancedFilterCount > 0 && (
            <button className="clear-filter-button application-filter-clear" onClick={resetApplicationFilters} type="button">
              <RotateCcw aria-hidden="true" size={14} />
              清除筛选
            </button>
          )}
        </div>
      </section>

      <section className="application-list-panel" aria-label="申请列表">
        {records.length === 0 ? (
          <StateMessage
            title="还没有符合条件的申请"
            message={data.records.length === 0 ? "从 DDL 列表里点击加入申请后，这里会生成本地记录。" : "调整筛选条件后再试。"}
          />
        ) : viewMode === "table" ? (
          <ApplicationTable
            activeRecordId={activeRecord?.id ?? null}
            records={records}
            onChooseRecord={onSelectRecord}
          />
        ) : (
          <ApplicationCards
            activeRecordId={activeRecord?.id ?? null}
            records={records}
            onChooseRecord={onSelectRecord}
          />
        )}
      </section>

      <ApplicationEditor
        onClose={() => onSelectRecord(null)}
        record={activeRecord}
        onRemoveRecord={onRemoveRecord}
        onUpdateRecord={onUpdateRecord}
      />
    </section>
  );
}

function ApplicationMetric({
  label,
  tone = "normal",
  value
}: {
  label: string;
  tone?: "normal" | "attention";
  value: number;
}): React.ReactElement {
  return (
    <div className={tone === "attention" ? "application-metric application-metric-attention" : "application-metric"}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function StorageRecoveryBanner({
  issue,
  onReset
}: {
  issue: ApplicationStorageIssue;
  onReset: () => void;
}): React.ReactElement {
  const [copied, setCopied] = useState(false);

  function copyRawData(): void {
    void navigator.clipboard?.writeText(issue.rawValue).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      },
      () => setCopied(false)
    );
  }

  return (
    <section className="storage-recovery" role="alert">
      <div>
        <strong>本地申请数据暂时无法读取</strong>
        <p>{issue.message}。原始内容仍保留在浏览器中，请先备份，再决定是否重置。</p>
      </div>
      <div className="storage-recovery-actions">
        <button className="secondary-action" onClick={copyRawData} type="button">
          <Copy aria-hidden="true" size={16} />
          {copied ? "已复制" : "复制原始数据"}
        </button>
        <button
          className="danger-action"
          onClick={() => {
            if (window.confirm("重置后将清空当前浏览器中的异常申请数据，是否继续？")) {
              onReset();
            }
          }}
          type="button"
        >
          <Trash2 aria-hidden="true" size={16} />
          重置本地数据
        </button>
      </div>
    </section>
  );
}

function ApplicationTable({
  activeRecordId,
  records,
  onChooseRecord
}: {
  activeRecordId: string | null;
  records: ApplicationRecord[];
  onChooseRecord: (id: string) => void;
}): React.ReactElement {
  return (
    <div className="table-wrap application-table-wrap">
      <table className="ddl-table application-table">
        <thead>
          <tr>
            <th>学校</th>
            <th>院系</th>
            <th>DDL</th>
            <th>状态</th>
            <th>优先级</th>
            <th>材料</th>
            <th>结果</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr
              className={activeRecordId === record.id ? "application-row-active" : ""}
              key={record.id}
            >
              <td>{renderApplicationOfficialLink(record, record.school)}</td>
              <td>{renderApplicationOfficialLink(record, record.institute || "未提供院系", true)}</td>
              <td>
                <strong>{formatApplicationRemaining(record)}</strong>
                <span>{record.deadlineText || formatEventDate(record.deadlineAt)}</span>
                {record.website.trim() !== "" && (
                  <a
                    className="application-inline-source"
                    href={record.website}
                    rel="noreferrer"
                    target="_blank"
                  >
                    官方通知
                  </a>
                )}
              </td>
              <td><span className={`status-pill status-${record.status}`}>{formatApplicationStatus(record.status)}</span></td>
              <td>{formatPriority(record.priority)}</td>
              <td>{formatMaterialProgress(record.materials)}</td>
              <td>{formatResult(record.result)}</td>
              <td>
                <div className="table-actions">
                  <button onClick={() => onChooseRecord(record.id)} type="button">
                    <ArrowUpRight aria-hidden="true" size={15} />
                    编辑
                  </button>
                  {record.website !== "" && (
                    <a href={record.website} rel="noreferrer" target="_blank" title="官方通知">
                      <ExternalLink aria-hidden="true" size={15} />
                      官方通知
                    </a>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ApplicationCards({
  activeRecordId,
  records,
  onChooseRecord
}: {
  activeRecordId: string | null;
  records: ApplicationRecord[];
  onChooseRecord: (id: string) => void;
}): React.ReactElement {
  return (
    <ol className="application-card-list">
      {records.map((record) => (
        <li
          className={activeRecordId === record.id ? "application-card application-card-active" : "application-card"}
          key={record.id}
        >
          <div className="application-card-main">
            <span className={`status-pill status-${record.status}`}>{formatApplicationStatus(record.status)}</span>
            <h3>{renderApplicationOfficialLink(record, record.school)}</h3>
            <p>{renderApplicationOfficialLink(record, record.institute || "未提供院系", true)}</p>
          </div>
          <dl className="application-card-meta">
            <div>
              <dt>DDL</dt>
              <dd>{formatApplicationRemaining(record)}</dd>
            </div>
            <div>
              <dt>优先级</dt>
              <dd>{formatPriority(record.priority)}</dd>
            </div>
            <div>
              <dt>材料</dt>
              <dd>{formatMaterialProgress(record.materials)}</dd>
            </div>
          </dl>
          <button className="icon-action" onClick={() => onChooseRecord(record.id)} type="button">
            <ArrowUpRight aria-hidden="true" size={17} />
            编辑申请
          </button>
        </li>
      ))}
    </ol>
  );
}

function renderApplicationOfficialLink(
  record: ApplicationRecord,
  label: string,
  muted = false
): React.ReactElement {
  const trimmedLabel = label.trim() || "未提供";
  if (record.website.trim() === "") {
    return <span>{trimmedLabel}</span>;
  }
  return (
    <a
      className={muted ? "application-record-link application-record-link-muted" : "application-record-link"}
      href={record.website}
      rel="noreferrer"
      target="_blank"
      title={`${record.school} ${record.institute || ""} - 打开官方通知`}
    >
      {trimmedLabel}
    </a>
  );
}

function ApplicationEditor({
  onClose,
  onRemoveRecord,
  onUpdateRecord,
  record
}: {
  onClose: () => void;
  onRemoveRecord: (id: string) => void;
  onUpdateRecord: (id: string, values: Partial<ApplicationRecord>) => void;
  record: ApplicationRecord | null;
}): React.ReactElement | null {
  const [draft, setDraft] = useState<ApplicationRecord | null>(null);
  const [baseline, setBaseline] = useState<ApplicationRecord | null>(null);
  const [newEventType, setNewEventType] = useState<ApplicationEventType>("interview");
  const [newEventTitle, setNewEventTitle] = useState("");
  const [newEventDate, setNewEventDate] = useState("");
  const [newEventNote, setNewEventNote] = useState("");
  const [saved, setSaved] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const hasChanges =
    draft !== null && baseline !== null && serializeEditableRecord(draft) !== serializeEditableRecord(baseline);
  const hasChangesRef = useRef(hasChanges);
  hasChangesRef.current = hasChanges;

  useEffect(() => {
    const nextRecord = record === null ? null : cloneApplicationRecord(record);
    setDraft(nextRecord);
    setBaseline(nextRecord === null ? null : cloneApplicationRecord(nextRecord));
    setNewEventType("interview");
    setNewEventTitle("");
    setNewEventDate("");
    setNewEventNote("");
    setSaved(false);
  }, [record?.id]);

  useEffect(() => {
    if (record === null) {
      return;
    }
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => closeButtonRef.current?.focus(), 0);

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Tab") {
        const focusable = Array.from(
          drawerRef.current?.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          ) ?? []
        ).filter((element) => element.getClientRects().length > 0);
        const first = focusable[0];
        const last = focusable.at(-1);
        if (first !== undefined && last !== undefined) {
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
        return;
      }
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      if (!hasChangesRef.current || window.confirm("当前修改尚未保存，确定关闭吗？")) {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [record?.id]);

  if (record === null || draft === null) {
    return null;
  }
  const activeRecord = draft;

  function requestClose(): void {
    if (hasChanges && !window.confirm("当前修改尚未保存，确定关闭吗？")) {
      return;
    }
    onClose();
  }

  function updateDraft(values: Partial<ApplicationRecord>): void {
    setSaved(false);
    setDraft((current) => (current === null ? current : { ...current, ...values }));
  }

  function updateMaterial(material: ApplicationMaterial, status: MaterialStatus): void {
    updateDraft({
      materials: activeRecord.materials.map((entry) =>
        entry.id === material.id ? { ...entry, status } : entry
      )
    });
  }

  function removeEvent(eventId: string): void {
    updateDraft({
      events: activeRecord.events.filter((event) => event.id !== eventId)
    });
  }

  function addEvent(): void {
    const title = newEventTitle.trim();
    if (title === "" || newEventDate.trim() === "") {
      return;
    }
    const event: ApplicationEvent = {
      id: `event-${Date.now().toString(36)}`,
      type: newEventType,
      title,
      date: dateTimeLocalToIso(newEventDate),
      note: newEventNote.trim()
    };
    updateDraft({ events: [...activeRecord.events, event] });
    setNewEventTitle("");
    setNewEventDate("");
    setNewEventNote("");
  }

  function saveChanges(): void {
    if (!hasChanges) {
      return;
    }
    onUpdateRecord(activeRecord.id, activeRecord);
    setBaseline(cloneApplicationRecord(activeRecord));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }

  function deleteApplication(): void {
    if (!window.confirm(`确定删除“${activeRecord.school}”的申请记录吗？`)) {
      return;
    }
    onRemoveRecord(activeRecord.id);
    onClose();
  }

  return (
    <div className="application-drawer-layer">
      <button aria-label="关闭申请详情" className="drawer-backdrop" onClick={requestClose} type="button" />
      <aside
        aria-labelledby="application-editor-title"
        aria-modal="true"
        className="application-editor"
        ref={drawerRef}
        role="dialog"
      >
        <header className="editor-head">
          <div>
            <span className="section-kicker">APPLICATION DETAIL</span>
            <h3 id="application-editor-title">{activeRecord.school}</h3>
            <p>{activeRecord.institute || "未提供院系"}</p>
          </div>
          <div className="editor-head-actions">
            <span className="tier-badge">{activeRecord.tier}</span>
            <button
              aria-label="关闭申请详情"
              className="icon-button"
              onClick={requestClose}
              ref={closeButtonRef}
              title="关闭"
              type="button"
            >
              <X aria-hidden="true" size={20} />
            </button>
          </div>
        </header>

        <div className="editor-scroll">
          <section className="editor-section" aria-labelledby="editor-basic-title">
            <div className="editor-section-title">
              <span>01</span>
              <h4 id="editor-basic-title">基本信息</h4>
            </div>
            <div className="editor-form-grid editor-form-grid-two">
              <label className="text-field">
                <span>学校</span>
                <input value={activeRecord.school} onChange={(event) => updateDraft({ school: event.currentTarget.value })} />
              </label>
              <label className="text-field">
                <span>院系或项目</span>
                <input value={activeRecord.institute} onChange={(event) => updateDraft({ institute: event.currentTarget.value })} />
              </label>
              <label className="text-field">
                <span>官方通知</span>
                <input
                  inputMode="url"
                  placeholder="https://"
                  type="url"
                  value={activeRecord.website}
                  onChange={(event) => updateDraft({ website: event.currentTarget.value })}
                />
              </label>
              <label className="text-field">
                <span>截止时间</span>
                <input
                  type="datetime-local"
                  value={dateTimeIsoToLocal(activeRecord.deadlineAt)}
                  onChange={(event) => {
                    const deadlineAt = dateTimeLocalToIso(event.currentTarget.value);
                    updateDraft({ deadlineAt, deadlineText: formatEventDate(deadlineAt) });
                  }}
                />
              </label>
              <label className="select-field">
                <span>项目类型</span>
                <select
                  value={activeRecord.activityType}
                  onChange={(event) => updateDraft({ activityType: event.currentTarget.value as ActivityType })}
                >
                  {ACTIVITY_TYPE_OPTIONS.filter((option) => option.value !== "all").map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="editor-section" aria-labelledby="editor-progress-title">
            <div className="editor-section-title">
              <span>02</span>
              <h4 id="editor-progress-title">申请进度</h4>
            </div>
            <div className="editor-fields">
              <label className="select-field">
                <span>状态</span>
                <select
                  value={activeRecord.status}
                  onChange={(event) => updateDraft({ status: event.currentTarget.value as ApplicationStatus })}
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="select-field">
                <span>优先级</span>
                <select
                  value={activeRecord.priority}
                  onChange={(event) => updateDraft({ priority: event.currentTarget.value as ApplicationPriority })}
                >
                  {PRIORITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="select-field">
                <span>结果</span>
                <select
                  value={activeRecord.result}
                  onChange={(event) => updateDraft({ result: event.currentTarget.value as ApplicationResult })}
                >
                  {RESULT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="editor-section material-panel" aria-labelledby="editor-material-title">
            <div className="editor-section-title">
              <span>03</span>
              <h4 id="editor-material-title">材料清单</h4>
            </div>
            <div className="material-list">
              {activeRecord.materials.map((material) => (
                <div className="material-row" key={material.id}>
                  <label className="material-checkbox">
                    <input
                      checked={material.status === "done"}
                      disabled={material.status === "not_required"}
                      onChange={(event) => updateMaterial(material, event.currentTarget.checked ? "done" : "todo")}
                      type="checkbox"
                    />
                    <span>{material.label}</span>
                  </label>
                  <button
                    aria-pressed={material.status === "not_required"}
                    className={material.status === "not_required" ? "material-skip material-skip-active" : "material-skip"}
                    onClick={() => updateMaterial(material, material.status === "not_required" ? "todo" : "not_required")}
                    type="button"
                  >
                    {material.status === "not_required" ? "恢复待办" : "不需要"}
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="editor-section events-panel" aria-labelledby="editor-events-title">
            <div className="editor-section-title">
              <span>04</span>
              <h4 id="editor-events-title">关键日期</h4>
            </div>
            <div className="event-list">
              {activeRecord.events.length === 0 ? (
                <p className="empty-hint">暂无日程。</p>
              ) : (
                activeRecord.events
                  .slice()
                  .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                  .map((event) => (
                    <div className="event-row" key={event.id}>
                      <span className={`event-type event-${event.type}`}>{formatEventType(event.type)}</span>
                      <div>
                        <strong>{event.title}</strong>
                        <span>{formatEventDate(event.date)}{event.note === "" ? "" : ` · ${event.note}`}</span>
                      </div>
                      <button aria-label={`删除日程 ${event.title}`} onClick={() => removeEvent(event.id)} title="删除日程" type="button">
                        <Trash2 aria-hidden="true" size={16} />
                      </button>
                    </div>
                  ))
              )}
            </div>
            <div className="event-form">
              <select
                aria-label="日程类型"
                value={newEventType}
                onChange={(event) => setNewEventType(event.currentTarget.value as ApplicationEventType)}
              >
                {EVENT_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <input
                aria-label="日程名称"
                value={newEventTitle}
                onChange={(event) => setNewEventTitle(event.currentTarget.value)}
                placeholder="日程名称"
                type="text"
              />
              <input
                aria-label="日程时间"
                value={newEventDate}
                onChange={(event) => setNewEventDate(event.currentTarget.value)}
                type="datetime-local"
              />
              <input
                aria-label="日程备注"
                value={newEventNote}
                onChange={(event) => setNewEventNote(event.currentTarget.value)}
                placeholder="备注"
                type="text"
              />
              <button className="secondary-action event-add-button" onClick={addEvent} type="button">
                <Plus aria-hidden="true" size={17} />
                添加日程
              </button>
            </div>
          </section>

          <section className="editor-section" aria-labelledby="editor-notes-title">
            <div className="editor-section-title">
              <span>05</span>
              <h4 id="editor-notes-title">结果与备注</h4>
            </div>
            <label className="notes-field">
              <span>备注</span>
              <textarea
                value={activeRecord.notes}
                onChange={(event) => updateDraft({ notes: event.currentTarget.value })}
                placeholder="记录导师、材料要求、面试准备和结果。"
                rows={6}
              />
            </label>
            <button className="danger-action editor-delete" onClick={deleteApplication} type="button">
              <Trash2 aria-hidden="true" size={16} />
              删除申请记录
            </button>
          </section>
        </div>

        <footer className="editor-savebar">
          <span aria-live="polite">
            {saved ? "已保存到当前浏览器" : hasChanges ? "有未保存的修改" : "本地数据已保存"}
          </span>
          <div>
            {activeRecord.website.trim() !== "" && (
              <a className="secondary-action" href={activeRecord.website} rel="noreferrer" target="_blank">
                <ExternalLink aria-hidden="true" size={16} />
                官方通知
              </a>
            )}
            <button className="secondary-action" onClick={requestClose} type="button">关闭</button>
            <button className="primary-action" disabled={!hasChanges} onClick={saveChanges} type="button">
              <Save aria-hidden="true" size={17} />
              保存修改
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

function AgentDataPanel({
  data,
  onReplaceData
}: {
  data: ApplicationTrackerData;
  onReplaceData: (data: ApplicationTrackerData) => void;
}): React.ReactElement {
  const exportJson = useMemo(() => JSON.stringify(data, null, 2), [data]);
  const [patchText, setPatchText] = useState("");
  const [preview, setPreview] = useState<PatchPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function copyExport(): void {
    void navigator.clipboard?.writeText(exportJson).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      },
      () => setCopied(false)
    );
  }

  function buildPreview(): void {
    try {
      const patch = parseApplicationPatch(JSON.parse(patchText)) ;
      const nextPreview = previewApplicationPatch(data, patch);
      setPreview(nextPreview);
      setError(null);
    } catch (previewError) {
      setPreview(null);
      setError(previewError instanceof Error ? previewError.message : "Patch 解析失败");
    }
  }

  function applyPreview(): void {
    if (preview === null || preview.errors.length > 0) {
      return;
    }
    onReplaceData(preview.nextData);
    setPatchText("");
    setPreview(null);
  }

  return (
    <section className="agent-panel" aria-label="Agent 数据接口">
      <div className="agent-copy">
        <span className="section-kicker">AGENT JSON</span>
        <h3>本地申请数据</h3>
        <p>
          导出给 Codex 分析，导入 `{APPLICATION_PATCH_SCHEMA}` patch 前会先预览差异。
          页面也暴露 `window.BaoyanAgent`，可在当前浏览器内调用本地 CRUD。
        </p>
      </div>
      <div className="agent-grid">
        <div className="agent-box">
          <div className="agent-box-head">
            <strong>{APPLICATION_TRACKER_SCHEMA}</strong>
            <button className="icon-action" onClick={copyExport} type="button">
              <Copy aria-hidden="true" size={16} />
              {copied ? "已复制" : "复制 JSON"}
            </button>
          </div>
          <textarea readOnly rows={9} value={exportJson} />
        </div>
        <div className="agent-box">
          <div className="agent-box-head">
            <strong>导入 Patch</strong>
            <button className="icon-action" onClick={buildPreview} type="button">
              <Eye aria-hidden="true" size={16} />
              预览
            </button>
          </div>
          <textarea
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
              setPatchText(event.currentTarget.value);
              setPreview(null);
              setError(null);
            }}
            placeholder={`{\n  "schema": "${APPLICATION_PATCH_SCHEMA}",\n  "operations": []\n}`}
            rows={9}
            value={patchText}
          />
          {error !== null && <p className="agent-error">{error}</p>}
          {preview !== null && (
            <div className="patch-preview">
              <strong>{preview.appliedCount} 条可应用操作</strong>
              {preview.errors.length > 0 ? (
                <ul>{preview.errors.map((entry) => <li key={entry}>{entry}</li>)}</ul>
              ) : (
                <>
                  <ul>{preview.summary.slice(0, 6).map((entry) => <li key={entry}>{entry}</li>)}</ul>
                  <button className="chip chip-active" onClick={applyPreview} type="button">
                    <Check aria-hidden="true" size={16} />
                    确认应用
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function ApplicationCalendar({
  activeRecordId,
  onOpenRecord,
  onSelectApplications,
  records
}: {
  activeRecordId: string | null;
  onOpenRecord: (id: string) => void;
  onSelectApplications: () => void;
  records: ApplicationRecord[];
}): React.ReactElement {
  const [monthOffset, setMonthOffset] = useState(0);
  const monthDate = useMemo(() => {
    const date = new Date();
    date.setDate(1);
    date.setMonth(date.getMonth() + monthOffset);
    return date;
  }, [monthOffset]);
  const calendarDays = useMemo(() => buildCalendarDays(monthDate, records), [monthDate, records]);
  const upcoming = useMemo(() => buildUpcomingApplicationEvents(records), [records]);
  const monthTitle = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "long"
  }).format(monthDate);
  const todayLabel = formatTodayLabel();

  return (
    <section className="calendar-shell" aria-label="申请日历">
      <header className="workspace-intro calendar-intro">
        <div>
          <span className="section-kicker">CALENDAR</span>
          <h2>申请日历</h2>
          <p>聚合已加入申请的 DDL、面试、开营、结果和补材料日程。</p>
        </div>
        <div className="calendar-actions">
          <button
            aria-label="查看上月"
            className="icon-button"
            onClick={() => setMonthOffset((value) => value - 1)}
            title="上月"
            type="button"
          >
            <ChevronLeft aria-hidden="true" size={20} />
          </button>
          <button className="secondary-action" onClick={() => setMonthOffset(0)} type="button">
            回到今天
          </button>
          <button
            aria-label="查看下月"
            className="icon-button"
            onClick={() => setMonthOffset((value) => value + 1)}
            title="下月"
            type="button"
          >
            <ChevronRight aria-hidden="true" size={20} />
          </button>
        </div>
      </header>

      <div className="calendar-legend" aria-label="日程类型">
        {EVENT_TYPE_OPTIONS.map((option) => (
          <span className={`calendar-legend-item event-${option.value}`} key={option.value}>
            {option.label}
          </span>
        ))}
      </div>

      <div className="calendar-grid">
        <section className="month-card" aria-label={monthTitle}>
          <div className="month-title-row">
            <div className="month-title">{monthTitle}</div>
            <span className="today-badge">今天 {todayLabel}</span>
          </div>
          <div className="weekday-row" aria-hidden="true">
            {["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="month-grid">
            {calendarDays.map((day) => (
              <div
                className={buildDayCellClass(day)}
                key={day.key}
              >
                <div className="day-number-row">
                  <span className="day-number">{day.label}</span>
                  {day.isToday && <span className="day-today-label">今天</span>}
                </div>
                <div className="day-events">
                  {day.events.slice(0, 3).map((event) => (
                    <button
                      className={
                        event.record.id === activeRecordId
                          ? `day-event day-event-${event.event.type} day-event-active`
                          : `day-event day-event-${event.event.type}`
                      }
                      key={event.event.id}
                      onClick={() => {
                        onOpenRecord(event.record.id);
                        onSelectApplications();
                      }}
                      type="button"
                    >
                      {event.record.school} · {formatEventType(event.event.type)}
                    </button>
                  ))}
                  {day.events.length > 3 && <span className="day-more">+{day.events.length - 3}</span>}
                </div>
              </div>
            ))}
          </div>
        </section>

        <aside className="upcoming-card" aria-label="近期日程">
          <h3>近期日程</h3>
          {upcoming.length === 0 ? (
            <p className="empty-hint">暂无未来日程。</p>
          ) : (
            <ol className="upcoming-list">
              {upcoming.slice(0, 12).map(({ event, record }) => (
                <li key={`${record.id}-${event.id}`}>
                  <button
                    onClick={() => {
                      onOpenRecord(record.id);
                      onSelectApplications();
                    }}
                    type="button"
                  >
                    <span className={`event-type event-${event.type}`}>{formatEventType(event.type)}</span>
                    <strong>{record.school}</strong>
                    <em>{formatRelativeEventDate(event.date)}</em>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>
    </section>
  );
}

function DdlResults({
  applicationSourceKeys,
  favorites,
  highlightedKey,
  items,
  onAddApplication,
  onOpenApplication,
  onToggleFavorite,
  onToggleRead,
  readItems,
  viewMode
}: {
  applicationSourceKeys: Set<string>;
  favorites: Set<string>;
  highlightedKey: string | null;
  items: DdlItem[];
  onAddApplication: (item: DdlItem) => void;
  onOpenApplication: (item: DdlItem) => void;
  onToggleFavorite: (key: string) => void;
  onToggleRead: (key: string) => void;
  readItems: Set<string>;
  viewMode: ViewMode;
}): React.ReactElement {
  if (viewMode === "table") {
    return (
      <DdlTable
        favorites={favorites}
        highlightedKey={highlightedKey}
        items={items}
        applicationSourceKeys={applicationSourceKeys}
        onAddApplication={onAddApplication}
        onOpenApplication={onOpenApplication}
        onToggleFavorite={onToggleFavorite}
        onToggleRead={onToggleRead}
        readItems={readItems}
      />
    );
  }
  return (
    <ol className="notice-list">
      {items.map((item) => (
        <DdlCard
          addedToApplications={applicationSourceKeys.has(item.key)}
          favorite={favorites.has(item.key)}
          highlighted={item.key === highlightedKey}
          item={item}
          key={item.key}
          onAddApplication={() => onAddApplication(item)}
          onOpenApplication={() => onOpenApplication(item)}
          onToggleFavorite={() => onToggleFavorite(item.key)}
          onToggleRead={() => onToggleRead(item.key)}
          read={readItems.has(item.key)}
        />
      ))}
    </ol>
  );
}

function DdlCard({
  addedToApplications,
  favorite,
  highlighted,
  item,
  onAddApplication,
  onOpenApplication,
  onToggleFavorite,
  onToggleRead,
  read
}: {
  addedToApplications: boolean;
  favorite: boolean;
  highlighted: boolean;
  item: DdlItem;
  onAddApplication: () => void;
  onOpenApplication: () => void;
  onToggleFavorite: () => void;
  onToggleRead: () => void;
  read: boolean;
}): React.ReactElement {
  const classes = ["notice-card"];
  if (item.status === "today") {
    classes.push("notice-card-urgent");
  }
  if (highlighted) {
    classes.push("notice-card-flash");
  }
  if (read) {
    classes.push("notice-card-read");
  }
  return (
    <li className={classes.join(" ")} id={`ddl-${item.key}`}>
      <div className="date-block" aria-label={item.remainingText}>
        <strong>{item.status === "today" ? "今日" : item.remainingDays}</strong>
        <span>{item.status === "today" ? "截止" : "天后"}</span>
      </div>
      <article>
        <div className="card-head">
          <div>
            <h2>
              <a href={item.website} rel="noreferrer" target="_blank">{item.school}</a>
            </h2>
            <p>{item.institute || "未提供院系"}</p>
          </div>
          <div className="card-badges">
            <span className={`activity-badge activity-${item.activityType}`}>
              {item.activityTypeLabel}
            </span>
            <span className="tier-badge">{item.tier}</span>
          </div>
        </div>
        <AreaBadges item={item} />
        <div className="relevance-line">
          <span className={`relevance-badge relevance-${item.relevance}`}>
            {formatRelevance(item.relevance)}
          </span>
          {item.relevanceReason !== null && item.relevanceReason !== "" && (
            <span className="relevance-reason">{truncate(item.relevanceReason, 48)}</span>
          )}
        </div>
        <dl className="meta-grid">
          <div>
            <dt>截止时间</dt>
            <dd>{item.deadlineText}</dd>
          </div>
          <div>
            <dt>来源</dt>
            <dd>{item.sourceLabel}</dd>
          </div>
          <div>
            <dt>状态</dt>
            <dd>{item.remainingText}</dd>
          </div>
        </dl>
        {item.description !== "" && <p className="description">{truncate(item.description, 96)}</p>}
        <div className="card-actions">
          <a className="source-link" href={item.website} rel="noreferrer" target="_blank">
            <ExternalLink aria-hidden="true" size={16} />
            官方通知
          </a>
          <button
            aria-label={favorite ? "取消收藏" : "收藏"}
            aria-pressed={favorite}
            className="icon-action compact-icon-action"
            onClick={onToggleFavorite}
            title={favorite ? "取消收藏" : "收藏"}
            type="button"
          >
            {favorite ? <BookmarkCheck aria-hidden="true" size={17} /> : <Bookmark aria-hidden="true" size={17} />}
            <span>{favorite ? "已收藏" : "收藏"}</span>
          </button>
          <button
            aria-label={read ? "标记为未读" : "标记为已读"}
            aria-pressed={read}
            className="icon-action compact-icon-action"
            onClick={onToggleRead}
            title={read ? "标记为未读" : "标记为已读"}
            type="button"
          >
            {read ? <EyeOff aria-hidden="true" size={17} /> : <Eye aria-hidden="true" size={17} />}
            <span>{read ? "已读" : "标为已读"}</span>
          </button>
          <button
            className={addedToApplications ? "icon-action application-action application-action-added" : "icon-action application-action"}
            onClick={addedToApplications ? onOpenApplication : onAddApplication}
            type="button"
          >
            {addedToApplications ? <Check aria-hidden="true" size={17} /> : <Plus aria-hidden="true" size={17} />}
            {addedToApplications ? "已加入申请" : "加入申请"}
          </button>
        </div>
      </article>
    </li>
  );
}

function getAreaClass(area: string): string {
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

function DdlTable({
  applicationSourceKeys,
  favorites,
  highlightedKey,
  items,
  onAddApplication,
  onOpenApplication,
  onToggleFavorite,
  onToggleRead,
  readItems
}: {
  applicationSourceKeys: Set<string>;
  favorites: Set<string>;
  highlightedKey: string | null;
  items: DdlItem[];
  onAddApplication: (item: DdlItem) => void;
  onOpenApplication: (item: DdlItem) => void;
  onToggleFavorite: (key: string) => void;
  onToggleRead: (key: string) => void;
  readItems: Set<string>;
}): React.ReactElement {
  return (
    <div className="table-wrap">
      <table className="ddl-table">
        <thead>
          <tr>
            <th>截止时间</th>
            <th>学校</th>
            <th>院系</th>
            <th>类型</th>
            <th>层次</th>
            <th>方向</th>
            <th>相关度</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              className={[
                readItems.has(item.key) ? "table-row-read" : "",
                highlightedKey === item.key ? "table-row-flash" : ""
              ].filter(Boolean).join(" ")}
              id={`ddl-${item.key}`}
              key={item.key}
            >
              <td>
                <strong>{item.remainingText}</strong>
                <span>{item.deadlineText}</span>
              </td>
              <td>
                <a className="table-primary-link" href={item.website} rel="noreferrer" target="_blank">
                  {item.school}
                </a>
              </td>
              <td>
                {item.institute || "未提供院系"}
                <span>{item.sourceLabel}</span>
              </td>
              <td>
                <span className={`table-activity activity-${item.activityType}`}>
                  {item.activityTypeLabel}
                </span>
              </td>
              <td>{item.tier}</td>
              <td>
                <div className="table-area-list">
                  {getItemAreas(item).map((area) => (
                    <span className={`table-area ${getAreaClass(area)}`} key={area}>{area}</span>
                  ))}
                </div>
              </td>
              <td>
                <span className={`table-relevance relevance-${item.relevance}`}>
                  {formatRelevance(item.relevance)}
                </span>
              </td>
              <td>
                <div className="table-actions">
                  <a aria-label="打开官方通知" href={item.website} rel="noreferrer" target="_blank" title="官方通知">
                    <ExternalLink aria-hidden="true" size={15} />
                  </a>
                  <button
                    aria-label={favorites.has(item.key) ? "取消收藏" : "收藏"}
                    onClick={() => onToggleFavorite(item.key)}
                    title={favorites.has(item.key) ? "取消收藏" : "收藏"}
                    type="button"
                  >
                    {favorites.has(item.key) ? <BookmarkCheck aria-hidden="true" size={15} /> : <Bookmark aria-hidden="true" size={15} />}
                  </button>
                  <button
                    aria-label={readItems.has(item.key) ? "标记为未读" : "标记为已读"}
                    onClick={() => onToggleRead(item.key)}
                    title={readItems.has(item.key) ? "标记为未读" : "标记为已读"}
                    type="button"
                  >
                    {readItems.has(item.key) ? <EyeOff aria-hidden="true" size={15} /> : <Eye aria-hidden="true" size={15} />}
                  </button>
                  <button
                    aria-label={applicationSourceKeys.has(item.key) ? "打开申请" : "加入申请"}
                    onClick={() =>
                      applicationSourceKeys.has(item.key) ? onOpenApplication(item) : onAddApplication(item)
                    }
                    title={applicationSourceKeys.has(item.key) ? "打开申请" : "加入申请"}
                    type="button"
                  >
                    {applicationSourceKeys.has(item.key) ? <Check aria-hidden="true" size={15} /> : <Plus aria-hidden="true" size={15} />}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AreaBadges({ item }: { item: DdlItem }): React.ReactElement {
  return (
    <div className="area-badges" aria-label="方向分类">
      {getItemAreas(item).map((area) => (
        <span className={`area-badge ${getAreaClass(area)}`} key={area}>{area}</span>
      ))}
    </div>
  );
}

function Timeline({
  loading,
  onSelectItem,
  range,
  stops
}: {
  loading: boolean;
  onSelectItem: (itemKey: string) => void;
  range: RangeFilter;
  stops: TimelineStop[];
}): React.ReactElement | null {
  const [expandedStops, setExpandedStops] = useState<Set<number>>(new Set());
  const [hasHorizontalOverflow, setHasHorizontalOverflow] = useState(false);
  const timelineTrackRef = useRef<HTMLOListElement>(null);
  const timelineScrollbarRef = useRef<HTMLDivElement>(null);
  const timelineScrollbarContentRef = useRef<HTMLDivElement>(null);
  const expandableStopKeys = useMemo(
    () =>
      stops
        .filter((stop) => stop.entries.length > TIMELINE_COLLAPSE_LIMIT)
        .map((stop) => stop.remainingDays),
    [stops]
  );
  const expandedStopCount = useMemo(
    () => expandableStopKeys.filter((key) => expandedStops.has(key)).length,
    [expandableStopKeys, expandedStops]
  );
  const hasExpandableStops = expandableStopKeys.length > 0;
  const allExpandableStopsExpanded =
    hasExpandableStops && expandedStopCount === expandableStopKeys.length;
  const rangeLabel = formatTimelineRangeLabel(range);

  useEffect(() => {
    setExpandedStops((previous) => {
      const activeKeys = new Set(expandableStopKeys);
      const next = new Set([...previous].filter((key) => activeKeys.has(key)));
      return next.size === previous.size ? previous : next;
    });
  }, [expandableStopKeys]);

  useEffect(() => {
    const track = timelineTrackRef.current;
    const scrollbar = timelineScrollbarRef.current;
    const scrollbarContent = timelineScrollbarContentRef.current;
    if (track === null || scrollbar === null || scrollbarContent === null) {
      return;
    }

    const updateScrollbar = (): void => {
      scrollbarContent.style.width = `${track.scrollWidth}px`;
      setHasHorizontalOverflow(track.scrollWidth > track.clientWidth + 1);
      if (scrollbar.scrollLeft !== track.scrollLeft) {
        scrollbar.scrollLeft = track.scrollLeft;
      }
    };

    const syncFromTrack = (): void => {
      if (scrollbar.scrollLeft !== track.scrollLeft) {
        scrollbar.scrollLeft = track.scrollLeft;
      }
    };
    const syncFromScrollbar = (): void => {
      if (track.scrollLeft !== scrollbar.scrollLeft) {
        track.scrollLeft = scrollbar.scrollLeft;
      }
    };

    updateScrollbar();
    track.addEventListener("scroll", syncFromTrack, { passive: true });
    scrollbar.addEventListener("scroll", syncFromScrollbar, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateScrollbar);
    observer?.observe(track);

    return () => {
      observer?.disconnect();
      track.removeEventListener("scroll", syncFromTrack);
      scrollbar.removeEventListener("scroll", syncFromScrollbar);
    };
  }, [expandedStops, loading, stops]);

  if (loading) {
    return null;
  }

  function setAllStopsExpansion(nextExpansion: TimelineExpansion): void {
    setExpandedStops(
      nextExpansion === "expanded" ? new Set(expandableStopKeys) : new Set()
    );
  }

  function toggleStopExpansion(key: number): void {
    setExpandedStops((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  return (
    <section className="timeline" aria-label={`${rangeLabel}截止时间线`}>
      <div className="timeline-head">
        <div className="timeline-head-text">
          <span className="timeline-title">{rangeLabel}截止</span>
          <span className="timeline-hint">按筛选条件实时更新</span>
        </div>
        {hasExpandableStops && (
          <div className="timeline-actions" aria-label="时间线展开控制">
            <button
              className="timeline-action"
              disabled={allExpandableStopsExpanded}
              onClick={() => setAllStopsExpansion("expanded")}
              type="button"
            >
              全部展开
            </button>
            <button
              className="timeline-action"
              disabled={expandedStopCount === 0}
              onClick={() => setAllStopsExpansion("collapsed")}
              type="button"
            >
              全部收起
            </button>
          </div>
        )}
      </div>
      <div
        aria-label="时间线横向滚动"
        className={
          hasHorizontalOverflow
            ? "timeline-scrollbar"
            : "timeline-scrollbar timeline-scrollbar-hidden"
        }
        ref={timelineScrollbarRef}
        tabIndex={hasHorizontalOverflow ? 0 : -1}
      >
        <div
          aria-hidden="true"
          className="timeline-scrollbar-content"
          ref={timelineScrollbarContentRef}
        />
      </div>
      {stops.length === 0 ? (
        <p className="timeline-empty">{rangeLabel}暂无符合条件的截止。</p>
      ) : (
        <ol className="timeline-track" ref={timelineTrackRef}>
          {stops.map((stop) => (
            <TimelineColumn
              expanded={expandedStops.has(stop.remainingDays)}
              key={stop.remainingDays}
              onSelectItem={onSelectItem}
              onToggleExpanded={() => toggleStopExpansion(stop.remainingDays)}
              stop={stop}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function TimelineColumn({
  expanded,
  onSelectItem,
  onToggleExpanded,
  stop
}: {
  expanded: boolean;
  onSelectItem: (itemKey: string) => void;
  onToggleExpanded: () => void;
  stop: TimelineStop;
}): React.ReactElement {
  const overflow = stop.entries.length - TIMELINE_COLLAPSE_LIMIT;
  const collapsible = overflow > 0;
  const visible = collapsible && !expanded ? stop.entries.slice(0, TIMELINE_COLLAPSE_LIMIT) : stop.entries;

  return (
    <li
      className={stop.isToday ? "timeline-stop timeline-stop-today" : "timeline-stop"}
    >
      <div className="timeline-node" aria-hidden="true" />
      <button
        className="timeline-when"
        disabled={stop.entries.length === 0}
        onClick={() => {
          const firstEntry = stop.entries[0];
          if (firstEntry !== undefined) {
            onSelectItem(firstEntry.key);
          }
        }}
        title="定位到当天第一条 DDL"
        type="button"
      >
        <strong>{stop.dayLabel}</strong>
        <span>{stop.dateLabel}</span>
        <span className="timeline-count">{stop.entries.length} 所</span>
      </button>
      <ul className="timeline-entries">
        {visible.map((entry) => (
          <li key={entry.key}>
            <a
              className="timeline-entry"
              href={entry.website}
              rel="noreferrer"
              target="_blank"
              title={`${entry.school} ${entry.institute} — 查看原始通知`}
            >
              <span className="timeline-school">{entry.school}</span>
              <span className="timeline-institute">{entry.institute || "未提供院系"}</span>
              <span className={`timeline-activity activity-${entry.activityType}`}>
                {formatActivityType(entry.activityType)}
              </span>
              <span className="timeline-tier">{entry.tier}</span>
            </a>
          </li>
        ))}
      </ul>
      {collapsible && (
        <button
          className="timeline-more"
          onClick={onToggleExpanded}
          type="button"
        >
          {expanded ? "收起" : `展开 +${overflow} 所`}
        </button>
      )}
    </li>
  );
}

function DdlSkeleton(): React.ReactElement {
  // 卡片骨架屏:加载时给出版面预期,比纯文字提示更流畅
  return (
    <ol className="notice-list" aria-label="正在加载 DDL 数据" aria-busy="true">
      {[0, 1, 2, 3].map((index) => (
        <li className="skeleton-card" key={index}>
          <div className="skeleton-date sk-shimmer" />
          <div className="skeleton-body">
            <div className="skeleton-line sk-shimmer" style={{ width: "42%", height: 18 }} />
            <div className="skeleton-line sk-shimmer" style={{ width: "26%" }} />
            <div className="skeleton-chips">
              <span className="skeleton-pill sk-shimmer" />
              <span className="skeleton-pill sk-shimmer" />
              <span className="skeleton-pill sk-shimmer" />
            </div>
            <div className="skeleton-grid">
              <span className="skeleton-box sk-shimmer" />
              <span className="skeleton-box sk-shimmer" />
              <span className="skeleton-box sk-shimmer" />
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function StateMessage({
  actionLabel,
  message,
  onAction,
  title
}: {
  actionLabel?: string;
  message: string;
  onAction?: () => void;
  title: string;
}): React.ReactElement {
  return (
    <section className="state-message">
      <h2>{title}</h2>
      <p>{message}</p>
      {actionLabel !== undefined && onAction !== undefined && (
        <button className="chip chip-active" onClick={onAction} type="button">
          {actionLabel}
        </button>
      )}
    </section>
  );
}

function filterApplicationRecords(
  records: ApplicationRecord[],
  filters: {
    priority: ApplicationPriority | "all";
    query: string;
    range: ApplicationRangeFilter;
    result: ApplicationResult | "all";
    status: ApplicationStatus | "all";
  }
): ApplicationRecord[] {
  const keyword = filters.query.trim().toLowerCase();
  return records
    .filter((record) => {
      if (filters.status !== "all" && record.status !== filters.status) {
        return false;
      }
      if (filters.priority !== "all" && record.priority !== filters.priority) {
        return false;
      }
      if (filters.result !== "all" && record.result !== filters.result) {
        return false;
      }
      if (!matchesApplicationRange(record, filters.range)) {
        return false;
      }
      if (keyword === "") {
        return true;
      }
      return `${record.school} ${record.institute} ${record.notes} ${record.areas.join(" ")}`
        .toLowerCase()
        .includes(keyword);
    })
    .sort(compareApplicationRecords);
}

function matchesApplicationRange(record: ApplicationRecord, range: ApplicationRangeFilter): boolean {
  if (range === "all") {
    return true;
  }
  const days = getRemainingDays(record.deadlineAt);
  if (range === "expired") {
    return days < 0;
  }
  if (days < 0) {
    return false;
  }
  if (range === "today") {
    return days === 0;
  }
  return days <= Number(range);
}

function compareApplicationRecords(a: ApplicationRecord, b: ApplicationRecord): number {
  const aDays = getRemainingDays(a.deadlineAt);
  const bDays = getRemainingDays(b.deadlineAt);
  if (aDays !== bDays) {
    return aDays - bDays;
  }
  const statusDiff = applicationStatusRank(a.status) - applicationStatusRank(b.status);
  if (statusDiff !== 0) {
    return statusDiff;
  }
  return a.school.localeCompare(b.school, "zh-CN");
}

function buildApplicationStats(records: ApplicationRecord[]): {
  pendingAction: number;
  preparing: number;
  submitted: number;
  total: number;
} {
  return {
    total: records.length,
    preparing: records.filter((record) => record.status === "watching" || record.status === "preparing").length,
    submitted: records.filter((record) => record.status === "submitted" || record.status === "interview").length,
    pendingAction: records.filter((record) => {
      if (["admitted", "rejected", "withdrawn"].includes(record.status)) {
        return false;
      }
      const days = getRemainingDays(record.deadlineAt);
      return (days >= 0 && days <= 7) || record.status === "interview" || record.status === "waiting_result";
    }).length
  };
}

function applicationStatusRank(status: ApplicationStatus): number {
  const index = STATUS_OPTIONS.findIndex((option) => option.value === status);
  return index === -1 ? STATUS_OPTIONS.length : index;
}

function formatApplicationStatus(status: ApplicationStatus): string {
  return STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

function formatPriority(priority: ApplicationPriority): string {
  return PRIORITY_OPTIONS.find((option) => option.value === priority)?.label ?? priority;
}

function formatResult(result: ApplicationResult): string {
  return RESULT_OPTIONS.find((option) => option.value === result)?.label ?? result;
}

function formatEventType(type: ApplicationEventType): string {
  return EVENT_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

function formatMaterialProgress(materials: ApplicationMaterial[]): string {
  const required = materials.filter((material) => material.status !== "not_required");
  const done = required.filter((material) => material.status === "done");
  if (required.length === 0) {
    return "无需材料";
  }
  return `${done.length}/${required.length}`;
}

function formatApplicationRemaining(record: ApplicationRecord): string {
  const days = getRemainingDays(record.deadlineAt);
  if (days < 0) {
    return "已过期";
  }
  if (days === 0) {
    return "今日截止";
  }
  return `${days} 天后截止`;
}

function getRemainingDays(value: string): number {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return Number.POSITIVE_INFINITY;
  }
  const today = getShanghaiDateKey(new Date());
  const target = getShanghaiDateKey(date);
  return Math.round((Date.parse(`${target}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
}

function getShanghaiDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function formatEventDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function formatRelativeEventDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const days = getRemainingDays(value);
  const prefix = days === 0 ? "今天" : days === 1 ? "明天" : days > 1 ? `${days} 天后` : "已发生";
  return `${prefix} · ${formatEventDate(value)}`;
}

function dateTimeIsoToLocal(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function dateTimeLocalToIso(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function cloneApplicationRecord(record: ApplicationRecord): ApplicationRecord {
  return {
    ...record,
    areas: [...record.areas],
    materials: record.materials.map((material) => ({ ...material })),
    events: record.events.map((event) => ({ ...event }))
  };
}

function serializeEditableRecord(record: ApplicationRecord): string {
  const { updatedAt: _updatedAt, ...editable } = record;
  return JSON.stringify(editable);
}

interface CalendarEventEntry {
  event: ApplicationEvent;
  record: ApplicationRecord;
}

interface CalendarDay {
  events: CalendarEventEntry[];
  inMonth: boolean;
  isToday: boolean;
  key: string;
  label: string;
}

function buildCalendarDays(monthDate: Date, records: ApplicationRecord[]): CalendarDay[] {
  const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const todayKey = getShanghaiDateKey(new Date());
  const start = new Date(first);
  const day = first.getDay() === 0 ? 7 : first.getDay();
  start.setDate(first.getDate() - day + 1);
  const eventsByDate = new Map<string, CalendarEventEntry[]>();
  for (const entry of buildAllApplicationEvents(records)) {
    const dateKey = getShanghaiDateKey(new Date(entry.event.date));
    const bucket = eventsByDate.get(dateKey);
    if (bucket === undefined) {
      eventsByDate.set(dateKey, [entry]);
    } else {
      bucket.push(entry);
    }
  }

  return Array.from({ length: 42 }, (_, index) => {
    const current = new Date(start);
    current.setDate(start.getDate() + index);
    const key = getShanghaiDateKey(current);
    return {
      events: eventsByDate.get(key) ?? [],
      inMonth: current.getMonth() === monthDate.getMonth(),
      isToday: key === todayKey,
      key,
      label: String(current.getDate())
    };
  });
}

function buildDayCellClass(day: CalendarDay): string {
  const classes = ["day-cell"];
  if (!day.inMonth) {
    classes.push("day-cell-muted");
  }
  if (day.isToday) {
    classes.push("day-cell-today");
  }
  return classes.join(" ");
}

function formatTodayLabel(): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "long",
    day: "numeric",
    weekday: "short"
  }).format(new Date());
}

function buildUpcomingApplicationEvents(records: ApplicationRecord[]): CalendarEventEntry[] {
  const now = Date.now();
  return buildAllApplicationEvents(records)
    .filter((entry) => {
      const time = new Date(entry.event.date).getTime();
      return !Number.isNaN(time) && time >= now - 86400000;
    })
    .sort((a, b) => new Date(a.event.date).getTime() - new Date(b.event.date).getTime());
}

function buildAllApplicationEvents(records: ApplicationRecord[]): CalendarEventEntry[] {
  return records.flatMap((record) =>
    record.events
      .filter((event) => !Number.isNaN(new Date(event.date).getTime()))
      .map((event) => ({ event, record }))
  );
}

function filterItems(
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

function buildActivityTypeStats(items: DdlItem[]): Record<ActivityType, number> {
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

function getAdvancedFilterCount(filters: {
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

function getDdlActiveFilterCount(filters: {
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

function buildStats(items: DdlItem[]): {
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

function buildTimeline(items: DdlItem[]): TimelineStop[] {
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

function formatTimelineRangeLabel(range: RangeFilter): string {
  const option = RANGE_OPTIONS.find((entry) => entry.value === range);
  if (option === undefined || option.value === "future") {
    return "全部未来";
  }
  if (option.value === "today") {
    return "今日";
  }
  return `未来 ${option.label}`;
}

function formatTimelineDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function formatGeneratedAt(value: string | undefined): string {
  if (value === undefined) {
    return "等待数据同步";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "等待数据同步";
  }
  return `更新于 ${new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date)}`;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function formatRelevance(value: Relevance): string {
  if (value === "strong") {
    return "强相关";
  }
  if (value === "possible") {
    return "可能相关";
  }
  return "无关";
}

function formatActivityType(value: ActivityType): string {
  if (value === "summer_camp") {
    return "夏令营";
  }
  if (value === "pre_recommendation") {
    return "预推免";
  }
  return "未标注";
}

function readInitialTheme(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") {
      return stored;
    }
  } catch {
    // Fall back to system preference below.
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readStoredMainTab(): MainTab {
  try {
    const value = window.localStorage.getItem(MAIN_TAB_STORAGE_KEY);
    if (value === "ddl" || value === "applications" || value === "calendar") {
      return value;
    }
  } catch {
    // Fall through to the default tab.
  }
  return "ddl";
}

function readFiltersFromUrl(): {
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

function writeFiltersToUrl(filters: {
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

function matchesMobileViewport(): boolean {
  return window.matchMedia?.(MOBILE_VIEW_MEDIA_QUERY).matches ?? false;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia?.(query).matches ?? false);

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const update = (): void => setMatches(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, [query]);

  return matches;
}

function getViewStorageKey(kind: "ddl" | "application", mobile: boolean): string {
  if (kind === "application") {
    return mobile ? APPLICATION_VIEW_MOBILE_STORAGE_KEY : APPLICATION_VIEW_DESKTOP_STORAGE_KEY;
  }
  return mobile ? DDL_VIEW_MOBILE_STORAGE_KEY : DDL_VIEW_DESKTOP_STORAGE_KEY;
}

function readStoredViewMode(kind: "ddl" | "application", mobile: boolean): ViewMode {
  try {
    const value = window.localStorage.getItem(getViewStorageKey(kind, mobile));
    if (value === "cards" || value === "table") {
      return value;
    }
  } catch {
    // Use the responsive default when browser storage is unavailable.
  }
  return mobile ? "cards" : "table";
}

function persistViewMode(kind: "ddl" | "application", mobile: boolean, value: ViewMode): void {
  try {
    window.localStorage.setItem(getViewStorageKey(kind, mobile), value);
  } catch {
    // The in-memory view selection still works for this session.
  }
}

function getItemAreas(item: DdlItem): AreaFilter[] {
  const areas = (Array.isArray(item.areas) ? item.areas : []).filter((area): area is AreaFilter =>
    AREA_OPTIONS.includes(area as AreaFilter)
  );
  return areas.length === 0 ? ["其他"] : areas;
}

function useStoredKeySet(key: string): [Set<string>, (value: string) => void] {
  const [values, setValues] = useState<Set<string>>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return new Set(raw === null ? [] : (JSON.parse(raw) as string[]));
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify([...values]));
    } catch {
      // Keep the in-memory state when browser storage is unavailable.
    }
  }, [key, values]);

  function toggle(value: string): void {
    setValues((previous) => {
      const next = new Set(previous);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  }

  return [values, toggle];
}

function useApplicationTracker(): [
  ApplicationTrackerData,
  React.Dispatch<React.SetStateAction<ApplicationTrackerData>>,
  ApplicationStorageIssue | null,
  () => void
] {
  const [initialState] = useState((): {
    data: ApplicationTrackerData;
    issue: ApplicationStorageIssue | null;
  } => {
    let raw = "";
    try {
      raw = window.localStorage.getItem(APPLICATION_TRACKER_STORAGE_KEY) ?? "";
      if (raw === "") {
        return { data: createEmptyTrackerData(), issue: null };
      }
      const parsed = JSON.parse(raw) as unknown;
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("schema" in parsed) ||
        parsed.schema !== APPLICATION_TRACKER_SCHEMA ||
        !("records" in parsed) ||
        !Array.isArray(parsed.records)
      ) {
        throw new Error("数据格式或版本不受支持");
      }
      return { data: normalizeTrackerData(parsed), issue: null };
    } catch (error) {
      return {
        data: createEmptyTrackerData(),
        issue: {
          message: error instanceof Error ? error.message : "本地数据解析失败",
          rawValue: raw
        }
      };
    }
  });
  const [data, setData] = useState<ApplicationTrackerData>(initialState.data);
  const [storageIssue, setStorageIssue] = useState<ApplicationStorageIssue | null>(initialState.issue);

  useEffect(() => {
    if (storageIssue !== null) {
      return;
    }
    try {
      window.localStorage.setItem(APPLICATION_TRACKER_STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      setStorageIssue({
        message: error instanceof Error ? error.message : "浏览器拒绝写入本地数据",
        rawValue: JSON.stringify(data)
      });
    }
  }, [data, storageIssue]);

  function resetStorage(): void {
    const empty = createEmptyTrackerData();
    try {
      window.localStorage.setItem(APPLICATION_TRACKER_STORAGE_KEY, JSON.stringify(empty));
      setData(empty);
      setStorageIssue(null);
    } catch (error) {
      setStorageIssue({
        message: error instanceof Error ? error.message : "浏览器拒绝重置本地数据",
        rawValue: storageIssue?.rawValue ?? ""
      });
    }
  }

  return [data, setData, storageIssue, resetStorage];
}

function readStoredApplicationData(): ApplicationTrackerData {
  try {
    const raw = window.localStorage.getItem(APPLICATION_TRACKER_STORAGE_KEY);
    return raw === null ? createEmptyTrackerData() : normalizeTrackerData(JSON.parse(raw));
  } catch {
    return createEmptyTrackerData();
  }
}

function persistApplicationData(data: ApplicationTrackerData): void {
  window.localStorage.setItem(APPLICATION_TRACKER_STORAGE_KEY, JSON.stringify(data));
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

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("缺少 root 节点");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
