"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw, Wrench } from "lucide-react";
import { apiUrl } from "../../../../lib/api";
import { useAuth } from "../../../../context/AuthContext";
import styles from "./maintenance.module.css";
import {
  PRIORITY_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
  STATUS_ORDER,
  type JobPriority,
  type JobSource,
  type JobStatus,
  type MaintJob,
  type PropertyOption,
  type UnitOption,
} from "./types";

const PRIORITY_ORDER: JobPriority[] = ["low", "normal", "high", "urgent"];
const SOURCE_ORDER: JobSource[] = ["tenant_report", "inspection", "owner_request"];

function priorityClass(p: JobPriority): string {
  switch (p) {
    case "urgent":
      return styles.priorityUrgent;
    case "high":
      return styles.priorityHigh;
    case "normal":
      return styles.priorityNormal;
    default:
      return styles.priorityLow;
  }
}

function statusClass(s: JobStatus): string {
  if (s === "complete" || s === "invoiced") return styles.statusComplete;
  if (s === "in_progress" || s === "scheduled") return styles.statusInProgress;
  return "";
}

/** Green >24h out, orange within 24h, red past due. */
function slaParts(slaDueAt: string | null): { cls: string; label: string } | null {
  if (!slaDueAt) return null;
  const due = new Date(slaDueAt).getTime();
  if (Number.isNaN(due)) return null;
  const hrs = (due - Date.now()) / 36e5;
  const label = new Date(slaDueAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  if (hrs < 0) return { cls: styles.slaLate, label: `${label} (overdue)` };
  if (hrs < 24) return { cls: styles.slaWarn, label };
  return { cls: styles.slaOk, label };
}

export default function MaintenanceJobsClient() {
  const { authHeaders, token } = useAuth();
  const [jobs, setJobs] = useState<MaintJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<JobStatus | "">("");
  const [priorityFilter, setPriorityFilter] = useState<JobPriority | "">("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<MaintJob | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (priorityFilter) params.set("priority", priorityFilter);
      const res = await fetch(apiUrl(`/maintenance/jobs?${params.toString()}`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Load failed.");
      }
      setJobs(body.jobs || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load jobs.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token, statusFilter, priorityFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const changeStatus = async (job: MaintJob, status: JobStatus) => {
    if (status === job.status) return;
    setErr(null);
    // Optimistic: reflect the new status immediately, roll back on failure.
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status } : j)));
    try {
      const res = await fetch(apiUrl(`/maintenance/jobs/${job.id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ status }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Update failed.");
      }
      // Re-sync from server (respects the active status filter).
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not update status.");
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: job.status } : j)));
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Maintenance Jobs</h1>
          <p className={styles.subtitle}>
            Work orders across the portfolio — triage, schedule, and track every
            ticket through to invoiced.
          </p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={load} disabled={loading}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            <Plus size={14} /> New Job
          </button>
        </div>
      </header>

      <div className={styles.searchRow}>
        <div className={styles.chips}>
          <button
            type="button"
            className={`${styles.chip} ${statusFilter === "" ? styles.chipActive : ""}`}
            onClick={() => setStatusFilter("")}
          >
            All statuses
          </button>
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              type="button"
              className={`${styles.chip} ${statusFilter === s ? styles.chipActive : ""}`}
              onClick={() => setStatusFilter(s)}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.searchRow}>
        <div className={styles.chips}>
          <button
            type="button"
            className={`${styles.chip} ${priorityFilter === "" ? styles.chipActive : ""}`}
            onClick={() => setPriorityFilter("")}
          >
            All priorities
          </button>
          {PRIORITY_ORDER.map((p) => (
            <button
              key={p}
              type="button"
              className={`${styles.chip} ${priorityFilter === p ? styles.chipActive : ""}`}
              onClick={() => setPriorityFilter(p)}
            >
              {PRIORITY_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {err ? <div className={styles.errorBanner}>{err}</div> : null}

      <div className={styles.card}>
        {loading ? (
          <div className={styles.loading}>Loading jobs…</div>
        ) : jobs.length === 0 ? (
          <div className={styles.empty}>
            <Wrench size={28} color="var(--text-secondary, #6a737b)" />
            <p>
              {statusFilter || priorityFilter
                ? "No jobs match that filter."
                : "No maintenance jobs yet. Create the first one."}
            </p>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Property / Unit</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>SLA due</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => {
                  const sla = slaParts(j.slaDueAt);
                  return (
                    <tr
                      key={j.id}
                      className={styles.rowLink}
                      onClick={() => {
                        setEditing(j);
                        setModalOpen(true);
                      }}
                    >
                      <td>
                        <strong>{j.title}</strong>
                      </td>
                      <td>
                        {j.propertyName || j.propertyAddress || j.propertyId}
                        {j.unitName ? (
                          <span className={styles.muted}> · {j.unitName}</span>
                        ) : null}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <select
                          className={styles.inlineSelect}
                          value={j.status}
                          onChange={(e) => changeStatus(j, e.target.value as JobStatus)}
                          aria-label="Change status"
                        >
                          {STATUS_ORDER.map((s) => (
                            <option key={s} value={s}>
                              {STATUS_LABELS[s]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <span className={`${styles.priority} ${priorityClass(j.priority)}`}>
                          {PRIORITY_LABELS[j.priority]}
                        </span>
                      </td>
                      <td>
                        {sla ? (
                          <span className={sla.cls}>{sla.label}</span>
                        ) : (
                          <span className={styles.muted}>—</span>
                        )}
                      </td>
                      <td className={j.source ? "" : styles.muted}>
                        {j.source ? SOURCE_LABELS[j.source] : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <JobModal
        open={modalOpen}
        job={editing}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          setModalOpen(false);
          load();
        }}
      />
    </div>
  );
}

function JobModal({
  open,
  job,
  onClose,
  onSaved,
}: {
  open: boolean;
  job: MaintJob | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { authHeaders, token } = useAuth();
  const isEdit = !!job;

  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [propertyId, setPropertyId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<JobPriority>("normal");
  const [status, setStatus] = useState<JobStatus>("new");
  const [source, setSource] = useState<JobSource | "">("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Seed the form when the modal opens (create → blank, edit → job values).
  useEffect(() => {
    if (!open) return;
    setErr(null);
    setTitle(job?.title ?? "");
    setDescription(job?.description ?? "");
    setPriority(job?.priority ?? "normal");
    setStatus(job?.status ?? "new");
    setSource(job?.source ?? "");
    setPropertyId(job?.propertyId ?? "");
    setUnitId(job?.unitId ?? "");
  }, [open, job]);

  // Load the property list (mirror-backed) once the modal opens.
  useEffect(() => {
    if (!open || !token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl("/maintenance/properties"), {
          headers: { ...authHeaders() },
          cache: "no-store",
        });
        const body = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) setProperties(body.properties || []);
      } catch {
        /* non-fatal — the field just stays empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, token, authHeaders]);

  // Load units whenever the selected property changes.
  useEffect(() => {
    if (!open || !token || !propertyId) {
      setUnits([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          apiUrl(`/maintenance/properties/${encodeURIComponent(propertyId)}/units`),
          { headers: { ...authHeaders() }, cache: "no-store" }
        );
        const body = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) setUnits(body.units || []);
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, token, authHeaders, propertyId]);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!propertyId) {
      setErr("Property is required.");
      return;
    }
    if (!title.trim()) {
      setErr("Title is required.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const payload: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim() || null,
        priority,
        source: source || null,
        unitId: unitId || null,
      };
      let res: Response;
      if (isEdit && job) {
        // Status is editable only from the edit form.
        payload.status = status;
        res = await fetch(apiUrl(`/maintenance/jobs/${job.id}`), {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(payload),
        });
      } else {
        payload.propertyId = propertyId;
        res = await fetch(apiUrl("/maintenance/jobs"), {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(payload),
        });
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Save failed.");
      }
      onSaved();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Could not save job.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>{isEdit ? "Edit Job" : "New Job"}</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form className={styles.modalBody} onSubmit={submit}>
          {err ? <div className={styles.errorBanner}>{err}</div> : null}

          <div className={styles.field}>
            <label>Property</label>
            {isEdit ? (
              <input value={job?.propertyName || job?.propertyId || ""} disabled />
            ) : (
              <select
                value={propertyId}
                onChange={(e) => {
                  setPropertyId(e.target.value);
                  setUnitId("");
                }}
                required
              >
                <option value="">Select a property…</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name || p.address1 || p.id}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className={styles.field}>
            <label>Unit (optional)</label>
            <select
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
              disabled={!propertyId || units.length === 0}
            >
              <option value="">
                {units.length === 0 ? "No units / property-level" : "Property-level (no unit)"}
              </option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name || u.address1 || u.id}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label>Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />
          </div>

          <div className={styles.field}>
            <label>Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label>Priority</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value as JobPriority)}>
                {PRIORITY_ORDER.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label>Source</label>
              <select value={source} onChange={(e) => setSource(e.target.value as JobSource | "")}>
                <option value="">—</option>
                {SOURCE_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {SOURCE_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {isEdit ? (
            <div className={styles.field}>
              <label>Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as JobStatus)}>
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className={styles.formFooter}>
            <button type="button" className={styles.btn} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving}>
              {saving ? "Saving…" : isEdit ? "Save Changes" : "Create Job"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
