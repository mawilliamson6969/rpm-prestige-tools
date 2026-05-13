"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { apiUrl } from "../../lib/api";
import { networkErrorMessage, parseApiError, type ApiResult } from "../../lib/apiResult";
import type { ThreadRow } from "./types";

const BATCH_SUMMARY_TTL_MS = 9000;
const BATCH_PROGRESS_TICK_MS = 720;
const BATCH_LIMIT = 10;
const ACTIVE_THREAD_STATUSES = new Set([
  "open",
  "waiting_on_tenant",
  "waiting_on_owner",
  "waiting_on_vendor",
  "snoozed",
]);

export type BatchDraftOutcome = { ok: number; touched: number[] };

export type UseBatchAIDraft = {
  busy: boolean;
  progress: string | null;
  summary: string | null;
  /** Pick the eligible IDs for "Draft All Unread" (capped at 10). */
  /** Returns up to 10 seed_ticket_ids — threads with unread inbound and no
   *  reply yet that are still open. The batch endpoint takes ticket ids, so
   *  we resolve via threads.seed_ticket_id from the list query. */
  selectEligible: (rows: ThreadRow[]) => number[];
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
    (rows: ThreadRow[]) =>
      rows
        .filter(
          (th) =>
            th.unread_count > 0 &&
            !th.last_outbound_at &&
            ACTIVE_THREAD_STATUSES.has(th.status) &&
            !!th.seed_ticket_id
        )
        .map((th) => th.seed_ticket_id as number)
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
