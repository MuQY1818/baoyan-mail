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
  sourceGroup: string;
  sourceLabel: string;
  website: string;
}

interface DdlResponse {
  ok: true;
  generatedAt: string;
  timezone: "Asia/Shanghai";
  total: number;
  items: DdlItem[];
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

type TierFilter = "Top2" | "华五" | "C9" | "985" | "211" | "其他";
type RangeFilter = "today" | "3" | "7" | "15" | "future";
type SourceFilter = "all" | "cs" | "baoyanxinxi";

const TIER_OPTIONS: TierFilter[] = ["Top2", "华五", "C9", "985", "211", "其他"];
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
  { value: "cs", label: "CS-BAOYAN-DDL" },
  { value: "baoyanxinxi", label: "保研信息平台" }
];
const SUBSCRIBE_URL = "https://baoyan-mail.weijuebu.workers.dev/";
const API_URL = "https://baoyan-mail.weijuebu.workers.dev/api/ddl";
const LLMS_TXT_URL = "/llms.txt";

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
  const [data, setData] = useState<DdlResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<RangeFilter>("future");
  const [source, setSource] = useState<SourceFilter>("all");
  const [activeTiers, setActiveTiers] = useState<Set<TierFilter>>(new Set(TIER_OPTIONS));
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

  const futureItems = useMemo(
    () => data?.items.filter((item) => item.status !== "expired") ?? [],
    [data]
  );
  const visibleItems = useMemo(
    () => filterItems(futureItems, query, range, source, activeTiers),
    [activeTiers, futureItems, query, range, source]
  );
  const stats = useMemo(() => buildStats(futureItems), [futureItems]);
  // 概览计数与跳转候选用同一套筛选（忽略范围），保证点击后一定能找到目标卡片
  const railCounts = useMemo(() => {
    const scoped = filterItems(futureItems, query, "future", source, activeTiers);
    return RAIL_BUCKETS.map(
      (bucket) => scoped.filter((item) => bucket.matches(item.remainingDays)).length
    );
  }, [activeTiers, futureItems, query, source]);
  const timelineStops = useMemo(
    () => buildTimeline(filterItems(futureItems, query, "7", source, activeTiers)),
    [activeTiers, futureItems, query, source]
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
    const candidates = filterItems(futureItems, query, "future", source, activeTiers);
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

  function resetFilters(): void {
    setQuery("");
    setRange("future");
    setSource("all");
    setActiveTiers(new Set(TIER_OPTIONS));
  }

  return (
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <div className="hero-copy">
          <p className="eyebrow">CS BAOYAN DEADLINES</p>
          <h1 id="page-title">保研 DDL 速查</h1>
          <p className="hero-text">
            汇总计算机与电子信息方向通知，按截止时间、学校层次和来源快速筛选。
          </p>
        </div>
        <div className="hero-actions">
          <a className="subscribe-link" href={SUBSCRIBE_URL}>
            订阅每日邮件
          </a>
          <span className="updated">{formatGeneratedAt(data?.generatedAt)}</span>
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
            <ol className="notice-list">
              {visibleItems.map((item) => (
                <DdlCard highlighted={item.key === highlightKey} item={item} key={item.key} />
              ))}
            </ol>
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

function DdlCard({
  highlighted,
  item
}: {
  highlighted: boolean;
  item: DdlItem;
}): React.ReactElement {
  const classes = ["notice-card"];
  if (item.status === "today") {
    classes.push("notice-card-urgent");
  }
  if (highlighted) {
    classes.push("notice-card-flash");
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
        <a className="source-link" href={item.website} rel="noreferrer" target="_blank">
          查看原始通知
        </a>
      </article>
    </li>
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
  if (loading) {
    return null;
  }

  return (
    <section className="timeline" aria-label="7 天内截止时间线">
      <div className="timeline-head">
        <span className="timeline-title">未来 7 天截止</span>
        <span className="timeline-hint">按筛选条件实时更新</span>
      </div>
      {stops.length === 0 ? (
        <p className="timeline-empty">未来 7 天内暂无符合条件的截止。</p>
      ) : (
        <ol className="timeline-track">
          {stops.map((stop) => (
            <TimelineColumn key={stop.remainingDays} stop={stop} />
          ))}
        </ol>
      )}
    </section>
  );
}

function TimelineColumn({ stop }: { stop: TimelineStop }): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
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
          onClick={() => setExpanded((value) => !value)}
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
  tiers: Set<TierFilter>
): DdlItem[] {
  const keyword = query.trim().toLowerCase();
  const rangeConfig = RANGE_OPTIONS.find((option) => option.value === range);
  return items.filter((item) => {
    if (!tiers.has(item.tier)) {
      return false;
    }
    if (rangeConfig?.maxDays !== null && rangeConfig?.maxDays !== undefined) {
      if (item.remainingDays > rangeConfig.maxDays) {
        return false;
      }
    }
    if (source === "cs" && item.sourceGroup === "baoyanxinxi2026jsjby") {
      return false;
    }
    if (source === "baoyanxinxi" && item.sourceGroup !== "baoyanxinxi2026jsjby") {
      return false;
    }
    if (keyword === "") {
      return true;
    }
    return `${item.school} ${item.institute} ${item.description}`.toLowerCase().includes(keyword);
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

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("缺少 root 节点");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
