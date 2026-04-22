"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../../forms.module.css";
import { apiUrl } from "../../../../../lib/api";
import { useAuth } from "../../../../../context/AuthContext";
import type { FormSummary } from "../../types";

type Distribution = {
  id: number;
  recipient_email: string;
  recipient_name: string | null;
  status: string;
  sent_at: string;
  opened_at: string | null;
  submitted_at: string | null;
  error_message: string | null;
  source: string | null;
};

type Recipient = { email: string; name: string; propertyId?: string; propertyName?: string };

export default function DistributionPanel({ form }: { form: FormSummary }) {
  const { authHeaders, token } = useAuth();
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [emailDraft, setEmailDraft] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [subject, setSubject] = useState(`Please complete: ${form.name}`);
  const [message, setMessage] = useState(
    "Hi {{name}},\n\nPlease take a moment to complete the form at the link below.\n\nThank you,\nRPM Prestige\n\n{{link}}"
  );
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [history, setHistory] = useState<Distribution[]>([]);
  const [stats, setStats] = useState({ total: 0, sent: 0, opened: 0, submitted: 0 });

  const loadHistory = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl(`/forms/${form.id}/distributions`), {
        headers: { ...authHeaders() }, cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setHistory(body.distributions || []);
        setStats(body.stats || { total: 0, sent: 0, opened: 0, submitted: 0 });
      }
    } catch {/* ignore */}
  }, [form.id, authHeaders, token]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const addRecipient = () => {
    const email = emailDraft.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    setRecipients([...recipients, { email, name: nameDraft.trim() }]);
    setEmailDraft(""); setNameDraft("");
  };

  const importFrom = async (source: string) => {
    if (!confirm(`Import recipients from: ${source.replace("_", " ")}? This may add many.`)) return;
    setSending(true);
    setErr(null);
    try {
      const res = await fetch(apiUrl(`/forms/${form.id}/distribute/bulk`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ source, subject, message }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Bulk send failed.");
      const sent = (body.results || []).filter((r: { ok: boolean }) => r.ok).length;
      alert(`Sent ${sent} of ${(body.results || []).length}.`);
      await loadHistory();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Bulk send failed.");
    } finally {
      setSending(false);
    }
  };

  const send = async () => {
    if (!recipients.length) { setErr("Add at least one recipient."); return; }
    if (!confirm(`Send to ${recipients.length} recipient${recipients.length === 1 ? "" : "s"}?`)) return;
    setSending(true);
    setErr(null);
    try {
      const res = await fetch(apiUrl(`/forms/${form.id}/distribute`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ channel: "email", recipients, subject, message }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Send failed.");
      const ok = (body.results || []).filter((r: { ok: boolean }) => r.ok).length;
      alert(`Sent ${ok} of ${(body.results || []).length}.`);
      setRecipients([]);
      await loadHistory();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setSending(false);
    }
  };

  const statusClass = (d: Distribution): string => {
    if (d.submitted_at) return styles.distStatusSubmitted;
    if (d.status === "failed") return styles.distStatusFailed;
    if (d.opened_at) return styles.distStatusOpened;
    return styles.distStatusSent;
  };
  const statusLabel = (d: Distribution): string => {
    if (d.submitted_at) return "Submitted";
    if (d.status === "failed") return "Failed";
    if (d.opened_at) return "Opened";
    return "Sent";
  };

  return (
    <div>
      {err ? <div className={styles.errorBanner}>{err}</div> : null}

      <div className={styles.shareSection}>
        <h4>Send to Individuals</h4>
        <div className={styles.distRow} style={{ marginBottom: "0.5rem" }}>
          <input
            type="email"
            placeholder="Email address"
            value={emailDraft}
            onChange={(e) => setEmailDraft(e.target.value)}
          />
          <input
            type="text"
            placeholder="Name (optional)"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
          />
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={addRecipient}>
            Add
          </button>
        </div>
        {recipients.length ? (
          <ul style={{ listStyle: "none", padding: 0, margin: "0.4rem 0" }}>
            {recipients.map((r, i) => (
              <li key={i} style={{ display: "flex", justifyContent: "space-between", padding: "0.3rem 0", fontSize: "0.85rem" }}>
                <span>{r.name ? `${r.name} <${r.email}>` : r.email}</span>
                <button
                  type="button"
                  className={styles.smallBtn}
                  onClick={() => setRecipients(recipients.filter((_, j) => j !== i))}
                >×</button>
              </li>
            ))}
          </ul>
        ) : null}

        <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
          <button type="button" className={styles.smallBtn} onClick={() => importFrom("all_owners")} disabled={sending}>
            Import all owners
          </button>
          <button type="button" className={styles.smallBtn} onClick={() => importFrom("all_tenants")} disabled={sending}>
            Import all current tenants
          </button>
        </div>
      </div>

      <div className={styles.shareSection}>
        <h4>Message</h4>
        <div className={styles.field}>
          <label>Subject</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label>Body</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            style={{ minHeight: 120 }}
          />
          <p className={styles.hint} style={{ fontSize: "0.75rem", color: "#6a737b", margin: "0.25rem 0 0" }}>
            Variables: <code>{"{{name}}"}</code>, <code>{"{{property_name}}"}</code>, <code>{"{{link}}"}</code>, <code>{"{{form_name}}"}</code>
          </p>
        </div>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={send}
          disabled={sending || recipients.length === 0}
          style={{ marginTop: "0.5rem" }}
        >
          {sending ? "Sending…" : `Send to ${recipients.length} recipient${recipients.length === 1 ? "" : "s"}`}
        </button>
      </div>

      <div className={styles.shareSection}>
        <h4>Distribution History</h4>
        <div className={styles.distStats}>
          <div className={styles.distStat}>
            <div className={styles.distStatLabel}>Sent</div>
            <div className={styles.distStatValue}>{stats.total}</div>
          </div>
          <div className={styles.distStat}>
            <div className={styles.distStatLabel}>Opened</div>
            <div className={styles.distStatValue}>{stats.opened}</div>
          </div>
          <div className={styles.distStat}>
            <div className={styles.distStatLabel}>Submitted</div>
            <div className={styles.distStatValue}>{stats.submitted}</div>
          </div>
          <div className={styles.distStat}>
            <div className={styles.distStatLabel}>Open rate</div>
            <div className={styles.distStatValue}>
              {stats.total > 0 ? Math.round((stats.opened / stats.total) * 100) : 0}%
            </div>
          </div>
        </div>
        {history.length ? (
          <table className={styles.subTable} style={{ marginTop: "0.5rem" }}>
            <thead>
              <tr>
                <th>Recipient</th>
                <th>Sent</th>
                <th>Opened</th>
                <th>Submitted</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {history.map((d) => (
                <tr key={d.id}>
                  <td>{d.recipient_name ? `${d.recipient_name} <${d.recipient_email}>` : d.recipient_email}</td>
                  <td>{new Date(d.sent_at).toLocaleDateString()}</td>
                  <td>{d.opened_at ? new Date(d.opened_at).toLocaleDateString() : "—"}</td>
                  <td>{d.submitted_at ? new Date(d.submitted_at).toLocaleDateString() : "—"}</td>
                  <td>
                    <span className={`${styles.distStatus} ${statusClass(d)}`}>
                      {statusLabel(d)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ fontSize: "0.85rem", color: "#6a737b", margin: 0 }}>
            No distributions yet.
          </p>
        )}
      </div>
    </div>
  );
}
