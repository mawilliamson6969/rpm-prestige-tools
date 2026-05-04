"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../../operations.module.css";
import { apiUrl } from "../../../../../lib/api";
import { useAuth } from "../../../../../context/AuthContext";
import type {
  ProcessActivityItem,
  ProcessCommunication,
  ProcessRoleAssignment,
  ProcessTypeRole,
  TeamUser,
} from "../../types";

const ACTION_ICONS: Record<string, string> = {
  process_created: "🚀",
  stage_changed: "🔀",
  step_completed: "✅",
  step_skipped: "⏭️",
  note_added: "📝",
  field_updated: "✏️",
  email_sent: "✉️",
  text_sent: "💬",
  call_logged: "📞",
  note_logged: "📝",
  assignee_changed: "👤",
  role_assigned: "👥",
  file_uploaded: "📎",
};

function actionIcon(t: string): string {
  return ACTION_ICONS[t] || "•";
}

/* ---------- Roles assignment panel (sidebar) ---------- */

export function ProcessRolesPanel({
  processId,
  users,
}: {
  processId: number;
  users: TeamUser[];
}) {
  const { authHeaders, token } = useAuth();
  const [roles, setRoles] = useState<ProcessTypeRole[]>([]);
  const [assignments, setAssignments] = useState<ProcessRoleAssignment[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl(`/processes/${processId}/role-assignments`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = await res.json();
      if (Array.isArray(body.roles)) setRoles(body.roles);
      if (Array.isArray(body.assignments)) setAssignments(body.assignments);
    } catch {
      /* ignore */
    }
  }, [authHeaders, token, processId]);

  useEffect(() => {
    load();
  }, [load]);

  const assigneeFor = (roleName: string) =>
    assignments.find((a) => a.roleName === roleName)?.userId ?? "";

  const setAssignment = async (roleName: string, userId: string) => {
    setSaving(true);
    try {
      const res = await fetch(apiUrl(`/processes/${processId}/role-assignments`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          assignments: [{ roleName, userId: userId ? Number(userId) : null }],
        }),
      });
      if (res.ok) await load();
    } finally {
      setSaving(false);
    }
  };

  if (roles.length === 0) {
    return null;
  }

  return (
    <div className={styles.sidebarCard}>
      <h3>Roles</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {roles.map((role) => {
          const userId = assigneeFor(role.roleName);
          return (
            <div key={role.id} className={styles.sidebarRow}>
              <span className={styles.sidebarLabel}>
                {role.roleName}
                {role.isRequired ? <span style={{ color: "#B32317" }}> *</span> : null}
              </span>
              <select
                className={styles.select}
                value={userId === null ? "" : String(userId)}
                disabled={saving}
                onChange={(e) => setAssignment(role.roleName, e.target.value)}
                style={{ minWidth: 140 }}
              >
                <option value="">— Unassigned —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Activity feed ---------- */

export function ProcessActivityPanel({ processId }: { processId: number }) {
  const { authHeaders, token } = useAuth();
  const [items, setItems] = useState<ProcessActivityItem[]>([]);
  const [filter, setFilter] = useState<"all" | "notes" | "stages" | "comms">("all");
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    const params = new URLSearchParams();
    if (pinnedOnly) params.set("pinnedOnly", "true");
    if (filter === "notes") params.set("type", "note_added");
    if (filter === "stages") params.set("type", "stage_changed,step_completed,step_skipped,process_created");
    if (filter === "comms") params.set("type", "email_sent,text_sent,call_logged,note_logged");
    try {
      const res = await fetch(
        apiUrl(`/processes/${processId}/activity${params.toString() ? `?${params}` : ""}`),
        { headers: { ...authHeaders() }, cache: "no-store" }
      );
      if (!res.ok) return;
      const body = await res.json();
      if (Array.isArray(body.activity)) setItems(body.activity);
    } catch {
      /* ignore */
    }
  }, [authHeaders, token, processId, filter, pinnedOnly]);

  useEffect(() => {
    load();
  }, [load]);

  const addNote = async () => {
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    try {
      const res = await fetch(apiUrl(`/processes/${processId}/activity`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ description: text }),
      });
      if (res.ok) {
        setDraft("");
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  const togglePin = async (item: ProcessActivityItem) => {
    try {
      const res = await fetch(apiUrl(`/processes/process-activity/${item.id}/pin`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ pinned: !item.isPinned }),
      });
      if (res.ok) await load();
    } catch {
      /* ignore */
    }
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: "0.4rem",
          flexWrap: "wrap",
          marginBottom: "0.75rem",
        }}
      >
        {(["all", "notes", "stages", "comms"] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={`${styles.cfChip} ${filter === f ? styles.cfChipActive : ""}`}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "All" : f === "notes" ? "Notes" : f === "stages" ? "Stage / Step" : "Comms"}
          </button>
        ))}
        <label
          style={{
            fontSize: "0.82rem",
            color: "#1b2856",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.3rem",
            marginLeft: "auto",
          }}
        >
          <input
            type="checkbox"
            checked={pinnedOnly}
            onChange={(e) => setPinnedOnly(e.target.checked)}
          />
          Pinned only
        </label>
      </div>

      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          marginBottom: "0.75rem",
          alignItems: "flex-start",
        }}
      >
        <textarea
          className={styles.cfInput}
          rows={2}
          placeholder="Add a note…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{ flex: 1, resize: "vertical" }}
        />
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={addNote}
          disabled={busy || !draft.trim()}
        >
          + Note
        </button>
      </div>

      {items.length === 0 ? (
        <div
          style={{
            fontSize: "0.85rem",
            color: "#6a737b",
            padding: "0.75rem",
            border: "1px dashed rgba(27, 40, 86, 0.15)",
            borderRadius: 8,
          }}
        >
          No activity yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {items.map((item) => (
            <div
              key={item.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "0.5rem",
                padding: "0.5rem 0.75rem",
                background: item.isPinned ? "rgba(0, 152, 208, 0.06)" : "transparent",
                border: `1px solid ${item.isPinned ? "rgba(0, 152, 208, 0.25)" : "rgba(27, 40, 86, 0.06)"}`,
                borderRadius: 8,
              }}
            >
              <span style={{ fontSize: "1.05rem", lineHeight: 1.2 }}>
                {actionIcon(item.actionType)}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "0.88rem", color: "#1b2856" }}>{item.description}</div>
                <div style={{ fontSize: "0.72rem", color: "#6a737b", marginTop: "0.15rem" }}>
                  {item.actorName || (item.actorType === "system" ? "System" : "Someone")} ·{" "}
                  {new Date(item.createdAt).toLocaleString()}
                </div>
              </div>
              <button
                type="button"
                className={styles.smallBtn}
                onClick={() => togglePin(item)}
                title={item.isPinned ? "Unpin" : "Pin"}
                aria-label={item.isPinned ? "Unpin item" : "Pin item"}
              >
                {item.isPinned ? "📍" : "📌"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Communications log ---------- */

export function ProcessCommunicationsPanel({ processId }: { processId: number }) {
  const { authHeaders, token } = useAuth();
  const [items, setItems] = useState<ProcessCommunication[]>([]);
  const [draft, setDraft] = useState<{
    channel: ProcessCommunication["channel"];
    subject: string;
    body: string;
    toAddress: string;
  }>({ channel: "note", subject: "", body: "", toAddress: "" });
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl(`/processes/${processId}/communications`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = await res.json();
      if (Array.isArray(body.communications)) setItems(body.communications);
    } catch {
      /* ignore */
    }
  }, [authHeaders, token, processId]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!draft.body.trim() && !draft.subject.trim()) {
      setErr("Subject or body is required.");
      return;
    }
    try {
      const res = await fetch(apiUrl(`/processes/${processId}/communications`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          channel: draft.channel,
          subject: draft.subject || null,
          body: draft.body || null,
          toAddress: draft.toAddress || null,
          direction: "outbound",
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      setDraft({ channel: "note", subject: "", body: "", toAddress: "" });
      setOpen(false);
      setErr(null);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed.");
    }
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.75rem",
        }}
      >
        <h3 style={{ margin: 0, color: "#1b2856", fontSize: "1rem" }}>
          Communications ({items.length})
        </h3>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Cancel" : "+ Log communication"}
        </button>
      </div>

      {open ? (
        <div
          style={{
            padding: "0.75rem",
            border: "1px solid rgba(0, 152, 208, 0.3)",
            borderRadius: 8,
            background: "rgba(0, 152, 208, 0.04)",
            marginBottom: "1rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
          }}
        >
          {err ? <div className={styles.errorBanner}>{err}</div> : null}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <select
              className={styles.cfSelect}
              value={draft.channel}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  channel: e.target.value as ProcessCommunication["channel"],
                })
              }
            >
              <option value="email">Email</option>
              <option value="sms">SMS</option>
              <option value="call">Call</option>
              <option value="note">Note</option>
            </select>
            <input
              className={styles.cfInput}
              value={draft.toAddress}
              onChange={(e) => setDraft({ ...draft, toAddress: e.target.value })}
              placeholder={
                draft.channel === "email"
                  ? "To (email)"
                  : draft.channel === "sms" || draft.channel === "call"
                  ? "Phone number"
                  : "Recipient (optional)"
              }
              style={{ flex: 1 }}
            />
          </div>
          {draft.channel === "email" ? (
            <input
              className={styles.cfInput}
              value={draft.subject}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              placeholder="Subject"
            />
          ) : null}
          <textarea
            className={styles.cfInput}
            rows={4}
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            placeholder="What was said / sent?"
            style={{ resize: "vertical" }}
          />
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={save}
            style={{ alignSelf: "flex-start" }}
          >
            Log
          </button>
        </div>
      ) : null}

      {items.length === 0 ? (
        <div
          style={{
            fontSize: "0.85rem",
            color: "#6a737b",
            padding: "0.75rem",
            border: "1px dashed rgba(27, 40, 86, 0.15)",
            borderRadius: 8,
          }}
        >
          No communications logged yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {items.map((c) => (
            <div
              key={c.id}
              style={{
                padding: "0.6rem 0.75rem",
                background: "rgba(27, 40, 86, 0.03)",
                border: "1px solid rgba(27, 40, 86, 0.08)",
                borderRadius: 8,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: "0.78rem",
                      color: "#6a737b",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {c.channel}
                    {c.direction ? ` · ${c.direction}` : ""}
                    {c.toAddress ? ` · → ${c.toAddress}` : ""}
                  </div>
                  {c.subject ? (
                    <div style={{ fontWeight: 700, color: "#1b2856", marginTop: "0.15rem" }}>
                      {c.subject}
                    </div>
                  ) : null}
                  {c.body ? (
                    <div
                      style={{
                        fontSize: "0.85rem",
                        color: "#333",
                        marginTop: "0.25rem",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {c.body}
                    </div>
                  ) : null}
                </div>
                <div style={{ fontSize: "0.72rem", color: "#6a737b", whiteSpace: "nowrap" }}>
                  {new Date(c.createdAt).toLocaleString()}
                  {c.sentByName ? <div>by {c.sentByName}</div> : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
