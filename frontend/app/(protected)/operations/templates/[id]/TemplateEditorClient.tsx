"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../../operations.module.css";
import OperationsTopBar from "../../OperationsTopBar";
import AutomationConfigEditor from "../../AutomationConfigEditor";
import CustomFieldManager from "../../CustomFieldManager";
import ConditionBuilder from "../../ConditionBuilder";
import DueDateEditor from "../../DueDateEditor";
import TaskTemplatesManager from "../../TaskTemplatesManager";
import { apiUrl } from "../../../../../lib/api";
import { useAuth, RequireAdmin } from "../../../../../context/AuthContext";
import type {
  AutoActionConfig,
  AutoActionType,
  CustomFieldDefinition,
  DueDateType,
  Template,
  TemplateStage,
  TemplateStep,
  TeamUser,
} from "../../types";
import { AUTO_ACTION_LABELS, ROLES } from "../../types";

type BoardTemplateExtras = Template & {
  agingGreenHours?: number;
  agingYellowHours?: number;
  cardBadgeField?: string;
  assignmentRule?: string;
  assignmentConfig?: Record<string, unknown>;
  duplicationRule?: string;
};

function BoardSettingsEditor({
  template,
  users,
  onChange,
}: {
  template: Template;
  users: TeamUser[];
  onChange: (patch: Partial<BoardTemplateExtras>) => void;
}) {
  const t = template as BoardTemplateExtras;
  const { authHeaders } = useAuth();
  const save = async (patch: Partial<BoardTemplateExtras>) => {
    onChange(patch);
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
  const cfg = (t.assignmentConfig ?? {}) as { userId?: number; userIds?: number[] };
  return (
    <div>
      <div className={styles.cfSection}>
        <div className={styles.cfSectionHeader}>
          <h4>Aging thresholds</h4>
        </div>
        <div className={styles.cfSectionBody}>
          <div className={styles.fieldRow}>
            <label className={styles.cfField}>
              <span className={styles.cfLabel}>Green within (hours)</span>
              <input
                type="number"
                className={styles.cfInput}
                defaultValue={t.agingGreenHours ?? 48}
                onBlur={(e) => save({ agingGreenHours: Number(e.target.value) || 48 })}
              />
            </label>
            <label className={styles.cfField}>
              <span className={styles.cfLabel}>Yellow within (hours)</span>
              <input
                type="number"
                className={styles.cfInput}
                defaultValue={t.agingYellowHours ?? 96}
                onBlur={(e) => save({ agingYellowHours: Number(e.target.value) || 96 })}
              />
            </label>
          </div>
          <label className={styles.cfField}>
            <span className={styles.cfLabel}>Card badge field</span>
            <select
              className={styles.cfSelect}
              defaultValue={t.cardBadgeField ?? "due_date"}
              onChange={(e) => save({ cardBadgeField: e.target.value })}
            >
              <option value="due_date">Due date</option>
              <option value="started_at">Start date</option>
              <option value="lease_expiration">Lease expiration</option>
              <option value="move_in_date">Move-in date</option>
              <option value="move_out_date">Move-out date</option>
            </select>
          </label>
        </div>
      </div>

      <div className={styles.cfSection}>
        <div className={styles.cfSectionHeader}>
          <h4>Assignment rule</h4>
        </div>
        <div className={styles.cfSectionBody}>
          <label className={styles.cfField}>
            <span className={styles.cfLabel}>Rule</span>
            <select
              className={styles.cfSelect}
              defaultValue={t.assignmentRule ?? "manual"}
              onChange={(e) =>
                save({ assignmentRule: e.target.value, assignmentConfig: {} })
              }
            >
              <option value="manual">Manual</option>
              <option value="specific_user">Specific user</option>
              <option value="round_robin">Round robin</option>
              <option value="round_robin_by_role">Round robin by role</option>
              <option value="by_property">By property (AppFolio owner)</option>
            </select>
          </label>
          {t.assignmentRule === "specific_user" ? (
            <label className={styles.cfField}>
              <span className={styles.cfLabel}>User</span>
              <select
                className={styles.cfSelect}
                defaultValue={cfg.userId ?? ""}
                onChange={(e) =>
                  save({
                    assignmentConfig: e.target.value ? { userId: Number(e.target.value) } : {},
                  })
                }
              >
                <option value="">— Unassigned —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {t.assignmentRule === "round_robin" ? (
            <div>
              <div className={styles.cfLabel}>Rotation pool</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                {users.map((u) => {
                  const included = (cfg.userIds ?? []).map(Number).includes(u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      className={`${styles.cfChip} ${included ? styles.cfChipActive : ""}`}
                      onClick={() => {
                        const next = included
                          ? (cfg.userIds ?? []).filter((x) => Number(x) !== u.id)
                          : [...(cfg.userIds ?? []), u.id];
                        save({ assignmentConfig: { ...cfg, userIds: next } });
                      }}
                    >
                      {u.displayName}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className={styles.cfSection}>
        <div className={styles.cfSectionHeader}>
          <h4>Duplicate prevention</h4>
        </div>
        <div className={styles.cfSectionBody}>
          <label className={styles.cfField}>
            <span className={styles.cfLabel}>Rule</span>
            <select
              className={styles.cfSelect}
              defaultValue={t.duplicationRule ?? "none"}
              onChange={(e) => save({ duplicationRule: e.target.value })}
            >
              <option value="none">None (allow duplicates)</option>
              <option value="one_per_property">One per property</option>
              <option value="one_per_contact">One per contact</option>
              <option value="one_per_property_contact">One per property + contact</option>
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}

function StepFieldsToggle({ stepId }: { stepId: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: "0.35rem" }}>
      <button
        type="button"
        className={styles.smallBtn}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "▾" : "▸"} Per-step fields
      </button>
      {open ? (
        <div style={{ marginTop: "0.5rem" }}>
          <CustomFieldManager entityType="process_template_step" entityId={stepId} />
        </div>
      ) : null}
    </div>
  );
}

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
  const [allTemplates, setAllTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragStepId, setDragStepId] = useState<number | null>(null);
  const [collapsedStages, setCollapsedStages] = useState<Set<number>>(new Set());
  const [activeTab, setActiveTab] = useState<
    "steps" | "custom_fields" | "automations" | "task_templates" | "board_settings"
  >("steps");
  const [stages, setStages] = useState<TemplateStage[]>([]);
  const [templateFields, setTemplateFields] = useState<CustomFieldDefinition[]>([]);

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

  const loadStages = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl(`/processes/templates/${templateId}/stages`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = await res.json();
      if (Array.isArray(body.stages)) setStages(body.stages);
    } catch {
      /* ignore */
    }
  }, [authHeaders, token, templateId]);

  const loadTemplateFields = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(
        apiUrl(`/custom-fields/definitions?entityType=process_template&entityId=${templateId}`),
        { headers: { ...authHeaders() }, cache: "no-store" }
      );
      if (!res.ok) return;
      const body = await res.json();
      if (Array.isArray(body.definitions)) setTemplateFields(body.definitions);
    } catch {
      /* ignore */
    }
  }, [authHeaders, token, templateId]);

  const loadAllTemplates = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl("/processes/templates"), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = await res.json();
      if (Array.isArray(body.templates)) setAllTemplates(body.templates);
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
  useEffect(() => {
    loadAllTemplates();
  }, [loadAllTemplates]);
  useEffect(() => {
    loadStages();
  }, [loadStages]);
  useEffect(() => {
    loadTemplateFields();
  }, [loadTemplateFields]);

  const addStage = async () => {
    try {
      const res = await fetch(apiUrl(`/processes/templates/${templateId}/stages`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name: "New stage" }),
      });
      if (!res.ok) throw new Error("Add failed");
      await loadStages();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Add stage failed");
    }
  };

  const updateStage = async (stage: TemplateStage, patch: Partial<TemplateStage>) => {
    setStages((prev) => prev.map((s) => (s.id === stage.id ? { ...s, ...patch } : s)));
    try {
      await fetch(apiUrl(`/processes/template-stages/${stage.id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(patch),
      });
    } catch {
      /* ignore */
    }
  };

  const deleteStage = async (stage: TemplateStage) => {
    if (
      !confirm(
        `Delete stage "${stage.name}"? Steps in this stage will become ungrouped.`
      )
    )
      return;
    try {
      await fetch(apiUrl(`/processes/template-stages/${stage.id}`), {
        method: "DELETE",
        headers: { ...authHeaders() },
      });
      await loadStages();
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const moveStepToStage = async (stepId: number, stageId: number | null) => {
    setSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, stageId } : s)));
    try {
      await fetch(apiUrl(`/processes/template-steps/${stepId}/move-to-stage`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ stageId }),
      });
    } catch {
      /* ignore */
    }
  };

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

  const addStep = async (stageId: number | null = null) => {
    if (!template) return;
    try {
      const res = await fetch(apiUrl(`/processes/templates/${template.id}/steps`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name: "New step", dueDaysOffset: 0, stageId }),
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

        <div className={styles.tabBar} style={{ marginTop: "1rem" }}>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === "steps" ? styles.tabBtnActive : ""}`}
            onClick={() => setActiveTab("steps")}
          >
            Steps ({steps.length})
          </button>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === "custom_fields" ? styles.tabBtnActive : ""}`}
            onClick={() => setActiveTab("custom_fields")}
          >
            Custom Fields
          </button>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === "automations" ? styles.tabBtnActive : ""}`}
            onClick={() => setActiveTab("automations")}
          >
            Conditions &amp; Automations
          </button>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === "task_templates" ? styles.tabBtnActive : ""}`}
            onClick={() => setActiveTab("task_templates")}
          >
            Task Templates
          </button>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === "board_settings" ? styles.tabBtnActive : ""}`}
            onClick={() => setActiveTab("board_settings")}
          >
            Board Settings
          </button>
        </div>

        {activeTab === "task_templates" ? (
          <TaskTemplatesManager processTemplateId={template.id} users={users} />
        ) : null}

        {activeTab === "board_settings" ? (
          <BoardSettingsEditor
            template={template}
            users={users}
            onChange={(patch) => setTemplate({ ...template, ...patch })}
          />
        ) : null}

        {activeTab === "custom_fields" ? (
          <CustomFieldManager
            entityType="process_template"
            entityId={template.id}
            allowFillAtLaunch
          />
        ) : null}

        {activeTab === "automations" ? (
          <ConditionBuilder
            templateId={template.id}
            steps={steps}
            stages={stages}
            fields={templateFields}
            users={users}
            allTemplates={allTemplates.filter((t) => t.id !== template.id)}
          />
        ) : null}

        {activeTab === "steps" ? (() => {
          // Steps sorted by step_number (global order)
          const orderedSteps = [...steps].sort((a, b) => a.stepNumber - b.stepNumber);
          const stepsByStage = new Map<number | null, TemplateStep[]>();
          for (const s of orderedSteps) {
            const key = s.stageId ?? null;
            if (!stepsByStage.has(key)) stepsByStage.set(key, []);
            stepsByStage.get(key)!.push(s);
          }
          const unassigned = stepsByStage.get(null) ?? [];

          const handleStepDrop = async (
            targetStageId: number | null,
            dropAfterStep: TemplateStep | null
          ) => {
            if (dragStepId === null) return;
            const moved = steps.find((s) => s.id === dragStepId);
            if (!moved) return;
            const reordered = orderedSteps.filter((s) => s.id !== moved.id);
            let insertAt = reordered.length;
            if (dropAfterStep) {
              const idx = reordered.findIndex((s) => s.id === dropAfterStep.id);
              insertAt = idx >= 0 ? idx + 1 : reordered.length;
            } else {
              // Drop on stage body (no specific step) → append to that stage's group
              const lastOfStage = [...reordered]
                .reverse()
                .find((s) => (s.stageId ?? null) === targetStageId);
              if (lastOfStage) {
                insertAt = reordered.findIndex((s) => s.id === lastOfStage.id) + 1;
              } else {
                // Empty stage: insert at the position that matches stage order
                const targetStageOrder = stages.find((st) => st.id === targetStageId)?.stageOrder ?? 999;
                insertAt = reordered.findIndex((s) => {
                  if (s.stageId == null) return false;
                  const so = stages.find((st) => st.id === s.stageId)?.stageOrder ?? 999;
                  return so > targetStageOrder;
                });
                if (insertAt === -1) insertAt = reordered.length;
              }
            }
            const newMoved = { ...moved, stageId: targetStageId };
            reordered.splice(insertAt, 0, newMoved);
            setSteps(
              reordered.map((s, i) => ({
                ...s,
                stepNumber: i + 1,
              }))
            );
            setDragStepId(null);
            // Persist stage change first, then global reorder
            if ((moved.stageId ?? null) !== (targetStageId ?? null)) {
              await moveStepToStage(moved.id, targetStageId);
            }
            await reorder(reordered.map((s) => s.id));
          };

          const renderStepCard = (step: TemplateStep) => (
            <div
              key={step.id}
              className={styles.stepEditCard}
              draggable
              onDragStart={() => setDragStepId(step.id)}
              onDragEnd={() => setDragStepId(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (dragStepId === null || dragStepId === step.id) return;
                handleStepDrop(step.stageId ?? null, step);
              }}
            >
              <span className={styles.dragHandle} title="Drag to reorder or move between stages">
                ⋮⋮
              </span>
              <span className={styles.stepEditNumber}>{step.stepNumber}</span>
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
                <textarea
                  value={step.instructions ?? ""}
                  rows={2}
                  onChange={(e) =>
                    setSteps((prev) =>
                      prev.map((s) =>
                        s.id === step.id ? { ...s, instructions: e.target.value } : s
                      )
                    )
                  }
                  onBlur={(e) =>
                    updateStep(step, { instructions: e.target.value } as Partial<TemplateStep>)
                  }
                  placeholder="Instructions / how to complete this step (markdown supported)"
                  style={{
                    border: "1px solid rgba(27, 40, 86, 0.12)",
                    borderRadius: 8,
                    padding: "0.45rem 0.6rem",
                    fontSize: "0.82rem",
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
                    Due date
                    <DueDateEditor
                      type={(step.dueDateType as DueDateType) || "offset_from_start"}
                      config={step.dueDateConfig || { days: step.dueDaysOffset || 0 }}
                      onChange={({ type, config }) => {
                        updateStep(step, {
                          dueDateType: type,
                          dueDateConfig: config,
                          dueDaysOffset:
                            type === "offset_from_start" && typeof config.days === "number"
                              ? config.days
                              : step.dueDaysOffset,
                        } as Partial<TemplateStep>);
                      }}
                      steps={steps.filter((s) => s.id !== step.id)}
                      stages={stages}
                      dateFields={templateFields}
                      compact
                    />
                  </label>
                  <label style={{ fontSize: "0.78rem", color: "#6a737b", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                    Stage
                    <select
                      value={step.stageId ?? ""}
                      onChange={(e) =>
                        moveStepToStage(step.id, e.target.value ? Number(e.target.value) : null)
                      }
                      className={styles.select}
                    >
                      <option value="">— Unassigned —</option>
                      {stages.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
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
                  {step.autoAction ? (
                    <span
                      className={styles.boltIcon}
                      title={`Automated: ${AUTO_ACTION_LABELS[step.autoAction]?.label}`}
                    >
                      ⚡
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className={`${styles.smallBtn} ${styles.smallBtnDanger}`}
                    onClick={() => deleteStep(step)}
                  >
                    Delete
                  </button>
                </div>
                <AutomationConfigEditor
                  step={step}
                  users={users}
                  templates={allTemplates.filter((t) => t.id !== template?.id)}
                  onChange={(patch) => updateStep(step, patch as Partial<TemplateStep>)}
                />
                <StepFieldsToggle stepId={step.id} />
              </div>
            </div>
          );

          return (
            <>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  margin: "1rem 0 0.5rem",
                }}
              >
                <h3 style={{ color: "#1b2856", margin: 0, fontSize: "1rem" }}>
                  Stages ({stages.length}) · {steps.length} total step
                  {steps.length === 1 ? "" : "s"}
                </h3>
                <button type="button" className={styles.smallBtn} onClick={addStage}>
                  + Add Stage
                </button>
              </div>

              {stages.length === 0 ? (
                <div className={styles.emptyState}>
                  <h3>No stages yet</h3>
                  <p>Add a stage to start organizing steps.</p>
                </div>
              ) : null}

              {stages.map((stage) => {
                const stageSteps = stepsByStage.get(stage.id) ?? [];
                const isCollapsed = collapsedStages.has(stage.id);
                const isFinal =
                  (stage as unknown as { isFinal?: boolean }).isFinal ?? false;
                const autoAdvance =
                  (stage as unknown as { autoAdvance?: boolean }).autoAdvance ?? true;
                const textColor =
                  (stage as unknown as { textColor?: string }).textColor ?? "#042C53";
                return (
                  <div
                    key={stage.id}
                    className={styles.stageBlock}
                    style={{ borderLeftColor: stage.color || undefined }}
                    onDragOver={(e) => {
                      if (dragStepId !== null) e.preventDefault();
                    }}
                    onDrop={(e) => {
                      if (dragStepId === null) return;
                      e.preventDefault();
                      handleStepDrop(stage.id, null);
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        flexWrap: "wrap",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setCollapsedStages((prev) => {
                            const next = new Set(prev);
                            if (next.has(stage.id)) next.delete(stage.id);
                            else next.add(stage.id);
                            return next;
                          })
                        }
                        className={styles.smallBtn}
                        style={{ minWidth: 28 }}
                        aria-label={isCollapsed ? "Expand stage" : "Collapse stage"}
                      >
                        {isCollapsed ? "▸" : "▾"}
                      </button>
                      <input
                        className={styles.input}
                        value={stage.name}
                        onChange={(e) =>
                          setStages((prev) =>
                            prev.map((s) =>
                              s.id === stage.id ? { ...s, name: e.target.value } : s
                            )
                          )
                        }
                        onBlur={(e) => updateStage(stage, { name: e.target.value })}
                        style={{
                          flex: 1,
                          minWidth: 180,
                          fontWeight: 700,
                          color: "#1b2856",
                        }}
                      />
                      <span className={styles.stageMeta}>
                        {stageSteps.length} step{stageSteps.length === 1 ? "" : "s"}
                      </span>
                      <label
                        style={{
                          fontSize: "0.78rem",
                          color: "#1b2856",
                          display: "inline-flex",
                          gap: "0.3rem",
                          alignItems: "center",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={stage.isGate}
                          onChange={(e) => updateStage(stage, { isGate: e.target.checked })}
                        />
                        🔒 Gate
                      </label>
                      <label
                        style={{
                          fontSize: "0.78rem",
                          color: "#1b2856",
                          display: "inline-flex",
                          gap: "0.3rem",
                          alignItems: "center",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isFinal}
                          onChange={(e) =>
                            updateStage(stage, { isFinal: e.target.checked } as Partial<typeof stage>)
                          }
                        />
                        ✓ Final
                      </label>
                      <label
                        style={{
                          fontSize: "0.78rem",
                          color: "#1b2856",
                          display: "inline-flex",
                          gap: "0.3rem",
                          alignItems: "center",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={autoAdvance}
                          onChange={(e) =>
                            updateStage(stage, {
                              autoAdvance: e.target.checked,
                            } as Partial<typeof stage>)
                          }
                        />
                        Auto-advance
                      </label>
                      <input
                        type="color"
                        value={stage.color || "#0098D0"}
                        onChange={(e) =>
                          updateStage(stage, { color: e.target.value.toUpperCase() })
                        }
                        title="Background color"
                      />
                      <input
                        type="color"
                        value={textColor}
                        onChange={(e) =>
                          updateStage(stage, {
                            textColor: e.target.value.toUpperCase(),
                          } as Partial<typeof stage>)
                        }
                        title="Text color"
                      />
                      <button
                        type="button"
                        className={`${styles.smallBtn} ${styles.smallBtnDanger}`}
                        onClick={() => deleteStage(stage)}
                      >
                        Delete
                      </button>
                    </div>

                    {!isCollapsed ? (
                      <div
                        className={styles.stepEditList}
                        style={{ marginTop: "0.5rem", paddingLeft: "0.5rem" }}
                      >
                        {stageSteps.length === 0 ? (
                          <div
                            style={{
                              fontSize: "0.82rem",
                              color: "#6a737b",
                              padding: "0.5rem 0.75rem",
                              border: "1px dashed rgba(27, 40, 86, 0.15)",
                              borderRadius: 8,
                            }}
                          >
                            No steps yet — drag a step here or add one below.
                          </div>
                        ) : (
                          stageSteps.map((step) => renderStepCard(step))
                        )}
                        <button
                          type="button"
                          className={styles.smallBtn}
                          style={{ alignSelf: "flex-start", marginTop: "0.25rem" }}
                          onClick={() => addStep(stage.id)}
                        >
                          + Add step to this stage
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}

              {unassigned.length > 0 ? (
                <div
                  className={styles.stageBlock}
                  style={{
                    borderLeftColor: "#f59e0b",
                    background: "rgba(245, 158, 11, 0.04)",
                    marginTop: "1rem",
                  }}
                  onDragOver={(e) => {
                    if (dragStepId !== null) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    if (dragStepId === null) return;
                    e.preventDefault();
                    handleStepDrop(null, null);
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: "0.5rem",
                    }}
                  >
                    <div>
                      <h4 style={{ margin: 0, color: "#92400e", fontSize: "0.95rem" }}>
                        ⚠️ Unassigned Steps ({unassigned.length})
                      </h4>
                      <div
                        style={{
                          fontSize: "0.78rem",
                          color: "#92400e",
                          marginTop: "0.2rem",
                        }}
                      >
                        These steps need to be assigned to a stage. Drag them into a stage
                        above.
                      </div>
                    </div>
                    <button
                      type="button"
                      className={styles.smallBtn}
                      onClick={() => addStep(null)}
                    >
                      + Add unassigned step
                    </button>
                  </div>
                  <div className={styles.stepEditList} style={{ marginTop: "0.5rem" }}>
                    {unassigned.map((step) => renderStepCard(step))}
                  </div>
                </div>
              ) : null}
            </>
          );
        })() : null}
      </div>
    </div>
  );
}
