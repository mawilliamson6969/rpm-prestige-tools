"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../operations.module.css";
import OperationsTopBar from "../OperationsTopBar";
import CreateTaskModal from "../CreateTaskModal";
import LaunchProcessModal from "../LaunchProcessModal";
import PropertyContextPanel, { PropertyContextCompact } from "../../../../components/PropertyContextPanel";
import { apiUrl } from "../../../../lib/api";
import { useAuth } from "../../../../context/AuthContext";
import type { Task, TaskPriority, TaskStatus, TeamUser } from "../types";

type View = "my" | "all" | "board";

const PRIORITY_COLOR: Record<TaskPriority, string> = {
  urgent: "#ef4444",
  high: "#f59e0b",
  normal: "#6A737B",
  low: "#d1d5db",
};

function priorityClass(p: TaskPriority) {
  return (
    styles[`priority${p.charAt(0).toUpperCase() + p.slice(1)}` as keyof typeof styles] ?? ""
  );
}

function formatDue(dateStr: string | null, time: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((d.getTime() - today.getTime()) / 86400000);
  let label = "";
  if (diffDays === 0) label = "Today";
  else if (diffDays === 1) label = "Tomorrow";
  else if (diffDays === -1) label = "Yesterday";
  else if (diffDays < 0) label = `${Math.abs(diffDays)}d overdue`;
  else if (diffDays < 7) label = d.toLocaleDateString("en-US", { weekday: "short" });
  else label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (time) {
    const t = time.slice(0, 5);
    return `${label} · ${t}`;
  }
  return label;
}

