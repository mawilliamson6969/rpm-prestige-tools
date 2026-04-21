"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./operations.module.css";
import { apiUrl } from "../../../lib/api";
import { useAuth } from "../../../context/AuthContext";
import type {
  ActionType,
  CustomFieldDefinition,
  ProcessCondition,
  TeamUser,
  Template,
  TemplateStage,
  TemplateStep,
  TriggerType,
} from "./types";
import { ACTION_TYPE_LABELS, TRIGGER_TYPE_LABELS } from "./types";

type Props = {
  templateId: number;
  steps: TemplateStep[];
  stages: TemplateStage[];
  fields: CustomFieldDefinition[];
  users: TeamUser[];
  allTemplates: Template[];
};

function emptyCondition(): Partial<ProcessCondition> {
  return {
    name: "",
    triggerType: "step_completed",
    triggerConfig: {},
    actionType: "create_task",
    actionConfig: {},
    isActive: true,
  };
}

export default function ConditionBuilder({
  templateId,
  steps,
  stages,
  fields,
  users,
  allTemplates,
}: Props) {
  const { authHeaders, token } = useAuth();
  const [conditions, setConditions] = useState<ProcessCondition[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<ProcessCondition>>(emptyCondition());

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(apiUrl(`/processes/templates/${templateId}/conditions`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Load failed");
      setConditions(body.conditions || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token, templateId]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!draft.name?.trim()) {
      setErr("Name required.");
      return;
    }
    const payload = {
      name: draft.name!.trim(),
      description: draft.description || null,
      triggerType: draft.triggerType,
      triggerConfig: draft.triggerConfig || {},
      actionType: draft.actionType,
      actionConfig: draft.actionConfig || {},
      isActive: draft.isActive !== false,
    };
    try {
      if (draft.id) {
        const res = await fetch(apiUrl(`/processes/conditions/${draft.id}`), {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("Save failed");
      } else {
        const res = await fetch(apiUrl(`/processes/templates/${templateId}/conditions`), {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("Create failed");
      }
      setEditorOpen(false);
      setDraft(emptyCondition());
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    }
  };

  const deleteCondition = async (c: ProcessCondition) => {
    if (!confirm(`Delete condition "${c.name}"?`)) return;
    try {
      await fetch(apiUrl(`/processes/conditions/${c.id}`), {
        method: "DELETE",
        headers: { ...authHeaders() },
      });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const toggleActive = async (c: ProcessCondition) => {
    await fetch(apiUrl(`/processes/conditions/${c.id}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ isActive: !c.isActive }),
    });
    await load();
  };

  if (loading) return <div className={styles.loading}>Loading conditions…</div>;

  return (
    <div>
      {err ? <div className={styles.errorBanner}>{err}</div> : null}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.75rem" }}>
        <span className={styles.projectStatHint}>
          {conditions.length} condition{conditions.length === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={() => {
            setDraft(emptyCondition());
            setEditorOpen(true);
          }}
        >
          + Add Condition
        </button>
      </div>
      {conditions.length === 0 ? (
        <div className={styles.emptyState}>
          <h3>No conditions yet</h3>
          <p>Conditions run automatically when triggers fire. Example: &ldquo;WHEN Field &lsquo;Has HOA&rsquo; equals Yes THEN Add Steps for HOA paperwork.&rdquo;</p>
        </div>
      ) : (
        conditions.map((c) => (
          <div
            key={c.id}
            className={`${styles.conditionCard} ${c.isActive ? "" : styles.conditionCardInactive}`}
          >
            <div className={styles.conditionRow} style={{ justifyContent: "space-between" }}>
              <strong style={{ color: "#1b2856" }}>{c.name}</strong>
              <div style={{ display: "flex", gap: "0.35rem" }}>
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.25rem",
                    fontSize: "0.78rem",
                    color: "#6a737b",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={c.isActive}
                    onChange={() => toggleActive(c)}
                  />
                  Active
                </label>
                <button
                  type="button"
                  className={styles.smallBtn}
                  onClick={() => {
                    setDraft(c);
                    setEditorOpen(true);
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className={`${styles.smallBtn} ${styles.smallBtnDanger}`}
                  onClick={() => deleteCondition(c)}
                >
                  Delete
                </button>
              </div>
            </div>
            <div className={styles.conditionRow}>
              <span className={`${styles.conditionTag} ${styles.tagWhen}`}>WHEN</span>
              <span>{TRIGGER_TYPE_LABELS[c.triggerType]}</span>
              <span className={`${styles.conditionTag} ${styles.tagThen}`}>THEN</span>
              <span>{ACTION_TYPE_LABELS[c.actionType]}</span>
            </div>
          </div>
        ))
      )}

      {editorOpen ? (
        <div className={styles.overlay} onClick={() => setEditorOpen(false)}>
          <div
            className={`${styles.modal} ${styles.modalWide}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h2>{draft.id ? "Edit Condition" : "New Condition"}</h2>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={() => setEditorOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <form
              className={styles.form}
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <div className={styles.field}>
                <label>Name</label>
                <input
                  value={draft.name ?? ""}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  autoFocus
                  required
                />
              </div>
              <div className={styles.field}>
                <label>When (trigger)</label>
                <select
                  value={draft.triggerType}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      triggerType: e.target.value as TriggerType,
                      triggerConfig: {},
                    })
                  }
                >
                  {(Object.keys(TRIGGER_TYPE_LABELS) as TriggerType[]).map((t) => (
                    <option key={t} value={t}>
                      {TRIGGER_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
              <TriggerConfigFields
                trigger={draft.triggerType!}
                config={draft.triggerConfig ?? {}}
                update={(v) => setDraft({ ...draft, triggerConfig: { ...(draft.triggerConfig ?? {}), ...v } })}
                steps={steps}
                stages={stages}
                fields={fields}
              />
              <div className={styles.field}>
                <label>Then (action)</label>
                <select
                  value={draft.actionType}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      actionType: e.target.value as ActionType,
                      actionConfig: {},
                    })
                  }
                >
                  {(Object.keys(ACTION_TYPE_LABELS) as ActionType[]).map((t) => (
                    <option key={t} value={t}>
                      {ACTION_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
              <ActionConfigFields
                action={draft.actionType!}
                config={draft.actionConfig ?? {}}
                update={(v) => setDraft({ ...draft, actionConfig: { ...(draft.actionConfig ?? {}), ...v } })}
                steps={steps}
                stages={stages}
                fields={fields}
                users={users}
                allTemplates={allTemplates}
              />
              <div className={styles.formActions}>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnGhost}`}
                  onClick={() => setEditorOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>
                  {draft.id ? "Save changes" : "Create condition"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TriggerConfigFields({
  trigger,
  config,
  update,
  steps,
  stages,
  fields,
}: {
  trigger: TriggerType;
  config: Record<string, unknown>;
  update: (v: Record<string, unknown>) => void;
  steps: TemplateStep[];
  stages: TemplateStage[];
  fields: CustomFieldDefinition[];
}) {
  const s = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
  switch (trigger) {
    case "step_completed":
      return (
        <div className={styles.field}>
          <label>Step</label>
          <select
            value={s(config.stepId)}
            onChange={(e) => update({ stepId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">— Any step —</option>
            {steps.map((st) => (
              <option key={st.id} value={st.id}>
                {st.name}
              </option>
            ))}
          </select>
        </div>
      );
    case "stage_completed":
      return (
        <div className={styles.field}>
          <label>Stage</label>
          <select
            value={s(config.stageId)}
            onChange={(e) => update({ stageId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">— Any stage —</option>
            {stages.map((st) => (
              <option key={st.id} value={st.id}>
                {st.name}
              </option>
            ))}
          </select>
        </div>
      );
    case "field_equals":
      return (
        <>
          <div className={styles.field}>
            <label>Field</label>
            <select
              value={s(config.fieldDefinitionId)}
              onChange={(e) =>
                update({ fieldDefinitionId: e.target.value ? Number(e.target.value) : null })
              }
            >
              <option value="">— Select field —</option>
              {fields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.fieldLabel}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label>Equals value</label>
            <input value={s(config.value)} onChange={(e) => update({ value: e.target.value })} />
          </div>
        </>
      );
    case "field_greater_than":
      return (
        <>
          <div className={styles.field}>
            <label>Field</label>
            <select
              value={s(config.fieldDefinitionId)}
              onChange={(e) =>
                update({ fieldDefinitionId: e.target.value ? Number(e.target.value) : null })
              }
            >
              <option value="">— Select field —</option>
              {fields
                .filter((f) =>
                  ["number", "currency", "percentage", "rating"].includes(f.fieldType)
                )
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.fieldLabel}
                  </option>
                ))}
            </select>
          </div>
          <div className={styles.field}>
            <label>Greater than</label>
            <input
              type="number"
              value={s(config.value)}
              onChange={(e) => update({ value: Number(e.target.value) })}
            />
          </div>
        </>
      );
    case "field_changed":
      return (
        <div className={styles.field}>
          <label>Field</label>
          <select
            value={s(config.fieldDefinitionId)}
            onChange={(e) =>
              update({ fieldDefinitionId: e.target.value ? Number(e.target.value) : null })
            }
          >
            <option value="">— Select field —</option>
            {fields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.fieldLabel}
              </option>
            ))}
          </select>
        </div>
      );
    case "due_date_approaching":
      return (
        <>
          <div className={styles.field}>
            <label>Step (optional)</label>
            <select
              value={s(config.entityId)}
              onChange={(e) =>
                update({ entityType: "step", entityId: e.target.value ? Number(e.target.value) : null })
              }
            >
              <option value="">— Any step —</option>
              {steps.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label>Days before due</label>
            <input
              type="number"
              value={s(config.daysBeforeDue) || 3}
              onChange={(e) => update({ daysBeforeDue: Number(e.target.value) })}
            />
          </div>
        </>
      );
    case "overdue":
      return (
        <div className={styles.field}>
          <label>Step (optional)</label>
          <select
            value={s(config.entityId)}
            onChange={(e) =>
              update({ entityType: "step", entityId: e.target.value ? Number(e.target.value) : null })
            }
          >
            <option value="">— Any step —</option>
            {steps.map((st) => (
              <option key={st.id} value={st.id}>
                {st.name}
              </option>
            ))}
          </select>
        </div>
      );
    case "process_status_changed":
      return (
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <label>From status</label>
            <select
              value={s(config.fromStatus)}
              onChange={(e) => update({ fromStatus: e.target.value || null })}
            >
              <option value="">— Any —</option>
              <option value="active">active</option>
              <option value="paused">paused</option>
              <option value="completed">completed</option>
              <option value="canceled">canceled</option>
            </select>
          </div>
          <div className={styles.field}>
            <label>To status</label>
            <select
              value={s(config.toStatus)}
              onChange={(e) => update({ toStatus: e.target.value || null })}
            >
              <option value="">— Any —</option>
              <option value="active">active</option>
              <option value="paused">paused</option>
              <option value="completed">completed</option>
              <option value="canceled">canceled</option>
            </select>
          </div>
        </div>
      );
    default:
      return null;
  }
}

function ActionConfigFields({
  action,
  config,
  update,
  steps,
  stages,
  fields,
  users,
  allTemplates,
}: {
  action: ActionType;
  config: Record<string, unknown>;
  update: (v: Record<string, unknown>) => void;
  steps: TemplateStep[];
  stages: TemplateStage[];
  fields: CustomFieldDefinition[];
  users: TeamUser[];
  allTemplates: Template[];
}) {
  const s = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
  switch (action) {
    case "create_task":
      return (
        <>
          <div className={styles.field}>
            <label>Title</label>
            <input value={s(config.title)} onChange={(e) => update({ title: e.target.value })} />
          </div>
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label>Assign to</label>
              <select
                value={s(config.assignedUserId)}
                onChange={(e) => update({ assignedUserId: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">— Unassigned —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label>Priority</label>
              <select
                value={s(config.priority) || "normal"}
                onChange={(e) => update({ priority: e.target.value })}
              >
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="normal">Normal</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div className={styles.field}>
              <label>Due in (days)</label>
              <input
                type="number"
                value={s(config.dueDaysFromTrigger) || 0}
                onChange={(e) => update({ dueDaysFromTrigger: Number(e.target.value) })}
              />
            </div>
          </div>
        </>
      );
    case "skip_step":
    case "complete_step":
    case "reassign_step":
      return (
        <>
          <div className={styles.field}>
            <label>Step</label>
            <select
              value={s(config.stepId)}
              onChange={(e) => update({ stepId: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">— Select step —</option>
              {steps.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name}
                </option>
              ))}
            </select>
          </div>
          {action === "reassign_step" ? (
            <div className={styles.field}>
              <label>Assign to</label>
              <select
                value={s(config.assignedUserId)}
                onChange={(e) => update({ assignedUserId: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">— Unassigned —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </>
      );
    case "send_notification":
      return (
        <>
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label>User</label>
              <select
                value={s(config.userId)}
                onChange={(e) => update({ userId: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">— None —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label>Or role</label>
              <input value={s(config.role)} onChange={(e) => update({ role: e.target.value })} />
            </div>
          </div>
          <div className={styles.field}>
            <label>Message</label>
            <input value={s(config.message)} onChange={(e) => update({ message: e.target.value })} />
          </div>
        </>
      );
    case "send_email":
      return (
        <>
          <div className={styles.field}>
            <label>To</label>
            <input value={s(config.to)} onChange={(e) => update({ to: e.target.value })} />
          </div>
          <div className={styles.field}>
            <label>Subject</label>
            <input value={s(config.subject)} onChange={(e) => update({ subject: e.target.value })} />
          </div>
          <div className={styles.field}>
            <label>Body</label>
            <textarea
              value={s(config.body)}
              rows={5}
              onChange={(e) => update({ body: e.target.value })}
            />
          </div>
        </>
      );
    case "move_to_stage":
      return (
        <div className={styles.field}>
          <label>Stage</label>
          <select
            value={s(config.stageId)}
            onChange={(e) => update({ stageId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">— Select stage —</option>
            {stages.map((st) => (
              <option key={st.id} value={st.id}>
                {st.name}
              </option>
            ))}
          </select>
        </div>
      );
    case "launch_process":
      return (
        <>
          <div className={styles.field}>
            <label>Template</label>
            <select
              value={s(config.templateId)}
              onChange={(e) => update({ templateId: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">— Select template —</option>
              {allTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <label style={{ fontSize: "0.82rem" }}>
            <input
              type="checkbox"
              checked={config.inheritProperty !== false}
              onChange={(e) => update({ inheritProperty: e.target.checked })}
            />{" "}
            Inherit property
          </label>
          <label style={{ fontSize: "0.82rem" }}>
            <input
              type="checkbox"
              checked={config.inheritContact !== false}
              onChange={(e) => update({ inheritContact: e.target.checked })}
            />{" "}
            Inherit contact
          </label>
        </>
      );
    case "update_field":
      return (
        <>
          <div className={styles.field}>
            <label>Field</label>
            <select
              value={s(config.fieldDefinitionId)}
              onChange={(e) =>
                update({ fieldDefinitionId: e.target.value ? Number(e.target.value) : null })
              }
            >
              <option value="">— Select field —</option>
              {fields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.fieldLabel}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label>Value</label>
            <input value={s(config.value)} onChange={(e) => update({ value: e.target.value })} />
          </div>
        </>
      );
    case "change_process_status":
      return (
        <div className={styles.field}>
          <label>New status</label>
          <select
            value={s(config.status)}
            onChange={(e) => update({ status: e.target.value })}
          >
            <option value="">— Select —</option>
            <option value="active">active</option>
            <option value="paused">paused</option>
            <option value="completed">completed</option>
            <option value="canceled">canceled</option>
          </select>
        </div>
      );
    case "webhook":
      return (
        <>
          <div className={styles.field}>
            <label>URL</label>
            <input value={s(config.url)} onChange={(e) => update({ url: e.target.value })} />
          </div>
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label>Method</label>
              <select
                value={s(config.method) || "POST"}
                onChange={(e) => update({ method: e.target.value })}
              >
                <option>POST</option>
                <option>GET</option>
                <option>PUT</option>
              </select>
            </div>
          </div>
        </>
      );
    default:
      return null;
  }
}
