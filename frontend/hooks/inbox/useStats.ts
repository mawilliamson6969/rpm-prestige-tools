"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { apiUrl } from "../../lib/api";
import { parseApiError } from "../../lib/apiResult";
import type { Stats } from "./types";

export type UseStats = {
  stats: Stats | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
};

const POLL_INTERVAL_MS = 60_000;

export default function useStats(): UseStats {
  const { authHeaders } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/inbox/stats"), {
        cache: "no-store",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (cancelRef.current) return;
      if (!res.ok) {
        setError(parseApiError(body, res.status));
        return;
      }
      setStats(body as Stats);
      setError(null);
    } catch (e) {
      if (!cancelRef.current) setError(e instanceof Error ? e.message : "Failed to load stats.");
    } finally {
      if (!cancelRef.current) setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    cancelRef.current = false;
    void refetch();
    const id = setInterval(() => void refetch(), POLL_INTERVAL_MS);
    return () => {
      cancelRef.current = true;
      clearInterval(id);
    };
  }, [refetch]);

  return { stats, loading, error, refetch };
}
