"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../../operations.module.css";
import { apiUrl } from "../../../../../lib/api";
import { useAuth } from "../../../../../context/AuthContext";
import type {
  AutopilotCondition,
  AutopilotDryRunResult,
  AutopilotEntity,
  AutopilotFrequency,
  AutopilotOperator,
  AutopilotRule,
  AutopilotRunLog,
  Template,
  TemplateStage,
} from "../../types";
import { AUTOPILOT_ENTITY_FIELDS, AUTOPILOT_OPERATOR_LABELS } from "../../types";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function describeSchedule(rule: AutopilotRule): string {
  const time = rule.timeOfDay?.slice(0, 5) || "06:00";
  if (rule.frequency === "day") return `Every day at ${time}`;
  if (rule.frequency === "week") {
    return `Every ${DAY_NAMES[rule.dayOfPeriod] ?? "Mon"} at ${time}`;
  }
  return `Day ${rule.dayOfPeriod} of every month at ${time}`;
}

function describeConditions(rule: AutopilotRule): string {
  if (!rule.conditions.length) return "No conditions";
  const parts = rule.conditions.map(
    (c) => `${c.field} ${AUTOPILOT_OPERATOR_LABELS[c.operator]} ${c.value || ""}`.trim()
  );
  return `For each ${rule.conditionEntity} where ${parts.join(" AND ")}`;
}

function blankRule(templateId: number, stages: TemplateStage[]): Partial<AutopilotRule> {
  return {
    templateId,
    name: "New Autopilot Rule",
    isEnabled: false,
    frequency: "month",
    dayOfPeriod: 1,
    timeOfDay: "06:00:00",
    timezone: "America/Chicago",
    startingStageId: stages[0]?.id ?? null,
    conditionEntity: "unit",
    conditions: [{ field: "status", operator: "is", value: "Current" }],
    processNameTemplate: "Process for {{property.address}}",
    preventDuplicate: true,
    duplicateCheckField: "property_name",
  };
}

