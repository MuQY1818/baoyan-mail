import { useCallback, useEffect, useRef, useState } from "react";
import type { DdlResponse } from "../types";

export function useDdlData() {
  const [data, setData] = useState<DdlResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const active = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const timeout = window.setTimeout(() => controller.abort(new Error("请求超时，请重试")), 20_000);
    setIsLoading(true);
    try {
      const response = await fetch("/api/ddl", { signal: controller.signal, cache: "no-cache" });
      if (!response.ok) throw new Error(`数据接口返回 ${response.status}，请稍后重试`);
      const body = await response.json() as DdlResponse;
      if (body.ok !== true || !Array.isArray(body.items)) throw new Error("数据格式异常，请重试");
      if (active.current === controller) { setData(body); setError(null); }
    } catch (failure) {
      if (active.current === controller) setError(controller.signal.aborted ? "请求超时，请重试" : failure instanceof Error ? failure.message : "数据加载失败，请重试");
    } finally {
      window.clearTimeout(timeout);
      if (active.current === controller) setIsLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    return () => { active.current?.abort(); active.current = null; };
  }, [refresh]);
  return { data, error, isLoading, refresh };
}
