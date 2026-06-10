"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Pencil, Archive, Mail } from "lucide-react";
import { apiUrl } from "../../../../lib/api";
import { useAuth } from "../../../../context/AuthContext";
import styles from "../contacts.module.css";
import {
  SOURCE_LABELS,
  type Contact,
  type ContactIdentity,
  type ContactProcess,
  type ContactThread,
  type IdentitySource,
} from "../types";

function badgeClass(source: IdentitySource): string {
  switch (source) {
    case "appfolio_tenant":
      return styles.badgeTenant;
    case "appfolio_owner":
      return styles.badgeOwner;
    case "appfolio_vendor":
      return styles.badgeVendor;
    case "rentengine_lead":
      return styles.badgeLead;
    default:
      return styles.badgeManual;
  }
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

export default function ContactCardClient() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { authHeaders, token } = useAuth();
  const [contact, setContact] = useState<Contact | null>(null);
  const [identities, setIdentities] = useState<ContactIdentity[]>([]);
  const [threads, setThreads] = useState<ContactThread[]>([]);
  const [processes, setProcesses] = useState<ContactProcess[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    if (!token || !params?.id) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(apiUrl(`/contacts/${params.id}`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Load failed.");
      }
      // Stale link to a merged loser — bounce to the survivor.
      if (body.merged_into) {
        router.replace(`/contacts/${body.merged_into}`);
        return;
      }
      setContact(body.contact);
      setIdentities(body.identities || []);
      setThreads(body.threads || []);
      setProcesses(body.processes || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load contact.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token, params?.id, router]);

  useEffect(() => {
    load();
  }, [load]);

  const archive = async () => {
    if (!contact) return;
    if (!confirm(`Archive ${contact.display_name}? They can be restored later.`)) return;
    try {
      const res = await fetch(apiUrl(`/contacts/${contact.id}`), {
        method: "DELETE",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Archive failed.");
      }
      router.push("/contacts");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not archive contact.");
    }
  };

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.loading}>Loading contact…</div>
      </div>
    );
  }

  if (!contact) {
    return (
      <div className={styles.page}>
        <Link href="/contacts" className={styles.backLink}>
          <ArrowLeft size={14} /> All contacts
        </Link>
        <div className={styles.errorBanner}>{err || "Contact not found."}</div>
      </div>
    );
  }

  const sources = Array.from(new Set(identities.map((i) => i.source)));
  const overridden = contact.manual_overrides || {};

  return (
    <div className={styles.page}>
      <Link href="/contacts" className={styles.backLink}>
        <ArrowLeft size={14} /> All contacts
      </Link>

      {err ? <div className={styles.errorBanner}>{err}</div> : null}

      <div className={`${styles.card} ${styles.cardPad} ${styles.section}`}>
        <div className={styles.profileHeader}>
          <div className={styles.avatar}>{initials(contact.display_name)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 className={styles.profileName}>{contact.display_name}</h1>
            <p className={styles.profileMeta}>
              {contact.company ? `${contact.company} · ` : ""}
              Added {fmtDate(contact.created_at)}
            </p>
            <div style={{ marginTop: "0.4rem" }}>
              {sources.length ? (
                sources.map((s) => (
                  <span key={s} className={`${styles.badge} ${badgeClass(s)}`}>
                    {SOURCE_LABELS[s] ?? s}
                  </span>
                ))
              ) : (
                <span className={`${styles.badge} ${styles.badgeManual}`}>Manual</span>
              )}
            </div>
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.btn} onClick={() => setEditing(true)}>
              <Pencil size={14} /> Edit
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnDanger}`}
              onClick={archive}
            >
              <Archive size={14} /> Archive
            </button>
          </div>
        </div>
      </div>

      <div className={styles.cardGrid}>
        <div>
          <div className={`${styles.card} ${styles.cardPad} ${styles.section}`}>
            <h2 className={styles.cardTitle}>Processes</h2>
            {processes.length === 0 ? (
              <div className={styles.empty}>
                No linked processes. Launching a process against this
                contact&rsquo;s property attaches them automatically.
              </div>
            ) : (
              processes.map((p) => (
                <div key={`${p.id}-${p.role}`} className={styles.threadRow}>
                  <span className={styles.threadSubject}>
                    <Link
                      href={`/operations/processes/${p.id}`}
                      style={{ color: "inherit", textDecoration: "none" }}
                    >
                      {p.name}
                    </Link>
                    <span className={`${styles.badge} ${styles.badgeManual}`} style={{ marginLeft: "0.4rem" }}>
                      {p.role}
                    </span>
                  </span>
                  <span className={styles.threadMeta}>
                    {p.status} · {fmtDate(p.started_at)}
                  </span>
                </div>
              ))
            )}
          </div>

          <div className={`${styles.card} ${styles.cardPad} ${styles.section}`}>
            <h2 className={styles.cardTitle}>
              <Mail size={15} style={{ verticalAlign: "-2px", marginRight: "0.35rem" }} />
              Email threads
            </h2>
            {threads.length === 0 ? (
              <div className={styles.empty}>
                {contact.email
                  ? "No inbox threads found for this contact's email."
                  : "Add an email address to match inbox threads."}
              </div>
            ) : (
              threads.map((t) => (
                <div key={t.thread_id} className={styles.threadRow}>
                  <span className={styles.threadSubject}>{t.subject || "(no subject)"}</span>
                  <span className={styles.threadMeta}>
                    {t.message_count} msg · {fmtDate(t.last_message_at)}
                  </span>
                </div>
              ))
            )}
          </div>

          {contact.notes ? (
            <div className={`${styles.card} ${styles.cardPad} ${styles.section}`}>
              <h2 className={styles.cardTitle}>Notes</h2>
              <p style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: "0.9rem" }}>
                {contact.notes}
              </p>
            </div>
          ) : null}
        </div>

        <div>
          <div className={`${styles.card} ${styles.cardPad} ${styles.section}`}>
            <h2 className={styles.cardTitle}>Contact info</h2>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Email</span>
              <span className={styles.detailValue}>
                {contact.email || "—"}
                {overridden.email ? <span className={styles.overrideDot} title="Manually edited — protected from sync" /> : null}
              </span>
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Phone</span>
              <span className={styles.detailValue}>
                {contact.phone || "—"}
                {overridden.phone ? <span className={styles.overrideDot} title="Manually edited — protected from sync" /> : null}
              </span>
            </div>
            {contact.alt_emails.length ? (
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>Other emails</span>
                <span className={styles.detailValue}>{contact.alt_emails.join(", ")}</span>
              </div>
            ) : null}
            {contact.alt_phones.length ? (
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>Other phones</span>
                <span className={styles.detailValue}>{contact.alt_phones.join(", ")}</span>
              </div>
            ) : null}
            {contact.tags.length ? (
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>Tags</span>
                <span className={styles.detailValue}>
                  {contact.tags.map((t) => (
                    <span key={t} className={styles.tagBadge}>
                      {t}
                    </span>
                  ))}
                </span>
              </div>
            ) : null}
          </div>

          <div className={`${styles.card} ${styles.cardPad} ${styles.section}`}>
            <h2 className={styles.cardTitle}>Linked records</h2>
            {identities.length === 0 ? (
              <div className={styles.empty}>
                Manual contact — not linked to any AppFolio record.
              </div>
            ) : (
              identities.map((i) => (
                <div key={i.id} className={styles.detailRow}>
                  <span className={styles.detailLabel}>
                    <span className={`${styles.badge} ${badgeClass(i.source)}`}>
                      {SOURCE_LABELS[i.source] ?? i.source}
                    </span>
                  </span>
                  <span className={styles.detailValue}>
                    {i.source === "appfolio_tenant" && i.metadata.property_name ? (
                      <>
                        {i.metadata.property_name}
                        {i.metadata.unit ? ` · Unit ${i.metadata.unit}` : ""}
                        {i.metadata.lease_to ? (
                          <span className={styles.muted}>
                            {" "}
                            (lease to {fmtDate(i.metadata.lease_to)})
                          </span>
                        ) : null}
                      </>
                    ) : i.source === "appfolio_vendor" && i.metadata.vendor_type ? (
                      i.metadata.vendor_type
                    ) : (
                      `#${i.external_id}`
                    )}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <EditContactModal
        open={editing}
        contact={contact}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          load();
        }}
      />
    </div>
  );
}

