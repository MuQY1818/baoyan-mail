import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
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
  normalizeTrackerData,
  parseApplicationPatch,
  previewApplicationPatch,
  removeApplicationRecord,
  updateApplicationRecord,
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

// three.js 较重,地球场景按需懒加载:仅当访问统计滚入可视区时才下载并挂载
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

interface TimelineEntry {
  key: string;
  school: string;
  institute: string;
  tier: TierFilter;
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
const RANGE_WIDTH: Record<RangeFilter, number> = {
  today: 0,
  "3": 1,
  "7": 2,
  "15": 3,
  future: 4
};
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
const API_URL = "https://baoyan-mail.weijuebu.workers.dev/api/ddl";
const LLMS_TXT_URL = "/llms.txt";
const ANALYTICS_VISIT_STORAGE_KEY = "baoyan-ddl-visit-date";
const RECENT_DAYS = 7;
const FAVORITE_STORAGE_KEY = "baoyan-ddl-favorites";
const READ_STORAGE_KEY = "baoyan-ddl-read";
const THEME_STORAGE_KEY = "baoyan-ddl-theme";
const MAIN_TAB_STORAGE_KEY = "baoyan-main-tab";
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

interface RailBucket {
  label: string;
  tone: "normal" | "danger";
  minRange: RangeFilter;
  matches: (remainingDays: number) => boolean;
}

const RAIL_BUCKETS: RailBucket[] = [
  { label: "今日", tone: "danger", minRange: "today", matches: (d) => d <= 0 },
  { label: "3 天", tone: "normal", minRange: "3", matches: (d) => d > 0 && d <= 3 },
  { label: "7 天", tone: "normal", minRange: "7", matches: (d) => d > 3 && d <= 7 },
  { label: "15 天", tone: "normal", minRange: "15", matches: (d) => d > 7 && d <= 15 },
  { label: "更远", tone: "normal", minRange: "future", matches: (d) => d > 15 }
];

function App(): React.ReactElement {
  const initialFilters = useMemo(readFiltersFromUrl, []);
  const [theme, setTheme] = useState<ThemeMode>(readInitialTheme);
  const [data, setData] = useState<DdlResponse | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState(initialFilters.query);
  const [range, setRange] = useState<RangeFilter>(initialFilters.range);
  const [source, setSource] = useState<SourceFilter>(initialFilters.source);
  const [relevance, setRelevance] = useState<RelevanceFilter>(initialFilters.relevance);
  const [recent, setRecent] = useState<RecentFilter>(initialFilters.recent);
  const [viewMode, setViewMode] = useState<ViewMode>(initialFilters.viewMode);
  const [mainTab, setMainTab] = useState<MainTab>(readInitialMainTab);
  const [activeApplicationId, setActiveApplicationId] = useState<string | null>(null);
  const [activeTiers, setActiveTiers] = useState<Set<TierFilter>>(initialFilters.tiers);
  const [activeAreas, setActiveAreas] = useState<Set<AreaFilter>>(initialFilters.areas);
  const [favorites, toggleFavorite] = useStoredKeySet(FAVORITE_STORAGE_KEY);
  const [readItems, toggleReadItem] = useStoredKeySet(READ_STORAGE_KEY);
  const [applicationData, setApplicationData] = useApplicationTracker();
  const scrollTargetRef = useRef<string | null>(null);
  const [scrollNonce, setScrollNonce] = useState(0);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    async function loadData(): Promise<void> {
      try {
        const response = await fetch("/api/ddl");
        if (!response.ok) {
          throw new Error(`数据接口返回 ${response.status}`);
        }
        const body = (await response.json()) as DdlResponse;
        if (!ignore) {
          setData(body);
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
      viewMode
    });
  }, [activeAreas, activeTiers, query, range, recent, relevance, source, viewMode]);

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
        new Set(TIER_OPTIONS),
        new Set(),
        "all"
      ),
    [futureItems, relevance]
  );
  const visibleItems = useMemo(
    () =>
      filterItems(
        futureItems,
        query,
        range,
        source,
        relevance,
        activeTiers,
        activeAreas,
        recent
      ),
    [activeAreas, activeTiers, futureItems, query, range, recent, relevance, source]
  );
  const stats = useMemo(() => buildStats(relevanceScopedItems), [relevanceScopedItems]);
  const applicationSourceKeys = useMemo(
    () => new Set(applicationData.records.map((record) => record.sourceDdlKey).filter((key) => key !== "")),
    [applicationData.records]
  );
  const applicationCount = applicationData.records.length;
  // 概览计数与跳转候选用同一套筛选（忽略范围），保证点击后一定能找到目标卡片
  const railCounts = useMemo(() => {
    const scoped = filterItems(
      futureItems,
      query,
      "future",
      source,
      relevance,
      activeTiers,
      activeAreas,
      recent
    );
    return RAIL_BUCKETS.map(
      (bucket) => scoped.filter((item) => bucket.matches(item.remainingDays)).length
    );
  }, [activeAreas, activeTiers, futureItems, query, recent, relevance, source]);
  const timelineStops = useMemo(
    () =>
      buildTimeline(
        filterItems(futureItems, query, range, source, relevance, activeTiers, activeAreas, recent)
      ),
    [activeAreas, activeTiers, futureItems, query, range, recent, relevance, source]
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

  function jumpToBucket(bucket: RailBucket): void {
    const candidates = filterItems(
      futureItems,
      query,
      "future",
      source,
      relevance,
      activeTiers,
      activeAreas,
      recent
    );
    const target = candidates.find((item) => bucket.matches(item.remainingDays));
    if (target === undefined) {
      return;
    }
    // 仅在当前范围过窄时放宽，避免把用户已选的更宽范围改窄
    if (RANGE_WIDTH[range] < RANGE_WIDTH[bucket.minRange]) {
      setRange(bucket.minRange);
    }
    scrollTargetRef.current = target.key;
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
    setRecent("all");
    setViewMode("cards");
    setActiveTiers(new Set(TIER_OPTIONS));
    setActiveAreas(new Set());
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
    <main className="shell">
      <ThemeToggle theme={theme} onToggle={toggleTheme} />

      <section className="hero" aria-labelledby="page-title">
        <div className="hero-copy">
          <p className="eyebrow">CS BAOYAN DEADLINES</p>
          <h1 id="page-title">保研 DDL 速查</h1>
          <p className="hero-text">
            默认展示 AI 判定的计算机类强相关 DDL，可切换查看可能相关和源站全量。
          </p>
        </div>
        <div className="hero-actions">
          <span className="updated">{formatGeneratedAt(data?.lastSyncedAt ?? data?.generatedAt)}</span>
        </div>
      </section>

      <MainTabs
        activeTab={mainTab}
        applicationCount={applicationCount}
        ddlCount={relevanceScopedItems.length}
        onSelect={setMainTab}
      />

      {mainTab === "ddl" && (
        <>
          <Timeline range={range} stops={timelineStops} loading={isLoading} />

          <section className="dashboard" aria-label="DDL 查询工具">
            <aside className="rail" aria-label="截止时间概览">
              <span className="rail-label">截止概览</span>
              {RAIL_BUCKETS.map((bucket, index) => {
                const count = railCounts[index] ?? 0;
                return (
                  <RailMarker
                    count={count}
                    key={bucket.label}
                    label={bucket.label}
                    onJump={count > 0 ? () => jumpToBucket(bucket) : undefined}
                    tone={bucket.tone}
                  />
                );
              })}
            </aside>

            <div className="workbench">
              <section className="toolbar" aria-label="筛选条件">
                <label className="search-field">
                  <span>搜索学校或院系</span>
                  <input
                    value={query}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                      setQuery(event.currentTarget.value)
                    }
                    placeholder="例如 浙江大学 / 网络空间安全"
                    type="search"
                  />
                </label>

                <div className="control-block">
                  <div className="control-label">相关度</div>
                  <div className="control-row" aria-label="相关度筛选">
                    {RELEVANCE_OPTIONS.map((option) => (
                      <button
                        className={relevance === option.value ? "chip relevance-chip chip-active" : "chip relevance-chip"}
                        key={option.value}
                        onClick={() => setRelevance(option.value)}
                        type="button"
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="control-row" aria-label="时间范围">
                  {RANGE_OPTIONS.map((option) => (
                    <button
                      className={range === option.value ? "chip chip-active" : "chip"}
                      key={option.value}
                      onClick={() => setRange(option.value)}
                      type="button"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

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

                <div className="control-block">
                  <div className="control-label">方向</div>
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
                  <span>来源</span>
                  <select
                    value={source}
                    onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
                      setSource(event.currentTarget.value as SourceFilter)
                    }
                  >
                    {SOURCE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="control-row" aria-label="最近状态">
                  {RECENT_OPTIONS.map((option) => (
                    <button
                      className={recent === option.value ? "chip chip-active" : "chip"}
                      key={option.value}
                      onClick={() => setRecent(option.value)}
                      type="button"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <div className="control-row" aria-label="视图模式">
                  <button
                    className={viewMode === "cards" ? "chip chip-active" : "chip"}
                    onClick={() => setViewMode("cards")}
                    type="button"
                  >
                    卡片
                  </button>
                  <button
                    className={viewMode === "table" ? "chip chip-active" : "chip"}
                    onClick={() => setViewMode("table")}
                    type="button"
                  >
                    表格
                  </button>
                </div>
              </section>

              <section className="summary-strip" aria-label="数据概览">
                <SummaryCell label="未截止" value={relevanceScopedItems.length} />
                <SummaryCell label="今日截止" value={stats.today} />
                <SummaryCell label="15 天内" value={stats.fifteenDays} />
                <SummaryCell label="当前显示" value={visibleItems.length} />
              </section>

              {isLoading ? (
                <DdlSkeleton />
              ) : error !== null ? (
                <StateMessage title="数据加载失败" message={error} />
              ) : visibleItems.length === 0 ? (
                <StateMessage
                  title="当前筛选没有结果"
                  message="放宽时间范围、学校层次或搜索词后再试。"
                  actionLabel="重置筛选"
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
            </div>
          </section>
        </>
      )}

      {mainTab === "applications" && (
        <ApplicationWorkspace
          activeRecordId={activeApplicationId}
          data={applicationData}
          onRemoveRecord={removeApplication}
          onReplaceData={replaceApplicationData}
          onSelectRecord={setActiveApplicationId}
          onUpdateRecord={updateApplication}
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
  const tabs: Array<{ value: MainTab; label: string; count: number; hint: string }> = [
    { value: "ddl", label: "DDL 列表", count: ddlCount, hint: "发现通知" },
    { value: "applications", label: "我的申请", count: applicationCount, hint: "本地记录" },
    { value: "calendar", label: "日历", count: applicationCount, hint: "关键日期" }
  ];
  return (
    <nav className="main-tabs" aria-label="平台功能">
      {tabs.map((tab) => (
        <button
          className={activeTab === tab.value ? "main-tab main-tab-active" : "main-tab"}
          key={tab.value}
          onClick={() => onSelect(tab.value)}
          type="button"
        >
          <span>{tab.label}</span>
          <strong>{tab.count}</strong>
          <em>{tab.hint}</em>
        </button>
      ))}
    </nav>
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
        <span className="api-hint-badge">LLM / Agent</span>
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
          {copied ? "已复制" : "复制接口地址"}
        </button>
        <a className="api-hint-open" href={API_URL} rel="noreferrer" target="_blank">
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
  const countries = summary?.countries ?? [];
  const topCountries = countries.slice(0, 6);
  const topRegions = summary?.regions.slice(0, 5) ?? [];
  const maxVisits = Math.max(1, ...countries.map((country) => country.visitCount));
  return (
    <section className="analytics-panel" aria-label="访问统计">
      <div className="analytics-head">
        <div className="analytics-copy">
          <span className="analytics-eyebrow">VISIT ATLAS</span>
          <h2>匿名访问统计</h2>
          <p>按浏览器每日一次计数，只保存日期和地区，不保存 IP、邮箱或浏览器指纹。</p>
        </div>
        <div className="analytics-metrics">
          <Metric label="近 30 天访问" value={summary?.totalVisits ?? 0} />
          <Metric label="今日访问" value={summary?.todayVisits ?? 0} />
          <Metric label="国家或地区" value={summary?.countryCount ?? 0} />
          <Metric label="细分地区" value={summary?.regionCount ?? 0} />
        </div>
      </div>

      <div className="analytics-board">
        <VisitGlobe countries={countries} maxVisits={maxVisits} theme={theme} />

        <div className="analytics-rank-card" aria-label="访问地区排行">
          <div className="rank-section">
            <strong className="analytics-list-title">Top 国家或地区</strong>
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
            <strong className="analytics-list-title">Top 细分地区</strong>
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
    </section>
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
  const hostRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const leader = countries[0];

  // 滚入可视区才挂载地球,避免页面底部的 three.js 拖累首屏
  useEffect(() => {
    const el = hostRef.current;
    if (el === null) {
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="visit-globe-card" aria-label="世界访问热度">
      <div className="visit-globe-stage" ref={hostRef}>
        {inView ? (
          <Suspense fallback={<GlobeFallback />}>
            <GlobeScene countries={countries} maxVisits={maxVisits} theme={theme} />
          </Suspense>
        ) : (
          <GlobeFallback />
        )}
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
      <span className="theme-float-icon" aria-hidden="true" />
      <span className="theme-float-tooltip" aria-hidden="true">换主题</span>
    </button>
  );
}

function ApplicationWorkspace({
  activeRecordId,
  data,
  onRemoveRecord,
  onReplaceData,
  onSelectRecord,
  onUpdateRecord
}: {
  activeRecordId: string | null;
  data: ApplicationTrackerData;
  onRemoveRecord: (id: string) => void;
  onReplaceData: (data: ApplicationTrackerData) => void;
  onSelectRecord: (id: string) => void;
  onUpdateRecord: (id: string, values: Partial<ApplicationRecord>) => void;
}): React.ReactElement {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ApplicationStatus | "all">("all");
  const [priority, setPriority] = useState<ApplicationPriority | "all">("all");
  const [result, setResult] = useState<ApplicationResult | "all">("all");
  const [range, setRange] = useState<ApplicationRangeFilter>("all");
  const [viewMode, setViewMode] = useState<ApplicationViewMode>("table");
  const [agentOpen, setAgentOpen] = useState(false);
  const records = useMemo(
    () => filterApplicationRecords(data.records, { priority, query, range, result, status }),
    [data.records, priority, query, range, result, status]
  );
  const stats = useMemo(() => buildApplicationStats(data.records), [data.records]);
  const activeRecord = data.records.find((record) => record.id === activeRecordId) ?? records[0] ?? null;

  return (
    <section className="application-shell" aria-label="我的申请">
      <div className="application-head">
        <div>
          <span className="section-kicker">APPLICATION DESK</span>
          <h2>我的申请</h2>
          <p>投递状态、材料进度和面试日程只保存在当前浏览器。</p>
        </div>
        <div className="application-head-actions">
          <button className="chip" onClick={() => setAgentOpen((value) => !value)} type="button">
            Agent 数据
          </button>
          <span className="local-badge">本地存储</span>
        </div>
      </div>

      <section className="application-metrics" aria-label="申请概览">
        <SummaryCell label="关注中" value={stats.watching} />
        <SummaryCell label="准备中" value={stats.preparing} />
        <SummaryCell label="已投递" value={stats.submitted} />
        <SummaryCell label="待结果" value={stats.waitingResult} />
        <SummaryCell label="已录取" value={stats.admitted} />
      </section>

      {agentOpen && <AgentDataPanel data={data} onReplaceData={onReplaceData} />}

      <section className="application-toolbar" aria-label="申请筛选">
        <label className="search-field">
          <span>搜索申请</span>
          <input
            value={query}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.currentTarget.value)}
            placeholder="学校、院系、备注"
            type="search"
          />
        </label>
        <label className="select-field">
          <span>状态</span>
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
          <span>结果</span>
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
        <div className="control-row application-range" aria-label="截止范围">
          {APPLICATION_RANGE_OPTIONS.map((option) => (
            <button
              className={range === option.value ? "chip chip-active" : "chip"}
              key={option.value}
              onClick={() => setRange(option.value)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="control-row" aria-label="申请视图">
          <button
            className={viewMode === "table" ? "chip chip-active" : "chip"}
            onClick={() => setViewMode("table")}
            type="button"
          >
            表格
          </button>
          <button
            className={viewMode === "cards" ? "chip chip-active" : "chip"}
            onClick={() => setViewMode("cards")}
            type="button"
          >
            卡片
          </button>
        </div>
      </section>

      <div className="application-grid">
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
          record={activeRecord}
          onRemoveRecord={onRemoveRecord}
          onUpdateRecord={onUpdateRecord}
        />
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
              </td>
              <td><span className={`status-pill status-${record.status}`}>{formatApplicationStatus(record.status)}</span></td>
              <td>{formatPriority(record.priority)}</td>
              <td>{formatMaterialProgress(record.materials)}</td>
              <td>{formatResult(record.result)}</td>
              <td>
                <div className="table-actions">
                  <button onClick={() => onChooseRecord(record.id)} type="button">
                    编辑
                  </button>
                  {record.website !== "" && (
                    <a href={record.website} rel="noreferrer" target="_blank">
                      原文
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
  onRemoveRecord,
  onUpdateRecord,
  record
}: {
  onRemoveRecord: (id: string) => void;
  onUpdateRecord: (id: string, values: Partial<ApplicationRecord>) => void;
  record: ApplicationRecord | null;
}): React.ReactElement {
  const [newEventType, setNewEventType] = useState<ApplicationEventType>("interview");
  const [newEventTitle, setNewEventTitle] = useState("");
  const [newEventDate, setNewEventDate] = useState("");
  const [newEventNote, setNewEventNote] = useState("");

  useEffect(() => {
    setNewEventType("interview");
    setNewEventTitle("");
    setNewEventDate("");
    setNewEventNote("");
  }, [record?.id]);

  if (record === null) {
    return (
      <aside className="application-editor application-editor-empty">
        <h3>申请详情</h3>
        <p>从左侧选择一条申请后编辑状态、材料和日程。</p>
      </aside>
    );
  }
  const activeRecord = record;

  function updateMaterial(material: ApplicationMaterial, status: MaterialStatus): void {
    onUpdateRecord(activeRecord.id, {
      materials: activeRecord.materials.map((entry) =>
        entry.id === material.id ? { ...entry, status } : entry
      )
    });
  }

  function removeEvent(eventId: string): void {
    onUpdateRecord(activeRecord.id, {
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
      date: newEventDate,
      note: newEventNote.trim()
    };
    onUpdateRecord(activeRecord.id, { events: [...activeRecord.events, event] });
    setNewEventTitle("");
    setNewEventDate("");
    setNewEventNote("");
  }

  return (
    <aside className="application-editor" aria-label="申请详情">
      <div className="editor-head">
        <div>
          <span className="section-kicker">DETAIL</span>
          <h3>{record.school}</h3>
          <p>{record.institute || "未提供院系"}</p>
        </div>
        <span className="tier-badge">{record.tier}</span>
      </div>

      <div className="editor-fields">
        <label className="select-field">
          <span>状态</span>
          <select
            value={record.status}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
              onUpdateRecord(record.id, { status: event.currentTarget.value as ApplicationStatus })
            }
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="select-field">
          <span>优先级</span>
          <select
            value={record.priority}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
              onUpdateRecord(record.id, { priority: event.currentTarget.value as ApplicationPriority })
            }
          >
            {PRIORITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="select-field">
          <span>结果</span>
          <select
            value={record.result}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
              onUpdateRecord(record.id, { result: event.currentTarget.value as ApplicationResult })
            }
          >
            {RESULT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      <section className="material-panel" aria-label="材料进度">
        <h4>材料进度</h4>
        <div className="material-list">
          {record.materials.map((material) => (
            <div className="material-row" key={material.id}>
              <span>{material.label}</span>
              <div className="material-actions">
                <button
                  className={material.status === "todo" ? "material-chip material-chip-active" : "material-chip"}
                  onClick={() => updateMaterial(material, "todo")}
                  type="button"
                >
                  待办
                </button>
                <button
                  className={material.status === "done" ? "material-chip material-chip-active" : "material-chip"}
                  onClick={() => updateMaterial(material, "done")}
                  type="button"
                >
                  完成
                </button>
                <button
                  className={material.status === "not_required" ? "material-chip material-chip-active" : "material-chip"}
                  onClick={() => updateMaterial(material, "not_required")}
                  type="button"
                >
                  不需要
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="events-panel" aria-label="关键日程">
        <h4>关键日程</h4>
        <div className="event-list">
          {record.events.length === 0 ? (
            <p className="empty-hint">暂无日程。</p>
          ) : (
            record.events
              .slice()
              .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
              .map((event) => (
                <div className="event-row" key={event.id}>
                  <span className={`event-type event-${event.type}`}>{formatEventType(event.type)}</span>
                  <div>
                    <strong>{event.title}</strong>
                    <span>{formatEventDate(event.date)}{event.note === "" ? "" : ` · ${event.note}`}</span>
                  </div>
                  <button onClick={() => removeEvent(event.id)} type="button">删除</button>
                </div>
              ))
          )}
        </div>
        <div className="event-form">
          <select
            value={newEventType}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
              setNewEventType(event.currentTarget.value as ApplicationEventType)
            }
          >
            {EVENT_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <input
            value={newEventTitle}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setNewEventTitle(event.currentTarget.value)}
            placeholder="日程名称"
            type="text"
          />
          <input
            value={newEventDate}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setNewEventDate(event.currentTarget.value)}
            type="datetime-local"
          />
          <input
            value={newEventNote}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setNewEventNote(event.currentTarget.value)}
            placeholder="备注"
            type="text"
          />
          <button className="chip chip-active" onClick={addEvent} type="button">
            添加
          </button>
        </div>
      </section>

      <label className="notes-field">
        <span>备注</span>
        <textarea
          value={record.notes}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
            onUpdateRecord(record.id, { notes: event.currentTarget.value })
          }
          placeholder="记录导师、材料要求、面试准备、结果等。"
          rows={5}
        />
      </label>

      <div className="editor-actions">
        {record.website !== "" && (
          <a className="source-link" href={record.website} rel="noreferrer" target="_blank">
            原始通知
          </a>
        )}
        <button className="danger-action" onClick={() => onRemoveRecord(record.id)} type="button">
          删除申请
        </button>
      </div>
    </aside>
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
              {copied ? "已复制" : "复制 JSON"}
            </button>
          </div>
          <textarea readOnly rows={9} value={exportJson} />
        </div>
        <div className="agent-box">
          <div className="agent-box-head">
            <strong>导入 Patch</strong>
            <button className="icon-action" onClick={buildPreview} type="button">
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
      <div className="application-head">
        <div>
          <span className="section-kicker">CALENDAR</span>
          <h2>申请日历</h2>
          <p>只展示已加入“我的申请”的 DDL、面试、开营、结果和补材料日程。</p>
        </div>
        <div className="calendar-actions">
          <button className="chip" onClick={() => setMonthOffset((value) => value - 1)} type="button">
            上月
          </button>
          <button className="chip chip-active" onClick={() => setMonthOffset(0)} type="button">
            本月
          </button>
          <button className="chip" onClick={() => setMonthOffset((value) => value + 1)} type="button">
            下月
          </button>
        </div>
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
                      className={event.record.id === activeRecordId ? "day-event day-event-active" : "day-event"}
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
                    <em>{formatEventDate(event.date)}</em>
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
            <h2>{item.school}</h2>
            <p>{item.institute || "未提供院系"}</p>
          </div>
          <span className="tier-badge">{item.tier}</span>
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
            查看原始通知
          </a>
          <button className="icon-action" onClick={onToggleFavorite} type="button">
            {favorite ? "已收藏" : "收藏"}
          </button>
          <button className="icon-action" onClick={onToggleRead} type="button">
            {read ? "未读" : "已读"}
          </button>
          <button
            className={addedToApplications ? "icon-action application-action application-action-added" : "icon-action application-action"}
            onClick={addedToApplications ? onOpenApplication : onAddApplication}
            type="button"
          >
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
  items,
  onAddApplication,
  onOpenApplication,
  onToggleFavorite,
  onToggleRead,
  readItems
}: {
  applicationSourceKeys: Set<string>;
  favorites: Set<string>;
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
            <th>学校</th>
            <th>院系</th>
            <th>DDL</th>
            <th>层次</th>
            <th>相关度</th>
            <th>方向</th>
            <th>来源</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr className={readItems.has(item.key) ? "table-row-read" : ""} key={item.key}>
              <td>{item.school}</td>
              <td>{item.institute || "未提供院系"}</td>
              <td>
                <strong>{item.remainingText}</strong>
                <span>{item.deadlineText}</span>
              </td>
              <td>{item.tier}</td>
              <td>
                <span className={`table-relevance relevance-${item.relevance}`}>
                  {formatRelevance(item.relevance)}
                </span>
              </td>
              <td>
                <div className="table-area-list">
                  {getItemAreas(item).map((area) => (
                    <span className={`table-area ${getAreaClass(area)}`} key={area}>{area}</span>
                  ))}
                </div>
              </td>
              <td>{item.sourceLabel}</td>
              <td>
                <div className="table-actions">
                  <a href={item.website} rel="noreferrer" target="_blank">
                    原文
                  </a>
                  <button onClick={() => onToggleFavorite(item.key)} type="button">
                    {favorites.has(item.key) ? "已藏" : "收藏"}
                  </button>
                  <button onClick={() => onToggleRead(item.key)} type="button">
                    {readItems.has(item.key) ? "未读" : "已读"}
                  </button>
                  <button
                    onClick={() =>
                      applicationSourceKeys.has(item.key) ? onOpenApplication(item) : onAddApplication(item)
                    }
                    type="button"
                  >
                    {applicationSourceKeys.has(item.key) ? "申请" : "加入"}
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

function RailMarker({
  count,
  label,
  onJump,
  tone = "normal"
}: {
  count: number;
  label: string;
  onJump?: (() => void) | undefined;
  tone?: "normal" | "danger";
}): React.ReactElement {
  const className = tone === "danger" ? "rail-marker rail-marker-danger" : "rail-marker";
  if (onJump === undefined) {
    return (
      <div className={`${className} rail-marker-empty`}>
        <span>{label}</span>
        <strong>{count}</strong>
      </div>
    );
  }
  return (
    <button
      className={`${className} rail-marker-link`}
      onClick={onJump}
      title={`跳转到最近的「${label}」截止`}
      type="button"
    >
      <span>{label}</span>
      <strong>{count}</strong>
    </button>
  );
}

function SummaryCell({ label, value }: { label: string; value: number }): React.ReactElement {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function Timeline({
  loading,
  range,
  stops
}: {
  loading: boolean;
  range: RangeFilter;
  stops: TimelineStop[];
}): React.ReactElement | null {
  const [expandedStops, setExpandedStops] = useState<Set<number>>(new Set());
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
      {stops.length === 0 ? (
        <p className="timeline-empty">{rangeLabel}暂无符合条件的截止。</p>
      ) : (
        <ol className="timeline-track">
          {stops.map((stop) => (
            <TimelineColumn
              expanded={expandedStops.has(stop.remainingDays)}
              key={stop.remainingDays}
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
  onToggleExpanded,
  stop
}: {
  expanded: boolean;
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
      <div className="timeline-when">
        <strong>{stop.dayLabel}</strong>
        <span>{stop.dateLabel}</span>
        <span className="timeline-count">{stop.entries.length} 所</span>
      </div>
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
  admitted: number;
  preparing: number;
  submitted: number;
  waitingResult: number;
  watching: number;
} {
  return {
    watching: records.filter((record) => record.status === "watching").length,
    preparing: records.filter((record) => record.status === "preparing").length,
    submitted: records.filter((record) => record.status === "submitted").length,
    waitingResult: records.filter((record) => record.status === "waiting_result").length,
    admitted: records.filter((record) => record.status === "admitted").length
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

function buildStats(items: DdlItem[]): {
  today: number;
  threeDays: number;
  sevenDays: number;
  fifteenDays: number;
  later: number;
} {
  return {
    today: items.filter((item) => item.remainingDays <= 0).length,
    threeDays: items.filter((item) => item.remainingDays > 0 && item.remainingDays <= 3).length,
    sevenDays: items.filter((item) => item.remainingDays > 3 && item.remainingDays <= 7).length,
    fifteenDays: items.filter((item) => item.remainingDays > 7 && item.remainingDays <= 15).length,
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

function readInitialMainTab(): MainTab {
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
  query: string;
  range: RangeFilter;
  source: SourceFilter;
  relevance: RelevanceFilter;
  recent: RecentFilter;
  viewMode: ViewMode;
  tiers: Set<TierFilter>;
  areas: Set<AreaFilter>;
} {
  const params = new URLSearchParams(window.location.search);
  return {
    query: params.get("q") ?? "",
    range: readOption(params.get("range"), RANGE_OPTIONS.map((option) => option.value), "future"),
    source: readOption(params.get("source"), SOURCE_OPTIONS.map((option) => option.value), "all"),
    relevance: readOption(
      params.get("relevance"),
      RELEVANCE_OPTIONS.map((option) => option.value),
      "strong"
    ),
    recent: readOption(params.get("recent"), RECENT_OPTIONS.map((option) => option.value), "all"),
    viewMode: readOption(params.get("view"), ["cards", "table"], "cards"),
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
  source: SourceFilter;
  viewMode: ViewMode;
}): void {
  const params = new URLSearchParams();
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
  if (filters.recent !== "all") {
    params.set("recent", filters.recent);
  }
  if (filters.viewMode !== "cards") {
    params.set("view", filters.viewMode);
  }
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
    window.localStorage.setItem(key, JSON.stringify([...values]));
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
  React.Dispatch<React.SetStateAction<ApplicationTrackerData>>
] {
  const [data, setData] = useState<ApplicationTrackerData>(() => {
    try {
      const raw = window.localStorage.getItem(APPLICATION_TRACKER_STORAGE_KEY);
      return raw === null ? createEmptyTrackerData() : normalizeTrackerData(JSON.parse(raw));
    } catch {
      return createEmptyTrackerData();
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(APPLICATION_TRACKER_STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Keep the in-memory copy even if the browser refuses storage.
    }
  }, [data]);

  return [data, setData];
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
