"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../../operations.module.css";
import OperationsTopBar from "../../OperationsTopBar";
import { apiUrl } from "../../../../../lib/api";
import { useAuth, RequireAdmin } from "../../../../../context/AuthContext";
import type { Template, TemplateStep, TeamUser } from "../../types";
import { ROLES } from "../../types";

const CATEGORY_CHOICES = [
  "Owner Relations",
  "Leasing",
  "Maintenance",
  "Operations",
  "Admin",
  "Marketing",
  "Finance",
  "Other",
];

export default function TemplateEditorClient({ templateId }: { templateId: string }) {
  return (
    <RequireAdmin>
      <TemplateEditorInner templateId={templateId} />
    </RequireAdmin>
  );
}

function TemplateEditorInner({ templateId }: { templateId: string }) {
  const { authHeaders, token } = useAuth();
  const router = useRouter();
  const [template, setTemplate] = useState<Template | null>(null);
  const [steps, setSteps] = useState<TemplateStep[]>([]);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(apiUrl(`/processes/templates/${templateId}`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Load failed.");
      setTemplate(body.template);
      setSteps(body.steps || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load template.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token, templateId]);

  const loadUsers = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl("/users"), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = await res.json();
      if (Array.isArray(body.users)) setUsers(body.users);
    } catch {
      /* ignore */
    }
  }, [authHeaders, token]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const updateTemplate = async (patch: Partial<Template>) => {
    if (!template) return;
    setTemplate({ ...template, ...patch });
    try {
      await fetch(apiUrl(`/processes/templates/${template.id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(patch),
      });
    } catch {
      /* ignore */
    }
  };

  const addStep = async () => {
    if (!template) return;
    try {
      const res = await fetch(apiUrl(`/processes/templates/${template.id}/steps`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name: "New step", dueDaysOffset: 0 }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Add failed.");
      setSteps((prev) => [...prev, body.step]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add step.");
    }
  };

  const updateStep = async (step: TemplateStep, patch: Partial<TemplateStep>) => {
    setSteps((prev) => prev.map((s) => (s.id === step.id ? { ...s, ...patch } : s)));
    try {
      await fetch(apiUrl(`/processes/template-steps/${step.id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(patch),
      });
    } catch {
      /* ignore */
    }
  };

  const deleteStep = async (step: TemplateStep) => {
    if (!confirm(`Delete step "${step.name}"?`)) return;
    try {
      const res = await fetch(apiUrl(`/processes/template-steps/${step.id}`), {
        method: "DELETE",
        headers: { ...authHeaders() },
      });
      if (!res.ok) throw new Error("Delete failed.");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not delete step.");
    }
  };

  const reorder = async (ids: number[]) => {
    if (!template) return;
    try {
      const res = await fetch(apiUrl(`/processes/templates/${template.id}/steps/reorder`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ stepIds: ids }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error("Reorder failed.");
      setSteps(body.steps || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not reorder.");
    }
  };

  const duplicateTemplate = async () => {
    if (!template) return;
    try {
      const res = await fetch(apiUrl(`/processes/templates/${template.id}/duplicate`), {
        method: "POST",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error("Duplicate failed.");
      router.push(`/operations/templates/${body.template.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not duplicate.");
    }
  };

  const archiveTemplate = async () => {
    if (!template) return;
    if (!confirm(`Archive template "${template.name}"?`)) return;
    try {
      await fetch(apiUrl(`/processes/templates/${template.id}`), {
        method: "DELETE",
        headers: { ...authHeaders() },
      });
      router.push("/operations/templates");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not archive.");
    }
  };

  if (loading) {
    return (
      <div className={styles.page}>
        <OperationsTopBar />
        <div className={styles.main}>
          <div className={styles.loading}>Loading template…</div>
        </div>
      </div>
    );
  }

  if (!template) {
    return (
      <div className={styles.page}>
        <OperationsTopBar />
        <div className={styles.main}>
          <div className={styles.errorBanner}>{err || "Template not found."}</div>
          <Link href="/operations/templates" className={`${styles.btn} ${styles.btnGhost}`}>
            ← Back
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <OperationsTopBar
        actions={
          <>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={duplicateTemplate}
            >
              Duplicate
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnDanger}`}
              onClick={archiveTemplate}
            >
              Archive
            </button>
          </>
        }
      />
      <div className={styles.main}>
        <Link
          href="/operations/templates"
          style={{ color: "#0098d0", textDecoration: "none", fontSize: "0.85rem", fontWeight: 600 }}
        >
          ← All templates
        </Link>

        {err ? <div className={styles.errorBanner} style={{ marginTop: "0.75rem" }}>{err}</div> : null}

        <div className={styles.editorHeader} style={{ marginTop: "0.75rem", borderLeft: `4px solid ${template.color}` }}>
          <div className={styles.editorHeaderMain}>
            <input
              style={{ fontSize: "1.3rem", fontWeight: 700, color: "#1b2856" }}
              value={template.name}
              onChange={(e) => setTemplate({ ...template, name: e.target.value })}
              onBlur={(e) => updateTemplate({ name: e.target.value })}
            />
            <textarea
              value={template.description ?? ""}
              rows={2}
              onChange={(e) => setTemplate({ ...template, description: e.target.value })}
              onBlur={(e) => updateTemplate({ description: e.target.value })}
              placeholder="Describe what this process covers…"
            />
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <select
                value={template.category ?? ""}
                onChange={(e) => updateTemplate({ category: e.target.value })}
              >
                <option value="">— Category —</option>
                {CATEGORY_CHOICES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input
                value={template.icon}
                onChange={(e) => setTemplate({ ...template, icon: e.target.value })}
                onBlur={(e) => updateTemplate({ icon: e.target.value })}
                maxLength={4}
                style={{ width: "60px", textAlign: "center" }}
                title="Icon"
              />
              <input
                type="color"
                value={template.color}
                onChange={(e) => setTemplate({ ...template, color: e.target.value.toUpperCase() })}
                onBlur={(e) => updateTemplate({ color: e.target.value.toUpperCase() })}
                title="Color"
              />
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  fontSize: "0.85rem",
                  color: "#1b2856",
                }}
              >
                Est. days
                <input
                  type="number"
                  value={template.estimatedDays}
                  min={1}
                  style={{ width: "70px" }}
                  onChange={(e) =>
                    setTemplate({ ...template, estimatedDays: Number(e.target.value) || 0 })
                  }
                  onBlur={(e) => updateTemplate({ estimatedDays: Number(e.target.value) || 0 })}
                />
              </label>
            </div>
          </div>
        </div>

        <h3 style={{ color: "#1b2856", margin: "1rem 0 0.75rem", fontSize: "1rem" }}>
          Steps ({steps.length})
        </h3>
        <div className={styles.stepEditList}>
          {steps.map((step, idx) => (
            <div
              key={step.id}
              className={styles.stepEditCard}
              draggable
              onDragStart={() => setDragIdx(idx)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIdx === null || dragIdx === idx) return;
                const reordered = [...steps];
                const [moved] = reordered.splice(dragIdx, 1);
                reordered.splice(idx, 0, moved);
                setSteps(reordered);
                reorder(reordered.map((s) => s.id));
                setDragIdx(null);
              }}
            >
              <span className={styles.dragHandle} title="Drag to reorder">
                ⋮⋮
              </span>
              <span className={styles.stepEditNumber}>{idx + 1}</span>
              <div className={styles.stepEditMain}>
                <input
                  value={step.name}
                  onChange={(e) =>
                    setSteps((prev) =>
                      prev.map((s) => (s.id === step.id ? { ...s, name: e.target.value } : s))
                    )
                  }
                  onBlur={(e) => updateStep(step, { name: e.target.value })}
                  placeholder="Step name"
                  style={{
                    border: "1px solid rgba(27, 40, 86, 0.12)",
                    borderRadius: 8,
                    padding: "0.45rem 0.6rem",
                    fontSize: "0.95rem",
                    fontWeight: 600,
                    color: "#1b2856",
                    fontFamily: "inherit",
                  }}
                />
                <textarea
                  value={step.description ?? ""}
                  rows={2}
                  onChange={(e) =>
                    setSteps((prev) =>
                      prev.map((s) =>
                        s.id === step.id ? { ...s, description: e.target.value } : s
                      )
                    )
                  }
                  onBlur={(e) => updateStep(step, { description: e.target.value })}
                  placeholder="What needs to happen in this step?"
                  style={{
                    border: "1px solid rgba(27, 40, 86, 0.12)",
                    borderRadius: 8,
                    padding: "0.45rem 0.6rem",
                    fontSize: "0.85rem",
                    fontFamily: "inherit",
                    resize: "vertical",
                  }}
                />
                <div className={styles.stepEditFieldRow}>
                  <label style={{ fontSize: "0.78rem", color: "#6a737b", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                    Role
                    <select
                      value={step.assignedRole ?? ""}
                      onChange={(e) => updateStep(step, { assignedRole: e.target.value || null })}
                      className={styles.select}
                    >
                      <option value="">— Any —</option>
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ fontSize: "0.78rem", color: "#6a737b", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                    Or User
                    <select
                      value={step.assignedUserId ?? ""}
                      onChange={(e) =>
                        updateStep(step, {
                          assignedUserId: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                      className={styles.select}
                    >
                      <option value="">— Unassigned —</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ fontSize: "0.78rem", color: "#6a737b", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                    Due (days after start)
                    <input
                      type="number"
                      min={0}
                      value={step.dueDaysOffset}
                      onChange={(e) =>
                        setSteps((prev) =>
                          prev.map((s) =>
                            s.id === step.id
                              ? { ...s, dueDaysOffset: Number(e.target.value) || 0 }
                              : s
                          )
                        )
                      }
                      onBlur={(e) =>
                        updateStep(step, { dueDaysOffset: Number(e.target.value) || 0 })
                      }
                      className={styles.input}
                    />
                  </label>
                  <label style={{ fontSize: "0.78rem", color: "#6a737b", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                    Depends on step
                    <select
                      value={step.dependsOnStep ?? ""}
                      onChange={(e) =>
                        updateStep(step, {
                          dependsOnStep: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                      className={styles.select}
                    >
                      <option value="">— None —</option>
                      {steps
                        .filter((s) => s.stepNumber < step.stepNumber)
                        .map((s) => (
                          <option key={s.id} value={s.stepNumber}>
                            Step {s.stepNumber}: {s.name}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.35rem",
                      fontSize: "0.82rem",
                      color: "#1b2856",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={step.isRequired}
                      onChange={(e) => updateStep(step, { isRequired: e.target.checked })}
                    />
                    Required
                  </label>
                  <button
                    type="button"
                    className={`${styles.smallBtn} ${styles.smallBtnDanger}`}
                    onClick={() => deleteStep(step)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          style={{ marginTop: "0.75rem" }}
          onClick={addStep}
        >
          + Add Step
        </button>
      </div>
    </div>
  );
}
