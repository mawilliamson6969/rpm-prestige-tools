"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../../context/AuthContext";
import { apiUrl } from "../../../../lib/api";
import { currentQuarterLabel, quarterOptions } from "../dateUtils";
import styles from "../eos.module.css";

type Milestone = {
  id: number;
  rockId: number;
  title: string;
  isCompleted: boolean;
  completedAt: string | null;
  dueDate: string | null;
  displayOrder: number;
};

type Rock = {
  id: number;
  title: string;
  description: string;
  ownerUserId: number;
  ownerDisplayName: string;
  quarter: string;
  status: string;
  dueDate: string;
  completedAt: string | null;
  milestones: Milestone[];
};

type TeamUser = { id: number; displayName: string };

function initials(name: string) {
  const p = name.split(/\s+/).filter(Boolean);
  return p
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
}

function daysUntil(iso: string) {
  const t = Date.parse(iso.slice(0, 10));
  const d = Math.ceil((t - Date.now()) / 86400000);
  return d;
}

function statusStyle(s: string) {
  if (s === "on_track") return { bg: "rgba(45,139,78,0.15)", color: "#2d8b4e", label: "On track" };
  if (s === "off_track") return { bg: "rgba(179,35,23,0.12)", color: "#b32317", label: "Off track" };
  if (s === "completed") return { bg: "rgba(0,152,208,0.12)", color: "#0098d0", label: "Completed" };
  return { bg: "rgba(106,115,123,0.15)", color: "#6a737b", label: "Dropped" };
}

