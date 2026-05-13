"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../../context/AuthContext";
import { agentHubFetch, type HubPermissions, type Template } from "../../../../../lib/agentHub";
import AgentHubGate from "../../AgentHubGate";
import { FieldGroup, Toast } from "../../components";
import styles from "../../agentHub.module.css";

function TemplateDetailInner({ perms }: { perms: HubPermissions }) {
  const params = useParams();
  const id = Number(params?.id);
  const { authHeaders, token } = useAuth();
  const [template, setTemplate] = useState<Template | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<Template>>({});
  const [previewAgentId, setPreviewAgentId] = useState("");
  const [preview, setPreview] = useState<{ subject: string; body: string; body_html: string; missing_merge_fields: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ msg: string; variant: "ok" | "error" } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  async function load() {
    try {
      const body = await agentHubFetch<{ template: Template }>(`/agent-hub/templates/${id}`, { authHeaders: authHeaders() });
      setTemplate(body.template);
      setDraft(body.template);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (token && id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id]);

  async function save() {
    if (!template) return;
    setBusy(true);
    try {
      const body = await agentHubFetch<{ template: Template }>(`/agent-hub/templates/${id}`, {
        method: "PATCH",
        authHeaders: authHeaders(),
        body: JSON.stringify({
          name: draft.name,
          description: draft.description,
          subject: draft.subject,
          body: draft.body,
          body_html: draft.body_html,
          category: draft.category,
        }),
      });
      setTemplate(body.template);
      setDraft(body.template);
      setEditing(false);
      setToast({ msg: "Saved.", variant: "ok" });
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Save failed.", variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function runPreview() {
    if (!previewAgentId.trim()) return;
    setBusy(true);
    try {
      const body = await agentHubFetch<typeof preview>(`/agent-hub/templates/${id}/preview`, {
        method: "POST",
        authHeaders: authHeaders(),
        body: JSON.stringify({ agent_id: Number(previewAgentId) }),
      });
      setPreview(body);
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Preview failed.", variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function testSend() {
    if (!previewAgentId.trim()) {
      setToast({ msg: "Pick an agent id first.", variant: "error" });
      return;
    }
    if (!confirm(`Send a TEST ${template?.channel} to agent #${previewAgentId}?`)) return;
    setBusy(true);
    try {
      await agentHubFetch(`/agent-hub/templates/${id}/test-send`, {
        method: "POST",
        authHeaders: authHeaders(),
        body: JSON.stringify({ agent_id: Number(previewAgentId) }),
      });
      setToast({ msg: "Test sent.", variant: "ok" });
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Test failed.", variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  const isManager = perms.role === "owner" || perms.role === "manager";

  if (loading) return <div className={styles.shell}><div className={styles.muted}>Loading…</div></div>;
  if (!template) return null;

  return (
    <div className={styles.shell}>
      <Link href="/agent-hub/templates" className={styles.muted} style={{ fontSize: "0.85rem", display: "inline-block", marginBottom: "0.5rem" }}>
        ← Templates
      </Link>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>{template.name}</h1>
          <p className={styles.pageSubtitle}>
            {template.channel} · slug: <code>{template.slug}</code>{template.is_system ? " · system" : ""}
          </p>
        </div>
        {isManager && !editing ? (
          <button className={styles.btn} onClick={() => setEditing(true)}>✎ Edit</button>
        ) : null}
      </div>

      <div className={styles.gridTwo}>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Content</div>
          {editing ? (
            <>
              <FieldGroup label="Name">
                <input className={styles.input} value={draft.name || ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </FieldGroup>
              {template.channel === "email" ? (
                <FieldGroup label="Subject">
                  <input className={styles.input} value={draft.subject || ""} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
                </FieldGroup>
              ) : null}
              <FieldGroup label="Body">
                <textarea className={styles.textarea} rows={14} value={draft.body || ""} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
              </FieldGroup>
              {template.channel === "email" ? (
                <FieldGroup label="HTML body (optional)">
                  <textarea className={styles.textarea} rows={10} value={draft.body_html || ""} onChange={(e) => setDraft({ ...draft, body_html: e.target.value })} />
                </FieldGroup>
              ) : null}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.4rem" }}>
                <button className={styles.btn} onClick={() => { setEditing(false); setDraft(template); }} disabled={busy}>Cancel</button>
                <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={save} disabled={busy}>
                  {busy ? "Saving…" : "Save"}
                </button>
              </div>
            </>
          ) : (
            <>
              {template.subject ? (
                <div style={{ fontSize: "0.85rem" }}>
                  <strong>Subject:</strong> {template.subject}
                </div>
              ) : null}
              <pre style={{ background: "#f9fafb", padding: "0.6rem", borderRadius: 8, fontSize: "0.85rem", whiteSpace: "pre-wrap", marginTop: "0.5rem" }}>
                {template.body}
              </pre>
            </>
          )}
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}>Preview + test</div>
          <FieldGroup label="Render with agent (id)">
            <div className={styles.row}>
              <input className={styles.input} value={previewAgentId} onChange={(e) => setPreviewAgentId(e.target.value)} placeholder="e.g. 3" />
              <button className={styles.btn} onClick={runPreview} disabled={busy}>Preview</button>
              {(template.channel === "email" || template.channel === "sms") && isManager ? (
                <button className={styles.btnDanger + " " + styles.btn} onClick={testSend} disabled={busy}>
                  Test send
                </button>
              ) : null}
            </div>
          </FieldGroup>
          {preview ? (
            <div style={{ marginTop: "0.6rem" }}>
              {preview.subject ? (
                <div style={{ fontSize: "0.9rem", marginBottom: "0.3rem" }}>
                  <strong>Subject:</strong> {preview.subject}
                </div>
              ) : null}
              <pre style={{ background: "#f0f9ff", padding: "0.6rem", borderRadius: 8, fontSize: "0.85rem", whiteSpace: "pre-wrap" }}>
                {preview.body}
              </pre>
              {preview.missing_merge_fields.length ? (
                <div className={styles.muted} style={{ fontSize: "0.78rem", marginTop: "0.4rem" }}>
                  ⚠️ Missing data for: {preview.missing_merge_fields.join(", ")}
                </div>
              ) : null}
            </div>
          ) : null}

          <div style={{ marginTop: "0.8rem" }}>
            <div className={styles.cardTitle}>Merge fields used</div>
            <div style={{ fontSize: "0.85rem" }}>
              {template.merge_fields_used.map((f) => (
                <code key={f} style={{ marginRight: "0.4rem", padding: "0.1rem 0.3rem", background: "#eef2f7", borderRadius: 4 }}>
                  {f}
                </code>
              ))}
            </div>
          </div>
        </div>
      </div>

      {toast ? <Toast message={toast.msg} variant={toast.variant} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}

export default function TemplateDetailPage() {
  return <AgentHubGate>{(perms) => <TemplateDetailInner perms={perms} />}</AgentHubGate>;
}
