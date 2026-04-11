"use client";

import type { CSSProperties } from "react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ownerTerminationBasePath } from "../../../lib/api";

const NAVY = "#1B2856";
const LIGHT_BLUE = "#0098D0";
const RED = "#B32317";
const GREY = "#6A737B";
const WHITE = "#FFFFFF";
const OFF_WHITE = "#F5F5F5";

const REASON_LABELS: Record<string, string> = {
  selling_the_property: "Selling the property",
  dissatisfied_with_rpm: "Dissatisfied with Real Property Management Prestige",
  other_property_management: "Another PM company",
  self_management: "Taking over myself",
  financial: "Financial reasons",
  other: "Other",
};

const STATUSES = ["pending", "retained", "in_progress", "completed", "cancelled"] as const;

type Row = {
  id: string;
  submitted_at: string;
  owner_first_name: string;
  owner_last_name: string;
  street_address: string;
  city: string;
  state: string;
  zip_code: string;
  termination_reason: string;
  retention_offer_accepted: string;
  status: string;
  email: string;
  submitter_type: string;
  staff_member_name: string | null;
  street_address_2: string | null;
  date_received_in_writing: string;
  requested_termination_date: string;
  reason_details: string | null;
  improvement_feedback: string | null;
  guarantees_acknowledged: boolean | null;
  deposit_waiver_acknowledged: boolean | null;
  deposit_return_acknowledged: boolean | null;
  keys_balance_acknowledged: boolean | null;
  signature_data: string | null;
};

const card: CSSProperties = {
  background: WHITE,
  borderRadius: 12,
  padding: "1.25rem",
  border: `1px solid rgba(27, 40, 86, 0.12)`,
  marginBottom: "1.25rem",
};

const STORAGE_KEY = "rpm_admin_api_secret";

