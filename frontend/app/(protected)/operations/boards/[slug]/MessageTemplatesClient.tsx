"use client";

import { useCallback, useEffect, useState } from "react";
import { Mail, MessageSquare, Plus, Trash2, Save } from "lucide-react";
import { apiUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import styles from "./message-templates.module.css";

type Mode = "email" | "text";

interface EmailTpl {
  id: number;
  name: string;
  subject: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  totalSends: number;
  totalOpens: number;
  totalClicks: number;
}

interface TextTpl {
  id: number;
  name: string;
  body: string | null;
  totalSends: number;
  totalDelivered: number;
}

interface ResolvedTemplate {
  id: number;
  name: string;
}

const HIGHLIGHT_RE = /(\{\{[^}]+\}\})/g;

function renderWithVars(text: string) {
  return text.split(HIGHLIGHT_RE).map((part, i) =>
    part.startsWith("{{") ? (
      <span key={i} className={`${styles.varChip} pms-mono`}>
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

export default function MessageTemplatesClient({
  slug,
  mode,
}: {
  slug: string;
  mode: Mode;
}) {
  const { authHeaders, token, isAdmin } = useAuth();
  const [tpl, setTpl] = useState<ResolvedTemplate | null>(null);
  const [emails, setEmails] = useState<EmailTpl[]>([]);
  const [texts, setTexts] = useState<TextTpl[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ name: string; subject: string; body: string } | null>(
    null
  );

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const tRes = await fetch(apiUrl("/processes/templates"), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!tRes.ok) throw new Error("Could not load templates.");
      const tBody = await tRes.json();
      const match = (tBody.templates || []).find(
        (t: Record<string, unknown>) => t.slug === slug
      );
      if (!match) throw new Error(`No process template matches "${slug}".`);
      const resolved = { id: Number(match.id), name: String(match.name ?? "") };
      setTpl(resolved);

      const endpoint =
        mode === "email"
          ? `/processes/templates/${resolved.id}/email-templates`
          : `/processes/templates/${resolved.id}/text-templates`;
      const res = await fetch(apiUrl(endpoint), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Could not load templates.");
      const body = await res.json();
      const list = body.templates || [];
      if (mode === "email") {
        const mapped: EmailTpl[] = list.map((r: Record<string, unknown>) => ({
          id: Number(r.id),
          name: String(r.name ?? ""),
          subject: (r.subject as string | null) ?? null,
          bodyHtml: (r.bodyHtml as string | null) ?? null,
          bodyText: (r.bodyText as string | null) ?? null,
          totalSends: Number(r.totalSends ?? 0),
          totalOpens: Number(r.totalOpens ?? 0),
          totalClicks: Number(r.totalClicks ?? 0),
        }));
        setEmails(mapped);
        setSelectedId((cur) =>
          cur && mapped.some((m) => m.id === cur) ? cur : mapped[0]?.id ?? null
        );
      } else {
        const mapped: TextTpl[] = list.map((r: Record<string, unknown>) => ({
          id: Number(r.id),
          name: String(r.name ?? ""),
          body: (r.body as string | null) ?? null,
          totalSends: Number(r.totalSends ?? 0),
          totalDelivered: Number(r.totalDelivered ?? 0),
        }));
        setTexts(mapped);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load templates.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, mode, slug, token]);

  useEffect(() => {
    load();
  }, [load]);

  const selectedEmail = emails.find((e) => e.id === selectedId) ?? null;

  async function createTemplate() {
    if (!tpl || busy) return;
    const name = window.prompt(`New ${mode} template name:`);
    if (!name || !name.trim()) return;
    setBusy(true);
    try {
      const endpoint =
        mode === "email"
          ? `/processes/templates/${tpl.id}/email-templates`
          : `/processes/templates/${tpl.id}/text-templates`;
      const res = await fetch(apiUrl(endpoint), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(
          mode === "email"
            ? { name: name.trim(), subject: "", bodyHtml: "", bodyText: "" }
            : { name: name.trim(), body: "" }
        ),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || "Could not create template.");
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create template.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteTemplate(id: number) {
    if (busy || !window.confirm("Delete this template?")) return;
    setBusy(true);
    try {
      const endpoint =
        mode === "email"
          ? `/processes/email-templates/${id}`
          : `/processes/text-templates/${id}`;
      const res = await fetch(apiUrl(endpoint), {
        method: "DELETE",
        headers: { ...authHeaders() },
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || "Could not delete template.");
      }
      await load();
      setDraft(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not delete template.");
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(id: number) {
    if (!draft || busy) return;
    setBusy(true);
    try {
      const endpoint =
        mode === "email"
          ? `/processes/email-templates/${id}`
          : `/processes/text-templates/${id}`;
      const res = await fetch(apiUrl(endpoint), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(
          mode === "email"
            ? { name: draft.name, subject: draft.subject, bodyText: draft.body }
            : { name: draft.name, body: draft.body }
        ),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || "Could not save template.");
      }
      await load();
      setDraft(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save template.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div data-pms className={styles.loading}>
        Loading {mode} templates…
      </div>
    );
  }

  return (
    <div data-pms className={styles.root}>
      <div className={styles.header}>
        <div>
          <div className={`${styles.eyebrow} pms-cond`}>{tpl?.name ?? slug}</div>
          <h1 className={`${styles.title} pms-cond`}>
            {mode === "email" ? "Email Templates" : "Text Message Templates"}
          </h1>
          <p className={styles.sub}>
            {mode === "email"
              ? "Pre-written emails sent manually or automatically from your workflow steps."
              : "Short reusable SMS messages. Variables fill per-recipient at send time."}
          </p>
        </div>
        {isAdmin && (
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={createTemplate}
            disabled={busy}
          >
            <Plus size={14} /> Add Template
          </button>
        )}
      </div>

      {err && <div className={styles.err}>{err}</div>}

      {mode === "email" ? (
        <div className={styles.emailSplit}>
          <div className={styles.emailList}>
            <table className={styles.emailTable}>
              <thead>
                <tr>
                  <th>Template</th>
                  <th className={styles.center}>Sends</th>
                  <th className={styles.center}>Opens</th>
                  <th className={styles.center}>Clicks</th>
                </tr>
              </thead>
              <tbody>
                {emails.map((t) => (
                  <tr
                    key={t.id}
                    className={t.id === selectedId ? styles.rowActive : ""}
                    onClick={() => {
                      setSelectedId(t.id);
                      setDraft(null);
                    }}
                  >
                    <td>
                      <div className={styles.tplName}>{t.name}</div>
                      <div className={styles.tplPreview}>{t.subject || "No subject"}</div>
                    </td>
                    <td className={`${styles.center} pms-mono`}>{t.totalSends}</td>
                    <td className={`${styles.center} pms-mono`}>
                      {t.totalSends > 0 ? Math.round((t.totalOpens / t.totalSends) * 100) + "%" : "—"}
                    </td>
                    <td className={`${styles.center} pms-mono`}>
                      {t.totalSends > 0 ? Math.round((t.totalClicks / t.totalSends) * 100) + "%" : "—"}
                    </td>
                  </tr>
                ))}
                {emails.length === 0 && (
                  <tr>
                    <td colSpan={4} className={styles.emptyCell}>
                      No email templates yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className={styles.preview}>
            {!selectedEmail ? (
              <div className={styles.previewEmpty}>Select a template to preview.</div>
            ) : (
              <>
                <div className={styles.previewHead}>
                  <Mail size={15} color="var(--pms-sky)" />
                  <span className={`${styles.previewTitle} pms-cond`}>PREVIEW</span>
                  {isAdmin && draft === null && (
                    <button
                      type="button"
                      className={styles.smallBtn}
                      onClick={() =>
                        setDraft({
                          name: selectedEmail.name,
                          subject: selectedEmail.subject || "",
                          body: selectedEmail.bodyText || selectedEmail.bodyHtml || "",
                        })
                      }
                    >
                      Edit
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      type="button"
                      className={styles.smallBtnDanger}
                      onClick={() => deleteTemplate(selectedEmail.id)}
                      disabled={busy}
                    >
                      <Trash2 size={12} /> Delete
                    </button>
                  )}
                </div>
                <div className={styles.previewBody}>
                  {draft ? (
                    <div className={styles.editForm}>
                      <label>Name</label>
                      <input
                        value={draft.name}
                        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      />
                      <label>Subject</label>
                      <input
                        value={draft.subject}
                        onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                      />
                      <label>Body</label>
                      <textarea
                        rows={10}
                        value={draft.body}
                        onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                      />
                      <div className={styles.editActions}>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnPrimary}`}
                          onClick={() => saveDraft(selectedEmail.id)}
                          disabled={busy}
                        >
                          <Save size={13} /> Save
                        </button>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnLight}`}
                          onClick={() => setDraft(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className={styles.fieldLabel}>Subject</div>
                      <div className={styles.subjectLine}>
                        {selectedEmail.subject || <em>No subject</em>}
                      </div>
                      <div className={styles.emailBox}>
                        {selectedEmail.bodyText || selectedEmail.bodyHtml ? (
                          renderWithVars(selectedEmail.bodyText || selectedEmail.bodyHtml || "")
                        ) : (
                          <em className={styles.muted}>This template has no body yet.</em>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className={styles.textGrid}>
          {texts.map((t) => {
            const editing = draft && selectedId === t.id;
            return (
              <div key={t.id} className={styles.textCard}>
                <div className={styles.textCardHead}>
                  <div className={styles.textIcon}>
                    <MessageSquare size={15} />
                  </div>
                  <div className={styles.textCardMeta}>
                    <div className={styles.tplName}>{t.name}</div>
                    <div className={styles.tplPreview}>{t.totalSends} sends</div>
                  </div>
                  {isAdmin && !editing && (
                    <>
                      <button
                        type="button"
                        className={styles.smallBtn}
                        onClick={() => {
                          setSelectedId(t.id);
                          setDraft({ name: t.name, subject: "", body: t.body || "" });
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className={styles.smallBtnDanger}
                        onClick={() => deleteTemplate(t.id)}
                        disabled={busy}
                      >
                        <Trash2 size={12} />
                      </button>
                    </>
                  )}
                </div>
                <div className={styles.textCardBody}>
                  {editing ? (
                    <div className={styles.editForm}>
                      <input
                        value={draft.name}
                        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      />
                      <textarea
                        rows={4}
                        value={draft.body}
                        onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                      />
                      <div className={styles.editActions}>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnPrimary}`}
                          onClick={() => saveDraft(t.id)}
                          disabled={busy}
                        >
                          <Save size={13} /> Save
                        </button>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnLight}`}
                          onClick={() => setDraft(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className={styles.bubble}>
                      {t.body ? (
                        renderWithVars(t.body)
                      ) : (
                        <em className={styles.muted}>Empty message.</em>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {texts.length === 0 && (
            <div className={styles.emptyCard}>No text templates yet.</div>
          )}
        </div>
      )}
    </div>
  );
}
