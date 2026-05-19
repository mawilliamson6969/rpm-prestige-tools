"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiUrl } from "../../../../../lib/api";
import { useAuth } from "../../../../../context/AuthContext";
import styles from "../../automations.module.css";
import type { Automation, AutomationRun } from "../../types";

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
  if (status === "failed") return styles.badgeBad;
  return styles.badgeWarn;
}

export default function RunsClient({ automationId }: Props) {
  const { authHeaders } = useAuth();
  const [automation, setAutomation] = useState<Automation | null>(null);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [aRes, rRes] = await Promise.all([
          fetch(apiUrl(`/automations/${automationId}`), { headers: authHeaders() }),
          fetch(apiUrl(`/automations/${automationId}/runs?limit=100`), { headers: authHeaders() }),
        ]);
        if (!aRes.ok) throw new Error(`Failed to load automation (${aRes.status}).`);
        if (!rRes.ok) throw new Error(`Failed to load runs (${rRes.status}).`);
        const aJson = await aRes.json();
        const rJson = await rRes.json();
        if (cancelled) return;
        setAutomation(aJson.automation);
        setRuns(rJson.runs || []);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Load failed.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [automationId]);

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
      </div>

      {err ? <div className={styles.error}>{err}</div> : null}

      <div className={styles.card}>
        {loading ? (
          <div className={styles.empty}>Loading…</div>
        ) : runs.length === 0 ? (
          <div className={styles.empty}>No runs yet.</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Status</th>
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
  }: {
    run: AutomationRun;
    open: boolean;
    onToggle: () => void;
  }) {
    return (
      <>
        <tr className={styles.runRow} onClick={onToggle}>
          <td>{new Date(run.started_at).toLocaleString()}</td>
          <td>
            <span className={statusBadge(run.status)}>{run.status}</span>
          </td>
          <td className={styles.muted}>
            {run.event_type ?? "(unknown)"}
            <div className={styles.muted}>event #{run.event_id}</div>
          </td>
          <td>{formatDuration(run.started_at, run.finished_at)}</td>
          <td>{run.step_results.length}</td>
          <td>
            <button className={styles.btnSecondary} onClick={onToggle}>
              {open ? "Hide" : "Details"}
            </button>
          </td>
        </tr>
        {open ? (
          <tr>
            <td colSpan={6}>
              <div className={styles.runDetails}>
                {run.error ? `ERROR: ${run.error}\n\n` : ""}
                {JSON.stringify(
                  { step_results: run.step_results, event_payload: run.event_payload },
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
