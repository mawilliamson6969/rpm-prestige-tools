"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw, Search, Building } from "lucide-react";
import { apiUrl } from "../../../../lib/api";
import { useAuth } from "../../../../context/AuthContext";
import styles from "./subcontractors.module.css";
import {
  coiState,
  type CoiState,
  type Subcontractor,
  type SubRating,
} from "./types";

const COI_LABELS: Record<CoiState, string> = {
  current: "Current",
  expiring: "Expiring",
  expired: "Expired",
  none: "No COI",
};

function coiClass(s: CoiState): string {
  switch (s) {
    case "current":
      return styles.coiCurrent;
    case "expiring":
      return styles.coiExpiring;
    case "expired":
      return styles.coiExpired;
    default:
      return styles.coiNone;
  }
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const t = new Date(d);
  return Number.isNaN(t.getTime())
    ? d
    : t.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function SubcontractorsClient() {
  const { authHeaders, token } = useAuth();
  const [subs, setSubs] = useState<Subcontractor[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [trade, setTrade] = useState("");
  const [zip, setZip] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Subcontractor | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (trade.trim()) params.set("trade", trade.trim());
      if (zip.trim()) params.set("zip", zip.trim());
      const res = await fetch(apiUrl(`/maintenance/subcontractors?${params.toString()}`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Load failed.");
      }
      setSubs(body.subcontractors || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load subcontractors.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token, q, trade, zip]);

  useEffect(() => {
    const t = setTimeout(load, q || trade || zip ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q, trade, zip]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Subcontractors</h1>
          <p className={styles.subtitle}>
            Vendor database — searchable by trade and zip coverage, with COI/W9
            tracking and per-job ratings.
          </p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={load} disabled={loading}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            <Plus size={14} /> New Subcontractor
          </button>
        </div>
      </header>

      <div className={styles.searchRow}>
        <div className={styles.searchBox}>
          <Search size={15} color="var(--text-secondary, #6a737b)" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search company or contact…"
          />
        </div>
        <input
          className={styles.filterInput}
          value={trade}
          onChange={(e) => setTrade(e.target.value)}
          placeholder="Trade"
          aria-label="Filter by trade"
        />
        <input
          className={styles.filterInput}
          value={zip}
          onChange={(e) => setZip(e.target.value)}
          placeholder="Zip"
          aria-label="Filter by zip"
        />
      </div>

      {err ? <div className={styles.errorBanner}>{err}</div> : null}

      <div className={styles.card}>
        {loading ? (
          <div className={styles.loading}>Loading subcontractors…</div>
        ) : subs.length === 0 ? (
          <div className={styles.empty}>
            <Building size={28} color="var(--text-secondary, #6a737b)" />
            <p>
              {q || trade || zip
                ? "No subcontractors match that filter."
                : "No subcontractors yet. Add your first vendor."}
            </p>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Trades</th>
                  <th>Coverage</th>
                  <th>COI</th>
                  <th>W9</th>
                  <th>Rating</th>
                </tr>
              </thead>
              <tbody>
                {subs.map((s) => {
                  const cs = coiState(s.coiExpiry);
                  return (
                    <tr
                      key={s.id}
                      className={styles.rowLink}
                      onClick={() => {
                        setEditing(s);
                        setModalOpen(true);
                      }}
                    >
                      <td>
                        <strong>{s.companyName}</strong>
                        {s.contactName ? (
                          <span className={styles.muted}> · {s.contactName}</span>
                        ) : null}
                      </td>
                      <td>
                        {s.trades.length ? (
                          s.trades.slice(0, 3).map((t) => (
                            <span key={t} className={styles.tag}>
                              {t}
                            </span>
                          ))
                        ) : (
                          <span className={styles.muted}>—</span>
                        )}
                        {s.trades.length > 3 ? (
                          <span className={styles.muted}>+{s.trades.length - 3}</span>
                        ) : null}
                      </td>
                      <td className={s.zipCoverage.length ? "" : styles.muted}>
                        {s.zipCoverage.length
                          ? `${s.zipCoverage.length} zip${s.zipCoverage.length > 1 ? "s" : ""}`
                          : "—"}
                      </td>
                      <td>
                        <span className={`${styles.coi} ${coiClass(cs)}`}>
                          {COI_LABELS[cs]}
                        </span>
                        {s.coiExpiry ? (
                          <div className={styles.muted} style={{ fontSize: "0.72rem" }}>
                            {fmtDate(s.coiExpiry)}
                          </div>
                        ) : null}
                      </td>
                      <td className={s.w9OnFile ? "" : styles.muted}>
                        {s.w9OnFile ? "Yes" : "No"}
                      </td>
                      <td>
                        {s.ratingCount > 0 ? (
                          <span className={styles.rating}>
                            ★ {s.avgRating?.toFixed(1)}{" "}
                            <span className={styles.muted}>({s.ratingCount})</span>
                          </span>
                        ) : (
                          <span className={styles.muted}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <SubModal
        open={modalOpen}
        sub={editing}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          setModalOpen(false);
          load();
        }}
      />
    </div>
  );
}

function SubModal({
  open,
  sub,
  onClose,
  onSaved,
}: {
  open: boolean;
  sub: Subcontractor | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { authHeaders, token } = useAuth();
  const isEdit = !!sub;

  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [trades, setTrades] = useState("");
  const [zipCoverage, setZipCoverage] = useState("");
  const [coiExpiry, setCoiExpiry] = useState("");
  const [w9OnFile, setW9OnFile] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [ratings, setRatings] = useState<SubRating[]>([]);
  const [newRating, setNewRating] = useState("5");
  const [ratingNote, setRatingNote] = useState("");
  const [savingRating, setSavingRating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setCompanyName(sub?.companyName ?? "");
    setContactName(sub?.contactName ?? "");
    setEmail(sub?.email ?? "");
    setPhone(sub?.phone ?? "");
    setTrades((sub?.trades ?? []).join(", "));
    setZipCoverage((sub?.zipCoverage ?? []).join(", "));
    setCoiExpiry(sub?.coiExpiry ? sub.coiExpiry.slice(0, 10) : "");
    setW9OnFile(sub?.w9OnFile ?? false);
    setNotes(sub?.notes ?? "");
    setRatings([]);
    setNewRating("5");
    setRatingNote("");
  }, [open, sub]);

  // Load rating history for an existing vendor.
  const loadRatings = useCallback(async () => {
    if (!open || !token || !sub) return;
    try {
      const res = await fetch(apiUrl(`/maintenance/subcontractors/${sub.id}`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setRatings(body.ratings || []);
    } catch {
      /* non-fatal */
    }
  }, [open, token, sub, authHeaders]);

  useEffect(() => {
    loadRatings();
  }, [loadRatings]);

  if (!open) return null;

  const toArray = (s: string) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName.trim()) {
      setErr("Company name is required.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const payload = {
        companyName: companyName.trim(),
        contactName: contactName.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        trades: toArray(trades),
        zipCoverage: toArray(zipCoverage),
        coiExpiry: coiExpiry || null,
        w9OnFile,
        notes: notes.trim() || null,
      };
      const res = await fetch(
        isEdit && sub
          ? apiUrl(`/maintenance/subcontractors/${sub.id}`)
          : apiUrl("/maintenance/subcontractors"),
        {
          method: isEdit ? "PUT" : "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(payload),
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Save failed.");
      }
      onSaved();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Could not save subcontractor.");
    } finally {
      setSaving(false);
    }
  };

  const submitRating = async () => {
    if (!sub) return;
    setSavingRating(true);
    setErr(null);
    try {
      const res = await fetch(apiUrl(`/maintenance/subcontractors/${sub.id}/ratings`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ rating: Number(newRating), notes: ratingNote.trim() || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Rating failed.");
      }
      setRatingNote("");
      setNewRating("5");
      await loadRatings();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Could not add rating.");
    } finally {
      setSavingRating(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>{isEdit ? "Edit Subcontractor" : "New Subcontractor"}</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form className={styles.modalBody} onSubmit={submit}>
          {err ? <div className={styles.errorBanner}>{err}</div> : null}

          <div className={styles.field}>
            <label>Company name</label>
            <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} autoFocus required />
          </div>
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label>Contact name</label>
              <input value={contactName} onChange={(e) => setContactName(e.target.value)} />
            </div>
            <div className={styles.field}>
              <label>Phone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div className={styles.field}>
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label>
              Trades <span className={styles.hint}>(comma-separated)</span>
            </label>
            <input
              value={trades}
              onChange={(e) => setTrades(e.target.value)}
              placeholder="HVAC, Plumbing, Electrical"
            />
          </div>
          <div className={styles.field}>
            <label>
              Zip coverage <span className={styles.hint}>(comma-separated)</span>
            </label>
            <input
              value={zipCoverage}
              onChange={(e) => setZipCoverage(e.target.value)}
              placeholder="77001, 77002, 77003"
            />
          </div>
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label>COI expiry</label>
              <input type="date" value={coiExpiry} onChange={(e) => setCoiExpiry(e.target.value)} />
            </div>
            <div className={styles.checkRow} style={{ marginTop: "1.6rem" }}>
              <input
                id="w9"
                type="checkbox"
                checked={w9OnFile}
                onChange={(e) => setW9OnFile(e.target.checked)}
              />
              <label htmlFor="w9">W-9 on file</label>
            </div>
          </div>
          <div className={styles.field}>
            <label>Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className={styles.formFooter}>
            <button type="button" className={styles.btn} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving}>
              {saving ? "Saving…" : isEdit ? "Save Changes" : "Create"}
            </button>
          </div>
        </form>

        {isEdit ? (
          <div className={styles.modalBody} style={{ paddingTop: 0 }}>
            <div className={styles.sectionLabel}>
              Ratings {sub && sub.ratingCount > 0 ? `· ★ ${sub.avgRating?.toFixed(1)} (${sub.ratingCount})` : ""}
            </div>
            <div className={styles.addRatingRow}>
              <div className={styles.field} style={{ marginBottom: 0, width: 90 }}>
                <label>Score</label>
                <select value={newRating} onChange={(e) => setNewRating(e.target.value)}>
                  {[5, 4, 3, 2, 1].map((n) => (
                    <option key={n} value={n}>
                      {n} ★
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.field} style={{ marginBottom: 0, flex: 1 }}>
                <label>Note (optional)</label>
                <input value={ratingNote} onChange={(e) => setRatingNote(e.target.value)} />
              </div>
              <button
                type="button"
                className={styles.btn}
                onClick={submitRating}
                disabled={savingRating}
              >
                {savingRating ? "Adding…" : "Add"}
              </button>
            </div>

            {ratings.length > 0 ? (
              <div className={styles.ratingHistory}>
                {ratings.map((r) => (
                  <div key={r.id} className={styles.ratingRow}>
                    <span>
                      <span className={styles.rating}>★ {r.rating}</span>
                      {r.job_title ? <span className={styles.muted}> · {r.job_title}</span> : null}
                      {r.notes ? <span> — {r.notes}</span> : null}
                    </span>
                    <span className={styles.muted}>{fmtDate(r.created_at)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.muted} style={{ fontSize: "0.82rem", marginTop: "0.4rem" }}>
                No ratings yet.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
