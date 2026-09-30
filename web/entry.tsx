import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { SeasonFinale } from "./pages/SeasonFinale";
import { resolveSitePage } from "./siteRoutes";

const ArchivedWorkspace = lazy(() => import("./main").then((module) => ({ default: module.App })));
const page = resolveSitePage(window.location.pathname);

if (page === "archive") {
  document.title = "保研进度台 · 本季归档";
  document.querySelector('meta[name="robots"]')?.setAttribute("content", "noindex, nofollow");
} else if (window.location.pathname === "/") {
  window.history.replaceState(null, "", `/celebration${window.location.search}${window.location.hash}`);
}

const rootElement = document.getElementById("root");
if (rootElement !== null) {
  createRoot(rootElement).render(
    <React.StrictMode>
      {page === "archive" ? (
        <Suspense fallback={<p role="status">正在打开本季归档…</p>}>
          <ArchivedWorkspace />
        </Suspense>
      ) : <SeasonFinale />}
    </React.StrictMode>
  );
}