export default function RocksClient() {
  const { authHeaders, isAdmin } = useAuth();
  const [quarter, setQuarter] = useState(currentQuarterLabel);
  const [ownerFilter, setOwnerFilter] = useState<string>("");
  const [team, setTeam] = useState<TeamUser[]>([]);
  const [rocks, setRocks] = useState<Rock[]>([]);
  const [summary, setSummary] = useState({ total: 0, onTrack: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [updates, setUpdates] = useState<Record<number, { updateText: string; status: string; updatedAt: string; updatedByName?: string }[]>>(
    {}
  );

  const qOpts = useMemo(() => quarterOptions(new Date().getFullYear(), 2), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      q.set("quarter", quarter);
      if (ownerFilter) q.set("ownerUserId", ownerFilter);
      const res = await fetch(apiUrl(`/eos/rocks?${q}`), { headers: { ...authHeaders() } });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof j.error === "string" ? j.error : "Failed to load rocks");
      setRocks(j.rocks ?? []);
      setSummary(j.summary ?? { total: 0, onTrack: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, quarter, ownerFilter]);

  useEffect(() => {
    (async () => {
      const res = await fetch(apiUrl("/eos/team-users"), { headers: { ...authHeaders() } });
      const j = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(j.users)) setTeam(j.users);
    })();
  }, [authHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  const loadUpdates = useCallback(
    async (rockId: number) => {
      const res = await fetch(apiUrl(`/eos/rocks/${rockId}/updates`), { headers: { ...authHeaders() } });
      const j = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(j.updates)) {
        setUpdates((prev) => ({
          ...prev,
          [rockId]: j.updates.map(
            (u: { updateText: string; status: string; updatedAt: string; updatedByName?: string }) => u
          ),
        }));
      }
    },
    [authHeaders]
  );

  useEffect(() => {
    if (expanded != null) void loadUpdates(expanded);
  }, [expanded, loadUpdates]);

  const pct =
    summary.total > 0 ? Math.round((summary.onTrack / summary.total) * 100) : 0;

  return (
    <>
      <div className={styles.rocksSummary}>
        <label>
          Quarter
          <select className={styles.select} value={quarter} onChange={(e) => setQuarter(e.target.value)}>
            {qOpts.map((q) => (
              <option key={q} value={q}>
                {q}
              </option>
            ))}
          </select>
        </label>
        <label>
          Owner
          <select className={styles.select} value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
            <option value="">All</option>
            {team.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </select>
        </label>
        {isAdmin ? (
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => setAddOpen(true)}>
            Add Rock
          </button>
        ) : null}
        <div style={{ flex: "1 1 200px" }}>
          <div className={styles.muted} style={{ marginBottom: 4 }}>
            {summary.onTrack} of {summary.total} Rocks on track
          </div>
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      {error ? <div className={styles.alert}>{error}</div> : null}
      {loading ? <p className={styles.muted}>Loading…</p> : null}

      <div className={styles.rockGrid}>
        {rocks.map((r) => {
          const done = r.milestones.filter((m) => m.isCompleted).length;
          const total = r.milestones.length || 1;
          const bar = Math.round((done / total) * 100);
          const st = statusStyle(r.status);
          const open = expanded === r.id;
          return (
            <div key={r.id} className={`${styles.rockCard} ${open ? styles.rockCardOpen : ""}`}>
              <div
                role="button"
                tabIndex={0}
                className={styles.rockCard}
                style={{ cursor: open ? "default" : "pointer" }}
                onClick={() => setExpanded(open ? null : r.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") setExpanded(open ? null : r.id);
                }}
              >
                <div className={styles.rockHead}>
                  <div>
                    <h2 style={{ margin: "0 0 0.35rem", fontSize: "1.05rem", color: "#1b2856" }}>{r.title}</h2>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <div className={styles.avatar} style={{ background: "#0098d0" }}>
                        {initials(r.ownerDisplayName)}
                      </div>
                      <span style={{ fontSize: "0.85rem" }}>{r.ownerDisplayName}</span>
                      <span className={styles.badge} style={{ background: st.bg, color: st.color }}>
                        {st.label}
                      </span>
                    </div>
                  </div>
                  <div style={{ textAlign: "right", fontSize: "0.8rem", color: "#6a737b" }}>
                    Due {r.dueDate}
                    <br />
                    {daysUntil(r.dueDate)} days left
                  </div>
                </div>
                <div className={styles.progressTrack} style={{ marginTop: "0.75rem" }}>
                  <div className={styles.progressFill} style={{ width: `${bar}%`, background: "#1b2856" }} />
                </div>
              </div>

              {open ? (
                <div style={{ marginTop: "1rem" }}>
                  <p style={{ fontSize: "0.9rem", lineHeight: 1.5 }}>{r.description || "—"}</p>
                  <h3 style={{ fontSize: "0.9rem", color: "#1b2856" }}>Milestones</h3>
                  <ul style={{ paddingLeft: "1.1rem" }}>
                    {r.milestones.map((m) => (
                      <li key={m.id} style={{ marginBottom: "0.35rem" }}>
                        <label style={{ cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={m.isCompleted}
                            onChange={async (e) => {
                              await fetch(apiUrl(`/eos/rocks/${r.id}/milestones/${m.id}`), {
                                method: "PUT",
                                headers: { "Content-Type": "application/json", ...authHeaders() },
                                body: JSON.stringify({ isCompleted: e.target.checked }),
                              });
                              load();
                            }}
                          />{" "}
                          {m.title}
                        </label>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnGhost}`}
                    style={{ marginTop: "0.5rem" }}
                    onClick={async () => {
                      const t = window.prompt("Milestone title");
                      if (!t?.trim()) return;
                      await fetch(apiUrl(`/eos/rocks/${r.id}/milestones`), {
                        method: "POST",
                        headers: { "Content-Type": "application/json", ...authHeaders() },
                        body: JSON.stringify({ title: t.trim() }),
                      });
                      load();
                    }}
                  >
                    Add milestone
                  </button>

                  <h3 style={{ fontSize: "0.9rem", color: "#1b2856", marginTop: "1rem" }}>Updates</h3>
                  <div className={styles.timeline}>
                    {(updates[r.id] ?? []).map((u, i) => (
                      <div key={i} className={styles.timelineItem}>
                        <strong>{u.status === "on_track" ? "On track" : "Off track"}</strong> ·{" "}
                        {new Date(u.updatedAt).toLocaleString()} — {u.updateText}
                      </div>
                    ))}
                  </div>
                  <AddRockUpdate rockId={r.id} authHeaders={authHeaders} onAdded={() => loadUpdates(r.id)} />

                  <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className={styles.presetBtn}
                      onClick={async () => {
                        const next = r.status === "on_track" ? "off_track" : "on_track";
                        await fetch(apiUrl(`/eos/rocks/${r.id}`), {
                          method: "PUT",
                          headers: { "Content-Type": "application/json", ...authHeaders() },
                          body: JSON.stringify({ status: next }),
                        });
                        load();
                      }}
                    >
                      Toggle on/off track
                    </button>
                    {isAdmin ? (
                      <button
                        type="button"
                        className={styles.presetBtn}
                        onClick={async () => {
                          if (!confirm("Delete this Rock?")) return;
                          await fetch(apiUrl(`/eos/rocks/${r.id}`), { method: "DELETE", headers: { ...authHeaders() } });
                          setExpanded(null);
                          load();
                        }}
                      >
                        Delete rock
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {addOpen && isAdmin ? (
        <AddRockModal
          team={team}
          defaultQuarter={quarter}
          authHeaders={authHeaders}
          onClose={() => setAddOpen(false)}
          onSaved={() => {
            setAddOpen(false);
            load();
          }}
        />
      ) : null}
    </>
  );
}

function AddRockUpdate({
  rockId,
  authHeaders,
  onAdded,
}: {
  rockId: number;
  authHeaders: () => Record<string, string>;
  onAdded: () => void;
}) {
  const [text, setText] = useState("");
  const [st, setSt] = useState<"on_track" | "off_track">("on_track");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
      <textarea className={styles.textarea} rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Weekly update…" />
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <label>
          <input type="radio" checked={st === "on_track"} onChange={() => setSt("on_track")} /> On track
        </label>
        <label>
          <input type="radio" checked={st === "off_track"} onChange={() => setSt("off_track")} /> Off track
        </label>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={async () => {
            if (!text.trim()) return;
            await fetch(apiUrl(`/eos/rocks/${rockId}/updates`), {
              method: "POST",
              headers: { "Content-Type": "application/json", ...authHeaders() },
              body: JSON.stringify({ updateText: text.trim(), status: st }),
            });
            setText("");
            onAdded();
          }}
        >
          Add update
        </button>
      </div>
    </div>
  );
}

function AddRockModal({
  team,
  defaultQuarter,
  authHeaders,
  onClose,
  onSaved,
}: {
  team: TeamUser[];
  defaultQuarter: string;
  authHeaders: () => Record<string, string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ownerUserId, setOwnerUserId] = useState(team[0]?.id ?? "");
  const [q, setQ] = useState(defaultQuarter);
  const [due, setDue] = useState("2026-06-30");
  const [milestones, setMilestones] = useState<string[]>([""]);

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modal} style={{ maxWidth: "28rem" }}>
        <h2>New Rock</h2>
        <div className={styles.formGrid}>
          <label>
            Title
            <input className={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            Description
            <textarea className={styles.textarea} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label>
            Owner
            <select
              className={styles.select}
              value={ownerUserId}
              onChange={(e) => setOwnerUserId(Number(e.target.value))}
            >
              {team.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Quarter
            <input className={styles.input} value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <label>
            Due date
            <input className={styles.dateIn} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
          <div>
            <div className={styles.muted}>Milestones</div>
            {milestones.map((m, i) => (
              <input
                key={i}
                className={styles.input}
                style={{ marginBottom: 4 }}
                value={m}
                placeholder={`Milestone ${i + 1}`}
                onChange={(e) =>
                  setMilestones((prev) => {
                    const n = [...prev];
                    n[i] = e.target.value;
                    return n;
                  })
                }
              />
            ))}
            <button type="button" className={styles.presetBtn} onClick={() => setMilestones((p) => [...p, ""])}>
              + Milestone
            </button>
          </div>
        </div>
        <div className={styles.modalActions}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={async () => {
              await fetch(apiUrl("/eos/rocks"), {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify({
                  title: title.trim(),
                  description: description.trim(),
                  ownerUserId,
                  quarter: q.trim(),
                  dueDate: due,
                  milestones: milestones.map((x) => x.trim()).filter(Boolean),
                }),
              });
              onSaved();
            }}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
