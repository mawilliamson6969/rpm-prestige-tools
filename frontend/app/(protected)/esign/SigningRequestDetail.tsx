"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../context/AuthContext";
import { apiUrl } from "../../../lib/api";
import styles from "./esign.module.css";

type Submitter = {
  email?: string;
  name?: string;
  role?: string;
  status?: string;
  sent_at?: string | null;
  opened_at?: string | null;
  completed_at?: string | null;
  declined_at?: string | null;
};

type DetailResponse = {
  id: number;
  template_id: number | null;
  template_name: string | null;
  process_id: number | null;
  property_name: string | null;
  signers: unknown;
  prefill_fields: Record<string, unknown> | null;
  status: string;
  signed_document_url: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  docusealDetails?: {
    submitters?: Submitter[];
    documents?: Array<{ name?: string; url?: string }>;
    audit_log_url?: string | null;
  } | null;
};

type DocumentRef = { name?: string; url?: string };

type Props = {
  requestId: number;
  onClose: () => void;
  onChange: () => void;
};

function fmt(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return "—";
  }
}

function timelineFor(status: string, submitters: Submitter[]) {
  const created = true;
  const sent = ["sent", "viewed", "completed", "declined"].includes(status) || submitters.some((s) => s.sent_at);
  const viewed = ["viewed", "completed"].includes(status) || submitters.some((s) => s.opened_at);
  const signed = status === "completed" || submitters.every((s) => s.completed_at);
  return [
    { key: "created", label: "Created", state: created ? "done" : "idle" },
    { key: "sent", label: "Sent", state: sent ? "done" : status === "pending" ? "active" : "idle" },
    { key: "viewed", label: "Viewed", state: viewed ? "done" : sent ? "active" : "idle" },
    { key: "signed", label: "Signed", state: signed ? "done" : viewed ? "active" : "idle" },
  ];
}

