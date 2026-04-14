"use client";

import type { CSSProperties } from "react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../../context/AuthContext";
import { apiUrl, walkthruBasePath } from "../../../../lib/api";

const NAVY = "#1B2856";
const LIGHT_BLUE = "#0098D0";
const RED = "#B32317";
const GREY = "#6A737B";
const WHITE = "#FFFFFF";
const OFF_WHITE = "#F5F5F5";

type WalkthruItem = {
  id: number;
  roomId: number;
  itemName: string;
  itemOrder: number;
  status: "pending" | "no_issues" | "has_issues" | "not_applicable";
  comment: string;
  photoFilenames: string[];
};

type WalkthruRoom = {
  id: number;
  reportId: number;
  roomName: string;
  roomOrder: number;
  isCustom: boolean;
  items: WalkthruItem[];
};

type WalkthruReport = {
  id: number;
  reportType: "move_in" | "move_out";
  status: "in_progress" | "completed" | "reviewed";
  propertyAddress: string;
  unitNumber: string | null;
  residentName: string;
  residentEmail: string | null;
  residentPhone: string | null;
  leaseStartDate: string | null;
  leaseEndDate: string | null;
  reportDate: string | null;
  formUrl: string;
  dashboardUrl: string;
  totalItems?: number;
  completedItems?: number;
  createdAt?: string;
  completedAt?: string | null;
  linkedFileId?: number | null;
};

type WalkthruReportFull = {
  report: WalkthruReport;
  rooms: WalkthruRoom[];
};

const card: CSSProperties = {
  background: WHITE,
  borderRadius: 12,
  border: "1px solid rgba(27, 40, 86, 0.12)",
  padding: "1rem",
};

function statusColor(status: WalkthruReport["status"]) {
  if (status === "completed") return { bg: "rgba(46, 125, 107, 0.14)", fg: "#1a6c59" };
  if (status === "reviewed") return { bg: "rgba(0, 152, 208, 0.15)", fg: NAVY };
  return { bg: "rgba(197, 150, 12, 0.18)", fg: "#7a5d00" };
}

function fmtDate(v?: string | null) {
  if (!v) return "-";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString();
}

function titleCaseType(type: WalkthruReport["reportType"]) {
  return type === "move_out" ? "Move-Out" : "Move-In";
}

function completedPct(total: number, completed: number) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((completed / total) * 100)));
}

