"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../operations.module.css";
import OperationsTopBar from "../OperationsTopBar";
import CreateProjectModal from "../CreateProjectModal";
import { apiUrl } from "../../../../lib/api";
import { useAuth } from "../../../../context/AuthContext";
import type { Project, ProjectStatus, TeamUser } from "../types";
import { PROJECT_CATEGORIES } from "../types";

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On Hold" },
  { value: "completed", label: "Completed" },
  { value: "all", label: "All" },
];

function statusClass(s: ProjectStatus): string {
  switch (s) {
    case "active":
      return styles.statusCompleted;
    case "on_hold":
      return styles.statusOnHold;
    case "completed":
      return styles.statusInProgress;
    default:
      return styles.statusCanceled;
  }
}

function statusLabel(s: ProjectStatus) {
  return s.replace("_", " ");
}

function daysBetween(target: string | null): number | null {
  if (!target) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const t = new Date(target);
  t.setHours(0, 0, 0, 0);
  return Math.round((t.getTime() - today.getTime()) / 86400000);
}

type SortKey = "name" | "status" | "owner" | "progress" | "target" | "category";

export default function ProjectsListClient() {
  const { authHeaders, token } = useAuth();
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [ownerFilter, setOwnerFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [sortKey, setSortKey] = useState<SortKey>("target");
  const [sortDesc, setSortDesc] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      params.set("status", statusFilter);
      if (categoryFilter) params.set("category", categoryFilter);
      if (ownerFilter) params.set("owner", ownerFilter);
      if (search) params.set("search", search);
      const res = await fetch(apiUrl(`/projects?${params.toString()}`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(typeof body.error === "string" ? body.error : "Could not load projects.");
      setProjects(body.projects || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load projects.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token, statusFilter, categoryFilter, ownerFilter, search]);

  const loadUsers = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl("/users"), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = await res.json();
      if (Array.isArray(body.users)) setUsers(body.users);
    } catch {
      /* ignore */
    }
  }, [authHeaders, token]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const sorted = useMemo(() => {
    const arr = [...projects];
    arr.sort((a, b) => {
      const dir = sortDesc ? -1 : 1;
      switch (sortKey) {
        case "name":
          return dir * a.name.localeCompare(b.name);
        case "status":
          return dir * a.status.localeCompare(b.status);
        case "owner":
          return dir * (a.ownerName || "").localeCompare(b.ownerName || "");
        case "progress": {
          const ap = a.totalTasks ? (a.completedTasks ?? 0) / a.totalTasks : 0;
          const bp = b.totalTasks ? (b.completedTasks ?? 0) / b.totalTasks : 0;
          return dir * (ap - bp);
        }
        case "target": {
          const at = a.targetDate ? new Date(a.targetDate).getTime() : Infinity;
          const bt = b.targetDate ? new Date(b.targetDate).getTime() : Infinity;
          return dir * (at - bt);
        }
        case "category":
          return dir * (a.category || "").localeCompare(b.category || "");
        default:
          return 0;
      }
    });
    return arr;
  }, [projects, sortKey, sortDesc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDesc((d) => !d);
    else {
      setSortKey(key);
      setSortDesc(false);
    }
  };

  return (
    <div className={styles.page}>
      <OperationsTopBar
        actions={
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => setCreateOpen(true)}
          >
            + New Project
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
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className={styles.select}
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">All categories</option>
            {PROJECT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            className={styles.select}
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
          >
            <option value="">All owners</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
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
              className={`${styles.viewToggleBtn} ${view === "list" ? styles.viewToggleActive : ""}`}
              onClick={() => setView("list")}
            >
              List
            </button>
          </div>
        </div>

        {err ? <div className={styles.errorBanner}>{err}</div> : null}

        {loading ? (
          <div className={styles.loading}>Loading projects…</div>
        ) : sorted.length === 0 ? (
          <div className={styles.emptyState}>
            <h3>No projects yet</h3>
            <p>Click &ldquo;New Project&rdquo; to create your first one.</p>
          </div>
        ) : view === "grid" ? (
          <div className={styles.projectGrid}>
            {sorted.map((p) => {
              const total = p.totalTasks ?? 0;
              const done = p.completedTasks ?? 0;
              const pct = total > 0 ? Math.round((done / total) * 100) : 0;
              const days = daysBetween(p.targetDate);
              return (
                <Link
                  key={p.id}
                  href={`/operations/projects/${p.id}`}
                  className={styles.projectCard}
                  style={{ borderLeftColor: p.color }}
                >
                  <div className={styles.projectCardHead}>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flex: 1, minWidth: 0 }}>
                      <span className={styles.projectIcon}>{p.icon}</span>
                      <h3 className={styles.projectName}>{p.name}</h3>
                    </div>
                    <span className={`${styles.statusBadge} ${statusClass(p.status)}`}>
                      {statusLabel(p.status)}
                    </span>
                  </div>
                  {p.description ? <p className={styles.projectDesc}>{p.description}</p> : null}
                  <div className={styles.projectStatHint}>
                    {p.category ? <span className={styles.categoryTag}>{p.category}</span> : <span />}
                    {p.ownerName ? <span>👤 {p.ownerName}</span> : null}
                  </div>
                  <div>
                    <div className={styles.projectStatHint} style={{ marginBottom: "0.2rem" }}>
                      <span>
                        {done} of {total} tasks ({pct}%)
                      </span>
                      {(p.totalMilestones ?? 0) > 0 ? (
                        <span>
                          {p.completedMilestones}/{p.totalMilestones} milestones
                        </span>
                      ) : null}
                    </div>
                    <div className={styles.progressBar}>
                      <div className={styles.progressFill} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className={styles.projectCardFooter}>
                    <span
                      className={styles.projectStatHint}
                      style={{
                        color: days != null && days < 0 && p.status === "active" ? "#b32317" : undefined,
                      }}
                    >
                      {p.targetDate
                        ? days! >= 0
                          ? `Due in ${days}d`
                          : `${Math.abs(days!)}d overdue`
                        : "No target"}
                    </span>
                    {(p.memberCount ?? 0) > 0 ? (
                      <span className={styles.projectStatHint}>
                        {p.memberCount} member{p.memberCount === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <table className={styles.projectListTable}>
            <thead>
              <tr>
                <th onClick={() => toggleSort("name")}>Name</th>
                <th onClick={() => toggleSort("status")}>Status</th>
                <th onClick={() => toggleSort("owner")}>Owner</th>
                <th onClick={() => toggleSort("progress")}>Progress</th>
                <th onClick={() => toggleSort("target")}>Target</th>
                <th onClick={() => toggleSort("category")}>Category</th>
                <th>Members</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => {
                const total = p.totalTasks ?? 0;
                const done = p.completedTasks ?? 0;
                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                return (
                  <tr key={p.id} onClick={() => router.push(`/operations/projects/${p.id}`)}>
                    <td style={{ borderLeft: `4px solid ${p.color}` }}>
                      <strong style={{ color: "#1b2856" }}>
                        {p.icon} {p.name}
                      </strong>
                    </td>
                    <td>
                      <span className={`${styles.statusBadge} ${statusClass(p.status)}`}>
                        {statusLabel(p.status)}
                      </span>
                    </td>
                    <td>{p.ownerName ?? "—"}</td>
                    <td style={{ minWidth: 140 }}>
                      <div className={styles.progressBar}>
                        <div className={styles.progressFill} style={{ width: `${pct}%` }} />
                      </div>
                      <div className={styles.projectStatHint} style={{ marginTop: "0.15rem" }}>
                        {done}/{total} ({pct}%)
                      </div>
                    </td>
                    <td>{p.targetDate ? new Date(p.targetDate).toLocaleDateString() : "—"}</td>
                    <td>{p.category ?? "—"}</td>
                    <td>{p.memberCount ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(p) => {
          setProjects((prev) => [p, ...prev]);
          router.push(`/operations/projects/${p.id}`);
        }}
        users={users}
      />
    </div>
  );
}
