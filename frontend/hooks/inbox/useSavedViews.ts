"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { apiUrl } from "../../lib/api";
import { networkErrorMessage, parseApiError, type ApiResult } from "../../lib/apiResult";

/** Filter shape stored on a saved view. The keys mirror the
 *  /inbox/threads query params so the frontend can apply a view by
 *  pushing them into useThreadList's filter state. */
export type SavedViewFilters = {
  bucket?: string;
  status?: string;
  category?: string | null;
  assignedTo?: number | null;
  assignedToMe?: boolean;
  unassigned?: boolean;
  starred?: boolean;
  has_unread?: boolean;
  priority?: "emergency" | "high" | "normal" | "low";
  priority_in?: ("emergency" | "high" | "normal" | "low")[];
  sla_breached?: boolean;
  search?: string;
  connectionId?: number | null;
};

export type SavedView = {
  id: number;
  name: string;
  icon: string | null;
  owner_id: number | null;
  is_shared: boolean;
  filters: SavedViewFilters;
  sort: { sort?: "newest" | "oldest" | "priority" | "updated" } | null;
  position: number;
  created_at: string;
  updated_at: string;
  open_count?: number | null;
};

export type UseSavedViews = {
  views: SavedView[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  create: (input: {
    name: string;
    icon?: string | null;
    filters: SavedViewFilters;
    sort?: { sort?: string } | null;
    is_shared?: boolean;
  }) => Promise<ApiResult<SavedView>>;
  update: (id: number, patch: Partial<SavedView>) => Promise<ApiResult<SavedView>>;
  remove: (id: number) => Promise<ApiResult<void>>;
};

/** Counts refresh every 30 seconds per spec acceptance. */
const COUNT_POLL_MS = 30_000;

export default function useSavedViews(): UseSavedViews {
  const { authHeaders, token } = useAuth();
  const [views, setViews] = useState<SavedView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const fetchViews = useCallback(
    async (withCounts: boolean) => {
      if (!token) return;
      try {
        const url = withCounts ? "/inbox/views?with_counts=true" : "/inbox/views";
        const res = await fetch(apiUrl(url), {
          cache: "no-store",
          headers: { ...authHeaders() },
        });
        const body = await res.json().catch(() => ({}));
        if (cancelRef.current) return;
        if (!res.ok) {
          setError(parseApiError(body, res.status));
          return;
        }
        if (Array.isArray(body.views)) setViews(body.views as SavedView[]);
        setError(null);
      } catch (e) {
        if (!cancelRef.current) setError(networkErrorMessage(e));
      } finally {
        if (!cancelRef.current) setLoading(false);
      }
    },
    [authHeaders, token]
  );

  useEffect(() => {
    cancelRef.current = false;
    void fetchViews(true);
    const id = setInterval(() => void fetchViews(true), COUNT_POLL_MS);
    return () => {
      cancelRef.current = true;
      clearInterval(id);
    };
  }, [fetchViews]);

  const refetch = useCallback(() => fetchViews(true), [fetchViews]);

  const create = useCallback<UseSavedViews["create"]>(
    async (input) => {
      try {
        const res = await fetch(apiUrl("/inbox/views"), {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.view) {
          return { ok: false, error: parseApiError(body, res.status) };
        }
        const created = body.view as SavedView;
        setViews((prev) => [...prev, created]);
        return { ok: true, data: created };
      } catch (e) {
        return { ok: false, error: networkErrorMessage(e) };
      }
    },
    [authHeaders]
  );

  const update = useCallback<UseSavedViews["update"]>(
    async (id, patch) => {
      try {
        const res = await fetch(apiUrl(`/inbox/views/${id}`), {
          method: "PATCH",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.view) {
          return { ok: false, error: parseApiError(body, res.status) };
        }
        const updated = body.view as SavedView;
        setViews((prev) => prev.map((v) => (v.id === id ? { ...v, ...updated } : v)));
        return { ok: true, data: updated };
      } catch (e) {
        return { ok: false, error: networkErrorMessage(e) };
      }
    },
    [authHeaders]
  );

  const remove = useCallback<UseSavedViews["remove"]>(
    async (id) => {
      try {
        const res = await fetch(apiUrl(`/inbox/views/${id}`), {
          method: "DELETE",
          headers: { ...authHeaders() },
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          return { ok: false, error: parseApiError(body, res.status) };
        }
        setViews((prev) => prev.filter((v) => v.id !== id));
        return { ok: true, data: undefined };
      } catch (e) {
        return { ok: false, error: networkErrorMessage(e) };
      }
    },
    [authHeaders]
  );

  return { views, loading, error, refetch, create, update, remove };
}
