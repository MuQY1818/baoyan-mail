import { useCallback, useEffect, useState } from "react";

export function useStoredKeySet(key: string): [Set<string>, (value: string) => void] {
  const [values, setValues] = useState<Set<string>>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return new Set(raw === null ? [] : (JSON.parse(raw) as string[]));
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify([...values]));
    } catch {
      // Keep the in-memory state when browser storage is unavailable.
    }
  }, [key, values]);

  const toggle = useCallback((value: string): void => {
    setValues((previous) => {
      const next = new Set(previous);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  }, []);

  return [values, toggle];
}
