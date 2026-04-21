"use client";

import { useEffect, useState } from "react";
import styles from "./operations.module.css";
import { apiUrl } from "../../../lib/api";
import { useAuth } from "../../../context/AuthContext";
import type { Task, TaskPriority, TeamUser } from "./types";
import { CATEGORIES, PRIORITY_OPTIONS } from "./types";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (task: Task) => void;
  users: TeamUser[];
  initial?: Partial<Task>;
};

export default function CreateTaskModal({ open, onClose, onCreated, users, initial }: Props) {
  const { authHeaders, user } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [assignedUserId, setAssignedUserId] = useState<string>("");
  const [propertyName, setPropertyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [category, setCategory] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(initial?.title ?? "");
    setDescription(initial?.description ?? "");
    setPriority((initial?.priority as TaskPriority) ?? "normal");
    setAssignedUserId(
      String(initial?.assignedUserId ?? user?.id ?? "")
    );
    setPropertyName(initial?.propertyName ?? "");
    setContactName(initial?.contactName ?? "");
    setDueDate(initial?.dueDate ?? "");
    setDueTime(initial?.dueTime ?? "");
    setCategory(initial?.category ?? "");
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
          propertyName: propertyName.trim() || undefined,
          contactName: contactName.trim() || undefined,
          dueDate: dueDate || undefined,
          dueTime: dueTime || undefined,
          category: category || undefined,
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
              <input
                value={propertyName}
                onChange={(e) => setPropertyName(e.target.value)}
                placeholder="e.g. 4017 Briar Hollow"
              />
            </div>
            <div className={styles.field}>
              <label>Contact (optional)</label>
              <input value={contactName} onChange={(e) => setContactName(e.target.value)} />
            </div>
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
