import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import type React from "react";
import type { ApplicationRecord } from "../../applicationTracker";
import { EVENT_TYPE_OPTIONS } from "../../constants";
import {
  buildCalendarDays,
  buildDayCellClass,
  buildUpcomingApplicationEvents,
  formatEventType
} from "../../utils/applications";
import { formatRelativeEventDate, formatTodayLabel } from "../../utils/datetime";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { MOBILE_VIEW_MEDIA_QUERY } from "../../constants";

export function ApplicationCalendar({
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
  const mobile = useMediaQuery(MOBILE_VIEW_MEDIA_QUERY);
  const [view, setView] = useState<"month" | "agenda" | null>(null);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const showMonth = (view ?? (mobile ? "agenda" : "month")) === "month";
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
          <button className="secondary-action" onClick={() => setView(showMonth ? "agenda" : "month")} type="button">{showMonth ? "日程列表" : "月历视图"}</button>
          {showMonth && <><button
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
          </button></>}
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
        {showMonth && <section className="month-card" aria-label={monthTitle}>
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
                  {day.events.slice(0, expandedDays.has(day.key) ? undefined : 3).map((event) => (
                    <button
                      className={
                        event.record.id === activeRecordId
                          ? `day-event day-event-${event.event.type} day-event-active`
                          : `day-event day-event-${event.event.type}`
                      }
                      key={`${event.record.id}-${event.event.id}`}
                      onClick={() => {
                        onOpenRecord(event.record.id);
                        onSelectApplications();
                      }}
                      type="button"
                    >
                      {event.record.school} · {formatEventType(event.event.type)}
                    </button>
                  ))}
                  {day.events.length > 3 && <button type="button" className="day-more" aria-expanded={expandedDays.has(day.key)}
                    aria-label={`${day.key} ${expandedDays.has(day.key) ? "收起" : "展开全部"}日程`}
                    onClick={() => setExpandedDays((current) => { const next = new Set(current); if (next.has(day.key)) next.delete(day.key); else next.add(day.key); return next; })}>
                    {expandedDays.has(day.key) ? "收起" : `+${day.events.length - 3} 查看全部`}
                  </button>}
                </div>
              </div>
            ))}
          </div>
        </section>}

        <aside className="upcoming-card" aria-label="近期日程">
          <h3>近期日程</h3>
          {upcoming.length === 0 ? (
            <p className="empty-hint">暂无未来日程。</p>
          ) : (
            <ol className="upcoming-list">
              {upcoming.map(({ event, record }) => (
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
                    <span>{record.institute} · {event.title}</span>
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
