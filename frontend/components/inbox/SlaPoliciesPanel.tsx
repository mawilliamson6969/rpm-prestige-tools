"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { apiUrl } from "../../lib/api";
import { networkErrorMessage, parseApiError } from "../../lib/apiResult";

type Policy = {
  id: number;
  name: string;
  match_category: string | null;
  match_mailbox: string | null;
  match_priority: string | null;
  first_response_minutes: number;
  resolution_minutes: number | null;
  pause_on_statuses: string[];
  business_hours_only: boolean;
  active: boolean;
  priority_rank: number;
  created_at?: string;
  updated_at?: string;
};

type Draft = {
  name: string;
  match_category: string;
  match_priority: string;
  match_mailbox: string;
  first_response_minutes: string;
  business_hours_only: boolean;
  active: boolean;
  priority_rank: string;
};

const CATEGORIES = [
  "",
  "maintenance",
  "leasing",
  "accounting",
  "owner",
  "tenant",
  "vendor",
  "legal",
  "internal",
  "marketing",
  "other",
];
const PRIORITIES = ["", "emergency", "high", "normal", "low"];

const EMPTY_DRAFT: Draft = {
  name: "",
  match_category: "",
  match_priority: "",
  match_mailbox: "",
  first_response_minutes: "60",
  business_hours_only: false,
  active: true,
  priority_rank: "100",
};

function fromPolicy(p: Policy): Draft {
  return {
    name: p.name,
    match_category: p.match_category ?? "",
    match_priority: p.match_priority ?? "",
    match_mailbox: p.match_mailbox ?? "",
    first_response_minutes: String(p.first_response_minutes),
    business_hours_only: !!p.business_hours_only,
    active: p.active !== false,
    priority_rank: String(p.priority_rank ?? 100),
  };
}

function describeMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = minutes / 60;
  if (h < 24) return `${Math.round(h * 10) / 10} h`;
  const days = h / 24;
  return `${Math.round(days * 10) / 10} d`;
}

const ROW: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(140px, 1.4fr) repeat(4, minmax(80px, 1fr)) auto",
  gap: "0.5rem",
  alignItems: "center",
  padding: "0.55rem 0.75rem",
  borderBottom: "1px solid #eef0f4",
  fontSize: "0.88rem",
  color: "#1b2856",
};
const HEADER_ROW: React.CSSProperties = {
  ...ROW,
  fontWeight: 700,
  textTransform: "uppercase",
  fontSize: "0.7rem",
  letterSpacing: "0.05em",
  color: "#6a737b",
  background: "#f9fafc",
};
const PILL: React.CSSProperties = {
  display: "inline-block",
  fontSize: "0.7rem",
  padding: "0.1rem 0.45rem",
  borderRadius: 999,
  background: "#eef0f4",
  color: "#1b2856",
};
const ACTION_BTN: React.CSSProperties = {
  background: "transparent",
  border: "1px solid #cfd4dc",
  borderRadius: 6,
  padding: "0.25rem 0.55rem",
  fontSize: "0.78rem",
  cursor: "pointer",
};

