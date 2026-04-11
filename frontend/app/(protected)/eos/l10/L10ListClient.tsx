"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../../context/AuthContext";
import { apiUrl } from "../../../../lib/api";
import styles from "../eos.module.css";

type MeetingRow = {
  id: number;
  meeting_date: string;
  status: string;
  started_at: string | null;
  ended_at: string | null;
};

type TodoRow = {
  id: number;
  title: string;
  owner_user_id: number;
  due_date: string;
  is_completed: boolean;
};

type IssueRow = {
  id: number;
  title: string;
  status: string;
  priority: number;
  description: string | null;
};

export default function L10ListClient() {
  const { authHeaders } = useAuth();
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [todos, setTodos] = useState<TodoRow[]>([]);
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, t, i] = await Promise.all([
        fetch(apiUrl("/eos/l10/meetings?limit=40"), { headers: { ...authHeaders() } }).then((r) => r.json()),
        fetch(apiUrl("/eos/l10/todos?status=open"), { headers: { ...authHeaders() } }).then((r) => r.json()),
        fetch(apiUrl("/eos/l10/issues?status=open"), { headers: { ...authHeaders() } }).then((r) => r.json()),
      ]);
      setMeetings(Array.isArray(m.meetings) ? m.meetings : []);
      setTodos(Array.isArray(t.todos) ? t.todos : []);
      setIssues(Array.isArray(i.issues) ? i.issues : []);
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  const startMeeting = async () => {
    setBusy(true);
    try {
      const res = await fetch(apiUrl("/eos/l10/meetings"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({}),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Could not start");
      const id = j.meeting?.id;
      if (id) window.location.href = `/eos/l10/meeting/${id}`;
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.l10List}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={startMeeting} disabled={busy}>
          {busy ? "Starting…" : "Start New L10"}
        </button>
        <span className={styles.muted}>Structured Level 10 agenda with timers on the next screen.</span>
      </div>

      {loading ? <p className={styles.muted}>Loading…</p> : null}

      <section>
        <h2 style={{ fontSize: "1rem", color: "#1b2856" }}>Past meetings</h2>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {meetings.map((m) => (
            <li key={m.id} className={styles.meetingRow}>
              <span>
                {m.meeting_date} — <strong>{m.status}</strong>
              </span>
              <Link href={`/eos/l10/meeting/${m.id}`} className={styles.presetBtn} style={{ textDecoration: "none" }}>
                Open
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 style={{ fontSize: "1rem", color: "#1b2856" }}>Open to-dos ({todos.length})</h2>
        <ul style={{ paddingLeft: "1.1rem" }}>
          {todos.map((t) => (
            <li key={t.id} style={{ marginBottom: "0.35rem" }}>
              {t.title} — due {t.due_date}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 style={{ fontSize: "1rem", color: "#1b2856" }}>Open issues ({issues.length})</h2>
        <ul style={{ paddingLeft: "1.1rem" }}>
          {issues.map((x) => (
            <li key={x.id} style={{ marginBottom: "0.35rem" }}>
              <strong>P{x.priority}</strong> {x.title}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
