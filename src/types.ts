export interface Env {
  DB: D1Database;
  BAOYANXINXI_SOURCE_URL?: string;
  BAOYANXINXI_PRE_RECOMMENDATION_SOURCE_URL?: string;
  XINGKE_SOURCE_URL?: string;
  ZSCAMPUS_SOURCE_URL?: string;
  SOURCE_YEAR?: string;
  APP_BASE_URL?: string;
  MAIL_PROVIDER?: string;
  SENDER_NAME?: string;
  ALIYUN_ACCESS_KEY_ID?: string;
  ALIYUN_ACCESS_KEY_SECRET?: string;
  ALIYUN_DM_ACCOUNT_NAME?: string;
  ALIYUN_DM_ENDPOINT?: string;
  ALIYUN_REGION_ID?: string;
  ADMIN_TOKEN?: string;
  ADMIN_REVIEW_PASSWORD?: string;
  BATCH_SIZE?: string;
  SOURCE_WATCHDOG_ENABLED?: string;
  PIPELINE_DAILY_WRITE_BUDGET?: string;
  GITHUB_ACTIONS_TOKEN?: string;
  GITHUB_REPOSITORY?: string;
  GITHUB_SYNC_WORKFLOW?: string;
  GITHUB_SYNC_REF?: string;
}

export type SubscriberStatus = "pending" | "active" | "unsubscribed";
export type Relevance = "strong" | "possible" | "unrelated";
export type ActivityType = "summer_camp" | "pre_recommendation" | "unknown";
export type ActivityTypeSource =
  | "source"
  | "source_group"
  | "text"
  | "classification"
  | "unknown";
export type ClassificationKind = "relevance" | "activity_type";
export type ClassificationFeedbackSource = "model" | "rule_guard" | "manual";
export type DeadlinePrecision = "exact" | "date" | "unknown";
export type SourceMergeReason = "single" | "exact_url" | "title_match";

export interface SourceObservation {
  sourceGroup: string;
  sourceItemId: string;
  title: string;
  website: string;
  deadlineRaw: string;
  deadline: string;
  deadlinePrecision: DeadlinePrecision;
  publishedAt: string;
}

export interface OfficialItemVerification {
  itemKey: string;
  normalizedUrl: string;
  title: string;
  deadline: string;
  deadlinePrecision: DeadlinePrecision;
  reason: string;
  verifier: string;
  verifiedAt: string;
}

export interface OfficialItemVerificationRow {
  item_key: string;
  normalized_url: string;
  title: string;
  deadline: string;
  deadline_precision: DeadlinePrecision;
  reason: string;
  verifier: string;
  verified_at: string;
  created_at: string;
  updated_at: string;
}

export interface OfficialItemVerificationTarget {
  itemKey: string;
  normalizedUrls: string[];
}

export interface ItemActivityTypeClassification {
  normalizedUrl: string;
  activityType: ActivityType;
  reason: string;
  classifier: string;
  classifiedAt: string;
}

export interface ItemActivityTypeClassificationRow {
  normalized_url: string;
  activity_type: ActivityType;
  reason: string;
  classifier: string;
  classified_at: string;
  created_at: string;
  updated_at: string;
}

export interface ItemRelevanceClassification {
  normalizedUrl: string;
  relevance: Relevance;
  areas: string[];
  reason: string;
  classifier: string;
  classifiedAt: string;
}

export interface ItemRelevanceClassificationRow {
  normalized_url: string;
  relevance: Relevance;
  areas: string;
  reason: string;
  classifier: string;
  classified_at: string;
  created_at: string;
  updated_at: string;
}

export interface ClassificationFeedback {
  normalizedUrl: string;
  classificationKind: ClassificationKind;
  modelValue: string;
  correctedValue: string;
  reason: string;
  source: ClassificationFeedbackSource;
  classifier: string;
  createdAt: string;
}

