"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw, Briefcase, ExternalLink } from "lucide-react";
import { apiUrl } from "../../../../lib/api";
import { useAuth } from "../../../../context/AuthContext";
import styles from "./projects.module.css";
import {
  STATUS_LABELS,
  STATUS_ORDER,
  type ChildJob,
  type MaintProject,
  type ProcessTemplate,
  type ProjectStatus,
} from "./types";

type PropertyOption = { id: string; name: string | null; address1: string | null };
type UnitOption = { id: string; name: string | null };

function badgeClass(s: ProjectStatus): string {
  switch (s) {
    case "active":
      return styles.badgeActive;
    case "on_hold":
      return styles.badgeOn_hold;
    case "complete":
      return styles.badgeComplete;
    default:
      return styles.badgeCancelled;
  }
}

function Progress({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className={styles.progressWrap}>
      <div className={styles.progressBar}>
        <div className={styles.progressFill} style={{ width: `${pct}%` }} />
      </div>
      <span className={styles.progressText}>
        {total > 0 ? `${done}/${total}` : "—"}
      </span>
    </div>
  );
}

export default function ProjectsClient() {
  const { authHeaders, token } = useAuth();
  const [projects, setProjects] = useState<MaintProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | "">("");
  const [newOpen, setNewOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(apiUrl(`/maintenance/projects?${params.toString()}`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Load failed.");
      setProjects(body.projects || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load projects.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Make-Ready Projects</h1>
          <p className={styles.subtitle}>
            Turnovers and multi-task projects — parent of child jobs, with a
            checklist driven by the process engine.
          </p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={load} disabled={loading}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => setNewOpen(true)}
          >
            <Plus size={14} /> New Project
          </button>
        </div>
      </header>

      <div className={styles.searchRow}>
        <button
          type="button"
          className={`${styles.chip} ${statusFilter === "" ? styles.chipActive : ""}`}
          onClick={() => setStatusFilter("")}
        >
          All
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

      {err ? <div className={styles.errorBanner}>{err}</div> : null}

      <div className={styles.card}>
        {loading ? (
          <div className={styles.loading}>Loading projects…</div>
        ) : projects.length === 0 ? (
          <div className={styles.empty}>
            <Briefcase size={28} color="var(--text-secondary, #6a737b)" />
            <p>{statusFilter ? "No projects match that filter." : "No make-ready projects yet."}</p>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Property / Unit</th>
                  <th>Status</th>
                  <th>Jobs</th>
                  <th>Checklist</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className={styles.rowLink} onClick={() => setDetailId(p.id)}>
                    <td>
                      <strong>{p.name}</strong>
                    </td>
                    <td>
                      {p.propertyName || <span className={styles.muted}>—</span>}
                      {p.unitName ? <span className={styles.muted}> · {p.unitName}</span> : null}
                    </td>
                    <td>
                      <span className={`${styles.badge} ${badgeClass(p.status)}`}>
                        {STATUS_LABELS[p.status]}
                      </span>
                    </td>
                    <td>{p.jobCount}</td>
                    <td>
                      {p.processId ? (
                        <Progress done={p.completedSteps} total={p.totalSteps} />
                      ) : (
                        <span className={styles.muted}>Not started</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {newOpen ? (
        <NewProjectModal
          onClose={() => setNewOpen(false)}
          onCreated={(id) => {
            setNewOpen(false);
            load();
            setDetailId(id);
          }}
        />
      ) : null}

      {detailId != null ? (
        <ProjectDetail projectId={detailId} onClose={() => setDetailId(null)} onChanged={load} />
      ) : null}
    </div>
  );
}

function NewProjectModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const { authHeaders, token } = useAuth();
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [name, setName] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [target, setTarget] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
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
        /* non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, authHeaders]);

  useEffect(() => {
    if (!token || !propertyId) {
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
  }, [token, authHeaders, propertyId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErr("Name is required.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(apiUrl("/maintenance/projects"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          name: name.trim(),
          propertyId: propertyId || null,
          unitId: unitId || null,
          targetCompletion: target || null,
          notes: notes.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Create failed.");
      onCreated(body.project.id);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Could not create project.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div className={styles.modalHeaderMain}>
            <h2>New Make-Ready Project</h2>
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form className={styles.modalBody} onSubmit={submit}>
          {err ? <div className={styles.errorBanner}>{err}</div> : null}
          <div className={styles.field}>
            <label>Project name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
              placeholder="e.g. 123 Main St — Unit B turnover"
            />
          </div>
          <div className={styles.field}>
            <label>Property</label>
            <select
              value={propertyId}
              onChange={(e) => {
                setPropertyId(e.target.value);
                setUnitId("");
              }}
            >
              <option value="">No property</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || p.address1 || p.id}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label>Unit (optional)</label>
              <select
                value={unitId}
                onChange={(e) => setUnitId(e.target.value)}
                disabled={!propertyId || units.length === 0}
              >
                <option value="">{units.length === 0 ? "—" : "Property-level"}</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name || u.id}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label>Target completion</label>
              <input type="date" value={target} onChange={(e) => setTarget(e.target.value)} />
            </div>
          </div>
          <div className={styles.field}>
            <label>Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className={styles.formFooter}>
            <span />
            <div className={styles.footerRight}>
              <button type="button" className={styles.btn} onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving}>
                {saving ? "Creating…" : "Create & Open"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function ProjectDetail({
  projectId,
  onClose,
  onChanged,
}: {
  projectId: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { authHeaders, token } = useAuth();
  const [project, setProject] = useState<MaintProject | null>(null);
  const [jobs, setJobs] = useState<ChildJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("active");
  const [target, setTarget] = useState("");
  const [notes, setNotes] = useState("");

  const [newJobTitle, setNewJobTitle] = useState("");
  const [newJobPriority, setNewJobPriority] = useState("normal");

  const [templates, setTemplates] = useState<ProcessTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(apiUrl(`/maintenance/projects/${projectId}`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Load failed.");
      setProject(body.project);
      setJobs(body.jobs || []);
      setName(body.project?.name ?? "");
      setStatus(body.project?.status ?? "active");
      setTarget(body.project?.targetCompletion ? body.project.targetCompletion.slice(0, 10) : "");
      setNotes(body.project?.notes ?? "");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load project.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token, projectId]);

  useEffect(() => {
    load();
  }, [load]);

  // Load process templates only when the project has no checklist yet.
  useEffect(() => {
    if (!token || !project || project.processId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl("/processes/templates"), {
          headers: { ...authHeaders() },
          cache: "no-store",
        });
        const body = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) return;
        // Surface Maintenance-category templates first (turnover / make-ready).
        const list: ProcessTemplate[] = body.templates || [];
        list.sort((a, b) => {
          const am = a.category === "Maintenance" ? 0 : 1;
          const bm = b.category === "Maintenance" ? 0 : 1;
          return am - bm;
        });
        setTemplates(list);
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, authHeaders, project]);

  const api = useCallback(
    async (path: string, method: string, bodyObj?: unknown) => {
      const res = await fetch(apiUrl(path), {
        method,
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: bodyObj ? JSON.stringify(bodyObj) : undefined,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Request failed.");
      return body;
    },
    [authHeaders]
  );

  const saveHeader = async () => {
    setErr(null);
    try {
      await api(`/maintenance/projects/${projectId}`, "PUT", {
        name: name.trim(),
        status,
        targetCompletion: target || null,
        notes: notes.trim() || null,
      });
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed.");
    }
  };

  const addJob = async () => {
    if (!project?.propertyId) {
      setErr("Add a property to the project before adding jobs.");
      return;
    }
    if (!newJobTitle.trim()) {
      setErr("Job title is required.");
      return;
    }
    setErr(null);
    try {
      await api("/maintenance/jobs", "POST", {
        propertyId: project.propertyId,
        unitId: project.unitId,
        projectId,
        title: newJobTitle.trim(),
        priority: newJobPriority,
        source: "inspection",
      });
      setNewJobTitle("");
      await load();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add job.");
    }
  };

  // Spawn a process from a template (reusing the process engine) and link it.
  const startChecklist = async () => {
    if (!templateId) {
      setErr("Pick a checklist template.");
      return;
    }
    setStarting(true);
    setErr(null);
    try {
      // processes.property_id is a legacy INTEGER; link by name instead.
      const spawn = await api("/processes", "POST", {
        templateId: Number(templateId),
        propertyName: project?.propertyName || project?.name,
        targetCompletion: target || undefined,
        notes: `Make-ready checklist for project #${projectId}`,
      });
      const newProcessId = spawn?.process?.id;
      if (!newProcessId) throw new Error("Process did not return an id.");
      await api(`/maintenance/projects/${projectId}`, "PUT", { processId: newProcessId });
      await load();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not start checklist.");
    } finally {
      setStarting(false);
    }
  };

  const remove = async () => {
    setErr(null);
    try {
      await api(`/maintenance/projects/${projectId}`, "DELETE");
      onChanged();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not delete project.");
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div className={styles.modalHeaderMain}>
            <h2>{project?.name || `Project #${projectId}`}</h2>
            {project ? (
              <span className={`${styles.badge} ${badgeClass(project.status)}`}>
                {STATUS_LABELS[project.status]}
              </span>
            ) : null}
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className={styles.modalBody}>
          {err ? <div className={styles.errorBanner}>{err}</div> : null}
          {loading || !project ? (
            <div className={styles.loading}>Loading…</div>
          ) : (
            <>
              <p className={styles.metaLine}>
                {project.propertyName || "No property"}
                {project.unitName ? ` · ${project.unitName}` : ""}
              </p>

              <div className={styles.fieldRow}>
                <div className={styles.field}>
                  <label>Name</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} onBlur={saveHeader} />
                </div>
                <div className={styles.field}>
                  <label>Status</label>
                  <select
                    value={status}
                    onChange={(e) => {
                      setStatus(e.target.value as ProjectStatus);
                      // Persist immediately on status change.
                      setTimeout(saveHeader, 0);
                    }}
                  >
                    {STATUS_ORDER.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className={styles.fieldRow}>
                <div className={styles.field}>
                  <label>Target completion</label>
                  <input type="date" value={target} onChange={(e) => setTarget(e.target.value)} onBlur={saveHeader} />
                </div>
              </div>
              <div className={styles.field}>
                <label>Notes</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={saveHeader} />
              </div>

              {/* Checklist (process engine) */}
              <div className={styles.sectionLabel}>Checklist</div>
              {project.processId ? (
                <div className={styles.checklistBox}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
                    <strong style={{ color: "var(--rpm-navy, #1b2856)" }}>
                      {project.processName || "Checklist"}
                    </strong>
                    <a
                      className={`${styles.btn} ${styles.btnSmall}`}
                      href="/operations/processes"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open <ExternalLink size={13} />
                    </a>
                  </div>
                  <div style={{ marginTop: "0.5rem" }}>
                    <Progress done={project.completedSteps} total={project.totalSteps} />
                  </div>
                </div>
              ) : (
                <div className={styles.checklistBox}>
                  <p className={styles.metaLine} style={{ marginBottom: "0.5rem" }}>
                    Start a make-ready checklist from a process template. It becomes a
                    tracked process in Operations.
                  </p>
                  <div className={styles.addRow}>
                    <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} style={{ flex: 1 }}>
                      <option value="">Select a template…</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.icon ? `${t.icon} ` : ""}
                          {t.name}
                          {t.category ? ` (${t.category})` : ""}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSmall}`}
                      onClick={startChecklist}
                      disabled={starting || !templateId}
                    >
                      {starting ? "Starting…" : "Start checklist"}
                    </button>
                  </div>
                </div>
              )}

              {/* Child jobs */}
              <div className={styles.sectionLabel}>Jobs ({jobs.length})</div>
              {jobs.length === 0 ? (
                <p className={styles.metaLine}>No jobs under this project yet.</p>
              ) : (
                <div>
                  {jobs.map((j) => (
                    <div key={j.id} className={styles.jobRow}>
                      <span>{j.title}</span>
                      <span>
                        <span className={styles.pill}>{j.status.replace("_", " ")}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className={styles.addRow}>
                <input
                  value={newJobTitle}
                  onChange={(e) => setNewJobTitle(e.target.value)}
                  placeholder={project.propertyId ? "New job title…" : "Add a property first to add jobs"}
                  disabled={!project.propertyId}
                />
                <select
                  value={newJobPriority}
                  onChange={(e) => setNewJobPriority(e.target.value)}
                  disabled={!project.propertyId}
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnSmall}`}
                  onClick={addJob}
                  disabled={!project.propertyId}
                >
                  Add job
                </button>
              </div>

              <div className={styles.formFooter}>
                <button type="button" className={`${styles.btn} ${styles.btnDanger}`} onClick={remove}>
                  Delete project
                </button>
                <div className={styles.footerRight}>
                  <button type="button" className={styles.btn} onClick={onClose}>
                    Close
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
