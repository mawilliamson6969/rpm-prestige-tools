"use client";

import { useCallback, useEffect, useState } from "react";
import customizationStyles from "./customization.module.css";
import dashboardStyles from "../../../dashboards/components/dashboards.module.css";
import { apiUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import type { BoardColumn, BoardSettings } from "@/types/mb";

/**
 * Phase 6: the new "Aggregation" tab inside the EditBoardDrawer.
 * Owns:
 *   * GET /mb/boards/:id/settings → toggles + primary_date_column_id
 *   * PATCH /mb/boards/:id/settings → admin saves
 *   * POST /mb/boards/:id/aggregation/recompute → "Recompute now"
 */
export default function AggregationTab({
  boardId,
  columns,
  onError,
}: {
  boardId: number;
  columns: BoardColumn[];
  onError?: (msg: string) => void;
}) {
  const { authHeaders, isAdmin } = useAuth();
  const [settings, setSettings] = useState<BoardSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [recomputeResult, setRecomputeResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl(`/mb/boards/${boardId}/settings`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Could not load settings.");
      const body = await res.json();
      setSettings(body.settings);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : "Could not load settings.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, boardId, onError]);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(patch: Partial<BoardSettings>) {
    if (!isAdmin) return;
    setBusy(true);
    setRecomputeResult(null);
    try {
      const res = await fetch(apiUrl(`/mb/boards/${boardId}/settings`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Could not save settings.");
      }
      const body = await res.json();
      setSettings(body.settings);
      // If status aggregation was just turned ON, kick off a recompute
      // so the parents take effect right away.
      if (patch.auto_aggregate_status === true) {
        runRecompute();
      }
    } catch (e) {
      onError?.(e instanceof Error ? e.message : "Could not save settings.");
    } finally {
      setBusy(false);
    }
  }

  async function runRecompute() {
    if (!isAdmin) return;
    setRecomputing(true);
    setRecomputeResult(null);
    try {
      const res = await fetch(
        apiUrl(`/mb/boards/${boardId}/aggregation/recompute`),
        { method: "POST", headers: { ...authHeaders() } }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Recompute failed.");
      }
      const body = await res.json();
      setRecomputeResult(
        `Updated ${body.parents_updated} of ${body.parents_examined} parent item${body.parents_examined === 1 ? "" : "s"}.`
      );
    } catch (e) {
      onError?.(e instanceof Error ? e.message : "Could not recompute.");
    } finally {
      setRecomputing(false);
    }
  }

  const dateColumns = columns.filter(
    (c) => c.column_type === "date" && c.archived_at == null
  );

  if (loading || !settings) {
    return <div className={customizationStyles.rowMeta}>Loading settings…</div>;
  }

  return (
    <div>
      <div className={customizationStyles.section}>
        <h3 className={customizationStyles.sectionTitle}>Status aggregation</h3>
        <label className={dashboardStyles.aggToggle}>
          <input
            type="checkbox"
            checked={settings.auto_aggregate_status}
            onChange={(e) => patch({ auto_aggregate_status: e.target.checked })}
            disabled={!isAdmin || busy}
          />
          Auto-aggregate parent status from subitems
        </label>
        <div className={dashboardStyles.aggHelp}>
          When on: a parent item&apos;s status becomes read-only and is computed from its
          subitems using a fixed ladder (Blocked → Stalled/Overdue → In Progress →
          terminal). Items with zero subitems stay manually editable.
        </div>
      </div>

      <div className={customizationStyles.section}>
        <h3 className={customizationStyles.sectionTitle}>Progress aggregation</h3>
        <label className={dashboardStyles.aggToggle}>
          <input
            type="checkbox"
            checked={settings.auto_aggregate_progress}
            onChange={(e) => patch({ auto_aggregate_progress: e.target.checked })}
            disabled={!isAdmin || busy}
          />
          Show parent progress % (computed from subitem completion)
        </label>
        <div className={dashboardStyles.aggHelp}>
          When on: a Progress column appears in the table and detail view, computed
          as <code>(subitems in a terminal status) ÷ (total subitems)</code>.
          Items with zero subitems show &ldquo;—&rdquo;.
        </div>
      </div>

      <div className={customizationStyles.section}>
        <h3 className={customizationStyles.sectionTitle}>Primary date column</h3>
        <select
          className={customizationStyles.input}
          value={settings.primary_date_column_id ?? ""}
          onChange={(e) =>
            patch({
              primary_date_column_id:
                e.target.value === "" ? null : Number(e.target.value),
            })
          }
          disabled={!isAdmin || busy || dateColumns.length === 0}
        >
          <option value="">— None —</option>
          {dateColumns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <div className={dashboardStyles.aggHelp}>
          Used by the Calendar dashboard for date plotting and by Triage for
          &ldquo;past due&rdquo; / &ldquo;due in 7 days&rdquo; scoring.
        </div>
      </div>

      {isAdmin ? (
        <div className={customizationStyles.section}>
          <h3 className={customizationStyles.sectionTitle}>Recompute</h3>
          <button
            type="button"
            className={dashboardStyles.recomputeBtn}
            onClick={runRecompute}
            disabled={busy || recomputing}
          >
            {recomputing ? "Recomputing…" : "Recompute now"}
          </button>
          {recomputeResult ? (
            <div className={dashboardStyles.aggHelp} style={{ marginTop: "0.4rem" }}>
              {recomputeResult}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
