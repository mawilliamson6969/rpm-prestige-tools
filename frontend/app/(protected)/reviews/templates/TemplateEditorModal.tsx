"use client";

import { useRef, useState } from "react";
import { useAuth } from "../../../../context/AuthContext";
import { apiUrl } from "../../../../lib/api";
import { type ReviewTemplate } from "../utils";
import styles from "../reviews.module.css";

const VARS = [
  "name",
  "first_name",
  "property_address",
  "company_name",
  "review_url",
  "team_member_name",
];

type Props = {
  template: ReviewTemplate | null;
  onClose: () => void;
  onSaved: () => void;
};

const SAMPLE_VARS: Record<string, string> = {
  name: "Jane Smith",
  first_name: "Jane",
  property_address: "123 Main St, Houston TX",
  company_name: "Real Property Management Prestige",
  review_url: "https://g.page/r/sample/review",
  team_member_name: "Mike Williamson",
};

function renderPreview(body: string) {
  let out = body;
  for (const [k, v] of Object.entries(SAMPLE_VARS)) {
    out = out.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, "g"), v);
  }
  return out;
}

export default function TemplateEditorModal({ template, onClose, onSaved }: Props) {
  const { authHeaders } = useAuth();
  const [name, setName] = useState(template?.name ?? "");
  const [channel, setChannel] = useState<"email" | "sms" | "both">(template?.channel ?? "email");
  const [recipientType, setRecipientType] = useState<string>(template?.recipient_type ?? "tenant");
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [isDefault, setIsDefault] = useState(!!template?.is_default);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const smsLen = channel === "sms" || channel === "both" ? renderPreview(body).length : 0;
  const smsClass =
    smsLen > 160 ? styles.smsCounterOver : smsLen > 140 ? styles.smsCounterWarn : "";

  const insertVar = (v: string) => {
    const el = textareaRef.current;
    const chip = `{{${v}}}`;
    if (!el) {
      setBody((b) => `${b}${chip}`);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + chip + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + chip.length, start + chip.length);
    });
  };

  const onSubmit = async () => {
    setErr(null);
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        channel,
        recipientType,
        subject: channel === "sms" ? null : subject.trim() || null,
        body: body.trim(),
        isDefault,
      };
      const url = template
        ? apiUrl(`/reviews/templates/${template.id}`)
        : apiUrl("/reviews/templates");
      const res = await fetch(url, {
        method: template ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload),
      });
      const bodyJson = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(bodyJson.error || "Save failed.");
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>
            {template ? "Edit Template" : "Create Template"}
          </h2>
          <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className={styles.modalBody}>
          <div className={styles.formRow}>
            <label htmlFor="tn">Template name</label>
            <input
              id="tn"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Post-Maintenance Email"
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" }}>
            <div className={styles.formRow}>
              <label htmlFor="ch">Channel</label>
              <select
                id="ch"
                value={channel}
                onChange={(e) => setChannel(e.target.value as typeof channel)}
              >
                <option value="email">Email</option>
                <option value="sms">SMS</option>
                <option value="both">Both</option>
              </select>
            </div>
            <div className={styles.formRow}>
              <label htmlFor="rt">Recipient type</label>
              <select
                id="rt"
                value={recipientType}
                onChange={(e) => setRecipientType(e.target.value)}
              >
                <option value="tenant">Tenant</option>
                <option value="owner">Owner</option>
                <option value="vendor">Vendor</option>
                <option value="any">Any</option>
              </select>
            </div>
            <div className={styles.formRow}>
              <label>&nbsp;</label>
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  padding: "0.55rem 0.7rem",
                  border: "1px solid rgba(27,40,86,0.15)",
                  borderRadius: 8,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                />
                Set as default
              </label>
            </div>
          </div>

          {channel !== "sms" ? (
            <div className={styles.formRow}>
              <label htmlFor="sb">Subject</label>
              <input
                id="sb"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="How did we do?"
              />
            </div>
          ) : null}

          <div className={styles.formRow}>
            <label htmlFor="bd">Body</label>
            <div className={styles.insertVarBar}>
              {VARS.map((v) => (
                <button
                  key={v}
                  type="button"
                  className={styles.insertVarChip}
                  onClick={() => insertVar(v)}
                >
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
            <textarea
              ref={textareaRef}
              id="bd"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your message. Use variable chips above to insert placeholders."
            />
            {channel === "sms" || channel === "both" ? (
              <div className={`${styles.smsCounter} ${smsClass}`}>
                SMS length: {smsLen} / 160 {smsLen > 160 ? "(multi-part)" : ""}
              </div>
            ) : null}
          </div>

          <div className={styles.formRow}>
            <label>Preview</label>
            <div className={styles.previewBox}>{renderPreview(body) || "(empty)"}</div>
          </div>

          {err ? (
            <div className={styles.insightCallout} style={{ borderColor: "var(--red)", color: "var(--red)" }}>
              {err}
            </div>
          ) : null}
        </div>

        <footer className={styles.modalFooter}>
          <button type="button" className={styles.btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={onSubmit}
            disabled={saving || !name.trim() || !body.trim()}
          >
            {saving ? "Saving…" : template ? "Save Changes" : "Create Template"}
          </button>
        </footer>
      </div>
    </div>
  );
}
