import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { readStoredViewMode } from "../utils/storage";
import { readFiltersFromUrl, writeFiltersToUrl } from "../utils/urlFilters";

/** 集中管理分享链接、筛选状态和不同设备的视图偏好。 */
export function useDdlFilters(isMobile: boolean) {
  const initial = useMemo(readFiltersFromUrl, []);
  const [query, setQuery] = useState(initial.query);
  const deferredQuery = useDeferredValue(query);
  const [range, setRange] = useState(initial.range);
  const [source, setSource] = useState(initial.source);
  const [relevance, setRelevance] = useState(initial.relevance);
  const [activityType, setActivityType] = useState(initial.activityType);
  const [recent, setRecent] = useState(initial.recent);
  const [viewMode, setViewMode] = useState(initial.viewMode);
  const [mainTab, setMainTab] = useState(initial.mainTab);
  const [activeTiers, setActiveTiers] = useState(initial.tiers);
  const [activeAreas, setActiveAreas] = useState(initial.areas);
  const previousMobile = useRef(isMobile);

  useEffect(() => {
    writeFiltersToUrl({ activeAreas, activeTiers, query, range, recent, relevance, source, activityType, viewMode, mainTab });
  }, [activeAreas, activeTiers, query, range, recent, relevance, source, activityType, viewMode, mainTab]);

  useEffect(() => {
    if (previousMobile.current === isMobile) return;
    previousMobile.current = isMobile;
    setViewMode(readStoredViewMode("ddl", isMobile));
  }, [isMobile]);

  return { query, setQuery, deferredQuery, range, setRange, source, setSource, relevance, setRelevance,
    activityType, setActivityType, recent, setRecent, viewMode, setViewMode, mainTab, setMainTab,
    activeTiers, setActiveTiers, activeAreas, setActiveAreas };
}
