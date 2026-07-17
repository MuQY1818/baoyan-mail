import type {
  ApplicationEventType,
  ApplicationMaterial,
  ApplicationPriority,
  ApplicationRecord,
  ApplicationResult,
  ApplicationStatus
} from "../applicationTracker";
import {
  EVENT_TYPE_OPTIONS,
  PRIORITY_OPTIONS,
  RESULT_OPTIONS,
  STATUS_OPTIONS
} from "../constants";
import type { ApplicationRangeFilter, CalendarDay, CalendarEventEntry } from "../types";
import { getRemainingDays, getShanghaiDateKey } from "./datetime";

export function filterApplicationRecords(
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

export function buildApplicationStats(records: ApplicationRecord[]): {
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

export function formatApplicationStatus(status: ApplicationStatus): string {
  return STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

export function formatPriority(priority: ApplicationPriority): string {
  return PRIORITY_OPTIONS.find((option) => option.value === priority)?.label ?? priority;
}

export function formatResult(result: ApplicationResult): string {
  return RESULT_OPTIONS.find((option) => option.value === result)?.label ?? result;
}

export function formatEventType(type: ApplicationEventType): string {
  return EVENT_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

export function formatMaterialProgress(materials: ApplicationMaterial[]): string {
  const required = materials.filter((material) => material.status !== "not_required");
  const done = required.filter((material) => material.status === "done");
  if (required.length === 0) {
    return "无需材料";
  }
  return `${done.length}/${required.length}`;
}

export function formatApplicationRemaining(record: ApplicationRecord): string {
  const days = getRemainingDays(record.deadlineAt);
  if (days < 0) {
    return "已过期";
  }
  if (days === 0) {
    return "今日截止";
  }
  return `${days} 天后截止`;
}

export function cloneApplicationRecord(record: ApplicationRecord): ApplicationRecord {
  return {
    ...record,
    areas: [...record.areas],
    materials: record.materials.map((material) => ({ ...material })),
    events: record.events.map((event) => ({ ...event }))
  };
}

export function serializeEditableRecord(record: ApplicationRecord): string {
  const { updatedAt: _updatedAt, ...editable } = record;
  return JSON.stringify(editable);
}

export function buildCalendarDays(monthDate: Date, records: ApplicationRecord[]): CalendarDay[] {
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

export function buildDayCellClass(day: CalendarDay): string {
  const classes = ["day-cell"];
  if (!day.inMonth) {
    classes.push("day-cell-muted");
  }
  if (day.isToday) {
    classes.push("day-cell-today");
  }
  return classes.join(" ");
}

export function buildUpcomingApplicationEvents(records: ApplicationRecord[]): CalendarEventEntry[] {
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
