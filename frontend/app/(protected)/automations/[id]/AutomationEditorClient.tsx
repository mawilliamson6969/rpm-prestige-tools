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

  // Step list management moved into the recursive <StepList> component
  // so a branch's true/false child lists use the same logic.

  async function save() {
    if (!automation || saving) return;
    setSaving(true);
    setErr(null);
    setNotice(null);
    try {
      const body: Record<string, unknown> = {
        name: automation.name,
        description: automation.description,
        trigger_type: automation.trigger_type,
        enabled: automation.enabled,
        max_runs_per_day: automation.max_runs_per_day,
        steps: automation.steps.map((s) => ({ step_type: s.step_type, config: s.config })),
      };
      // Phase 2 §2: when the trigger is schedule.triggered, persist the
      // schedule too. When it isn't, clear any stale schedule row so the
      // worker's ticker stops firing it.
      if (automation.trigger_type === "schedule.triggered") {
        if (automation.schedule) {
          body.schedule = {
            cron_expression: automation.schedule.cron_expression,
            timezone: automation.schedule.timezone,
            enabled: automation.schedule.enabled,
          };
        }
      } else {
        body.schedule = null;
      }
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

        {automation.trigger_type === "schedule.triggered" ? (
          <ScheduleEditor
            schedule={automation.schedule ?? null}
            onChange={(next) =>
              setAutomation((a) => (a ? { ...a, schedule: next } : a))
            }
          />
        ) : null}

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

      <StepList
        steps={automation.steps}
        onChange={(next) => setAutomation((a) => (a ? { ...a, steps: next } : a))}
      />

      <div style={{ marginTop: 24, display: "flex", justifyContent: "flex-end" }}>
        <button className={styles.btnDanger} onClick={deleteAutomation}>
          Delete automation
        </button>
      </div>
    </div>
  );
}

/**
 * Recursive list of steps with add/remove/reconfigure. Branch step
 * children are rendered via two nested StepLists (true / false) so
 * the entire editor only knows one component pattern.
 */
function StepList({
  steps,
  onChange,
  depth = 0,
}: {
  steps: AutomationStep[];
  onChange: (next: AutomationStep[]) => void;
  depth?: number;
}) {
  function patchAt(i: number, patcher: (s: AutomationStep) => AutomationStep) {
    const next = steps.slice();
    next[i] = patcher(next[i]);
    onChange(next);
  }
  function addAt(at: number) {
    const newStep: AutomationStep = { step_type: "filter", config: defaultConfigFor("filter") };
    onChange([...steps.slice(0, at), newStep, ...steps.slice(at)]);
  }
  function removeAt(i: number) {
    onChange(steps.filter((_, k) => k !== i));
  }
  function setType(i: number, type: StepType) {
    patchAt(i, (s) => {
      const next: AutomationStep = { ...s, step_type: type, config: defaultConfigFor(type) };
      if (type === "branch") {
        next.true_steps = next.true_steps ?? [];
        next.false_steps = next.false_steps ?? [];
      } else {
        delete next.true_steps;
        delete next.false_steps;
      }
      return next;
    });
  }
  function setConfigKey(i: number, key: string, value: unknown) {
    patchAt(i, (s) => ({ ...s, config: { ...s.config, [key]: value } }));
  }

  return (
    <>
      {steps.map((s, i) => (
        <div key={i}>
          <div className={styles.addStepRow}>
            <button className={styles.addStepBtn} onClick={() => addAt(i)}>
              + Add step
            </button>
          </div>
          <div
            className={styles.stepCard}
            style={depth > 0 ? { borderLeft: "3px solid #1b2856", marginLeft: 8 } : undefined}
          >
            <div className={styles.stepHeader}>
              <div>
                <span className={styles.stepIndex}>{i + 1}</span>
                <span className={styles.stepTitle}>
                  {STEP_TYPE_LABELS[s.step_type] ?? s.step_type}
                </span>
              </div>
              <button className={styles.btnDanger} onClick={() => removeAt(i)}>
                Remove
              </button>
            </div>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Step type</span>
              <select
                className={styles.select}
                value={s.step_type}
                onChange={(e) => setType(i, e.target.value as StepType)}
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
              onChange={(key, value) => setConfigKey(i, key, value)}
            />

            {s.step_type === "branch" ? (
              <BranchChildren
                step={s}
                depth={depth + 1}
                onTrueChange={(t) => patchAt(i, (st) => ({ ...st, true_steps: t }))}
                onFalseChange={(f) => patchAt(i, (st) => ({ ...st, false_steps: f }))}
              />
            ) : null}
          </div>
        </div>
      ))}

      <div className={styles.addStepRow}>
        <button className={styles.addStepBtn} onClick={() => addAt(steps.length)}>
          + Add step
        </button>
      </div>
    </>
  );
}

