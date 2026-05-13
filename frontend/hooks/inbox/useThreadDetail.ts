"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { apiUrl } from "../../lib/api";
import { networkErrorMessage, parseApiError, type ApiResult } from "../../lib/apiResult";
import type {
  AiDraftPayload,
  ResponseRow,
  ThreadMessage,
  ThreadRow,
} from "./types";

export type UseThreadDetailOptions = {
  selectedThreadId: string | null;
  onThreadChanged?: (threadId: string, patch: Partial<ThreadRow>) => void;
  onAiDraftSeed?: (draft: AiDraftPayload, seedTicketId: number | null) => void;
};

export type UseThreadDetail = {
  thread: ThreadRow | null;
  messages: ThreadMessage[];
  responses: ResponseRow[];
  /** Seed ticket id used for downstream actions (AI draft generate/dismiss
   *  still live on /inbox/tickets/:id/ai-draft). Null if the thread has no
   *  inbound messages yet. */
  seedTicketId: number | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  /** Patch arbitrary thread fields (status, assignee_id, category, priority, starred). */
  updateThread: (patch: Record<string, unknown>) => Promise<ApiResult<ThreadRow>>;
  toggleStar: (thread: ThreadRow) => Promise<ApiResult<ThreadRow>>;
  markAsRead: (threadId: string) => Promise<ApiResult<void>>;
  patchThread: (patch: Partial<ThreadRow>) => void;
};

export default function useThreadDetail({
  selectedThreadId,
  onThreadChanged,
  onAiDraftSeed,
}: UseThreadDetailOptions): UseThreadDetail {
  const { authHeaders } = useAuth();
  const [thread, setThread] = useState<ThreadRow | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [responses, setResponses] = useState<ResponseRow[]>([]);
  const [seedTicketId, setSeedTicketId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onThreadChangedRef = useRef(onThreadChanged);
  const onAiDraftSeedRef = useRef(onAiDraftSeed);
  onThreadChangedRef.current = onThreadChanged;
  onAiDraftSeedRef.current = onAiDraftSeed;

  const loadDetail = useCallback(
    async (threadId: string) => {
      setLoading(true);
      try {
        const res = await fetch(apiUrl(`/inbox/threads/${encodeURIComponent(threadId)}`), {
          cache: "no-store",
          headers: { ...authHeaders() },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(parseApiError(body, res.status));
          return;
        }
        setThread(body.thread as ThreadRow);
        setMessages(Array.isArray(body.messages) ? (body.messages as ThreadMessage[]) : []);
        setResponses(Array.isArray(body.responses) ? (body.responses as ResponseRow[]) : []);
        const seed = Number(body.seed_ticket_id);
        setSeedTicketId(Number.isFinite(seed) ? seed : null);
        const ad = body.ai_draft as AiDraftPayload | undefined;
        if (ad?.draft_text) {
          onAiDraftSeedRef.current?.(ad, Number.isFinite(seed) ? seed : null);
        }
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
    if (!selectedThreadId) {
      setThread(null);
      setMessages([]);
      setResponses([]);
      setSeedTicketId(null);
      setError(null);
      return;
    }
    void loadDetail(selectedThreadId);
  }, [selectedThreadId, loadDetail]);

  const refetch = useCallback(async () => {
    if (selectedThreadId) await loadDetail(selectedThreadId);
  }, [selectedThreadId, loadDetail]);

  const patchThread = useCallback((patch: Partial<ThreadRow>) => {
    setThread((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const updateThread = useCallback(
    async (patch: Record<string, unknown>): Promise<ApiResult<ThreadRow>> => {
      if (!selectedThreadId) return { ok: false, error: "No thread selected." };
      try {
        const res = await fetch(apiUrl(`/inbox/threads/${encodeURIComponent(selectedThreadId)}`), {
          method: "PATCH",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.thread) {
          return { ok: false, error: parseApiError(body, res.status) };
        }
        const updated = body.thread as ThreadRow;
        setThread(updated);
        onThreadChangedRef.current?.(updated.thread_id, updated);
        return { ok: true, data: updated };
      } catch (e) {
        return { ok: false, error: networkErrorMessage(e) };
      }
    },
    [authHeaders, selectedThreadId]
  );

  const toggleStar = useCallback(
    async (target: ThreadRow): Promise<ApiResult<ThreadRow>> => {
      const next = !target.starred;
      const apply = (val: boolean) => {
        onThreadChangedRef.current?.(target.thread_id, { starred: val });
        setThread((prev) =>
          prev && prev.thread_id === target.thread_id ? { ...prev, starred: val } : prev
        );
      };
      apply(next);
      try {
        const res = await fetch(apiUrl(`/inbox/threads/${encodeURIComponent(target.thread_id)}`), {
          method: "PATCH",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ starred: next }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          apply(target.starred);
          return { ok: false, error: parseApiError(body, res.status) };
        }
        return { ok: true, data: { ...target, starred: next } };
      } catch (e) {
        apply(target.starred);
        return { ok: false, error: networkErrorMessage(e) };
      }
    },
    [authHeaders]
  );

  const markAsRead = useCallback(
    async (threadId: string): Promise<ApiResult<void>> => {
      try {
        const res = await fetch(
          apiUrl(`/inbox/threads/${encodeURIComponent(threadId)}/read`),
          {
            method: "POST",
            headers: { ...authHeaders() },
          }
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          return { ok: false, error: parseApiError(body, res.status) };
        }
        onThreadChangedRef.current?.(threadId, { unread_count: 0 });
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
    responses,
    seedTicketId,
    loading,
    error,
    refetch,
    updateThread,
    toggleStar,
    markAsRead,
    patchThread,
  };
}
