"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { apiUrl } from "../lib/api";
import { DEFAULT_PREFS, mergePrefs, type LayoutPrefs } from "../lib/layoutPrefs";

export function useLayoutPrefs() {
  const { authHeaders, token } = useAuth();
  const [prefs, setPrefs] = useState<LayoutPrefs>(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl("/user-preferences/layout"), {
        cache: "no-store",
        headers: { ...authHeaders() },
      });
      if (!res.ok) throw new Error("load failed");
      const body = await res.json();
      setPrefs(mergePrefs(body));
    } catch {
      setPrefs(DEFAULT_PREFS);
    } finally {
      setLoaded(true);
    }
  }, [token, authHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(
    async (next: LayoutPrefs) => {
      if (!token) return;
      try {
        await fetch(apiUrl("/user-preferences/layout"), {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(next),
        });
      } catch {
        /* silent */
      }
    },
    [token, authHeaders]
  );

  const update = useCallback(
    (updater: (p: LayoutPrefs) => LayoutPrefs, debounceMs = 0) => {
      setPrefs((prev) => {
        const next = updater(prev);
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          save(next);
        }, debounceMs);
        return next;
      });
    },
    [save]
  );

  const saveNow = useCallback(
    (next: LayoutPrefs) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setPrefs(next);
      return save(next);
    },
    [save]
  );

  const reset = useCallback(async () => {
    if (!token) return;
    try {
      await fetch(apiUrl("/user-preferences/layout/reset"), {
        method: "PUT",
        headers: { ...authHeaders() },
      });
    } catch {
      /* silent */
    }
    setPrefs(DEFAULT_PREFS);
  }, [token, authHeaders]);

  return { prefs, setPrefs, loaded, save, saveNow, update, reset };
}
