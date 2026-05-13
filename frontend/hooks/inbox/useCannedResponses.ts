"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { apiUrl } from "../../lib/api";
import { parseApiError } from "../../lib/apiResult";

export type CannedResponse = {
  id: number;
  name: string;
  shortcut: string | null;
  body: string;
  owner_id: number | null;
  is_shared: boolean;
  use_count: number;
  created_at: string;
  updated_at: string;
};

export type UseCannedResponses = {
  canned: CannedResponse[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  create: (p: { name: string; body: string; shortcut?: string | null; is_shared?: boolean }) => Promise<{ ok: boolean; error?: string }>;
  update: (id: number, p: Partial<Pick<CannedResponse, "name" | "body" | "shortcut" | "is_shared">>) => Promise<{ ok: boolean; error?: string }>;
  remove: (id: number) => Promise<{ ok: boolean; error?: string }>;
  /** Fire-and-forget — bumps the use_count without blocking the UI. */
  markUsed: (id: number) => void;
};

export default function useCannedResponses(): UseCannedResponses {
  const { authHeaders, token } = useAuth();
  const [canned, setCanned] = useState<CannedResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/inbox/canned-responses"), {
        cache: "no-store",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(parseApiError(body, res.status));
        return;
      }
      setCanned(Array.isArray(body.canned) ? body.canned : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load canned responses.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const create = useCallback<UseCannedResponses["create"]>(
    async (p) => {
      try {
        const res = await fetch(apiUrl("/inbox/canned-responses"), {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify(p),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.canned) return { ok: false, error: parseApiError(body, res.status) };
        setCanned((prev) => [...prev, body.canned].sort(byShareThenName));
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Create failed." };
      }
    },
    [authHeaders]
  );

  const update = useCallback<UseCannedResponses["update"]>(
    async (id, p) => {
      try {
        const res = await fetch(apiUrl(`/inbox/canned-responses/${id}`), {
          method: "PATCH",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify(p),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.canned) return { ok: false, error: parseApiError(body, res.status) };
        setCanned((prev) => prev.map((c) => (c.id === id ? body.canned : c)).sort(byShareThenName));
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Update failed." };
      }
    },
    [authHeaders]
  );

  const remove = useCallback<UseCannedResponses["remove"]>(
    async (id) => {
      const prev = canned;
      setCanned((p) => p.filter((c) => c.id !== id));
      try {
        const res = await fetch(apiUrl(`/inbox/canned-responses/${id}`), {
          method: "DELETE",
          headers: { ...authHeaders() },
        });
        if (!res.ok) {
          setCanned(prev);
          const body = await res.json().catch(() => ({}));
          return { ok: false, error: parseApiError(body, res.status) };
        }
        return { ok: true };
      } catch (e) {
        setCanned(prev);
        return { ok: false, error: e instanceof Error ? e.message : "Delete failed." };
      }
    },
    [authHeaders, canned]
  );

  const markUsed = useCallback<UseCannedResponses["markUsed"]>(
    (id) => {
      // Fire-and-forget. Don't await; don't refetch.
      void fetch(apiUrl(`/inbox/canned-responses/${id}/used`), {
        method: "POST",
        headers: { ...authHeaders() },
      });
      setCanned((prev) => prev.map((c) => (c.id === id ? { ...c, use_count: c.use_count + 1 } : c)));
    },
    [authHeaders]
  );

  return { canned, loading, error, refetch, create, update, remove, markUsed };
}

function byShareThenName(a: CannedResponse, b: CannedResponse): number {
  if (a.is_shared !== b.is_shared) return a.is_shared ? -1 : 1;
  return a.name.localeCompare(b.name);
}
