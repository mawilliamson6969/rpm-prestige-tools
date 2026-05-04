"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../../operations.module.css";
import { apiUrl } from "../../../../../lib/api";
import { useAuth } from "../../../../../context/AuthContext";
import type {
  AvailableRecipients,
  ProcessEmailTemplate,
  ProcessTextTemplate,
} from "../../types";

type Props = {
  processId: number;
  templateId: number | null;
  onSent: () => void;
};

type RecipientOption = {
  key: string;
  label: string;
  email?: string | null;
  phone?: string | null;
};

const SMS_LIMIT = 320;

function buildRecipientOptions(
  recipients: AvailableRecipients | null,
  channel: "email" | "sms"
): RecipientOption[] {
  if (!recipients) return [];
  const list: RecipientOption[] = [];
  if (recipients.tenant) {
    const value = channel === "email" ? recipients.tenant.email : recipients.tenant.phone;
    if (value) {
      list.push({
        key: `tenant`,
        label: `Tenant — ${recipients.tenant.name || value}`,
        email: recipients.tenant.email,
        phone: recipients.tenant.phone,
      });
    }
  }
  if (recipients.owner) {
    const value = channel === "email" ? recipients.owner.email : recipients.owner.phone;
    if (value) {
      list.push({
        key: `owner`,
        label: `Owner — ${recipients.owner.name || value}`,
        email: recipients.owner.email,
        phone: recipients.owner.phone,
      });
    }
  }
  for (const role of recipients.roles) {
    if (channel === "email" && role.email) {
      list.push({
        key: `role:${role.role}`,
        label: `${role.role} — ${role.name || role.email}`,
        email: role.email,
      });
    }
  }
  return list;
}

