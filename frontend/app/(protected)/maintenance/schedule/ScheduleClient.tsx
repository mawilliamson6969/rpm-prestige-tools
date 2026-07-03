"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { apiUrl } from "../../../../lib/api";
import { useAuth } from "../../../../context/AuthContext";
import styles from "./schedule.module.css";
import { addDays, dayKey, startOfWeek, type Assignment } from "./types";

type JobOption = { id: number; title: string; propertyName?: string; status: string };
type TechOption = { id: number; name: string; hourlyRate: number | null };

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

const money = (n: number) => `$${n.toFixed(2)}`;

export default function ScheduleClient() {
  const { authHeaders, token } = useAuth();
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Assignment | null>(null);
  const [presetDay, setPresetDay] = useState<Date | null>(null);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);
  const todayKey = dayKey(new Date());

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      params.set("from", weekStart.toISOString());
      params.set("to", weekEnd.toISOString());
      const res = await fetch(apiUrl(`/maintenance/assignments?${params.toString()}`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Load failed.");
      }
      setAssignments(body.assignments || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load schedule.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token, weekStart, weekEnd]);

  useEffect(() => {
    load();
  }, [load]);

  const byDay = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    for (const a of assignments) {
      if (!a.scheduledStart) continue;
      const k = dayKey(new Date(a.scheduledStart));
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(a);
    }
    return map;
  }, [assignments]);

  // Suggest-only weekly billing rollup grouped by tech.
  const rollup = useMemo(() => {
    const byTech = new Map<number, { name: string; hours: number; cost: number }>();
    for (const a of assignments) {
      const cur = byTech.get(a.techId) ?? { name: a.techName ?? `Tech #${a.techId}`, hours: 0, cost: 0 };
      cur.hours += a.hoursLogged || 0;
      cur.cost += a.lineCost || 0;
      byTech.set(a.techId, cur);
    }
    const rows = Array.from(byTech.values()).sort((x, y) => y.cost - x.cost);
    const totalHours = rows.reduce((s, r) => s + r.hours, 0);
    const totalCost = rows.reduce((s, r) => s + r.cost, 0);
    return { rows, totalHours, totalCost };
  }, [assignments]);

  const weekLabel = `${weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${addDays(
    weekStart,
    6
  ).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Schedule</h1>
          <p className={styles.subtitle}>
            Assign techs to jobs across the week. Logged hours roll up to a labor
            estimate — suggest-only, nothing posts to AppFolio.
          </p>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => {
              setEditing(null);
              setPresetDay(new Date());
              setModalOpen(true);
            }}
          >
            <Plus size={14} /> New Assignment
          </button>
        </div>
      </header>

      <div className={styles.weekNav}>
        <button
          type="button"
          className={styles.btn}
          onClick={() => setWeekStart((w) => addDays(w, -7))}
          aria-label="Previous week"
        >
          <ChevronLeft size={16} />
        </button>
        <span className={styles.weekLabel}>{weekLabel}</span>
        <button
          type="button"
          className={styles.btn}
          onClick={() => setWeekStart((w) => addDays(w, 7))}
          aria-label="Next week"
        >
          <ChevronRight size={16} />
        </button>
        <button
          type="button"
          className={styles.btn}
          onClick={() => setWeekStart(startOfWeek(new Date()))}
        >
          Today
        </button>
      </div>

      {err ? <div className={styles.errorBanner}>{err}</div> : null}

      {loading ? (
        <div className={styles.loading}>Loading schedule…</div>
      ) : (
        <div className={styles.grid}>
          {days.map((day, i) => {
            const k = dayKey(day);
            const items = (byDay.get(k) ?? []).sort((a, b) =>
              (a.scheduledStart ?? "").localeCompare(b.scheduledStart ?? "")
            );
            return (
              <div key={k} className={styles.dayCol}>
                <div
                  className={`${styles.dayHeader} ${k === todayKey ? styles.dayHeaderToday : ""}`}
                >
                  <span>{DAY_NAMES[i]}</span>
                  <span className={styles.dayDate}>{day.getDate()}</span>
                </div>
                <div className={styles.dayBody}>
                  {items.length === 0 ? (
                    <div
                      className={styles.dayEmpty}
                      onClick={() => {
                        setEditing(null);
                        setPresetDay(day);
                        setModalOpen(true);
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      + Add
                    </div>
                  ) : (
                    items.map((a) => (
                      <div
                        key={a.id}
                        className={styles.assignCard}
                        onClick={() => {
                          setEditing(a);
                          setPresetDay(null);
                          setModalOpen(true);
                        }}
                      >
                        <div className={styles.assignTime}>
                          {fmtTime(a.scheduledStart)}
                          {a.scheduledEnd ? `–${fmtTime(a.scheduledEnd)}` : ""}
                        </div>
                        <div className={styles.assignTech}>{a.techName}</div>
                        <div className={styles.assignJob}>{a.jobTitle}</div>
                        {a.hoursLogged > 0 ? (
                          <div className={styles.assignHours}>
                            {a.hoursLogged}h
                            {a.lineCost != null ? ` · ${money(a.lineCost)}` : ""}
                          </div>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className={styles.rollup}>
        <div className={styles.rollupHead}>
          <span className={styles.rollupTitle}>Labor rollup — this week</span>
          <span className={styles.suggestBadge}>Suggest-only</span>
        </div>
        {rollup.rows.length === 0 ? (
          <p style={{ color: "var(--text-secondary, #6a737b)", fontSize: "0.85rem", margin: 0 }}>
            No logged hours this week.
          </p>
        ) : (
          <table className={styles.rollupTable}>
            <thead>
              <tr>
                <th>Tech</th>
                <th className={styles.num}>Hours</th>
                <th className={styles.num}>Est. labor</th>
              </tr>
            </thead>
            <tbody>
              {rollup.rows.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td className={styles.num}>{r.hours}</td>
                  <td className={styles.num}>{money(r.cost)}</td>
                </tr>
              ))}
              <tr className={styles.rollupTotal}>
                <td>Total</td>
                <td className={styles.num}>{Math.round(rollup.totalHours * 100) / 100}</td>
                <td className={styles.num}>{money(rollup.totalCost)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      <AssignmentModal
        open={modalOpen}
        assignment={editing}
        presetDay={presetDay}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          setModalOpen(false);
          load();
        }}
      />
    </div>
  );
}

function AssignmentModal({
  open,
  assignment,
  presetDay,
  onClose,
  onSaved,
}: {
  open: boolean;
  assignment: Assignment | null;
  presetDay: Date | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { authHeaders, token } = useAuth();
  const isEdit = !!assignment;

  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [techs, setTechs] = useState<TechOption[]>([]);
  const [jobId, setJobId] = useState("");
  const [techId, setTechId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [hours, setHours] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    if (assignment) {
      setJobId(String(assignment.jobId));
      setTechId(String(assignment.techId));
      setStart(toLocalInput(assignment.scheduledStart));
      setEnd(toLocalInput(assignment.scheduledEnd));
      setHours(assignment.hoursLogged ? String(assignment.hoursLogged) : "");
      setNotes(assignment.notes ?? "");
    } else {
      setJobId("");
      setTechId("");
      // Default a new assignment to 9:00 AM on the clicked day.
      const base = presetDay ? new Date(presetDay) : new Date();
      base.setHours(9, 0, 0, 0);
      setStart(toLocalInput(base.toISOString()));
      setEnd("");
      setHours("");
      setNotes("");
    }
  }, [open, assignment, presetDay]);

  // Load job + tech pickers when the modal opens.
  useEffect(() => {
    if (!open || !token) return;
    let cancelled = false;
    (async () => {
      try {
        const [jr, tr] = await Promise.all([
          fetch(apiUrl("/maintenance/jobs"), { headers: { ...authHeaders() }, cache: "no-store" }),
          fetch(apiUrl("/maintenance/techs"), { headers: { ...authHeaders() }, cache: "no-store" }),
        ]);
        const jb = await jr.json().catch(() => ({}));
        const tb = await tr.json().catch(() => ({}));
        if (cancelled) return;
        if (jr.ok) setJobs(jb.jobs || []);
        if (tr.ok) setTechs(tb.techs || []);
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, token, authHeaders]);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEdit && (!jobId || !techId)) {
      setErr("Job and tech are required.");
      return;
    }
    if (start && end && new Date(end) < new Date(start)) {
      setErr("End must be after start.");
      return;
    }
    if (hours.trim() && !(Number(hours) >= 0)) {
      setErr("Hours must be a non-negative number.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const common = {
        scheduledStart: fromLocalInput(start),
        scheduledEnd: fromLocalInput(end),
        hoursLogged: hours.trim() ? Number(hours) : 0,
        notes: notes.trim() || null,
      };
      const res = await fetch(
        isEdit && assignment
          ? apiUrl(`/maintenance/assignments/${assignment.id}`)
          : apiUrl("/maintenance/assignments"),
        {
          method: isEdit ? "PUT" : "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(
            isEdit ? common : { ...common, jobId: Number(jobId), techId: Number(techId) }
          ),
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Save failed.");
      }
      onSaved();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Could not save assignment.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!assignment) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(apiUrl(`/maintenance/assignments/${assignment.id}`), {
        method: "DELETE",
        headers: { ...authHeaders() },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body.error === "string" ? body.error : "Delete failed.");
      }
      onSaved();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Could not delete assignment.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>{isEdit ? "Edit Assignment" : "New Assignment"}</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form className={styles.modalBody} onSubmit={submit}>
          {err ? <div className={styles.errorBanner}>{err}</div> : null}

          <div className={styles.field}>
            <label>Job</label>
            {isEdit ? (
              <input value={assignment?.jobTitle || `Job #${assignment?.jobId}`} disabled />
            ) : (
              <select value={jobId} onChange={(e) => setJobId(e.target.value)} required>
                <option value="">Select a job…</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title}
                    {j.propertyName ? ` — ${j.propertyName}` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className={styles.field}>
            <label>Tech</label>
            {isEdit ? (
              <input value={assignment?.techName || `Tech #${assignment?.techId}`} disabled />
            ) : (
              <select value={techId} onChange={(e) => setTechId(e.target.value)} required>
                <option value="">Select a tech…</option>
                {techs.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.hourlyRate != null ? ` — $${t.hourlyRate}/hr` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label>Start</label>
              <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className={styles.field}>
              <label>End</label>
              <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>

          <div className={styles.field}>
            <label>Hours logged</label>
            <input
              type="number"
              min="0"
              step="0.25"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              placeholder="0"
            />
          </div>

          <div className={styles.field}>
            <label>Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className={styles.formFooter}>
            {isEdit ? (
              <button type="button" className={`${styles.btn} ${styles.btnDanger}`} onClick={remove} disabled={saving}>
                Delete
              </button>
            ) : (
              <span />
            )}
            <div className={styles.footerRight}>
              <button type="button" className={styles.btn} onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving}>
                {saving ? "Saving…" : isEdit ? "Save" : "Create"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
