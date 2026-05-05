"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { apiUrl } from "../../lib/api";
import { networkErrorMessage, parseApiError, type ApiResult } from "../../lib/apiResult";
import type { TicketRow } from "./types";

const BATCH_SUMMARY_TTL_MS = 9000;
const BATCH_PROGRESS_TICK_MS = 720;
const BATCH_LIMIT = 10;
const OPEN_STATUSES = new Set(["open", "in_progress", "waiting"]);

export type BatchDraftOutcome = { ok: number; touched: number[] };

export type UseBatchAIDraft = {
  busy: boolean;
  progress: string | null;
  summary: string | null;
  /** Pick the eligible IDs for "Draft All Unread" (capped at 10). */
  selectEligible: (rows: TicketRow[]) => number[];
  run: (ticketIds: number[]) => Promise<ApiResult<BatchDraftOutcome>>;
};

export default function useBatchAIDraft(): UseBatchAIDraft {
  const { authHeaders } = useAuth();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  useEffect(() => {
    if (!summary) return;
    const t = window.setTimeout(() => setSummary(null), BATCH_SUMMARY_TTL_MS);
    return () => window.clearTimeout(t);
  }, [summary]);

  const selectEligible = useCallback(
    (rows: TicketRow[]) =>
      rows
        .filter((t) => !t.is_read && !t.first_response_at && OPEN_STATUSES.has(t.status))
        .map((t) => t.id)
        .slice(0, BATCH_LIMIT),
    []
  );

  const run = useCallback(
    async (ticketIds: number[]): Promise<ApiResult<BatchDraftOutcome>> => {
      if (!ticketIds.length) return { ok: false, error: "No tickets to draft." };
      setBusy(true);
      setSummary(null);
      setProgress(`Drafting 1 of ${ticketIds.length}…`);
      let tick = 1;
      const interval = window.setInterval(() => {
        tick = Math.min(ticketIds.length, tick + 1);
        setProgress(`Drafting ${tick} of ${ticketIds.length}…`);
      }, BATCH_PROGRESS_TICK_MS);
      try {
        const res = await fetch(apiUrl("/inbox/ai-draft/batch"), {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ ticketIds }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          setProgress(null);
          return { ok: false, error: parseApiError(j, res.status) };
        }
        const results = Array.isArray(j.results) ? j.results : [];
        let okCount = 0;
        const touched: number[] = [];
        for (const r of results) {
          if (r?.error) continue;
          okCount += 1;
          const tid = Number(r.ticketId);
          if (Number.isFinite(tid)) touched.push(tid);
        }
        setSummary(`${okCount} drafts ready for review`);
        setProgress(null);
        return { ok: true, data: { ok: okCount, touched } };
      } catch (e) {
        setProgress(null);
        return { ok: false, error: networkErrorMessage(e) };
      } finally {
        window.clearInterval(interval);
        setBusy(false);
      }
    },
    [authHeaders]
  );

  return { busy, progress, summary, selectEligible, run };
}
