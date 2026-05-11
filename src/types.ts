export interface Env {
  DB: D1Database;
  SOURCE_URL?: string;
  APP_BASE_URL?: string;
  MAIL_PROVIDER?: string;
  SENDER_NAME?: string;
  ALIYUN_ACCESS_KEY_ID?: string;
  ALIYUN_ACCESS_KEY_SECRET?: string;
  ALIYUN_DM_ACCOUNT_NAME?: string;
  ALIYUN_DM_ENDPOINT?: string;
  ALIYUN_REGION_ID?: string;
  ADMIN_TOKEN?: string;
  BATCH_SIZE?: string;
  ITEMS_PER_EMAIL?: string;
}

export type SubscriberStatus = "pending" | "active" | "unsubscribed";

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
}

export interface ItemSnapshotRow {
  item_key: string;
  content_hash: string;
  payload: string;
  source_group: string;
  first_seen_at: string;
  updated_at: string;
}

export interface NotificationRow {
  id: number;
  item_key: string;
  kind: "added" | "changed";
  content_hash: string;
  payload: string;
  created_at: string;
  sent_at: string | null;
}

export interface NotificationWithItem extends NotificationRow {
  item: NormalizedItem;
}

export interface RunCheckResult {
  initialized: boolean;
  scanned: number;
  detected: number;
  pendingSent: number;
  subscriberCount: number;
}
