"use client";

import styles from "../../operations.module.css";
import type {
  ProcessEmailTemplate,
  ProcessTextTemplate,
  ProcessTypeRole,
  StepDelayUnit,
  StepRecipientType,
  StepSendTiming,
  StepTaskType,
  TemplateStep,
} from "../../types";

type Props = {
  step: TemplateStep;
  emailTemplates: ProcessEmailTemplate[];
  textTemplates: ProcessTextTemplate[];
  roles: ProcessTypeRole[];
  onChange: (patch: Partial<TemplateStep>) => void;
};

const TASK_TYPES: { value: StepTaskType; label: string; icon: string }[] = [
  { value: "todo", label: "Todo", icon: "✓" },
  { value: "email", label: "Email", icon: "✉" },
  { value: "sms", label: "Text", icon: "💬" },
  { value: "call", label: "Call", icon: "📞" },
];

const RECIPIENT_TYPES: { value: StepRecipientType; label: string }[] = [
  { value: "tenant", label: "Tenant" },
  { value: "owner", label: "Owner" },
  { value: "assigned_role", label: "Assigned role…" },
  { value: "custom_email", label: "Custom email…" },
  { value: "custom_phone", label: "Custom phone…" },
];

export default function StepMessagingConfig({
  step,
  emailTemplates,
  textTemplates,
  roles,
  onChange,
}: Props) {
  const taskType = step.taskType || "todo";
  const isEmail = taskType === "email";
  const isSms = taskType === "sms";

  return (
    <div
      style={{
        marginTop: "0.4rem",
        padding: "0.5rem 0.6rem",
        borderRadius: 8,
        background: "rgba(27, 40, 86, 0.03)",
        border: "1px solid rgba(27, 40, 86, 0.08)",
        display: "flex",
        flexDirection: "column",
        gap: "0.35rem",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", alignItems: "center" }}>
        <span
          style={{
            fontSize: "0.72rem",
            color: "#6a737b",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          Step type
        </span>
        {TASK_TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            className={`${styles.cfChip} ${taskType === t.value ? styles.cfChipActive : ""}`}
            onClick={() => onChange({ taskType: t.value })}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {isEmail || isSms ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem" }}>
          <label className={styles.cfField}>
            <span className={styles.cfLabel}>Template</span>
            <select
              className={styles.cfSelect}
              value={
                isEmail
                  ? step.emailTemplateId ?? ""
                  : step.textTemplateId ?? ""
              }
              onChange={(e) => {
                const v = e.target.value ? Number(e.target.value) : null;
                onChange(
                  isEmail
                    ? { emailTemplateId: v }
                    : { textTemplateId: v }
                );
              }}
            >
              <option value="">— None —</option>
              {(isEmail ? emailTemplates : textTemplates).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.cfField}>
            <span className={styles.cfLabel}>Recipient</span>
            <select
              className={styles.cfSelect}
              value={step.recipientType || "tenant"}
              onChange={(e) =>
                onChange({
                  recipientType: e.target.value as StepRecipientType,
                  recipientValue: null,
                })
              }
            >
              {RECIPIENT_TYPES.filter((r) => {
                if (isSms && r.value === "custom_email") return false;
                if (isEmail && r.value === "custom_phone") return false;
                return true;
              }).map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>

          {step.recipientType === "assigned_role" ? (
            <label className={styles.cfField}>
              <span className={styles.cfLabel}>Which role</span>
              <select
                className={styles.cfSelect}
                value={step.recipientValue || ""}
                onChange={(e) => onChange({ recipientValue: e.target.value || null })}
              >
                <option value="">— Pick role —</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.roleName}>
                    {r.roleName}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {step.recipientType === "custom_email" || step.recipientType === "custom_phone" ? (
            <label className={styles.cfField}>
              <span className={styles.cfLabel}>
                {step.recipientType === "custom_email" ? "Custom email" : "Custom phone"}
              </span>
              <input
                className={styles.cfInput}
                value={step.recipientValue || ""}
                onChange={(e) => onChange({ recipientValue: e.target.value || null })}
                placeholder={
                  step.recipientType === "custom_email"
                    ? "to@example.com"
                    : "+1 281 555 1234"
                }
              />
            </label>
          ) : null}

          <label className={styles.cfField}>
            <span className={styles.cfLabel}>Timing</span>
            <select
              className={styles.cfSelect}
              value={step.sendTiming || "immediately"}
              onChange={(e) =>
                onChange({ sendTiming: e.target.value as StepSendTiming })
              }
            >
              <option value="immediately">Immediately on stage entry</option>
              <option value="delay">Delay…</option>
            </select>
          </label>

          {step.sendTiming === "delay" ? (
            <label className={styles.cfField}>
              <span className={styles.cfLabel}>Delay</span>
              <span style={{ display: "flex", gap: "0.3rem" }}>
                <input
                  type="number"
                  className={styles.cfInput}
                  min={0}
                  value={step.delayAmount ?? 0}
                  onChange={(e) =>
                    onChange({ delayAmount: Number(e.target.value) || 0 })
                  }
                  style={{ width: 80 }}
                />
                <select
                  className={styles.cfSelect}
                  value={step.delayUnit || "days"}
                  onChange={(e) =>
                    onChange({ delayUnit: e.target.value as StepDelayUnit })
                  }
                  style={{ flex: 1 }}
                >
                  <option value="minutes">minutes</option>
                  <option value="hours">hours</option>
                  <option value="days">days</option>
                </select>
              </span>
            </label>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
