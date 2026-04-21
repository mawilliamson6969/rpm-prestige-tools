"use client";

import styles from "./operations.module.css";
import type { CustomFieldDefinition, DueDateType, TemplateStep, TemplateStage } from "./types";
import { DUE_DATE_TYPE_LABELS } from "./types";

type Props = {
  type: DueDateType;
  config: Record<string, unknown>;
  onChange: (patch: { type: DueDateType; config: Record<string, unknown> }) => void;
  steps?: Array<Pick<TemplateStep, "id" | "stepNumber" | "name">>;
  stages?: Array<Pick<TemplateStage, "id" | "name">>;
  dateFields?: Array<Pick<CustomFieldDefinition, "id" | "fieldLabel" | "fieldType">>;
  compact?: boolean;
};

export default function DueDateEditor({
  type,
  config,
  onChange,
  steps = [],
  stages = [],
  dateFields = [],
  compact,
}: Props) {
  const n = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" ? Number(v) : 0);
  const s = (v: unknown) => (typeof v === "string" ? v : "");

  const setType = (t: DueDateType) => {
    const defaults: Record<string, unknown> = {};
    if (t === "offset_from_start") defaults.days = 0;
    if (t === "offset_from_step" || t === "offset_from_stage") defaults.days = 1;
    if (t === "offset_from_field") {
      defaults.days = 0;
      defaults.direction = "after";
    }
    onChange({ type: t, config: defaults });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
      <select
        className={styles.input}
        value={type}
        onChange={(e) => setType(e.target.value as DueDateType)}
        style={compact ? { fontSize: "0.82rem" } : undefined}
      >
        {(Object.keys(DUE_DATE_TYPE_LABELS) as DueDateType[]).map((t) => (
          <option key={t} value={t}>
            {DUE_DATE_TYPE_LABELS[t]}
          </option>
        ))}
      </select>
      {type === "offset_from_start" || type === "offset_from_step" || type === "offset_from_stage" ? (
        <div style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
          <input
            type="number"
            className={styles.input}
            style={{ width: 80 }}
            value={n(config.days)}
            onChange={(e) => onChange({ type, config: { ...config, days: Number(e.target.value) || 0 } })}
          />
          <span style={{ fontSize: "0.82rem", color: "#6a737b" }}>days</span>
        </div>
      ) : null}
      {type === "offset_from_step" || type === "same_day_as_step" ? (
        <select
          className={styles.input}
          value={s(config.stepId)}
          onChange={(e) =>
            onChange({ type, config: { ...config, stepId: e.target.value ? Number(e.target.value) : null } })
          }
        >
          <option value="">— Select step —</option>
          {steps.map((st) => (
            <option key={st.id} value={st.id}>
              Step {st.stepNumber}: {st.name}
            </option>
          ))}
        </select>
      ) : null}
      {type === "offset_from_stage" ? (
        <select
          className={styles.input}
          value={s(config.stageId)}
          onChange={(e) =>
            onChange({ type, config: { ...config, stageId: e.target.value ? Number(e.target.value) : null } })
          }
        >
          <option value="">— Select stage —</option>
          {stages.map((st) => (
            <option key={st.id} value={st.id}>
              {st.name}
            </option>
          ))}
        </select>
      ) : null}
      {type === "offset_from_field" ? (
        <>
          <select
            className={styles.input}
            value={s(config.fieldDefinitionId)}
            onChange={(e) =>
              onChange({
                type,
                config: { ...config, fieldDefinitionId: e.target.value ? Number(e.target.value) : null },
              })
            }
          >
            <option value="">— Select date field —</option>
            {dateFields
              .filter((f) => f.fieldType === "date" || f.fieldType === "datetime")
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.fieldLabel}
                </option>
              ))}
          </select>
          <div style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
            <input
              type="number"
              className={styles.input}
              style={{ width: 80 }}
              value={n(config.days)}
              onChange={(e) => onChange({ type, config: { ...config, days: Number(e.target.value) || 0 } })}
            />
            <select
              className={styles.input}
              value={s(config.direction) || "after"}
              onChange={(e) => onChange({ type, config: { ...config, direction: e.target.value } })}
            >
              <option value="before">days before</option>
              <option value="after">days after</option>
            </select>
          </div>
        </>
      ) : null}
      {type === "fixed_date" ? (
        <input
          type="date"
          className={styles.input}
          value={s(config.date)}
          onChange={(e) => onChange({ type, config: { ...config, date: e.target.value } })}
        />
      ) : null}
    </div>
  );
}
