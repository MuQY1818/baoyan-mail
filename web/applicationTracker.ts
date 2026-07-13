export const APPLICATION_TRACKER_SCHEMA = "baoyan-application-tracker/v1";
export const APPLICATION_PATCH_SCHEMA = "baoyan-application-patch/v1";
export const APPLICATION_TRACKER_STORAGE_KEY = "baoyan-application-tracker";

export type ApplicationStatus =
  | "watching"
  | "preparing"
  | "submitted"
  | "interview"
  | "waiting_result"
  | "admitted"
  | "waitlisted"
  | "rejected"
  | "withdrawn";

export type ApplicationPriority = "rush" | "target" | "safe";
export type ApplicationResult = "pending" | "accepted" | "waitlisted" | "rejected" | "withdrawn";
export type MaterialStatus = "todo" | "done" | "not_required";
export type ApplicationEventType = "deadline" | "interview" | "camp" | "result" | "material" | "other";
export type ActivityType = "summer_camp" | "pre_recommendation" | "unknown";

export interface ApplicationMaterial {
  id: string;
  label: string;
  status: MaterialStatus;
}

export interface ApplicationEvent {
  id: string;
  type: ApplicationEventType;
  title: string;
  date: string;
  note: string;
}

export interface ApplicationRecord {
  id: string;
  sourceDdlKey: string;
  school: string;
  institute: string;
  website: string;
  deadlineAt: string;
  deadlineText: string;
  tier: string;
  areas: string[];
  activityType: ActivityType;
  relevance: string;
  status: ApplicationStatus;
  priority: ApplicationPriority;
  materials: ApplicationMaterial[];
  events: ApplicationEvent[];
  result: ApplicationResult;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationTrackerData {
  schema: typeof APPLICATION_TRACKER_SCHEMA;
  records: ApplicationRecord[];
  updatedAt: string | null;
}

export interface DdlApplicationSource {
  key: string;
  school: string;
  institute: string;
  website: string;
  deadlineAt: string;
  deadlineText: string;
  tier: string;
  areas?: string[];
  activityType?: ActivityType;
  relevance: string;
}

export interface ApplicationLinkSource {
  key: string;
  school: string;
  institute: string;
  website: string;
  deadlineAt: string;
  deadlineText?: string;
}

export interface ApplicationPatch {
  schema: typeof APPLICATION_PATCH_SCHEMA;
  operations: ApplicationPatchOperation[];
}

export type ApplicationPatchOperation =
  | { op: "add"; record: ApplicationRecord }
  | { op: "update"; id: string; values: Partial<ApplicationRecord> }
  | { op: "remove"; id: string }
  | { op: "add_event"; id: string; event: ApplicationEvent }
  | { op: "update_material"; id: string; materialId: string; status: MaterialStatus }
  | { op: "append_note"; id: string; note: string };

export interface PatchPreview {
  appliedCount: number;
  errors: string[];
  nextData: ApplicationTrackerData;
  summary: string[];
}

export interface AgentCrudResult {
  data: ApplicationTrackerData;
  errors: string[];
  summary: string[];
}

const STATUS_VALUES: ApplicationStatus[] = [
  "watching",
  "preparing",
  "submitted",
  "interview",
  "waiting_result",
  "admitted",
  "waitlisted",
  "rejected",
  "withdrawn"
];
const PRIORITY_VALUES: ApplicationPriority[] = ["rush", "target", "safe"];
const RESULT_VALUES: ApplicationResult[] = ["pending", "accepted", "waitlisted", "rejected", "withdrawn"];
const MATERIAL_STATUS_VALUES: MaterialStatus[] = ["todo", "done", "not_required"];
const ACTIVITY_TYPE_VALUES: ActivityType[] = ["summer_camp", "pre_recommendation", "unknown"];
const EVENT_TYPE_VALUES: ApplicationEventType[] = [
  "deadline",
  "interview",
  "camp",
  "result",
  "material",
  "other"
];

export function createEmptyTrackerData(): ApplicationTrackerData {
  return {
    schema: APPLICATION_TRACKER_SCHEMA,
    records: [],
    updatedAt: null
  };
}

export function createApplicationRecord(
  item: DdlApplicationSource,
  now = new Date().toISOString()
): ApplicationRecord {
  const id = `app-${hashString(item.key || item.website || `${item.school}-${item.institute}`)}`;
  const events: ApplicationEvent[] =
    item.deadlineAt.trim() === ""
      ? []
      : [
          {
            id: `${id}-deadline`,
            type: "deadline",
            title: "申请截止",
            date: item.deadlineAt,
            note: item.deadlineText
          }
        ];

  return {
    id,
    sourceDdlKey: item.key,
    school: item.school,
    institute: item.institute,
    website: item.website,
    deadlineAt: item.deadlineAt,
    deadlineText: item.deadlineText,
    tier: item.tier,
    areas: Array.isArray(item.areas) ? item.areas.filter((area) => area.trim() !== "") : [],
    activityType: readActivityType(item.activityType),
    relevance: item.relevance,
    status: "watching",
    priority: "target",
    materials: createDefaultMaterials(),
    events,
    result: "pending",
    notes: "",
    createdAt: now,
    updatedAt: now
  };
}

export function createDefaultMaterials(): ApplicationMaterial[] {
  return [
    { id: "resume", label: "简历", status: "todo" },
    { id: "transcript", label: "成绩单", status: "todo" },
    { id: "ranking", label: "排名证明", status: "todo" },
    { id: "recommendation", label: "推荐信", status: "todo" },
    { id: "statement", label: "个人陈述", status: "todo" },
    { id: "certificates", label: "证书附件", status: "todo" }
  ];
}

export function normalizeTrackerData(value: unknown): ApplicationTrackerData {
  if (!isRecordObject(value)) {
    return createEmptyTrackerData();
  }
  if (value.schema !== APPLICATION_TRACKER_SCHEMA || !Array.isArray(value.records)) {
    return createEmptyTrackerData();
  }
  return {
    schema: APPLICATION_TRACKER_SCHEMA,
    records: value.records.map(normalizeApplicationRecord).filter(isApplicationRecord),
    updatedAt: readNullableString(value.updatedAt)
  };
}

export function addOrReplaceApplicationRecord(
  data: ApplicationTrackerData,
  record: ApplicationRecord,
  now = new Date().toISOString()
): ApplicationTrackerData {
  const normalized = normalizeApplicationRecord(record);
  const records = data.records.filter(
    (entry) => entry.id !== normalized.id && entry.sourceDdlKey !== normalized.sourceDdlKey
  );
  return {
    schema: APPLICATION_TRACKER_SCHEMA,
    records: [...records, { ...normalized, updatedAt: now }],
    updatedAt: now
  };
}

export function getApplicationRecord(
  data: ApplicationTrackerData,
  id: string
): ApplicationRecord | null {
  return data.records.find((record) => record.id === id) ?? null;
}

export function updateApplicationRecord(
  data: ApplicationTrackerData,
  id: string,
  values: Partial<ApplicationRecord>,
  now = new Date().toISOString()
): ApplicationTrackerData {
  return {
    schema: APPLICATION_TRACKER_SCHEMA,
    records: data.records.map((record) =>
      record.id === id ? normalizeApplicationRecord({ ...record, ...values, id, updatedAt: now }) : record
    ),
    updatedAt: now
  };
}

export function removeApplicationRecord(
  data: ApplicationTrackerData,
  id: string,
  now = new Date().toISOString()
): ApplicationTrackerData {
  return {
    schema: APPLICATION_TRACKER_SCHEMA,
    records: data.records.filter((record) => record.id !== id),
    updatedAt: now
  };
}

export function hydrateApplicationRecordLinks(
  data: ApplicationTrackerData,
  items: ApplicationLinkSource[],
  now = new Date().toISOString()
): ApplicationTrackerData {
  const normalized = normalizeTrackerData(data);
  const linkIndex = buildApplicationLinkIndex(items);
  let changed = false;
  const records = normalized.records.map((record) => {
    if (record.website.trim() !== "") {
      return record;
    }
    const website = findApplicationWebsite(record, linkIndex);
    if (website === null) {
      return record;
    }
    changed = true;
    return { ...record, website, updatedAt: now };
  });

  if (!changed) {
    return normalized;
  }
  return {
    schema: APPLICATION_TRACKER_SCHEMA,
    records,
    updatedAt: now
  };
}

export function applyApplicationPatch(
  data: ApplicationTrackerData,
  patch: ApplicationPatch,
  now = new Date().toISOString()
): AgentCrudResult {
  const preview = previewApplicationPatch(data, patch, now);
  return {
    data: preview.errors.length === 0 ? preview.nextData : normalizeTrackerData(data),
    errors: preview.errors,
    summary: preview.summary
  };
}

export function createAgentPatchFromOperation(operation: ApplicationPatchOperation): ApplicationPatch {
  return {
    schema: APPLICATION_PATCH_SCHEMA,
    operations: [operation]
  };
}

export function parseApplicationPatch(value: unknown): ApplicationPatch {
  if (!isRecordObject(value) || value.schema !== APPLICATION_PATCH_SCHEMA || !Array.isArray(value.operations)) {
    throw new Error(`Patch schema 必须为 ${APPLICATION_PATCH_SCHEMA}`);
  }
  return {
    schema: APPLICATION_PATCH_SCHEMA,
    operations: value.operations.map(readPatchOperation)
  };
}

export function previewApplicationPatch(
  data: ApplicationTrackerData,
  patch: ApplicationPatch,
  now = new Date().toISOString()
): PatchPreview {
  let nextData = normalizeTrackerData(data);
  const errors: string[] = [];
  const summary: string[] = [];
  let appliedCount = 0;

  patch.operations.forEach((operation, index) => {
    const prefix = `第 ${index + 1} 条操作`;
    try {
      switch (operation.op) {
        case "add": {
          const record = normalizeApplicationRecord(operation.record);
          nextData = addOrReplaceApplicationRecord(nextData, record, now);
          summary.push(`新增或替换 ${record.school} ${record.institute || ""}`.trim());
          appliedCount += 1;
          break;
        }
        case "update": {
          assertRecordExists(nextData, operation.id, prefix);
          nextData = updateApplicationRecord(nextData, operation.id, sanitizeUpdateValues(operation.values), now);
          summary.push(`更新记录 ${operation.id}`);
          appliedCount += 1;
          break;
        }
        case "remove": {
          assertRecordExists(nextData, operation.id, prefix);
          nextData = removeApplicationRecord(nextData, operation.id, now);
          summary.push(`删除记录 ${operation.id}`);
          appliedCount += 1;
          break;
        }
        case "add_event": {
          assertRecordExists(nextData, operation.id, prefix);
          const event = normalizeApplicationEvent(operation.event);
          nextData = updateApplicationRecord(
            nextData,
            operation.id,
            {
              events: [
                ...(nextData.records.find((record) => record.id === operation.id)?.events ?? []),
                event
              ]
            },
            now
          );
          summary.push(`为 ${operation.id} 增加日程 ${event.title}`);
          appliedCount += 1;
          break;
        }
        case "update_material": {
          assertRecordExists(nextData, operation.id, prefix);
          const record = nextData.records.find((entry) => entry.id === operation.id);
          const material = record?.materials.find((entry) => entry.id === operation.materialId);
          if (record === undefined || material === undefined) {
            throw new Error(`${prefix}: 找不到材料 ${operation.materialId}`);
          }
          nextData = updateApplicationRecord(
            nextData,
            operation.id,
            {
              materials: record.materials.map((entry) =>
                entry.id === operation.materialId ? { ...entry, status: operation.status } : entry
              )
            },
            now
          );
          summary.push(`更新 ${operation.id} 的材料 ${material.label}`);
          appliedCount += 1;
          break;
        }
        case "append_note": {
          assertRecordExists(nextData, operation.id, prefix);
          const record = nextData.records.find((entry) => entry.id === operation.id);
          const line = `[${formatPatchTime(now)}] ${operation.note.trim()}`;
          nextData = updateApplicationRecord(
            nextData,
            operation.id,
            { notes: record?.notes.trim() === "" ? line : `${record?.notes ?? ""}\n${line}` },
            now
          );
          summary.push(`追加备注到 ${operation.id}`);
          appliedCount += 1;
          break;
        }
        default:
          throw new Error(`${prefix}: 不支持的操作`);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `${prefix}: 操作失败`);
    }
  });

  return { appliedCount, errors, nextData, summary };
}

function readPatchOperation(value: unknown): ApplicationPatchOperation {
  if (!isRecordObject(value)) {
    throw new Error("Patch operation 必须是对象");
  }
  const op = readString(value.op);
  switch (op) {
    case "add":
      return { op, record: normalizeApplicationRecord(value.record) };
    case "update":
      return { op, id: requireString(value.id, "id"), values: readObject(value.values, "values") as Partial<ApplicationRecord> };
    case "remove":
      return { op, id: requireString(value.id, "id") };
    case "add_event":
      return { op, id: requireString(value.id, "id"), event: normalizeApplicationEvent(value.event) };
    case "update_material":
      return {
        op,
        id: requireString(value.id, "id"),
        materialId: requireString(value.materialId, "materialId"),
        status: readEnum(value.status, MATERIAL_STATUS_VALUES, "status")
      };
    case "append_note":
      return { op, id: requireString(value.id, "id"), note: requireString(value.note, "note") };
    default:
      throw new Error(`不支持的 Patch 操作: ${op}`);
  }
}

function normalizeApplicationRecord(value: unknown): ApplicationRecord {
  const record = readObject(value, "record");
  const createdAt = readString(record.createdAt) || new Date().toISOString();
  const updatedAt = readString(record.updatedAt) || createdAt;
  return {
    id: requireString(record.id, "id"),
    sourceDdlKey: readString(record.sourceDdlKey),
    school: requireString(record.school, "school"),
    institute: readString(record.institute),
    website: readString(record.website),
    deadlineAt: readString(record.deadlineAt),
    deadlineText: readString(record.deadlineText),
    tier: readString(record.tier) || "其他",
    areas: Array.isArray(record.areas) ? record.areas.map(readString).filter((entry) => entry !== "") : [],
    activityType: readActivityType(record.activityType),
    relevance: readString(record.relevance) || "strong",
    status: readEnum(record.status, STATUS_VALUES, "status", "watching"),
    priority: readEnum(record.priority, PRIORITY_VALUES, "priority", "target"),
    materials: normalizeMaterials(record.materials),
    events: normalizeEvents(record.events),
    result: readEnum(record.result, RESULT_VALUES, "result", "pending"),
    notes: readString(record.notes),
    createdAt,
    updatedAt
  };
}

function normalizeMaterials(value: unknown): ApplicationMaterial[] {
  if (!Array.isArray(value)) {
    return createDefaultMaterials();
  }
  const materials = value.map((entry) => {
    const material = readObject(entry, "material");
    return {
      id: requireString(material.id, "material.id"),
      label: requireString(material.label, "material.label"),
      status: readEnum(material.status, MATERIAL_STATUS_VALUES, "material.status", "todo")
    };
  });
  return materials.length === 0 ? createDefaultMaterials() : materials;
}

function normalizeEvents(value: unknown): ApplicationEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(normalizeApplicationEvent);
}

