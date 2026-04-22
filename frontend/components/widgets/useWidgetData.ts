"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { apiUrl } from "../../lib/api";

export function useWidgetData<T>(widgetId: string, query: Record<string, string | number> = {}) {
  const { authHeaders, token } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const qs = new URLSearchParams(
    Object.entries(query).map(([k, v]) => [k, String(v)])
  ).toString();

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const res = await fetch(
        apiUrl(`/widgets/data/${widgetId}${qs ? `?${qs}` : ""}`),
        { cache: "no-store", headers: { ...authHeaders() } }
      );
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const body = (await res.json()) as T;
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [token, authHeaders, widgetId, qs]);

  useEffect(() => {
    load();
    const t = setInterval(load, 2 * 60_000);
    return () => clearInterval(t);
  }, [load]);

  return { data, loading, error, reload: load };
}

export function timeAgo(iso?: string | null): string {
  if (!iso) return "";
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "";
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const days = Math.floor(diff / 86400);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatCurrency(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  return `$${Math.round(n).toLocaleString("en-US")}`;
}
