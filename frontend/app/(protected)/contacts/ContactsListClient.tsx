"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Plus, RefreshCw, Users } from "lucide-react";
import { apiUrl } from "../../../lib/api";
import { useAuth } from "../../../context/AuthContext";
import styles from "./contacts.module.css";
import {
  SOURCE_LABELS,
  type ContactListRow,
  type IdentitySource,
} from "./types";

const PAGE_SIZE = 50;

const SOURCE_FILTERS: Array<{ value: IdentitySource | ""; label: string }> = [
  { value: "", label: "All" },
  { value: "appfolio_tenant", label: "Tenants" },
  { value: "appfolio_owner", label: "Owners" },
  { value: "appfolio_vendor", label: "Vendors" },
  { value: "manual", label: "Manual" },
];

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

export default function ContactsListClient() {
  const router = useRouter();
  const { authHeaders, token, isAdmin } = useAuth();
  const [contacts, setContacts] = useState<ContactListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [source, setSource] = useState<IdentitySource | "">("");
  const [offset, setOffset] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [resyncing, setResyncing] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (source) params.set("source", source);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));
      const res = await fetch(apiUrl(`/contacts?${params.toString()}`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Load failed.");
      }
      setContacts(body.contacts || []);
      setTotal(body.total || 0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load contacts.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token, q, source, offset]);

  useEffect(() => {
    // Debounce text search; filters/pagination fire immediately via deps.
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const resync = async () => {
    setResyncing(true);
    setErr(null);
    try {
      const res = await fetch(apiUrl("/contacts/resync"), {
        method: "POST",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Resync failed.");
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not resync contacts.");
    } finally {
      setResyncing(false);
    }
  };

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Contacts</h1>
          <p className={styles.subtitle}>
            Every tenant, owner, and vendor in one place — synced from AppFolio,
            editable here.
          </p>
        </div>
        <div className={styles.actions}>
          {isAdmin ? (
            <button type="button" className={styles.btn} onClick={resync} disabled={resyncing}>
              <RefreshCw size={14} /> {resyncing ? "Syncing…" : "Sync from AppFolio"}
            </button>
          ) : null}
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={14} /> New Contact
          </button>
        </div>
      </header>

      <div className={styles.searchRow}>
        <div className={styles.searchBox}>
          <Search size={15} color="var(--grey, #6a737b)" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOffset(0);
            }}
            placeholder="Search by name, email, or company…"
          />
        </div>
        <div className={styles.chips}>
          {SOURCE_FILTERS.map((f) => (
            <button
              key={f.value || "all"}
              type="button"
              className={`${styles.chip} ${source === f.value ? styles.chipActive : ""}`}
              onClick={() => {
                setSource(f.value);
                setOffset(0);
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {err ? <div className={styles.errorBanner}>{err}</div> : null}

      <div className={styles.card}>
        {loading ? (
          <div className={styles.loading}>Loading contacts…</div>
        ) : contacts.length === 0 ? (
          <div className={styles.empty}>
            <Users size={28} color="var(--grey, #6a737b)" />
            <p>
              {q || source
                ? "No contacts match that filter."
                : "No contacts yet. They appear automatically after the next AppFolio sync, or add one manually."}
            </p>
          </div>
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Phone</th>
                    <th>Type</th>
                    <th>Tags</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((c) => (
                    <tr
                      key={c.id}
                      className={styles.rowLink}
                      onClick={() => router.push(`/contacts/${c.id}`)}
                    >
                      <td>
                        <strong>{c.display_name}</strong>
                        {c.company && c.company !== c.display_name ? (
                          <span className={styles.muted}> · {c.company}</span>
                        ) : null}
                      </td>
                      <td className={c.email ? "" : styles.muted}>{c.email || "—"}</td>
                      <td className={c.phone ? "" : styles.muted}>{c.phone || "—"}</td>
                      <td>
                        {c.sources.length ? (
                          c.sources.map((s) => (
                            <span key={s} className={`${styles.badge} ${badgeClass(s)}`}>
                              {SOURCE_LABELS[s] ?? s}
                            </span>
                          ))
                        ) : (
                          <span className={`${styles.badge} ${styles.badgeManual}`}>Manual</span>
                        )}
                      </td>
                      <td>
                        {c.tags.slice(0, 3).map((t) => (
                          <span key={t} className={styles.tagBadge}>
                            {t}
                          </span>
                        ))}
                        {c.tags.length > 3 ? (
                          <span className={styles.muted}>+{c.tags.length - 3}</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.pagination}>
              <span>
                Showing {from}–{to} of {total}
              </span>
              <div className={styles.pageBtns}>
                <button
                  type="button"
                  className={styles.btn}
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className={styles.btn}
                  disabled={to >= total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <NewContactModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => router.push(`/contacts/${id}`)}
      />
    </div>
  );
}

function NewContactModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const { authHeaders } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDisplayName("");
    setEmail("");
    setPhone("");
    setCompany("");
    setErr(null);
  }, [open]);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      setErr("Name is required.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(apiUrl("/contacts"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          display_name: displayName.trim(),
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          company: company.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Create failed.");
      }
      onClose();
      onCreated(body.contact.id);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Could not create contact.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>New Contact</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form className={styles.modalBody} onSubmit={submit}>
          {err ? <div className={styles.errorBanner}>{err}</div> : null}
          <div className={styles.field}>
            <label>Name</label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoFocus
              required
            />
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
          <div className={styles.formFooter}>
            <button type="button" className={styles.btn} onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className={`${styles.btn} ${styles.btnPrimary}`}
              disabled={saving}
            >
              {saving ? "Creating…" : "Create Contact"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
