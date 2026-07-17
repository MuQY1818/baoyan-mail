import {
  APPLICATION_TRACKER_STORAGE_KEY,
  createEmptyTrackerData,
  normalizeTrackerData,
  type ApplicationTrackerData
} from "../applicationTracker";

export function readStoredApplicationData(): ApplicationTrackerData {
  try {
    const raw = window.localStorage.getItem(APPLICATION_TRACKER_STORAGE_KEY);
    return raw === null ? createEmptyTrackerData() : normalizeTrackerData(JSON.parse(raw));
  } catch {
    return createEmptyTrackerData();
  }
}

export function persistApplicationData(data: ApplicationTrackerData): void {
  window.localStorage.setItem(APPLICATION_TRACKER_STORAGE_KEY, JSON.stringify(data));
}