function normalizeApplicationEvent(value: unknown): ApplicationEvent {
  const event = readObject(value, "event");
  return {
    id: requireString(event.id, "event.id"),
    type: readEnum(event.type, EVENT_TYPE_VALUES, "event.type", "other"),
    title: requireString(event.title, "event.title"),
    date: requireString(event.date, "event.date"),
    note: readString(event.note)
  };
}

function sanitizeUpdateValues(values: Partial<ApplicationRecord>): Partial<ApplicationRecord> {
  const next: Partial<ApplicationRecord> = {};
  if (values.school !== undefined) next.school = requireString(values.school, "school");
  if (values.institute !== undefined) next.institute = readString(values.institute);
  if (values.website !== undefined) next.website = readString(values.website);
  if (values.deadlineAt !== undefined) next.deadlineAt = readString(values.deadlineAt);
  if (values.deadlineText !== undefined) next.deadlineText = readString(values.deadlineText);
  if (values.activityType !== undefined) {
    next.activityType = readActivityType(values.activityType);
  }
  if (values.status !== undefined) next.status = readEnum(values.status, STATUS_VALUES, "status");
  if (values.priority !== undefined) next.priority = readEnum(values.priority, PRIORITY_VALUES, "priority");
  if (values.result !== undefined) next.result = readEnum(values.result, RESULT_VALUES, "result");
  if (values.notes !== undefined) next.notes = readString(values.notes);
  if (values.materials !== undefined) next.materials = normalizeMaterials(values.materials);
  if (values.events !== undefined) next.events = normalizeEvents(values.events);
  return next;
}

