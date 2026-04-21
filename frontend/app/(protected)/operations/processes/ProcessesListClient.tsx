"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "../operations.module.css";
import OperationsTopBar from "../OperationsTopBar";
import LaunchProcessModal from "../LaunchProcessModal";
import { apiUrl } from "../../../../lib/api";
import { useAuth } from "../../../../context/AuthContext";
import type { ProcessRecord, ProcessStatus, Template } from "../types";

type DashboardTemplate = {
  templateId: number;
  name: string;
  icon: string;
  color: string;
  category: string | null;
  activeCount: number;
  completedCount: number;
  overdueCount: number;
  avgDays: number | null;
};

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
  const [templateFilter, setTemplateFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [launchOpen, setLaunchOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<"grid" | "dashboard">("grid");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [dashboard, setDashboard] = useState<DashboardTemplate[]>([]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      params.set("status", statusFilter);
      if (search) params.set("search", search);
      if (templateFilter) params.set("template", templateFilter);
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
  }, [authHeaders, token, statusFilter, search, templateFilter]);

  const loadTemplates = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl("/processes/templates"), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = await res.json();
      if (Array.isArray(body.templates)) setTemplates(body.templates);
    } catch {
      /* ignore */
    }
  }, [authHeaders, token]);

  const loadDashboard = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl("/processes/dashboard"), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = await res.json();
      if (Array.isArray(body.byTemplate)) setDashboard(body.byTemplate);
    } catch {
      /* ignore */
    }
  }, [authHeaders, token]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);
  useEffect(() => {
    if (view === "dashboard") loadDashboard();
  }, [view, loadDashboard]);

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
          <select
            className={styles.select}
            value={templateFilter}
            onChange={(e) => setTemplateFilter(e.target.value)}
          >
            <option value="">All templates</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.icon} {t.name}
              </option>
            ))}
          </select>
          <div className={styles.viewToggle}>
            <button
              type="button"
              className={`${styles.viewToggleBtn} ${view === "grid" ? styles.viewToggleActive : ""}`}
              onClick={() => setView("grid")}
            >
              Grid
            </button>
            <button
              type="button"
              className={`${styles.viewToggleBtn} ${view === "dashboard" ? styles.viewToggleActive : ""}`}
              onClick={() => setView("dashboard")}
            >
              Dashboard
            </button>
          </div>
        </div>

        {err ? <div className={styles.errorBanner}>{err}</div> : null}

        {view === "dashboard" ? (
          dashboard.length === 0 ? (
            <div className={styles.emptyState}>
              <h3>No templates yet</h3>
            </div>
          ) : (
            <div className={styles.dashboardGrid}>
              {dashboard.map((d) => (
                <button
                  key={d.templateId}
                  type="button"
                  className={styles.dashboardCard}
                  style={{ borderTopColor: d.color || "#0098D0" }}
                  onClick={() => {
                    setView("grid");
                    setTemplateFilter(String(d.templateId));
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
                      <span style={{ fontSize: "1.35rem" }}>{d.icon}</span>
                      <strong style={{ color: "#1b2856" }}>{d.name}</strong>
                    </div>
                    {d.overdueCount > 0 ? (
                      <span className={styles.dashboardStatDanger}>⚠ {d.overdueCount}</span>
                    ) : null}
                  </div>
                  <div className={styles.dashboardCardStats}>
                    <div>
                      <div className={styles.dashboardCardLabel}>Active</div>
                      <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "#1b2856" }}>
                        {d.activeCount}
                      </div>
                    </div>
                    <div>
                      <div className={styles.dashboardCardLabel}>Completed</div>
                      <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "#1b2856" }}>
                        {d.completedCount}
                      </div>
                    </div>
                    {d.avgDays != null ? (
                      <div>
                        <div className={styles.dashboardCardLabel}>Avg days</div>
                        <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "#1b2856" }}>
                          {d.avgDays}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
          )
        ) : loading ? (
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
