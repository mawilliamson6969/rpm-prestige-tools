"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { apiUrl } from "../../lib/api";
import { networkErrorMessage, parseApiError, type ApiResult } from "../../lib/apiResult";
import type { ContextUsedShape } from "./types";

const LOADING_PHASE_DELAY_MS = 1600;

export type SingleDraftResult = {
  draftText: string;
  contextUsed: ContextUsedShape | null;
};

export type UseAIDraftOptions = {
  /** Resets banner state when this changes (e.g. user picks a different ticket). */
  ticketId: number | null;
};

export type UseAIDraft = {
  bannerVisible: boolean;
  contextUsed: ContextUsedShape | null;
  loading: boolean;
  loadingMessage: string | null;
  error: string | null;
  showBanner: (ctx: ContextUsedShape | null) => void;
  hideBanner: () => void;
  generate: (ticketId: number) => Promise<ApiResult<SingleDraftResult>>;
  dismiss: (ticketId: number) => Promise<ApiResult<void>>;
};

export default function useAIDraft({ ticketId }: UseAIDraftOptions): UseAIDraft {
  const { authHeaders } = useAuth();

  const [bannerVisible, setBannerVisible] = useState(false);
  const [contextUsed, setContextUsed] = useState<ContextUsedShape | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBannerVisible(false);
    setContextUsed(null);
    setError(null);
  }, [ticketId]);

  useEffect(() => {
    if (!loading) {
      setLoadingMessage(null);
      return;
    }
    setLoadingMessage("Drafting response… Pulling context from AppFolio…");
    const t = window.setTimeout(() => {
      setLoadingMessage("Generating draft…");
    }, LOADING_PHASE_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [loading]);

  const showBanner = useCallback((ctx: ContextUsedShape | null) => {
    setContextUsed(ctx);
    setBannerVisible(true);
  }, []);

  const hideBanner = useCallback(() => {
    setBannerVisible(false);
    setContextUsed(null);
  }, []);

  const generate = useCallback(
    async (id: number): Promise<ApiResult<SingleDraftResult>> => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(apiUrl(`/inbox/tickets/${id}/ai-draft`), {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg = parseApiError(j, res.status);
          setError(msg);
          return { ok: false, error: msg };
        }
        const draftText = typeof j.draft === "string" ? j.draft : "";
        if (!draftText) {
          const msg = "AI returned an empty draft.";
          setError(msg);
          return { ok: false, error: msg };
        }
        return {
          ok: true,
          data: { draftText, contextUsed: (j.contextUsed as ContextUsedShape) ?? null },
        };
      } catch (e) {
        const msg = networkErrorMessage(e);
        setError(msg);
        return { ok: false, error: msg };
      } finally {
        setLoading(false);
      }
    },
    [authHeaders]
  );

  const dismiss = useCallback(
    async (id: number): Promise<ApiResult<void>> => {
      try {
        const res = await fetch(apiUrl(`/inbox/tickets/${id}/ai-draft`), {
          method: "DELETE",
          headers: { ...authHeaders() },
        });
        if (!res.ok && res.status !== 404) {
          const j = await res.json().catch(() => ({}));
          return { ok: false, error: parseApiError(j, res.status) };
        }
        hideBanner();
        return { ok: true, data: undefined };
      } catch (e) {
        return { ok: false, error: networkErrorMessage(e) };
      }
    },
    [authHeaders, hideBanner]
  );

  return {
    bannerVisible,
    contextUsed,
    loading,
    loadingMessage,
    error,
    showBanner,
    hideBanner,
    generate,
    dismiss,
  };
}