function readActivityType(value: unknown): ActivityType {
  return readEnum(value, ACTIVITY_TYPE_VALUES, "activityType", "unknown");
}

interface ApplicationLinkIndex {
  byKey: Map<string, string>;
  byFingerprint: Map<string, string>;
  items: ApplicationLinkSource[];
}

function buildApplicationLinkIndex(items: ApplicationLinkSource[]): ApplicationLinkIndex {
  const byKey = new Map<string, string>();
  const byFingerprint = new Map<string, string>();
  for (const item of items) {
    const website = readString(item.website).trim();
    if (website === "") {
      continue;
    }
    const key = readString(item.key).trim();
    if (key !== "") {
      byKey.set(key, website);
    }
    const fingerprint = getApplicationLinkFingerprint(item.school, item.institute, item.deadlineAt);
    if (fingerprint !== "") {
      byFingerprint.set(fingerprint, website);
    }
  }
  return { byFingerprint, byKey, items };
}

function findApplicationWebsite(record: ApplicationRecord, index: ApplicationLinkIndex): string | null {
  const byKey = index.byKey.get(record.sourceDdlKey);
  if (byKey !== undefined) {
    return byKey;
  }
  const fingerprint = getApplicationLinkFingerprint(record.school, record.institute, record.deadlineAt);
  const byFingerprint = index.byFingerprint.get(fingerprint);
  if (byFingerprint !== undefined) {
    return byFingerprint;
  }
  return findApplicationWebsiteByLooseMatch(record, index.items);
}

