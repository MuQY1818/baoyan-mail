import {
  APPLICATION_VIEW_DESKTOP_STORAGE_KEY,
  APPLICATION_VIEW_MOBILE_STORAGE_KEY,
  DDL_VIEW_DESKTOP_STORAGE_KEY,
  DDL_VIEW_MOBILE_STORAGE_KEY,
  MAIN_TAB_STORAGE_KEY,
  MOBILE_VIEW_MEDIA_QUERY,
  THEME_STORAGE_KEY
} from "../constants";
import type { MainTab, ThemeMode, ViewMode } from "../types";

export function readInitialTheme(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") {
      return stored;
    }
  } catch {
    // Fall back to system preference below.
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function readStoredMainTab(): MainTab {
  try {
    const value = window.localStorage.getItem(MAIN_TAB_STORAGE_KEY);
    if (value === "ddl" || value === "applications" || value === "calendar") {
      return value;
    }
  } catch {
    // Fall through to the default tab.
  }
  return "ddl";
}

export function matchesMobileViewport(): boolean {
  return window.matchMedia?.(MOBILE_VIEW_MEDIA_QUERY).matches ?? false;
}

function getViewStorageKey(kind: "ddl" | "application", mobile: boolean): string {
  if (kind === "application") {
    return mobile ? APPLICATION_VIEW_MOBILE_STORAGE_KEY : APPLICATION_VIEW_DESKTOP_STORAGE_KEY;
  }
  return mobile ? DDL_VIEW_MOBILE_STORAGE_KEY : DDL_VIEW_DESKTOP_STORAGE_KEY;
}

export function readStoredViewMode(kind: "ddl" | "application", mobile: boolean): ViewMode {
  try {
    const value = window.localStorage.getItem(getViewStorageKey(kind, mobile));
    if (value === "cards" || value === "table") {
      return value;
    }
  } catch {
    // Use the responsive default when browser storage is unavailable.
  }
  return mobile ? "cards" : "table";
}

export function persistViewMode(kind: "ddl" | "application", mobile: boolean, value: ViewMode): void {
  try {
    window.localStorage.setItem(getViewStorageKey(kind, mobile), value);
  } catch {
    // The in-memory view selection still works for this session.
  }
}
