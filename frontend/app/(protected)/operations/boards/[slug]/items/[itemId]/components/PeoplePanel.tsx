"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import styles from "./peoplePanel.module.css";

/**
 * People panel (right rail of the process detail page).
 *
 * Lists contacts attached to the process by role, offers property-aware
 * suggestions ("Tenant of this property — Attach"), and an Add-person
 * modal with role picker + contact search. Backed by
 * GET/POST/DELETE /processes/:id/contacts.
 */

type AttachedContact = {
  id: number;
  role: string;
  is_primary: boolean;
  added_via: string;
  contact_id: number;
  display_name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
};

type Suggestion = {
  role: string;
  contact_id: number;
  display_name: string;
  email: string | null;
  phone: string | null;
  hint: string | null;
};

type SearchResult = {
  id: number;
  display_name: string;
  email: string | null;
  company: string | null;
};

function roleClass(role: string): string {
  if (role === "owner") return styles.roleOwner;
  if (role === "vendor") return styles.roleVendor;
  if (role === "tenant") return "";
  return styles.roleOther;
}

export default function PeoplePanel({ processId }: { processId: number }) {
  const { authHeaders, token } = useAuth();
  const [contacts, setContacts] = useState<AttachedContact[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl(`/processes/${processId}/contacts`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Load failed.");
      }
      setContacts(body.contacts || []);
      setRoles(body.roles || []);
      setSuggestions(body.suggestions || []);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load people.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token, processId]);

  useEffect(() => {
    load();
  }, [load]);

  const attach = async (contactId: number, role: string) => {
    try {
      const res = await fetch(apiUrl(`/processes/${processId}/contacts`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ contact_id: contactId, role }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Attach failed.");
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not attach contact.");
    }
  };

  const detach = async (rowId: number) => {
    try {
      const res = await fetch(apiUrl(`/processes/${processId}/contacts/${rowId}`), {
        method: "DELETE",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Remove failed.");
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not remove contact.");
    }
  };

  if (loading) return <div className={styles.empty}>Loading people…</div>;

  return (
    <div>
      {err ? <div className={styles.error}>{err}</div> : null}

      {contacts.length === 0 ? (
        <div className={styles.empty}>No people attached yet.</div>
      ) : (
        <div className={styles.list}>
          {contacts.map((c) => (
            <div key={c.id} className={styles.person}>
              <div className={styles.personMain}>
                <span className={`${styles.roleBadge} ${roleClass(c.role)}`}>
                  {c.role}
                  {!c.is_primary ? " (alt)" : ""}
                </span>
                <Link href={`/contacts/${c.contact_id}`} className={styles.personName}>
                  {c.display_name}
                </Link>
                {(c.email || c.phone) && (
                  <div className={styles.personSub}>
                    {c.email}
                    {c.email && c.phone ? " · " : ""}
                    {c.phone}
                  </div>
                )}
              </div>
              <button
                type="button"
                className={styles.removeBtn}
                onClick={() => detach(c.id)}
                aria-label={`Remove ${c.display_name}`}
                title="Remove from process"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {suggestions.length > 0 ? (
        <>
          <div className={styles.suggestHead}>Suggested for this property</div>
          {suggestions.map((s) => (
            <div key={`${s.role}-${s.contact_id}`} className={styles.suggestRow}>
              <div className={styles.personMain}>
                <div className={styles.resultName}>{s.display_name}</div>
                <div className={styles.resultSub}>
                  {s.role}
                  {s.hint ? ` · ${s.hint}` : ""}
                </div>
              </div>
              <button
                type="button"
                className={styles.attachBtn}
                onClick={() => attach(s.contact_id, s.role)}
              >
                Attach
              </button>
            </div>
          ))}
        </>
      ) : null}

      <button type="button" className={styles.addBtn} onClick={() => setAddOpen(true)}>
        + Add person
      </button>

      {addOpen ? (
        <AddPersonModal
          roles={roles.length ? roles : ["tenant", "owner"]}
          onClose={() => setAddOpen(false)}
          onPick={async (contactId, role) => {
            await attach(contactId, role);
            setAddOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function AddPersonModal({
  roles,
  onClose,
  onPick,
}: {
  roles: string[];
  onClose: () => void;
  onPick: (contactId: number, role: string) => Promise<void>;
}) {
  const { authHeaders } = useAuth();
  const [role, setRole] = useState(roles[0] ?? "tenant");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          apiUrl(`/contacts?q=${encodeURIComponent(q.trim())}&limit=8`),
          { headers: { ...authHeaders() }, cache: "no-store" }
        );
        const body = await res.json().catch(() => ({}));
        if (res.ok) setResults(body.contacts || []);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, authHeaders]);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h3 className={styles.modalTitle}>Add person to process</h3>
        <div className={styles.field}>
          <label>Role</label>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label>Find contact</label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, email, or company…"
            autoFocus
          />
        </div>
        {searching ? <div className={styles.resultSub}>Searching…</div> : null}
        {results.map((r) => (
          <div
            key={r.id}
            className={styles.resultRow}
            onClick={() => onPick(r.id, role)}
            role="button"
            tabIndex={0}
          >
            <div>
              <div className={styles.resultName}>{r.display_name}</div>
              <div className={styles.resultSub}>
                {r.email || r.company || "—"}
              </div>
            </div>
            <span className={styles.attachBtn}>Add</span>
          </div>
        ))}
        {q.trim() && !searching && results.length === 0 ? (
          <div className={styles.resultSub}>
            No matches. Create them on the{" "}
            <Link href="/contacts" style={{ color: "var(--blue, #0098d0)" }}>
              Contacts page
            </Link>{" "}
            first.
          </div>
        ) : null}
        <div className={styles.modalFooter}>
          <button type="button" className={styles.cancelBtn} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
