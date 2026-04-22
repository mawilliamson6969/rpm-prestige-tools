"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "../../forms.module.css";
import { apiUrl } from "../../../../../lib/api";
import { useAuth } from "../../../../../context/AuthContext";
import type { FormAutomation, FormField } from "../../types";

type TriggerType = "on_submit" | "on_field_value" | "on_submission_count";

type ActionType =
  | "send_notification"
  | "send_email"
  | "send_confirmation"
  | "create_task"
  | "create_project"
  | "launch_process"
  | "webhook"
  | "generate_pdf"
  | "assign_to_team";

const TRIGGER_LABELS: Record<TriggerType, string> = {
  on_submit: "When form is submitted",
  on_field_value: "When a field has a specific value",
  on_submission_count: "When submission count reaches threshold",
};

const ACTION_LABELS: Record<ActionType, string> = {
  send_notification: "Send in-app notification",
  send_email: "Send email",
  send_confirmation: "Send confirmation to submitter",
  create_task: "Create task",
  create_project: "Create project",
  launch_process: "Launch process",
  webhook: "Send webhook",
  generate_pdf: "Generate PDF and save to files",
  assign_to_team: "Auto-assign submission for review",
};

type AutomationDraft = {
  id?: number;
  name: string;
  triggerType: TriggerType;
  actionType: ActionType;
  triggerConfig: Record<string, unknown>;
  actionConfig: Record<string, unknown>;
  isActive: boolean;
};

