import type {
  ApplicationEventType,
  ApplicationPriority,
  ApplicationResult,
  ApplicationStatus
} from "./applicationTracker";
import type {
  ActivityTypeFilter,
  ApplicationRangeFilter,
  AreaFilter,
  RangeFilter,
  RecentFilter,
  RelevanceFilter,
  SourceFilter,
  TierFilter
} from "./types";

export const TIER_OPTIONS: TierFilter[] = ["Top2", "华五", "C9", "985", "211", "其他"];
export const AREA_OPTIONS: AreaFilter[] = [
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
export const TIER_RANK: Record<TierFilter, number> = {
  Top2: 0,
  华五: 1,
  C9: 2,
  "985": 3,
  "211": 4,
  其他: 5
};
export const TIMELINE_COLLAPSE_LIMIT = 4;
export const RANGE_OPTIONS: Array<{ value: RangeFilter; label: string; maxDays: number | null }> = [
  { value: "today", label: "今天", maxDays: 0 },
  { value: "3", label: "3 天", maxDays: 3 },
  { value: "7", label: "7 天", maxDays: 7 },
  { value: "15", label: "15 天", maxDays: 15 },
  { value: "future", label: "全部未来", maxDays: null }
];
export const SOURCE_OPTIONS: Array<{ value: SourceFilter; label: string }> = [
  { value: "all", label: "全部来源" },
  { value: "baoyanxinxi", label: "保研信息平台" },
  { value: "manual", label: "人工补充" }
];
export const RECENT_OPTIONS: Array<{ value: RecentFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "new", label: "最近新增" },
  { value: "updated", label: "最近更新" }
];
export const RELEVANCE_OPTIONS: Array<{ value: RelevanceFilter; label: string }> = [
  { value: "strong", label: "强相关" },
  { value: "possible", label: "强相关+可能" },
  { value: "all", label: "全部源站" }
];
export const ACTIVITY_TYPE_OPTIONS: Array<{ value: ActivityTypeFilter; label: string }> = [
  { value: "all", label: "全部类型" },
  { value: "summer_camp", label: "夏令营" },
  { value: "pre_recommendation", label: "预推免" },
  { value: "unknown", label: "未标注" }
];
export const API_URL = "https://baoyan-mail.weijuebu.workers.dev/api/ddl";
export const LLMS_TXT_URL = "/llms.txt";
export const ANALYTICS_VISIT_STORAGE_KEY = "baoyan-ddl-visit-date";
export const RECENT_DAYS = 7;
export const FAVORITE_STORAGE_KEY = "baoyan-ddl-favorites";
export const READ_STORAGE_KEY = "baoyan-ddl-read";
export const THEME_STORAGE_KEY = "baoyan-ddl-theme";
export const MAIN_TAB_STORAGE_KEY = "baoyan-main-tab";
export const DDL_VIEW_DESKTOP_STORAGE_KEY = "baoyan-ui/v1/ddl-view-desktop";
export const DDL_VIEW_MOBILE_STORAGE_KEY = "baoyan-ui/v1/ddl-view-mobile";
export const APPLICATION_VIEW_DESKTOP_STORAGE_KEY = "baoyan-ui/v1/application-view-desktop";
export const APPLICATION_VIEW_MOBILE_STORAGE_KEY = "baoyan-ui/v1/application-view-mobile";
export const MOBILE_VIEW_MEDIA_QUERY = "(max-width: 720px)";
export const STATUS_OPTIONS: Array<{ value: ApplicationStatus; label: string }> = [
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
export const PRIORITY_OPTIONS: Array<{ value: ApplicationPriority; label: string }> = [
  { value: "rush", label: "冲刺" },
  { value: "target", label: "主申" },
  { value: "safe", label: "保底" }
];
export const RESULT_OPTIONS: Array<{ value: ApplicationResult; label: string }> = [
  { value: "pending", label: "待定" },
  { value: "accepted", label: "录取" },
  { value: "waitlisted", label: "候补" },
  { value: "rejected", label: "拒绝" },
  { value: "withdrawn", label: "放弃" }
];
export const APPLICATION_RANGE_OPTIONS: Array<{ value: ApplicationRangeFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "today", label: "今天" },
  { value: "3", label: "3 天" },
  { value: "7", label: "7 天" },
  { value: "15", label: "15 天" },
  { value: "expired", label: "已过期" }
];
export const EVENT_TYPE_OPTIONS: Array<{ value: ApplicationEventType; label: string }> = [
  { value: "deadline", label: "DDL" },
  { value: "interview", label: "面试" },
  { value: "camp", label: "开营" },
  { value: "result", label: "结果" },
  { value: "material", label: "补材料" },
  { value: "other", label: "其他" }
];
