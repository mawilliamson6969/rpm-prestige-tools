"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { apiUrl } from "../../lib/api";
import { networkErrorMessage, parseApiError, type ApiResult } from "../../lib/apiResult";
import type { AiDraftPayload, ResponseRow, SlaPayload, TicketRow } from "./types";

export type UseThreadDetailOptions = {
  selectedId: number | null;
  onTicketChanged?: (id: number, patch: Partial<TicketRow>) => void;
  onAiDraftSeed?: (draft: AiDraftPayload) => void;
};

export type UseThreadDetail = {
  thread: TicketRow | null;
  messages: ResponseRow[];
  sla: SlaPayload | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  updateThread: (patch: Record<string, unknown>) => Promise<ApiResult<TicketRow>>;
  toggleStar: (ticket: TicketRow) => Promise<ApiResult<TicketRow>>;
  markAsRead: (id: number) => Promise<ApiResult<void>>;
  patchThread: (patch: Partial<TicketRow>) => void;
};

export default function useThreadDetail({
  selectedId,
  onTicketChanged,
  onAiDraftSeed,
}: UseThreadDetailOptions): UseThreadDetail {
  const { authHeaders } = useAuth();
  const [thread, setThread] = useState<TicketRow | null>(null);
  const [messages, setMessages] = useState<ResponseRow[]>([]);
  const [sla, setSla] = useState<SlaPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onTicketChangedRef = useRef(onTicketChanged);
  const onAiDraftSeedRef = useRef(onAiDraftSeed);
  onTicketChangedRef.current = onTicketChanged;
  onAiDraftSeedRef.current = onAiDraftSeed;

  const loadDetail = useCallback(
    async (id: number) => {
      setLoading(true);
      try {
        const res = await fetch(apiUrl(`/inbox/tickets/${id}`), {
          cache: "no-store",
          headers: { ...authHeaders() },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(parseApiError(body, res.status));
          return;
        }
        setThread(body.ticket as TicketRow);
        setMessages(Array.isArray(body.responses) ? body.responses : []);
        const ad = body.ai_draft as AiDraftPayload | undefined;
        if (ad?.draft_text) onAiDraftSeedRef.current?.(ad);
        setError(null);
      } catch (e) {
        setError(networkErrorMessage(e));
      } finally {
        setLoading(false);
      }
    },
    [authHeaders]
  );

  useEffect(() => {
    if (selectedId == null) {
      setThread(null);
      setMessages([]);
      setSla(null);
      setError(null);
      return;
    }
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const threadId = thread?.id ?? null;
  useEffect(() => {
    if (selectedId == null || threadId !== selectedId) {
      setSla(null);
      return;
    }
    let cancelled = false;
    fetch(apiUrl(`/inbox/tickets/${selectedId}/sla`), {
      cache: "no-store",
      headers: { ...authHeaders() },
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) setSla(body as SlaPayload);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedId, threadId, authHeaders]);

  const refetch = useCallback(async () => {
    if (selectedId != null) await loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const patchThread = useCallback((patch: Partial<TicketRow>) => {
    setThread((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const updateThread = useCallback(
    async (patch: Record<string, unknown>): Promise<ApiResult<TicketRow>> => {
      if (selectedId == null) return { ok: false, error: "No ticket selected." };
      try {
        const res = await fetch(apiUrl(`/inbox/tickets/${selectedId}`), {
          method: "PUT",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.ticket) {
          return { ok: false, error: parseApiError(body, res.status) };
        }
        const updated = body.ticket as TicketRow;
        setThread(updated);
        onTicketChangedRef.current?.(updated.id, updated);
        return { ok: true, data: updated };
      } catch (e) {
        return { ok: false, error: networkErrorMessage(e) };
      }
    },
    [authHeaders, selectedId]
  );

  const toggleStar = useCallback(
    async (ticket: TicketRow): Promise<ApiResult<TicketRow>> => {
      const next = !ticket.is_starred;
      const setStarred = (val: boolean) => {
        onTicketChangedRef.current?.(ticket.id, { is_starred: val });
        setThread((prev) => (prev && prev.id === ticket.id ? { ...prev, is_starred: val } : prev));
      };
      setStarred(next);
      try {
        const res = await fetch(apiUrl(`/inbox/tickets/${ticket.id}`), {
          method: "PUT",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ isStarred: next }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setStarred(ticket.is_starred);
          return { ok: false, error: parseApiError(body, res.status) };
        }
        return { ok: true, data: { ...ticket, is_starred: next } };
      } catch (e) {
        setStarred(ticket.is_starred);
        return { ok: false, error: networkErrorMessage(e) };
      }
    },
    [authHeaders]
  );

  const markAsRead = useCallback(
    async (id: number): Promise<ApiResult<void>> => {
      try {
        const res = await fetch(apiUrl(`/inbox/tickets/${id}`), {
          method: "PUT",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ isRead: true }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          return { ok: false, error: parseApiError(body, res.status) };
        }
        onTicketChangedRef.current?.(id, { is_read: true });
        return { ok: true, data: undefined };
      } catch (e) {
        return { ok: false, error: networkErrorMessage(e) };
      }
    },
    [authHeaders]
  );

  return {
    thread,
    messages,
    sla,
    loading,
    error,
    refetch,
    updateThread,
    toggleStar,
    markAsRead,
    patchThread,
  };
}
