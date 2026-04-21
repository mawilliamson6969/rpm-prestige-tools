"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../../operations.module.css";
import OperationsTopBar from "../../OperationsTopBar";
import CreateTaskModal from "../../CreateTaskModal";
import CustomFieldsPanel from "../../CustomFieldsPanel";
import CustomFieldManager from "../../CustomFieldManager";
import { apiUrl } from "../../../../../lib/api";
import { useAuth } from "../../../../../context/AuthContext";
import type {
  Project,
  ProjectMember,
  ProjectMilestone,
  ProjectNote,
  ProjectStatus,
  Task,
  TeamUser,
} from "../../types";

type Tab = "overview" | "tasks" | "milestones" | "notes" | "activity";

type DetailResponse = {
  project: Project;
  milestones: ProjectMilestone[];
  members: ProjectMember[];
  notes: ProjectNote[];
  tasks: Array<Pick<Task, "id" | "title" | "status" | "priority" | "dueDate" | "assignedUserId" | "assignedUserName" | "completedAt">>;
  stats: {
    totalTasks: number;
    openTasks: number;
    completedTasks: number;
    overdueTasks: number;
    percentComplete: number;
    daysRemaining: number | null;
  };
};

type ActivityEvent = {
  kind: "task_created" | "task_completed" | "milestone_completed" | "note_added" | "member_added" | "status_changed";
  text: string;
  at: string;
  actor?: string | null;
};

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

