"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "../operations.module.css";
import OperationsTopBar from "../OperationsTopBar";
import LaunchProcessModal from "../LaunchProcessModal";
import { apiUrl } from "../../../../lib/api";
import { useAuth } from "../../../../context/AuthContext";
import type { ProcessRecord, ProcessStatus } from "../types";

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
];

function statusBadgeClass(s: ProcessStatus): string {
  return (
    styles[`status${s.charAt(0).toUpperCase() + s.slice(1)}` as keyof typeof styles] ?? ""
  );
}

function daysBetween(from: string, to: string | null): number | null {
  if (!to) return null;
  const a = new Date(from);
  const b = new Date(to + "T00:00:00");
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export default function ProcessesListClient() {
  const { authHeaders, token } = useAuth();
  const [processes, setProcesses] = useState<ProcessRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [search, setSearch] = useState("");
  const [launchOpen, setLaunchOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      params.set("status", statusFilter);
      if (search) params.set("search", search);
      const res = await fetch(apiUrl(`/processes?${params.toString()}`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(typeof body.error === "string" ? body.error : "Could not load processes.");
      setProcesses(body.processes || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load processes.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token, statusFilter, search]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className={styles.page}>
      <OperationsTopBar
        actions={
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => setLaunchOpen(true)}
          >
            + Launch Process
          </button>
        }
      />
      <div className={styles.main}>
        <div className={styles.toolbar}>
          <div className={styles.viewToggle}>
            {STATUS_FILTERS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                className={`${styles.viewToggleBtn} ${
                  statusFilter === value ? styles.viewToggleActive : ""
                }`}
                onClick={() => setStatusFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            className={styles.searchInput}
            placeholder="Search by property or contact…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {err ? <div className={styles.errorBanner}>{err}</div> : null}

        {loading ? (
          <div className={styles.loading}>Loading processes…</div>
        ) : processes.length === 0 ? (
          <div className={styles.emptyState}>
            <h3>No processes yet</h3>
            <p>Click &ldquo;Launch Process&rdquo; to start one from a template.</p>
          </div>
        ) : (
          <div className={styles.processGrid}>
            {processes.map((p) => {
              const total = p.totalSteps ?? 0;
              const done = p.completedSteps ?? 0;
              const pct = total > 0 ? Math.round((done / total) * 100) : 0;
              const daysLeft = daysBetween(p.startedAt, p.targetCompletion);
              return (
                <Link
                  key={p.id}
                  href={`/operations/processes/${p.id}`}
                  className={styles.processCard}
                  style={{ borderLeftColor: p.templateColor ?? "#0098D0" }}
                >
                  <div className={styles.processCardHead}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h3 className={styles.processName}>
                        {p.templateIcon ?? "📋"} {p.name}
                      </h3>
                      {p.contactName ? (
                        <div className={styles.processMeta}>👤 {p.contactName}</div>
                      ) : null}
                    </div>
                    <span className={`${styles.statusBadge} ${statusBadgeClass(p.status)}`}>
                      {p.status}
                    </span>
                  </div>
                  <div>
                    <div className={styles.processMeta} style={{ marginBottom: "0.3rem" }}>
                      {done} of {total} steps ({pct}%)
                    </div>
                    <div className={styles.progressBar}>
                      <div className={styles.progressFill} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  {p.currentStepName ? (
                    <div className={styles.processMeta}>
                      <strong style={{ color: "#1b2856" }}>Current:</strong> {p.currentStepName}
                    </div>
                  ) : null}
                  {daysLeft != null ? (
                    <div className={styles.processMeta}>
                      {daysLeft >= 0 ? `${daysLeft} days target` : `${Math.abs(daysLeft)} days overdue`}
                    </div>
                  ) : null}
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <LaunchProcessModal open={launchOpen} onClose={() => setLaunchOpen(false)} />
    </div>
  );
}