export default function WalkthruAdminPage() {
  const { authHeaders } = useAuth();
  const headers = useMemo(() => authHeaders(), [authHeaders]);

  const [reports, setReports] = useState<WalkthruReport[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | WalkthruReport["status"]>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedReportId, setExpandedReportId] = useState<number | null>(null);
  const [expandedReport, setExpandedReport] = useState<WalkthruReportFull | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      if (statusFilter !== "all") q.set("status", statusFilter);
      if (search.trim()) q.set("search", search.trim());
      const res = await fetch(`${walkthruBasePath()}/reports?${q.toString()}`, {
        cache: "no-store",
        headers: { ...headers },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : `HTTP ${res.status}`);
      setReports(Array.isArray(body.reports) ? body.reports : []);
    } catch (e) {
      setReports([]);
      setError(e instanceof Error ? e.message : "Could not load reports.");
    } finally {
      setLoading(false);
    }
  }, [headers, search, statusFilter]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  async function loadDetail(reportId: number) {
    if (expandedReportId === reportId && expandedReport) {
      setExpandedReportId(null);
      setExpandedReport(null);
      return;
    }
    setExpandedReportId(reportId);
    setExpandedReport(null);
    try {
      const res = await fetch(`${walkthruBasePath()}/reports/${reportId}`, {
        cache: "no-store",
        headers: { ...headers },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : `HTTP ${res.status}`);
      setExpandedReport(body);
    } catch {
      setExpandedReport(null);
    }
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      alert("Walk-thru link copied.");
    } catch {
      alert(url);
    }
  }

  async function sendLink(reportId: number) {
    const res = await fetch(`${walkthruBasePath()}/reports/${reportId}/send-link`, {
      method: "POST",
      headers: { ...headers },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(typeof body.error === "string" ? body.error : "Could not send link.");
      return;
    }
    if (body.sent) {
      alert("Link sent to tenant.");
      return;
    }
    const fallback = body.formUrl || body.dashboardUrl || "Link generated.";
    alert(`Email not sent (${body.reason || "provider unavailable"}). Copy this link:\n${fallback}`);
  }

  async function downloadPdf(reportId: number) {
    const res = await fetch(`${walkthruBasePath()}/reports/${reportId}/pdf`, {
      headers: { ...headers },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(typeof body.error === "string" ? body.error : "Could not download PDF.");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `walkthru-report-${reportId}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function removeReport(reportId: number) {
    if (!confirm("Delete this walk-thru report?")) return;
    const res = await fetch(`${walkthruBasePath()}/reports/${reportId}`, {
      method: "DELETE",
      headers: { ...headers },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(typeof body.error === "string" ? body.error : "Could not delete report.");
      return;
    }
    if (expandedReportId === reportId) {
      setExpandedReportId(null);
      setExpandedReport(null);
    }
    setReports((prev) => prev.filter((r) => r.id !== reportId));
  }

  async function updateStatus(reportId: number, status: WalkthruReport["status"]) {
    const res = await fetch(`${walkthruBasePath()}/reports/${reportId}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ status }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(typeof body.error === "string" ? body.error : "Could not update status.");
      return;
    }
    setReports((prev) =>
      prev.map((r) => (r.id === reportId ? { ...r, status } : r))
    );
    if (expandedReport?.report.id === reportId) {
      setExpandedReport((prev) => (prev ? { ...prev, report: { ...prev.report, status } } : prev));
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: OFF_WHITE,
        padding: "1.25rem clamp(1rem, 4vw, 2rem)",
        color: NAVY,
        fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
      }}
    >
      <div style={{ maxWidth: 1220, margin: "0 auto" }}>
        <header style={{ marginBottom: "1rem" }}>
          <div style={{ color: NAVY, fontWeight: 800, fontSize: "1.25rem" }}>Walk-Thru Reports</div>
          <p style={{ color: GREY, margin: "0.35rem 0 0" }}>
            Tenant move-in/move-out property condition reports
          </p>
        </header>

        <section style={{ ...card, marginBottom: "1rem" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              style={{
                background: LIGHT_BLUE,
                color: WHITE,
                border: "none",
                borderRadius: 8,
                padding: "0.55rem 0.95rem",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Create New Walk-Thru
            </button>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              style={{ borderRadius: 8, padding: "0.45rem" }}
            >
              <option value="all">All Statuses</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="reviewed">Reviewed</option>
            </select>
            <input
              type="search"
              placeholder="Search by property or resident"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                flex: "1 1 260px",
                borderRadius: 8,
                border: "1px solid rgba(27,40,86,0.2)",
                padding: "0.45rem 0.6rem",
              }}
            />
            <button
              type="button"
              onClick={() => loadReports()}
              style={{
                borderRadius: 8,
                border: `1px solid ${NAVY}`,
                background: WHITE,
                color: NAVY,
                padding: "0.45rem 0.8rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Refresh
            </button>
          </div>
          {error ? (
            <p role="alert" style={{ margin: "0.7rem 0 0", color: RED }}>
              {error}
            </p>
          ) : null}
        </section>

        <section style={card}>
          {loading ? (
            <p style={{ color: GREY }}>Loading reports...</p>
          ) : reports.length === 0 ? (
            <p style={{ color: GREY, margin: 0 }}>No walk-thru reports found.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1020 }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid rgba(0,152,208,0.5)", textAlign: "left", fontSize: "0.86rem" }}>
                    <th style={{ padding: "0.5rem" }}>Property</th>
                    <th style={{ padding: "0.5rem" }}>Resident</th>
                    <th style={{ padding: "0.5rem" }}>Type</th>
                    <th style={{ padding: "0.5rem" }}>Status</th>
                    <th style={{ padding: "0.5rem", minWidth: 220 }}>Items Completed</th>
                    <th style={{ padding: "0.5rem" }}>Date</th>
                    <th style={{ padding: "0.5rem" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((report) => {
                    const total = report.totalItems || 0;
                    const done = report.completedItems || 0;
                    const pct = completedPct(total, done);
                    const badge = statusColor(report.status);
                    const open = expandedReportId === report.id;
                    return (
                      <Fragment key={report.id}>
                        <tr style={{ borderBottom: "1px solid rgba(27,40,86,0.1)" }}>
                          <td style={{ padding: "0.6rem 0.5rem" }}>
                            <div style={{ fontWeight: 700 }}>{report.propertyAddress}</div>
                            {report.unitNumber ? (
                              <div style={{ color: GREY, fontSize: "0.82rem" }}>Unit {report.unitNumber}</div>
                            ) : null}
                          </td>
                          <td style={{ padding: "0.6rem 0.5rem" }}>{report.residentName}</td>
                          <td style={{ padding: "0.6rem 0.5rem" }}>{titleCaseType(report.reportType)}</td>
                          <td style={{ padding: "0.6rem 0.5rem" }}>
                            <span
                              style={{
                                display: "inline-block",
                                borderRadius: 999,
                                padding: "0.2rem 0.6rem",
                                background: badge.bg,
                                color: badge.fg,
                                fontWeight: 700,
                                textTransform: "capitalize",
                                fontSize: "0.75rem",
                              }}
                            >
                              {report.status.replace(/_/g, " ")}
                            </span>
                          </td>
                          <td style={{ padding: "0.6rem 0.5rem" }}>
                            <div style={{ fontSize: "0.8rem", color: GREY, marginBottom: 4 }}>
                              {done} of {total} items completed
                            </div>
                            <div style={{ height: 8, borderRadius: 999, background: "rgba(27,40,86,0.12)" }}>
                              <div
                                style={{
                                  width: `${pct}%`,
                                  height: "100%",
                                  borderRadius: 999,
                                  background: pct >= 100 ? "#2E7D6B" : LIGHT_BLUE,
                                }}
                              />
                            </div>
                          </td>
                          <td style={{ padding: "0.6rem 0.5rem", whiteSpace: "nowrap" }}>
                            {fmtDate(report.reportDate || report.createdAt)}
                          </td>
                          <td style={{ padding: "0.6rem 0.5rem" }}>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                              <button style={miniBtn()} onClick={() => loadDetail(report.id)} type="button">
                                {open ? "Hide" : "View"}
                              </button>
                              <button style={miniBtn()} onClick={() => downloadPdf(report.id)} type="button">
                                PDF
                              </button>
                              <button style={miniBtn()} onClick={() => copyLink(report.formUrl || report.dashboardUrl)} type="button">
                                Copy Link
                              </button>
                              <button style={miniBtn()} onClick={() => sendLink(report.id)} type="button">
                                Send
                              </button>
                              {report.status === "completed" ? (
                                <button
                                  style={miniBtn("#2E7D6B")}
                                  onClick={() => updateStatus(report.id, "reviewed")}
                                  type="button"
                                >
                                  Mark Reviewed
                                </button>
                              ) : null}
                              <button style={miniBtn(RED)} onClick={() => removeReport(report.id)} type="button">
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                        {open ? (
                          <tr>
                            <td colSpan={7} style={{ padding: "0.75rem", background: "#fbfcff" }}>
                              {expandedReport?.report.id === report.id ? (
                                <ReportDetail data={expandedReport} />
                              ) : (
                                <p style={{ margin: 0, color: GREY }}>Loading report details...</p>
                              )}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <CreateReportModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        headers={headers}
        onCreated={(newReport) => {
          setCreateOpen(false);
          setReports((prev) => [newReport.report, ...prev]);
          setExpandedReportId(newReport.report.id);
          setExpandedReport(newReport);
        }}
      />
    </main>
  );
}

function miniBtn(color?: string): CSSProperties {
  return {
    borderRadius: 7,
    border: `1px solid ${color || NAVY}`,
    background: WHITE,
    color: color || NAVY,
    padding: "0.2rem 0.45rem",
    fontSize: "0.74rem",
    fontWeight: 700,
    cursor: "pointer",
  };
}

function ReportDetail({ data }: { data: WalkthruReportFull }) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {data.rooms.map((room) => (
        <div key={room.id} style={{ border: "1px solid rgba(27,40,86,0.12)", borderRadius: 10, background: WHITE }}>
          <div
            style={{
              padding: "0.55rem 0.75rem",
              fontWeight: 700,
              borderBottom: "1px solid rgba(27,40,86,0.12)",
              background: "rgba(0,152,208,0.07)",
            }}
          >
            {room.roomName}
          </div>
          <div style={{ padding: "0.65rem 0.75rem" }}>
            {room.items.map((item) => (
              <div
                key={item.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 8,
                  alignItems: "start",
                  padding: "0.45rem 0",
                  borderBottom: "1px dashed rgba(27,40,86,0.12)",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: "0.88rem" }}>{item.itemName}</div>
                  {item.comment ? <div style={{ color: GREY, fontSize: "0.82rem", marginTop: 3 }}>{item.comment}</div> : null}
                </div>
                <div style={{ fontSize: "0.78rem", color: NAVY, textTransform: "capitalize" }}>
                  {item.status.replace(/_/g, " ")}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CreateReportModal({
  open,
  onClose,
  onCreated,
  headers,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (report: WalkthruReportFull) => void;
  headers: HeadersInit;
}) {
  const [reportType, setReportType] = useState<"move_in" | "move_out">("move_in");
  const [propertyAddress, setPropertyAddress] = useState("");
  const [unitNumber, setUnitNumber] = useState("");
  const [residentName, setResidentName] = useState("");
  const [residentEmail, setResidentEmail] = useState("");
  const [residentPhone, setResidentPhone] = useState("");
  const [leaseStartDate, setLeaseStartDate] = useState("");
  const [leaseEndDate, setLeaseEndDate] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [propertyOptions, setPropertyOptions] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setCreatedLink(null);
    fetch(apiUrl("/appfolio/units"), {
      cache: "no-store",
      headers: { ...headers },
    })
      .then(async (res) => {
        if (!res.ok) return [];
        const body = await res.json().catch(() => ({}));
        const units: any[] = Array.isArray(body?.units) ? body.units : [];
        const names = units
          .map((u: any) => String(u?.property_name || u?.propertyName || "").trim())
          .filter(Boolean);
        return Array.from(new Set(names)).slice(0, 150) as string[];
      })
      .then((names: string[]) => setPropertyOptions(names))
      .catch(() => setPropertyOptions([]));
  }, [open, headers]);

  if (!open) return null;

  async function createReport() {
    if (!propertyAddress.trim() || !residentName.trim()) {
      alert("Property address and resident name are required.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch(`${walkthruBasePath()}/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          reportType,
          propertyAddress,
          unitNumber,
          residentName,
          residentEmail,
          residentPhone,
          leaseStartDate,
          leaseEndDate,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : `HTTP ${res.status}`);
      }
      setCreatedLink(body?.report?.formUrl || body?.report?.dashboardUrl || null);
      onCreated(body);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not create report.");
    } finally {
      setCreating(false);
    }
  }

  async function copyCreatedLink() {
    if (!createdLink) return;
    try {
      await navigator.clipboard.writeText(createdLink);
      alert("Link copied.");
    } catch {
      alert(createdLink);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1500,
        background: "rgba(12,20,38,0.45)",
        display: "grid",
        placeItems: "center",
        padding: "1rem",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "min(720px, 100%)",
          background: WHITE,
          borderRadius: 12,
          border: "1px solid rgba(27,40,86,0.2)",
          padding: "1rem",
          maxHeight: "90vh",
          overflow: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Create New Walk-Thru</h2>
          <button type="button" onClick={onClose} style={miniBtn()}>
            Close
          </button>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <label>
            <div style={labelSmall()}>Report Type</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                style={toggleBtn(reportType === "move_in")}
                onClick={() => setReportType("move_in")}
              >
                Move-In
              </button>
              <button
                type="button"
                style={toggleBtn(reportType === "move_out")}
                onClick={() => setReportType("move_out")}
              >
                Move-Out
              </button>
            </div>
          </label>
          <label>
            <div style={labelSmall()}>Property Address *</div>
            <input
              list="walkthru-property-options"
              value={propertyAddress}
              onChange={(e) => setPropertyAddress(e.target.value)}
              style={field()}
            />
            <datalist id="walkthru-property-options">
              {propertyOptions.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </label>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <label>
              <div style={labelSmall()}>Unit Number</div>
              <input value={unitNumber} onChange={(e) => setUnitNumber(e.target.value)} style={field()} />
            </label>
            <label>
              <div style={labelSmall()}>Resident Name *</div>
              <input value={residentName} onChange={(e) => setResidentName(e.target.value)} style={field()} />
            </label>
          </div>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <label>
              <div style={labelSmall()}>Resident Email</div>
              <input type="email" value={residentEmail} onChange={(e) => setResidentEmail(e.target.value)} style={field()} />
            </label>
            <label>
              <div style={labelSmall()}>Resident Phone</div>
              <input value={residentPhone} onChange={(e) => setResidentPhone(e.target.value)} style={field()} />
            </label>
          </div>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <label>
              <div style={labelSmall()}>Lease Start Date</div>
              <input
                type="date"
                value={leaseStartDate}
                onChange={(e) => setLeaseStartDate(e.target.value)}
                style={field()}
              />
            </label>
            <label>
              <div style={labelSmall()}>Lease End Date</div>
              <input type="date" value={leaseEndDate} onChange={(e) => setLeaseEndDate(e.target.value)} style={field()} />
            </label>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              disabled={creating}
              onClick={() => createReport()}
              style={{
                border: "none",
                borderRadius: 8,
                background: LIGHT_BLUE,
                color: WHITE,
                padding: "0.55rem 0.95rem",
                fontWeight: 700,
                cursor: creating ? "wait" : "pointer",
              }}
            >
              {creating ? "Creating..." : "Create & Get Link"}
            </button>
            {createdLink ? (
              <button type="button" onClick={copyCreatedLink} style={miniBtn()}>
                Copy Link
              </button>
            ) : null}
          </div>
          {createdLink ? (
            <div style={{ fontSize: "0.82rem", color: GREY, wordBreak: "break-all" }}>{createdLink}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function labelSmall(): CSSProperties {
  return { fontSize: "0.78rem", color: GREY, fontWeight: 700, marginBottom: 3 };
}

function field(): CSSProperties {
  return {
    width: "100%",
    boxSizing: "border-box",
    borderRadius: 8,
    border: "1px solid rgba(27,40,86,0.2)",
    padding: "0.46rem 0.58rem",
  };
}

function toggleBtn(active: boolean): CSSProperties {
  return {
    borderRadius: 8,
    border: active ? `2px solid ${LIGHT_BLUE}` : "1px solid rgba(27,40,86,0.2)",
    background: active ? "rgba(0,152,208,0.08)" : WHITE,
    color: NAVY,
    padding: "0.45rem 0.8rem",
    fontWeight: 700,
    cursor: "pointer",
  };
}