export default function SendComposer({ processId, templateId, onSent }: Props) {
  const { authHeaders, token } = useAuth();
  const [open, setOpen] = useState<"email" | "sms" | null>(null);
  const [emailTemplates, setEmailTemplates] = useState<ProcessEmailTemplate[]>([]);
  const [textTemplates, setTextTemplates] = useState<ProcessTextTemplate[]>([]);
  const [recipients, setRecipients] = useState<AvailableRecipients | null>(null);
  const [pickedTemplateId, setPickedTemplateId] = useState<number | null>(null);
  const [recipientKey, setRecipientKey] = useState<string>("");
  const [customRecipient, setCustomRecipient] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState<{ subject: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    if (!token || !templateId) {
      setEmailTemplates([]);
      setTextTemplates([]);
      return;
    }
    try {
      const [eRes, tRes] = await Promise.all([
        fetch(apiUrl(`/processes/templates/${templateId}/email-templates`), {
          headers: { ...authHeaders() },
          cache: "no-store",
        }),
        fetch(apiUrl(`/processes/templates/${templateId}/text-templates`), {
          headers: { ...authHeaders() },
          cache: "no-store",
        }),
      ]);
      if (eRes.ok) {
        const body = await eRes.json();
        setEmailTemplates(body.templates || []);
      }
      if (tRes.ok) {
        const body = await tRes.json();
        setTextTemplates(body.templates || []);
      }
    } catch {
      /* ignore */
    }
  }, [authHeaders, token, templateId]);

  const loadRecipients = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl(`/processes/${processId}/available-recipients`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = await res.json();
      setRecipients(body);
    } catch {
      /* ignore */
    }
  }, [authHeaders, token, processId]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);
  useEffect(() => {
    loadRecipients();
  }, [loadRecipients]);

  const recipientOptions = useMemo(
    () => buildRecipientOptions(recipients, open === "email" ? "email" : "sms"),
    [recipients, open]
  );

  const reset = () => {
    setPickedTemplateId(null);
    setRecipientKey("");
    setCustomRecipient("");
    setSubject("");
    setBody("");
    setPreview(null);
    setErr(null);
  };

  const startEmail = () => {
    reset();
    setOpen("email");
  };
  const startSms = () => {
    reset();
    setOpen("sms");
  };

  // When a template is picked, hydrate subject/body from it.
  useEffect(() => {
    if (open === "email" && pickedTemplateId != null) {
      const t = emailTemplates.find((x) => x.id === pickedTemplateId);
      if (t) {
        setSubject(t.subject || "");
        setBody(t.bodyHtml || "");
      }
    } else if (open === "sms" && pickedTemplateId != null) {
      const t = textTemplates.find((x) => x.id === pickedTemplateId);
      if (t) setBody(t.body || "");
    }
  }, [open, pickedTemplateId, emailTemplates, textTemplates]);

  const renderPreview = async () => {
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch(apiUrl(`/processes/${processId}/send-template-preview`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          templateId: pickedTemplateId,
          templateType: open === "email" ? "email" : "text",
          subject,
          body,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Preview failed");
      setPreview({ subject: data.resolvedSubject || "", body: data.resolvedBody || "" });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Preview failed.");
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    setErr(null);
    setBusy(true);
    const path = open === "email" ? "send-email" : "send-text";
    try {
      const opt = recipientOptions.find((o) => o.key === recipientKey);
      const to =
        recipientKey === "custom"
          ? customRecipient.trim()
          : open === "email"
          ? opt?.email || ""
          : opt?.phone || "";
      if (!to) {
        throw new Error(
          open === "email" ? "Pick an email recipient." : "Pick a phone recipient."
        );
      }
      const res = await fetch(apiUrl(`/processes/${processId}/${path}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          templateId: pickedTemplateId,
          to,
          subject: open === "email" ? subject : undefined,
          body,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Send failed");
      reset();
      setOpen(null);
      onSent();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={startEmail}
        >
          ✉ Send Email
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnGhost}`}
          onClick={startSms}
        >
          💬 Send Text
        </button>
      </div>
    );
  }

  const channel: "email" | "sms" = open;
  const templates = channel === "email" ? emailTemplates : textTemplates;

  return (
    <div
      style={{
        padding: "0.85rem",
        marginBottom: "1rem",
        border: "1px solid rgba(0, 152, 208, 0.3)",
        background: "rgba(0, 152, 208, 0.04)",
        borderRadius: 8,
        display: "flex",
        flexDirection: "column",
        gap: "0.55rem",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong style={{ color: "#1b2856" }}>
          {channel === "email" ? "Send Email" : "Send Text"}
        </strong>
        <button
          type="button"
          className={`${styles.smallBtn}`}
          onClick={() => {
            reset();
            setOpen(null);
          }}
        >
          Cancel
        </button>
      </div>

      {err ? <div className={styles.errorBanner}>{err}</div> : null}

      <label className={styles.cfField}>
        <span className={styles.cfLabel}>Template</span>
        <select
          className={styles.cfSelect}
          value={pickedTemplateId ?? ""}
          onChange={(e) =>
            setPickedTemplateId(e.target.value ? Number(e.target.value) : null)
          }
        >
          <option value="">— None (write manually) —</option>
          {templates.map((t) => (
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
          value={recipientKey}
          onChange={(e) => setRecipientKey(e.target.value)}
        >
          <option value="">— Pick recipient —</option>
          {recipientOptions.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
          <option value="custom">
            {channel === "email" ? "Custom email…" : "Custom phone…"}
          </option>
        </select>
      </label>

      {recipientKey === "custom" ? (
        <input
          className={styles.cfInput}
          value={customRecipient}
          onChange={(e) => setCustomRecipient(e.target.value)}
          placeholder={channel === "email" ? "to@example.com" : "+1 281 555 1234"}
        />
      ) : null}

      {channel === "email" ? (
        <label className={styles.cfField}>
          <span className={styles.cfLabel}>Subject</span>
          <input
            className={styles.cfInput}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </label>
      ) : null}

      <label className={styles.cfField}>
        <span className={styles.cfLabel}>
          Body
          {channel === "sms"
            ? ` (${body.length} / ${SMS_LIMIT} chars · ${
                Math.max(1, Math.ceil(body.length / 160))
              } segment${body.length > 160 ? "s" : ""})`
            : ""}
        </span>
        <textarea
          className={styles.cfInput}
          rows={channel === "email" ? 8 : 5}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={
            channel === "email"
              ? "Hi {{tenant.first_name}}, …"
              : "Hi {{tenant.first_name}}, this is RPM Prestige…"
          }
          style={{
            resize: "vertical",
            fontFamily: channel === "email" ? "Menlo, monospace" : "inherit",
            fontSize: channel === "email" ? "0.85rem" : "0.92rem",
          }}
        />
      </label>

      {preview ? (
        <div
          style={{
            padding: "0.6rem 0.75rem",
            background: "#fff",
            border: "1px solid rgba(27, 40, 86, 0.1)",
            borderRadius: 6,
          }}
        >
          <div
            style={{
              fontSize: "0.7rem",
              color: "#6a737b",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              marginBottom: "0.3rem",
            }}
          >
            Preview (merge fields resolved)
          </div>
          {channel === "email" && preview.subject ? (
            <div style={{ fontWeight: 700, color: "#1b2856", marginBottom: "0.35rem" }}>
              {preview.subject}
            </div>
          ) : null}
          <div
            style={{
              fontSize: "0.88rem",
              color: "#1b2856",
              whiteSpace: "pre-wrap",
            }}
            dangerouslySetInnerHTML={
              channel === "email" ? { __html: preview.body } : undefined
            }
          >
            {channel === "sms" ? preview.body : null}
          </div>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnGhost}`}
          onClick={renderPreview}
          disabled={busy}
        >
          Preview
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={send}
          disabled={busy}
        >
          {busy ? "Sending…" : channel === "email" ? "Send Email" : "Send Text"}
        </button>
      </div>
    </div>
  );
}
