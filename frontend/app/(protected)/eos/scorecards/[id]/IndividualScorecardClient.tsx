"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useAuth } from "../../../../../context/AuthContext";
import { apiUrl } from "../../../../../lib/api";
import { type DatePreset, rangeForPreset } from "../../dateUtils";
import styles from "../../eos.module.css";

type TeamUser = { id: number; displayName: string; username: string };
type ScorecardInfo = { id: number; name: string; description: string | null; ownerUserId: number; ownerDisplayName: string };
type Metric = {
  id: number; name: string; description: string | null; frequency: "weekly" | "monthly";
  goalValue: number | null; goalDirection: string; unit: string; displayOrder: number; isActive?: boolean;
};
type Cell = { entryId: number; value: number; notes: string | null; meetsGoal: boolean | null };
type Report = { frequency: string; metrics: Metric[]; periods: { key: string; label: string }[]; cells: Record<number, Record<string, Cell | null>> };

function formatValue(unit: string, v: number): string {
  if (unit === "currency") return `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (unit === "percentage") return `${v}%`;
  if (unit === "days") return `${v}d`;
  return String(v);
}
function formatGoal(unit: string, g: number) { return formatValue(unit, g); }

export default function IndividualScorecardClient({ scorecardId }: { scorecardId: string }) {
  const { authHeaders, isAdmin, user } = useAuth();
  const scId = Number(scorecardId);
  const [sc, setSc] = useState<ScorecardInfo | null>(null);
  const [team, setTeam] = useState<TeamUser[]>([]);
  const [frequency, setFrequency] = useState<"weekly" | "monthly">("weekly");
  const [preset, setPreset] = useState<DatePreset>("last_13_weeks");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ metricId: number; periodKey: string; value: string } | null>(null);
  const [notesFor, setNotesFor] = useState<{ entryId: number; notes: string } | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [allMetrics, setAllMetrics] = useState<Metric[]>([]);
  const [trendMetricId, setTrendMetricId] = useState<number | null>(null);
  const [metricMenuFor, setMetricMenuFor] = useState<number | null>(null);
  const [editMetric, setEditMetric] = useState<Metric | null>(null);
  const [deleteMetric, setDeleteMetric] = useState<Metric | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [askMetricId, setAskMetricId] = useState<number | null>(null);
  const [askQuestion, setAskQuestion] = useState("");
  const [askLoading, setAskLoading] = useState(false);
  const [askAnalysis, setAskAnalysis] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);

  const canManage = isAdmin;
  const canEnter = isAdmin || (sc ? user?.id === sc.ownerUserId : false);

  const { start, end } = useMemo(() => {
    if (preset === "last_13_weeks" && frequency === "monthly") return rangeForPreset("last_6_months", customStart, customEnd);
    return rangeForPreset(preset, customStart, customEnd);
  }, [preset, frequency, customStart, customEnd]);

  const loadSc = useCallback(async () => {
    const res = await fetch(apiUrl(`/eos/individual-scorecards/${scId}`), { headers: { ...authHeaders() } });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.scorecard) setSc(j.scorecard);
  }, [authHeaders, scId]);

  const loadTeam = useCallback(async () => {
    const res = await fetch(apiUrl("/eos/team-users"), { headers: { ...authHeaders() } });
    const j = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(j.users)) setTeam(j.users);
  }, [authHeaders]);

  const loadReport = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const q = new URLSearchParams();
      q.set("startDate", start); q.set("endDate", end); q.set("frequency", frequency);
      const res = await fetch(apiUrl(`/eos/individual-scorecards/${scId}/report?${q}`), { cache: "no-store", headers: { ...authHeaders() } });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof j.error === "string" ? j.error : "Failed to load scorecard");
      setReport(j as Report);
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); setReport(null); }
    finally { setLoading(false); }
  }, [authHeaders, start, end, frequency, scId]);

  useEffect(() => { if (report?.metrics?.length) setTrendMetricId((p) => p ?? report.metrics[0].id); }, [report]);
  useEffect(() => { loadSc(); loadTeam(); }, [loadSc, loadTeam]);
  useEffect(() => { loadReport(); }, [loadReport]);

  const loadAllMetrics = useCallback(async () => {
    const res = await fetch(apiUrl(`/eos/individual-scorecards/${scId}/metrics?includeArchived=true`), { headers: { ...authHeaders() } });
    const j = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(j.metrics)) setAllMetrics(j.metrics);
  }, [authHeaders, scId]);

  useEffect(() => { if (manageOpen && canManage) loadAllMetrics(); }, [manageOpen, canManage, loadAllMetrics]);

  const saveCell = async (metricId: number, periodKey: string, raw: string) => {
    const trimmed = String(raw).trim();
    if (!trimmed) return;
    const num = parseFloat(trimmed.replace(/[$,%]/g, ""));
    if (Number.isNaN(num)) return;
    await fetch(apiUrl("/eos/individual-scorecard-entries"), {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ metricId, value: num, weekStart: periodKey }),
    });
    await loadReport();
  };

  const onCellKeyDown = (e: React.KeyboardEvent, mi: number, pi: number, metricId: number, periodKey: string) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const metrics = report?.metrics ?? []; const periods = report?.periods ?? [];
    let nmi = mi; let npi = pi + (e.shiftKey ? -1 : 1);
    if (npi >= periods.length) { npi = 0; nmi += 1; }
    if (npi < 0) { nmi -= 1; npi = periods.length - 1; }
    if (nmi < 0 || nmi >= metrics.length) return;
    const nextPk = periods[npi]?.key; if (!nextPk) return;
    const cell = report?.cells[metrics[nmi].id]?.[nextPk];
    setEditing({ metricId: metrics[nmi].id, periodKey: nextPk, value: cell ? String(cell.value) : "" });
  };

  const chartData = useMemo(() => {
    if (!report || !trendMetricId) return [];
    const m = report.metrics.find((x) => x.id === trendMetricId); if (!m) return [];
    return report.periods.map((p) => {
      const c = report.cells[trendMetricId]?.[p.key];
      return { label: p.label, value: c ? c.value : null, goal: m.goalValue ?? 0 };
    });
  }, [report, trendMetricId]);

  if (!sc && !loading) return <p className={styles.muted}>Scorecard not found.</p>;

  return (
    <>
      <div style={{ marginBottom: "1rem" }}>
        <Link href="/eos/scorecards" style={{ color: "#0098d0", textDecoration: "none", fontSize: "0.85rem", fontWeight: 600 }}>
          ← Back to Individual Scorecards
        </Link>
      </div>
      {sc ? (
        <div style={{ marginBottom: "0.75rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.1rem", color: "#1b2856" }}>{sc.name}</h2>
          <p className={styles.muted} style={{ margin: "0.25rem 0 0" }}>{sc.ownerDisplayName}{sc.description ? ` · ${sc.description}` : ""}</p>
        </div>
      ) : null}

      <div className={styles.toolbar}>
        <label>
          View
          <select className={styles.select} value={frequency} onChange={(e) => setFrequency(e.target.value as "weekly" | "monthly")}>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>
        {preset === "custom" ? (
          <>
            <label>Start <input type="date" className={styles.dateIn} value={customStart} onChange={(e) => setCustomStart(e.target.value)} /></label>
            <label>End <input type="date" className={styles.dateIn} value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} /></label>
          </>
        ) : null}
        <button type="button" className={`${styles.btn} ${styles.btnGhost}`} disabled={!report?.metrics?.length}
          onClick={() => { setAskOpen(true); setAskMetricId((p) => p ?? report?.metrics?.[0]?.id ?? null); setAskAnalysis(null); setAskError(null); }}>
          Ask AI ✨
        </button>
        {canManage ? (
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setManageOpen(true)}>Manage metrics</button>
        ) : null}
      </div>

      <div className={styles.presetRow}>
        {([["this_quarter", "This quarter"], ["last_quarter", "Last quarter"],
          ["last_13_weeks", frequency === "monthly" ? "Last 6 months" : "Last 13 weeks"],
          ["last_6_months", "Last 6 months"], ["ytd", "Year to date"], ["custom", "Custom"]] as const
        ).map(([id, label]) => (
          <button key={id} type="button" className={`${styles.presetBtn} ${preset === id ? styles.presetActive : ""}`} onClick={() => setPreset(id)}>{label}</button>
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
                  {report.periods.map((p) => <th key={p.key}>{p.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {report.metrics.map((m, mi) => (
                  <tr key={m.id}>
                    <td>
                      <div className={styles.metricHeadRow}>
                        <div style={{ minWidth: 0 }}>
                          <div className={styles.metricTitleRow}>
                            <div className={styles.metricTitle}>{m.name}</div>
                            <button type="button" className={styles.aiSparkle} title="Ask AI about this metric"
                              onClick={() => { setAskMetricId(m.id); setAskOpen(true); setAskAnalysis(null); setAskError(null); }}>✨</button>
                          </div>
                          <div className={styles.metricMeta}>Goal {formatGoal(m.unit, m.goalValue ?? 0)} ({m.goalDirection})</div>
                        </div>
                        {canManage ? (
                          <MetricGearMenu open={metricMenuFor === m.id}
                            onToggle={() => setMetricMenuFor((c) => (c === m.id ? null : m.id))}
                            onClose={() => setMetricMenuFor(null)}
                            onEdit={() => setEditMetric(m)} onDelete={() => setDeleteMetric(m)} />
                        ) : null}
                      </div>
                    </td>
                    {report.periods.map((p, pi) => {
                      const c = report.cells[m.id]?.[p.key] ?? null;
                      const isEdit = editing && editing.metricId === m.id && editing.periodKey === p.key;
                      const cls = c ? (c.meetsGoal ? styles.cellOk : styles.cellBad) : styles.cellEmpty;
                      return (
                        <td key={p.key} className={cls}>
                          {isEdit ? (
                            <input className={styles.input} autoFocus value={editing.value}
                              onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                              onKeyDown={(e) => onCellKeyDown(e, mi, pi, m.id, p.key)}
                              onBlur={() => { if (editing) void saveCell(m.id, p.key, editing.value); setEditing(null); }}
                              onKeyUp={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                          ) : (
                            <button type="button" className={styles.cellBtn} disabled={!canEnter}
                              onClick={() => canEnter && setEditing({ metricId: m.id, periodKey: p.key, value: c ? String(c.value) : "" })}>
                              {c ? formatValue(m.unit, c.value) : "—"}
                              {c ? (
                                <span className={styles.noteHint} title={c.notes || "Add note"}
                                  onClick={(ev) => { ev.stopPropagation(); setNotesFor({ entryId: c.entryId, notes: c.notes ?? "" }); }}>
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
              <select className={styles.select} value={trendMetricId ?? ""} onChange={(e) => setTrendMetricId(Number(e.target.value))}>
                {report.metrics.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
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
      ) : report && report.metrics.length === 0 ? (
        <div style={{ textAlign: "center", padding: "3rem 1rem", color: "#6a737b" }}>
          <p style={{ fontSize: "1.05rem", fontWeight: 600 }}>No metrics yet for this frequency.</p>
          {canManage ? <p>Click "Manage metrics" to add your first metric.</p> : null}
        </div>
      ) : null}

      {manageOpen && canManage ? (
        <ManageMetricsModal scId={scId} team={team} metrics={allMetrics}
          onClose={() => setManageOpen(false)} authHeaders={authHeaders}
          onSaved={() => { loadAllMetrics(); loadReport(); }} />
      ) : null}

      {notesFor && canEnter ? (
        <NotesModal entryId={notesFor.entryId} initialNotes={notesFor.notes} authHeaders={authHeaders}
          onClose={() => setNotesFor(null)} onSaved={() => { setNotesFor(null); loadReport(); }} />
      ) : null}

      {editMetric && canManage ? (
        <EditMetricModal key={editMetric.id} metric={editMetric} team={team} scId={scId} authHeaders={authHeaders}
          onClose={() => setEditMetric(null)} onSaved={async () => { setEditMetric(null); setMetricMenuFor(null); await loadReport(); }} />
      ) : null}

      {deleteMetric && canManage ? (
        <ConfirmModal title={`Archive ${deleteMetric.name}?`}
          body="It will be removed from the scorecard but historical data is preserved."
          confirmLabel="Archive"
          onClose={() => setDeleteMetric(null)}
          onConfirm={async () => {
            await fetch(apiUrl(`/eos/individual-scorecard-metrics/${deleteMetric.id}`), { method: "DELETE", headers: { ...authHeaders() } });
            setDeleteMetric(null); setMetricMenuFor(null); await loadReport();
          }} />
      ) : null}

      {askOpen && report?.metrics?.length ? (
        <AskAiPanel metrics={report.metrics} metricId={askMetricId} question={askQuestion}
          loading={askLoading} analysis={askAnalysis} error={askError}
          onMetricChange={setAskMetricId} onQuestionChange={setAskQuestion}
          onClose={() => setAskOpen(false)}
          onAnalyze={async () => {
            if (!askMetricId) return;
            const q = askQuestion.trim(); if (!q) return;
            setAskLoading(true); setAskError(null); setAskAnalysis(null);
            try {
              const res = await fetch(apiUrl(`/eos/individual-scorecards/${scId}/ai-analyze`), {
                method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify({ metricId: askMetricId, question: q }),
              });
              const j = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(typeof j.error === "string" ? j.error : "Analysis failed");
              setAskAnalysis(typeof j.analysis === "string" ? j.analysis : "");
            } catch (e) { setAskError(e instanceof Error ? e.message : "Error"); }
            finally { setAskLoading(false); }
          }}
          loadingLabel={`Analyzing ${report.metrics.find((x) => x.id === askMetricId)?.name ?? "metric"} data...`} />
      ) : null}
    </>
  );
}

/* ---- Sub-components (matching company scorecard exactly) ---- */

function MetricGearMenu({ open, onToggle, onClose, onEdit, onDelete }: {
  open: boolean; onToggle: () => void; onClose: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) { if (!ref.current?.contains(e.target as Node)) onClose(); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, onClose]);
  return (
    <div className={styles.gearWrap} ref={ref}>
      <button type="button" className={styles.gearBtn} aria-haspopup="menu" aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); onToggle(); }}>⚙</button>
      {open ? (
        <div className={styles.gearMenu} role="menu" onMouseDown={(e) => e.stopPropagation()}>
          <button type="button" role="menuitem" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onClick={(e) => { e.stopPropagation(); onEdit(); onClose(); }}>Edit Metric</button>
          <button type="button" className={styles.gearMenuDanger} role="menuitem"
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onClick={(e) => { e.stopPropagation(); onDelete(); onClose(); }}>Archive Metric</button>
        </div>
      ) : null}
    </div>
  );
}

function ConfirmModal({ title, body, confirmLabel, onClose, onConfirm, nested }: {
  title: string; body: string; confirmLabel: string; onClose: () => void; onConfirm: () => void | Promise<void>; nested?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className={`${styles.modalOverlay}${nested ? ` ${styles.modalOverlayNested}` : ""}`} role="dialog" aria-modal>
      <div className={styles.modal}>
        <h2>{title}</h2>
        <p className={styles.muted}>{body}</p>
        <div className={styles.modalActions}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy}
            onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}>
            {busy ? "…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditMetricModal({ metric, team, scId, authHeaders, onClose, onSaved }: {
  metric: Metric; team: TeamUser[]; scId: number;
  authHeaders: () => Record<string, string>; onClose: () => void; onSaved: () => void | Promise<void>;
}) {
  const [name, setName] = useState(metric.name);
  const [description, setDescription] = useState(metric.description ?? "");
  const [frequency, setFrequency] = useState<"weekly" | "monthly">(metric.frequency);
  const [goalValue, setGoalValue] = useState(String(metric.goalValue ?? ""));
  const [goalDirection, setGoalDirection] = useState(metric.goalDirection);
  const [unit, setUnit] = useState(metric.unit);
  const [displayOrder, setDisplayOrder] = useState(String(metric.displayOrder));
  const [saving, setSaving] = useState(false);

  return (
    <div className={styles.modalOverlay} role="dialog" aria-modal>
      <div className={styles.modal} style={{ maxWidth: "34rem" }}>
        <h2>Edit metric</h2>
        <div className={styles.formGrid}>
          <label>Name <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label style={{ gridColumn: "1 / -1" }}>Description
            <textarea className={styles.textarea} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label>Frequency
            <select className={styles.select} value={frequency} onChange={(e) => setFrequency(e.target.value as "weekly" | "monthly")}>
              <option value="weekly">Weekly</option><option value="monthly">Monthly</option>
            </select>
          </label>
          <label>Goal value <input className={styles.input} value={goalValue} onChange={(e) => setGoalValue(e.target.value)} /></label>
          <label>Goal direction
            <select className={styles.select} value={goalDirection} onChange={(e) => setGoalDirection(e.target.value)}>
              <option value="above">Above</option><option value="below">Below</option><option value="exact">Exact</option>
            </select>
          </label>
          <label>Unit
            <select className={styles.select} value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option value="number">Number</option><option value="currency">Currency</option>
              <option value="percentage">Percentage</option><option value="days">Days</option>
            </select>
          </label>
          <label>Display order <input className={styles.input} value={displayOrder} onChange={(e) => setDisplayOrder(e.target.value)} /></label>
        </div>
        <div className={styles.modalActions}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving} onClick={async () => {
            setSaving(true);
            try {
              const res = await fetch(apiUrl(`/eos/individual-scorecard-metrics/${metric.id}`), {
                method: "PUT", headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify({ name, description: description.trim() || null, frequency, goalValue: Number(goalValue), goalDirection, unit, displayOrder: Number(displayOrder) }),
              });
              if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || "Save failed"); }
              await Promise.resolve(onSaved());
            } catch (e) { alert(e instanceof Error ? e.message : "Save failed"); } finally { setSaving(false); }
          }}>
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AskAiPanel({ metrics, metricId, question, loading, analysis, error, onMetricChange, onQuestionChange, onClose, onAnalyze, loadingLabel }: {
  metrics: Metric[]; metricId: number | null; question: string; loading: boolean; analysis: string | null; error: string | null;
  onMetricChange: (id: number | null) => void; onQuestionChange: (q: string) => void;
  onClose: () => void; onAnalyze: () => void | Promise<void>; loadingLabel: string;
}) {
  return (
    <>
      <div className={styles.askBackdrop} role="presentation" onClick={onClose} />
      <aside className={styles.askPanel} aria-label="Ask AI about scorecard">
        <button type="button" className={styles.askClose} onClick={onClose} aria-label="Close">×</button>
        <h2>Ask AI ✨</h2>
        <label className={styles.muted} style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
          Metric
          <select className={styles.select} value={metricId ?? ""} onChange={(e) => onMetricChange(Number(e.target.value) || null)}>
            {metrics.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <label className={styles.muted} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          Your question
          <textarea className={styles.textarea} rows={4} value={question} onChange={(e) => onQuestionChange(e.target.value)}
            placeholder={'Examples: "Why did this metric drop last week?" · "How can I improve?"'} />
        </label>
        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={loading || !metricId || !question.trim()} onClick={() => void onAnalyze()}>Analyze</button>
        </div>
        {loading ? <p className={styles.muted} style={{ marginTop: 12 }}>{loadingLabel}</p> : null}
        {error ? <p className={styles.alert} style={{ marginTop: 12 }}>{error}</p> : null}
        {analysis != null && analysis !== "" ? <div className={styles.askAnalysis}>{analysis}</div> : null}
      </aside>
    </>
  );
}

function NotesModal({ entryId, initialNotes, authHeaders, onClose, onSaved }: {
  entryId: number; initialNotes: string; authHeaders: () => Record<string, string>; onClose: () => void; onSaved: () => void;
}) {
  const [notes, setNotes] = useState(initialNotes);
  return (
    <div className={styles.modalOverlay} role="dialog" aria-modal>
      <div className={styles.modal}>
        <h2>Notes</h2>
        <textarea className={styles.textarea} value={notes} onChange={(e) => setNotes(e.target.value)} rows={5} />
        <div className={styles.modalActions}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose}>Cancel</button>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={async () => {
            await fetch(apiUrl(`/eos/individual-scorecard-entries`), {
              method: "PUT", headers: { "Content-Type": "application/json", ...authHeaders() },
              body: JSON.stringify({ metricId: 0, value: 0, weekStart: "", notes }),
            });
            onSaved();
          }}>Save</button>
        </div>
      </div>
    </div>
  );
}

function ManageMetricsModal({ scId, team, metrics, onClose, authHeaders, onSaved }: {
  scId: number; team: TeamUser[]; metrics: Metric[]; onClose: () => void;
  authHeaders: () => Record<string, string>; onSaved: () => void;
}) {
  const [form, setForm] = useState({ name: "", description: "", frequency: "weekly" as "weekly" | "monthly",
    goalValue: "", goalDirection: "above" as "above" | "below" | "exact", unit: "number" as "number" | "currency" | "percentage" | "days" });
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [permanentTarget, setPermanentTarget] = useState<Metric | null>(null);

  const activeSorted = useMemo(() => [...metrics].filter((m) => m.isActive !== false).sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id), [metrics]);
  const archivedSorted = useMemo(() => [...metrics].filter((m) => m.isActive === false).sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id), [metrics]);

  const moveMetric = async (id: number, dir: -1 | 1) => {
    const idx = activeSorted.findIndex((m) => m.id === id);
    const swapIdx = idx + dir;
    if (idx < 0 || swapIdx < 0 || swapIdx >= activeSorted.length) return;
    const reordered = [...activeSorted];
    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
    const metricIds = [...reordered.map((m) => m.id), ...archivedSorted.map((m) => m.id)];
    const res = await fetch(apiUrl(`/eos/individual-scorecards/${scId}/metrics/reorder`), {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ metricIds }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(typeof j.error === "string" ? j.error : "Could not reorder metrics");
      return;
    }
    onSaved();
  };

  return (
    <div className={styles.modalOverlay} role="dialog" aria-modal>
      <div className={styles.modal} style={{ maxWidth: "36rem" }}>
        <h2>Manage metrics</h2>
        <p className={styles.muted} style={{ marginTop: "-0.5rem" }}>
          Archive hides a metric; entry history is kept. Permanently delete removes all history.
        </p>

        <h3 style={{ fontSize: "0.95rem", color: "#1b2856", marginBottom: "0.35rem" }}>Active metrics</h3>
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 1rem" }}>
          {activeSorted.map((m, i) => (
            <li key={m.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.35rem 0", borderBottom: "1px solid rgba(27,40,86,0.08)" }}>
              <span style={{ flex: 1, fontWeight: 600, color: "#1b2856" }}>{m.name}</span>
              <button type="button" className={styles.presetBtn} onClick={() => moveMetric(m.id, -1)} disabled={i === 0} aria-label="Move up">↑</button>
              <button type="button" className={styles.presetBtn} onClick={() => moveMetric(m.id, 1)} disabled={i === activeSorted.length - 1} aria-label="Move down">↓</button>
              <button type="button" className={styles.presetBtn} onClick={async () => {
                if (!confirm("Archive this metric?")) return;
                await fetch(apiUrl(`/eos/individual-scorecard-metrics/${m.id}`), { method: "DELETE", headers: { ...authHeaders() } });
                onSaved();
              }}>Archive</button>
            </li>
          ))}
        </ul>

        <div style={{ marginBottom: "1rem", borderTop: "1px solid rgba(27,40,86,0.1)", paddingTop: "0.75rem" }}>
          <button type="button" onClick={() => setArchivedOpen((o) => !o)} className={styles.presetBtn}
            style={{ width: "100%", textAlign: "left", fontWeight: 700, marginBottom: archivedOpen ? "0.5rem" : 0 }}>
            Archived ({archivedSorted.length}) {archivedOpen ? "▾" : "▸"}
          </button>
          {archivedOpen ? (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {archivedSorted.length === 0 ? <li className={styles.muted} style={{ padding: "0.25rem 0" }}>No archived metrics.</li> : archivedSorted.map((m) => (
                <li key={m.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", padding: "0.45rem 0", borderBottom: "1px solid rgba(27,40,86,0.06)" }}>
                  <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: "#6a737b" }}>{m.name}</div>
                    <div className={styles.muted} style={{ fontSize: "0.78rem" }}>Goal {formatGoal(m.unit, m.goalValue ?? 0)} ({m.goalDirection})</div>
                  </div>
                  <button type="button" className={styles.presetBtn} onClick={async () => {
                    await fetch(apiUrl(`/eos/individual-scorecard-metrics/${m.id}`), {
                      method: "PUT", headers: { "Content-Type": "application/json", ...authHeaders() },
                      body: JSON.stringify({ isActive: true }),
                    });
                    onSaved();
                  }}>Restore</button>
                  <button type="button" className={styles.presetBtn} style={{ color: "#b32317", borderColor: "rgba(179,35,23,0.35)" }}
                    onClick={() => setPermanentTarget(m)}>Delete permanently</button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {permanentTarget ? (
          <ConfirmModal nested title="Delete metric"
            body={`Permanently delete ${permanentTarget.name} and all its historical data? This cannot be undone.`}
            confirmLabel="Delete permanently" onClose={() => setPermanentTarget(null)}
            onConfirm={async () => {
              await fetch(apiUrl(`/eos/individual-scorecard-metrics/${permanentTarget.id}/permanent`), { method: "DELETE", headers: { ...authHeaders() } });
              setPermanentTarget(null); onSaved();
            }} />
        ) : null}

        <h3 style={{ fontSize: "0.95rem", color: "#1b2856" }}>Add metric</h3>
        <div className={styles.formGrid}>
          <label>Name <input className={styles.input} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></label>
          <label>Frequency
            <select className={styles.select} value={form.frequency} onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value as "weekly" | "monthly" }))}>
              <option value="weekly">Weekly</option><option value="monthly">Monthly</option>
            </select>
          </label>
          <label>Goal value <input className={styles.input} value={form.goalValue} onChange={(e) => setForm((f) => ({ ...f, goalValue: e.target.value }))} /></label>
          <label>Direction
            <select className={styles.select} value={form.goalDirection} onChange={(e) => setForm((f) => ({ ...f, goalDirection: e.target.value as typeof form.goalDirection }))}>
              <option value="above">Above</option><option value="below">Below</option><option value="exact">Exact</option>
            </select>
          </label>
          <label>Unit
            <select className={styles.select} value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value as typeof form.unit }))}>
              <option value="number">Number</option><option value="currency">Currency</option>
              <option value="percentage">Percentage</option><option value="days">Days</option>
            </select>
          </label>
        </div>
        <div className={styles.modalActions}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose}>Close</button>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={async () => {
            await fetch(apiUrl(`/eos/individual-scorecards/${scId}/metrics`), {
              method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
              body: JSON.stringify({ name: form.name, description: form.description || null, frequency: form.frequency, goalValue: Number(form.goalValue), goalDirection: form.goalDirection, unit: form.unit }),
            });
            onSaved();
            setForm({ name: "", description: "", frequency: "weekly", goalValue: "", goalDirection: "above", unit: "number" });
          }}>Add metric</button>
        </div>
      </div>
    </div>
  );
}