function getApplicationLinkFingerprint(school: string, institute: string, deadlineAt: string): string {
  const normalizedSchool = normalizeApplicationMatchText(school);
  const normalizedInstitute = normalizeApplicationMatchText(institute);
  const normalizedDeadline = normalizeDeadlineTimestamp(deadlineAt);
  if (normalizedSchool === "" || normalizedDeadline === "") {
    return "";
  }
  return [normalizedSchool, normalizedInstitute, normalizedDeadline].join("\u0000");
}

function normalizeApplicationMatchText(value: string): string {
  return value.replace(/\s+/gu, "").replace(/[（(].*?[）)]/gu, "").toLowerCase();
}

function findApplicationWebsiteByLooseMatch(
  record: ApplicationRecord,
  items: ApplicationLinkSource[]
): string | null {
  const recordSchool = normalizeApplicationMatchText(record.school);
  const recordDeadline = normalizeDeadlineTimestamp(record.deadlineAt);
  const recordDate = normalizeDeadlineCalendarDate(record.deadlineAt) || normalizeDeadlineCalendarDate(record.deadlineText);
  if (recordSchool === "" || record.institute.trim() === "") {
    return null;
  }

  const candidates = items
    .map((item) => {
      const itemDeadline = normalizeDeadlineTimestamp(item.deadlineAt);
      const itemDate =
        normalizeDeadlineCalendarDate(item.deadlineAt) || normalizeDeadlineCalendarDate(item.deadlineText ?? "");
      const instituteScore = scoreInstituteMatch(record.institute, item.institute);
      const deadlineScore =
        recordDeadline !== "" && itemDeadline === recordDeadline
          ? 40
          : recordDate !== "" && itemDate === recordDate
            ? 30
            : 0;
      return {
        item,
        deadlineScore,
        instituteScore,
        school: normalizeApplicationMatchText(item.school),
        totalScore: instituteScore + deadlineScore
      };
    })
    .filter((entry) => entry.school === recordSchool && entry.item.website.trim() !== "" && entry.instituteScore >= 55)
    .sort((left, right) => {
      if (right.totalScore !== left.totalScore) {
        return right.totalScore - left.totalScore;
      }
      return right.item.institute.length - left.item.institute.length;
    });

  const deadlineMatch = candidates.find((entry) => entry.deadlineScore > 0);
  if (deadlineMatch !== undefined) {
    return deadlineMatch.item.website.trim();
  }

  const selfNamedSchoolMatch = findUniqueSelfNamedSchoolWebsite(recordSchool, items);
  if (selfNamedSchoolMatch !== null) {
    return selfNamedSchoolMatch;
  }

  const strongMatches = candidates.filter((entry) => entry.instituteScore >= 85);
  const [best, second] = strongMatches;
  if (best === undefined) {
    return null;
  }
  if (second !== undefined && second.instituteScore === best.instituteScore) {
    return null;
  }
  return best.item.website.trim();
}

