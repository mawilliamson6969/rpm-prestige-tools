"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiUrl } from "../../../../lib/api";
import { useAuth } from "../../../../context/AuthContext";
import styles from "../automations.module.css";
import {
  TRIGGER_OPTIONS,
  STEP_TYPE_LABELS,
  FILTER_OPERATORS,
  defaultConfigFor,
  type Automation,
  type AutomationStep,
  type StepType,
} from "../types";

type Props = { automationId: number };

function asString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}

export default function AutomationEditorClient({ automationId }: Props) {
  const { authHeaders } = useAuth();
  const router = useRouter();
  const [automation, setAutomation] = useState<Automation | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(apiUrl(`/automations/${automationId}`), {
          headers: authHeaders(),
        });
        if (!res.ok) throw new Error(`Failed to load (${res.status}).`);
        const json = await res.json();
        if (!cancelled) setAutomation(json.automation);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Load failed.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [automationId]);

  const triggerMeta = useMemo(
    () => TRIGGER_OPTIONS.find((t) => t.value === automation?.trigger_type),
    [automation?.trigger_type]
  );

  function patch<K extends keyof Automation>(key: K, value: Automation[K]) {
    setAutomation((a) => (a ? { ...a, [key]: value } : a));
  }

  function updateStep(i: number, patcher: (s: AutomationStep) => AutomationStep) {
    setAutomation((a) => {
      if (!a) return a;
      const next = a.steps.slice();
      next[i] = patcher(next[i]);
      return { ...a, steps: next };
    });
  }

  function setStepType(i: number, type: StepType) {
    updateStep(i, (s) => ({ ...s, step_type: type, config: defaultConfigFor(type) }));
  }

  function setStepConfig(i: number, key: string, value: unknown) {
    updateStep(i, (s) => ({ ...s, config: { ...s.config, [key]: value } }));
  }

  function addStep(at: number) {
    setAutomation((a) => {
      if (!a) return a;
      const newStep: AutomationStep = { step_type: "filter", config: defaultConfigFor("filter") };
      const next = [...a.steps.slice(0, at), newStep, ...a.steps.slice(at)];
      return { ...a, steps: next };
    });
  }

  function removeStep(i: number) {
    setAutomation((a) => (a ? { ...a, steps: a.steps.filter((_, k) => k !== i) } : a));
  }

  async function save() {
    if (!automation || saving) return;
    setSaving(true);
    setErr(null);
    setNotice(null);
    try {
      const body = {
        name: automation.name,
        description: automation.description,
        trigger_type: automation.trigger_type,
        enabled: automation.enabled,
        max_runs_per_day: automation.max_runs_per_day,
        steps: automation.steps.map((s) => ({ step_type: s.step_type, config: s.config })),
      };
      const res = await fetch(apiUrl(`/automations/${automationId}`), {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed.");
      setAutomation(json.automation);
      setNotice("Saved.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    if (!automation || testing) return;
    setTesting(true);
    setErr(null);
    setNotice(null);
    try {
      const res = await fetch(apiUrl(`/automations/${automationId}/test`), {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ payload: {} }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Test failed.");
      setNotice(`Test event #${json.event_id} queued — open History to see the result.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Test failed.");
    } finally {
      setTesting(false);
    }
  }

  async function deleteAutomation() {
    if (!automation) return;
    if (!confirm(`Delete "${automation.name}"? This also removes its run history.`)) return;
    try {
      const res = await fetch(apiUrl(`/automations/${automationId}`), {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Delete failed.");
      }
      router.push("/automations");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed.");
    }
  }

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.empty}>Loading…</div>
      </div>
    );
  }
  if (!automation) {
    return (
      <div className={styles.page}>
        <div className={styles.error}>{err || "Automation not found."}</div>
        <Link href="/automations" className={styles.btnSecondary}>
          ← Back
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.editorTop}>
        <Link href="/automations" className={styles.btnSecondary}>
          ← Back
        </Link>
        <input
          className={styles.nameInput}
          value={automation.name}
          onChange={(e) => patch("name", e.target.value)}
          placeholder="Automation name"
        />
        <div className={styles.actions}>
          <label className={styles.toggle} title={automation.enabled ? "On" : "Off"}>
            <input
              type="checkbox"
              checked={automation.enabled}
              onChange={(e) => patch("enabled", e.target.checked)}
            />
            <span className={styles.slider} />
          </label>
          <span className={automation.enabled ? styles.badgeOn : styles.badgeOff}>
            {automation.enabled ? "Enabled" : "Disabled"}
          </span>
          <button className={styles.btnSecondary} onClick={runTest} disabled={testing}>
            {testing ? "Testing…" : "Test"}
          </button>
          <Link
            href={`/automations/${automationId}/runs`}
            className={styles.btnSecondary}
            style={{ textDecoration: "none" }}
          >
            History
          </Link>
          <button className={styles.btnPrimary} onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {err ? <div className={styles.error}>{err}</div> : null}
      {notice ? <div className={styles.notice}>{notice}</div> : null}

      <div className={styles.stepCard}>
        <div className={styles.stepHeader}>
          <div>
            <span className={styles.stepIndex}>★</span>
            <span className={styles.stepTitle}>Trigger</span>
          </div>
        </div>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>When this event happens…</span>
          <select
            className={styles.select}
            value={automation.trigger_type}
            onChange={(e) => patch("trigger_type", e.target.value)}
          >
            {TRIGGER_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        {triggerMeta ? <div className={styles.muted}>{triggerMeta.description}</div> : null}

        <label className={styles.field} style={{ marginTop: 12 }}>
          <span className={styles.fieldLabel}>Description (optional)</span>
          <textarea
            className={styles.textarea}
            value={automation.description ?? ""}
            onChange={(e) => patch("description", e.target.value)}
            placeholder="A note for your team about what this automation is for."
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Max runs per day (optional)</span>
          <input
            className={styles.input}
            type="number"
            min={0}
            value={automation.max_runs_per_day ?? ""}
            onChange={(e) =>
              patch(
                "max_runs_per_day",
                e.target.value === "" ? null : Math.max(0, Number(e.target.value))
              )
            }
            placeholder="No limit"
          />
        </label>
      </div>

      {automation.steps.map((s, i) => (
        <div key={i}>
          <div className={styles.addStepRow}>
            <button className={styles.addStepBtn} onClick={() => addStep(i)}>
              + Add step
            </button>
          </div>
          <div className={styles.stepCard}>
            <div className={styles.stepHeader}>
              <div>
                <span className={styles.stepIndex}>{i + 1}</span>
                <span className={styles.stepTitle}>{STEP_TYPE_LABELS[s.step_type] ?? s.step_type}</span>
              </div>
              <button className={styles.btnDanger} onClick={() => removeStep(i)}>
                Remove
              </button>
            </div>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Step type</span>
              <select
                className={styles.select}
                value={s.step_type}
                onChange={(e) => setStepType(i, e.target.value as StepType)}
              >
                {Object.entries(STEP_TYPE_LABELS).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <StepConfigEditor
              step={s}
              onChange={(key, value) => setStepConfig(i, key, value)}
            />
          </div>
        </div>
      ))}

      <div className={styles.addStepRow}>
        <button className={styles.addStepBtn} onClick={() => addStep(automation.steps.length)}>
          + Add step
        </button>
      </div>

      <div style={{ marginTop: 24, display: "flex", justifyContent: "flex-end" }}>
        <button className={styles.btnDanger} onClick={deleteAutomation}>
          Delete automation
        </button>
      </div>
    </div>
  );
}

function StepConfigEditor({
  step,
  onChange,
}: {
  step: AutomationStep;
  onChange: (key: string, value: unknown) => void;
}) {
  const c = step.config as Record<string, unknown>;

  if (step.step_type === "filter") {
    return (
      <>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Field path</span>
          <input
            className={styles.input}
            value={asString(c.field)}
            onChange={(e) => onChange("field", e.target.value)}
            placeholder="event.payload.priority"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Operator</span>
          <select
            className={styles.select}
            value={asString(c.operator) || "equals"}
            onChange={(e) => onChange("operator", e.target.value)}
          >
            {FILTER_OPERATORS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Value</span>
          <input
            className={styles.input}
            value={asString(c.value)}
            onChange={(e) => onChange("value", e.target.value)}
            placeholder="Emergency"
          />
        </label>
      </>
    );
  }

  if (step.step_type === "send_sms") {
    return (
      <>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>To (phone)</span>
          <input
            className={styles.input}
            value={asString(c.to)}
            onChange={(e) => onChange("to", e.target.value)}
            placeholder="+18325551212 or {{event.payload.tenant_phone}}"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>From (optional — defaults to OPENPHONE_FROM_NUMBER)</span>
          <input
            className={styles.input}
            value={asString(c.from)}
            onChange={(e) => onChange("from", e.target.value)}
            placeholder="PNVvWJMrYO"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Body</span>
          <textarea
            className={styles.textarea}
            value={asString(c.body)}
            onChange={(e) => onChange("body", e.target.value)}
            placeholder="EMERGENCY at {{event.payload.property_address}}"
          />
        </label>
      </>
    );
  }

  if (step.step_type === "send_email") {
    return (
      <>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>To</span>
          <input
            className={styles.input}
            value={asString(c.to)}
            onChange={(e) => onChange("to", e.target.value)}
            placeholder="recipient@example.com"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Subject</span>
          <input
            className={styles.input}
            value={asString(c.subject)}
            onChange={(e) => onChange("subject", e.target.value)}
            placeholder="Update on {{event.payload.property_address}}"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Body (plain text or HTML)</span>
          <textarea
            className={styles.textarea}
            value={asString(c.body)}
            onChange={(e) => onChange("body", e.target.value)}
          />
        </label>
      </>
    );
  }

  if (step.step_type === "create_card") {
    return (
      <>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Board ID</span>
          <input
            className={styles.input}
            type="number"
            value={asString(c.board_id)}
            onChange={(e) => onChange("board_id", Number(e.target.value) || "")}
            placeholder="3"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Group / Column ID (optional)</span>
          <input
            className={styles.input}
            type="number"
            value={asString(c.group_id)}
            onChange={(e) =>
              onChange(
                "group_id",
                e.target.value === "" ? "" : Number(e.target.value) || ""
              )
            }
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Title</span>
          <input
            className={styles.input}
            value={asString(c.title)}
            onChange={(e) => onChange("title", e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Description (optional)</span>
          <textarea
            className={styles.textarea}
            value={asString(c.description)}
            onChange={(e) => onChange("description", e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Assigned to (user id, optional)</span>
          <input
            className={styles.input}
            type="number"
            value={asString(c.assigned_to)}
            onChange={(e) =>
              onChange(
                "assigned_to",
                e.target.value === "" ? "" : Number(e.target.value) || ""
              )
            }
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Due in (hours, optional)</span>
          <input
            className={styles.input}
            type="number"
            value={asString(c.due_in_hours)}
            onChange={(e) =>
              onChange(
                "due_in_hours",
                e.target.value === "" ? "" : Number(e.target.value) || ""
              )
            }
          />
        </label>
      </>
    );
  }

  if (step.step_type === "ai_draft") {
    return (
      <>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Prompt</span>
          <textarea
            className={styles.textarea}
            value={asString(c.prompt)}
            onChange={(e) => onChange("prompt", e.target.value)}
            placeholder="You are Lori from RPM Prestige. Draft a reply to: {{event.payload.text}}"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Output key (later steps reference {`{{context.<key>}}`})</span>
          <input
            className={styles.input}
            value={asString(c.output_key) || "draft"}
            onChange={(e) => onChange("output_key", e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Max tokens</span>
          <input
            className={styles.input}
            type="number"
            value={asString(c.max_tokens) || "600"}
            onChange={(e) => onChange("max_tokens", Number(e.target.value) || 600)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>System prompt (optional)</span>
          <textarea
            className={styles.textarea}
            value={asString(c.system)}
            onChange={(e) => onChange("system", e.target.value)}
          />
        </label>
      </>
    );
  }

  return null;
}
