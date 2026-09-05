import { ChevronDown, RotateCcw, Search, SlidersHorizontal, X } from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense
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
import { useDdlData } from "./hooks/useDdlData";
import { useDdlFilters } from "./hooks/useDdlFilters";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { useStoredKeySet } from "./hooks/useStoredKeySet";
import type {
  ActivityTypeFilter,
  AnalyticsSummary,
  AreaFilter,
  BaoyanAgentApi,
  DdlItem,
  DdlResponse,
  RangeFilter,
  RecentFilter,
  RelevanceFilter,
  SourceFilter,
  ThemeMode,
  TierFilter,
  ViewMode
} from "./types";
import { sendDailyVisitPing } from "./utils/analytics";
import { readStoredApplicationData } from "./utils/applicationStorage";
import {
  buildActivityTypeStats,
  buildStats,
  buildTimeline,
  filterItems,
  getAdvancedFilterCount,
  getDdlActiveFilterCount
} from "./utils/ddl";
import { persistViewMode, readInitialTheme } from "./utils/storage";
import "./styles.css";

const ApplicationWorkspace = lazy(() => import("./components/applications/ApplicationWorkspace").then((module) => ({ default: module.ApplicationWorkspace })));
const ApplicationCalendar = lazy(() => import("./components/applications/ApplicationCalendar").then((module) => ({ default: module.ApplicationCalendar })));

