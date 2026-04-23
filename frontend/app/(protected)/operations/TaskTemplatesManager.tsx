"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./operations.module.css";
import { apiUrl } from "../../../lib/api";
import { useAuth } from "../../../context/AuthContext";
import type { TeamUser } from "./types";

type TaskTemplate = {
  id: number;
  name: string;
  description: string | null;
  templateId: number | null;
  defaultAssigneeUserId: number | null;
  isSequential: boolean;
  isActive: boolean;
  itemCount?: number;
};

type TaskTemplateItem = {
  id: number;
  taskTemplateId: number;
  title: string;
  description: string | null;
  taskType: string;
  taskConfig: Record<string, unknown>;
  priority: string;
  dueDateConfig: Record<string, unknown>;
  assigneeOverrideUserId: number | null;
  stageId: number | null;
  sortOrder: number;
};

const TASK_TYPES = [
  { value: "todo", label: "✓ To-Do" },
  { value: "email", label: "✉ Email" },
  { value: "sms", label: "💬 SMS" },
  { value: "call", label: "📞 Call" },
];

const PRIORITIES = [
  { value: "asap", label: "ASAP" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

export default function TaskTemplatesManager({
  processTemplateId,
  users,
}: {
  processTemplateId: number;
  users: TeamUser[];
}) {
  const { authHeaders, token } = useAuth();
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [activeTemplateId, setActiveTemplateId] = useState<number | null>(null);
  const [items, setItems] = useState<TaskTemplateItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadTemplates = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(
        apiUrl(`/task-templates?templateId=${processTemplateId}`),
        { headers: { ...authHeaders() }, cache: "no-store" }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Load failed.");
      setTemplates(body.templates || []);
      if ((body.templates || []).length && activeTemplateId === null) {
        setActiveTemplateId(body.templates[0].id);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Load failed.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token, processTemplateId, activeTemplateId]);

  const loadItems = useCallback(
    async (ttId: number) => {
      try {
        const res = await fetch(apiUrl(`/task-templates/${ttId}`), {
          headers: { ...authHeaders() },
          cache: "no-store",
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return;
        setItems(body.items || []);
      } catch {
        /* ignore */
      }
    },
    [authHeaders]
  );

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);
  useEffect(() => {
    if (activeTemplateId) loadItems(activeTemplateId);
    else setItems([]);
  }, [activeTemplateId, loadItems]);

  const addTemplate = async () => {
    const name = prompt("Name the new task template:");
    if (!name?.trim()) return;
    try {
      const res = await fetch(apiUrl("/task-templates"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          name: name.trim(),
          templateId: processTemplateId,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Create failed.");
      setActiveTemplateId(body.template.id);
      await loadTemplates();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Create failed.");
    }
  };

  const updateTemplateField = async (
    tpl: TaskTemplate,
    patch: Partial<TaskTemplate>
  ) => {
    setTemplates((prev) => prev.map((t) => (t.id === tpl.id ? { ...t, ...patch } : t)));
    await fetch(apiUrl(`/task-templates/${tpl.id}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(patch),
    });
  };

  const deleteTemplate = async (tpl: TaskTemplate) => {
    if (!confirm(`Delete task template "${tpl.name}"?`)) return;
    await fetch(apiUrl(`/task-templates/${tpl.id}`), {
      method: "DELETE",
      headers: { ...authHeaders() },
    });
    if (activeTemplateId === tpl.id) setActiveTemplateId(null);
    await loadTemplates();
  };

  const addItem = async () => {
    if (!activeTemplateId) return;
    try {
      const res = await fetch(apiUrl(`/task-templates/${activeTemplateId}/items`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ title: "New task" }),
      });
      if (!res.ok) throw new Error("Add failed.");
      await loadItems(activeTemplateId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Add failed.");
    }
  };

  const updateItem = async (item: TaskTemplateItem, patch: Partial<TaskTemplateItem>) => {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, ...patch } : i)));
    await fetch(apiUrl(`/task-template-items/${item.id}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(patch),
    });
  };

  const deleteItem = async (item: TaskTemplateItem) => {
    if (!confirm(`Delete task "${item.title}"?`)) return;
    await fetch(apiUrl(`/task-template-items/${item.id}`), {
      method: "DELETE",
      headers: { ...authHeaders() },
    });
    if (activeTemplateId) await loadItems(activeTemplateId);
  };

  const activeTemplate = templates.find((t) => t.id === activeTemplateId);

  if (loading) return <div className={styles.loading}>Loading task templates…</div>;

  return (
    <div>
      {err ? <div className={styles.errorBanner}>{err}</div> : null}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
        <select
          className={styles.select}
          value={activeTemplateId ?? ""}
          onChange={(e) => setActiveTemplateId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">— Select template —</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={addTemplate}>
          + New Task Template
        </button>
        {activeTemplate ? (
          <button
            type="button"
            className={`${styles.btn} ${styles.btnDanger}`}
            onClick={() => deleteTemplate(activeTemplate)}
          >
            Delete
          </button>
        ) : null}
      </div>

      {activeTemplate ? (
        <div className={styles.cfSection}>
          <div className={styles.cfSectionBody}>
            <label className={styles.cfField}>
              <span className={styles.cfLabel}>Name</span>
              <input
                className={styles.cfInput}
                defaultValue={activeTemplate.name}
                onBlur={(e) => updateTemplateField(activeTemplate, { name: e.target.value })}
              />
            </label>
            <label className={styles.cfField}>
              <span className={styles.cfLabel}>Description</span>
              <textarea
                className={styles.cfTextarea}
                defaultValue={activeTemplate.description ?? ""}
                onBlur={(e) =>
                  updateTemplateField(activeTemplate, { description: e.target.value })
                }
              />
            </label>
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
                fontSize: "0.88rem",
                color: "#1b2856",
                fontWeight: 600,
              }}
            >
              <input
                type="checkbox"
                checked={activeTemplate.isSequential}
                onChange={(e) =>
                  updateTemplateField(activeTemplate, { isSequential: e.target.checked })
                }
              />
              Sequential mode (only next task visible)
            </label>
          </div>
        </div>
      ) : null}

      {activeTemplate ? (
        <div style={{ marginTop: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem", alignItems: "center" }}>
            <strong style={{ color: "#1b2856" }}>Tasks ({items.length})</strong>
            <button type="button" className={styles.smallBtn} onClick={addItem}>
              + Add Task
            </button>
          </div>
          {items.length === 0 ? (
            <div className={styles.emptyState}>No tasks yet.</div>
          ) : (
            items.map((it) => (
              <div key={it.id} className={styles.stepEditCard}>
                <span className={styles.stepEditNumber}>{it.sortOrder + 1}</span>
                <div className={styles.stepEditMain}>
                  <input
                    className={styles.cfInput}
                    defaultValue={it.title}
                    onBlur={(e) => updateItem(it, { title: e.target.value })}
                  />
                  <div className={styles.stepEditFieldRow}>
                    <label style={{ fontSize: "0.75rem", color: "#6a737b" }}>
                      Type
                      <select
                        className={styles.cfSelect}
                        defaultValue={it.taskType}
                        onChange={(e) => updateItem(it, { taskType: e.target.value })}
                      >
                        {TASK_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={{ fontSize: "0.75rem", color: "#6a737b" }}>
                      Priority
                      <select
                        className={styles.cfSelect}
                        defaultValue={it.priority}
                        onChange={(e) => updateItem(it, { priority: e.target.value })}
                      >
                        {PRIORITIES.map((p) => (
                          <option key={p.value} value={p.value}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={{ fontSize: "0.75rem", color: "#6a737b" }}>
                      Assignee override
                      <select
                        className={styles.cfSelect}
                        defaultValue={it.assigneeOverrideUserId ?? ""}
                        onChange={(e) =>
                          updateItem(it, {
                            assigneeOverrideUserId: e.target.value
                              ? Number(e.target.value)
                              : null,
                          })
                        }
                      >
                        <option value="">— Default —</option>
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.displayName}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <button
                    type="button"
                    className={`${styles.smallBtn} ${styles.smallBtnDanger}`}
                    onClick={() => deleteItem(it)}
                    style={{ alignSelf: "flex-start" }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
