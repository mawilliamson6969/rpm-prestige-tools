"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./operations.module.css";
import PropertyPicker, { type SelectedProperty } from "../../../components/PropertyPicker";
import { apiUrl } from "../../../lib/api";
import { useAuth } from "../../../context/AuthContext";
import type { Project, Task, TaskPriority, TeamUser } from "./types";
import { CATEGORIES, PRIORITY_OPTIONS } from "./types";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (task: Task) => void;
  users: TeamUser[];
  initial?: Partial<Task>;
};

export default function CreateTaskModal({ open, onClose, onCreated, users, initial }: Props) {
  const { authHeaders, user, token } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [assignedUserId, setAssignedUserId] = useState<string>("");
  const [property, setProperty] = useState<SelectedProperty | null>(null);
  const [contactName, setContactName] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [category, setCategory] = useState("");
  const [projectId, setProjectId] = useState<string>("");
  const [tagsInput, setTagsInput] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);

  const loadProjects = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl("/projects?status=active"), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = await res.json();
      if (Array.isArray(body.projects)) setProjects(body.projects);
    } catch {
      /* ignore */
    }
  }, [authHeaders, token]);

  useEffect(() => {
    if (open) loadProjects();
  }, [open, loadProjects]);

  useEffect(() => {
    if (!open) return;
    setTitle(initial?.title ?? "");
    setDescription(initial?.description ?? "");
    setPriority((initial?.priority as TaskPriority) ?? "normal");
    setAssignedUserId(
      String(initial?.assignedUserId ?? user?.id ?? "")
    );
    setProperty(
      initial?.propertyName
        ? { propertyId: initial.propertyId ?? null, propertyName: initial.propertyName }
        : null
    );
    setContactName(initial?.contactName ?? "");
    setDueDate(initial?.dueDate ?? "");
    setDueTime(initial?.dueTime ?? "");
    setCategory(initial?.category ?? "");
    setProjectId(initial?.projectId != null ? String(initial.projectId) : "");
    setTagsInput((initial?.tags ?? []).join(", "));
    setNotes(initial?.notes ?? "");
    setErr(null);
  }, [open, initial, user]);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setErr("Title is required.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(apiUrl("/tasks"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          priority,
          assignedUserId: assignedUserId ? Number(assignedUserId) : undefined,
          propertyName: property?.propertyName.trim() || undefined,
          propertyId: property?.propertyId ?? undefined,
          contactName: contactName.trim() || undefined,
          dueDate: dueDate || undefined,
          dueTime: dueTime || undefined,
          category: category || undefined,
          projectId: projectId ? Number(projectId) : undefined,
          tags: tagsInput
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          notes: notes.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Could not create task.");
      onCreated(body.task);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create task.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>New Task</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form className={styles.form} onSubmit={submit}>
          {err ? <div className={styles.errorBanner}>{err}</div> : null}
          <div className={styles.field}>
            <label>Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
          </div>
          <div className={styles.field}>
            <label>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What needs to be done?"
            />
          </div>
          <div className={styles.field}>
            <label>Priority</label>
            <div className={styles.priorityGroup}>
              {PRIORITY_OPTIONS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`${styles.priorityOpt} ${priority === p ? styles.priorityOptActive : ""}`}
                  onClick={() => setPriority(p)}
                >
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label>Assign to</label>
              <select value={assignedUserId} onChange={(e) => setAssignedUserId(e.target.value)}>
                <option value="">— Unassigned —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label>Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">— None —</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label>Due date</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div className={styles.field}>
              <label>Due time</label>
              <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
            </div>
          </div>
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label>Property (optional)</label>
              <PropertyPicker value={property} onChange={setProperty} />
            </div>
            <div className={styles.field}>
              <label>Contact (optional)</label>
              <input value={contactName} onChange={(e) => setContactName(e.target.value)} />
            </div>
          </div>
          <div className={styles.field}>
            <label>Project (optional)</label>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">— None —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.icon} {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label>Tags (comma separated)</label>
            <input
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="follow-up, urgent"
            />
          </div>
          <div className={styles.field}>
            <label>Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className={styles.formActions}>
            <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving}>
              {saving ? "Creating…" : "Create Task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