export default function SlaPoliciesPanel() {
  const { authHeaders, isAdmin } = useAuth();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/inbox/sla-policies"), {
        cache: "no-store",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(parseApiError(body, res.status));
        return;
      }
      setPolicies(Array.isArray(body.policies) ? body.policies : []);
      setError(null);
    } catch (e) {
      setError(networkErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  const sortedPolicies = useMemo(
    () => [...policies].sort((a, b) => a.priority_rank - b.priority_rank || a.id - b.id),
    [policies]
  );

  const startCreate = () => {
    setDraft(EMPTY_DRAFT);
    setFormError(null);
    setEditingId("new");
  };

  const startEdit = (p: Policy) => {
    setDraft(fromPolicy(p));
    setFormError(null);
    setEditingId(p.id);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setFormError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const payload = {
      name: draft.name.trim(),
      match_category: draft.match_category || null,
      match_priority: draft.match_priority || null,
      match_mailbox: draft.match_mailbox.trim() || null,
      first_response_minutes: Number(draft.first_response_minutes),
      business_hours_only: draft.business_hours_only,
      active: draft.active,
      priority_rank: Number(draft.priority_rank) || 100,
    };
    if (!payload.name) {
      setFormError("Name is required.");
      return;
    }
    if (!Number.isFinite(payload.first_response_minutes) || payload.first_response_minutes <= 0) {
      setFormError("First response minutes must be a positive integer.");
      return;
    }
    setSaving(true);
    try {
      const isNew = editingId === "new";
      const url = isNew ? apiUrl("/inbox/sla-policies") : apiUrl(`/inbox/sla-policies/${editingId}`);
      const res = await fetch(url, {
        method: isNew ? "POST" : "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(parseApiError(body, res.status));
        return;
      }
      await load();
      setEditingId(null);
    } catch (e) {
      setFormError(networkErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: Policy) => {
    if (!window.confirm(`Delete the "${p.name}" policy? Any threads using it will fall back to a wildcard match.`)) return;
    try {
      const res = await fetch(apiUrl(`/inbox/sla-policies/${p.id}`), {
        method: "DELETE",
        headers: { ...authHeaders() },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(parseApiError(body, res.status));
        return;
      }
      await load();
    } catch (e) {
      setError(networkErrorMessage(e));
    }
  };

  const toggleActive = async (p: Policy) => {
    try {
      const res = await fetch(apiUrl(`/inbox/sla-policies/${p.id}`), {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ active: !p.active }),
      });
      if (!res.ok) return;
      await load();
    } catch {
      /* ignore */
    }
  };

  if (!isAdmin) return null;

  return (
    <section style={{ marginTop: "1.5rem" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "0.6rem",
          gap: "0.5rem",
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: "1.05rem", color: "#1b2856" }}>SLA policies</h2>
          <p style={{ margin: "0.2rem 0 0", color: "#6a737b", fontSize: "0.85rem" }}>
            Lower priority rank wins on ties. NULL match = wildcard. Business hours = Mon–Fri 8a–6p Houston time.
          </p>
        </div>
        {editingId === null ? (
          <button
            type="button"
            onClick={startCreate}
            style={{
              padding: "0.4rem 0.9rem",
              border: "none",
              borderRadius: 6,
              background: "#1b2856",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Add policy
          </button>
        ) : null}
      </div>

      {error ? <div style={{ color: "#b32317", fontSize: "0.85rem", marginBottom: "0.5rem" }}>{error}</div> : null}

      <div style={{ background: "#fff", border: "1px solid #e2e4e8", borderRadius: 8, overflow: "hidden" }}>
        <div style={HEADER_ROW}>
          <span>Name / match</span>
          <span>Rank</span>
          <span>1st response</span>
          <span>Hours</span>
          <span>Status</span>
          <span aria-label="Actions" />
        </div>
        {loading && policies.length === 0 ? (
          <div style={{ padding: "1rem", color: "#6a737b" }}>Loading…</div>
        ) : !loading && policies.length === 0 ? (
          <div style={{ padding: "1rem", color: "#6a737b" }}>No policies yet.</div>
        ) : (
          sortedPolicies.map((p) => (
            <div key={p.id} style={ROW}>
              <div>
                <div style={{ fontWeight: 600 }}>{p.name}</div>
                <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap", marginTop: "0.2rem" }}>
                  <span style={PILL}>cat: {p.match_category ?? "any"}</span>
                  <span style={PILL}>prio: {p.match_priority ?? "any"}</span>
                  {p.match_mailbox ? <span style={PILL}>mailbox: {p.match_mailbox}</span> : null}
                </div>
              </div>
              <span>{p.priority_rank}</span>
              <span>{describeMinutes(p.first_response_minutes)}</span>
              <span>{p.business_hours_only ? "Business" : "24/7"}</span>
              <span>
                <button
                  type="button"
                  onClick={() => void toggleActive(p)}
                  style={{
                    ...PILL,
                    cursor: "pointer",
                    background: p.active ? "#e8f5e9" : "#eceff1",
                    color: p.active ? "#2e7d32" : "#6a737b",
                    border: "none",
                  }}
                >
                  {p.active ? "Active" : "Disabled"}
                </button>
              </span>
              <span style={{ display: "flex", gap: "0.35rem", justifyContent: "flex-end" }}>
                <button type="button" style={ACTION_BTN} onClick={() => startEdit(p)}>
                  Edit
                </button>
                <button
                  type="button"
                  style={{ ...ACTION_BTN, color: "#b32317", borderColor: "#f4c4be" }}
                  onClick={() => void remove(p)}
                >
                  Delete
                </button>
              </span>
            </div>
          ))
        )}
      </div>

      {editingId !== null ? (
        <form
          onSubmit={submit}
          style={{
            marginTop: "0.85rem",
            background: "#fff",
            border: "1px solid #e2e4e8",
            borderRadius: 8,
            padding: "0.85rem 1rem",
          }}
        >
          <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.95rem", color: "#1b2856" }}>
            {editingId === "new" ? "New policy" : `Edit "${draft.name}"`}
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.6rem 1rem" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
              <span style={{ fontSize: "0.8rem", color: "#6a737b" }}>Name</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                required
                style={{ padding: "0.4rem", border: "1px solid #cfd4dc", borderRadius: 6 }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
              <span style={{ fontSize: "0.8rem", color: "#6a737b" }}>Priority rank (lower wins ties)</span>
              <input
                type="number"
                value={draft.priority_rank}
                onChange={(e) => setDraft({ ...draft, priority_rank: e.target.value })}
                style={{ padding: "0.4rem", border: "1px solid #cfd4dc", borderRadius: 6 }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
              <span style={{ fontSize: "0.8rem", color: "#6a737b" }}>Match category</span>
              <select
                value={draft.match_category}
                onChange={(e) => setDraft({ ...draft, match_category: e.target.value })}
                style={{ padding: "0.4rem", border: "1px solid #cfd4dc", borderRadius: 6 }}
              >
                {CATEGORIES.map((c) => (
                  <option key={c || "any"} value={c}>{c || "(any)"}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
              <span style={{ fontSize: "0.8rem", color: "#6a737b" }}>Match priority</span>
              <select
                value={draft.match_priority}
                onChange={(e) => setDraft({ ...draft, match_priority: e.target.value })}
                style={{ padding: "0.4rem", border: "1px solid #cfd4dc", borderRadius: 6 }}
              >
                {PRIORITIES.map((p) => (
                  <option key={p || "any"} value={p}>{p || "(any)"}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
              <span style={{ fontSize: "0.8rem", color: "#6a737b" }}>Match mailbox (email, optional)</span>
              <input
                value={draft.match_mailbox}
                onChange={(e) => setDraft({ ...draft, match_mailbox: e.target.value })}
                placeholder="info@rpmhouston.com"
                style={{ padding: "0.4rem", border: "1px solid #cfd4dc", borderRadius: 6 }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
              <span style={{ fontSize: "0.8rem", color: "#6a737b" }}>First response (minutes)</span>
              <input
                type="number"
                min={1}
                value={draft.first_response_minutes}
                onChange={(e) => setDraft({ ...draft, first_response_minutes: e.target.value })}
                style={{ padding: "0.4rem", border: "1px solid #cfd4dc", borderRadius: 6 }}
              />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: "0.4rem" }}>
              <input
                type="checkbox"
                checked={draft.business_hours_only}
                onChange={(e) => setDraft({ ...draft, business_hours_only: e.target.checked })}
              />
              <span>Business hours only</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: "0.4rem" }}>
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
              />
              <span>Active</span>
            </label>
          </div>
          {formError ? (
            <div style={{ color: "#b32317", fontSize: "0.85rem", marginTop: "0.5rem" }}>{formError}</div>
          ) : null}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.85rem" }}>
            <button type="button" onClick={cancelEdit} disabled={saving} style={ACTION_BTN}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                padding: "0.4rem 0.9rem",
                border: "none",
                borderRadius: 6,
                background: "#1b2856",
                color: "#fff",
                cursor: saving ? "not-allowed" : "pointer",
              }}
            >
              {saving ? "Saving…" : editingId === "new" ? "Create" : "Save changes"}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