function BranchChildren({
  step,
  depth,
  onTrueChange,
  onFalseChange,
}: {
  step: AutomationStep;
  depth: number;
  onTrueChange: (next: AutomationStep[]) => void;
  onFalseChange: (next: AutomationStep[]) => void;
}) {
  const trueSteps = step.true_steps ?? [];
  const falseSteps = step.false_steps ?? [];
  return (
    <div
      style={{
        marginTop: 12,
        padding: 12,
        background: "#f7f9fc",
        border: "1px solid #e6e9ee",
        borderRadius: 6,
      }}
    >
      <div className={styles.fieldLabel} style={{ marginBottom: 8 }}>
        If true (condition passes)
      </div>
      <StepList steps={trueSteps} onChange={onTrueChange} depth={depth} />

      <div className={styles.fieldLabel} style={{ marginTop: 16, marginBottom: 8 }}>
        Otherwise
      </div>
      <StepList steps={falseSteps} onChange={onFalseChange} depth={depth} />
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

  if (step.step_type === "branch") {
    // Same field/operator/value shape as Filter — the worker shares
    // the runFilter helper to evaluate it.
    return (
      <>
        <div className={styles.muted} style={{ marginBottom: 8 }}>
          Evaluates the condition. If true, the steps under <strong>If true</strong> run; otherwise
          the steps under <strong>Otherwise</strong> run. Steps after the branch (at the same
          level) run after either path completes.
        </div>
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

  if (step.step_type === "delay") {
    return (
      <>
        <div className={styles.muted} style={{ marginBottom: 8 }}>
          The worker doesn&apos;t actually sleep — it parks the run and schedules a resume
          event, so the engine stays free to handle other automations. Total wait is the
          sum of all three fields.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Minutes</span>
            <input
              className={styles.input}
              type="number"
              min={0}
              value={asString(c.duration_minutes)}
              onChange={(e) =>
                onChange(
                  "duration_minutes",
                  e.target.value === "" ? 0 : Math.max(0, Number(e.target.value))
                )
              }
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Hours</span>
            <input
              className={styles.input}
              type="number"
              min={0}
              value={asString(c.duration_hours)}
              onChange={(e) =>
                onChange(
                  "duration_hours",
                  e.target.value === "" ? 0 : Math.max(0, Number(e.target.value))
                )
              }
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Days</span>
            <input
              className={styles.input}
              type="number"
              min={0}
              value={asString(c.duration_days)}
              onChange={(e) =>
                onChange(
                  "duration_days",
                  e.target.value === "" ? 0 : Math.max(0, Number(e.target.value))
                )
              }
            />
          </label>
        </div>
      </>
    );
  }

  return null;
}

type Schedule = NonNullable<Automation["schedule"]>;

const CRON_PRESETS: Array<{ label: string; expr: string }> = [
  { label: "Every day at 9am", expr: "0 9 * * *" },
  { label: "Every weekday at 9am", expr: "0 9 * * 1-5" },
  { label: "Every Monday at 9am", expr: "0 9 * * 1" },
  { label: "Every hour on the hour", expr: "0 * * * *" },
  { label: "Every 15 minutes", expr: "*/15 * * * *" },
];

function ScheduleEditor({
  schedule,
  onChange,
}: {
  schedule: Schedule | null;
  onChange: (next: Schedule | null) => void;
}) {
  const current: Schedule = schedule ?? {
    id: 0,
    cron_expression: "0 9 * * *",
    timezone: "America/Chicago",
    enabled: true,
    last_fired_at: null,
    next_fire_at: null,
  };

  function patch(p: Partial<Schedule>) {
    onChange({ ...current, ...p });
  }

  return (
    <div
      style={{
        marginTop: 12,
        padding: 12,
        border: "1px solid #e6e9ee",
        borderRadius: 6,
        background: "#f7f9fc",
      }}
    >
      <div className={styles.fieldLabel}>Schedule</div>
      <label className={styles.field} style={{ marginTop: 6 }}>
        <span className={styles.fieldLabel}>Preset</span>
        <select
          className={styles.select}
          value={CRON_PRESETS.find((p) => p.expr === current.cron_expression)?.expr ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            if (v) patch({ cron_expression: v });
          }}
        >
          <option value="">— pick one (or write a cron expression) —</option>
          {CRON_PRESETS.map((p) => (
            <option key={p.expr} value={p.expr}>
              {p.label} ({p.expr})
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Cron expression (5 fields: min hour dom month dow)</span>
        <input
          className={styles.input}
          value={current.cron_expression}
          onChange={(e) => patch({ cron_expression: e.target.value })}
          placeholder="0 9 * * *"
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Timezone</span>
        <input
          className={styles.input}
          value={current.timezone}
          onChange={(e) => patch({ timezone: e.target.value })}
          placeholder="America/Chicago"
        />
      </label>
      {current.next_fire_at ? (
        <div className={styles.muted}>
          Next fire: {new Date(current.next_fire_at).toLocaleString()}
          {current.last_fired_at ? (
            <> · last fired {new Date(current.last_fired_at).toLocaleString()}</>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
