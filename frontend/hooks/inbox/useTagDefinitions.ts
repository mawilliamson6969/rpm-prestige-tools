"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { apiUrl } from "../../lib/api";
import { parseApiError } from "../../lib/apiResult";

export type TagDefinition = {
  id: number;
  name: string;
  color: string;
  description: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  usage_count: number;
};

export type UseTagDefinitions = {
  tags: TagDefinition[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  create: (p: { name: string; color: string; description?: string | null }) => Promise<{ ok: boolean; error?: string }>;
  update: (id: number, p: Partial<Pick<TagDefinition, "name" | "color" | "description">>) => Promise<{ ok: boolean; error?: string }>;
  remove: (id: number) => Promise<{ ok: boolean; error?: string }>;
};

export default function useTagDefinitions(): UseTagDefinitions {
  const { authHeaders, token } = useAuth();
  const [tags, setTags] = useState<TagDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/inbox/tag-definitions"), {
        cache: "no-store",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(parseApiError(body, res.status));
        return;
      }
      setTags(Array.isArray(body.tags) ? body.tags : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tags.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const create = useCallback<UseTagDefinitions["create"]>(
    async (p) => {
      try {
        const res = await fetch(apiUrl("/inbox/tag-definitions"), {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify(p),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.tag) {
          return { ok: false, error: parseApiError(body, res.status) };
        }
        setTags((prev) => [...prev, body.tag].sort((a, b) => a.name.localeCompare(b.name)));
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Create failed." };
      }
    },
    [authHeaders]
  );

  const update = useCallback<UseTagDefinitions["update"]>(
    async (id, p) => {
      try {
        const res = await fetch(apiUrl(`/inbox/tag-definitions/${id}`), {
          method: "PATCH",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify(p),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.tag) {
          return { ok: false, error: parseApiError(body, res.status) };
        }
        setTags((prev) => prev.map((t) => (t.id === id ? { ...t, ...body.tag } : t)));
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Update failed." };
      }
    },
    [authHeaders]
  );

  const remove = useCallback<UseTagDefinitions["remove"]>(
    async (id) => {
      const prev = tags;
      setTags((p) => p.filter((t) => t.id !== id));
      try {
        const res = await fetch(apiUrl(`/inbox/tag-definitions/${id}`), {
          method: "DELETE",
          headers: { ...authHeaders() },
        });
        if (!res.ok) {
          setTags(prev);
          const body = await res.json().catch(() => ({}));
          return { ok: false, error: parseApiError(body, res.status) };
        }
        return { ok: true };
      } catch (e) {
        setTags(prev);
        return { ok: false, error: e instanceof Error ? e.message : "Delete failed." };
      }
    },
    [authHeaders, tags]
  );

  return { tags, loading, error, refetch, create, update, remove };
}
