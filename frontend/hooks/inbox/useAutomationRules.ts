"use client";

// Backs the /inbox/rules page. Fetches rules + 7-day stats + accuracy
// summary, exposes optimistic mutate helpers for the mode toggle /
// confidence slider / on-off switch.

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { apiUrl } from "../../lib/api";
import { parseApiError } from "../../lib/apiResult";

export type RuleMode = "shadow" | "suggested" | "auto";

export type AutomationRule = {
  id: number;
  name: string;
  description: string | null;
  trigger: string;
  conditions: Record<string, unknown>;
  action: string;
  action_params: Record<string, unknown>;
  confidence_min: number;
  mode: RuleMode;
  active: boolean;
  priority_rank: number;
  created_by: number | null;
  created_at: string;
  updated_at: string;
};

export type RuleStats = {
  rule_id: number;
  name: string;
  mode: RuleMode;
  active: boolean;
  last7d_firings: number;
  last7d_acted: number;
  last7d_acted_pct: number | null;
};

export type RuleAccuracy = {
  rule_id: number;
  name: string;
  mode: RuleMode;
  priority_rank: number;
  total_firings: number;
  good_count: number;
  wrong_count: number;
  reviewed_count: number;
  accuracy: number | null;
};

export type RulePatch = Partial<
  Pick<AutomationRule, "name" | "description" | "mode" | "active" | "confidence_min" | "priority_rank">
> & {
  conditions?: Record<string, unknown>;
  action_params?: Record<string, unknown>;
};

export type UseAutomationRules = {
  rules: AutomationRule[];
  stats: Map<number, RuleStats>;
  accuracy: Map<number, RuleAccuracy>;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  /** Optimistic patch — applies in-memory immediately, rolls back on error. */
  patchRule: (id: number, patch: RulePatch) => Promise<{ ok: boolean; error?: string }>;
};

export default function useAutomationRules(): UseAutomationRules {
  const { authHeaders, token } = useAuth();
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [stats, setStats] = useState<Map<number, RuleStats>>(new Map());
  const [accuracy, setAccuracy] = useState<Map<number, RuleAccuracy>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const opts = { cache: "no-store" as const, headers: { ...authHeaders() } };
      const [rRules, rStats, rAcc] = await Promise.all([
        fetch(apiUrl("/inbox/automation-rules"), opts),
        fetch(apiUrl("/inbox/automation-stats"), opts),
        fetch(apiUrl("/inbox/automation-accuracy"), opts),
      ]);
      const [jRules, jStats, jAcc] = await Promise.all([
        rRules.json().catch(() => ({})),
        rStats.json().catch(() => ({})),
        rAcc.json().catch(() => ({})),
      ]);
      if (!rRules.ok) {
        setError(parseApiError(jRules, rRules.status));
        return;
      }
      setRules(Array.isArray(jRules.rules) ? jRules.rules : []);
      if (rStats.ok && Array.isArray(jStats.rules)) {
        const m = new Map<number, RuleStats>();
        for (const r of jStats.rules) m.set(r.rule_id, r);
        setStats(m);
      }
      if (rAcc.ok && Array.isArray(jAcc.rules)) {
        const m = new Map<number, RuleAccuracy>();
        for (const r of jAcc.rules) m.set(r.rule_id, r);
        setAccuracy(m);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load rules.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const patchRule = useCallback<UseAutomationRules["patchRule"]>(
    async (id, patch) => {
      const prev = rules;
      setRules((rs) =>
        rs.map((r) => (r.id === id ? { ...r, ...patch } as AutomationRule : r))
      );
      try {
        const res = await fetch(apiUrl(`/inbox/automation-rules/${id}`), {
          method: "PATCH",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.rule) {
          setRules(prev);
          return { ok: false, error: parseApiError(body, res.status) };
        }
        setRules((rs) => rs.map((r) => (r.id === id ? body.rule : r)));
        return { ok: true };
      } catch (e) {
        setRules(prev);
        return { ok: false, error: e instanceof Error ? e.message : "Update failed." };
      }
    },
    [rules, authHeaders]
  );

  return { rules, stats, accuracy, loading, error, refetch: fetchAll, patchRule };
}
