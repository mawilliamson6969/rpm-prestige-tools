"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiUrl } from "../../../../../lib/api";
import { useAuth } from "../../../../../context/AuthContext";
import styles from "../../automations.module.css";
import type { Automation, AutomationRun, RunStatus } from "../../types";

type Props = { automationId: number };

function formatDuration(start: string, end: string | null) {
  if (!end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function statusBadge(status: string) {
  if (status === "success") return styles.badgeOk;
  if (status === "failed" || status === "dead_letter") return styles.badgeBad;
  // retrying, running, filtered_out, skipped, waiting
  return styles.badgeWarn;
}

const STATUS_FILTERS: Array<{ value: "" | RunStatus; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "dead_letter", label: "Dead-letter only" },
  { value: "failed", label: "Failed" },
  { value: "retrying", label: "Retrying" },
  { value: "success", label: "Success" },
  { value: "filtered_out", label: "Filtered out" },
  { value: "skipped", label: "Skipped" },
];

export default function RunsClient({ automationId }: Props) {
  const { authHeaders } = useAuth();
  const [automation, setAutomation] = useState<Automation | null>(null);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<"" | RunStatus>("");
  const [retryingIds, setRetryingIds] = useState<Set<number>>(new Set());

  async function load(filter: "" | RunStatus = statusFilter) {
    setLoading(true);
    setErr(null);
    try {
      const qs = filter ? `?limit=100&status=${encodeURIComponent(filter)}` : "?limit=100";
      const [aRes, rRes] = await Promise.all([
        automation
          ? Promise.resolve({ ok: true })
          : fetch(apiUrl(`/automations/${automationId}`), { headers: authHeaders() }),
        fetch(apiUrl(`/automations/${automationId}/runs${qs}`), { headers: authHeaders() }),
      ]);
      if (!aRes.ok) throw new Error(`Failed to load automation.`);
      if (!rRes.ok) throw new Error(`Failed to load runs (${(rRes as Response).status}).`);
      if (!automation && "json" in aRes) {
        const aJson = await (aRes as Response).json();
        setAutomation(aJson.automation);
      }
      const rJson = await (rRes as Response).json();
      setRuns(rJson.runs || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Load failed.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [automationId]);

  function onFilterChange(next: "" | RunStatus) {
    setStatusFilter(next);
    load(next);
  }

  async function retryNow(run: AutomationRun) {
    if (retryingIds.has(run.id)) return;
    setRetryingIds((s) => new Set(s).add(run.id));
    setErr(null);
    try {
      const res = await fetch(
        apiUrl(`/automations/${automationId}/runs/${run.id}/retry`),
        { method: "POST", headers: authHeaders() }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Retry failed.");
      // Optimistic patch — worker picks it up on next poll (~5s).
      setRuns((rs) =>
        rs.map((r) =>
          r.id === run.id
            ? {
                ...r,
                status: "retrying",
                attempt: json.run.attempt,
                max_attempts: json.run.max_attempts,
                next_retry_at: json.run.next_retry_at,
              }
            : r
        )
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Retry failed.");
    } finally {
      setRetryingIds((s) => {
        const n = new Set(s);
        n.delete(run.id);
        return n;
      });
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.editorTop}>
        <Link href={`/automations/${automationId}`} className={styles.btnSecondary}>
          ← Editor
        </Link>
        <div style={{ flex: 1 }}>
          <h1 className={styles.title}>{automation?.name ?? "Automation"} — history</h1>
          <p className={styles.sub}>Most recent 100 runs, newest first.</p>
        </div>
        <select
          className={styles.select}
          style={{ maxWidth: 220 }}
          value={statusFilter}
          onChange={(e) => onFilterChange(e.target.value as "" | RunStatus)}
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s.value || "all"} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {err ? <div className={styles.error}>{err}</div> : null}

      <div className={styles.card}>
        {loading ? (
          <div className={styles.empty}>Loading…</div>
        ) : runs.length === 0 ? (
          <div className={styles.empty}>No runs match this filter.</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Status</th>
                  <th>Attempt</th>
                  <th>Event</th>
                  <th>Duration</th>
                  <th>Steps</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <RunRow
                    key={r.id}
                    run={r}
                    open={openId === r.id}
                    onToggle={() => setOpenId(openId === r.id ? null : r.id)}
                    onRetry={() => retryNow(r)}
                    retryBusy={retryingIds.has(r.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );

  function RunRow({
    run,
    open,
    onToggle,
    onRetry,
    retryBusy,
  }: {
    run: AutomationRun;
    open: boolean;
    onToggle: () => void;
    onRetry: () => void;
    retryBusy: boolean;
  }) {
    const canRetry = run.status === "dead_letter" || run.status === "failed";
    const retryingHint =
      run.status === "retrying" && run.next_retry_at
        ? `next retry ${new Date(run.next_retry_at).toLocaleTimeString()}`
        : null;
    return (
      <>
        <tr className={styles.runRow}>
          <td onClick={onToggle}>{new Date(run.started_at).toLocaleString()}</td>
          <td onClick={onToggle}>
            <span className={statusBadge(run.status)}>{run.status}</span>
            {retryingHint ? (
              <div className={styles.muted} style={{ marginTop: 2 }}>
                {retryingHint}
              </div>
            ) : null}
          </td>
          <td onClick={onToggle}>
            {run.attempt ?? 1}
            {run.max_attempts ? <span className={styles.muted}> / {run.max_attempts}</span> : null}
          </td>
          <td className={styles.muted} onClick={onToggle}>
            {run.event_type ?? "(unknown)"}
            <div className={styles.muted}>event #{run.event_id}</div>
          </td>
          <td onClick={onToggle}>{formatDuration(run.started_at, run.finished_at)}</td>
          <td onClick={onToggle}>{run.step_results.length}</td>
          <td>
            {canRetry ? (
              <button
                className={styles.btnSecondary}
                onClick={onRetry}
                disabled={retryBusy}
                title="Re-queue this run for the worker"
              >
                {retryBusy ? "Queuing…" : "Retry now"}
              </button>
            ) : (
              <button className={styles.btnSecondary} onClick={onToggle}>
                {open ? "Hide" : "Details"}
              </button>
            )}
          </td>
        </tr>
        {open ? (
          <tr>
            <td colSpan={7}>
              <div className={styles.runDetails}>
                {run.error ? `ERROR: ${run.error}\n\n` : ""}
                {JSON.stringify(
                  {
                    attempt: run.attempt,
                    max_attempts: run.max_attempts,
                    next_retry_at: run.next_retry_at,
                    resume_from_step: run.resume_from_step,
                    step_results: run.step_results,
                    event_payload: run.event_payload,
                  },
                  null,
                  2
                )}
              </div>
            </td>
          </tr>
        ) : null}
      </>
    );
  }
}
