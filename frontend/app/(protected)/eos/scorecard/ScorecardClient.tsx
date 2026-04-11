"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAuth } from "../../../../context/AuthContext";
import { apiUrl } from "../../../../lib/api";
import { type DatePreset, rangeForPreset } from "../dateUtils";
import styles from "../eos.module.css";

type TeamUser = { id: number; displayName: string; username: string };

type Metric = {
  id: number;
  name: string;
  description: string | null;
  ownerUserId: number;
  ownerDisplayName: string | null;
  frequency: "weekly" | "monthly";
  goalValue: number;
  goalDirection: string;
  unit: string;
  displayOrder: number;
  isActive?: boolean;
};

type Report = {
  frequency: string;
  metrics: Metric[];
  periods: { key: string; label: string }[];
  cells: Record<number, Record<string, Cell | null>>;
};

type Cell = {
  entryId: number;
  value: number;
  notes: string | null;
  meetsGoal: boolean | null;
};

function formatValue(unit: string, v: number): string {
  if (unit === "currency") return `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (unit === "percentage") return `${v}%`;
  if (unit === "days") return `${v}d`;
  return String(v);
}

function formatGoal(unit: string, g: number): string {
  return formatValue(unit, g);
}

export default function ScorecardClient() {
  const { authHeaders, isAdmin } = useAuth();
  const [team, setTeam] = useState<TeamUser[]>([]);
  const [frequency, setFrequency] = useState<"weekly" | "monthly">("weekly");
  const [preset, setPreset] = useState<DatePreset>("last_13_weeks");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [ownerUserId, setOwnerUserId] = useState<string>("");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ metricId: number; periodKey: string; value: string } | null>(
    null
  );
  const [notesFor, setNotesFor] = useState<{ entryId: number; notes: string } | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [allMetrics, setAllMetrics] = useState<Metric[]>([]);
  const [trendMetricId, setTrendMetricId] = useState<number | null>(null);

  const { start, end } = useMemo(() => {
    if (preset === "last_13_weeks" && frequency === "monthly") {
      return rangeForPreset("last_6_months", customStart, customEnd);
    }
    return rangeForPreset(preset, customStart, customEnd);
  }, [preset, frequency, customStart, customEnd]);

  const loadTeam = useCallback(async () => {
    const res = await fetch(apiUrl("/eos/team-users"), { headers: { ...authHeaders() } });
    const j = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(j.users)) setTeam(j.users);
  }, [authHeaders]);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      q.set("startDate", start);
      q.set("endDate", end);
      q.set("frequency", frequency);
      if (ownerUserId) q.set("ownerUserId", ownerUserId);
      const res = await fetch(apiUrl(`/eos/scorecard/report?${q}`), {
        cache: "no-store",
        headers: { ...authHeaders() },
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof j.error === "string" ? j.error : "Failed to load scorecard");
      setReport(j as Report);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, start, end, frequency, ownerUserId]);

  useEffect(() => {
    if (report?.metrics?.length) {
      setTrendMetricId((prev) => (prev == null ? report.metrics[0].id : prev));
    }
  }, [report]);

  useEffect(() => {
    loadTeam();
  }, [loadTeam]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const loadAllMetrics = useCallback(async () => {
    const res = await fetch(apiUrl("/eos/scorecard/metrics?all=1"), { headers: { ...authHeaders() } });
    const j = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(j.metrics)) setAllMetrics(j.metrics);
  }, [authHeaders]);

  useEffect(() => {
    if (manageOpen && isAdmin) loadAllMetrics();
  }, [manageOpen, isAdmin, loadAllMetrics]);

  const saveCell = async (metricId: number, periodKey: string, raw: string) => {
    const trimmed = String(raw).trim();
    if (!trimmed) return;
    const num = parseFloat(trimmed.replace(/[$,%]/g, ""));
    if (Number.isNaN(num)) return;
    const metric = report?.metrics.find((m) => m.id === metricId);
    if (!metric) return;
    const body: Record<string, unknown> = { metricId, value: num };
    if (metric.frequency === "weekly") body.weekOf = periodKey;
    else body.monthOf = periodKey;
    const existing = report?.cells[metricId]?.[periodKey];
    if (existing?.entryId) {
      await fetch(apiUrl(`/eos/scorecard/entries/${existing.entryId}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ value: num }),
      });
    } else {
      await fetch(apiUrl("/eos/scorecard/entries"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
    }
    await loadReport();
  };

  const onCellKeyDown = (
    e: React.KeyboardEvent,
    mi: number,
    pi: number,
    metricId: number,
    periodKey: string
  ) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const metrics = report?.metrics ?? [];
    const periods = report?.periods ?? [];
    let nmi = mi;
    let npi = pi + (e.shiftKey ? -1 : 1);
    if (npi >= periods.length) {
      npi = 0;
      nmi += 1;
    }
    if (npi < 0) {
      nmi -= 1;
      npi = periods.length - 1;
    }
    if (nmi < 0 || nmi >= metrics.length) return;
    const nextPk = periods[npi]?.key;
    if (!nextPk) return;
    const cell = report?.cells[metrics[nmi].id]?.[nextPk];
    setEditing({
      metricId: metrics[nmi].id,
      periodKey: nextPk,
      value: cell ? String(cell.value) : "",
    });
  };

  const chartData = useMemo(() => {
    if (!report || !trendMetricId) return [];
    const m = report.metrics.find((x) => x.id === trendMetricId);
    if (!m) return [];
    return report.periods.map((p) => {
      const c = report.cells[trendMetricId]?.[p.key];
      return {
        label: p.label,
        value: c ? c.value : null,
        goal: m.goalValue,
      };
    });
  }, [report, trendMetricId]);

  return (
    <>
      <p className={styles.muted}>
        Manual weekly and monthly measurables. Green = at or better than goal; red = off goal. Property filter
        does not apply here.
      </p>

      <div className={styles.toolbar}>
        <label>
          View
          <select
            className={styles.select}
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as "weekly" | "monthly")}
          >
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>
        <label>
          Owner
          <select
            className={styles.select}
            value={ownerUserId}
            onChange={(e) => setOwnerUserId(e.target.value)}
          >
            <option value="">All</option>
            {team.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </select>
        </label>
        {preset === "custom" ? (
          <>
            <label>
              Start
              <input
                type="date"
                className={styles.dateIn}
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
              />
            </label>
            <label>
              End
              <input
                type="date"
                className={styles.dateIn}
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
              />
            </label>
          </>
        ) : null}
        {isAdmin ? (
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setManageOpen(true)}>
            Manage metrics
          </button>
        ) : null}
      </div>

      <div className={styles.presetRow}>
        {(
          [
            ["this_quarter", "This quarter"],
            ["last_quarter", "Last quarter"],
            ["last_13_weeks", frequency === "monthly" ? "Last 6 months" : "Last 13 weeks"],
            ["last_6_months", "Last 6 months"],
            ["ytd", "Year to date"],
            ["custom", "Custom"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`${styles.presetBtn} ${preset === id ? styles.presetActive : ""}`}
            onClick={() => setPreset(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? <div className={styles.alert}>{error}</div> : null}
      {loading && !report ? <p className={styles.muted}>Loading…</p> : null}

      {report && report.metrics.length > 0 ? (
        <>
          <div className={styles.gridWrap}>
            <table className={styles.scoreTable}>
              <thead>
                <tr>
                  <th>Metric / Goal</th>
                  {report.periods.map((p) => (
                    <th key={p.key}>{p.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.metrics.map((m, mi) => (
                  <tr key={m.id}>
                    <td>
                      <div className={styles.metricTitle}>{m.name}</div>
                      <div className={styles.metricMeta}>
                        {m.ownerDisplayName ?? "—"} · Goal {formatGoal(m.unit, m.goalValue)} (
                        {m.goalDirection})
                      </div>
                    </td>
                    {report.periods.map((p, pi) => {
                      const c = report.cells[m.id]?.[p.key] ?? null;
                      const isEdit =
                        editing && editing.metricId === m.id && editing.periodKey === p.key;
                      const cls = c
                        ? c.meetsGoal
                          ? styles.cellOk
                          : styles.cellBad
                        : styles.cellEmpty;
                      return (
                        <td key={p.key} className={cls}>
                          {isEdit ? (
                            <input
                              className={styles.input}
                              autoFocus
                              value={editing.value}
                              onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                              onKeyDown={(e) => onCellKeyDown(e, mi, pi, m.id, p.key)}
                              onBlur={() => {
                                if (editing) void saveCell(m.id, p.key, editing.value);
                                setEditing(null);
                              }}
                              onKeyUp={(e) => {
                                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                              }}
                            />
                          ) : (
                            <button
                              type="button"
                              className={styles.cellBtn}
                              onClick={() =>
                                setEditing({
                                  metricId: m.id,
                                  periodKey: p.key,
                                  value: c ? String(c.value) : "",
                                })
                              }
                            >
                              {c ? formatValue(m.unit, c.value) : "—"}
                              {c ? (
                                <span
                                  className={styles.noteHint}
                                  title={c.notes || "Add note"}
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    setNotesFor({ entryId: c.entryId, notes: c.notes ?? "" });
                                  }}
                                >
                                  {c.notes ? "📝" : "＋"}
                                </span>
                              ) : null}
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.chartCard}>
            <h3 className={styles.chartTitle}>Trend</h3>
            <label className={styles.muted}>
              Metric{" "}
              <select
                className={styles.select}
                value={trendMetricId ?? ""}
                onChange={(e) => setTrendMetricId(Number(e.target.value))}
              >
                {report.metrics.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <div style={{ width: "100%", height: 260 }}>
              <ResponsiveContainer>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e8eaee" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="value" name="Actual" stroke="#0098d0" dot />
                  <Line type="monotone" dataKey="goal" name="Goal" stroke="#6a737b" strokeDasharray="4 4" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      ) : null}

      {manageOpen && isAdmin ? (
        <ManageMetricsModal
          team={team}
          metrics={allMetrics}
          onClose={() => setManageOpen(false)}
          authHeaders={authHeaders}
          onSaved={() => {
            loadAllMetrics();
            loadReport();
          }}
        />
      ) : null}

      {notesFor ? (
        <NotesModal
          entryId={notesFor.entryId}
          initialNotes={notesFor.notes}
          authHeaders={authHeaders}
          onClose={() => setNotesFor(null)}
          onSaved={() => {
            setNotesFor(null);
            loadReport();
          }}
        />
      ) : null}
    </>
  );
}

function NotesModal({
  entryId,
  initialNotes,
  authHeaders,
  onClose,
  onSaved,
}: {
  entryId: number;
  initialNotes: string;
  authHeaders: () => Record<string, string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [notes, setNotes] = useState(initialNotes);
  return (
    <div className={styles.modalOverlay} role="dialog" aria-modal>
      <div className={styles.modal}>
        <h2>Notes</h2>
        <textarea className={styles.textarea} value={notes} onChange={(e) => setNotes(e.target.value)} rows={5} />
        <div className={styles.modalActions}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={async () => {
              await fetch(apiUrl(`/eos/scorecard/entries/${entryId}`), {
                method: "PUT",
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify({ notes }),
              });
              onSaved();
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function ManageMetricsModal({
  team,
  metrics,
  onClose,
  authHeaders,
  onSaved,
}: {
  team: TeamUser[];
  metrics: Metric[];
  onClose: () => void;
  authHeaders: () => Record<string, string>;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<{
    name: string;
    description: string;
    ownerUserId: number | "";
    frequency: "weekly" | "monthly";
    goalValue: string;
    goalDirection: "above" | "below" | "exact";
    unit: "number" | "currency" | "percentage" | "days";
  }>({
    name: "",
    description: "",
    ownerUserId: team[0]?.id ?? "",
    frequency: "weekly",
    goalValue: "",
    goalDirection: "above",
    unit: "number",
  });

  const sorted = [...metrics].sort((a, b) => a.displayOrder - b.displayOrder);

  const moveMetric = async (id: number, dir: -1 | 1) => {
    const idx = sorted.findIndex((m) => m.id === id);
    const swap = sorted[idx + dir];
    if (!swap) return;
    await fetch(apiUrl(`/eos/scorecard/metrics/${id}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ displayOrder: swap.displayOrder }),
    });
    await fetch(apiUrl(`/eos/scorecard/metrics/${swap.id}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ displayOrder: sorted[idx].displayOrder }),
    });
    onSaved();
  };

  return (
    <div className={styles.modalOverlay} role="dialog" aria-modal>
      <div className={styles.modal} style={{ maxWidth: "36rem" }}>
        <h2>Manage metrics</h2>
        <p className={styles.muted} style={{ marginTop: "-0.5rem" }}>
          Archive hides a metric from the scorecard; entry history is kept.
        </p>
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 1rem" }}>
          {sorted.map((m) => (
            <li
              key={m.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.35rem 0",
                borderBottom: "1px solid rgba(27,40,86,0.08)",
              }}
            >
              <span style={{ flex: 1, fontWeight: 600, color: "#1b2856" }}>{m.name}</span>
              <button type="button" className={styles.presetBtn} onClick={() => moveMetric(m.id, -1)}>
                ↑
              </button>
              <button type="button" className={styles.presetBtn} onClick={() => moveMetric(m.id, 1)}>
                ↓
              </button>
              <button
                type="button"
                className={styles.presetBtn}
                onClick={async () => {
                  if (
                    !confirm(
                      "Archive this metric? It will be hidden from the scorecard. Historical data is preserved."
                    )
                  )
                    return;
                  await fetch(apiUrl(`/eos/scorecard/metrics/${m.id}`), {
                    method: "DELETE",
                    headers: { ...authHeaders() },
                  });
                  onSaved();
                }}
              >
                Archive
              </button>
            </li>
          ))}
        </ul>
        <h3 style={{ fontSize: "0.95rem", color: "#1b2856" }}>Add metric</h3>
        <div className={styles.formGrid}>
          <label>
            Name
            <input
              className={styles.input}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>
          <label>
            Owner
            <select
              className={styles.select}
              value={form.ownerUserId}
              onChange={(e) => setForm((f) => ({ ...f, ownerUserId: Number(e.target.value) }))}
            >
              {team.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Frequency
            <select
              className={styles.select}
              value={form.frequency}
              onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value as "weekly" | "monthly" }))}
            >
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          <label>
            Goal value
            <input
              className={styles.input}
              value={form.goalValue}
              onChange={(e) => setForm((f) => ({ ...f, goalValue: e.target.value }))}
            />
          </label>
          <label>
            Direction
            <select
              className={styles.select}
              value={form.goalDirection}
              onChange={(e) =>
                setForm((f) => ({ ...f, goalDirection: e.target.value as typeof form.goalDirection }))
              }
            >
              <option value="above">Above</option>
              <option value="below">Below</option>
              <option value="exact">Exact</option>
            </select>
          </label>
          <label>
            Unit
            <select
              className={styles.select}
              value={form.unit}
              onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value as typeof form.unit }))}
            >
              <option value="number">Number</option>
              <option value="currency">Currency</option>
              <option value="percentage">Percentage</option>
              <option value="days">Days</option>
            </select>
          </label>
        </div>
        <div className={styles.modalActions}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={async () => {
              await fetch(apiUrl("/eos/scorecard/metrics"), {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify({
                  name: form.name,
                  description: form.description || null,
                  ownerUserId: form.ownerUserId,
                  frequency: form.frequency,
                  goalValue: Number(form.goalValue),
                  goalDirection: form.goalDirection,
                  unit: form.unit,
                }),
              });
              onSaved();
              setForm({
                name: "",
                description: "",
                ownerUserId: team[0]?.id ?? "",
                frequency: "weekly",
                goalValue: "",
                goalDirection: "above",
                unit: "number",
              });
            }}
          >
            Add metric
          </button>
        </div>
      </div>
    </div>
  );
}
