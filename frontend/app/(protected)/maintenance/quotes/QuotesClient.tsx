"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, FileText, Trash2 } from "lucide-react";
import { apiUrl } from "../../../../lib/api";
import { useAuth } from "../../../../context/AuthContext";
import styles from "./quotes.module.css";
import {
  STATUS_LABELS,
  type LineKind,
  type Quote,
  type QuoteLine,
  type QuoteStatus,
} from "./types";

const STATUS_FILTERS: Array<{ value: QuoteStatus | ""; label: string }> = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

function statusBadgeClass(s: QuoteStatus): string {
  switch (s) {
    case "approved":
      return styles.badgeApproved;
    case "sent":
      return styles.badgeSent;
    case "rejected":
      return styles.badgeRejected;
    default:
      return styles.badgeDraft;
  }
}

export default function QuotesClient() {
  const { authHeaders, token } = useAuth();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<QuoteStatus | "">("");
  const [newOpen, setNewOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(apiUrl(`/maintenance/quotes?${params.toString()}`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Load failed.");
      setQuotes(body.quotes || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load quotes.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Quotes</h1>
          <p className={styles.subtitle}>
            Build line-item quotes, send for owner sign-off via PrestigeSign, and
            approve to schedule the work.
          </p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={load} disabled={loading}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => setNewOpen(true)}
          >
            <Plus size={14} /> New Quote
          </button>
        </div>
      </header>

      <div className={styles.searchRow}>
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value || "all"}
            type="button"
            className={`${styles.chip} ${statusFilter === f.value ? styles.chipActive : ""}`}
            onClick={() => setStatusFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {err ? <div className={styles.errorBanner}>{err}</div> : null}

      <div className={styles.card}>
        {loading ? (
          <div className={styles.loading}>Loading quotes…</div>
        ) : quotes.length === 0 ? (
          <div className={styles.empty}>
            <FileText size={28} color="var(--text-secondary, #6a737b)" />
            <p>{statusFilter ? "No quotes match that filter." : "No quotes yet. Create one from a job."}</p>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Quote</th>
                  <th>Job / Property</th>
                  <th>Status</th>
                  <th className={styles.num}>Lines</th>
                  <th className={styles.num}>Total</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((q) => (
                  <tr key={q.id} className={styles.rowLink} onClick={() => setEditId(q.id)}>
                    <td>
                      <strong>{q.title || `Quote #${q.id}`}</strong>
                    </td>
                    <td>
                      {q.jobTitle || `Job #${q.jobId}`}
                      {q.propertyName ? <span className={styles.muted}> · {q.propertyName}</span> : null}
                    </td>
                    <td>
                      <span className={`${styles.badge} ${statusBadgeClass(q.status)}`}>
                        {STATUS_LABELS[q.status]}
                      </span>
                    </td>
                    <td className={styles.num}>{q.lineCount}</td>
                    <td className={styles.num}>{money(q.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {newOpen ? (
        <NewQuoteModal
          onClose={() => setNewOpen(false)}
          onCreated={(id) => {
            setNewOpen(false);
            load();
            setEditId(id);
          }}
        />
      ) : null}

      {editId != null ? (
        <QuoteEditor
          quoteId={editId}
          onClose={() => setEditId(null)}
          onChanged={load}
        />
      ) : null}
    </div>
  );
}

function NewQuoteModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const { authHeaders, token } = useAuth();
  const [jobs, setJobs] = useState<Array<{ id: number; title: string; propertyName?: string }>>([]);
  const [jobId, setJobId] = useState("");
  const [title, setTitle] = useState("");
  const [markup, setMarkup] = useState("0");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl("/maintenance/jobs"), {
          headers: { ...authHeaders() },
          cache: "no-store",
        });
        const body = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) setJobs(body.jobs || []);
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, authHeaders]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!jobId) {
      setErr("Pick a job.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(apiUrl("/maintenance/quotes"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          jobId: Number(jobId),
          title: title.trim() || null,
          markupPct: markup.trim() ? Number(markup) : 0,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Create failed.");
      onCreated(body.quote.id);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Could not create quote.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={`${styles.modal} ${styles.modalSmall}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div className={styles.modalHeaderMain}>
            <h2>New Quote</h2>
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form className={styles.modalBody} onSubmit={submit}>
          {err ? <div className={styles.errorBanner}>{err}</div> : null}
          <div className={styles.field}>
            <label>Job</label>
            <select value={jobId} onChange={(e) => setJobId(e.target.value)} required>
              <option value="">Select a job…</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title}
                  {j.propertyName ? ` — ${j.propertyName}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label>Title (optional)</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. HVAC compressor replacement" />
          </div>
          <div className={styles.field}>
            <label>Markup %</label>
            <input type="number" min="0" step="0.5" value={markup} onChange={(e) => setMarkup(e.target.value)} />
          </div>
          <div className={styles.formFooter}>
            <button type="button" className={styles.btn} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving}>
              {saving ? "Creating…" : "Create & Edit"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function QuoteEditor({
  quoteId,
  onClose,
  onChanged,
}: {
  quoteId: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { authHeaders, token } = useAuth();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [lines, setLines] = useState<QuoteLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Header edit state.
  const [title, setTitle] = useState("");
  const [markup, setMarkup] = useState("0");

  // Add-line form.
  const [lKind, setLKind] = useState<LineKind>("labor");
  const [lDesc, setLDesc] = useState("");
  const [lQty, setLQty] = useState("1");
  const [lCost, setLCost] = useState("0");

  // E-sign form.
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [billDraftOpen, setBillDraftOpen] = useState(false);

  const readOnly = quote?.status === "approved" || quote?.status === "rejected";

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(apiUrl(`/maintenance/quotes/${quoteId}`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Load failed.");
      setQuote(body.quote);
      setLines(body.lines || []);
      setTitle(body.quote?.title ?? "");
      setMarkup(String(body.quote?.markupPct ?? 0));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load quote.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token, quoteId]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = useMemo(() => {
    const subtotal = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitCost) || 0), 0);
    const markupAmount = subtotal * (Number(markup) || 0) / 100;
    return {
      subtotal: Math.round(subtotal * 100) / 100,
      markupAmount: Math.round(markupAmount * 100) / 100,
      total: Math.round((subtotal + markupAmount) * 100) / 100,
    };
  }, [lines, markup]);

  const api = useCallback(
    async (path: string, method: string, bodyObj?: unknown) => {
      const res = await fetch(apiUrl(path), {
        method,
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: bodyObj ? JSON.stringify(bodyObj) : undefined,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Request failed.");
      return body;
    },
    [authHeaders]
  );

  const saveHeader = async () => {
    setErr(null);
    setOk(null);
    try {
      await api(`/maintenance/quotes/${quoteId}`, "PUT", {
        title: title.trim() || null,
        markupPct: markup.trim() ? Number(markup) : 0,
      });
      setOk("Saved.");
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed.");
    }
  };

  const addLine = async () => {
    setErr(null);
    if (!lDesc.trim()) {
      setErr("Line description is required.");
      return;
    }
    try {
      const body = await api(`/maintenance/quotes/${quoteId}/lines`, "POST", {
        kind: lKind,
        description: lDesc.trim(),
        qty: Number(lQty) || 0,
        unitCost: Number(lCost) || 0,
      });
      setLines((prev) => [...prev, body.line]);
      setLDesc("");
      setLQty("1");
      setLCost("0");
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add line.");
    }
  };

  const patchLine = async (line: QuoteLine, patch: Partial<QuoteLine>) => {
    // Optimistic local update; persist on the changed field.
    setLines((prev) => prev.map((l) => (l.id === line.id ? { ...l, ...patch } : l)));
    try {
      await api(`/maintenance/quotes/${quoteId}/lines/${line.id}`, "PUT", patch);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not update line.");
      load();
    }
  };

  const removeLine = async (id: number) => {
    try {
      await api(`/maintenance/quotes/${quoteId}/lines/${id}`, "DELETE");
      setLines((prev) => prev.filter((l) => l.id !== id));
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not delete line.");
    }
  };

  const sendEsign = async () => {
    setErr(null);
    setOk(null);
    if (!ownerEmail.trim()) {
      setErr("Owner email is required to send for signature.");
      return;
    }
    try {
      await api(`/maintenance/quotes/${quoteId}/send-esign`, "POST", {
        ownerEmail: ownerEmail.trim(),
        ownerName: ownerName.trim() || undefined,
      });
      setOk("Sent for e-signature via PrestigeSign.");
      await load();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not send for signature.");
    }
  };

  const decide = async (action: "approve" | "decline") => {
    setErr(null);
    setOk(null);
    try {
      const body = await api(`/maintenance/quotes/${quoteId}/${action}`, "POST");
      setOk(
        action === "approve"
          ? body.jobAdvanced
            ? "Approved — the linked job was moved to Scheduled."
            : "Approved."
          : "Marked declined."
      );
      await load();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Action failed.");
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div className={styles.modalHeaderMain}>
            <h2>{quote?.title || `Quote #${quoteId}`}</h2>
            {quote ? (
              <span className={`${styles.badge} ${statusBadgeClass(quote.status)}`}>
                {STATUS_LABELS[quote.status]}
              </span>
            ) : null}
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className={styles.modalBody}>
          {err ? <div className={styles.errorBanner}>{err}</div> : null}
          {ok ? <div className={styles.okBanner}>{ok}</div> : null}

          {loading || !quote ? (
            <div className={styles.loading}>Loading…</div>
          ) : (
            <>
              <p className={styles.metaLine}>
                {quote.jobTitle}
                {quote.propertyName ? ` · ${quote.propertyName}` : ""}
                {quote.esignStatus ? ` · PrestigeSign: ${quote.esignStatus}` : ""}
              </p>

              {!readOnly ? (
                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <label>Title</label>
                    <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveHeader} />
                  </div>
                  <div className={styles.field}>
                    <label>Markup %</label>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={markup}
                      onChange={(e) => setMarkup(e.target.value)}
                      onBlur={saveHeader}
                    />
                  </div>
                </div>
              ) : null}

              <div className={styles.sectionLabel}>Line items</div>
              <table className={styles.lineTable}>
                <thead>
                  <tr>
                    <th style={{ width: 110 }}>Kind</th>
                    <th>Description</th>
                    <th style={{ width: 70 }} className={styles.num}>Qty</th>
                    <th style={{ width: 100 }} className={styles.num}>Unit $</th>
                    <th style={{ width: 90 }} className={styles.num}>Total</th>
                    {!readOnly ? <th style={{ width: 30 }} /> : null}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td>
                        {readOnly ? (
                          <span style={{ textTransform: "capitalize" }}>{l.kind}</span>
                        ) : (
                          <select
                            className={styles.kindSelect}
                            value={l.kind}
                            onChange={(e) => patchLine(l, { kind: e.target.value as LineKind })}
                          >
                            <option value="labor">Labor</option>
                            <option value="material">Material</option>
                          </select>
                        )}
                      </td>
                      <td>
                        {readOnly ? (
                          l.description
                        ) : (
                          <input
                            className={styles.lineInput}
                            defaultValue={l.description}
                            onBlur={(e) => {
                              if (e.target.value.trim() && e.target.value !== l.description)
                                patchLine(l, { description: e.target.value.trim() });
                            }}
                          />
                        )}
                      </td>
                      <td className={styles.num}>
                        {readOnly ? (
                          l.qty
                        ) : (
                          <input
                            className={`${styles.lineInput} ${styles.lineInputNum}`}
                            type="number"
                            min="0"
                            step="0.25"
                            defaultValue={l.qty}
                            onBlur={(e) => {
                              const v = Number(e.target.value);
                              if (v >= 0 && v !== l.qty) patchLine(l, { qty: v });
                            }}
                          />
                        )}
                      </td>
                      <td className={styles.num}>
                        {readOnly ? (
                          money(l.unitCost)
                        ) : (
                          <input
                            className={`${styles.lineInput} ${styles.lineInputNum}`}
                            type="number"
                            min="0"
                            step="0.01"
                            defaultValue={l.unitCost}
                            onBlur={(e) => {
                              const v = Number(e.target.value);
                              if (v >= 0 && v !== l.unitCost) patchLine(l, { unitCost: v });
                            }}
                          />
                        )}
                      </td>
                      <td className={styles.num}>{money((Number(l.qty) || 0) * (Number(l.unitCost) || 0))}</td>
                      {!readOnly ? (
                        <td>
                          <button
                            type="button"
                            className={styles.iconBtn}
                            onClick={() => removeLine(l.id)}
                            aria-label="Remove line"
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                  {lines.length === 0 ? (
                    <tr>
                      <td colSpan={readOnly ? 5 : 6} className={styles.muted} style={{ padding: "0.6rem 0.4rem" }}>
                        No line items yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>

              {!readOnly ? (
                <table className={styles.lineTable} style={{ marginTop: "0.4rem" }}>
                  <tbody>
                    <tr>
                      <td style={{ width: 110 }}>
                        <select
                          className={styles.kindSelect}
                          value={lKind}
                          onChange={(e) => setLKind(e.target.value as LineKind)}
                        >
                          <option value="labor">Labor</option>
                          <option value="material">Material</option>
                        </select>
                      </td>
                      <td>
                        <input
                          className={styles.lineInput}
                          value={lDesc}
                          onChange={(e) => setLDesc(e.target.value)}
                          placeholder="Add a line item…"
                        />
                      </td>
                      <td style={{ width: 70 }}>
                        <input
                          className={`${styles.lineInput} ${styles.lineInputNum}`}
                          type="number"
                          min="0"
                          step="0.25"
                          value={lQty}
                          onChange={(e) => setLQty(e.target.value)}
                        />
                      </td>
                      <td style={{ width: 100 }}>
                        <input
                          className={`${styles.lineInput} ${styles.lineInputNum}`}
                          type="number"
                          min="0"
                          step="0.01"
                          value={lCost}
                          onChange={(e) => setLCost(e.target.value)}
                        />
                      </td>
                      <td style={{ width: 90 }} />
                      <td style={{ width: 30 }}>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnSmall}`}
                          onClick={addLine}
                        >
                          Add
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              ) : null}

              <div className={styles.totals}>
                <div className={styles.totalRow}>
                  <span>Subtotal</span>
                  <span>{money(totals.subtotal)}</span>
                </div>
                <div className={styles.totalRow}>
                  <span>Markup ({Number(markup) || 0}%)</span>
                  <span>{money(totals.markupAmount)}</span>
                </div>
                <div className={`${styles.totalRow} ${styles.grandTotal}`}>
                  <span>Total</span>
                  <span>{money(totals.total)}</span>
                </div>
              </div>

              {/* Owner approval / PrestigeSign */}
              {!readOnly ? (
                <>
                  <div className={styles.sectionLabel}>Owner approval</div>
                  <div className={styles.approvalBar}>
                    <input
                      type="email"
                      value={ownerEmail}
                      onChange={(e) => setOwnerEmail(e.target.value)}
                      placeholder="Owner email"
                    />
                    <input
                      value={ownerName}
                      onChange={(e) => setOwnerName(e.target.value)}
                      placeholder="Owner name (optional)"
                    />
                    <button type="button" className={styles.btn} onClick={sendEsign} disabled={lines.length === 0}>
                      Send for e-signature
                    </button>
                  </div>
                  <div className={styles.formFooter}>
                    <button type="button" className={`${styles.btn} ${styles.btnDanger}`} onClick={() => decide("decline")}>
                      Mark declined
                    </button>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnSuccess}`}
                      onClick={() => decide("approve")}
                      disabled={lines.length === 0}
                    >
                      Approve
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className={styles.sectionLabel}>
                    {quote.status === "approved" ? "Approved" : "Declined"}
                  </div>
                  {quote.status === "approved" ? (
                    <div className={styles.formFooter}>
                      <button type="button" className={styles.btn} onClick={() => setBillDraftOpen(true)}>
                        View AppFolio bill draft
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {billDraftOpen ? (
        <BillDraftModal quoteId={quoteId} onClose={() => setBillDraftOpen(false)} />
      ) : null}
    </div>
  );
}

function BillDraftModal({ quoteId, onClose }: { quoteId: number; onClose: () => void }) {
  const { authHeaders, token } = useAuth();
  const [data, setData] = useState<{
    lines: QuoteLine[];
    subtotal: number;
    markupAmount: number;
    total: number;
    markupPct: number;
    propertyName?: string;
    note?: string;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl(`/maintenance/quotes/${quoteId}/bill-draft`), {
          headers: { ...authHeaders() },
          cache: "no-store",
        });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Load failed.");
        setData(body);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Could not load bill draft.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [quoteId, token, authHeaders]);

  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        // Nested inside the editor overlay — stop the backdrop click from
        // bubbling up and closing the editor too.
        e.stopPropagation();
        onClose();
      }}
    >
      <div className={`${styles.modal} ${styles.modalSmall}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div className={styles.modalHeaderMain}>
            <h2>AppFolio Bill Draft</h2>
            <span className={styles.suggestBadge}>Preview only</span>
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className={styles.modalBody}>
          {err ? <div className={styles.errorBanner}>{err}</div> : null}
          {!data ? (
            <div className={styles.loading}>Loading…</div>
          ) : (
            <>
              <p className={styles.metaLine}>{data.propertyName}</p>
              <table className={styles.lineTable}>
                <thead>
                  <tr>
                    <th>Description</th>
                    <th className={styles.num}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <span style={{ textTransform: "capitalize" }}>{l.kind}</span> — {l.description}
                      </td>
                      <td className={styles.num}>{money(l.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className={styles.totals}>
                <div className={styles.totalRow}>
                  <span>Subtotal</span>
                  <span>{money(data.subtotal)}</span>
                </div>
                <div className={styles.totalRow}>
                  <span>Markup ({data.markupPct}%)</span>
                  <span>{money(data.markupAmount)}</span>
                </div>
                <div className={`${styles.totalRow} ${styles.grandTotal}`}>
                  <span>Total</span>
                  <span>{money(data.total)}</span>
                </div>
              </div>
              <p className={styles.metaLine} style={{ marginTop: "0.75rem" }}>
                {data.note}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
