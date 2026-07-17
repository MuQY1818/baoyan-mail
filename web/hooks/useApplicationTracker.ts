import { useEffect, useState } from "react";
import type React from "react";
import {
  APPLICATION_TRACKER_SCHEMA,
  APPLICATION_TRACKER_STORAGE_KEY,
  createEmptyTrackerData,
  normalizeTrackerData,
  type ApplicationTrackerData
} from "../applicationTracker";
import type { ApplicationStorageIssue } from "../types";

export function useApplicationTracker(): [
  ApplicationTrackerData,
  React.Dispatch<React.SetStateAction<ApplicationTrackerData>>,
  ApplicationStorageIssue | null,
  () => void
] {
  const [initialState] = useState((): {
    data: ApplicationTrackerData;
    issue: ApplicationStorageIssue | null;
  } => {
    let raw = "";
    try {
      raw = window.localStorage.getItem(APPLICATION_TRACKER_STORAGE_KEY) ?? "";
      if (raw === "") {
        return { data: createEmptyTrackerData(), issue: null };
      }
      const parsed = JSON.parse(raw) as unknown;
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("schema" in parsed) ||
        parsed.schema !== APPLICATION_TRACKER_SCHEMA ||
        !("records" in parsed) ||
        !Array.isArray(parsed.records)
      ) {
        throw new Error("数据格式或版本不受支持");
      }
      return { data: normalizeTrackerData(parsed), issue: null };
    } catch (error) {
      return {
        data: createEmptyTrackerData(),
        issue: {
          message: error instanceof Error ? error.message : "本地数据解析失败",
          rawValue: raw
        }
      };
    }
  });
  const [data, setData] = useState<ApplicationTrackerData>(initialState.data);
  const [storageIssue, setStorageIssue] = useState<ApplicationStorageIssue | null>(initialState.issue);

  useEffect(() => {
    if (storageIssue !== null) {
      return;
    }
    try {
      window.localStorage.setItem(APPLICATION_TRACKER_STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      setStorageIssue({
        message: error instanceof Error ? error.message : "浏览器拒绝写入本地数据",
        rawValue: JSON.stringify(data)
      });
    }
  }, [data, storageIssue]);

  function resetStorage(): void {
    const empty = createEmptyTrackerData();
    try {
      window.localStorage.setItem(APPLICATION_TRACKER_STORAGE_KEY, JSON.stringify(empty));
      setData(empty);
      setStorageIssue(null);
    } catch (error) {
      setStorageIssue({
        message: error instanceof Error ? error.message : "浏览器拒绝重置本地数据",
        rawValue: storageIssue?.rawValue ?? ""
      });
    }
  }

  return [data, setData, storageIssue, resetStorage];
}