function EditContactModal({
  open,
  contact,
  onClose,
  onSaved,
}: {
  open: boolean;
  contact: Contact;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { authHeaders } = useAuth();
  const [displayName, setDisplayName] = useState(contact.display_name);
  const [email, setEmail] = useState(contact.email || "");
  const [phone, setPhone] = useState(contact.phone || "");
  const [company, setCompany] = useState(contact.company || "");
  const [tags, setTags] = useState(contact.tags.join(", "));
  const [notes, setNotes] = useState(contact.notes || "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDisplayName(contact.display_name);
    setEmail(contact.email || "");
    setPhone(contact.phone || "");
    setCompany(contact.company || "");
    setTags(contact.tags.join(", "));
    setNotes(contact.notes || "");
    setErr(null);
  }, [open, contact]);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      // Only send fields that actually changed, so manual_overrides only
      // pins fields the user genuinely touched.
      const patch: Record<string, unknown> = {};
      if (displayName.trim() !== contact.display_name) patch.display_name = displayName.trim();
      if (email.trim() !== (contact.email || "")) patch.email = email.trim() || null;
      if (phone.trim() !== (contact.phone || "")) patch.phone = phone.trim() || null;
      if (company.trim() !== (contact.company || "")) patch.company = company.trim() || null;
      const tagList = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      if (tagList.join(",") !== contact.tags.join(",")) patch.tags = tagList;
      if (notes.trim() !== (contact.notes || "")) patch.notes = notes.trim() || null;

      if (Object.keys(patch).length === 0) {
        onClose();
        return;
      }

      const res = await fetch(apiUrl(`/contacts/${contact.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Save failed.");
      }
      onSaved();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Could not save contact.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>Edit Contact</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form className={styles.modalBody} onSubmit={submit}>
          {err ? <div className={styles.errorBanner}>{err}</div> : null}
          <div className={styles.field}>
            <label>Name</label>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          </div>
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className={styles.field}>
              <label>Phone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div className={styles.field}>
            <label>Company</label>
            <input value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label>Tags (comma-separated)</label>
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="vip, hoa, …" />
          </div>
          <div className={styles.field}>
            <label>Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <p className={styles.muted} style={{ fontSize: "0.78rem" }}>
            Edits to synced fields (name, email, phone, company) are protected
            from being overwritten by the AppFolio sync.
          </p>
          <div className={styles.formFooter}>
            <button type="button" className={styles.btn} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