export default function AdminTerminations() {
  const [secret, setSecret] = useState("");
  const [savedSecret, setSavedSecret] = useState<string | null>(null);
  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const s = sessionStorage.getItem(STORAGE_KEY);
    if (s) setSavedSecret(s);
  }, []);

  const authHeaders = useMemo((): Record<string, string> => {
    const token = savedSecret ?? "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [savedSecret]);

  const load = useCallback(async () => {
    if (!savedSecret) {
      setError("Enter the admin API key (same as ADMIN_API_SECRET) and click Save.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const q = statusFilter !== "all" ? `?status=${encodeURIComponent(statusFilter)}` : "";
      const res = await fetch(`${ownerTerminationBasePath()}${q}`, {
        headers: { ...authHeaders },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : `HTTP ${res.status}`);
      }
      setItems(body.items ?? []);
    } catch (e) {
      setItems([]);
      setError(e instanceof Error ? e.message : "Could not load.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, savedSecret, statusFilter]);

  useEffect(() => {
    if (savedSecret) load();
  }, [savedSecret, statusFilter, load]);

  function saveSecret() {
    const t = secret.trim();
    if (!t) return;
    sessionStorage.setItem(STORAGE_KEY, t);
    setSavedSecret(t);
    setSecret("");
  }

  function clearSecret() {
    sessionStorage.removeItem(STORAGE_KEY);
    setSavedSecret(null);
    setItems([]);
  }

  async function updateStatus(id: string, status: string) {
    if (!savedSecret) return;
    const res = await fetch(`${ownerTerminationBasePath()}/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ status }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(typeof body.error === "string" ? body.error : "Update failed");
      return;
    }
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, ...body.item } : r)));
  }

  async function exportCsv() {
    if (!savedSecret) return;
    const res = await fetch(`${ownerTerminationBasePath()}/export.csv`, {
      headers: { ...authHeaders },
    });
    if (!res.ok) {
      alert("Export failed");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "owner-terminations.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: OFF_WHITE,
        padding: "1.5rem clamp(1rem, 4vw, 2rem)",
        fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
        color: NAVY,
      }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <header style={{ marginBottom: "1.5rem" }}>
          <div style={{ fontSize: "1.25rem", fontWeight: 800, color: NAVY }}>Real Property Management Prestige</div>
          <h1 style={{ margin: "0.35rem 0 0", fontSize: "1.35rem", color: LIGHT_BLUE }}>Termination requests</h1>
        </header>

        <section style={card}>
          <p style={{ margin: "0 0 0.75rem", fontSize: "0.95rem", color: GREY, lineHeight: 1.5 }}>
            Paste the server <strong>ADMIN_API_SECRET</strong> once per browser session. It is stored only in{" "}
            <code>sessionStorage</code> on this device.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <input
              type="password"
              placeholder="Admin API secret"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              style={{
                flex: "1 1 220px",
                padding: "0.5rem 0.65rem",
                borderRadius: 8,
                border: `1px solid ${GREY}`,
                fontSize: "1rem",
              }}
            />
            <button
              type="button"
              onClick={saveSecret}
              style={{
                background: LIGHT_BLUE,
                color: WHITE,
                border: "none",
                borderRadius: 8,
                padding: "0.5rem 1.2rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Save key
            </button>
            {savedSecret && (
              <button
                type="button"
                onClick={clearSecret}
                style={{
                  background: "transparent",
                  color: RED,
                  border: `1px solid ${RED}`,
                  borderRadius: 8,
                  padding: "0.5rem 1rem",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Clear
              </button>
            )}
          </div>
        </section>

        <section style={card}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 12 }}>
            <label style={{ fontWeight: 600 }}>
              Filter:{" "}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{ marginLeft: 8, padding: "0.35rem 0.5rem", borderRadius: 8 }}
              >
                <option value="all">All statuses</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => load()}
              disabled={loading || !savedSecret}
              style={{
                background: NAVY,
                color: WHITE,
                border: "none",
                borderRadius: 8,
                padding: "0.45rem 1rem",
                fontWeight: 600,
                cursor: loading ? "wait" : "pointer",
              }}
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={exportCsv}
              disabled={!savedSecret}
              style={{
                background: "transparent",
                color: NAVY,
                border: `1px solid ${NAVY}`,
                borderRadius: 8,
                padding: "0.45rem 1rem",
                fontWeight: 600,
                cursor: savedSecret ? "pointer" : "not-allowed",
              }}
            >
              Export CSV
            </button>
          </div>

          {error && (
            <div role="alert" style={{ color: RED, marginBottom: 12 }}>
              {error}
            </div>
          )}

          {loading && <p style={{ color: GREY }}>Loading…</p>}

          {!loading && savedSecret && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: `2px solid ${LIGHT_BLUE}` }}>
                    <th style={{ padding: "0.5rem" }}>Date</th>
                    <th style={{ padding: "0.5rem" }}>Owner</th>
                    <th style={{ padding: "0.5rem" }}>Property</th>
                    <th style={{ padding: "0.5rem" }}>Reason</th>
                    <th style={{ padding: "0.5rem" }}>Retention</th>
                    <th style={{ padding: "0.5rem" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <Fragment key={row.id}>
                      <tr
                        onClick={() => setExpanded((e) => (e === row.id ? null : row.id))}
                        style={{
                          borderBottom: "1px solid #ddd",
                          cursor: "pointer",
                          background: expanded === row.id ? "rgba(0,152,208,0.08)" : undefined,
                        }}
                      >
                        <td style={{ padding: "0.6rem 0.5rem", whiteSpace: "nowrap" }}>
                          {new Date(row.submitted_at).toLocaleString()}
                        </td>
                        <td style={{ padding: "0.6rem 0.5rem" }}>
                          {row.owner_first_name} {row.owner_last_name}
                        </td>
                        <td style={{ padding: "0.6rem 0.5rem" }}>
                          {row.city}, {row.state}
                        </td>
                        <td style={{ padding: "0.6rem 0.5rem" }}>
                          {REASON_LABELS[row.termination_reason] ?? row.termination_reason}
                        </td>
                        <td style={{ padding: "0.6rem 0.5rem" }}>
                          {row.retention_offer_accepted === "yes" ? "Yes" : "No"}
                        </td>
                        <td style={{ padding: "0.6rem 0.5rem" }} onClick={(ev) => ev.stopPropagation()}>
                          <select
                            value={row.status}
                            onChange={(e) => updateStatus(row.id, e.target.value)}
                            style={{ padding: "0.25rem", borderRadius: 6, maxWidth: 140 }}
                          >
                            {STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                      {expanded === row.id && (
                        <tr>
                          <td colSpan={6} style={{ padding: "0 1rem 1rem", background: "#fafafa" }}>
                            <DetailPanel row={row} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
              {items.length === 0 && !error && <p style={{ color: GREY }}>No records.</p>}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function DetailPanel({ row }: { row: Row }) {
  return (
    <div style={{ fontSize: "0.88rem", lineHeight: 1.55, color: "#333" }}>
      <p style={{ margin: "0.5rem 0" }}>
        <strong>ID:</strong> {row.id}
      </p>
      <p style={{ margin: "0.5rem 0" }}>
        <strong>Email:</strong> {row.email}
      </p>
      <p style={{ margin: "0.5rem 0" }}>
        <strong>Submitter:</strong> {row.submitter_type}
        {row.staff_member_name ? ` — ${row.staff_member_name}` : ""}
      </p>
      <p style={{ margin: "0.5rem 0" }}>
        <strong>Address:</strong> {row.street_address}
        {row.street_address_2 ? `, ${row.street_address_2}` : ""}, {row.city}, {row.state} {row.zip_code}
      </p>
      <p style={{ margin: "0.5rem 0" }}>
        <strong>Dates:</strong> received {row.date_received_in_writing} · effective {row.requested_termination_date}
      </p>
      {row.reason_details && (
        <p style={{ margin: "0.5rem 0" }}>
          <strong>Reason details:</strong> {row.reason_details}
        </p>
      )}
      {row.improvement_feedback && (
        <p style={{ margin: "0.5rem 0" }}>
          <strong>Improvement feedback:</strong> {row.improvement_feedback}
        </p>
      )}
      <p style={{ margin: "0.5rem 0" }}>
        <strong>Acknowledgments:</strong> guarantees {String(row.guarantees_acknowledged)} · waiver{" "}
        {String(row.deposit_waiver_acknowledged)} · deposit return {String(row.deposit_return_acknowledged)} · keys{" "}
        {String(row.keys_balance_acknowledged)}
      </p>
      {row.signature_data && (
        <div style={{ marginTop: 12 }}>
          <strong>Signature:</strong>
          <div style={{ marginTop: 8, maxWidth: 400, border: "1px solid #ccc", background: "#fff" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={row.signature_data} alt="Signature" style={{ maxWidth: "100%", height: "auto", display: "block" }} />
          </div>
        </div>
      )}
    </div>
  );
}
