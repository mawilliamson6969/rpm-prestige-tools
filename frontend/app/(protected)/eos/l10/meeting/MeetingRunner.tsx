"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../../../context/AuthContext";
import { apiUrl } from "../../../../../lib/api";
import { currentQuarterLabel, mondayOf, ymd } from "../../dateUtils";
import styles from "../../eos.module.css";

const SECTIONS = [
  { label: "Segue", seconds: 300, noteKey: "segueNotes" as const },
  { label: "Scorecard review", seconds: 300, noteKey: "scorecardNotes" as const },
  { label: "Rock review", seconds: 300, noteKey: "rockReviewNotes" as const },
  { label: "Headlines", seconds: 300, noteKey: "headlines" as const },
  { label: "To-do list", seconds: 300, noteKey: null },
  { label: "IDS", seconds: 3600, noteKey: "idsNotes" as const },
  { label: "Conclude", seconds: 300, noteKey: "concludeNotes" as const },
];

type Meeting = {
  id: number;
  meeting_date: string;
  status: string;
  segue_notes: string | null;
  scorecard_notes: string | null;
  rock_review_notes: string | null;
  headlines: string | null;
  ids_notes: string | null;
  conclude_notes: string | null;
};

type Issue = {
  id: number;
  title: string;
  description: string | null;
  discussion_notes: string | null;
  priority: number;
  status: string;
};

