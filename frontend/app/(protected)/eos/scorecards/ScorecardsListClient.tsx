"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../../../context/AuthContext";
import { apiUrl } from "../../../../lib/api";
import styles from "../eos.module.css";

type TeamUser = { id: number; displayName: string; username: string };

type Scorecard = {
  id: number;
  name: string;
  description: string | null;
  ownerUserId: number;
  ownerDisplayName: string;
  status: string;
  metricCount: number;
  lastEntryAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type Template = { id: string; label: string; metrics: string[] };

function relTime(iso: string | null) {
  if (!iso) return "Never";
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / 86400000);
  if (d < 1) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 30) return `${d} days ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

const AVATAR_COLORS = ["#0098D0", "#B32317", "#1B2856", "#2E7D6B", "#7c3aed"];

export default function ScorecardsListClient() {
  const { authHeaders, isAdmin, token } = useAuth();
  const [scorecards, setScorecards] = useState<Scorecard[]>([]);
  const [team, setTeam] = useState<TeamUser[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ownerFilter, setOwnerFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [editSc, setEditSc] = useState<Scorecard | null>(null);
  const [dupSc, setDupSc] = useState<Scorecard | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [scRes, tRes, tmplRes] = await Promise.all([
        fetch(apiUrl("/eos/individual-scorecards"), { headers: { ...authHeaders() }, cache: "no-store" }),
        fetch(apiUrl("/eos/team-users"), { headers: { ...authHeaders() } }),
        fetch(apiUrl("/eos/individual-scorecards/templates"), { headers: { ...authHeaders() } }),
      ]);
      const scBody = await scRes.json().catch(() => ({}));
      const tBody = await tRes.json().catch(() => ({}));
      const tmplBody = await tmplRes.json().catch(() => ({}));
      if (!scRes.ok) throw new Error(typeof scBody.error === "string" ? scBody.error : "Load failed");
      setScorecards(Array.isArray(scBody.scorecards) ? scBody.scorecards : []);
      setTeam(Array.isArray(tBody.users) ? tBody.users : []);
      setTemplates(Array.isArray(tmplBody.templates) ? tmplBody.templates : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!ownerFilter) return scorecards;
    return scorecards.filter((s) => s.ownerUserId === Number(ownerFilter));
  }, [scorecards, ownerFilter]);

  return (
    <>
      <p className={styles.muted}>Personal scorecards for individual team member metrics and accountability.</p>

      <div className={styles.toolbar}>
        {isAdmin ? (
          <label>
            Owner
            <select className={styles.select} value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
              <option value="">All</option>
              {team.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
            </select>
          </label>
        ) : null}
        {isAdmin ? (
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => setCreateOpen(true)}>
            Create Scorecard
          </button>
        ) : null}
      </div>

      {error ? <div className={styles.alert}>{error}</div> : null}
      {loading && !scorecards.length ? <p className={styles.muted}>Loading…</p> : null}

      {!loading && filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "3rem 1rem", color: "#6a737b" }}>
          <p style={{ fontSize: "1.1rem", fontWeight: 600 }}>No individual scorecards yet.</p>
          {isAdmin ? <p>Click "Create Scorecard" to get started.</p> : <p>Ask an admin to create one for you.</p>}
        </div>
      ) : null}

      <div className={styles.rockGrid}>
        {filtered.map((sc, idx) => (
          <div key={sc.id} className={styles.rockCard} style={{ cursor: "default", position: "relative" }}>
            <Link href={`/eos/scorecards/${sc.id}`} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.65rem", marginBottom: "0.75rem" }}>
                <div className={styles.avatar} style={{ background: AVATAR_COLORS[idx % AVATAR_COLORS.length] }}>
                  {initials(sc.ownerDisplayName)}
                </div>
                <div>
                  <div style={{ fontWeight: 700, color: "#1b2856", fontSize: "1rem" }}>{sc.name}</div>
                  <div className={styles.muted} style={{ fontSize: "0.82rem" }}>{sc.ownerDisplayName}</div>
                </div>
              </div>
              {sc.description ? <p className={styles.muted} style={{ margin: "0 0 0.5rem", fontSize: "0.85rem" }}>{sc.description}</p> : null}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem 1rem", fontSize: "0.82rem", color: "#6a737b" }}>
                <span>{sc.metricCount} metrics</span>
                <span>Updated {relTime(sc.lastEntryAt)}</span>
              </div>
            </Link>
            {isAdmin ? (
              <ScorecardMenu
                open={menuFor === sc.id}
                onToggle={() => setMenuFor((c) => (c === sc.id ? null : sc.id))}
                onClose={() => setMenuFor(null)}
                onEdit={() => { setEditSc(sc); setMenuFor(null); }}
                onDuplicate={() => { setDupSc(sc); setMenuFor(null); }}
                onArchive={async () => {
                  if (!confirm(`Archive "${sc.name}"?`)) return;
                  await fetch(apiUrl(`/eos/individual-scorecards/${sc.id}`), {
                    method: "DELETE", headers: { ...authHeaders() },
                  });
                  setMenuFor(null);
                  load();
                }}
              />
            ) : null}
          </div>
        ))}
      </div>

      {createOpen && isAdmin ? (
        <CreateScorecardModal team={team} templates={templates} authHeaders={authHeaders} onClose={() => setCreateOpen(false)} onCreated={load} />
      ) : null}

      {editSc && isAdmin ? (
        <EditScorecardModal scorecard={editSc} team={team} authHeaders={authHeaders} onClose={() => setEditSc(null)} onSaved={() => { setEditSc(null); load(); }} />
      ) : null}

      {dupSc && isAdmin ? (
        <DuplicateModal scorecard={dupSc} team={team} authHeaders={authHeaders} onClose={() => setDupSc(null)} onDone={() => { setDupSc(null); load(); }} />
      ) : null}
    </>
  );
}

/* ---- Scorecard Card Menu ---- */
function ScorecardMenu({ open, onToggle, onClose, onEdit, onDuplicate, onArchive }: {
  open: boolean; onToggle: () => void; onClose: () => void;
  onEdit: () => void; onDuplicate: () => void; onArchive: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) { if (!ref.current?.contains(e.target as Node)) onClose(); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, onClose]);

  return (
    <div className={styles.gearWrap} ref={ref} style={{ position: "absolute", top: "0.75rem", right: "0.75rem" }}>
      <button type="button" className={styles.gearBtn} onClick={(e) => { e.stopPropagation(); onToggle(); }}>⋮</button>
      {open ? (
        <div className={styles.gearMenu} role="menu">
          <button type="button" role="menuitem" onClick={onEdit}>Edit</button>
          <button type="button" role="menuitem" onClick={onDuplicate}>Duplicate</button>
          <button type="button" role="menuitem" className={styles.gearMenuDanger} onClick={onArchive}>Archive</button>
        </div>
      ) : null}
    </div>
  );
}

/* ---- Create Scorecard Modal ---- */
function CreateScorecardModal({ team, templates, authHeaders, onClose, onCreated }: {
  team: TeamUser[]; templates: Template[];
  authHeaders: () => Record<string, string>; onClose: () => void; onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ownerUserId, setOwnerUserId] = useState(String(team[0]?.id ?? ""));
  const [templateId, setTemplateId] = useState("blank");
  const [saving, setSaving] = useState(false);

  return (
    <div className={styles.modalOverlay} role="dialog" aria-modal>
      <div className={styles.modal} style={{ maxWidth: "34rem" }}>
        <h2>Create Individual Scorecard</h2>
        <div className={styles.formGrid}>
          <label>
            Name
            <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mike's Weekly Scorecard" />
          </label>
          <label>
            Owner
            <select className={styles.select} value={ownerUserId} onChange={(e) => setOwnerUserId(e.target.value)}>
              {team.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
            </select>
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            Description (optional)
            <textarea className={styles.textarea} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            Template
            <select className={styles.select} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          {templateId !== "blank" ? (
            <div style={{ gridColumn: "1 / -1", fontSize: "0.82rem", color: "#6a737b" }}>
              Pre-filled metrics: {templates.find((t) => t.id === templateId)?.metrics.join(", ")}
            </div>
          ) : null}
        </div>
        <div className={styles.modalActions}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving || !name.trim()} onClick={async () => {
            setSaving(true);
            try {
              const res = await fetch(apiUrl("/eos/individual-scorecards"), {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify({ name: name.trim(), description: description.trim() || null, ownerUserId: Number(ownerUserId), templateId: templateId !== "blank" ? templateId : undefined }),
              });
              const j = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(typeof j.error === "string" ? j.error : "Create failed");
              onClose();
              onCreated();
            } catch (e) {
              alert(e instanceof Error ? e.message : "Error");
            } finally { setSaving(false); }
          }}>
            {saving ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---- Edit Scorecard Modal ---- */
function EditScorecardModal({ scorecard, team, authHeaders, onClose, onSaved }: {
  scorecard: Scorecard; team: TeamUser[];
  authHeaders: () => Record<string, string>; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(scorecard.name);
  const [description, setDescription] = useState(scorecard.description ?? "");
  const [ownerUserId, setOwnerUserId] = useState(String(scorecard.ownerUserId));
  const [saving, setSaving] = useState(false);

  return (
    <div className={styles.modalOverlay} role="dialog" aria-modal>
      <div className={styles.modal}>
        <h2>Edit Scorecard</h2>
        <div className={styles.formGrid}>
          <label>Name <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>Owner
            <select className={styles.select} value={ownerUserId} onChange={(e) => setOwnerUserId(e.target.value)}>
              {team.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
            </select>
          </label>
          <label style={{ gridColumn: "1 / -1" }}>Description
            <textarea className={styles.textarea} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
        </div>
        <div className={styles.modalActions}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving} onClick={async () => {
            setSaving(true);
            try {
              const res = await fetch(apiUrl(`/eos/individual-scorecards/${scorecard.id}`), {
                method: "PUT", headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify({ name, description: description.trim() || null, ownerUserId: Number(ownerUserId) }),
              });
              if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || "Failed"); }
              onSaved();
            } catch (e) { alert(e instanceof Error ? e.message : "Error"); } finally { setSaving(false); }
          }}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---- Duplicate Modal ---- */
function DuplicateModal({ scorecard, team, authHeaders, onClose, onDone }: {
  scorecard: Scorecard; team: TeamUser[];
  authHeaders: () => Record<string, string>; onClose: () => void; onDone: () => void;
}) {
  const [newName, setNewName] = useState(`${scorecard.name} (copy)`);
  const [newOwner, setNewOwner] = useState(String(team[0]?.id ?? ""));
  const [saving, setSaving] = useState(false);

  return (
    <div className={styles.modalOverlay} role="dialog" aria-modal>
      <div className={styles.modal}>
        <h2>Duplicate Scorecard</h2>
        <p className={styles.muted}>Creates a copy of "{scorecard.name}" with the same metrics but no data.</p>
        <div className={styles.formGrid}>
          <label>New name <input className={styles.input} value={newName} onChange={(e) => setNewName(e.target.value)} /></label>
          <label>Assign to
            <select className={styles.select} value={newOwner} onChange={(e) => setNewOwner(e.target.value)}>
              {team.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
            </select>
          </label>
        </div>
        <div className={styles.modalActions}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving || !newName.trim()} onClick={async () => {
            setSaving(true);
            try {
              const res = await fetch(apiUrl(`/eos/individual-scorecards/${scorecard.id}/duplicate`), {
                method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify({ newName: newName.trim(), newOwnerUserId: Number(newOwner) }),
              });
              if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || "Failed"); }
              onDone();
            } catch (e) { alert(e instanceof Error ? e.message : "Error"); } finally { setSaving(false); }
          }}>
            {saving ? "Duplicating…" : "Duplicate"}
          </button>
        </div>
      </div>
    </div>
  );
}