export function App(): React.ReactElement {
  const isMobileViewport = useMediaQuery(MOBILE_VIEW_MEDIA_QUERY);
  const { query, setQuery, deferredQuery, range, setRange, source, setSource, relevance, setRelevance,
    activityType, setActivityType, recent, setRecent, viewMode, setViewMode, mainTab, setMainTab,
    activeTiers, setActiveTiers, activeAreas, setActiveAreas } = useDdlFilters(isMobileViewport);
  const [theme, setTheme] = useState<ThemeMode>(readInitialTheme);
  const { data, error, isLoading, refresh } = useDdlData();
  const [archivalData, setArchivalData] = useState<DdlResponse | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [activeApplicationId, setActiveApplicationId] = useState<string | null>(null);
  const [favorites, toggleFavorite] = useStoredKeySet(FAVORITE_STORAGE_KEY);
  const [readItems, toggleReadItem] = useStoredKeySet(READ_STORAGE_KEY);
  const [applicationData, setApplicationData, applicationStorageIssue, resetApplicationStorage] =
    useApplicationTracker();
  const scrollTargetRef = useRef<string | null>(null);
  const [scrollNonce, setScrollNonce] = useState(0);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const analyticsSectionRef = useRef<HTMLDivElement>(null);
  const advancedFiltersRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isMobileViewport || !moreFiltersOpen || mainTab !== "ddl") return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    advancedFiltersRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") { event.preventDefault(); setMoreFiltersOpen(false); }
      if (event.key !== "Tab") return;
      const controls = Array.from(advancedFiltersRef.current?.querySelectorAll<HTMLElement>("button, select, input, a[href]") ?? []);
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [isMobileViewport, moreFiltersOpen, mainTab]);

  useEffect(() => {
    let ignore = false;

    // 归档数据体积大且只用于回填本地申请缺失的官方链接，不门控首屏；
    // 本地没有缺链接的申请记录时直接跳过这次请求。
    async function loadArchivalData(): Promise<void> {
      try {
        const needsHydration = readStoredApplicationData().records.some((record) => record.website.trim() === "");
        if (!needsHydration) return;
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
  const stats = useMemo(() => buildStats(visibleItems), [visibleItems]);
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
      if (setApplicationData((current) => addOrReplaceApplicationRecord(current, record))) {
        openApplication(record.id);
      } else {
        setMainTab("applications");
      }
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

  function updateApplication(id: string, values: Partial<ApplicationRecord>): boolean {
    return setApplicationData((current) => updateApplicationRecord(current, id, values));
  }

  function removeApplication(id: string): boolean {
    if (!setApplicationData((current) => removeApplicationRecord(current, id))) return false;
    setActiveApplicationId((current) => (current === id ? null : current));
    return true;
  }

  function replaceApplicationData(nextData: ApplicationTrackerData): boolean {
    return setApplicationData(nextData);
  }

  useEffect(() => {
    function saveAgentData(nextData: ApplicationTrackerData): void {
      if (!setApplicationData(nextData)) throw new Error("申请写入失败，原始数据已保留，请在页面中检查存储状态");
    }
    const api: BaoyanAgentApi = {
      addFromDdlItem(item: DdlItem): ApplicationTrackerData {
        const record = createApplicationRecord(item);
        const nextData = addOrReplaceApplicationRecord(readStoredApplicationData(), record);
        saveAgentData(nextData);
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
          saveAgentData(result.data);
        }
        return result;
      },
      clearAll(): ApplicationTrackerData {
        const nextData = createEmptyTrackerData();
        saveAgentData(nextData);
        return nextData;
      },
      createApplication(record: ApplicationRecord): ApplicationTrackerData {
        const nextData = addOrReplaceApplicationRecord(readStoredApplicationData(), record);
        saveAgentData(nextData);
        return nextData;
      },
      deleteApplication(id: string): ApplicationTrackerData {
        const nextData = removeApplicationRecord(readStoredApplicationData(), id);
        saveAgentData(nextData);
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
        saveAgentData(result.data);
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
        ddlCount={visibleItems.length}
        lastSyncedAt={data?.lastSyncedAt ?? data?.generatedAt}
        onSelect={setMainTab}
      />

      <main className="shell" id="main-content">
        {mainTab === "ddl" && (
          <section className="ddl-workspace" aria-labelledby="page-title">
            <header className="workspace-intro">
              <div>
                <span className="section-kicker">保研进度台 / 项目发现</span>
                <h1 id="page-title">把握每一个申请节点</h1>
                <p>查找项目，核对截止时间，加入你的申请计划。</p>
              </div>
            </header>
            {(data?.health?.status === "delayed" || data?.health?.status === "unavailable") && (
              <div className="health-notice" role="status">数据更新延迟，正在展示上次成功同步的内容。临近截止请以官方通知为准。</div>
            )}

            <section className="discovery-panel" aria-label="DDL 筛选">
              <label className="search-field search-field-main">
                <span>搜索学校、院系或研究方向</span>
                <div className="search-control">
                  <Search aria-hidden="true" size={20} strokeWidth={2} />
                  <input
                    aria-label="搜索学校、院系或研究方向"
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
                  aria-controls="advanced-filters"
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

              {isMobileViewport && moreFiltersOpen && <button className="filter-backdrop" aria-label="关闭高级筛选" onClick={() => setMoreFiltersOpen(false)} type="button" tabIndex={-1} />}
              <div id="advanced-filters" ref={advancedFiltersRef} role={isMobileViewport && moreFiltersOpen ? "dialog" : "region"}
                aria-modal={isMobileViewport && moreFiltersOpen ? true : undefined} aria-label="高级筛选条件"
                className={moreFiltersOpen ? "advanced-filters advanced-filters-open" : "advanced-filters"}>
                {isMobileViewport && <div className="filter-drawer-head"><strong>高级筛选</strong><button className="secondary-action" aria-label="关闭筛选面板" type="button" onClick={() => setMoreFiltersOpen(false)}><X size={18} /></button></div>}
                <FilterSegment label="相关度" onChange={(value) => setRelevance(value as RelevanceFilter)} options={RELEVANCE_OPTIONS} value={relevance} />
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
                {isMobileViewport && <button className="primary-action filter-drawer-done" onClick={() => setMoreFiltersOpen(false)} type="button">查看 {visibleItems.length} 条结果</button>}
              </div>
            </section>

            <div className="timeline-summary">
              <button className="secondary-action" aria-expanded={timelineOpen} aria-controls="deadline-timeline" onClick={() => setTimelineOpen((open) => !open)} type="button">
                <ChevronDown size={16} className={timelineOpen ? "chevron-open" : ""} aria-hidden="true" />{timelineOpen ? "收起截止概览" : "展开截止概览"}
              </button>
              <span>今日 {stats.today} · 未来 15 天 {stats.fifteenDays} · 待确认 {stats.unknown}</span>
              <button className="text-action" type="button" onClick={() => { setRange("unknown"); setRelevance("all"); }}>查看待确认项目</button>
            </div>
            {timelineOpen && <div id="deadline-timeline"><Timeline
              loading={isLoading}
              onSelectItem={jumpToItem}
              range={range}
              stops={timelineStops}
            /></div>}

            <section className="results-panel" aria-labelledby="results-title">
              <header className="results-head">
                <div>
                  <h2 id="results-title">项目列表 <span className="result-count">{visibleItems.length}</span></h2>
                  <p>
                    以最早影响申请资格的节点为准，报名前请核对官方通知。
                  </p>
                </div>
                <div className="results-tools"><button className="secondary-action" disabled={isLoading} onClick={() => void refresh()} type="button"><RotateCcw size={15} aria-hidden="true" />{isLoading ? "刷新中" : "刷新"}</button><ViewSwitcher onChange={changeViewMode} value={viewMode} /></div>
              </header>

              {error !== null && data !== null && <div className="health-notice" role="alert">刷新失败，已保留上次加载的数据。{error}</div>}
              {isLoading && data === null ? (
                <DdlSkeleton />
              ) : error !== null && data === null ? (
                <StateMessage title="数据加载失败" message={error} actionLabel="重新加载" onAction={() => void refresh()} />
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
          <Suspense fallback={<DdlSkeleton />}><ApplicationWorkspace
            activeRecordId={activeApplicationId}
            data={applicationData}
            onRemoveRecord={removeApplication}
            onReplaceData={replaceApplicationData}
            onSelectRecord={setActiveApplicationId}
            onUpdateRecord={updateApplication}
            onResetStorage={resetApplicationStorage}
            storageIssue={applicationStorageIssue}
          /></Suspense>
        )}

        {mainTab === "calendar" && (
          <Suspense fallback={<DdlSkeleton />}><ApplicationCalendar
            activeRecordId={activeApplicationId}
            records={applicationData.records}
            onOpenRecord={openApplication}
            onSelectApplications={() => setMainTab("applications")}
          /></Suspense>
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
if (rootElement !== null) createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