export default function AutomationsTab({
  formId,
  fields,
  automations,
  reload,
}: {
  formId: number;
  fields: FormField[];
  automations: FormAutomation[];
  reload: () => Promise<void>;
}) {
  const { authHeaders } = useAuth();
  const [editing, setEditing] = useState<AutomationDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggleActive = async (a: FormAutomation) => {
    await fetch(apiUrl(`/forms/automations/${a.id}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ isActive: !a.isActive }),
    });
    await reload();
  };

  const remove = async (a: FormAutomation) => {
    if (!confirm(`Delete automation "${a.name}"?`)) return;
    await fetch(apiUrl(`/forms/automations/${a.id}`), {
      method: "DELETE",
      headers: { ...authHeaders() },
    });
    await reload();
  };

  const openEditor = (a?: FormAutomation) => {
    if (a) {
      const cfg = (a.actionConfig || {}) as Record<string, unknown>;
      const triggerConfig = (cfg.trigger as Record<string, unknown>) || {};
      const actionConfig = { ...cfg };
      delete actionConfig.trigger;
      setEditing({
        id: a.id,
        name: a.name,
        triggerType: (a.triggerType as TriggerType) || "on_submit",
        actionType: a.actionType as ActionType,
        triggerConfig,
        actionConfig,
        isActive: a.isActive,
      });
    } else {
      setEditing({
        name: "",
        triggerType: "on_submit",
        actionType: "send_notification",
        triggerConfig: {},
        actionConfig: {},
        isActive: true,
      });
    }
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    setErr(null);
    try {
      const mergedConfig: Record<string, unknown> = { ...editing.actionConfig };
      if (editing.triggerType !== "on_submit") {
        mergedConfig.trigger = editing.triggerConfig;
      }
      const payload = {
        name: editing.name || ACTION_LABELS[editing.actionType],
        triggerType: editing.triggerType,
        actionType: editing.actionType,
        actionConfig: mergedConfig,
        isActive: editing.isActive,
      };
      if (editing.id) {
        await fetch(apiUrl(`/forms/automations/${editing.id}`), {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(payload),
        });
      } else {
        const res = await fetch(apiUrl(`/forms/${formId}/automations`), {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Save failed.");
        }
      }
      setEditing(null);
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.main}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", maxWidth: 860 }}>
        <div>
          <h2 style={{ margin: 0, color: "#1b2856", fontSize: "1.15rem", fontWeight: 700 }}>Automations</h2>
          <p style={{ margin: "0.25rem 0 0", color: "#6a737b", fontSize: "0.85rem" }}>
            Run actions automatically when someone submits this form.
          </p>
        </div>
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => openEditor()}>
          + Add Automation
        </button>
      </div>
      {err ? <div className={styles.errorBanner}>{err}</div> : null}

      {automations.length === 0 ? (
        <div className={styles.emptyState}>
          <h3>No automations yet</h3>
          <p>Add an automation to send notifications, create tasks, or launch processes on submission.</p>
        </div>
      ) : (
        <div className={styles.autoList}>
          {automations.map((a) => (
            <div key={a.id} className={styles.autoCard}>
              <div className={styles.autoCardTop}>
                <div className={styles.autoName}>{a.name}</div>
                <label className={styles.autoToggle}>
                  <input type="checkbox" checked={a.isActive} onChange={() => toggleActive(a)} />
                  {a.isActive ? "Active" : "Paused"}
                </label>
              </div>
              <div className={styles.autoFlow}>
                <span className={styles.autoChipWhen}>WHEN</span>
                <span>{TRIGGER_LABELS[(a.triggerType as TriggerType) || "on_submit"]}</span>
                <span className={styles.autoArrow}>→</span>
                <span className={styles.autoChipThen}>THEN</span>
                <span>{ACTION_LABELS[a.actionType as ActionType] || a.actionType}</span>
              </div>
              <div className={styles.autoActions} style={{ marginTop: "0.5rem" }}>
                <button type="button" className={styles.smallBtn} onClick={() => openEditor(a)}>Edit</button>
                <button type="button" className={styles.smallBtn} onClick={() => remove(a)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing ? (
        <AutomationEditor
          draft={editing}
          setDraft={setEditing}
          fields={fields}
          onCancel={() => setEditing(null)}
          onSave={save}
          saving={saving}
        />
      ) : null}
    </div>
  );
}

function AutomationEditor({
  draft, setDraft, fields, onCancel, onSave, saving,
}: {
  draft: AutomationDraft;
  setDraft: (d: AutomationDraft) => void;
  fields: FormField[];
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  const setAction = (patch: Record<string, unknown>) =>
    setDraft({ ...draft, actionConfig: { ...draft.actionConfig, ...patch } });
  const setTrigger = (patch: Record<string, unknown>) =>
    setDraft({ ...draft, triggerConfig: { ...draft.triggerConfig, ...patch } });

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.modal} style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>{draft.id ? "Edit Automation" : "New Automation"}</h2>
          <button type="button" className={styles.closeBtn} onClick={onCancel}>×</button>
        </div>
        <div className={styles.autoEditor}>
          <div className={styles.field}>
            <label>Name</label>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="e.g. Email team on new submission"
            />
          </div>

          <div className={styles.autoSection}>
            <div className={styles.autoSectionTitle}>Trigger</div>
            <select
              className={styles.select}
              value={draft.triggerType}
              onChange={(e) => setDraft({ ...draft, triggerType: e.target.value as TriggerType, triggerConfig: {} })}
              style={{ width: "100%", marginBottom: "0.5rem" }}
            >
              {Object.entries(TRIGGER_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            {draft.triggerType === "on_field_value" ? (
              <>
                <div className={styles.field}>
                  <label>Field</label>
                  <select
                    value={(draft.triggerConfig.fieldKey as string) || ""}
                    onChange={(e) => setTrigger({ fieldKey: e.target.value })}
                  >
                    <option value="">Select field…</option>
                    {fields.filter((f) => !["heading", "paragraph", "divider", "spacer"].includes(f.fieldType))
                      .map((f) => (
                        <option key={f.id} value={f.fieldKey}>{f.label}</option>
                      ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label>Operator</label>
                  <select
                    value={(draft.triggerConfig.operator as string) || "equals"}
                    onChange={(e) => setTrigger({ operator: e.target.value })}
                  >
                    <option value="equals">equals</option>
                    <option value="not_equals">does not equal</option>
                    <option value="contains">contains</option>
                    <option value="is_empty">is empty</option>
                    <option value="is_not_empty">is not empty</option>
                  </select>
                </div>
                <div className={styles.field}>
                  <label>Value</label>
                  <input
                    type="text"
                    value={(draft.triggerConfig.value as string) || ""}
                    onChange={(e) => setTrigger({ value: e.target.value })}
                  />
                </div>
              </>
            ) : null}
            {draft.triggerType === "on_submission_count" ? (
              <div className={styles.field}>
                <label>Fire when submission count reaches</label>
                <input
                  type="number"
                  value={(draft.triggerConfig.count as number) ?? ""}
                  onChange={(e) => setTrigger({ count: Number(e.target.value) })}
                  min={1}
                />
              </div>
            ) : null}
          </div>

          <div className={styles.autoSection}>
            <div className={styles.autoSectionTitle}>Action</div>
            <select
              className={styles.select}
              value={draft.actionType}
              onChange={(e) => setDraft({ ...draft, actionType: e.target.value as ActionType, actionConfig: {} })}
              style={{ width: "100%", marginBottom: "0.5rem" }}
            >
              {Object.entries(ACTION_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>

            <ActionConfig
              actionType={draft.actionType}
              config={draft.actionConfig}
              setConfig={setAction}
              fields={fields}
            />
          </div>
        </div>
        <div className={styles.formActionsRow} style={{ padding: "0.75rem 1.25rem 1rem" }}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ActionConfig({
  actionType, config, setConfig, fields,
}: {
  actionType: ActionType;
  config: Record<string, unknown>;
  setConfig: (patch: Record<string, unknown>) => void;
  fields: FormField[];
}) {
  const inputFields = fields.filter(
    (f) => !["heading", "paragraph", "divider", "spacer"].includes(f.fieldType)
  );
  const emailFields = inputFields.filter((f) => f.fieldType === "email");

  if (actionType === "send_notification") {
    return (
      <>
        <div className={styles.field}>
          <label>User IDs (comma-separated)</label>
          <input
            type="text"
            value={((config.userIds as number[]) || []).join(",")}
            onChange={(e) => setConfig({ userIds: e.target.value.split(",").map((s) => Number(s.trim())).filter(Number.isFinite) })}
            placeholder="1, 3, 5"
          />
        </div>
        <MessageField
          label="Message"
          value={(config.message as string) || ""}
          onChange={(v) => setConfig({ message: v })}
          fields={inputFields}
        />
      </>
    );
  }
  if (actionType === "send_email") {
    return (
      <>
        <div className={styles.field}>
          <label>To (static email address)</label>
          <input
            type="text"
            value={(config.toAddress as string) || ""}
            onChange={(e) => setConfig({ toAddress: e.target.value })}
            placeholder="team@prestigerpm.com"
          />
        </div>
        <div className={styles.field}>
          <label>Or pick from a form field (email)</label>
          <select
            value={(config.toField as string) || ""}
            onChange={(e) => setConfig({ toField: e.target.value })}
          >
            <option value="">—</option>
            {emailFields.map((f) => <option key={f.id} value={f.fieldKey}>{f.label}</option>)}
          </select>
        </div>
        <MessageField label="Subject" value={(config.subject as string) || ""} onChange={(v) => setConfig({ subject: v })} fields={inputFields} />
        <MessageField label="Body" value={(config.body as string) || ""} onChange={(v) => setConfig({ body: v })} fields={inputFields} multiline />
        <div className={styles.toggleRow}>
          <input
            type="checkbox"
            id="attach-pdf"
            checked={!!config.includeSubmissionPdf}
            onChange={(e) => setConfig({ includeSubmissionPdf: e.target.checked })}
          />
          <label htmlFor="attach-pdf">Attach submission PDF</label>
        </div>
      </>
    );
  }
  if (actionType === "send_confirmation") {
    return (
      <>
        <div className={styles.field}>
          <label>Submitter email field</label>
          <select
            value={(config.emailField as string) || ""}
            onChange={(e) => setConfig({ emailField: e.target.value })}
          >
            <option value="">Auto-detect</option>
            {emailFields.map((f) => <option key={f.id} value={f.fieldKey}>{f.label}</option>)}
          </select>
        </div>
        <MessageField label="Subject" value={(config.subject as string) || ""} onChange={(v) => setConfig({ subject: v })} fields={inputFields} />
        <MessageField label="Body" value={(config.body as string) || ""} onChange={(v) => setConfig({ body: v })} fields={inputFields} multiline />
        <div className={styles.toggleRow}>
          <input
            type="checkbox"
            id="inc-summary"
            checked={!!config.includeSubmissionSummary}
            onChange={(e) => setConfig({ includeSubmissionSummary: e.target.checked })}
          />
          <label htmlFor="inc-summary">Include submission summary</label>
        </div>
      </>
    );
  }
  if (actionType === "create_task") {
    return (
      <>
        <MessageField label="Task title" value={(config.title as string) || ""} onChange={(v) => setConfig({ title: v })} fields={inputFields} />
        <MessageField label="Description" value={(config.description as string) || ""} onChange={(v) => setConfig({ description: v })} fields={inputFields} multiline />
        <div className={styles.field}>
          <label>Assigned user ID</label>
          <input type="number" value={(config.assignedUserId as number) ?? ""} onChange={(e) => setConfig({ assignedUserId: Number(e.target.value) })} />
        </div>
        <div className={styles.field}>
          <label>Priority</label>
          <select value={(config.priority as string) || "normal"} onChange={(e) => setConfig({ priority: e.target.value })}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
        <div className={styles.field}>
          <label>Due days from submit</label>
          <input type="number" value={(config.dueDaysFromSubmit as number) ?? ""} onChange={(e) => setConfig({ dueDaysFromSubmit: Number(e.target.value) })} />
        </div>
        <div className={styles.field}>
          <label>Category</label>
          <input type="text" value={(config.category as string) || ""} onChange={(e) => setConfig({ category: e.target.value })} />
        </div>
      </>
    );
  }
  if (actionType === "create_project") {
    return (
      <>
        <MessageField label="Project name" value={(config.name as string) || ""} onChange={(v) => setConfig({ name: v })} fields={inputFields} />
        <MessageField label="Description" value={(config.description as string) || ""} onChange={(v) => setConfig({ description: v })} fields={inputFields} multiline />
        <div className={styles.field}>
          <label>Category</label>
          <input type="text" value={(config.category as string) || ""} onChange={(e) => setConfig({ category: e.target.value })} />
        </div>
        <div className={styles.field}>
          <label>Owner user ID</label>
          <input type="number" value={(config.ownerUserId as number) ?? ""} onChange={(e) => setConfig({ ownerUserId: Number(e.target.value) })} />
        </div>
        <div className={styles.field}>
          <label>Target days from submit</label>
          <input type="number" value={(config.targetDaysFromSubmit as number) ?? ""} onChange={(e) => setConfig({ targetDaysFromSubmit: Number(e.target.value) })} />
        </div>
      </>
    );
  }
  if (actionType === "launch_process") {
    return (
      <>
        <div className={styles.field}>
          <label>Process template ID</label>
          <input type="number" value={(config.templateId as number) ?? ""} onChange={(e) => setConfig({ templateId: Number(e.target.value) })} />
        </div>
        <div className={styles.field}>
          <label>Contact name field</label>
          <select value={(config.contactNameField as string) || ""} onChange={(e) => setConfig({ contactNameField: e.target.value })}>
            <option value="">Auto-detect</option>
            {inputFields.map((f) => <option key={f.id} value={f.fieldKey}>{f.label}</option>)}
          </select>
        </div>
        <div className={styles.field}>
          <label>Contact email field</label>
          <select value={(config.contactEmailField as string) || ""} onChange={(e) => setConfig({ contactEmailField: e.target.value })}>
            <option value="">Auto-detect</option>
            {emailFields.map((f) => <option key={f.id} value={f.fieldKey}>{f.label}</option>)}
          </select>
        </div>
        <div className={styles.field}>
          <label>Property name field</label>
          <select value={(config.propertyNameField as string) || ""} onChange={(e) => setConfig({ propertyNameField: e.target.value })}>
            <option value="">—</option>
            {inputFields.map((f) => <option key={f.id} value={f.fieldKey}>{f.label}</option>)}
          </select>
        </div>
      </>
    );
  }
  if (actionType === "webhook") {
    return (
      <>
        <div className={styles.field}>
          <label>URL</label>
          <input type="text" value={(config.url as string) || ""} onChange={(e) => setConfig({ url: e.target.value })} placeholder="https://hooks.example.com/abc" />
        </div>
        <div className={styles.field}>
          <label>Method</label>
          <select value={(config.method as string) || "POST"} onChange={(e) => setConfig({ method: e.target.value })}>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="GET">GET</option>
          </select>
        </div>
        <div className={styles.toggleRow}>
          <input
            type="checkbox"
            id="inc-all"
            checked={config.includeAllFields !== false}
            onChange={(e) => setConfig({ includeAllFields: e.target.checked })}
          />
          <label htmlFor="inc-all">Include all submission fields</label>
        </div>
      </>
    );
  }
  if (actionType === "generate_pdf") {
    return (
      <>
        <div className={styles.toggleRow}>
          <input
            type="checkbox"
            id="save-prop"
            checked={!!config.saveToPropertyFolder}
            onChange={(e) => setConfig({ saveToPropertyFolder: e.target.checked })}
          />
          <label htmlFor="save-prop">Save PDF to property folder</label>
        </div>
        <div className={styles.field}>
          <label>Property name field</label>
          <select value={(config.propertyNameField as string) || ""} onChange={(e) => setConfig({ propertyNameField: e.target.value })}>
            <option value="">Auto-detect</option>
            {inputFields.map((f) => <option key={f.id} value={f.fieldKey}>{f.label}</option>)}
          </select>
        </div>
      </>
    );
  }
  if (actionType === "assign_to_team") {
    return (
      <>
        <div className={styles.field}>
          <label>Assignee user ID</label>
          <input type="number" value={(config.assigneeUserId as number) ?? ""} onChange={(e) => setConfig({ assigneeUserId: Number(e.target.value) })} />
        </div>
        <div className={styles.toggleRow}>
          <input
            type="checkbox"
            id="rr"
            checked={!!config.roundRobin}
            onChange={(e) => setConfig({ roundRobin: e.target.checked })}
          />
          <label htmlFor="rr">Round-robin between users</label>
        </div>
        {config.roundRobin ? (
          <div className={styles.field}>
            <label>User IDs (comma-separated)</label>
            <input
              type="text"
              value={((config.roundRobinUserIds as number[]) || []).join(",")}
              onChange={(e) => setConfig({
                roundRobinUserIds: e.target.value.split(",").map((s) => Number(s.trim())).filter(Number.isFinite),
              })}
            />
          </div>
        ) : null}
      </>
    );
  }
  return null;
}

function MessageField({
  label, value, onChange, fields, multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  fields: FormField[];
  multiline?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const insert = (token: string) => {
    const el = ref.current;
    if (!el) { onChange(value + token); setOpen(false); return; }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    onChange(next);
    setOpen(false);
    setTimeout(() => {
      el.focus();
      const pos = start + token.length;
      try { el.setSelectionRange(pos, pos); } catch {/* ignore */}
    }, 0);
  };

  const vars = [
    { token: "{{form_name}}", label: "Form name" },
    { token: "{{submission_id}}", label: "Submission ID" },
    { token: "{{contact_name}}", label: "Contact name" },
    { token: "{{contact_email}}", label: "Contact email" },
    { token: "{{date}}", label: "Today's date" },
    { token: "{{datetime}}", label: "Current date/time" },
    ...fields.map((f) => ({ token: `{{field:${f.fieldKey}}}`, label: `Field: ${f.label}` })),
  ];

  return (
    <div className={styles.field}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
        <label>{label}</label>
        <div ref={wrapRef} className={styles.varBtnWrap}>
          <button type="button" className={styles.varBtn} onClick={() => setOpen((o) => !o)}>
            Insert variable ▾
          </button>
          {open ? (
            <div className={styles.varDropdown}>
              {vars.map((v) => (
                <button key={v.token} type="button" className={styles.varItem} onClick={() => insert(v.token)}>
                  {v.label}
                  <div className={styles.varItemCode}>{v.token}</div>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {multiline ? (
        <textarea
          ref={ref as React.RefObject<HTMLTextAreaElement>}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
        />
      ) : (
        <input
          ref={ref as React.RefObject<HTMLInputElement>}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
