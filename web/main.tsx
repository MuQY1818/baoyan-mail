import { ChevronDown, RotateCcw, Search, SlidersHorizontal, X } from "lucide-react";
import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
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
  hydrateApplicationRecordLinks,
  normalizeTrackerData,
  parseApplicationPatch,
  removeApplicationRecord,
  updateApplicationRecord,
  type ApplicationRecord,
  type ApplicationTrackerData
} from "./applicationTracker";
import { AnalyticsPanel } from "./components/AnalyticsPanel";
import { ApiHint } from "./components/ApiHint";
import { AppHeader, MobileNavigation } from "./components/AppHeader";
import { DdlActiveFilters } from "./components/DdlActiveFilters";
import { DdlResults } from "./components/DdlResults";
import { DdlSkeleton } from "./components/DdlSkeleton";
import { ThemeToggle } from "./components/ThemeToggle";
import { Timeline } from "./components/Timeline";
import { ApplicationCalendar } from "./components/applications/ApplicationCalendar";
import { ApplicationWorkspace } from "./components/applications/ApplicationWorkspace";
import { FilterSegment, StateMessage, ViewSwitcher } from "./components/controls";
import {
  ACTIVITY_TYPE_OPTIONS,
  AREA_OPTIONS,
  FAVORITE_STORAGE_KEY,
  MAIN_TAB_STORAGE_KEY,
  MOBILE_VIEW_MEDIA_QUERY,
  RANGE_OPTIONS,
  READ_STORAGE_KEY,
  RECENT_OPTIONS,
  RELEVANCE_OPTIONS,
  SOURCE_OPTIONS,
  THEME_STORAGE_KEY,
  TIER_OPTIONS
} from "./constants";
import { useApplicationTracker } from "./hooks/useApplicationTracker";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { useStoredKeySet } from "./hooks/useStoredKeySet";
import type {
  ActivityTypeFilter,
  AnalyticsSummary,
  AreaFilter,
  BaoyanAgentApi,
  DdlItem,
  DdlResponse,
  MainTab,
  RangeFilter,
  RecentFilter,
  RelevanceFilter,
  SourceFilter,
  ThemeMode,
  TierFilter,
  ViewMode
} from "./types";
import { sendDailyVisitPing } from "./utils/analytics";
import { persistApplicationData, readStoredApplicationData } from "./utils/applicationStorage";
import { formatGeneratedAt } from "./utils/datetime";
import {
  buildActivityTypeStats,
  buildStats,
  buildTimeline,
  filterItems,
  getAdvancedFilterCount,
  getDdlActiveFilterCount
} from "./utils/ddl";
import { persistViewMode, readInitialTheme, readStoredViewMode } from "./utils/storage";
import { readFiltersFromUrl, writeFiltersToUrl } from "./utils/urlFilters";
import "./styles.css";

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
  // 搜索词延迟参与过滤，避免每敲一键就同步重渲染整列卡片和时间线
  const deferredQuery = useDeferredValue(query);
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
  const analyticsSectionRef = useRef<HTMLDivElement>(null);
  const previousMobileViewport = useRef(isMobileViewport);

  useEffect(() => {
    let ignore = false;
    async function loadData(): Promise<void> {
      try {
        const currentResponse = await fetch("/api/ddl");
        if (!currentResponse.ok) {
          throw new Error(`数据接口返回 ${currentResponse.status}`);
        }
        const body = (await currentResponse.json()) as DdlResponse;
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

    // 归档数据体积大且只用于回填本地申请缺失的官方链接，不门控首屏；
    // 本地没有缺链接的申请记录时直接跳过这次请求。
    async function loadArchivalData(): Promise<void> {
      const needsHydration = readStoredApplicationData().records.some(
        (record) => record.website.trim() === ""
      );
      if (!needsHydration) {
        return;
      }
      try {
        const archivalResponse = await fetch("/api/ddl?includeExpired=1");
        if (!archivalResponse.ok) {
          return;
        }
        const archivalBody = (await archivalResponse.json()) as DdlResponse;
        if (!ignore) {
          setArchivalData(archivalBody);
        }
      } catch {
        // 回填失败不影响页面主体数据
      }
    }

    void loadData();
    void loadArchivalData();
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

    // 统计面板在页脚，接近视口时再拉取，避免占用首屏请求
    const target = analyticsSectionRef.current;
    if (target === null || typeof IntersectionObserver === "undefined") {
      void loadAnalytics();
      return () => {
        ignore = true;
      };
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          void loadAnalytics();
        }
      },
      { rootMargin: "240px" }
    );
    observer.observe(target);
    return () => {
      ignore = true;
      observer.disconnect();
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
        deferredQuery,
        range,
        source,
        relevance,
        activityType,
        activeTiers,
        activeAreas,
        recent
      ),
    [activeAreas, activeTiers, activityType, deferredQuery, futureItems, range, recent, relevance, source]
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
  const timelineStops = useMemo(() => buildTimeline(visibleItems), [visibleItems]);

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

  const openApplication = useCallback((recordId: string): void => {
    setMainTab("applications");
    setActiveApplicationId(recordId);
  }, []);

  const addApplication = useCallback(
    (item: DdlItem): void => {
      const existing = applicationData.records.find((record) => record.sourceDdlKey === item.key);
      if (existing !== undefined) {
        openApplication(existing.id);
        return;
      }
      const record = createApplicationRecord(item);
      setApplicationData((current) => addOrReplaceApplicationRecord(current, record));
      openApplication(record.id);
    },
    [applicationData.records, openApplication, setApplicationData]
  );

  const openApplicationForItem = useCallback(
    (item: DdlItem): void => {
      const record = applicationData.records.find((entry) => entry.sourceDdlKey === item.key);
      if (record !== undefined) {
        openApplication(record.id);
      }
    },
    [applicationData.records, openApplication]
  );

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
                  onOpenApplication={openApplicationForItem}
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
        <div ref={analyticsSectionRef}>
          <AnalyticsPanel summary={analytics} theme={theme} />
        </div>
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

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("缺少 root 节点");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
