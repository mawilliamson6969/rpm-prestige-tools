"use client";

// Powers the conversation view's auto-action banner and the composer's
// suggested-action chips. Polls once per detail open; mutations
// (execute/revert) trigger a refetch.

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { apiUrl } from "../../lib/api";
import { parseApiError } from "../../lib/apiResult";

export type ProposedAction = {
  type?: string;
  assignee_username?: string;
  priority?: string;
  star?: boolean;
  [key: string]: unknown;
};

export type AutomationSuggestion = {
  id: number;
  ruleId: number;
  ruleName: string;
  ruleAction: string;
  proposedAction: ProposedAction | null;
  confidence: number | null;
  createdAt: string;
};

export type AutomationAutoFiring = {
  id: number;
  ruleId: number;
  ruleName: string;
  ruleAction: string;
  proposedAction: ProposedAction | null;
  executedAt: string;
  revertable: boolean;
};

export type UseThreadAutomations = {
  suggestions: AutomationSuggestion[];
  autoFirings: AutomationAutoFiring[];
  loading: boolean;
  error: string | null;
  /** Accept a suggestion — fires execute on the log row + refetches. */
  acceptSuggestion: (id: number) => Promise<{ ok: boolean; error?: string }>;
  /** Dismiss a suggestion (operator declined). Marks log row as feedback='wrong'. */
  dismissSuggestion: (id: number) => Promise<{ ok: boolean; error?: string }>;
  /** Undo an auto firing. */
  revertAutoFiring: (id: number) => Promise<{ ok: boolean; error?: string }>;
  refetch: () => Promise<void>;
};

const EMPTY: UseThreadAutomations = {
  suggestions: [],
  autoFirings: [],
  loading: false,
  error: null,
  acceptSuggestion: async () => ({ ok: false }),
  dismissSuggestion: async () => ({ ok: false }),
  revertAutoFiring: async () => ({ ok: false }),
  refetch: async () => undefined,
};

export default function useThreadAutomations(
  threadId: string | null
): UseThreadAutomations {
  const { authHeaders, token } = useAuth();
  const [suggestions, setSuggestions] = useState<AutomationSuggestion[]>([]);
  const [autoFirings, setAutoFirings] = useState<AutomationAutoFiring[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!token || !threadId) {
      setSuggestions([]);
      setAutoFirings([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        apiUrl(`/inbox/threads/${encodeURIComponent(threadId)}/automations`),
        { cache: "no-store", headers: { ...authHeaders() } }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(parseApiError(body, res.status));
        return;
      }
      setSuggestions(Array.isArray(body.suggestions) ? body.suggestions : []);
      setAutoFirings(Array.isArray(body.autoFirings) ? body.autoFirings : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load automations.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token, threadId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const acceptSuggestion = useCallback<UseThreadAutomations["acceptSuggestion"]>(
    async (id) => {
      // Optimistic: drop the chip immediately.
      setSuggestions((s) => s.filter((x) => x.id !== id));
      try {
        const res = await fetch(apiUrl(`/inbox/automation-log/${id}/execute`), {
          method: "POST",
          headers: { ...authHeaders() },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          await fetchData(); // rollback by refetching
          return { ok: false, error: parseApiError(body, res.status) };
        }
        return { ok: true };
      } catch (e) {
        await fetchData();
        return { ok: false, error: e instanceof Error ? e.message : "Execute failed." };
      }
    },
    [authHeaders, fetchData]
  );

  const dismissSuggestion = useCallback<UseThreadAutomations["dismissSuggestion"]>(
    async (id) => {
      setSuggestions((s) => s.filter((x) => x.id !== id));
      try {
        const res = await fetch(apiUrl(`/inbox/automation-log/${id}/feedback`), {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ feedback: "wrong" }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          await fetchData();
          return { ok: false, error: parseApiError(body, res.status) };
        }
        return { ok: true };
      } catch (e) {
        await fetchData();
        return { ok: false, error: e instanceof Error ? e.message : "Dismiss failed." };
      }
    },
    [authHeaders, fetchData]
  );

  const revertAutoFiring = useCallback<UseThreadAutomations["revertAutoFiring"]>(
    async (id) => {
      const prev = autoFirings;
      setAutoFirings((s) => s.filter((x) => x.id !== id));
      try {
        const res = await fetch(apiUrl(`/inbox/automation-log/${id}/revert`), {
          method: "POST",
          headers: { ...authHeaders() },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setAutoFirings(prev);
          return { ok: false, error: parseApiError(body, res.status) };
        }
        return { ok: true };
      } catch (e) {
        setAutoFirings(prev);
        return { ok: false, error: e instanceof Error ? e.message : "Revert failed." };
      }
    },
    [authHeaders, autoFirings]
  );

  if (!threadId) return EMPTY;

  return {
    suggestions,
    autoFirings,
    loading,
    error,
    acceptSuggestion,
    dismissSuggestion,
    revertAutoFiring,
    refetch: fetchData,
  };
}
