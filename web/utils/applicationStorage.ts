import {
  APPLICATION_TRACKER_STORAGE_KEY,
  APPLICATION_TRACKER_SCHEMA,
  createEmptyTrackerData,
  normalizeTrackerData,
  type ApplicationTrackerData
} from "../applicationTracker";

export function readStoredApplicationData(): ApplicationTrackerData {
  const raw = window.localStorage.getItem(APPLICATION_TRACKER_STORAGE_KEY);
  return raw === null ? createEmptyTrackerData() : validateApplicationData(JSON.parse(raw));
}

export function validateApplicationData(value: unknown): ApplicationTrackerData {
  if (typeof value !== "object" || value === null || !("schema" in value) ||
      value.schema !== APPLICATION_TRACKER_SCHEMA || !("records" in value) ||
      !Array.isArray(value.records)) {
    throw new Error("申请数据格式或版本不受支持，请先备份并恢复原始数据");
  }
  const normalized = normalizeTrackerData(value);
  // 缺失的旧版可选字段允许迁移；已存在但损坏的字段不能被默认值静默替代。
  value.records.forEach((raw, index) => {
    const record = raw as Record<string, unknown>;
    const next = normalized.records[index];
    if (!next) throw new Error("申请记录损坏，已阻止覆盖");
    for (const field of ["status", "priority", "result", "activityType"] as const) {
      if (record[field] !== undefined && record[field] !== next[field]) throw new Error(`申请 ${field} 损坏，已阻止覆盖`);
    }
    for (const field of ["notes", "school", "institute", "website", "deadlineAt", "deadlineText"] as const) {
      if (record[field] !== undefined && typeof record[field] !== "string") throw new Error(`申请 ${field} 格式错误，已阻止覆盖`);
    }
    for (const field of ["areas", "materials", "events"] as const) {
      if (record[field] !== undefined && !Array.isArray(record[field])) throw new Error(`申请 ${field} 格式错误，已阻止覆盖`);
    }
    for (const field of ["materials", "events"] as const) {
      const entries = next[field];
      if (new Set(entries.map((entry) => entry.id)).size !== entries.length) throw new Error(`申请 ${field} ID 重复，已阻止覆盖`);
    }
  });
  if (normalized.records.length !== value.records.length ||
      new Set(normalized.records.map((record) => record.id)).size !== normalized.records.length) {
    throw new Error("申请记录损坏或 ID 重复，已阻止覆盖");
  }
  return normalized;
}

export function persistApplicationData(data: ApplicationTrackerData, expectedRaw?: string | null): void {
  // UI 与 Agent 共用此入口。损坏数据必须显式恢复，不能自动覆盖。
  readStoredApplicationData();
  if (expectedRaw !== undefined && window.localStorage.getItem(APPLICATION_TRACKER_STORAGE_KEY) !== expectedRaw) {
    throw new Error("申请数据已在其他页面更新，请刷新后再保存；当前草稿仍保留");
  }
  window.localStorage.setItem(APPLICATION_TRACKER_STORAGE_KEY, JSON.stringify(validateApplicationData(data)));
}