export default function AutopilotPanel({
  template,
  stages,
}: {
  template: Template & { isLive?: boolean };
  stages: TemplateStage[];
}) {
  const { authHeaders, token } = useAuth();
  const [rules, setRules] = useState<AutopilotRule[]>([]);
  const [editing, setEditing] = useState<Partial<AutopilotRule> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dryRunByRule, setDryRunByRule] = useState<Record<number, AutopilotDryRunResult>>({});
  const [logsByRule, setLogsByRule] = useState<Record<number, AutopilotRunLog[]>>({});

  const isLive = template.isLive !== false;

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(
        apiUrl(`/processes/templates/${template.id}/autopilot-rules`),
        { headers: { ...authHeaders() }, cache: "no-store" }
      );
      if (!res.ok) return;
      const body = await res.json();
      if (Array.isArray(body.rules)) setRules(body.rules);
    } catch {
      /* ignore */
    }
  }, [authHeaders, token, template.id]);

  useEffect(() => {
    load();
  }, [load]);

  const startNew = () => setEditing(blankRule(template.id, stages));
  const startEdit = (rule: AutopilotRule) => setEditing({ ...rule });

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setErr(null);
    try {
      const isUpdate = Number.isFinite((editing as AutopilotRule).id);
      const url = isUpdate
        ? apiUrl(`/autopilot-rules/${(editing as AutopilotRule).id}`)
        : apiUrl(`/processes/templates/${template.id}/autopilot-rules`);
      const res = await fetch(url, {
        method: isUpdate ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(editing),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Save failed");
      setEditing(null);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm("Delete this autopilot rule?")) return;
    try {
      await fetch(apiUrl(`/autopilot-rules/${id}`), {
        method: "DELETE",
        headers: { ...authHeaders() },
      });
      await load();
    } catch {
      /* ignore */
    }
  };

  const toggle = async (rule: AutopilotRule) => {
    setErr(null);
    try {
      const res = await fetch(
        apiUrl(`/autopilot-rules/${rule.id}/${rule.isEnabled ? "disable" : "enable"}`),
        { method: "PUT", headers: { ...authHeaders() } }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Toggle failed");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Toggle failed.");
    }
  };

  const test = async (rule: AutopilotRule) => {
    try {
      const res = await fetch(apiUrl(`/autopilot-rules/${rule.id}/test`), {
        method: "POST",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Test failed");
      setDryRunByRule((prev) => ({ ...prev, [rule.id]: body }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Test failed.");
    }
  };

  const runNow = async (rule: AutopilotRule) => {
    if (!confirm(`Run "${rule.name}" now? This will create real processes.`)) return;
    try {
      const res = await fetch(apiUrl(`/autopilot-rules/${rule.id}/run-now`), {
        method: "POST",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Run failed");
      await load();
      await loadLog(rule.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Run failed.");
    }
  };

  const loadLog = async (ruleId: number) => {
    try {
      const res = await fetch(apiUrl(`/autopilot-rules/${ruleId}/log`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = await res.json();
      setLogsByRule((prev) => ({ ...prev, [ruleId]: body.runs || [] }));
    } catch {
      /* ignore */
    }
  };

  return (
    <div>
      {!isLive ? (
        <div
          style={{
            padding: "0.7rem 0.9rem",
            marginBottom: "1rem",
            background: "rgba(0, 152, 208, 0.08)",
            border: "1px solid rgba(0, 152, 208, 0.3)",
            borderRadius: 8,
            color: "#0b5273",
            fontSize: "0.88rem",
          }}
        >
          This Process Type is in <strong>Draft Mode</strong>, so Autopilot rules can&rsquo;t be
          turned on. Set the template Live to enable automation.
        </div>
      ) : null}

      {err ? <div className={styles.errorBanner}>{err}</div> : null}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.75rem",
        }}
      >
        <h3 style={{ margin: 0, color: "#1b2856", fontSize: "1rem" }}>
          Autopilot rules ({rules.length})
        </h3>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={startNew}
        >
          + Add rule
        </button>
      </div>

      {editing ? (
        <RuleEditor
          rule={editing}
          stages={stages}
          onChange={setEditing}
          onSave={save}
          onCancel={() => setEditing(null)}
          busy={busy}
        />
      ) : null}

      {rules.length === 0 && !editing ? (
        <div
          style={{
            padding: "1rem",
            border: "1px dashed rgba(27, 40, 86, 0.15)",
            borderRadius: 8,
            color: "#6a737b",
            fontSize: "0.88rem",
          }}
        >
          No autopilot rules yet. Click <strong>+ Add rule</strong> to set up the first one
          (e.g. periodic inspections, lease renewals).
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          {rules.map((rule) => {
            const dry = dryRunByRule[rule.id];
            const log = logsByRule[rule.id];
            return (
              <div
                key={rule.id}
                style={{
                  padding: "0.75rem 0.9rem",
                  border: "1px solid rgba(27, 40, 86, 0.1)",
                  borderRadius: 8,
                  background: rule.isEnabled
                    ? "rgba(16, 185, 129, 0.04)"
                    : "rgba(27, 40, 86, 0.02)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: "0.5rem",
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        marginBottom: "0.2rem",
                      }}
                    >
                      <strong style={{ color: "#1b2856" }}>{rule.name}</strong>
                      <span
                        style={{
                          fontSize: "0.7rem",
                          padding: "0.1rem 0.45rem",
                          borderRadius: 999,
                          background: rule.isEnabled
                            ? "rgba(16, 185, 129, 0.15)"
                            : "rgba(106, 115, 123, 0.12)",
                          color: rule.isEnabled ? "#10b981" : "#6a737b",
                          fontWeight: 700,
                        }}
                      >
                        {rule.isEnabled ? "ENABLED" : "OFF"}
                      </span>
                    </div>
                    <div style={{ fontSize: "0.82rem", color: "#6a737b" }}>
                      {describeSchedule(rule)} · {describeConditions(rule)}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "#6a737b", marginTop: "0.25rem" }}>
                      {rule.lastRunAt
                        ? `Last ran ${new Date(rule.lastRunAt).toLocaleString()} · ${rule.totalProcessesCreated} processes created total`
                        : "Never run"}
                      {rule.isEnabled && rule.nextRunAt
                        ? ` · Next: ${new Date(rule.nextRunAt).toLocaleString()}`
                        : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className={styles.smallBtn}
                      onClick={() => test(rule)}
                    >
                      Test
                    </button>
                    <button
                      type="button"
                      className={styles.smallBtn}
                      onClick={() => loadLog(rule.id)}
                    >
                      Log
                    </button>
                    <button
                      type="button"
                      className={`${styles.smallBtn} ${rule.isEnabled ? styles.smallBtnDanger : ""}`}
                      onClick={() => toggle(rule)}
                      disabled={!isLive}
                      title={!isLive ? "Set template Live to enable" : undefined}
                    >
                      {rule.isEnabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      type="button"
                      className={styles.smallBtn}
                      onClick={() => startEdit(rule)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className={`${styles.smallBtn} ${styles.smallBtnDanger}`}
                      onClick={() => remove(rule.id)}
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      className={`${styles.smallBtn}`}
                      onClick={() => runNow(rule)}
                      title="Run this rule right now"
                    >
                      Run now
                    </button>
                  </div>
                </div>

                {dry ? (
                  <div
                    style={{
                      marginTop: "0.6rem",
                      padding: "0.5rem 0.6rem",
                      borderRadius: 6,
                      background: "rgba(27, 40, 86, 0.04)",
                      fontSize: "0.82rem",
                    }}
                  >
                    <strong style={{ color: "#1b2856" }}>Dry run:</strong>{" "}
                    {dry.matched} matched ·{" "}
                    {dry.preview.length} previewed
                    {dry.preview.length ? (
                      <ul style={{ margin: "0.35rem 0 0 1rem", padding: 0 }}>
                        {dry.preview.slice(0, 10).map((p, i) => (
                          <li key={i} style={{ fontSize: "0.78rem", color: "#1b2856" }}>
                            {p.propertyName || p.contactName || `(entity ${i})`}
                          </li>
                        ))}
                        {dry.preview.length > 10 ? (
                          <li style={{ fontSize: "0.78rem", color: "#6a737b" }}>
                            … and {dry.preview.length - 10} more
                          </li>
                        ) : null}
                      </ul>
                    ) : null}
                  </div>
                ) : null}

                {log ? (
                  <div
                    style={{
                      marginTop: "0.6rem",
                      padding: "0.5rem 0.6rem",
                      borderRadius: 6,
                      background: "rgba(27, 40, 86, 0.04)",
                      fontSize: "0.78rem",
                    }}
                  >
                    <strong style={{ color: "#1b2856" }}>Recent runs:</strong>
                    {log.length === 0 ? (
                      <div style={{ color: "#6a737b" }}>No runs yet.</div>
                    ) : (
                      <ul style={{ margin: "0.35rem 0 0 1rem", padding: 0 }}>
                        {log.slice(0, 5).map((l) => (
                          <li key={l.id} style={{ color: "#1b2856" }}>
                            {new Date(l.runAt).toLocaleString()} — {l.status} ·{" "}
                            {l.processesCreated} created · {l.duplicatesSkipped} skipped
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RuleEditor({
  rule,
  stages,
  onChange,
  onSave,
  onCancel,
  busy,
}: {
  rule: Partial<AutopilotRule>;
  stages: TemplateStage[];
  onChange: (next: Partial<AutopilotRule>) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const conditions = rule.conditions || [];
  const fields = AUTOPILOT_ENTITY_FIELDS[rule.conditionEntity || "unit"];

  const setCondition = (i: number, patch: Partial<AutopilotCondition>) => {
    const next = conditions.slice();
    next[i] = { ...next[i], ...patch };
    onChange({ ...rule, conditions: next });
  };

  return (
    <div
      style={{
        padding: "0.85rem",
        border: "1px solid rgba(0, 152, 208, 0.3)",
        background: "rgba(0, 152, 208, 0.04)",
        borderRadius: 8,
        marginBottom: "1rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.6rem",
      }}
    >
      <label className={styles.cfField}>
        <span className={styles.cfLabel}>Rule name</span>
        <input
          className={styles.cfInput}
          value={rule.name || ""}
          onChange={(e) => onChange({ ...rule, name: e.target.value })}
        />
      </label>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr 1fr",
          gap: "0.5rem",
        }}
      >
        <label className={styles.cfField}>
          <span className={styles.cfLabel}>Frequency</span>
          <select
            className={styles.cfSelect}
            value={rule.frequency || "month"}
            onChange={(e) =>
              onChange({ ...rule, frequency: e.target.value as AutopilotFrequency })
            }
          >
            <option value="day">Daily</option>
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
          </select>
        </label>

        <label className={styles.cfField}>
          <span className={styles.cfLabel}>
            {rule.frequency === "week" ? "Day of week" : rule.frequency === "month" ? "Day of month" : "—"}
          </span>
          {rule.frequency === "week" ? (
            <select
              className={styles.cfSelect}
              value={rule.dayOfPeriod ?? 1}
              onChange={(e) =>
                onChange({ ...rule, dayOfPeriod: Number(e.target.value) })
              }
            >
              {DAY_NAMES.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          ) : (
            <input
              className={styles.cfInput}
              type="number"
              min={1}
              max={28}
              value={rule.dayOfPeriod ?? 1}
              onChange={(e) =>
                onChange({ ...rule, dayOfPeriod: Number(e.target.value) || 1 })
              }
              disabled={rule.frequency === "day"}
            />
          )}
        </label>

        <label className={styles.cfField}>
          <span className={styles.cfLabel}>Time</span>
          <input
            className={styles.cfInput}
            type="time"
            value={rule.timeOfDay?.slice(0, 5) || "06:00"}
            onChange={(e) =>
              onChange({ ...rule, timeOfDay: `${e.target.value}:00` })
            }
          />
        </label>

        <label className={styles.cfField}>
          <span className={styles.cfLabel}>Starting stage</span>
          <select
            className={styles.cfSelect}
            value={rule.startingStageId ?? ""}
            onChange={(e) =>
              onChange({
                ...rule,
                startingStageId: e.target.value ? Number(e.target.value) : null,
              })
            }
          >
            <option value="">— None —</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className={styles.cfField}>
        <span className={styles.cfLabel}>For each</span>
        <select
          className={styles.cfSelect}
          value={rule.conditionEntity || "unit"}
          onChange={(e) =>
            onChange({
              ...rule,
              conditionEntity: e.target.value as AutopilotEntity,
              conditions: [],
            })
          }
        >
          <option value="unit">Unit (rent roll)</option>
          <option value="property">Property</option>
          <option value="owner">Owner</option>
          <option value="tenant">Tenant (occupied unit)</option>
          <option value="lease">Lease expiration</option>
        </select>
      </label>

      <div>
        <div className={styles.cfLabel}>Conditions (all must match)</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {conditions.map((c, i) => (
            <div
              key={i}
              style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}
            >
              <select
                className={styles.cfSelect}
                value={c.field}
                onChange={(e) => setCondition(i, { field: e.target.value })}
                style={{ flex: 1 }}
              >
                {fields.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <select
                className={styles.cfSelect}
                value={c.operator}
                onChange={(e) =>
                  setCondition(i, { operator: e.target.value as AutopilotOperator })
                }
                style={{ flex: 1 }}
              >
                {Object.keys(AUTOPILOT_OPERATOR_LABELS).map((op) => (
                  <option key={op} value={op}>
                    {AUTOPILOT_OPERATOR_LABELS[op as AutopilotOperator]}
                  </option>
                ))}
              </select>
              {c.operator === "is_empty" || c.operator === "is_not_empty" ? null : (
                <input
                  className={styles.cfInput}
                  value={c.value || ""}
                  onChange={(e) => setCondition(i, { value: e.target.value })}
                  placeholder="value"
                  style={{ flex: 1 }}
                />
              )}
              <button
                type="button"
                className={`${styles.smallBtn} ${styles.smallBtnDanger}`}
                onClick={() =>
                  onChange({
                    ...rule,
                    conditions: conditions.filter((_, j) => j !== i),
                  })
                }
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className={styles.smallBtn}
            style={{ alignSelf: "flex-start" }}
            onClick={() =>
              onChange({
                ...rule,
                conditions: [
                  ...conditions,
                  { field: fields[0], operator: "is", value: "" },
                ],
              })
            }
          >
            + Add condition
          </button>
        </div>
      </div>

      <label className={styles.cfField}>
        <span className={styles.cfLabel}>Process name template</span>
        <input
          className={styles.cfInput}
          value={rule.processNameTemplate || ""}
          onChange={(e) =>
            onChange({ ...rule, processNameTemplate: e.target.value })
          }
          placeholder="Periodic Inspection for {{property.address}}"
        />
        <span style={{ fontSize: "0.72rem", color: "#6a737b" }}>
          Available: {"{{property.address}}"}, {"{{tenant.name}}"}, {"{{owner.name}}"}
        </span>
      </label>

      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.4rem",
          fontSize: "0.85rem",
          color: "#1b2856",
        }}
      >
        <input
          type="checkbox"
          checked={rule.preventDuplicate !== false}
          onChange={(e) => onChange({ ...rule, preventDuplicate: e.target.checked })}
        />
        Skip if an active process for this {rule.conditionEntity || "entity"} already exists
      </label>

      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={onSave}
          disabled={busy}
        >
          {busy ? "Saving…" : "Save rule"}
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnGhost}`}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
