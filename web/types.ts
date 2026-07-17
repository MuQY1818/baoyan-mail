import type {
  ActivityType,
  ApplicationEvent,
  ApplicationRecord,
  ApplicationTrackerData
} from "./applicationTracker";

export type DeadlineStatus = "today" | "future" | "expired";
export type Relevance = "strong" | "possible" | "unrelated";

export interface DdlItem {
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

export interface DdlResponse {
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

export interface BaoyanAgentApi {
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

export interface SourceStat {
  sourceGroup: string;
  sourceLabel: string;
  total: number;
  current: number;
  grace: number;
  staleHidden: number;
}

export interface AnalyticsCountry {
  countryCode: string;
  countryName: string;
  visitCount: number;
  share: number;
}

export interface AnalyticsDaily {
  date: string;
  visitCount: number;
}

export interface AnalyticsRegion {
  countryCode: string;
  regionCode: string;
  regionName: string;
  visitCount: number;
  share: number;
}

export interface AnalyticsSummary {
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

export interface ApplicationStorageIssue {
  message: string;
  rawValue: string;
}

export interface TimelineEntry {
  key: string;
  school: string;
  institute: string;
  tier: TierFilter;
  activityType: ActivityType;
  website: string;
}

export interface TimelineStop {
  remainingDays: number;
  dayLabel: string;
  dateLabel: string;
  isToday: boolean;
  entries: TimelineEntry[];
}

export type TimelineExpansion = "collapsed" | "expanded";

export type TierFilter = "Top2" | "华五" | "C9" | "985" | "211" | "其他";
export type RangeFilter = "today" | "3" | "7" | "15" | "future";
export type SourceFilter = "all" | "baoyanxinxi" | "manual";
export type RecentFilter = "all" | "new" | "updated";
export type ViewMode = "cards" | "table";
export type ThemeMode = "light" | "dark";
export type RelevanceFilter = "strong" | "possible" | "all";
export type ActivityTypeFilter = ActivityType | "all";
export type MainTab = "ddl" | "applications" | "calendar";
export type ApplicationViewMode = "cards" | "table";
export type ApplicationRangeFilter = "all" | "today" | "3" | "7" | "15" | "expired";
export type AreaFilter =
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

export interface CalendarEventEntry {
  event: ApplicationEvent;
  record: ApplicationRecord;
}

export interface CalendarDay {
  events: CalendarEventEntry[];
  inMonth: boolean;
  isToday: boolean;
  key: string;
  label: string;
}
