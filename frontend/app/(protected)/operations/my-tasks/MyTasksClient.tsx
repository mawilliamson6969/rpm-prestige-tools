"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../operations.module.css";
import OperationsTopBar from "../OperationsTopBar";
import { apiUrl } from "../../../../lib/api";
import { useAuth } from "../../../../context/AuthContext";

type CrossBoardTask = {
  kind: string;
  id: number;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  taskType: string;
  dueDate: string | null;
  processId: number;
  processName: string | null;
  propertyName: string | null;
  templateName: string | null;
  templateIcon: string | null;
  templateColor: string | null;
};

const TASK_TYPE_ICONS: Record<string, string> = {
  todo: "✓",
  email: "✉",
  sms: "💬",
  call: "📞",
};

const PRIORITY_CLASS: Record<string, string> = {
  asap: styles.priorityAsap,
  high: styles.priorityHigh,
  medium: styles.priorityMedium,
  normal: styles.priorityMedium,
  low: styles.priorityLow,
};

function priorityLabel(p: string) {
  return p.charAt(0).toUpperCase() + p.slice(1);
}

export default function MyTasksClient() {
  const { authHeaders, token, user } = useAuth();
  const [tasks, setTasks] = useState<CrossBoardTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<"today" | "week" | "overdue" | "all">("all");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(apiUrl("/tasks/my-all"), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Load failed.");
      setTasks(body.tasks || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Load failed.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token]);

  useEffect(() => {
    load();
  }, [load]);

  const completeTask = async (t: CrossBoardTask) => {
    try {
      const res = await fetch(apiUrl(`/processes/steps/${t.id}/complete`), {
        method: "PUT",
        headers: { ...authHeaders() },
      });
      if (!res.ok) throw new Error("Complete failed.");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Complete failed.");
    }
  };

  const filtered = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekAhead = new Date(today);
    weekAhead.setDate(today.getDate() + 7);
    return tasks.filter((t) => {
      if (t.status === "completed") return false;
      if (filter === "all") return true;
      if (!t.dueDate) return false;
      const d = new Date(t.dueDate);
      if (filter === "today") return d.getTime() === today.getTime();
      if (filter === "week") return d <= weekAhead;
      if (filter === "overdue") return d < today;
      return true;
    });
  }, [tasks, filter]);

  const grouped = useMemo(() => {
    const map = new Map<string, CrossBoardTask[]>();
    for (const t of filtered) {
      const key = t.templateName || "Standalone";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const counts = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const openTasks = tasks.filter((t) => t.status !== "completed");
    const overdue = openTasks.filter((t) => t.dueDate && new Date(t.dueDate) < today).length;
    const todayCount = openTasks.filter(
      (t) => t.dueDate && new Date(t.dueDate).getTime() === today.getTime()
    ).length;
    return { total: openTasks.length, overdue, today: todayCount };
  }, [tasks]);

  return (
    <div className={styles.page}>
      <OperationsTopBar />
      <div className={styles.main}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
          <h2 style={{ margin: 0, color: "#1b2856", fontSize: "1.35rem" }}>
            My Tasks
          </h2>
          <span style={{ fontSize: "0.85rem", color: "#6a737b" }}>
            {user?.displayName ?? user?.username} · {new Date().toLocaleDateString()}
          </span>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
          <div className={styles.dashboardCard} style={{ padding: "0.75rem 1rem", cursor: "default" }}>
            <div className={styles.dashboardCardLabel}>Open</div>
            <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "#1b2856" }}>
              {counts.total}
            </div>
          </div>
          <div className={styles.dashboardCard} style={{ padding: "0.75rem 1rem", cursor: "default", borderTopColor: "#f59e0b" }}>
            <div className={styles.dashboardCardLabel}>Due today</div>
            <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "#1b2856" }}>
              {counts.today}
            </div>
          </div>
          <div className={styles.dashboardCard} style={{ padding: "0.75rem 1rem", cursor: "default", borderTopColor: "#ef4444" }}>
            <div className={styles.dashboardCardLabel}>Overdue</div>
            <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "#b32317" }}>
              {counts.overdue}
            </div>
          </div>
        </div>

        <div className={styles.toolbar}>
          <div className={styles.viewToggle}>
            {(["all", "today", "week", "overdue"] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={`${styles.viewToggleBtn} ${filter === k ? styles.viewToggleActive : ""}`}
                onClick={() => setFilter(k)}
              >
                {k === "all" ? "All" : k === "today" ? "Due today" : k === "week" ? "This week" : "Overdue"}
              </button>
            ))}
          </div>
        </div>

        {err ? <div className={styles.errorBanner}>{err}</div> : null}

        {loading ? (
          <div className={styles.loading}>Loading tasks…</div>
        ) : filtered.length === 0 ? (
          <div className={styles.emptyState}>
            <h3>No tasks</h3>
            <p>Tasks assigned to you across all process boards will appear here.</p>
          </div>
        ) : (
          grouped.map(([name, group]) => (
            <div key={name} className={styles.myTasksSection}>
              <div className={styles.cfSectionGroupHeader}>
                {name} · {group.length}
              </div>
              {group.map((t) => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const overdue = t.dueDate && new Date(t.dueDate) < today;
                const done = t.status === "completed";
                return (
                  <div
                    key={`${t.kind}-${t.id}`}
                    className={`${styles.myTasksRow} ${done ? styles.myTasksRowDone : ""}`}
                  >
                    <button
                      type="button"
                      className={`${styles.taskCheckbox} ${done ? styles.taskCheckboxDone : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!done) completeTask(t);
                      }}
                      style={{ width: 16, height: 16 }}
                    >
                      {done ? "✓" : ""}
                    </button>
                    <span className={styles.myTasksTypeIcon}>
                      {TASK_TYPE_ICONS[t.taskType] || "✓"}
                    </span>
                    <Link
                      href={`/operations/processes/${t.processId}`}
                      className={styles.myTasksTitle}
                      style={{ textDecoration: "none" }}
                    >
                      {t.title}
                    </Link>
                    <span
                      className={`${styles.priorityBadge} ${PRIORITY_CLASS[t.priority] ?? ""}`}
                    >
                      {priorityLabel(t.priority)}
                    </span>
                    {t.propertyName ? (
                      <span className={styles.myTasksMeta}>🏠 {t.propertyName}</span>
                    ) : null}
                    {t.dueDate ? (
                      <span
                        className={styles.myTasksMeta}
                        style={{ color: overdue ? "#b32317" : undefined, fontWeight: overdue ? 700 : 400 }}
                      >
                        📅 {new Date(t.dueDate).toLocaleDateString()}
                      </span>
                    ) : null}
                    <span className={styles.myTasksMeta}>
                      {t.templateIcon ?? ""} {t.templateName}
                    </span>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