export default function SigningRequestDetail({ requestId, onClose, onChange }: Props) {
  const { authHeaders } = useAuth();
  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocumentRef[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(`/esign/requests/${requestId}/status`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : `Request failed (${res.status})`);
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load request.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, requestId]);

  useEffect(() => {
    load();
  }, [load]);

  const onResend = async () => {
    setBusy("resend");
    try {
      const res = await fetch(apiUrl(`/esign/requests/${requestId}/resend`), {
        method: "POST",
        headers: { ...authHeaders() },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body.error === "string" ? body.error : `Resend failed (${res.status})`);
      }
      await load();
      onChange();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Resend failed.");
    } finally {
      setBusy(null);
    }
  };

  const onCancel = async () => {
    if (!confirm("Cancel this signing request? Pending signers will no longer be able to sign.")) return;
    setBusy("cancel");
    try {
      const res = await fetch(apiUrl(`/esign/requests/${requestId}`), {
        method: "DELETE",
        headers: { ...authHeaders() },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body.error === "string" ? body.error : `Cancel failed (${res.status})`);
      }
      onChange();
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Cancel failed.");
    } finally {
      setBusy(null);
    }
  };

  const onDownload = async () => {
    setBusy("download");
    try {
      const res = await fetch(apiUrl(`/esign/requests/${requestId}/download`), {
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : `Download failed (${res.status})`);
      setDocs(Array.isArray(body.documents) ? body.documents : []);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setBusy(null);
    }
  };

  const submitters: Submitter[] = data?.docusealDetails?.submitters ?? [];
  const timeline = data ? timelineFor(data.status, submitters) : [];

  return (
    <>
      <div className={styles.detailBackdrop} onClick={onClose} aria-hidden="true" />
      <aside className={styles.detailPanel} role="dialog" aria-modal="true">
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Signing Request Detail</h2>
          <button type="button" className={styles.miniBtn} onClick={onClose}>
            Close
          </button>
        </div>

        {loading && <p>Loading…</p>}
        {error && (
          <div className={styles.empty}>
            <p>{error}</p>
            <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={load}>
              Retry
            </button>
          </div>
        )}

        {data && (
          <>
            <div style={{ marginBottom: "0.5rem" }}>
              <div style={{ fontWeight: 700, color: "#1b2856", fontSize: "1.05rem" }}>
                {data.template_name || `Template ${data.template_id ?? "—"}`}
              </div>
              {data.property_name && (
                <div style={{ color: "#6a737b", fontSize: "0.85rem" }}>{data.property_name}</div>
              )}
            </div>

            <div className={styles.timeline}>
              {timeline.map((t) => (
                <div
                  key={t.key}
                  className={`${styles.timelineStep} ${
                    t.state === "done"
                      ? styles.timelineStepDone
                      : t.state === "active"
                      ? styles.timelineStepActive
                      : ""
                  }`}
                >
                  {t.label}
                </div>
              ))}
            </div>

            <h3 style={{ margin: "0.75rem 0 0.5rem", fontSize: "0.95rem", color: "#1b2856" }}>Signers</h3>
            {submitters.length === 0 && (
              <p style={{ color: "#6a737b", fontSize: "0.85rem" }}>
                Docuseal hasn&apos;t reported per-signer status yet.
              </p>
            )}
            {submitters.map((s, i) => (
              <div
                key={`${s.email}-${i}`}
                style={{
                  border: "1px solid rgba(27, 40, 86, 0.08)",
                  borderRadius: "10px",
                  padding: "0.7rem",
                  marginBottom: "0.5rem",
                }}
              >
                <div style={{ fontWeight: 600, color: "#1b2856" }}>
                  {s.name || s.email}
                  {s.role ? ` · ${s.role}` : ""}
                </div>
                <div style={{ fontSize: "0.8rem", color: "#6a737b" }}>{s.email}</div>
                <div style={{ fontSize: "0.78rem", color: "#6a737b", marginTop: "0.25rem" }}>
                  Sent: {fmt(s.sent_at)} · Opened: {fmt(s.opened_at)} · Completed: {fmt(s.completed_at)}
                  {s.declined_at ? ` · Declined: ${fmt(s.declined_at)}` : ""}
                </div>
              </div>
            ))}

            {data.prefill_fields && Object.keys(data.prefill_fields).length > 0 && (
              <>
                <h3 style={{ margin: "0.75rem 0 0.5rem", fontSize: "0.95rem", color: "#1b2856" }}>
                  Pre-filled fields
                </h3>
                <ul style={{ margin: "0 0 0.5rem 1rem", color: "#1b2856", fontSize: "0.85rem" }}>
                  {Object.entries(data.prefill_fields).map(([k, v]) => (
                    <li key={k}>
                      {k}: {String(v)}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {data.process_id && (
              <p style={{ marginTop: "0.5rem" }}>
                <a
                  className={styles.processLink}
                  href={`/operations/processes?card=${data.process_id}`}
                >
                  View linked process →
                </a>
              </p>
            )}

            {docs.length > 0 && (
              <>
                <h3 style={{ margin: "0.75rem 0 0.5rem", fontSize: "0.95rem", color: "#1b2856" }}>
                  Signed documents
                </h3>
                <ul style={{ margin: "0 0 0.5rem 1rem" }}>
                  {docs.map((d, i) => (
                    <li key={i}>
                      <a href={d.url} target="_blank" rel="noreferrer">
                        {d.name || d.url || `Document ${i + 1}`}
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "1rem" }}>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={onDownload}
                disabled={busy !== null}
              >
                {busy === "download" ? "Loading…" : "Download signed PDF"}
              </button>
              {data.status !== "completed" && data.status !== "cancelled" && (
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnGhost}`}
                  onClick={onResend}
                  disabled={busy !== null}
                >
                  {busy === "resend" ? "Resending…" : "Resend"}
                </button>
              )}
              {data.status !== "cancelled" && data.status !== "completed" && (
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnDanger}`}
                  onClick={onCancel}
                  disabled={busy !== null}
                >
                  Cancel
                </button>
              )}
            </div>
          </>
        )}
      </aside>
    </>
  );
}
