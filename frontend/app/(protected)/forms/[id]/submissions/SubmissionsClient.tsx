"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "../../forms.module.css";
import { apiUrl } from "../../../../../lib/api";
import { useAuth } from "../../../../../context/AuthContext";
import type { FormField, FormSummary } from "../../types";
import SubmissionSidebar from "./SubmissionSidebar";

type SubmissionSummary = {
  id: number;
  status: string;
  submitted_at: string;
  contact_name: string | null;
  contact_email: string | null;
  property_name: string | null;
};

type FullSubmission = {
  id: number;
  formId: number;
  submissionData: Record<string, unknown>;
  status: string;
  submittedAt: string;
  contactName: string | null;
  contactEmail: string | null;
  notes: string | null;
};

export default function SubmissionsClient({ formId }: { formId: string }) {
  const { authHeaders, token } = useAuth();
  const [form, setForm] = useState<FormSummary | null>(null);
  const [fields, setFields] = useState<FormField[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<"all" | "submitted" | "reviewed" | "archived">("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<FullSubmission | null>(null);
  const [selectedFields, setSelectedFields] = useState<FormField[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [exportOpen, setExportOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const exportWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!exportWrapRef.current?.contains(e.target as Node)) setExportOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const loadForm = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl(`/forms/${formId}`), {
        headers: { ...authHeaders() }, cache: "no-store",
      });
      if (res.ok) {
        const body = await res.json();
        setForm(body.form);
        setFields(body.fields || []);
      }
    } catch {/* ignore */}
  }, [formId, authHeaders, token]);

  const loadSubmissions = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (status !== "all") params.set("status", status);
      if (search) params.set("search", search);
      const res = await fetch(apiUrl(`/forms/${formId}/submissions?${params.toString()}`), {
        headers: { ...authHeaders() }, cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Load failed.");
      setSubmissions(body.submissions || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load submissions.");
    } finally {
      setLoading(false);
    }
  }, [formId, authHeaders, token, status, search]);

  useEffect(() => { loadForm(); }, [loadForm]);
  useEffect(() => { loadSubmissions(); }, [loadSubmissions]);

  const openSubmission = async (id: number) => {
    try {
      const res = await fetch(apiUrl(`/forms/submissions/${id}`), {
        headers: { ...authHeaders() }, cache: "no-store",
      });
      const body = await res.json();
      if (res.ok) {
        setSelected(body.submission);
        setSelectedFields(body.fields || []);
      }
    } catch {/* ignore */}
  };

  const updateStatus = async (newStatus: "submitted" | "reviewed" | "archived") => {
    if (!selected) return;
    try {
      const res = await fetch(apiUrl(`/forms/submissions/${selected.id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        const body = await res.json();
        setSelected(body.submission);
        await loadSubmissions();
      }
    } catch {/* ignore */}
  };

  const deleteSubmission = async (id: number) => {
    if (!confirm("Delete this submission? This cannot be undone.")) return;
    try {
      await fetch(apiUrl(`/forms/submissions/${id}`), {
        method: "DELETE", headers: { ...authHeaders() },
      });
      setSelected(null);
      await loadSubmissions();
    } catch {/* ignore */}
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const exportAs = async (format: "csv" | "xlsx") => {
    setExportOpen(false);
    setExportBusy(true);
    try {
      const params = new URLSearchParams();
      params.set("format", format);
      if (status !== "all") params.set("status", status);
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      const res = await fetch(apiUrl(`/forms/${formId}/submissions/export?${params.toString()}`), {
        headers: { ...authHeaders() },
      });
      if (!res.ok) throw new Error("Export failed.");
      const blob = await res.blob();
      const name = `${form?.name || "form"}_submissions.${format === "xlsx" ? "xlsx" : "csv"}`;
      downloadBlob(blob, name);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExportBusy(false);
    }
  };

  const exportPdfZip = async (scope: "all" | "selected") => {
    setExportOpen(false);
    if (scope === "selected" && selectedIds.size === 0) {
      alert("Select at least one submission first.");
      return;
    }
    setExportBusy(true);
    try {
      const body: Record<string, unknown> = {};
      if (scope === "selected") body.submissionIds = Array.from(selectedIds);
      if (status !== "all") body.status = status;
      if (dateFrom) body.from = dateFrom;
      if (dateTo) body.to = dateTo;
      const res = await fetch(apiUrl(`/forms/${formId}/submissions/export-pdf`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("PDF export failed.");
      const blob = await res.blob();
      const name = `${form?.name || "form"}_PDFs.zip`;
      downloadBlob(blob, name);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "PDF export failed.");
    } finally {
      setExportBusy(false);
    }
  };

  const downloadSinglePdf = async (submissionId: number) => {
    try {
      const res = await fetch(apiUrl(`/forms/submissions/${submissionId}/pdf`), {
        headers: { ...authHeaders() },
      });
      if (!res.ok) throw new Error("PDF failed.");
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="([^"]+)"/);
      const name = match ? match[1] : `submission-${submissionId}.pdf`;
      downloadBlob(blob, name);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "PDF download failed.");
    }
  };

  const renderValue = (value: unknown, field: FormField): React.ReactNode => {
    if (value == null || value === "") return <span style={{ color: "#9aa3ac" }}>—</span>;
    if (Array.isArray(value)) {
      if (value.length && typeof value[0] === "object") {
        return <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>{value.map((v: Record<string, unknown>, i) => <li key={i}>{String(v.originalName || v.filename || JSON.stringify(v))}</li>)}</ul>;
      }
      return value.join(", ");
    }
    if (typeof value === "object") {
      return <pre style={{ margin: 0, fontSize: "0.85rem", whiteSpace: "pre-wrap" }}>{JSON.stringify(value, null, 2)}</pre>;
    }
    if (field.fieldType === "signature" && typeof value === "string" && value.startsWith("data:image")) {
      return <img src={value} alt="Signature" style={{ maxHeight: 100, border: "1px solid rgba(27,40,86,0.15)", borderRadius: 4 }} />;
    }
    return String(value);
  };

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <div className={styles.titleBlock}>
          <h1>{form?.name || "Submissions"}</h1>
          <p>{submissions.length} submissions</p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Link href={`/forms/builder/${formId}`} className={`${styles.btn} ${styles.btnGhost}`}>
            ← Back to builder
          </Link>
          <div ref={exportWrapRef} className={styles.dropdownWrap}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => setExportOpen((o) => !o)}
              disabled={exportBusy}
            >
              {exportBusy ? "Exporting…" : "Export ▾"}
            </button>
            {exportOpen ? (
              <div className={styles.dropdownMenu}>
                <button type="button" className={styles.dropdownItem} onClick={() => exportAs("csv")}>
                  Export as CSV
                </button>
                <button type="button" className={styles.dropdownItem} onClick={() => exportAs("xlsx")}>
                  Export as Excel
                </button>
                <button type="button" className={styles.dropdownItem} onClick={() => exportPdfZip("all")}>
                  Export all as PDF (zip)
                </button>
                <button
                  type="button"
                  className={styles.dropdownItem}
                  onClick={() => exportPdfZip("selected")}
                  disabled={selectedIds.size === 0}
                >
                  Export selected as PDF ({selectedIds.size})
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div className={styles.main}>
        {err ? <div className={styles.errorBanner}>{err}</div> : null}

        {selected ? (
          <div>
            <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setSelected(null)} style={{ marginBottom: "1rem" }}>
              ← Back to list
            </button>
            <div className={styles.subLayout}>
              <div className={styles.subDetail}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem", gap: "1rem", flexWrap: "wrap" }}>
                  <div>
                    <h2 style={{ margin: 0, color: "#1b2856" }}>Submission #{selected.id}</h2>
                    <p style={{ margin: "0.25rem 0 0", fontSize: "0.85rem", color: "#6a737b" }}>
                      Submitted {new Date(selected.submittedAt).toLocaleString()}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: "0.35rem", alignItems: "center", flexWrap: "wrap" }}>
                    <select
                      className={styles.select}
                      value={selected.status}
                      onChange={(e) => updateStatus(e.target.value as "submitted" | "reviewed" | "archived")}
                    >
                      <option value="submitted">Submitted</option>
                      <option value="pending_approval">Pending Approval</option>
                      <option value="approved">Approved</option>
                      <option value="rejected">Rejected</option>
                      <option value="reviewed">Reviewed</option>
                      <option value="archived">Archived</option>
                    </select>
                    <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => downloadSinglePdf(selected.id)}>
                      Download PDF
                    </button>
                    <button type="button" className={`${styles.btn} ${styles.btnDanger}`} onClick={() => deleteSubmission(selected.id)}>
                      Delete
                    </button>
                  </div>
                </div>
                {selectedFields
                  .filter((f) => !["heading", "paragraph", "divider", "spacer"].includes(f.fieldType))
                  .map((f) => (
                    <div key={f.id} className={styles.subDetailField}>
                      <div className={styles.subDetailLabel}>{f.label}</div>
                      <div className={styles.subDetailValue}>{renderValue(selected.submissionData[f.fieldKey], f)}</div>
                    </div>
                  ))}
              </div>
              <SubmissionSidebar
                submissionId={selected.id}
                initialStatus={selected.status}
                onChanged={async () => { await openSubmission(selected.id); await loadSubmissions(); }}
              />
            </div>
          </div>
        ) : (
          <>
            <div className={styles.toolbar}>
              <input
                type="search"
                className={styles.searchInput}
                placeholder="Search submissions…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select className={styles.select} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                <option value="all">All</option>
                <option value="submitted">Submitted</option>
                <option value="reviewed">Reviewed</option>
                <option value="archived">Archived</option>
              </select>
              <input
                type="date"
                className={styles.input}
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                aria-label="From date"
              />
              <input
                type="date"
                className={styles.input}
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                aria-label="To date"
              />
              {selectedIds.size > 0 ? (
                <button type="button" className={styles.smallBtn} onClick={clearSelection}>
                  Clear ({selectedIds.size})
                </button>
              ) : null}
            </div>

            {loading ? (
              <div className={styles.loading}>Loading…</div>
            ) : submissions.length === 0 ? (
              <div className={styles.emptyState}>
                <h3>No submissions yet</h3>
                <p>When people submit this form, their responses will appear here.</p>
              </div>
            ) : (
              <table className={styles.subTable}>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>
                      <input
                        type="checkbox"
                        checked={submissions.length > 0 && selectedIds.size === submissions.length}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedIds(new Set(submissions.map((s) => s.id)));
                          else clearSelection();
                        }}
                        aria-label="Select all"
                      />
                    </th>
                    <th>#</th>
                    <th>Submitted</th>
                    <th>Contact</th>
                    <th>Email</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {submissions.map((s) => (
                    <tr key={s.id} onClick={() => openSubmission(s.id)}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(s.id)}
                          onChange={() => toggleSelect(s.id)}
                          aria-label={`Select submission ${s.id}`}
                        />
                      </td>
                      <td>{s.id}</td>
                      <td>{new Date(s.submitted_at).toLocaleString()}</td>
                      <td>{s.contact_name || "—"}</td>
                      <td>{s.contact_email || "—"}</td>
                      <td>
                        <span className={`${styles.statusBadge} ${s.status === "reviewed" ? styles.statusPublished : s.status === "archived" ? styles.statusArchived : styles.statusDraft}`}>
                          {s.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
}
