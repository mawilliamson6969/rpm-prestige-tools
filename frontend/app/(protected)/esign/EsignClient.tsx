"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../context/AuthContext";
import { apiUrl } from "../../../lib/api";
import NewSigningRequestModal from "./NewSigningRequestModal";
import SigningRequestDetail from "./SigningRequestDetail";
import styles from "./esign.module.css";

export type EsignRequestRow = {
  id: number;
  docuseal_submission_id: number | null;
  template_id: number | null;
  template_name: string | null;
  process_id: number | null;
  process_title?: string | null;
  property_name: string | null;
  signers: Array<{ name?: string; email?: string; role?: string; fields?: Record<string, unknown> }> | string;
  prefill_fields?: Record<string, unknown>;
  status: string;
  signed_document_url: string | null;
  completed_at: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
};

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "sent", label: "Sent" },
  { value: "viewed", label: "Viewed" },
  { value: "completed", label: "Completed" },
] as const;

function statusBadgeClass(status: string) {
  switch (status) {
    case "pending":
      return styles.statusPending;
    case "sent":
      return styles.statusSent;
    case "viewed":
      return styles.statusViewed;
    case "completed":
      return styles.statusCompleted;
    case "declined":
      return styles.statusDeclined;
    case "cancelled":
      return styles.statusCancelled;
    case "expired":
      return styles.statusExpired;
    default:
      return styles.statusPending;
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return "";
  }
}

function parseSigners(s: EsignRequestRow["signers"]) {
  if (Array.isArray(s)) return s;
  if (typeof s === "string") {
    try {
      const parsed = JSON.parse(s);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export default function EsignClient() {
  const { authHeaders, token } = useAuth();
  const [rows, setRows] = useState<EsignRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (debounced) params.set("search", debounced);
      const res = await fetch(apiUrl(`/esign/requests?${params}`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : `Request failed (${res.status}).`);
        setRows([]);
      } else if (Array.isArray(body)) {
        setRows(body);
      } else {
        setRows([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load signing requests.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, debounced, statusFilter, token]);

  useEffect(() => {
    load();
  }, [load]);

  const onSent = useCallback(() => {
    setModalOpen(false);
    load();
  }, [load]);

  const visibleRows = useMemo(() => rows, [rows]);

  return (
    <div className={styles.page}>
      <div className={styles.main}>
        <div className={styles.headerRow}>
          <div>
            <h1 className={styles.title}>
              <span aria-hidden>✍️</span> E-Signatures
            </h1>
            <p className={styles.subtitle}>
              Send, track, and manage digital signatures via Docuseal.
            </p>
          </div>
          <div className={styles.headerActions}>
            <a
              className={`${styles.btn} ${styles.btnGhost}`}
              href="https://sign.prestigedash.com"
              target="_blank"
              rel="noreferrer"
            >
              Open Docuseal
            </a>
            <button
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => setModalOpen(true)}
              type="button"
            >
              + New Signing Request
            </button>
          </div>
        </div>

        <div className={styles.toolbar}>
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={`${styles.filterBtn} ${statusFilter === f.value ? styles.filterActive : ""}`}
              onClick={() => setStatusFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
          <input
            className={styles.searchInput}
            placeholder="Search property, template, signer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {error && (
          <div className={styles.empty}>
            <h3>Could not load signing requests</h3>
            <p>{error}</p>
          </div>
        )}

        {!error && loading && (
          <div className={styles.empty}>
            <p>Loading…</p>
          </div>
        )}

        {!error && !loading && visibleRows.length === 0 && (
          <div className={styles.empty}>
            <h3>No signing requests yet</h3>
            <p>
              Set up your templates in{" "}
              <a href="https://sign.prestigedash.com" target="_blank" rel="noreferrer">
                Docuseal
              </a>
              , then send your first request.
            </p>
            <button
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => setModalOpen(true)}
              type="button"
              style={{ marginTop: "1rem" }}
            >
              + New Signing Request
            </button>
          </div>
        )}

        {!error && !loading && visibleRows.length > 0 && (
          <div className={styles.list}>
            {visibleRows.map((row) => {
              const signers = parseSigners(row.signers);
              return (
                <div
                  key={row.id}
                  className={styles.card}
                  role="button"
                  tabIndex={0}
                  onClick={() => setDetailId(row.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setDetailId(row.id);
                    }
                  }}
                >
                  <div>
                    <div className={styles.cardHeader}>
                      <span className={styles.templateName}>
                        {row.template_name || `Template ${row.template_id ?? "—"}`}
                      </span>
                      {row.property_name && (
                        <span className={styles.propertyName}>· {row.property_name}</span>
                      )}
                    </div>
                    <div className={styles.signers}>
                      {signers.length === 0 && <span>No signers</span>}
                      {signers.map((s, i) => (
                        <span key={`${s.email}-${i}`} className={styles.signerLine}>
                          {s.name || s.email}
                          {s.email && s.name ? ` <${s.email}>` : ""}
                          {s.role ? ` · ${s.role}` : ""}
                        </span>
                      ))}
                    </div>
                    <div className={styles.dates}>
                      Sent {formatDate(row.created_at)}
                      {row.completed_at ? ` · Completed ${formatDate(row.completed_at)}` : ""}
                    </div>
                    {row.process_id && (
                      <a
                        className={styles.processLink}
                        href={`/operations/processes?card=${row.process_id}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        View linked process →
                      </a>
                    )}
                  </div>
                  <div className={styles.cardActions}>
                    <span className={`${styles.statusBadge} ${statusBadgeClass(row.status)}`}>
                      {row.status}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {modalOpen && (
        <NewSigningRequestModal
          onClose={() => setModalOpen(false)}
          onSent={onSent}
          initial={null}
        />
      )}

      {detailId !== null && (
        <SigningRequestDetail
          requestId={detailId}
          onClose={() => setDetailId(null)}
          onChange={load}
        />
      )}
    </div>
  );
}
