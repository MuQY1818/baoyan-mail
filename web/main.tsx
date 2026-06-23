import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type DeadlineStatus = "today" | "future" | "expired";

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

interface SourceStat {
  sourceGroup: string;
  sourceLabel: string;
  total: number;
  current: number;
  grace: number;
  staleHidden: number;
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
const SUBSCRIBE_URL = "https://baoyan-mail.weijuebu.workers.dev/";
const API_URL = "https://baoyan-mail.weijuebu.workers.dev/api/ddl";
const LLMS_TXT_URL = "/llms.txt";
const RECENT_DAYS = 7;
const FAVORITE_STORAGE_KEY = "baoyan-ddl-favorites";
const READ_STORAGE_KEY = "baoyan-ddl-read";
const THEME_STORAGE_KEY = "baoyan-ddl-theme";

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
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState(initialFilters.query);
  const [range, setRange] = useState<RangeFilter>(initialFilters.range);
  const [source, setSource] = useState<SourceFilter>(initialFilters.source);
  const [recent, setRecent] = useState<RecentFilter>(initialFilters.recent);
  const [viewMode, setViewMode] = useState<ViewMode>(initialFilters.viewMode);
  const [activeTiers, setActiveTiers] = useState<Set<TierFilter>>(initialFilters.tiers);
  const [activeAreas, setActiveAreas] = useState<Set<AreaFilter>>(initialFilters.areas);
  const [favorites, toggleFavorite] = useStoredKeySet(FAVORITE_STORAGE_KEY);
  const [readItems, toggleReadItem] = useStoredKeySet(READ_STORAGE_KEY);
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
    writeFiltersToUrl({ activeAreas, activeTiers, query, range, recent, source, viewMode });
  }, [activeAreas, activeTiers, query, range, recent, source, viewMode]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage failures; the visual state still applies for this session.
    }
  }, [theme]);

  const futureItems = useMemo(
    () => data?.items.filter((item) => item.status !== "expired") ?? [],
    [data]
  );
  const visibleItems = useMemo(
    () => filterItems(futureItems, query, range, source, activeTiers, activeAreas, recent),
    [activeAreas, activeTiers, futureItems, query, range, recent, source]
  );
  const stats = useMemo(() => buildStats(futureItems), [futureItems]);
  // 概览计数与跳转候选用同一套筛选（忽略范围），保证点击后一定能找到目标卡片
  const railCounts = useMemo(() => {
    const scoped = filterItems(futureItems, query, "future", source, activeTiers, activeAreas, recent);
    return RAIL_BUCKETS.map(
      (bucket) => scoped.filter((item) => bucket.matches(item.remainingDays)).length
    );
  }, [activeAreas, activeTiers, futureItems, query, recent, source]);
  const timelineStops = useMemo(
    () => buildTimeline(filterItems(futureItems, query, "7", source, activeTiers, activeAreas, recent)),
    [activeAreas, activeTiers, futureItems, query, recent, source]
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
    const candidates = filterItems(futureItems, query, "future", source, activeTiers, activeAreas, recent);
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
    setRecent("all");
    setViewMode("cards");
    setActiveTiers(new Set(TIER_OPTIONS));
    setActiveAreas(new Set());
  }

  function toggleTheme(): void {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }

  return (
    <main className="shell">
      <ThemeToggle theme={theme} onToggle={toggleTheme} />

      <section className="hero" aria-labelledby="page-title">
        <div className="hero-copy">
          <p className="eyebrow">CS BAOYAN DEADLINES</p>
          <h1 id="page-title">保研 DDL 速查</h1>
          <p className="hero-text">
            默认展示保研信息平台未截止通知，方向、层次和来源都交给你筛选。
          </p>
        </div>
        <div className="hero-actions">
          <a className="subscribe-link" href={SUBSCRIBE_URL}>
            订阅每日邮件
          </a>
          <span className="updated">{formatGeneratedAt(data?.lastSyncedAt ?? data?.generatedAt)}</span>
        </div>
      </section>

      <Timeline stops={timelineStops} loading={isLoading} />

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
            <SummaryCell label="未截止" value={futureItems.length} />
            <SummaryCell label="今日截止" value={stats.today} />
            <SummaryCell label="15 天内" value={stats.fifteenDays} />
            <SummaryCell label="当前显示" value={visibleItems.length} />
          </section>

          {isLoading ? (
            <StateMessage title="正在校准刻度" message="正在读取最新 DDL 数据。" />
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
              favorites={favorites}
              highlightedKey={highlightKey}
              items={visibleItems}
              onToggleFavorite={toggleFavorite}
              onToggleRead={toggleReadItem}
              readItems={readItems}
              viewMode={viewMode}
            />
          )}
        </div>
      </section>

      <ApiHint />
    </main>
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

function DdlResults({
  favorites,
  highlightedKey,
  items,
  onToggleFavorite,
  onToggleRead,
  readItems,
  viewMode
}: {
  favorites: Set<string>;
  highlightedKey: string | null;
  items: DdlItem[];
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
          favorite={favorites.has(item.key)}
          highlighted={item.key === highlightedKey}
          item={item}
          key={item.key}
          onToggleFavorite={() => onToggleFavorite(item.key)}
          onToggleRead={() => onToggleRead(item.key)}
          read={readItems.has(item.key)}
        />
      ))}
    </ol>
  );
}

function DdlCard({
  favorite,
  highlighted,
  item,
  onToggleFavorite,
  onToggleRead,
  read
}: {
  favorite: boolean;
  highlighted: boolean;
  item: DdlItem;
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
        </div>
      </article>
    </li>
  );
}

function DdlTable({
  favorites,
  items,
  onToggleFavorite,
  onToggleRead,
  readItems
}: {
  favorites: Set<string>;
  items: DdlItem[];
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
                <div className="table-area-list">
                  {getItemAreas(item).map((area) => (
                    <span className="table-area" key={area}>{area}</span>
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
        <span className="area-badge" key={area}>{area}</span>
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
  stops
}: {
  loading: boolean;
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
    <section className="timeline" aria-label="7 天内截止时间线">
      <div className="timeline-head">
        <div className="timeline-head-text">
          <span className="timeline-title">未来 7 天截止</span>
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
        <p className="timeline-empty">未来 7 天内暂无符合条件的截止。</p>
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

function filterItems(
  items: DdlItem[],
  query: string,
  range: RangeFilter,
  source: SourceFilter,
  tiers: Set<TierFilter>,
  areas: Set<AreaFilter>,
  recent: RecentFilter
): DdlItem[] {
  const keyword = query.trim().toLowerCase();
  const rangeConfig = RANGE_OPTIONS.find((option) => option.value === range);
  return items.filter((item) => {
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

function readFiltersFromUrl(): {
  query: string;
  range: RangeFilter;
  source: SourceFilter;
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