function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function ProjectDetailClient({ projectId }: { projectId: string }) {
  const { authHeaders, token, isAdmin } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<DetailResponse | null>(null);
  const [fullTasks, setFullTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [editMenuOpen, setEditMenuOpen] = useState(false);
  const [taskModalOpen, setTaskModalOpen] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(apiUrl(`/projects/${projectId}`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(typeof body.error === "string" ? body.error : "Could not load project.");
      setData(body);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load project.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token, projectId]);

  const loadFullTasks = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl(`/projects/${projectId}/tasks`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(body.tasks)) setFullTasks(body.tasks);
    } catch {
      /* ignore */
    }
  }, [authHeaders, token, projectId]);

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
  useEffect(() => {
    if (activeTab === "tasks") loadFullTasks();
  }, [activeTab, loadFullTasks]);

  const changeStatus = async (status: ProjectStatus) => {
    try {
      const res = await fetch(apiUrl(`/projects/${projectId}/status`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Status update failed.");
      await load();
      setEditMenuOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Status update failed.");
    }
  };

  const updateName = async (name: string) => {
    try {
      await fetch(apiUrl(`/projects/${projectId}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name }),
      });
    } catch {
      /* ignore */
    }
  };

  const updateDescription = async (description: string) => {
    try {
      await fetch(apiUrl(`/projects/${projectId}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ description }),
      });
    } catch {
      /* ignore */
    }
  };

  const deleteProject = async () => {
    if (!confirm("Cancel this project? This marks it canceled but keeps data.")) return;
    try {
      const res = await fetch(apiUrl(`/projects/${projectId}`), {
        method: "DELETE",
        headers: { ...authHeaders() },
      });
      if (!res.ok) throw new Error("Delete failed.");
      router.push("/operations/projects");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed.");
    }
  };

  if (loading || !data) {
    return (
      <div className={styles.page}>
        <OperationsTopBar />
        <div className={styles.main}>
          {err ? <div className={styles.errorBanner}>{err}</div> : null}
          {!err ? <div className={styles.loading}>Loading project…</div> : null}
          <Link href="/operations/projects" className={`${styles.btn} ${styles.btnGhost}`}>
            ← Back to projects
          </Link>
        </div>
      </div>
    );
  }

  const { project, milestones, members, notes, tasks, stats } = data;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div className={styles.page}>
      <OperationsTopBar />
      <div className={styles.main}>
        <Link
          href="/operations/projects"
          style={{ color: "#0098d0", textDecoration: "none", fontSize: "0.85rem", fontWeight: 600 }}
        >
          ← All projects
        </Link>

        {err ? <div className={styles.errorBanner} style={{ marginTop: "0.75rem" }}>{err}</div> : null}

        <div className={styles.projectDetailHeader} style={{ borderLeftColor: project.color }}>
          <div className={styles.projectDetailTitleRow}>
            <div className={styles.projectDetailTitle}>
              <span className={styles.projectDetailIcon}>{project.icon}</span>
              <input
                className={styles.projectDetailName}
                defaultValue={project.name}
                onBlur={(e) => {
                  if (e.target.value.trim() && e.target.value !== project.name) {
                    updateName(e.target.value.trim());
                  }
                }}
                style={{
                  border: "none",
                  background: "transparent",
                  padding: 0,
                  fontSize: "1.4rem",
                  fontWeight: 700,
                  color: "#1b2856",
                  flex: 1,
                  minWidth: 0,
                  fontFamily: "inherit",
                }}
              />
            </div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <span className={`${styles.statusBadge} ${statusClass(project.status)}`}>
                {project.status.replace("_", " ")}
              </span>
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnGhost}`}
                  onClick={() => setEditMenuOpen((o) => !o)}
                >
                  ⋯
                </button>
                {editMenuOpen ? (
                  <div
                    style={{
                      position: "absolute",
                      right: 0,
                      top: "calc(100% + 0.25rem)",
                      background: "#fff",
                      borderRadius: 8,
                      boxShadow: "0 8px 24px rgba(27,40,86,0.18)",
                      minWidth: 180,
                      zIndex: 20,
                      padding: "0.35rem 0",
                      border: "1px solid rgba(27,40,86,0.1)",
                    }}
                  >
                    {project.status !== "active" ? (
                      <MenuBtn onClick={() => changeStatus("active")}>Resume</MenuBtn>
                    ) : null}
                    {project.status !== "on_hold" ? (
                      <MenuBtn onClick={() => changeStatus("on_hold")}>Put on hold</MenuBtn>
                    ) : null}
                    {project.status !== "completed" ? (
                      <MenuBtn onClick={() => changeStatus("completed")}>Mark complete</MenuBtn>
                    ) : null}
                    <MenuBtn onClick={deleteProject} danger>
                      Cancel project
                    </MenuBtn>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          <div className={styles.projectDetailMeta}>
            {project.ownerName ? <span>👤 Owner: {project.ownerName}</span> : null}
            {project.category ? <span className={styles.categoryTag}>{project.category}</span> : null}
            {project.targetDate ? (
              <span>
                🎯 Target: {new Date(project.targetDate).toLocaleDateString()}
                {stats.daysRemaining != null
                  ? stats.daysRemaining >= 0
                    ? ` (${stats.daysRemaining}d left)`
                    : ` (${Math.abs(stats.daysRemaining)}d overdue)`
                  : ""}
              </span>
            ) : null}
          </div>
        </div>

        <div className={styles.tabBar}>
          {(["overview", "tasks", "milestones", "notes", "activity"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              className={`${styles.tabBtn} ${activeTab === t ? styles.tabBtnActive : ""}`}
              onClick={() => setActiveTab(t)}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {activeTab === "overview" ? (
          <OverviewTab
            project={project}
            milestones={milestones}
            members={members}
            notes={notes}
            tasks={tasks}
            stats={stats}
            users={users}
            isAdmin={isAdmin}
            onDescription={(v) => {
              setData({ ...data, project: { ...project, description: v } });
              updateDescription(v);
            }}
          />
        ) : null}

        {activeTab === "tasks" ? (
          <TasksTab
            projectId={project.id}
            fullTasks={fullTasks}
            reload={loadFullTasks}
            users={users}
            onOpenCreate={() => setTaskModalOpen(true)}
          />
        ) : null}

        {activeTab === "milestones" ? (
          <MilestonesTab projectId={project.id} milestones={milestones} reload={load} />
        ) : null}

        {activeTab === "notes" ? <NotesTab projectId={project.id} notes={notes} reload={load} /> : null}

        {activeTab === "activity" ? (
          <ActivityTab project={project} milestones={milestones} notes={notes} tasks={tasks} members={members} />
        ) : null}
      </div>

      <CreateTaskModal
        open={taskModalOpen}
        onClose={() => setTaskModalOpen(false)}
        onCreated={() => {
          setTaskModalOpen(false);
          loadFullTasks();
          load();
        }}
        users={users}
        initial={{ projectId: project.id }}
      />
    </div>
  );
}

function MenuBtn({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "0.4rem 0.85rem",
        border: "none",
        background: "transparent",
        color: danger ? "#b32317" : "#1b2856",
        fontSize: "0.85rem",
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

function OverviewTab({
  project,
  milestones,
  members,
  notes,
  tasks,
  stats,
  users,
  isAdmin,
  onDescription,
}: {
  project: Project;
  milestones: ProjectMilestone[];
  members: ProjectMember[];
  notes: ProjectNote[];
  tasks: DetailResponse["tasks"];
  stats: DetailResponse["stats"];
  users: TeamUser[];
  isAdmin: boolean;
  onDescription: (v: string) => void;
}) {
  const [managingFields, setManagingFields] = useState(false);
  const recentTasks = tasks.slice(0, 5);
  const upcomingMilestones = milestones
    .filter((m) => m.status !== "completed")
    .slice(0, 3);
  const pinnedNotes = notes.filter((n) => n.isPinned);

  return (
    <div className={styles.projectLayout}>
      <div>
        <div className={styles.sidebarCard}>
          <h3>Description</h3>
          <textarea
            defaultValue={project.description ?? ""}
            placeholder="Describe this project…"
            rows={4}
            onBlur={(e) => onDescription(e.target.value.trim())}
            style={{
              width: "100%",
              border: "1px solid rgba(27,40,86,0.1)",
              borderRadius: 8,
              padding: "0.5rem 0.6rem",
              fontSize: "0.9rem",
              fontFamily: "inherit",
              color: "#333",
              boxSizing: "border-box",
              resize: "vertical",
            }}
          />
        </div>
        <div className={styles.sidebarCard}>
          <h3>Progress</h3>
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${stats.percentComplete}%` }} />
          </div>
          <div className={styles.projectStatHint} style={{ marginTop: "0.5rem" }}>
            <span>
              {stats.openTasks} open · {stats.completedTasks} completed · {stats.overdueTasks} overdue
            </span>
            <span>{stats.percentComplete}%</span>
          </div>
        </div>
        {recentTasks.length ? (
          <div className={styles.sidebarCard}>
            <h3>Recent tasks</h3>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {recentTasks.map((t) => (
                <li
                  key={t.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "0.5rem",
                    fontSize: "0.88rem",
                    color: "#1b2856",
                  }}
                >
                  <span>
                    {t.status === "completed" ? "✓" : "○"} {t.title}
                  </span>
                  {t.assignedUserName ? (
                    <span style={{ color: "#6a737b", fontSize: "0.8rem" }}>{t.assignedUserName}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {upcomingMilestones.length ? (
          <div className={styles.sidebarCard}>
            <h3>Upcoming milestones</h3>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {upcomingMilestones.map((m) => (
                <li
                  key={m.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "0.5rem",
                    fontSize: "0.88rem",
                    color: "#1b2856",
                  }}
                >
                  <span>{m.name}</span>
                  <span style={{ color: "#6a737b", fontSize: "0.8rem" }}>
                    {m.dueDate ? new Date(m.dueDate).toLocaleDateString() : "No date"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <aside>
        <div className={styles.sidebarCard}>
          <h3>Details</h3>
          <div className={styles.sidebarRow}>
            <span className={styles.sidebarLabel}>Category</span>
            <span className={styles.sidebarValue}>{project.category ?? "—"}</span>
          </div>
          <div className={styles.sidebarRow}>
            <span className={styles.sidebarLabel}>Start</span>
            <span className={styles.sidebarValue}>
              {project.startDate ? new Date(project.startDate).toLocaleDateString() : "—"}
            </span>
          </div>
          <div className={styles.sidebarRow}>
            <span className={styles.sidebarLabel}>Target</span>
            <span className={styles.sidebarValue}>
              {project.targetDate ? new Date(project.targetDate).toLocaleDateString() : "—"}
            </span>
          </div>
          {project.budget != null ? (
            <div className={styles.sidebarRow}>
              <span className={styles.sidebarLabel}>Budget</span>
              <span className={styles.sidebarValue}>${project.budget.toLocaleString()}</span>
            </div>
          ) : null}
          {project.propertyName ? (
            <div className={styles.sidebarRow}>
              <span className={styles.sidebarLabel}>Property</span>
              <span className={styles.sidebarValue}>{project.propertyName}</span>
            </div>
          ) : null}
        </div>
        <div className={styles.sidebarCard}>
          <h3>Team</h3>
          {members.length === 0 ? (
            <div className={styles.projectStatHint}>No members yet.</div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {members.map((m) => (
                <li
                  key={m.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "0.5rem",
                    fontSize: "0.85rem",
                    color: "#1b2856",
                  }}
                >
                  <span>👤 {m.displayName ?? m.username}</span>
                  <span className={styles.categoryTag}>{m.role}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {project.tags.length ? (
          <div className={styles.sidebarCard}>
            <h3>Tags</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
              {project.tags.map((t) => (
                <span key={t} className={styles.tagChip}>
                  #{t}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {pinnedNotes.length ? (
          <div className={styles.sidebarCard}>
            <h3>Pinned notes</h3>
            {pinnedNotes.map((n) => (
              <div key={n.id} style={{ fontSize: "0.85rem", color: "#333", marginBottom: "0.5rem" }}>
                {n.title ? (
                  <strong style={{ color: "#1b2856", display: "block", marginBottom: "0.15rem" }}>
                    {n.title}
                  </strong>
                ) : null}
                <div style={{ whiteSpace: "pre-wrap" }}>{n.content}</div>
              </div>
            ))}
          </div>
        ) : null}
        <div className={styles.sidebarCard}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "0.5rem",
            }}
          >
            <h3 style={{ margin: 0, border: "none", padding: 0 }}>Custom fields</h3>
            {isAdmin ? (
              <button
                type="button"
                className={styles.smallBtn}
                onClick={() => setManagingFields((v) => !v)}
              >
                {managingFields ? "Done" : "⚙ Manage"}
              </button>
            ) : null}
          </div>
          {managingFields ? (
            <CustomFieldManager entityType="project" entityId={project.id} />
          ) : (
            <CustomFieldsPanel
              entityType="project"
              entityId={project.id}
              users={users}
              hideCompletionBar
            />
          )}
        </div>
      </aside>
    </div>
  );
}

function TasksTab({
  projectId,
  fullTasks,
  reload,
  users,
  onOpenCreate,
}: {
  projectId: number;
  fullTasks: Task[];
  reload: () => void;
  users: TeamUser[];
  onOpenCreate: () => void;
}) {
  const { authHeaders } = useAuth();
  const toggleComplete = async (task: Task) => {
    const done = task.status !== "completed";
    try {
      await fetch(apiUrl(done ? `/tasks/${task.id}/complete` : `/tasks/${task.id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: done ? undefined : JSON.stringify({ status: "pending" }),
      });
      reload();
    } catch {
      /* ignore */
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem" }}>
        <span className={styles.projectStatHint}>
          {fullTasks.filter((t) => t.status !== "completed").length} open ·{" "}
          {fullTasks.filter((t) => t.status === "completed").length} completed
        </span>
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onOpenCreate}>
          + Add Task
        </button>
      </div>
      {fullTasks.length === 0 ? (
        <div className={styles.emptyState}>
          <h3>No tasks in this project yet</h3>
          <p>Add a task to start tracking work.</p>
        </div>
      ) : (
        <div className={styles.taskList}>
          {fullTasks.map((t) => {
            const done = t.status === "completed";
            const user = users.find((u) => u.id === t.assignedUserId);
            return (
              <div key={t.id} className={styles.taskCard}>
                <button
                  type="button"
                  className={`${styles.taskCheckbox} ${done ? styles.taskCheckboxDone : ""}`}
                  onClick={() => toggleComplete(t)}
                >
                  {done ? "✓" : ""}
                </button>
                <div className={styles.taskBody}>
                  <div className={styles.taskHeadRow}>
                    <span className={`${styles.taskTitle} ${done ? styles.taskTitleDone : ""}`}>
                      {t.title}
                    </span>
                    <span className={`${styles.priorityBadge} ${styles[`priority${t.priority.charAt(0).toUpperCase() + t.priority.slice(1)}` as keyof typeof styles] ?? ""}`}>
                      {t.priority}
                    </span>
                  </div>
                  <div className={styles.taskMeta}>
                    {user ? <span>👤 {user.displayName}</span> : null}
                    {t.dueDate ? <span>📅 {new Date(t.dueDate).toLocaleDateString()}</span> : null}
                    {t.category ? <span className={styles.categoryTag}>{t.category}</span> : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MilestonesTab({
  projectId,
  milestones,
  reload,
}: {
  projectId: number;
  milestones: ProjectMilestone[];
  reload: () => void;
}) {
  const { authHeaders } = useAuth();
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const addMilestone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await fetch(apiUrl(`/projects/${projectId}/milestones`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          name: name.trim(),
          dueDate: dueDate || undefined,
          description: description.trim() || undefined,
        }),
      });
      setName("");
      setDueDate("");
      setDescription("");
      setAddOpen(false);
      reload();
    } catch {
      /* ignore */
    }
  };

  const toggleComplete = async (m: ProjectMilestone) => {
    try {
      await fetch(apiUrl(`/projects/milestones/${m.id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ status: m.status === "completed" ? "pending" : "completed" }),
      });
      reload();
    } catch {
      /* ignore */
    }
  };

  const deleteMilestone = async (m: ProjectMilestone) => {
    if (!confirm(`Delete milestone "${m.name}"?`)) return;
    try {
      await fetch(apiUrl(`/projects/milestones/${m.id}`), {
        method: "DELETE",
        headers: { ...authHeaders() },
      });
      reload();
    } catch {
      /* ignore */
    }
  };

  const reorder = async (ids: number[]) => {
    try {
      await fetch(apiUrl(`/projects/${projectId}/milestones/reorder`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ milestoneIds: ids }),
      });
      reload();
    } catch {
      /* ignore */
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.75rem" }}>
        {!addOpen ? (
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => setAddOpen(true)}
          >
            + Add Milestone
          </button>
        ) : null}
      </div>
      {addOpen ? (
        <form className={styles.sidebarCard} onSubmit={addMilestone} style={{ marginBottom: "1rem" }}>
          <h3>New Milestone</h3>
          <div className={styles.field}>
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
          </div>
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label>Due date</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          <div className={styles.field}>
            <label>Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className={styles.formActions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={() => setAddOpen(false)}
            >
              Cancel
            </button>
            <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>
              Add
            </button>
          </div>
        </form>
      ) : null}

      {milestones.length === 0 ? (
        <div className={styles.emptyState}>
          <h3>No milestones yet</h3>
          <p>Milestones mark key checkpoints in your project.</p>
        </div>
      ) : (
        <div className={styles.milestoneList}>
          {milestones.map((m, idx) => {
            const completed = m.status === "completed";
            const overdue =
              !completed && m.dueDate && new Date(m.dueDate) < today;
            return (
              <div
                key={m.id}
                className={`${styles.milestoneCard} ${completed ? styles.milestoneCardCompleted : ""} ${
                  overdue ? styles.milestoneCardOverdue : ""
                }`}
                draggable
                onDragStart={() => setDragIdx(idx)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIdx === null || dragIdx === idx) return;
                  const reordered = [...milestones];
                  const [moved] = reordered.splice(dragIdx, 1);
                  reordered.splice(idx, 0, moved);
                  reorder(reordered.map((x) => x.id));
                  setDragIdx(null);
                }}
              >
                <button
                  type="button"
                  className={`${styles.milestoneDot} ${completed ? styles.milestoneDotCompleted : ""}`}
                  onClick={() => toggleComplete(m)}
                  aria-label={completed ? "Mark pending" : "Mark complete"}
                >
                  {completed ? "✓" : idx + 1}
                </button>
                <div className={styles.milestoneBody}>
                  <h4 className={`${styles.milestoneName} ${completed ? styles.milestoneNameCompleted : ""}`}>
                    {m.name}
                  </h4>
                  {m.description ? (
                    <p style={{ margin: "0.2rem 0", fontSize: "0.85rem", color: "#333" }}>
                      {m.description}
                    </p>
                  ) : null}
                  <div className={styles.milestoneMeta}>
                    {m.dueDate ? (
                      <span style={{ color: overdue ? "#b32317" : undefined }}>
                        📅 {new Date(m.dueDate).toLocaleDateString()}
                      </span>
                    ) : null}
                    {completed && m.completedAt ? (
                      <span>✓ Completed {new Date(m.completedAt).toLocaleDateString()}</span>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  className={`${styles.smallBtn} ${styles.smallBtnDanger}`}
                  onClick={() => deleteMilestone(m)}
                >
                  Delete
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NotesTab({
  projectId,
  notes,
  reload,
}: {
  projectId: number;
  notes: ProjectNote[];
  reload: () => void;
}) {
  const { authHeaders } = useAuth();
  const [addOpen, setAddOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    try {
      await fetch(apiUrl(`/projects/${projectId}/notes`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          title: title.trim() || undefined,
          content: content.trim(),
        }),
      });
      setTitle("");
      setContent("");
      setAddOpen(false);
      reload();
    } catch {
      /* ignore */
    }
  };

  const togglePin = async (n: ProjectNote) => {
    try {
      await fetch(apiUrl(`/projects/notes/${n.id}/pin`), {
        method: "PUT",
        headers: { ...authHeaders() },
      });
      reload();
    } catch {
      /* ignore */
    }
  };

  const deleteNote = async (n: ProjectNote) => {
    if (!confirm("Delete this note?")) return;
    try {
      await fetch(apiUrl(`/projects/notes/${n.id}`), {
        method: "DELETE",
        headers: { ...authHeaders() },
      });
      reload();
    } catch {
      /* ignore */
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

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.75rem" }}>
        {!addOpen ? (
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => setAddOpen(true)}
          >
            + Add Note
          </button>
        ) : null}
      </div>
      {addOpen ? (
        <form className={styles.sidebarCard} onSubmit={add} style={{ marginBottom: "1rem" }}>
          <h3>New Note</h3>
          <div className={styles.field}>
            <label>Title (optional)</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label>Content</label>
            <textarea
              rows={6}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              required
              autoFocus
              placeholder="Markdown supported…"
            />
          </div>
          <div className={styles.formActions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={() => setAddOpen(false)}
            >
              Cancel
            </button>
            <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>
              Save
            </button>
          </div>
        </form>
      ) : null}

      {notes.length === 0 ? (
        <div className={styles.emptyState}>
          <h3>No notes yet</h3>
          <p>Notes are a freeform journal for this project.</p>
        </div>
      ) : (
        <div>
          {notes.map((n) => {
            const isExpanded = expanded.has(n.id);
            return (
              <div
                key={n.id}
                className={`${styles.noteCard} ${n.isPinned ? styles.noteCardPinned : ""}`}
                onClick={() => toggleExpand(n.id)}
              >
                <div className={styles.noteMeta}>
                  <span>
                    {n.userName ? `${n.userName} · ` : ""}
                    {new Date(n.createdAt).toLocaleString()}
                  </span>
                  <div style={{ display: "flex", gap: "0.2rem" }}>
                    <button
                      type="button"
                      className={`${styles.pinBtn} ${n.isPinned ? styles.pinBtnActive : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePin(n);
                      }}
                      title={n.isPinned ? "Unpin" : "Pin"}
                    >
                      📌
                    </button>
                    <button
                      type="button"
                      className={styles.pinBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteNote(n);
                      }}
                      title="Delete"
                    >
                      ×
                    </button>
                  </div>
                </div>
                {n.title ? <h4 className={styles.noteTitle}>{n.title}</h4> : null}
                {isExpanded ? (
                  <div className={styles.noteFull}>{n.content}</div>
                ) : (
                  <p className={styles.notePreview}>{n.content}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ActivityTab({
  project,
  milestones,
  notes,
  tasks,
  members,
}: {
  project: Project;
  milestones: ProjectMilestone[];
  notes: ProjectNote[];
  tasks: DetailResponse["tasks"];
  members: ProjectMember[];
}) {
  const events = useMemo<ActivityEvent[]>(() => {
    const e: ActivityEvent[] = [];
    e.push({
      kind: "status_changed",
      text: `Project created${project.ownerName ? ` by ${project.ownerName}` : ""}`,
      at: project.createdAt,
      actor: project.ownerName,
    });
    for (const m of members) {
      e.push({
        kind: "member_added",
        text: `${m.displayName ?? m.username} added as ${m.role}`,
        at: m.addedAt,
        actor: m.displayName ?? m.username,
      });
    }
    for (const t of tasks) {
      e.push({
        kind: "task_created",
        text: `Task created: ${t.title}`,
        at: (t as unknown as { completedAt?: string; createdAt?: string }).completedAt ?? project.createdAt,
      });
      if (t.completedAt) {
        e.push({
          kind: "task_completed",
          text: `Task completed: ${t.title}`,
          at: t.completedAt,
          actor: t.assignedUserName,
        });
      }
    }
    for (const m of milestones) {
      if (m.status === "completed" && m.completedAt) {
        e.push({
          kind: "milestone_completed",
          text: `Milestone completed: ${m.name}`,
          at: m.completedAt,
        });
      }
    }
    for (const n of notes) {
      e.push({
        kind: "note_added",
        text: `Note added${n.title ? `: ${n.title}` : ""}`,
        at: n.createdAt,
        actor: n.userName,
      });
    }
    if (project.completedAt) {
      e.push({
        kind: "status_changed",
        text: `Project marked complete`,
        at: project.completedAt,
      });
    }
    e.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return e;
  }, [project, milestones, notes, tasks, members]);

  if (!events.length) {
    return (
      <div className={styles.emptyState}>
        <h3>No activity yet</h3>
      </div>
    );
  }

  return (
    <div className={styles.activityList}>
      {events.map((e, idx) => (
        <div key={idx} className={styles.activityItem}>
          <span className={styles.activitySmallAvatar}>{initials(e.actor ?? "System")}</span>
          <div className={styles.activityText}>
            {e.text}
            <div className={styles.activityTime}>{new Date(e.at).toLocaleString()}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
