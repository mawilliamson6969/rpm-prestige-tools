"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "../../../../context/AuthContext";
import { apiUrl } from "../../../../lib/api";
import styles from "../inbox.module.css";

function sanitizePreview(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, "");
}

type Conn = {
  id: number;
  user_id: number;
  email_address: string | null;
  is_active: boolean;
  connected_at: string | null;
  last_sync_at: string | null;
  sync_status?: string | null;
  sync_last_at?: string | null;
  messages_synced?: number | null;
  error_log?: string | null;
};

export default function InboxSettingsClient() {
  const { authHeaders } = useAuth();
  const searchParams = useSearchParams();
  const [connections, setConnections] = useState<Conn[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [signatureDraft, setSignatureDraft] = useState("");
  const [signatureLoading, setSignatureLoading] = useState(true);
  const [signatureSaving, setSignatureSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, sRes] = await Promise.all([
        fetch(apiUrl("/inbox/connections"), {
          cache: "no-store",
          headers: { ...authHeaders() },
        }),
        fetch(apiUrl("/users/me/signature"), {
          cache: "no-store",
          headers: { ...authHeaders() },
        }),
      ]);
      const cBody = await cRes.json().catch(() => ({}));
      const sBody = await sRes.json().catch(() => ({}));
      if (cRes.ok && Array.isArray(cBody.connections)) setConnections(cBody.connections);
      if (sRes.ok && typeof sBody.signatureHtml === "string") setSignatureDraft(sBody.signatureHtml);
      else if (sRes.ok && sBody.signatureHtml === null) setSignatureDraft("");
    } finally {
      setLoading(false);
      setSignatureLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (searchParams.get("connected") === "1") {
      setMsg("Microsoft account connected successfully.");
    }
    const err = searchParams.get("error");
    if (err) {
      setMsg(`Connection issue: ${decodeURIComponent(err)}`);
    }
  }, [searchParams]);

  const connect = async () => {
    const res = await fetch(apiUrl("/inbox/microsoft/authorize-url"), {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.authorizeUrl) {
      window.location.href = body.authorizeUrl as string;
      return;
    }
    setMsg(typeof body.error === "string" ? body.error : "Could not start Microsoft sign-in.");
  };

  const saveSignature = async () => {
    setSignatureSaving(true);
    setMsg(null);
    try {
      const res = await fetch(apiUrl("/users/me/signature"), {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ signatureHtml: signatureDraft }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setMsg("Signature saved.");
        if (typeof body.signatureHtml === "string") setSignatureDraft(body.signatureHtml);
      } else {
        setMsg(typeof body.error === "string" ? body.error : "Could not save signature.");
      }
    } finally {
      setSignatureSaving(false);
    }
  };

  const disconnect = async (id: number) => {
    if (!confirm("Disconnect this mailbox from the shared inbox?")) return;
    const res = await fetch(apiUrl(`/inbox/connections/${id}`), {
      method: "DELETE",
      headers: { ...authHeaders() },
    });
    if (res.ok) load();
    else setMsg("Could not disconnect.");
  };

  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <div>
          <h1>Inbox settings</h1>
          <p style={{ margin: "0.35rem 0 0", color: "#6a737b", fontSize: "0.9rem" }}>
            Connect Outlook so the team can sync and reply from the shared inbox.
          </p>
        </div>
        <Link href="/inbox" className={styles.mutedLink}>
          ← Back to inbox
        </Link>
      </header>

      <div style={{ padding: "1.25rem", maxWidth: 720 }}>
        {msg ? (
          <p
            style={{
              padding: "0.75rem 1rem",
              background: "#e8f7fc",
              border: "1px solid #b8e6f5",
              borderRadius: 8,
              marginBottom: "1rem",
            }}
          >
            {msg}
          </p>
        ) : null}

        <button type="button" className={styles.sendBtn} onClick={connect}>
          Connect Microsoft email
        </button>
        <p style={{ fontSize: "0.85rem", color: "#6a737b", marginTop: "0.75rem" }}>
          You will sign in with Microsoft and grant mail access for sync and replies.
        </p>

        <h2 style={{ fontSize: "1.05rem", marginTop: "2rem" }}>Connected accounts</h2>
        {loading ? <p style={{ color: "#6a737b" }}>Loading…</p> : null}
        {!loading && connections.length === 0 ? (
          <p style={{ color: "#6a737b" }}>No mailboxes connected yet.</p>
        ) : null}
        <ul style={{ listStyle: "none", padding: 0, margin: "1rem 0 0" }}>
          {connections.map((c) => {
            return (
              <li
                key={c.id}
                style={{
                  border: "1px solid #e2e4e8",
                  borderRadius: 8,
                  padding: "1rem",
                  marginBottom: "0.75rem",
                  background: "#fff",
                }}
              >
                <div style={{ fontWeight: 700 }}>{c.email_address || "Unknown email"}</div>
                <div style={{ fontSize: "0.85rem", color: "#6a737b", marginTop: "0.35rem" }}>
                  Status: {c.is_active ? "Active" : "Disconnected"}
                  {c.last_sync_at ? (
                    <>
                      {" "}
                      · Last mailbox sync: {new Date(c.last_sync_at).toLocaleString()}
                    </>
                  ) : null}
                </div>
                <div style={{ fontSize: "0.85rem", color: "#6a737b", marginTop: "0.25rem" }}>
                  Sync job: {c.sync_status || "—"}
                  {c.sync_last_at ? <> · {new Date(c.sync_last_at).toLocaleString()}</> : null}
                  {c.messages_synced != null ? <> · New messages (last run): {c.messages_synced}</> : null}
                  {c.error_log ? (
                    <div style={{ color: "#b32317", marginTop: "0.35rem" }}>{c.error_log}</div>
                  ) : null}
                </div>
                {c.is_active ? (
                  <button
                    type="button"
                    onClick={() => disconnect(c.id)}
                    style={{
                      marginTop: "0.75rem",
                      padding: "0.35rem 0.75rem",
                      border: "1px solid #cfd4dc",
                      borderRadius: 6,
                      background: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    Disconnect
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>

        <section className={styles.signatureSection} aria-labelledby="sig-heading">
          <h2 id="sig-heading" className={styles.signatureLabel}>
            Email signature
          </h2>
          <p className={styles.signatureHint}>
            Appended below a “-- ” line on every reply. Use HTML (paragraphs, links, bold). Same styling as outgoing
            email.
          </p>
          {signatureLoading ? (
            <p style={{ color: "#6a737b" }}>Loading signature…</p>
          ) : (
            <>
              <textarea
                className={styles.signatureEditor}
                value={signatureDraft}
                onChange={(e) => setSignatureDraft(e.target.value)}
                spellCheck={false}
                aria-label="Email signature HTML"
              />
              <p className={styles.signaturePreviewTitle}>Preview</p>
              <div
                className={styles.signaturePreviewBox}
                dangerouslySetInnerHTML={{ __html: sanitizePreview(signatureDraft || "<p>(empty)</p>") }}
              />
              <button
                type="button"
                className={styles.sendBtn}
                style={{ marginTop: "0.75rem" }}
                disabled={signatureSaving}
                onClick={saveSignature}
              >
                {signatureSaving ? "Saving…" : "Save signature"}
              </button>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
