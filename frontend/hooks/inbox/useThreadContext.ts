"use client";

// Powers the right-hand context panel on the conversation view.
// Fetches in parallel with useThreadDetail so message rendering isn't
// blocked on AppFolio data.

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { apiUrl } from "../../lib/api";
import { parseApiError } from "../../lib/apiResult";

export type ContextProperty = {
  name: string;
  address: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  portfolio?: string | null;
  beds?: number | null;
  baths?: number | null;
  sqft?: number | null;
  type?: string | null;
};

export type ContextLease = {
  status: string | null;
  tenant: string | null;
  rent: number | null;
  marketRent?: number | null;
  start: string | null;
  end: string | null;
  tenantEmail?: string | null;
  tenantPhone?: string | null;
  additionalTenants?: string | null;
};

export type ContextWorkOrder = {
  id: string | null;
  title: string;
  vendor: string | null;
  status: string | null;
  priority: string;
  date: string | null;
};

export type ContextPastConversation = {
  threadId: string;
  subject: string | null;
  lastMessageAt: string;
  channel: string;
};

export type ContextNote = {
  id: number;
  entityKind: "property" | "tenant" | "owner";
  body: string;
  authorName: string | null;
  createdAt: string;
};

export type ThreadContext = {
  hasLinkedEntity: boolean;
  property: ContextProperty | null;
  lease: ContextLease | null;
  workOrders: ContextWorkOrder[];
  pastConversations: ContextPastConversation[];
  notes: ContextNote[];
  entityKey: string | null;
  linkedTenant: string | null;
  linkedOwner: string | null;
};

export type UseThreadContext = {
  data: ThreadContext | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  addNote: (body: string) => Promise<{ ok: boolean; error?: string }>;
  deleteNote: (id: number) => Promise<{ ok: boolean; error?: string }>;
};

const EMPTY: UseThreadContext = {
  data: null,
  loading: false,
  error: null,
  refetch: async () => undefined,
  addNote: async () => ({ ok: false }),
  deleteNote: async () => ({ ok: false }),
};

export default function useThreadContext(threadId: string | null): UseThreadContext {
  const { authHeaders, token } = useAuth();
  const [data, setData] = useState<ThreadContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!token || !threadId) {
      setData(null);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        apiUrl(`/inbox/threads/${encodeURIComponent(threadId)}/context`),
        { cache: "no-store", headers: { ...authHeaders() } }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(parseApiError(body, res.status));
        return;
      }
      setData(body as ThreadContext);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load context.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token, threadId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const addNote = useCallback<UseThreadContext["addNote"]>(
    async (body) => {
      if (!threadId) return { ok: false, error: "No thread selected." };
      const text = body.trim();
      if (!text) return { ok: false, error: "Note can't be empty." };
      try {
        const res = await fetch(
          apiUrl(`/inbox/threads/${encodeURIComponent(threadId)}/notes`),
          {
            method: "POST",
            headers: { ...authHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({ body: text, entityKind: "property" }),
          }
        );
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.note) {
          return { ok: false, error: parseApiError(j, res.status) };
        }
        setData((prev) =>
          prev ? { ...prev, notes: [j.note as ContextNote, ...prev.notes] } : prev
        );
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Add-note failed." };
      }
    },
    [authHeaders, threadId]
  );

  const deleteNote = useCallback<UseThreadContext["deleteNote"]>(
    async (id) => {
      const prev = data;
      setData((d) => (d ? { ...d, notes: d.notes.filter((n) => n.id !== id) } : d));
      try {
        const res = await fetch(apiUrl(`/inbox/threads/notes/${id}`), {
          method: "DELETE",
          headers: { ...authHeaders() },
        });
        if (!res.ok) {
          setData(prev);
          const j = await res.json().catch(() => ({}));
          return { ok: false, error: parseApiError(j, res.status) };
        }
        return { ok: true };
      } catch (e) {
        setData(prev);
        return { ok: false, error: e instanceof Error ? e.message : "Delete failed." };
      }
    },
    [authHeaders, data]
  );

  if (!threadId) return EMPTY;
  return { data, loading, error, refetch: fetchData, addNote, deleteNote };
}
