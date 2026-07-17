import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { TIMELINE_COLLAPSE_LIMIT } from "../constants";
import type { RangeFilter, TimelineExpansion, TimelineStop } from "../types";
import { formatActivityType, formatTimelineRangeLabel } from "../utils/ddl";

export function Timeline({
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
  const updateScrollbarRef = useRef<(() => void) | null>(null);
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

  // 滚动监听只随加载状态挂载一次；条目或展开态变化只触发宽度同步
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

    updateScrollbarRef.current = updateScrollbar;
    updateScrollbar();
    track.addEventListener("scroll", syncFromTrack, { passive: true });
    scrollbar.addEventListener("scroll", syncFromScrollbar, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateScrollbar);
    observer?.observe(track);

    return () => {
      updateScrollbarRef.current = null;
      observer?.disconnect();
      track.removeEventListener("scroll", syncFromTrack);
      scrollbar.removeEventListener("scroll", syncFromScrollbar);
    };
  }, [loading]);

  useEffect(() => {
    updateScrollbarRef.current?.();
  }, [expandedStops, stops]);

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
