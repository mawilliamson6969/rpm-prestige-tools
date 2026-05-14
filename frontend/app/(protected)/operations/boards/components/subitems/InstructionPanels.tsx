"use client";

import { useCallback, useState } from "react";
import styles from "./subitems.module.css";
import { resolveHtml, resolvePlain, availableVariables } from "./variables";
import RichEditorLite from "./RichEditorLite";
import type {
  InstructionsBlob,
  InstructionStepBlock,
  InstructionDecisionRow,
  InstructionEmailTemplate,
  InstructionSmsTemplate,
  InstructionChecklistItem,
  InstructionResource,
  SubitemVariableMap,
  ChecklistStateEntry,
} from "@/types/mb";

/* ============================================================
   Common helpers
   ============================================================ */

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function VariablePicker({
  vars,
  onInsert,
}: {
  vars: SubitemVariableMap | null;
  onInsert: (token: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { itemKeys, subitemKeys } = availableVariables(vars);
  const totalCount = itemKeys.length + subitemKeys.length;
  if (totalCount === 0) return null;
  return (
    <span className={styles.varPickerWrap}>
      <button
        type="button"
        className={styles.varPickerToggle}
        onClick={() => setOpen((v) => !v)}
      >
        + Variable
      </button>
      {open ? (
        <div className={styles.varPickerMenu}>
          {itemKeys.length > 0 ? (
            <>
              <div className={styles.varGroup}>From parent item</div>
              {itemKeys.map((v) => (
                <button
                  type="button"
                  key={v.key}
                  className={styles.varItem}
                  onClick={() => {
                    setOpen(false);
                    onInsert(`{{${v.key}}}`);
                  }}
                >
                  <div>{v.label}</div>
                  <div className={styles.varItemKey}>{`{{${v.key}}}`}</div>
                </button>
              ))}
            </>
          ) : null}
          {subitemKeys.length > 0 ? (
            <>
              <div className={styles.varGroup}>From this subitem</div>
              {subitemKeys.map((v) => (
                <button
                  type="button"
                  key={v.key}
                  className={styles.varItem}
                  onClick={() => {
                    setOpen(false);
                    onInsert(`{{${v.key}}}`);
                  }}
                >
                  <div>{v.label}</div>
                  <div className={styles.varItemKey}>{`{{${v.key}}}`}</div>
                </button>
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function doCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback for browsers without clipboard API.
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } finally {
        document.body.removeChild(ta);
      }
    }
  }
  return (
    <button
      type="button"
      className={`${styles.copyBtn} ${copied ? styles.copySuccess : ""}`}
      onClick={doCopy}
    >
      {copied ? "✓ Copied" : label}
    </button>
  );
}

/* ============================================================
   1. Objective
   ============================================================ */

export function ObjectivePanel({
  content,
  vars,
  editable,
  onSave,
}: {
  content?: InstructionsBlob["objective"];
  vars: SubitemVariableMap | null;
  editable: boolean;
  onSave?: (next: { text: string }) => void;
}) {
  const text = content?.text ?? "";
  const [draft, setDraft] = useState(text);

  if (!editable) {
    if (!text.trim()) return <div className={styles.instrEmpty}>No objective set.</div>;
    return (
      <p
        className={styles.instrText}
        dangerouslySetInnerHTML={{ __html: resolveHtml(escapeOuter(text), vars, styles.missingVar) }}
      />
    );
  }
  return (
    <div>
      <textarea
        className={styles.input}
        rows={3}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== text) onSave?.({ text: draft });
        }}
        placeholder="What's the purpose of this subitem? One short paragraph."
      />
      <div className={styles.checklistProgress}>
        Use <code>{`{{item.column_name}}`}</code> or{" "}
        <code>{`{{subitem.column_name}}`}</code> for variable substitution.
      </div>
    </div>
  );
}

function escapeOuter(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

/* ============================================================
   2. Step-by-step
   ============================================================ */

export function StepsPanel({
  content,
  vars,
  editable,
  onSave,
}: {
  content?: InstructionsBlob["steps"];
  vars: SubitemVariableMap | null;
  editable: boolean;
  onSave?: (next: { steps: InstructionStepBlock[] }) => void;
}) {
  const steps = content?.steps ?? [];

  if (!editable) {
    if (steps.length === 0)
      return <div className={styles.instrEmpty}>No steps yet.</div>;
    return (
      <ol className={styles.stepList}>
        {steps.map((s, i) => (
          <li key={s.id} className={styles.stepRow}>
            <span className={styles.stepNumber}>{i + 1}.</span>
            {s.has_checkbox ? (
              <input type="checkbox" disabled style={{ marginTop: 4 }} />
            ) : null}
            <div
              className={styles.instrText}
              style={{ flex: 1 }}
              dangerouslySetInnerHTML={{
                __html: resolveHtml(s.text_html || "", vars, styles.missingVar),
              }}
            />
          </li>
        ))}
      </ol>
    );
  }

  function update(next: InstructionStepBlock[]) {
    onSave?.({ steps: next });
  }

  function setStep(idx: number, patch: Partial<InstructionStepBlock>) {
    const next = steps.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    update(next);
  }

  function move(idx: number, delta: number) {
    const target = idx + delta;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    const [moved] = next.splice(idx, 1);
    next.splice(target, 0, moved);
    next.forEach((s, i) => (s.position = i + 1));
    update(next);
  }

  function remove(idx: number) {
    const next = steps.filter((_, i) => i !== idx);
    next.forEach((s, i) => (s.position = i + 1));
    update(next);
  }

  function add() {
    const next: InstructionStepBlock[] = [
      ...steps,
      {
        id: uid("s"),
        text_html: "",
        text_plain: "",
        has_checkbox: false,
        position: steps.length + 1,
      },
    ];
    update(next);
  }

  return (
    <div>
      {steps.map((s, i) => (
        <div key={s.id} style={{ marginBottom: "0.6rem" }}>
          <div className={styles.inlineRow}>
            <span className={styles.stepNumber}>{i + 1}.</span>
            <label style={{ fontSize: "0.78rem", color: "#6a737b" }}>
              <input
                type="checkbox"
                checked={s.has_checkbox}
                onChange={(e) => setStep(i, { has_checkbox: e.target.checked })}
                style={{ marginRight: "0.25rem" }}
              />
              Show checkbox
            </label>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              className={styles.tinyBtn}
              onClick={() => move(i, -1)}
              disabled={i === 0}
              aria-label="Move up"
            >
              ↑
            </button>
            <button
              type="button"
              className={styles.tinyBtn}
              onClick={() => move(i, +1)}
              disabled={i === steps.length - 1}
              aria-label="Move down"
            >
              ↓
            </button>
            <button
              type="button"
              className={styles.removeBtn}
              onClick={() => remove(i)}
            >
              Remove
            </button>
          </div>
          <RichEditorLite
            valueHtml={s.text_html}
            placeholder="Step description (Cmd/Ctrl+B for bold, +I for italic)"
            onChange={(html, text) =>
              setStep(i, { text_html: html, text_plain: text })
            }
          />
        </div>
      ))}
      <button type="button" className={styles.tinyBtn} onClick={add}>
        + Add step
      </button>
    </div>
  );
}

/* ============================================================
   3. Decision matrix
   ============================================================ */

export function DecisionMatrixPanel({
  content,
  editable,
  onSave,
}: {
  content?: InstructionsBlob["decision_matrix"];
  editable: boolean;
  onSave?: (next: { rows: InstructionDecisionRow[] }) => void;
}) {
  const rows = content?.rows ?? [];

  if (!editable) {
    if (rows.length === 0)
      return <div className={styles.instrEmpty}>No decision matrix.</div>;
    return (
      <ul className={styles.matrixList}>
        {rows.map((r) => (
          <li key={r.id} className={styles.matrixRow}>
            <div className={styles.matrixCondition}>{r.condition}</div>
            <div className={styles.matrixAction}>{r.action}</div>
          </li>
        ))}
      </ul>
    );
  }

  function update(next: InstructionDecisionRow[]) {
    onSave?.({ rows: next });
  }
  function setRow(idx: number, patch: Partial<InstructionDecisionRow>) {
    update(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function remove(idx: number) {
    const next = rows.filter((_, i) => i !== idx);
    next.forEach((r, i) => (r.position = i + 1));
    update(next);
  }
  function add() {
    update([
      ...rows,
      { id: uid("d"), condition: "", action: "", position: rows.length + 1 },
    ]);
  }

  return (
    <div>
      {rows.map((r, i) => (
        <div key={r.id} className={styles.inlineRow}>
          <input
            className={styles.input}
            placeholder="If…"
            value={r.condition}
            onChange={(e) => setRow(i, { condition: e.target.value })}
          />
          <input
            className={styles.input}
            placeholder="Then…"
            value={r.action}
            onChange={(e) => setRow(i, { action: e.target.value })}
          />
          <button
            type="button"
            className={styles.removeBtn}
            onClick={() => remove(i)}
          >
            ✕
          </button>
        </div>
      ))}
      <button type="button" className={styles.tinyBtn} onClick={add}>
        + Add row
      </button>
    </div>
  );
}

/* ============================================================
   4. Email templates
   ============================================================ */

export function EmailTemplatesPanel({
  content,
  vars,
  editable,
  onSave,
}: {
  content?: InstructionsBlob["email_templates"];
  vars: SubitemVariableMap | null;
  editable: boolean;
  onSave?: (next: { templates: InstructionEmailTemplate[] }) => void;
}) {
  const templates = content?.templates ?? [];

  if (!editable) {
    if (templates.length === 0)
      return <div className={styles.instrEmpty}>No email templates.</div>;
    return (
      <div className={styles.emailList}>
        {templates.map((t) => (
          <EmailTemplateView key={t.id} template={t} vars={vars} />
        ))}
      </div>
    );
  }

  function update(next: InstructionEmailTemplate[]) {
    onSave?.({ templates: next });
  }
  function setT(idx: number, patch: Partial<InstructionEmailTemplate>) {
    update(templates.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  }
  function remove(idx: number) {
    update(templates.filter((_, i) => i !== idx));
  }
  function add() {
    update([
      ...templates,
      {
        id: uid("e"),
        name: "Untitled email",
        subject: "",
        body_html: "",
        body_plain: "",
      },
    ]);
  }

  return (
    <div className={styles.emailList}>
      {templates.map((t, i) => (
        <div key={t.id} className={styles.emailCard}>
          <div className={styles.inlineRow}>
            <input
              className={styles.input}
              value={t.name}
              onChange={(e) => setT(i, { name: e.target.value })}
              placeholder="Template name"
            />
            <button
              type="button"
              className={styles.removeBtn}
              onClick={() => remove(i)}
            >
              Remove
            </button>
          </div>
          <div className={styles.inlineRow}>
            <input
              className={styles.input}
              value={t.subject}
              onChange={(e) => setT(i, { subject: e.target.value })}
              placeholder="Subject (supports {{variables}})"
            />
            <VariablePicker
              vars={vars}
              onInsert={(tok) => setT(i, { subject: t.subject + tok })}
            />
          </div>
          <div style={{ position: "relative" }}>
            <RichEditorLite
              valueHtml={t.body_html}
              placeholder="Email body (supports rich-text-lite + {{variables}})"
              minHeight={120}
              onChange={(html, text) =>
                setT(i, { body_html: html, body_plain: text })
              }
              onInsertVariableRequest={(insert) => {
                // attach a button-driven insert hook via the picker below
                (t as { _insert?: (tok: string) => void })._insert = insert;
              }}
            />
            <div style={{ marginTop: "0.3rem" }}>
              <VariablePicker
                vars={vars}
                onInsert={(tok) => {
                  const insert = (t as { _insert?: (tok: string) => void })._insert;
                  if (insert) insert(tok);
                  else setT(i, { body_html: t.body_html + tok });
                }}
              />
            </div>
          </div>
        </div>
      ))}
      <button type="button" className={styles.tinyBtn} onClick={add}>
        + Add email template
      </button>
    </div>
  );
}

function EmailTemplateView({
  template,
  vars,
}: {
  template: InstructionEmailTemplate;
  vars: SubitemVariableMap | null;
}) {
  const resolvedSubject = resolvePlain(template.subject || "", vars);
  const resolvedBodyHtml = resolveHtml(template.body_html || "", vars, styles.missingVar);
  const resolvedBodyPlain = resolvePlain(template.body_plain || "", vars);
  return (
    <div className={styles.emailCard}>
      <div className={styles.emailHead}>
        <div className={styles.emailName}>{template.name}</div>
        <CopyButton text={resolvedSubject} label="Copy subject" />
        <CopyButton text={resolvedBodyPlain} label="Copy body" />
      </div>
      <div className={styles.emailSubject}>Subject: {resolvedSubject}</div>
      <div
        className={styles.emailBody}
        dangerouslySetInnerHTML={{ __html: resolvedBodyHtml }}
      />
    </div>
  );
}

/* ============================================================
   5. SMS templates
   ============================================================ */

export function SmsTemplatesPanel({
  content,
  vars,
  editable,
  onSave,
}: {
  content?: InstructionsBlob["sms_templates"];
  vars: SubitemVariableMap | null;
  editable: boolean;
  onSave?: (next: { templates: InstructionSmsTemplate[] }) => void;
}) {
  const templates = content?.templates ?? [];

  if (!editable) {
    if (templates.length === 0)
      return <div className={styles.instrEmpty}>No SMS templates.</div>;
    return (
      <div className={styles.smsList}>
        {templates.map((t) => {
          const resolved = resolvePlain(t.body || "", vars);
          return (
            <div key={t.id} className={styles.smsCard}>
              <div className={styles.smsHead}>
                <div className={styles.emailName}>{t.name}</div>
                <CopyButton text={resolved} label="Copy SMS" />
              </div>
              <div
                className={styles.emailBody}
                dangerouslySetInnerHTML={{
                  __html: resolveHtml(escapeOuter(t.body || ""), vars, styles.missingVar),
                }}
              />
            </div>
          );
        })}
      </div>
    );
  }

  function update(next: InstructionSmsTemplate[]) {
    onSave?.({ templates: next });
  }
  function setT(idx: number, patch: Partial<InstructionSmsTemplate>) {
    update(templates.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  }
  function remove(idx: number) {
    update(templates.filter((_, i) => i !== idx));
  }
  function add() {
    update([...templates, { id: uid("sm"), name: "Untitled SMS", body: "" }]);
  }

  return (
    <div className={styles.smsList}>
      {templates.map((t, i) => (
        <div key={t.id} className={styles.smsCard}>
          <div className={styles.inlineRow}>
            <input
              className={styles.input}
              value={t.name}
              onChange={(e) => setT(i, { name: e.target.value })}
              placeholder="Template name"
            />
            <button
              type="button"
              className={styles.removeBtn}
              onClick={() => remove(i)}
            >
              Remove
            </button>
          </div>
          <textarea
            className={styles.input}
            rows={3}
            value={t.body}
            onChange={(e) => setT(i, { body: e.target.value })}
            placeholder="SMS body — plain text only, supports {{variables}}"
          />
          <div style={{ marginTop: "0.3rem" }}>
            <VariablePicker
              vars={vars}
              onInsert={(tok) => setT(i, { body: t.body + tok })}
            />
          </div>
        </div>
      ))}
      <button type="button" className={styles.tinyBtn} onClick={add}>
        + Add SMS template
      </button>
    </div>
  );
}

/* ============================================================
   6. Escalation triggers
   ============================================================ */

export function EscalationsPanel({
  content,
  editable,
  onSave,
}: {
  content?: InstructionsBlob["escalations"];
  editable: boolean;
  onSave?: (next: { text_html: string; text_plain: string }) => void;
}) {
  const html = content?.text_html ?? "";
  if (!editable) {
    if (!html.trim()) {
      return <div className={styles.instrEmpty}>No escalation triggers set.</div>;
    }
    return (
      <div
        className={styles.instrText}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return (
    <RichEditorLite
      valueHtml={html}
      placeholder="When and how to escalate"
      onChange={(h, t) => onSave?.({ text_html: h, text_plain: t })}
    />
  );
}

/* ============================================================
   7. Completion checklist
   ============================================================ */

export function CompletionChecklistPanel({
  content,
  state,
  editable,
  onSave,
  onToggleCheck,
}: {
  content?: InstructionsBlob["completion_checklist"];
  state?: Record<string, ChecklistStateEntry>;
  editable: boolean;
  onSave?: (next: { items: InstructionChecklistItem[] }) => void;
  onToggleCheck?: (checklistItemId: string, next: boolean) => Promise<void> | void;
}) {
  const items = content?.items ?? [];

  if (!editable) {
    if (items.length === 0)
      return <div className={styles.instrEmpty}>No completion checklist.</div>;
    const total = items.filter((i) => i.is_required).length;
    const done = items.filter(
      (i) => i.is_required && state?.[i.id]?.is_checked === true
    ).length;
    return (
      <div>
        <ul className={styles.checklistList}>
          {items.map((it) => {
            const checked = state?.[it.id]?.is_checked === true;
            return (
              <li key={it.id} className={styles.checklistRow}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => onToggleCheck?.(it.id, e.target.checked)}
                />
                <span
                  className={`${styles.checklistLabel} ${checked ? styles.checklistLabelDone : ""}`}
                >
                  {it.label}
                  {it.is_required ? (
                    <span className={styles.requiredMark}>required</span>
                  ) : (
                    <span className={styles.optionalMark}>optional</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        {total > 0 ? (
          <div className={styles.checklistProgress}>
            {done} of {total} required complete
          </div>
        ) : null}
      </div>
    );
  }

  function update(next: InstructionChecklistItem[]) {
    onSave?.({ items: next });
  }
  function setItem(idx: number, patch: Partial<InstructionChecklistItem>) {
    update(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function move(idx: number, delta: number) {
    const target = idx + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(idx, 1);
    next.splice(target, 0, moved);
    next.forEach((it, i) => (it.position = i + 1));
    update(next);
  }
  function remove(idx: number) {
    const next = items.filter((_, i) => i !== idx);
    next.forEach((it, i) => (it.position = i + 1));
    update(next);
  }
  function add() {
    update([
      ...items,
      {
        id: uid("c"),
        label: "",
        is_required: false,
        position: items.length + 1,
      },
    ]);
  }

  return (
    <div>
      {items.map((it, i) => (
        <div key={it.id} className={styles.inlineRow}>
          <input
            className={styles.input}
            value={it.label}
            onChange={(e) => setItem(i, { label: e.target.value })}
            placeholder="Checklist label"
          />
          <label style={{ fontSize: "0.8rem", color: "#6a737b" }}>
            <input
              type="checkbox"
              checked={it.is_required}
              onChange={(e) => setItem(i, { is_required: e.target.checked })}
              style={{ marginRight: "0.3rem" }}
            />
            Required
          </label>
          <button
            type="button"
            className={styles.tinyBtn}
            onClick={() => move(i, -1)}
            disabled={i === 0}
          >
            ↑
          </button>
          <button
            type="button"
            className={styles.tinyBtn}
            onClick={() => move(i, +1)}
            disabled={i === items.length - 1}
          >
            ↓
          </button>
          <button
            type="button"
            className={styles.removeBtn}
            onClick={() => remove(i)}
          >
            ✕
          </button>
        </div>
      ))}
      <button type="button" className={styles.tinyBtn} onClick={add}>
        + Add check
      </button>
    </div>
  );
}

/* ============================================================
   8. Related resources
   ============================================================ */

export function RelatedResourcesPanel({
  content,
  editable,
  onSave,
}: {
  content?: InstructionsBlob["related_resources"];
  editable: boolean;
  onSave?: (next: { resources: InstructionResource[] }) => void;
}) {
  const resources = content?.resources ?? [];

  if (!editable) {
    if (resources.length === 0)
      return <div className={styles.instrEmpty}>No related resources.</div>;
    return (
      <ul className={styles.resourceList}>
        {resources.map((r) => (
          <li key={r.id}>
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.resourceLink}
            >
              🔗 {r.label}
            </a>
          </li>
        ))}
      </ul>
    );
  }

  function update(next: InstructionResource[]) {
    onSave?.({ resources: next });
  }
  function setR(idx: number, patch: Partial<InstructionResource>) {
    update(resources.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function remove(idx: number) {
    const next = resources.filter((_, i) => i !== idx);
    next.forEach((r, i) => (r.position = i + 1));
    update(next);
  }
  function add() {
    update([
      ...resources,
      { id: uid("r"), label: "", url: "", position: resources.length + 1 },
    ]);
  }

  return (
    <div>
      {resources.map((r, i) => (
        <div key={r.id} className={styles.inlineRow}>
          <input
            className={styles.input}
            value={r.label}
            onChange={(e) => setR(i, { label: e.target.value })}
            placeholder="Label"
          />
          <input
            className={styles.input}
            value={r.url}
            onChange={(e) => setR(i, { url: e.target.value })}
            placeholder="https://…"
          />
          <button
            type="button"
            className={styles.removeBtn}
            onClick={() => remove(i)}
          >
            ✕
          </button>
        </div>
      ))}
      <button type="button" className={styles.tinyBtn} onClick={add}>
        + Add resource
      </button>
    </div>
  );
}

/* ============================================================
   Accordion wrapper
   ============================================================ */

export function InstructionAccordion({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  return (
    <div className={styles.accordionItem}>
      <div
        className={styles.accordionHead}
        onClick={toggle}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
      >
        <span
          className={styles.expandCaret}
          style={open ? { transform: "rotate(90deg)" } : undefined}
        />
        {title}
      </div>
      {open ? <div className={styles.accordionBody}>{children}</div> : null}
    </div>
  );
}
