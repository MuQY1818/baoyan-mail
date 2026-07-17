import { ANALYTICS_VISIT_STORAGE_KEY } from "../constants";

export function sendDailyVisitPing(): void {
  const today = new Date().toISOString().slice(0, 10);
  try {
    if (window.localStorage.getItem(ANALYTICS_VISIT_STORAGE_KEY) === today) {
      return;
    }
    window.localStorage.setItem(ANALYTICS_VISIT_STORAGE_KEY, today);
  } catch {
    // Still allow one anonymous aggregate ping if storage is unavailable.
  }

  const body = JSON.stringify({ page: "ddl" });
  if (navigator.sendBeacon !== undefined) {
    const blob = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon("/api/analytics/visit", blob)) {
      return;
    }
  }

  void fetch("/api/analytics/visit", {
    body,
    headers: { "content-type": "application/json" },
    keepalive: true,
    method: "POST"
  }).catch(() => undefined);
}