export interface SubscriberRow {
  id: number;
  email: string;
  status: SubscriberStatus;
  confirm_token_hash: string;
  unsubscribe_token: string;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
}

export interface NormalizedItem {
  key: string;
  contentHash: string;
  sourceGroup: string;
  name: string;
  institute: string;
  description: string;
  deadline: string;
  website: string;
  tags: string[];
  sourceGroups?: string[];
  sourceObservations?: SourceObservation[];
  alternateWebsites?: string[];
  mergeReason?: SourceMergeReason;
  deadlinePrecision?: DeadlinePrecision;
  deadlineConflict?: boolean;
  deadlineSource?: string;
  officialTitle?: string;
  officialVerifiedAt?: string;
  activityType?: ActivityType;
  activityTypeSource?: ActivityTypeSource;
  activityTypeReason?: string;
  activityTypeClassifier?: string;
  activityTypeClassifiedAt?: string;
  areas?: string[];
  relevance?: Relevance;
  relevanceReason?: string;
  relevanceClassifier?: string;
  relevanceClassifiedAt?: string;
}

export interface ItemSnapshotRow {
  item_key: string;
  content_hash: string;
  payload: string;
  source_group: string;
  first_seen_at: string;
  updated_at: string;
  last_seen_at: string | null;
  missing_since: string | null;
}

export interface DeadlineReminderRow {
  id: number;
  item_key: string;
  deadline_at: string;
  reminder_window_days: number;
  payload: string;
  created_at: string;
  sent_at: string | null;
}

export interface DeadlineReminderWithItem extends DeadlineReminderRow {
  item: NormalizedItem;
}

export interface NewDeadlineNotificationRow {
  id: number;
  item_key: string;
  deadline_at: string;
  payload: string;
  created_at: string;
  sent_at: string | null;
}

export interface NewDeadlineNotificationWithItem extends NewDeadlineNotificationRow {
  item: NormalizedItem;
}

export interface SourceStats {
  sourceGroup: string;
  url: string;
  rawCount: number;
  acceptedCount: number;
  filteredCount: number;
  reviewCandidateCount?: number;
  duplicateCount: number;
  supplementedDeadlineCount: number;
  pageCount?: number;
  exclusiveCount?: number;
  crossSourceDuplicateCount?: number;
  conflictCount?: number;
  unknownDeadlineCount?: number;
  latestPublishedAt?: string;
  activityType?: ActivityType;
  error?: string;
}

export interface RunCheckResult {
  initialized: boolean;
  scanned: number;
  detected: number;
  pendingSent: number;
  deadlineDetected: number;
  deadlinePendingSent: number;
  dailyDeadlineDetected: number;
  dailyDeadlineSent: number;
  newDeadlineDetected: number;
  newDeadlineSent: number;
  subscriberCount: number;
  addedCount: number;
  changedCount: number;
  missingCount: number;
  staleVisibleCount: number;
  staleHiddenCount: number;
  lastSyncedAt: string;
  sourceStats?: SourceStats[];
  activityTypeCounts?: Record<ActivityType, number>;
}

export interface VisitDailyStatRow {
  visit_date: string;
  country_code: string;
  region_code: string;
  country_name: string;
  region_name: string;
  visit_count: number;
  created_at: string;
  updated_at: string;
}

export type ReviewCandidateStatus = "pending" | "approved" | "rejected";

export interface ReviewCandidatePayload {
  sourceGroup: string;
  name: string;
  institute: string;
  description: string;
  deadline: string;
  website: string;
  submittedBy?: string;
  note?: string;
}

export interface SourceReviewCandidateRow {
  id: number;
  normalized_url: string;
  source_group: string;
  status: ReviewCandidateStatus;
  reason: string;
  payload: string;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  review_note: string | null;
}

export interface SourceReviewCandidateWithPayload extends SourceReviewCandidateRow {
  candidate: ReviewCandidatePayload;
}