export default function MeetingRunner({ meetingId }: { meetingId: string }) {
  const { authHeaders } = useAuth();
  const [sectionIdx, setSectionIdx] = useState(0);
  const [remain, setRemain] = useState(SECTIONS[0].seconds);
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [todos, setTodos] = useState<
    { id: number; title: string; due_date: string; is_completed: boolean; owner_user_id: number }[]
  >([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [rocks, setRocks] = useState<{ id: number; title: string; status: string }[]>([]);
  const [scorecard, setScorecard] = useState<{
    metrics: { id: number; name: string; unit: string }[];
    periods: { key: string; label: string }[];
    cells: Record<number, Record<string, { meetsGoal: boolean | null; value: number } | null>>;
  } | null>(null);
  const [team, setTeam] = useState<{ id: number; displayName: string }[]>([]);
  const [indScorecards, setIndScorecards] = useState<{ id: number; name: string; ownerDisplayName: string }[]>([]);
  const [scorecardSource, setScorecardSource] = useState<string>("company");
  const [ratings, setRatings] = useState<Record<number, number>>({});
  const [startedAt] = useState(() => Date.now());

  const sec = SECTIONS[sectionIdx];

  const loadMeeting = useCallback(async () => {
    const res = await fetch(apiUrl(`/eos/l10/meetings/${meetingId}`), { headers: { ...authHeaders() } });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.meeting) setMeeting(j.meeting);
  }, [authHeaders, meetingId]);

  const loadRest = useCallback(async () => {
    const [t, i, r, u] = await Promise.all([
      fetch(apiUrl("/eos/l10/todos?status=open"), { headers: { ...authHeaders() } }).then((x) => x.json()),
      fetch(apiUrl("/eos/l10/issues?status=open"), { headers: { ...authHeaders() } }).then((x) => x.json()),
      fetch(apiUrl(`/eos/rocks?quarter=${encodeURIComponent(currentQuarterLabel())}`), {
        headers: { ...authHeaders() },
      }).then((x) => x.json()),
      fetch(apiUrl("/eos/team-users"), { headers: { ...authHeaders() } }).then((x) => x.json()),
    ]);
    setTodos(Array.isArray(t.todos) ? t.todos : []);
    setIssues(Array.isArray(i.issues) ? i.issues : []);
    setRocks(Array.isArray(r.rocks) ? r.rocks.map((x: { id: number; title: string; status: string }) => x) : []);
    setTeam(Array.isArray(u.users) ? u.users : []);
    const mon = mondayOf(new Date());
    const s = ymd(mon);
    const rep = await fetch(
      apiUrl(`/eos/scorecard/report?startDate=${s}&endDate=${s}&frequency=weekly`),
      { headers: { ...authHeaders() } }
    ).then((x) => x.json());
    if (rep.metrics) setScorecard(rep);
    const indRes = await fetch(apiUrl("/eos/individual-scorecards"), { headers: { ...authHeaders() } }).then((x) => x.json());
    if (Array.isArray(indRes.scorecards)) setIndScorecards(indRes.scorecards);
  }, [authHeaders]);

  useEffect(() => {
    loadMeeting();
    loadRest();
  }, [loadMeeting, loadRest]);

  useEffect(() => {
    if (scorecardSource === "company") return;
    const scId = Number(scorecardSource);
    if (!Number.isFinite(scId)) return;
    const mon = mondayOf(new Date());
    const s = ymd(mon);
    fetch(apiUrl(`/eos/individual-scorecards/${scId}/report?startDate=${s}&endDate=${s}&frequency=weekly`), {
      headers: { ...authHeaders() },
    })
      .then((x) => x.json())
      .then((rep) => { if (rep.metrics) setScorecard(rep); });
  }, [scorecardSource, authHeaders]);

  useEffect(() => {
    setRemain(SECTIONS[sectionIdx].seconds);
  }, [sectionIdx]);

  useEffect(() => {
    const id = setInterval(() => setRemain((x) => x - 1), 1000);
    return () => clearInterval(id);
  }, []);

  const saveNotes = async (partial: Record<string, string>) => {
    await fetch(apiUrl(`/eos/l10/meetings/${meetingId}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(partial),
    });
    loadMeeting();
  };

  const fmt = (s: number) => {
    const neg = s < 0;
    const a = Math.abs(s);
    const mm = Math.floor(a / 60);
    const ss = a % 60;
    return `${neg ? "−" : ""}${mm}:${String(ss).padStart(2, "0")}`;
  };

  const timerClass = remain <= 0 ? styles.timerOver : remain <= 60 ? styles.timerWarn : styles.timer;

  const sortedIssues = useMemo(() => [...issues].sort((a, b) => a.priority - b.priority), [issues]);

  const moveIssue = async (id: number, dir: -1 | 1) => {
    const idx = sortedIssues.findIndex((x) => x.id === id);
    const sw = sortedIssues[idx + dir];
    if (!sw) return;
    const next = [...sortedIssues];
    [next[idx], next[idx + dir]] = [next[idx + dir], next[idx]];
    await fetch(apiUrl("/eos/l10/issues/reorder"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ orderedIds: next.map((x) => x.id) }),
    });
    loadRest();
  };

  const totalElapsed = Math.floor((Date.now() - startedAt) / 1000);

  return (
    <div className={styles.sectionRunner}>
      <div style={{ marginBottom: "1rem" }}>
        <Link href="/eos/l10" className={styles.backLink} style={{ color: "#0098d0" }}>
          ← L10 list
        </Link>
      </div>
      <div className={styles.sectionHeader}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.2rem", color: "#1b2856" }}>
            {sec.label} · Section {sectionIdx + 1}/{SECTIONS.length}
          </h2>
          <p className={styles.muted} style={{ margin: "0.25rem 0 0" }}>
            Meeting total {fmt(totalElapsed)} · Timer {fmt(remain)}
          </p>
        </div>
        <div className={`${styles.timer} ${timerClass}`}>{fmt(remain)}</div>
      </div>

      {sec.noteKey && meeting ? (
        <NotesField noteKey={sec.noteKey} meeting={meeting} onSave={(body) => saveNotes(body)} />
      ) : null}

      {sectionIdx === 1 ? (
        <>
          <div style={{ marginBottom: "0.75rem" }}>
            <label className={styles.muted} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.82rem" }}>
              Scorecard
              <select className={styles.select} value={scorecardSource} onChange={(e) => {
                setScorecardSource(e.target.value);
                if (e.target.value === "company") {
                  const mon = mondayOf(new Date());
                  const s = ymd(mon);
                  fetch(apiUrl(`/eos/scorecard/report?startDate=${s}&endDate=${s}&frequency=weekly`), {
                    headers: { ...authHeaders() },
                  }).then((x) => x.json()).then((rep) => { if (rep.metrics) setScorecard(rep); });
                }
              }}>
                <option value="company">Company Scorecard</option>
                {indScorecards.map((sc) => (
                  <option key={sc.id} value={sc.id}>{sc.name} ({sc.ownerDisplayName})</option>
                ))}
              </select>
            </label>
          </div>
        </>
      ) : null}
      {sectionIdx === 1 && scorecard ? (
        <div className={`${styles.gridWrap} ${styles.compactGrid}`}>
          <table className={styles.scoreTable}>
            <thead>
              <tr>
                <th>Metric</th>
                {scorecard.periods.map((p) => (
                  <th key={p.key}>{p.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scorecard.metrics.map((m) => (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  {scorecard.periods.map((p) => {
                    const c = scorecard.cells[m.id]?.[p.key];
                    const bad = c && c.meetsGoal === false;
                    const cls = c ? (c.meetsGoal ? styles.cellOk : styles.cellBad) : styles.cellEmpty;
                    return (
                      <td key={p.key} className={cls}>
                        {c ? String(c.value) : "—"}
                        {bad ? (
                          <button
                            type="button"
                            className={styles.presetBtn}
                            style={{ marginLeft: 4 }}
                            onClick={async () => {
                              await fetch(apiUrl("/eos/l10/issues"), {
                                method: "POST",
                                headers: { "Content-Type": "application/json", ...authHeaders() },
                                body: JSON.stringify({
                                  title: `Scorecard off-goal: ${m.name} (${p.label})`,
                                  meetingId: Number(meetingId),
                                }),
                              });
                              loadRest();
                            }}
                          >
                            Issue
                          </button>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {sectionIdx === 2 ? (
        <ul>
          {rocks.map((r) => (
            <li key={r.id} style={{ marginBottom: 8 }}>
              <strong>{r.title}</strong> — {r.status.replace("_", " ")}
              <button
                type="button"
                className={styles.presetBtn}
                style={{ marginLeft: 8 }}
                onClick={async () => {
                  const next = r.status === "on_track" ? "off_track" : "on_track";
                  await fetch(apiUrl(`/eos/rocks/${r.id}`), {
                    method: "PUT",
                    headers: { "Content-Type": "application/json", ...authHeaders() },
                    body: JSON.stringify({ status: next }),
                  });
                  if (next === "off_track") {
                    await fetch(apiUrl("/eos/l10/issues"), {
                      method: "POST",
                      headers: { "Content-Type": "application/json", ...authHeaders() },
                      body: JSON.stringify({
                        title: `Rock off track: ${r.title}`,
                        meetingId: Number(meetingId),
                      }),
                    });
                  }
                  loadRest();
                }}
              >
                Toggle
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {sectionIdx === 4 ? (
        <section>
          <p className={styles.muted}>
            {todos.filter((x) => x.is_completed).length} of {todos.length} to-dos completed (target 90%+)
          </p>
          <ul style={{ paddingLeft: "1rem" }}>
            {todos.map((t) => (
              <li key={t.id} style={{ marginBottom: 6 }}>
                <label>
                  <input
                    type="checkbox"
                    checked={t.is_completed}
                    onChange={async (e) => {
                      await fetch(apiUrl(`/eos/l10/todos/${t.id}`), {
                        method: "PUT",
                        headers: { "Content-Type": "application/json", ...authHeaders() },
                        body: JSON.stringify({ isCompleted: e.target.checked }),
                      });
                      loadRest();
                    }}
                  />{" "}
                  {t.title} — {t.due_date}
                </label>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {sectionIdx === 5 ? (
        <section>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            style={{ marginBottom: "0.75rem" }}
            onClick={async () => {
              const title = window.prompt("Issue title");
              if (!title?.trim()) return;
              await fetch(apiUrl("/eos/l10/issues"), {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify({ title: title.trim(), meetingId: Number(meetingId) }),
              });
              loadRest();
            }}
          >
            Add issue
          </button>
          {sortedIssues.map((issue) => (
            <div key={issue.id} className={styles.issueRow}>
              <span className={styles.priority}>P{issue.priority}</span>
              <div style={{ flex: 1 }}>
                <strong>{issue.title}</strong>
                <div className={styles.muted}>{issue.description}</div>
                <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button type="button" className={styles.presetBtn} onClick={() => moveIssue(issue.id, -1)}>
                    ↑
                  </button>
                  <button type="button" className={styles.presetBtn} onClick={() => moveIssue(issue.id, 1)}>
                    ↓
                  </button>
                  <button
                    type="button"
                    className={styles.presetBtn}
                    onClick={async () => {
                      const res = window.prompt("Resolution?");
                      if (res == null) return;
                      await fetch(apiUrl(`/eos/l10/issues/${issue.id}`), {
                        method: "PUT",
                        headers: { "Content-Type": "application/json", ...authHeaders() },
                        body: JSON.stringify({ status: "resolved", resolution: res }),
                      });
                      loadRest();
                    }}
                  >
                    Resolve
                  </button>
                  <button
                    type="button"
                    className={styles.presetBtn}
                    onClick={async () => {
                      await fetch(apiUrl(`/eos/l10/issues/${issue.id}`), {
                        method: "PUT",
                        headers: { "Content-Type": "application/json", ...authHeaders() },
                        body: JSON.stringify({ status: "tabled" }),
                      });
                      loadRest();
                    }}
                  >
                    Table
                  </button>
                  <button
                    type="button"
                    className={styles.presetBtn}
                    onClick={async () => {
                      if (!confirm("Delete issue?")) return;
                      await fetch(apiUrl(`/eos/l10/issues/${issue.id}`), { method: "DELETE", headers: { ...authHeaders() } });
                      loadRest();
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {sectionIdx === 6 ? (
        <section>
          <p className={styles.muted}>Rate this meeting 1–10</p>
          {team.map((m) => (
            <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              {m.displayName}
              <input
                type="number"
                min={1}
                max={10}
                className={styles.input}
                style={{ width: 70 }}
                value={ratings[m.id] ?? ""}
                onChange={(e) =>
                  setRatings((prev) => ({ ...prev, [m.id]: Number(e.target.value) }))
                }
              />
            </label>
          ))}
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            style={{ marginTop: "1rem" }}
            onClick={async () => {
              const list = team
                .map((m) => ({ userId: m.id, rating: ratings[m.id] }))
                .filter((x) => x.rating >= 1 && x.rating <= 10);
              await fetch(apiUrl(`/eos/l10/meetings/${meetingId}/ratings`), {
                method: "PUT",
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify({ ratings: list }),
              });
              await fetch(apiUrl(`/eos/l10/meetings/${meetingId}`), {
                method: "PUT",
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify({
                  status: "completed",
                  endedAt: new Date().toISOString(),
                }),
              });
              window.location.href = "/eos/l10";
            }}
          >
            End meeting
          </button>
        </section>
      ) : null}

      <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={() => {
            if (sectionIdx < SECTIONS.length - 1) setSectionIdx((i) => i + 1);
          }}
        >
          Next section
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnGhost}`}
          onClick={async () => {
            await fetch(apiUrl(`/eos/l10/meetings/${meetingId}`), {
              method: "PUT",
              headers: { "Content-Type": "application/json", ...authHeaders() },
              body: JSON.stringify({ status: "in_progress", startedAt: new Date().toISOString() }),
            });
          }}
        >
          Mark in progress
        </button>
      </div>
    </div>
  );
}

function NotesField({
  noteKey,
  meeting,
  onSave,
}: {
  noteKey: string;
  meeting: Meeting;
  onSave: (body: Record<string, string>) => void;
}) {
  const meetingKey: Record<string, keyof Meeting> = {
    segueNotes: "segue_notes",
    scorecardNotes: "scorecard_notes",
    rockReviewNotes: "rock_review_notes",
    headlines: "headlines",
    idsNotes: "ids_notes",
    concludeNotes: "conclude_notes",
  };
  const apiBodyKey: Record<string, string> = {
    segueNotes: "segueNotes",
    scorecardNotes: "scorecardNotes",
    rockReviewNotes: "rockReviewNotes",
    headlines: "headlines",
    idsNotes: "idsNotes",
    concludeNotes: "concludeNotes",
  };
  const k = meetingKey[noteKey];
  const val = k ? String(meeting[k] ?? "") : "";
  return (
    <label style={{ display: "block", marginBottom: "0.75rem" }}>
      <span className={styles.muted}>Notes</span>
      <textarea
        className={styles.textarea}
        key={noteKey}
        defaultValue={val}
        onBlur={(e) => onSave({ [apiBodyKey[noteKey]]: e.target.value })}
      />
    </label>
  );
}
