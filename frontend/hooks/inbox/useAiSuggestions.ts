"use client";

// AI follow-up suggestions for the composer's "AI suggest" tab.
// Fetched on demand (when the tab opens) — not eagerly, since each
// call costs a model invocation.

import { useCallback, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { apiUrl } from "../../lib/api";
import { parseApiError } from "../../lib/apiResult";

export type AiSuggestionKind = "task" | "work_order" | "sms" | "checklist" | "info";

export type AiSuggestion = {
  label: string;
  kind: AiSuggestionKind;
};

export type UseAiSuggestions = {
  suggestions: AiSuggestion[];
  loading: boolean;
  error: string | null;
  source: "model" | "fallback" | null;
  /** Triggers a fresh fetch. */
  refresh: (threadId: string) => Promise<void>;
  /** Clears state, used when the active thread changes. */
  reset: () => void;
};

export default function useAiSuggestions(): UseAiSuggestions {
  const { authHeaders } = useAuth();
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"model" | "fallback" | null>(null);

  const refresh = useCallback<UseAiSuggestions["refresh"]>(
    async (threadId) => {
      if (!threadId) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          apiUrl(`/inbox/threads/${encodeURIComponent(threadId)}/ai-suggestions`),
          { method: "POST", headers: { ...authHeaders() } }
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(parseApiError(body, res.status));
          setSuggestions([]);
          return;
        }
        setSuggestions(Array.isArray(body.suggestions) ? body.suggestions : []);
        setSource(body.source === "model" ? "model" : "fallback");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load suggestions.");
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    },
    [authHeaders]
  );

  const reset = useCallback(() => {
    setSuggestions([]);
    setSource(null);
    setError(null);
  }, []);

  return { suggestions, loading, error, source, refresh, reset };
}
