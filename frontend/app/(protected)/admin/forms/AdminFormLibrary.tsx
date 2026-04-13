"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "../../../../context/AuthContext";
import { apiUrl, ownerTerminationBasePath } from "../../../../lib/api";

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

type TermRow = {
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

type FormTypeInfo = { type: string; label: string; count: number };

type SubmissionListItem = {
  id: string;
  formType: string;
  submitterName: string;
  submittedAt: string;
  status: string;
  summary: string;
  raw: TermRow;
};

const card: CSSProperties = {
  background: WHITE,
  borderRadius: 12,
  padding: "1.25rem",
  border: `1px solid rgba(27, 40, 86, 0.12)`,
  marginBottom: "1.25rem",
};

function badgeStyle(formType: string): CSSProperties {
  if (formType === "owner-termination") {
    return {
      display: "inline-block",
      padding: "0.2rem 0.55rem",
      borderRadius: 999,
      fontSize: "0.72rem",
      fontWeight: 700,
      background: "rgba(0, 152, 208, 0.18)",
      color: NAVY,
    };
  }
  return {
    display: "inline-block",
    padding: "0.2rem 0.55rem",
    borderRadius: 999,
    fontSize: "0.72rem",
    fontWeight: 700,
    background: "rgba(106, 115, 123, 0.2)",
    color: NAVY,
  };
}

function statusBadgeStyle(status: string): CSSProperties {
  const base: CSSProperties = {
    display: "inline-block",
    padding: "0.2rem 0.55rem",
    borderRadius: 999,
    fontSize: "0.72rem",
    fontWeight: 700,
    textTransform: "capitalize" as const,
  };
  if (status === "pending") return { ...base, background: "rgba(197, 150, 12, 0.2)", color: NAVY };
  if (status === "retained") return { ...base, background: "rgba(45, 139, 78, 0.2)", color: NAVY };
  if (status === "completed") return { ...base, background: "rgba(0, 152, 208, 0.2)", color: NAVY };
  return { ...base, background: "rgba(106, 115, 123, 0.2)", color: NAVY };
}

export default function AdminFormLibrary() {
  const searchParams = useSearchParams();
  const { authHeaders } = useAuth();
  const headers = useMemo(() => authHeaders(), [authHeaders]);
  const [types, setTypes] = useState<FormTypeInfo[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const perPage = 25;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<"all" | "owner-termination">("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const t = searchParams.get("type");
    if (t === "owner-termination") setTypeFilter("owner-termination");
  }, [searchParams]);

  useEffect(() => {
    setPage(1);
  }, [searchDebounced]);

  const loadTypes = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/admin/forms/types"), { headers: { ...headers }, cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(body.types)) setTypes(body.types);
    } catch {
      setTypes([]);
    }
  }, [headers]);

  const loadSubmissions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      if (typeFilter !== "all") q.set("formType", typeFilter);
      if (statusFilter !== "all") q.set("status", statusFilter);
      if (/^\d{4}-\d{2}-\d{2}$/.test(startDate)) q.set("startDate", startDate);
      if (/^\d{4}-\d{2}-\d{2}$/.test(endDate)) q.set("endDate", endDate);
      if (searchDebounced) q.set("search", searchDebounced);
      q.set("page", String(page));
      q.set("perPage", String(perPage));
      const res = await fetch(`${apiUrl("/admin/forms/submissions")}?${q}`, {
        headers: { ...headers },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : `HTTP ${res.status}`);
      }
      setSubmissions(Array.isArray(body.submissions) ? body.submissions : []);
      setTotal(typeof body.total === "number" ? body.total : 0);
    } catch (e) {
      setSubmissions([]);
      setError(e instanceof Error ? e.message : "Could not load.");
    } finally {
      setLoading(false);
    }
  }, [headers, typeFilter, statusFilter, startDate, endDate, searchDebounced, page, perPage]);

  useEffect(() => {
    void loadTypes();
  }, [loadTypes]);

  useEffect(() => {
    void loadSubmissions();
  }, [loadSubmissions]);

  async function updateStatus(id: string, status: string) {
    const res = await fetch(`${ownerTerminationBasePath()}/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ status }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(typeof body.error === "string" ? body.error : "Update failed");
      return;
    }
    const item = body.item as TermRow;
    setSubmissions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status: item.status, raw: { ...s.raw, ...item } } : s))
    );
  }

  async function exportCsv() {
    const res = await fetch(`${ownerTerminationBasePath()}/export.csv`, {
      headers: { ...headers },
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

  const otCount = types.find((x) => x.type === "owner-termination")?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

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
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <header style={{ marginBottom: "1.5rem" }}>
          <div style={{ fontSize: "1.25rem", fontWeight: 800, color: NAVY }}>Real Property Management Prestige</div>
          <h1 style={{ margin: "0.35rem 0 0", fontSize: "1.35rem", color: LIGHT_BLUE }}>Form Submission Library</h1>
        </header>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "1.25rem", alignItems: "flex-start" }}>
          <nav
            style={{
              ...card,
              marginBottom: 0,
              minWidth: 220,
              flex: "0 0 auto",
            }}
            aria-label="Form types"
          >
            <p style={{ margin: "0 0 0.65rem", fontSize: "0.78rem", fontWeight: 800, color: GREY, textTransform: "uppercase" }}>
              Form types
            </p>
            <button
              type="button"
              onClick={() => {
                setTypeFilter("all");
                setPage(1);
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "0.5rem 0.65rem",
                marginBottom: 6,
                borderRadius: 8,
                border: typeFilter === "all" ? `2px solid ${LIGHT_BLUE}` : "1px solid rgba(27,40,86,0.12)",
                background: typeFilter === "all" ? "rgba(0,152,208,0.08)" : WHITE,
                fontWeight: 600,
                cursor: "pointer",
                color: NAVY,
              }}
            >
              All Submissions
            </button>
            <button
              type="button"
              onClick={() => {
                setTypeFilter("owner-termination");
                setPage(1);
              }}
              style={{
                display: "flex",
                width: "100%",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                textAlign: "left",
                padding: "0.5rem 0.65rem",
                borderRadius: 8,
                border: typeFilter === "owner-termination" ? `2px solid ${LIGHT_BLUE}` : "1px solid rgba(27,40,86,0.12)",
                background: typeFilter === "owner-termination" ? "rgba(0,152,208,0.08)" : WHITE,
                fontWeight: 600,
                cursor: "pointer",
                color: NAVY,
              }}
            >
              <span>Owner Termination Requests</span>
              <span
                style={{
                  fontSize: "0.72rem",
                  background: "rgba(27,40,86,0.08)",
                  padding: "0.15rem 0.45rem",
                  borderRadius: 999,
                }}
              >
                {otCount}
              </span>
            </button>
          </nav>

          <div style={{ flex: "1 1 480px", minWidth: 0 }}>
            <section style={card}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 12 }}>
                <label style={{ fontWeight: 600, fontSize: "0.85rem" }}>
                  From
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                      setStartDate(e.target.value);
                      setPage(1);
                    }}
                    style={{ display: "block", marginTop: 4, padding: "0.35rem", borderRadius: 8, border: `1px solid rgba(27,40,86,0.15)` }}
                  />
                </label>
                <label style={{ fontWeight: 600, fontSize: "0.85rem" }}>
                  To
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => {
                      setEndDate(e.target.value);
                      setPage(1);
                    }}
                    style={{ display: "block", marginTop: 4, padding: "0.35rem", borderRadius: 8, border: `1px solid rgba(27,40,86,0.15)` }}
                  />
                </label>
                <label style={{ fontWeight: 600, fontSize: "0.85rem" }}>
                  Status
                  <select
                    value={statusFilter}
                    onChange={(e) => {
                      setStatusFilter(e.target.value);
                      setPage(1);
                    }}
                    style={{ display: "block", marginTop: 4, padding: "0.35rem", borderRadius: 8, minWidth: 140 }}
                  >
                    <option value="all">All</option>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ fontWeight: 600, fontSize: "0.85rem", flex: "1 1 200px" }}>
                  Search
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Name, email, address…"
                    style={{
                      display: "block",
                      marginTop: 4,
                      width: "100%",
                      padding: "0.35rem 0.5rem",
                      borderRadius: 8,
                      border: `1px solid rgba(27,40,86,0.15)`,
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => loadSubmissions()}
                  disabled={loading}
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
                  style={{
                    background: "transparent",
                    color: NAVY,
                    border: `1px solid ${NAVY}`,
                    borderRadius: 8,
                    padding: "0.45rem 1rem",
                    fontWeight: 600,
                    cursor: "pointer",
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

              {!loading && (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
                    <thead>
                      <tr style={{ textAlign: "left", borderBottom: `2px solid ${LIGHT_BLUE}` }}>
                        <th style={{ padding: "0.5rem" }}>Form Type</th>
                        <th style={{ padding: "0.5rem" }}>Submitter</th>
                        <th style={{ padding: "0.5rem" }}>Submitted</th>
                        <th style={{ padding: "0.5rem" }}>Status</th>
                        <th style={{ padding: "0.5rem" }}>Key Details</th>
                        <th style={{ padding: "0.5rem" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {submissions.map((s) => (
                        <Fragment key={s.id}>
                          <tr
                            onClick={() => setExpanded((e) => (e === s.id ? null : s.id))}
                            style={{
                              borderBottom: "1px solid #ddd",
                              cursor: "pointer",
                              background: expanded === s.id ? "rgba(0,152,208,0.08)" : undefined,
                            }}
                          >
                            <td style={{ padding: "0.55rem 0.5rem" }}>
                              <span style={badgeStyle(s.formType)}>
                                {s.formType === "owner-termination" ? "Owner Termination" : s.formType}
                              </span>
                            </td>
                            <td style={{ padding: "0.55rem 0.5rem" }}>{s.submitterName}</td>
                            <td style={{ padding: "0.55rem 0.5rem", whiteSpace: "nowrap" }}>
                              {new Date(s.submittedAt).toLocaleString()}
                            </td>
                            <td style={{ padding: "0.55rem 0.5rem" }} onClick={(ev) => ev.stopPropagation()}>
                              <span style={statusBadgeStyle(s.status)}>{s.status.replace(/_/g, " ")}</span>
                            </td>
                            <td style={{ padding: "0.55rem 0.5rem", maxWidth: 280 }}>{s.summary}</td>
                            <td style={{ padding: "0.55rem 0.5rem" }} onClick={(ev) => ev.stopPropagation()}>
                              <button
                                type="button"
                                style={{
                                  background: "transparent",
                                  border: "none",
                                  color: LIGHT_BLUE,
                                  fontWeight: 700,
                                  cursor: "pointer",
                                  textDecoration: "underline",
                                }}
                                onClick={() => setExpanded(s.id)}
                              >
                                View Details
                              </button>
                            </td>
                          </tr>
                          {expanded === s.id ? (
                            <tr>
                              <td colSpan={6} style={{ padding: "0 1rem 1rem", background: "#fafafa" }}>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
                                  <DetailPanel row={s.raw} />
                                  <div style={{ minWidth: 200 }}>
                                    <p style={{ margin: "0 0 0.5rem", fontWeight: 700, fontSize: "0.85rem" }}>Status</p>
                                    <select
                                      value={s.raw.status}
                                      onChange={(e) => updateStatus(s.id, e.target.value)}
                                      style={{ padding: "0.35rem", borderRadius: 8, width: "100%" }}
                                    >
                                      {STATUSES.map((st) => (
                                        <option key={st} value={st}>
                                          {st.replace(/_/g, " ")}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                  {submissions.length === 0 && !error ? <p style={{ color: GREY }}>No records.</p> : null}
                </div>
              )}

              {totalPages > 1 ? (
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    disabled={page <= 1 || loading}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    style={{ padding: "0.35rem 0.75rem", borderRadius: 8, border: `1px solid ${NAVY}`, background: WHITE, cursor: page <= 1 ? "not-allowed" : "pointer" }}
                  >
                    Previous
                  </button>
                  <span style={{ fontSize: "0.85rem", color: GREY }}>
                    Page {page} of {totalPages} ({total} total)
                  </span>
                  <button
                    type="button"
                    disabled={page >= totalPages || loading}
                    onClick={() => setPage((p) => p + 1)}
                    style={{ padding: "0.35rem 0.75rem", borderRadius: 8, border: `1px solid ${NAVY}`, background: WHITE, cursor: page >= totalPages ? "not-allowed" : "pointer" }}
                  >
                    Next
                  </button>
                </div>
              ) : null}
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}

function DetailPanel({ row }: { row: TermRow }) {
  return (
    <div style={{ fontSize: "0.88rem", lineHeight: 1.55, color: "#333", flex: "1 1 320px" }}>
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
        <strong>Reason:</strong> {REASON_LABELS[row.termination_reason] ?? row.termination_reason}
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
