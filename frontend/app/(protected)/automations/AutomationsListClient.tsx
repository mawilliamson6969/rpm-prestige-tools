"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiUrl } from "../../../lib/api";
import { useAuth } from "../../../context/AuthContext";
import styles from "./automations.module.css";
import { TRIGGER_OPTIONS, type AutomationListRow } from "./types";

function relativeTime(iso: string | null) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function triggerLabel(trigger: string) {
  return TRIGGER_OPTIONS.find((t) => t.value === trigger)?.label ?? trigger;
}

export default function AutomationsListClient() {
  const { authHeaders } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<AutomationListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(apiUrl("/automations"), { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to load (${res.status}).`);
      const json = await res.json();
      setRows(json.automations || []);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load automations.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleEnabled(row: AutomationListRow) {
    const next = !row.enabled;
    // Optimistic
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, enabled: next } : r)));
    try {
      const res = await fetch(apiUrl(`/automations/${row.id}`), {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error("Could not save.");
    } catch (e) {
      // Revert on error.
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, enabled: !next } : r)));
      setErr(e instanceof Error ? e.message : "Toggle failed.");
    }
  }

  async function createNew() {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch(apiUrl("/automations"), {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Untitled automation",
          trigger_type: "internal.form.submitted",
          enabled: false,
          steps: [],
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not create.");
      router.push(`/automations/${json.automation.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Create failed.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Automations</h1>
          <p className={styles.sub}>
            Connect events from AppFolio, OpenPhone, Microsoft 365, and the dashboard itself
            to actions like sending SMS, drafting emails with Claude, or creating cards on a
            board.
          </p>
        </div>
        <button className={styles.btnPrimary} onClick={createNew} disabled={creating}>
          {creating ? "Creating…" : "+ New automation"}
        </button>
      </div>

      {err ? <div className={styles.error}>{err}</div> : null}

      <div className={styles.card}>
        {loading ? (
          <div className={styles.empty}>Loading…</div>
        ) : rows.length === 0 ? (
          <div className={styles.empty}>
            No automations yet. Click <strong>+ New automation</strong> to build one.
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Trigger</th>
                  <th>Steps</th>
                  <th>Last run</th>
                  <th>Success (last 20)</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/automations/${r.id}`} className={styles.rowLink}>
                        {r.name}
                      </Link>
                      {r.description ? (
                        <div className={styles.muted} style={{ marginTop: 2 }}>
                          {r.description}
                        </div>
                      ) : null}
                    </td>
                    <td className={styles.muted}>{triggerLabel(r.trigger_type)}</td>
                    <td>{r.step_count}</td>
                    <td className={styles.muted}>{relativeTime(r.last_run_at)}</td>
                    <td>
                      {r.success_rate_pct == null ? (
                        <span className={styles.muted}>—</span>
                      ) : (
                        <span
                          className={
                            r.success_rate_pct >= 90
                              ? styles.badgeOk
                              : r.success_rate_pct >= 60
                              ? styles.badgeWarn
                              : styles.badgeBad
                          }
                        >
                          {r.success_rate_pct}%
                        </span>
                      )}
                    </td>
                    <td>
                      <label className={styles.toggle} onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={r.enabled}
                          onChange={() => toggleEnabled(r)}
                        />
                        <span className={styles.slider} />
                      </label>
                    </td>
                    <td>
                      <Link
                        href={`/automations/${r.id}/runs`}
                        className={styles.btnSecondary}
                        style={{ textDecoration: "none" }}
                      >
                        History
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