function findUniqueSelfNamedSchoolWebsite(recordSchool: string, items: ApplicationLinkSource[]): string | null {
  const matches = items.filter((item) => {
    const website = item.website.trim();
    if (website === "") {
      return false;
    }
    const school = normalizeApplicationMatchText(item.school);
    const institute = normalizeApplicationMatchText(item.institute);
    return school === recordSchool && institute === recordSchool;
  });
  return matches.length === 1 ? matches[0]?.website.trim() ?? null : null;
}

function hasSharedInstituteKeyword(left: string, right: string): boolean {
  const leftTokens = getInstituteKeywords(left);
  const rightTokens = getInstituteKeywords(right);
  return leftTokens.some((token) =>
    rightTokens.some((rightToken) => rightToken.includes(token) || token.includes(rightToken))
  );
}

function getInstituteKeywords(value: string): string[] {
  return value
    .replace(APPLICATION_ACTIVITY_WORDS, " ")
    .replace(/学院|学部|研究院|中心|系/gu, " ")
    .split(/[-—_·、，,/\s]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function scoreInstituteMatch(left: string, right: string): number {
  const normalizedLeft = normalizeApplicationMatchText(left);
  const normalizedRight = normalizeApplicationMatchText(right);
  if (normalizedLeft === "" || normalizedRight === "") {
    return 0;
  }
  if (normalizedLeft === normalizedRight) {
    return 100;
  }

  const comparableLeft = normalizeApplicationInstituteText(left);
  const comparableRight = normalizeApplicationInstituteText(right);
  if (comparableLeft === "" || comparableRight === "") {
    return 0;
  }
  if (comparableLeft === comparableRight) {
    return 98;
  }
  if (comparableLeft.includes(comparableRight) || comparableRight.includes(comparableLeft)) {
    const shorterLength = Math.min(comparableLeft.length, comparableRight.length);
    const longerLength = Math.max(comparableLeft.length, comparableRight.length);
    if (shorterLength < 4) {
      return 0;
    }
    return 82 + Math.round((shorterLength / longerLength) * 12);
  }
  return hasSharedInstituteKeyword(normalizedLeft, normalizedRight) ? 60 : 0;
}

const APPLICATION_ACTIVITY_WORDS =
  /20\d{2}年?|第[一二三四五六七八九十\d]+届|优秀大学生暑期开放营|优秀大学生|全国大学生|大学生|暑期|夏季|夏令营|学术探索营|学术交流营|校园开放日|开放日|科学营|交流营|实践活动|活动|线上宣讲|预推免|硕士登记|报名|通知|官网|问卷|最终截止|系统截止|截止/gu;

function normalizeApplicationInstituteText(value: string): string {
  return normalizeApplicationMatchText(value)
    .replace(APPLICATION_ACTIVITY_WORDS, "")
    .replace(/[-—_·、，,/.=:=+|\\[\]【】{}<>《》"'“”‘’\s]+/gu, "")
    .trim();
}

function normalizeDeadlineTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.trim() : date.toISOString();
}

function normalizeDeadlineCalendarDate(value: string): string {
  const text = value.trim();
  const explicitDate = text.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/u);
  if (explicitDate !== null) {
    return `${explicitDate[1]}-${explicitDate[2]?.padStart(2, "0")}-${explicitDate[3]?.padStart(2, "0")}`;
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year !== undefined && month !== undefined && day !== undefined ? `${year}-${month}-${day}` : "";
}

function assertRecordExists(data: ApplicationTrackerData, id: string, prefix: string): void {
  if (!data.records.some((record) => record.id === id)) {
    throw new Error(`${prefix}: 找不到记录 ${id}`);
  }
}

function isApplicationRecord(value: ApplicationRecord): boolean {
  return value.id !== "" && value.school !== "";
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (!isRecordObject(value)) {
    throw new Error(`${fieldName} 必须是对象`);
  }
  return value;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function requireString(value: unknown, fieldName: string): string {
  const next = readString(value).trim();
  if (next === "") {
    throw new Error(`${fieldName} 不能为空`);
  }
  return next;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function readEnum<T extends string>(value: unknown, values: T[], fieldName: string, fallback?: T): T {
  if (typeof value === "string" && values.includes(value as T)) {
    return value as T;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new Error(`${fieldName} 不是合法取值`);
}

function hashString(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function formatPatchTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}