function bucketTasks(tasks: Task[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(today);
  endOfWeek.setDate(today.getDate() + 7);
  const endOf30 = new Date(today);
  endOf30.setDate(today.getDate() + 30);

  const overdue: Task[] = [];
  const dueToday: Task[] = [];
  const thisWeek: Task[] = [];
  const upcoming: Task[] = [];
  const noDate: Task[] = [];
  const completed: Task[] = [];

  for (const t of tasks) {
    if (t.status === "completed") {
      completed.push(t);
      continue;
    }
    if (!t.dueDate) {
      noDate.push(t);
      continue;
    }
    const d = new Date(t.dueDate + "T00:00:00");
    if (d < today) overdue.push(t);
    else if (d.getTime() === today.getTime()) dueToday.push(t);
    else if (d <= endOfWeek) thisWeek.push(t);
    else if (d <= endOf30) upcoming.push(t);
    else upcoming.push(t);
  }
  return { overdue, dueToday, thisWeek, upcoming, noDate, completed };
}

export default function TaskBoardClient() {
  const { authHeaders, user, token } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [view, setView] = useState<View>("my");
  const [search, setSearch] = useState("");
  const [filterAssignee, setFilterAssignee] = useState<string>("");
  const [filterPriority, setFilterPriority] = useState<string>("");
  const [filterCategory, setFilterCategory] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const [launchOpen, setLaunchOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [propertyModal, setPropertyModal] = useState<null | {
    propertyId: number | null;
    propertyName: string;
  }>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (view === "my") params.set("assignedTo", "currentUser");
      if (search) params.set("search", search);
      if (filterAssignee) params.set("assignedTo", filterAssignee);
      if (filterPriority) params.set("priority", filterPriority);
      if (filterCategory) params.set("category", filterCategory);
      const res = await fetch(apiUrl(`/tasks?${params.toString()}`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Could not load tasks.");
      setTasks(body.tasks || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load tasks.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token, view, search, filterAssignee, filterPriority, filterCategory]);

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
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const toggleComplete = async (task: Task) => {
    const done = task.status !== "completed";
    try {
      const res = await fetch(apiUrl(done ? `/tasks/${task.id}/complete` : `/tasks/${task.id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: done ? undefined : JSON.stringify({ status: "pending" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Could not update.");
      setTasks((prev) => prev.map((t) => (t.id === task.id ? body.task : t)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not update.");
    }
  };

  const deleteTask = async (task: Task) => {
    if (!confirm(`Delete "${task.title}"?`)) return;
    try {
      const res = await fetch(apiUrl(`/tasks/${task.id}`), {
        method: "DELETE",
        headers: { ...authHeaders() },
      });
      if (!res.ok) throw new Error("Delete failed.");
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not delete.");
    }
  };

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const buckets = useMemo(() => bucketTasks(tasks), [tasks]);

  const renderTaskCard = (t: Task) => {
    const isExpanded = expanded.has(t.id);
    const done = t.status === "completed";
    const dueLabel = formatDue(t.dueDate, t.dueTime);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueDateObj = t.dueDate ? new Date(t.dueDate + "T00:00:00") : null;
    const overdue = !done && dueDateObj && dueDateObj < today;
    const isToday = !done && dueDateObj && dueDateObj.getTime() === today.getTime();
    return (
      <div key={t.id} className={styles.taskCard}>
        <button
          type="button"
          aria-label={done ? "Mark incomplete" : "Mark complete"}
          className={`${styles.taskCheckbox} ${done ? styles.taskCheckboxDone : ""}`}
          onClick={() => toggleComplete(t)}
        >
          {done ? "✓" : ""}
        </button>
        <div className={styles.taskBody}>
          <div className={styles.taskHeadRow}>
            <button
              type="button"
              className={`${styles.taskTitle} ${done ? styles.taskTitleDone : ""}`}
              onClick={() => toggleExpand(t.id)}
            >
              {t.title}
            </button>
            <span className={`${styles.priorityBadge} ${priorityClass(t.priority)}`}>
              {t.priority}
            </span>
          </div>
          <div className={styles.taskMeta}>
            {t.assignedUserName ? (
              <span className={styles.taskMetaItem}>👤 {t.assignedUserName}</span>
            ) : null}
            {t.propertyName ? (
              <span className={styles.taskMetaItem}>🏠 {t.propertyName}</span>
            ) : null}
            {dueLabel ? (
              <span
                className={`${styles.taskMetaItem} ${
                  overdue ? styles.taskMetaOverdue : isToday ? styles.taskMetaToday : ""
                }`}
              >
                📅 {dueLabel}
              </span>
            ) : null}
            {t.processName ? (
              <span className={styles.processBadge}>🔗 {t.processName}</span>
            ) : null}
            {t.projectName ? (
              <span
                className={styles.taskProjectBadge}
                style={{ borderLeftColor: t.projectColor || "#0098D0" }}
              >
                {t.projectIcon || "📁"} {t.projectName}
              </span>
            ) : null}
            {t.category ? <span className={styles.categoryTag}>{t.category}</span> : null}
          </div>
          {isExpanded ? (
            <div className={styles.taskExpand}>
              {t.propertyName || t.propertyId ? (
                <PropertyContextCompact
                  propertyId={t.propertyId ?? null}
                  propertyName={t.propertyName ?? null}
                  onExpand={() =>
                    setPropertyModal({
                      propertyId: t.propertyId ?? null,
                      propertyName: t.propertyName ?? "",
                    })
                  }
                />
              ) : null}
              {t.description ? <div>{t.description}</div> : null}
              {t.notes ? (
                <div style={{ color: "#6a737b" }}>
                  <strong style={{ color: "#1b2856" }}>Notes:</strong> {t.notes}
                </div>
              ) : null}
              {t.tags.length ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
                  {t.tags.map((tag) => (
                    <span key={tag} className={styles.categoryTag}>
                      #{tag}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className={styles.taskActions}>
                {!done ? (
                  <button className={styles.smallBtn} type="button" onClick={() => toggleComplete(t)}>
                    Mark complete
                  </button>
                ) : (
                  <button className={styles.smallBtn} type="button" onClick={() => toggleComplete(t)}>
                    Reopen
                  </button>
                )}
                <button
                  className={`${styles.smallBtn} ${styles.smallBtnDanger}`}
                  type="button"
                  onClick={() => deleteTask(t)}
                >
                  Delete
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  const section = (
    title: string,
    taskList: Task[],
    modifier: "overdue" | "today" | "" = ""
  ) => {
    if (taskList.length === 0) return null;
    return (
      <div className={styles.taskSection}>
        <div className={styles.sectionHeader}>
          <h2
            className={`${styles.sectionTitle} ${
              modifier === "overdue"
                ? styles.sectionTitleOverdue
                : modifier === "today"
                ? styles.sectionTitleToday
                : ""
            }`}
          >
            {title}
          </h2>
          <span
            className={`${styles.sectionCount} ${
              modifier === "overdue"
                ? styles.sectionCountOverdue
                : modifier === "today"
                ? styles.sectionCountToday
                : ""
            }`}
          >
            {taskList.length}
          </span>
        </div>
        <div className={styles.taskList}>{taskList.map(renderTaskCard)}</div>
      </div>
    );
  };

  return (
    <div className={styles.page}>
      <OperationsTopBar
        actions={
          <>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={() => setLaunchOpen(true)}
            >
              Launch Process
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => setCreateOpen(true)}
            >
              + New Task
            </button>
          </>
        }
      />

      <div className={styles.main}>
        <div className={styles.toolbar}>
          <div className={styles.viewToggle}>
            <button
              type="button"
              className={`${styles.viewToggleBtn} ${view === "my" ? styles.viewToggleActive : ""}`}
              onClick={() => setView("my")}
            >
              My Tasks
            </button>
            <button
              type="button"
              className={`${styles.viewToggleBtn} ${view === "all" ? styles.viewToggleActive : ""}`}
              onClick={() => setView("all")}
            >
              All Tasks
            </button>
            <button
              type="button"
              className={`${styles.viewToggleBtn} ${view === "board" ? styles.viewToggleActive : ""}`}
              onClick={() => setView("board")}
            >
              Board
            </button>
          </div>
          <input
            className={styles.searchInput}
            placeholder="Search tasks…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {view !== "my" ? (
            <select
              className={styles.select}
              value={filterAssignee}
              onChange={(e) => setFilterAssignee(e.target.value)}
            >
              <option value="">All assignees</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </select>
          ) : null}
          <select
            className={styles.select}
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
          >
            <option value="">Any priority</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
        </div>

        {err ? <div className={styles.errorBanner}>{err}</div> : null}

        {loading ? (
          <div className={styles.loading}>Loading tasks…</div>
        ) : view === "board" ? (
          <BoardView
            tasks={tasks}
            onStatusChange={async (task, status) => {
              try {
                const res = await fetch(apiUrl(`/tasks/${task.id}`), {
                  method: "PUT",
                  headers: { "Content-Type": "application/json", ...authHeaders() },
                  body: JSON.stringify({ status }),
                });
                const body = await res.json().catch(() => ({}));
                if (!res.ok)
                  throw new Error(typeof body.error === "string" ? body.error : "Could not update.");
                setTasks((prev) => prev.map((t) => (t.id === task.id ? body.task : t)));
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Could not update.");
              }
            }}
          />
        ) : tasks.length === 0 ? (
          <div className={styles.emptyState}>
            <h3>No tasks yet</h3>
            <p>Click &ldquo;New Task&rdquo; to create your first one.</p>
          </div>
        ) : (
          <>
            {section("Overdue", buckets.overdue, "overdue")}
            {section("Due Today", buckets.dueToday, "today")}
            {section("This Week", buckets.thisWeek)}
            {section("Upcoming", buckets.upcoming)}
            {section("No Due Date", buckets.noDate)}
            {section("Completed", buckets.completed)}
          </>
        )}
      </div>

      <CreateTaskModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(task) => setTasks((prev) => [task, ...prev])}
        users={users}
      />
      <LaunchProcessModal open={launchOpen} onClose={() => setLaunchOpen(false)} />
      {propertyModal ? (
        <PropertyContextPanel
          propertyId={propertyModal.propertyId}
          propertyName={propertyModal.propertyName}
          onClose={() => setPropertyModal(null)}
        />
      ) : null}
    </div>
  );
}

function BoardView({
  tasks,
  onStatusChange,
}: {
  tasks: Task[];
  onStatusChange: (task: Task, status: TaskStatus) => void;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const columns: { status: TaskStatus; label: string; cls: string }[] = [
    { status: "pending", label: "Pending", cls: styles.boardColumnHeaderPending },
    { status: "in_progress", label: "In Progress", cls: styles.boardColumnHeaderInProgress },
    { status: "completed", label: "Completed", cls: styles.boardColumnHeaderCompleted },
  ];

  return (
    <div className={styles.board}>
      {columns.map(({ status, label, cls }) => {
        const colTasks = tasks.filter((t) => t.status === status);
        return (
          <div
            key={status}
            className={styles.boardColumn}
            onDragOver={(e) => {
              e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = Number(e.dataTransfer.getData("text/plain"));
              const task = tasks.find((t) => t.id === id);
              if (task && task.status !== status) {
                onStatusChange(task, status);
              }
              setDragging(null);
            }}
          >
            <div className={`${styles.boardColumnHeader} ${cls}`}>
              <span className={styles.boardColumnTitle}>{label}</span>
              <span className={styles.sectionCount}>{colTasks.length}</span>
            </div>
            <div className={styles.boardCards}>
              {colTasks.map((t) => (
                <div
                  key={t.id}
                  className={`${styles.boardCard} ${dragging === t.id ? styles.boardCardDragging : ""}`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", String(t.id));
                    setDragging(t.id);
                  }}
                  onDragEnd={() => setDragging(null)}
                >
                  <div className={styles.boardCardTitle}>{t.title}</div>
                  <div className={styles.boardCardMeta}>
                    <span>
                      <span
                        className={styles.priorityDot}
                        style={{ background: PRIORITY_COLOR[t.priority] }}
                      />
                      {t.priority}
                    </span>
                    {t.dueDate ? <span>· {formatDue(t.dueDate, t.dueTime)}</span> : null}
                    {t.assignedUserName ? (
                      <span className={styles.avatarChip}>
                        {t.assignedUserName
                          .split(" ")
                          .map((s) => s.charAt(0))
                          .join("")
                          .slice(0, 2)
                          .toUpperCase()}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
