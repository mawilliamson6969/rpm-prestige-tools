"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../../context/AuthContext";
import {
  agentHubFetch,
  ACTIVITY_ICONS,
  ACTIVITY_TYPE_LABELS,
  formatMoney,
  formatPct,
  FLAG_ICONS,
  FLAG_LABELS,
  relativeTime,
  scoreColor,
  SEVERITY_META,
  STAGE_LABELS,
  STAGE_META,
  TIER_META,
  type Activity,
  type ActivityType,
  type Agent,
  type Direction,
  type EngagementScore,
  type HubPermissions,
  type LifetimeValue,
  type PersonalDetails,
  type PredictiveFlag,
  type Referral,
  type Relationship,
  type Stage,
  type Tag,
  type Tier,
} from "../../../../../lib/agentHub";
import AgentHubGate from "../../AgentHubGate";
import { Avatar, FieldGroup, StatusPill, TierBadge, Toast } from "../../components";
import styles from "../../agentHub.module.css";

type DetailPayload = {
  agent: Agent;
  tags: { id: number; tag: string; created_at: string }[];
  relationships: Relationship[];
  activities: Activity[];
};

const ACTIVITY_TYPES: ActivityType[] = [
  "note_added",
  "email_sent",
  "call_made",
  "text_sent",
  "meeting_in_person",
  "postcard_sent",
  "letter_sent",
  "gift_sent",
  "event_attended",
];

function DetailInner({ perms }: { perms: HubPermissions }) {
  const params = useParams();
  const router = useRouter();
  const id = Number(params?.id);
  const { authHeaders, token } = useAuth();
  const [data, setData] = useState<DetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [personal, setPersonal] = useState<PersonalDetails | null>(null);
  const [personalErr, setPersonalErr] = useState<string | null>(null);
  const [editingPersonal, setEditingPersonal] = useState(false);
  const [composer, setComposer] = useState({
    type: "note_added" as ActivityType,
    direction: "internal" as Direction,
    subject: "",
    summary: "",
    body: "",
  });
  const [composerBusy, setComposerBusy] = useState(false);
  const [toast, setToast] = useState<{ msg: string; variant: "ok" | "error" } | null>(null);
  const [filter, setFilter] = useState<"all" | "email" | "call" | "text" | "mail" | "note" | "meeting">("all");
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Agent>>({});
  const [newTag, setNewTag] = useState("");
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [ltv, setLtv] = useState<LifetimeValue | null>(null);
  const [refreshingLtv, setRefreshingLtv] = useState(false);
  const [engagementScore, setEngagementScore] = useState<EngagementScore | null>(null);
  const [scoreHistory, setScoreHistory] = useState<{ calculation_date: string; score: number }[]>([]);
  const [activeFlags, setActiveFlags] = useState<PredictiveFlag[]>([]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  async function load() {
    try {
      const body = await agentHubFetch<DetailPayload>(`/agent-hub/agents/${id}`, { authHeaders: authHeaders() });
      setData(body);
      setEditForm({
        full_name: body.agent.full_name,
        preferred_name: body.agent.preferred_name,
        email: body.agent.email,
        phone_mobile: body.agent.phone_mobile,
        phone_office: body.agent.phone_office,
        notes: body.agent.notes,
        title: body.agent.title,
        team_name: body.agent.team_name,
      });
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load agent.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!token || !id) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id]);

  // Phase 2 + 4: load referrals + LTV + engagement score + flags.
  useEffect(() => {
    if (!token || !id) return;
    (async () => {
      try {
        const [refs, ltvBody, score, flags] = await Promise.all([
          agentHubFetch<{ referrals: Referral[] }>(
            `/agent-hub/referrals?agent_id=${id}&per_page=50`,
            { authHeaders: authHeaders() }
          ),
          agentHubFetch<{ ltv: LifetimeValue }>(
            `/agent-hub/agents/${id}/lifetime-value`,
            { authHeaders: authHeaders() }
          ),
          agentHubFetch<{ score: EngagementScore | null; history: { calculation_date: string; score: number }[] }>(
            `/agent-hub/intelligence/scores/${id}`,
            { authHeaders: authHeaders() }
          ).catch(() => ({ score: null, history: [] })),
          agentHubFetch<{ flags: PredictiveFlag[] }>(
            `/agent-hub/intelligence/flags?agent_id=${id}`,
            { authHeaders: authHeaders() }
          ).catch(() => ({ flags: [] })),
        ]);
        setReferrals(refs.referrals);
        setLtv(ltvBody.ltv);
        setEngagementScore(score.score);
        setScoreHistory(score.history);
        setActiveFlags(flags.flags);
      } catch {
        // Non-fatal — progressive enhancement.
      }
    })();
  }, [token, id, authHeaders]);

  async function refreshLtv() {
    setRefreshingLtv(true);
    try {
      await agentHubFetch("/agent-hub/lifetime-value/refresh", {
        method: "POST",
        authHeaders: authHeaders(),
      });
      const ltvBody = await agentHubFetch<{ ltv: LifetimeValue }>(
        `/agent-hub/agents/${id}/lifetime-value`,
        { authHeaders: authHeaders() }
      );
      setLtv(ltvBody.ltv);
      setToast({ msg: "LTV refreshed.", variant: "ok" });
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Refresh failed.", variant: "error" });
    } finally {
      setRefreshingLtv(false);
    }
  }

  // Personal details (separate, gated)
  useEffect(() => {
    if (!token || !id || !perms.can_view_personal_details) return;
    (async () => {
      try {
        const body = await agentHubFetch<{ personal: PersonalDetails }>(`/agent-hub/agents/${id}/personal`, { authHeaders: authHeaders() });
        setPersonal(body.personal);
      } catch (e) {
        setPersonalErr(e instanceof Error ? e.message : "Could not load personal details.");
      }
    })();
  }, [token, id, authHeaders, perms.can_view_personal_details]);

  async function logActivity(e: React.FormEvent) {
    e.preventDefault();
    if (!composer.subject.trim() && !composer.summary.trim() && !composer.body.trim()) {
      setToast({ msg: "Add a subject, summary, or body.", variant: "error" });
      return;
    }
    setComposerBusy(true);
    try {
      await agentHubFetch(`/agent-hub/agents/${id}/activities`, {
        method: "POST",
        authHeaders: authHeaders(),
        body: JSON.stringify({
          type: composer.type,
          direction: composer.direction,
          subject: composer.subject.trim() || undefined,
          summary: composer.summary.trim() || undefined,
          body: composer.body.trim() || undefined,
        }),
      });
      setComposer({ type: composer.type, direction: composer.direction, subject: "", summary: "", body: "" });
      setToast({ msg: "Logged.", variant: "ok" });
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Could not log activity.", variant: "error" });
    } finally {
      setComposerBusy(false);
    }
  }

  async function saveEdit() {
    setComposerBusy(true);
    try {
      const body = await agentHubFetch<{ agent: Agent }>(`/agent-hub/agents/${id}`, {
        method: "PATCH",
        authHeaders: authHeaders(),
        body: JSON.stringify(editForm),
      });
      setData((d) => (d ? { ...d, agent: body.agent } : d));
      setEditing(false);
      setToast({ msg: "Saved.", variant: "ok" });
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Save failed.", variant: "error" });
    } finally {
      setComposerBusy(false);
    }
  }

  async function changeTier(tier: Tier) {
    if (!perms.can_change_tier) {
      setToast({ msg: "No permission to change tier.", variant: "error" });
      return;
    }
    try {
      const body = await agentHubFetch<{ agent: Agent }>(`/agent-hub/agents/${id}`, {
        method: "PATCH",
        authHeaders: authHeaders(),
        body: JSON.stringify({ tier }),
      });
      setData((d) => (d ? { ...d, agent: body.agent } : d));
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Could not change tier.", variant: "error" });
    }
  }

  async function markDnc() {
    if (!perms.can_mark_dnc) {
      setToast({ msg: "No permission to mark DNC.", variant: "error" });
      return;
    }
    if (!confirm("Mark this agent as Do Not Contact? They will be excluded from all future outreach.")) return;
    try {
      const body = await agentHubFetch<{ agent: Agent }>(`/agent-hub/agents/${id}`, {
        method: "PATCH",
        authHeaders: authHeaders(),
        body: JSON.stringify({ do_not_contact: true }),
      });
      setData((d) => (d ? { ...d, agent: body.agent } : d));
      setToast({ msg: "Marked DNC.", variant: "ok" });
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Could not mark DNC.", variant: "error" });
    }
  }

  async function softDelete() {
    if (perms.role !== "owner" && perms.role !== "manager") {
      setToast({ msg: "No permission to delete.", variant: "error" });
      return;
    }
    if (!confirm("Soft-delete this agent? Their referral history will be preserved.")) return;
    try {
      await agentHubFetch(`/agent-hub/agents/${id}`, { method: "DELETE", authHeaders: authHeaders() });
      router.push("/agent-hub/agents");
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Could not delete.", variant: "error" });
    }
  }

  async function addTag() {
    const t = newTag.trim();
    if (!t) return;
    try {
      await agentHubFetch(`/agent-hub/agents/${id}/tags`, {
        method: "POST",
        authHeaders: authHeaders(),
        body: JSON.stringify({ tag: t }),
      });
      setNewTag("");
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Could not add tag.", variant: "error" });
    }
  }

  async function removeTag(tag: string) {
    try {
      await agentHubFetch(`/agent-hub/agents/${id}/tags/${encodeURIComponent(tag)}`, {
        method: "DELETE",
        authHeaders: authHeaders(),
      });
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Could not remove tag.", variant: "error" });
    }
  }

  async function savePersonal(p: Partial<PersonalDetails>) {
    try {
      const body = await agentHubFetch<{ personal: PersonalDetails }>(`/agent-hub/agents/${id}/personal`, {
        method: "PUT",
        authHeaders: authHeaders(),
        body: JSON.stringify(p),
      });
      setPersonal(body.personal);
      setEditingPersonal(false);
      setToast({ msg: "Saved personal details.", variant: "ok" });
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Could not save personal details.", variant: "error" });
    }
  }

  if (loading) return <div className={styles.shell}><div className={styles.muted}>Loading…</div></div>;
  if (err) return <div className={styles.shell}><div className={styles.error}>{err}</div></div>;
  if (!data) return <div className={styles.shell}><div className={styles.muted}>Not found.</div></div>;

  const a = data.agent;
  const filteredActivities = data.activities.filter((act) => {
    if (filter === "all") return true;
    if (filter === "email") return act.type.startsWith("email");
    if (filter === "call") return act.type.startsWith("call");
    if (filter === "text") return act.type.startsWith("text");
    if (filter === "mail") return act.type === "postcard_sent" || act.type === "letter_sent";
    if (filter === "note") return act.type === "note_added";
    if (filter === "meeting") return act.type === "meeting_in_person" || act.type === "event_attended";
    return true;
  });

  return (
    <div className={styles.shell}>
      <Link href="/agent-hub/agents" className={styles.muted} style={{ fontSize: "0.85rem", marginBottom: "0.5rem", display: "inline-block" }}>
        ← Agents
      </Link>

      <div className={styles.headerStrip}>
        <Avatar agent={a} size={64} />
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
            <h1 className={styles.pageTitle} style={{ fontSize: "1.3rem" }}>{a.full_name}</h1>
            {a.preferred_name ? <span className={styles.muted}>"{a.preferred_name}"</span> : null}
            {a.pronouns ? <span className={styles.muted}>· {a.pronouns}</span> : null}
            <TierBadge tier={a.tier} />
            <StatusPill status={a.status} />
            {a.do_not_contact ? <StatusPill status="dnc" /> : null}
          </div>
          <div className={styles.muted} style={{ marginTop: "0.25rem" }}>
            {a.brokerage_name ? (
              a.brokerage_id ? (
                <Link href={`/agent-hub/brokerages/${a.brokerage_id}`} className={styles.linkCell}>
                  {a.brokerage_name}
                </Link>
              ) : (
                a.brokerage_name
              )
            ) : "—"}
            {a.title ? ` · ${a.title}` : ""}
            {a.team_name ? ` · ${a.team_name}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
          {!a.do_not_contact && a.status !== "deleted" ? (
            <Link
              href={`/agent-hub/referrals/new?agent_id=${a.id}`}
              className={`${styles.btn} ${styles.btnPrimary}`}
            >
              + Referral
            </Link>
          ) : null}
          {perms.can_change_tier ? (
            <select
              className={styles.select}
              style={{ width: "auto" }}
              value={a.tier}
              onChange={(e) => changeTier(e.target.value as Tier)}
            >
              {(["cold","prospect","warm","partner","vip","dormant"] as Tier[]).map((t) => (
                <option key={t} value={t}>{t.toUpperCase()}</option>
              ))}
            </select>
          ) : null}
          <button className={styles.btn} onClick={() => setEditing((v) => !v)}>
            {editing ? "Cancel" : "✎ Edit"}
          </button>
          {perms.can_mark_dnc && !a.do_not_contact ? (
            <button className={`${styles.btn} ${styles.btnDanger}`} onClick={markDnc}>Mark DNC</button>
          ) : null}
          {(perms.role === "owner" || perms.role === "manager") ? (
            <button className={`${styles.btn} ${styles.btnDanger}`} onClick={softDelete}>Delete</button>
          ) : null}
        </div>
      </div>

      <div className={styles.threeCol}>
        {/* LEFT */}
        <div className={styles.flexCol}>
          <div className={styles.card}>
            <div className={styles.cardTitle}>Identity</div>
            <div className={styles.flexCol} style={{ gap: "0.4rem", fontSize: "0.85rem" }}>
              <Row label="License" value={a.license_number ? `${a.license_number} (${a.license_state})` : null} />
              <Row label="Status" value={a.license_status} />
              <Row label="Expires" value={a.license_expiration} />
              <Row label="MLS ID" value={a.mls_id} />
              <Row label="Years licensed" value={a.years_licensed} />
              <Row label="Niche" value={a.niche} />
              <Row label="Target zips" value={a.target_zips.join(", ") || null} />
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.cardTitle}>Contact</div>
            <div className={styles.flexCol} style={{ gap: "0.4rem", fontSize: "0.85rem" }}>
              <Row label="Email" value={a.email ? <a href={`mailto:${a.email}`}>{a.email}</a> : null} />
              <Row label="Mobile" value={a.phone_mobile ? <a href={`tel:${a.phone_mobile}`}>{a.phone_mobile}</a> : null} />
              <Row label="Office" value={a.phone_office ? <a href={`tel:${a.phone_office}`}>{a.phone_office}</a> : null} />
              <Row label="Mailing" value={[a.mailing_address_1, a.city, a.state, a.zip].filter(Boolean).join(", ") || null} />
              <Row label="Preferred channel" value={a.preferred_channel} />
              <Row label="Preferred time" value={a.preferred_contact_time} />
              <Row label="Email consent" value={a.consent_to_email ? `✓ ${a.consent_to_email_at?.slice(0, 10) || ""}` : "—"} />
              <Row label="SMS consent" value={a.consent_to_sms ? `✓ ${a.consent_to_sms_at?.slice(0, 10) || ""}` : "—"} />
            </div>
          </div>

          {(a.linkedin_url || a.facebook_url || a.instagram_handle || a.personal_website || a.har_profile_url) ? (
            <div className={styles.card}>
              <div className={styles.cardTitle}>Online</div>
              <div className={styles.flexCol} style={{ fontSize: "0.85rem", gap: "0.3rem" }}>
                {a.linkedin_url ? <a href={a.linkedin_url} target="_blank" rel="noreferrer">LinkedIn ↗</a> : null}
                {a.facebook_url ? <a href={a.facebook_url} target="_blank" rel="noreferrer">Facebook ↗</a> : null}
                {a.instagram_handle ? <span>Instagram: @{a.instagram_handle}</span> : null}
                {a.personal_website ? <a href={a.personal_website} target="_blank" rel="noreferrer">Website ↗</a> : null}
                {a.har_profile_url ? <a href={a.har_profile_url} target="_blank" rel="noreferrer">HAR profile ↗</a> : null}
              </div>
            </div>
          ) : null}

          {perms.can_view_personal_details ? (
            <div className={styles.card}>
              <div className={styles.cardTitle}>
                Personal
                <button className={styles.btnGhost} style={{ fontSize: "0.8rem" }} onClick={() => setEditingPersonal((v) => !v)}>
                  {editingPersonal ? "Close" : personal && (personal.birthday_month || personal.spouse_name) ? "Edit" : "+ Add"}
                </button>
              </div>
              {personalErr ? (
                <div className={styles.muted}>{personalErr}</div>
              ) : !personal ? (
                <div className={styles.muted} style={{ fontSize: "0.85rem" }}>Loading personal details…</div>
              ) : !editingPersonal ? (
                <div className={styles.flexCol} style={{ gap: "0.3rem", fontSize: "0.85rem" }}>
                  <Row label="Birthday" value={personal.birthday_month && personal.birthday_day ? `${personal.birthday_month}/${personal.birthday_day}` : null} />
                  <Row label="Spouse" value={personal.spouse_name} />
                  <Row label="Anniversary" value={personal.anniversary_date} />
                  <Row label="Hometown" value={personal.hometown} />
                  <Row label="Hobbies" value={personal.hobbies} />
                  <Row label="Gift prefs" value={personal.gift_preferences} />
                  <Row label="Children" value={personal.children.length ? `${personal.children.length} on file` : null} />
                </div>
              ) : (
                <PersonalForm initial={personal} onSave={savePersonal} onCancel={() => setEditingPersonal(false)} />
              )}
            </div>
          ) : (
            <div className={styles.card}>
              <div className={styles.cardTitle}>Personal</div>
              <div className={styles.placeholderBox}>
                Personal details (birthday, spouse, gift prefs, etc.) are visible only to users with personal-details access.
              </div>
            </div>
          )}

          <div className={styles.card}>
            <div className={styles.cardTitle}>Tags</div>
            <div>
              {data.tags.map((t) => (
                <span key={t.id} className={styles.tagChip}>
                  {t.tag}
                  <button onClick={() => removeTag(t.tag)} title="Remove">×</button>
                </span>
              ))}
            </div>
            <form onSubmit={(e) => { e.preventDefault(); addTag(); }} style={{ marginTop: "0.5rem", display: "flex", gap: "0.3rem" }}>
              <input
                className={styles.input}
                placeholder="Add tag…"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
              />
              <button type="submit" className={styles.btn}>+</button>
            </form>
          </div>
        </div>

        {/* CENTER */}
        <div className={styles.flexCol}>
          {editing ? (
            <div className={styles.card}>
              <div className={styles.cardTitle}>Edit agent</div>
              <div className={styles.gridTwo}>
                <FieldGroup label="Full name">
                  <input className={styles.input} value={editForm.full_name || ""} onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })} />
                </FieldGroup>
                <FieldGroup label="Preferred name">
                  <input className={styles.input} value={editForm.preferred_name || ""} onChange={(e) => setEditForm({ ...editForm, preferred_name: e.target.value })} />
                </FieldGroup>
                <FieldGroup label="Email">
                  <input className={styles.input} value={editForm.email || ""} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
                </FieldGroup>
                <FieldGroup label="Mobile">
                  <input className={styles.input} value={editForm.phone_mobile || ""} onChange={(e) => setEditForm({ ...editForm, phone_mobile: e.target.value })} />
                </FieldGroup>
                <FieldGroup label="Office phone">
                  <input className={styles.input} value={editForm.phone_office || ""} onChange={(e) => setEditForm({ ...editForm, phone_office: e.target.value })} />
                </FieldGroup>
                <FieldGroup label="Title">
                  <input className={styles.input} value={editForm.title || ""} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} />
                </FieldGroup>
              </div>
              <FieldGroup label="Notes">
                <textarea
                  className={styles.textarea}
                  rows={4}
                  value={editForm.notes || ""}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                />
              </FieldGroup>
              <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                <button className={styles.btn} onClick={() => setEditing(false)}>Cancel</button>
                <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={saveEdit} disabled={composerBusy}>
                  {composerBusy ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          ) : null}

          <form className={styles.composer} onSubmit={logActivity}>
            <div className={styles.composerTypes}>
              {ACTIVITY_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`${styles.composerTypeBtn} ${composer.type === t ? styles.active : ""}`}
                  onClick={() => setComposer({ ...composer, type: t })}
                >
                  <span aria-hidden>{ACTIVITY_ICONS[t]}</span>
                  {ACTIVITY_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
            <div className={styles.row} style={{ marginBottom: "0.5rem" }}>
              <select
                className={styles.select}
                style={{ width: "auto" }}
                value={composer.direction}
                onChange={(e) => setComposer({ ...composer, direction: e.target.value as Direction })}
              >
                <option value="outbound">Outbound (we did)</option>
                <option value="inbound">Inbound (they did)</option>
                <option value="internal">Internal note</option>
              </select>
              <input
                className={styles.input}
                placeholder="Subject (optional)"
                value={composer.subject}
                onChange={(e) => setComposer({ ...composer, subject: e.target.value })}
              />
            </div>
            <textarea
              className={styles.textarea}
              placeholder="Summary or full body..."
              value={composer.body}
              onChange={(e) => setComposer({ ...composer, body: e.target.value })}
            />
            <div style={{ marginTop: "0.5rem", display: "flex", justifyContent: "flex-end" }}>
              <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={composerBusy}>
                {composerBusy ? "Logging…" : "Log interaction"}
              </button>
            </div>
          </form>

          <div className={styles.row} style={{ gap: "0.3rem", flexWrap: "wrap" }}>
            {(["all","note","email","call","text","meeting","mail"] as const).map((f) => (
              <button
                key={f}
                className={`${styles.composerTypeBtn} ${filter === f ? styles.active : ""}`}
                onClick={() => setFilter(f)}
                type="button"
              >
                {f}
              </button>
            ))}
          </div>

          {filteredActivities.length === 0 ? (
            <div className={styles.empty}>No activity in this view.</div>
          ) : (
            filteredActivities.map((act) => (
              <div key={act.id} className={styles.timelineEntry}>
                <div className={styles.timelineHeader}>
                  <span>
                    <span aria-hidden>{ACTIVITY_ICONS[act.type]}</span>{" "}
                    <strong>{ACTIVITY_TYPE_LABELS[act.type]}</strong>
                    {act.direction !== "internal" ? ` · ${act.direction}` : ""}
                  </span>
                  <span className={styles.muted}>{relativeTime(act.occurred_at)}</span>
                </div>
                {act.subject ? <div style={{ fontWeight: 500, marginBottom: "0.3rem" }}>{act.subject}</div> : null}
                {act.summary ? <div style={{ marginBottom: "0.3rem" }}>{act.summary}</div> : null}
                {act.body ? <div className={styles.timelineBody}>{act.body}</div> : null}
                {act.attachments.length > 0 ? (
                  <div style={{ marginTop: "0.4rem", fontSize: "0.8rem" }}>
                    {act.attachments.map((att) => (
                      <a key={att.id} href={att.file_url} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginRight: "0.5rem" }}>
                        📎 {att.filename}
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>

        {/* RIGHT */}
        <div className={styles.flexCol}>
          {/* Phase 4: engagement intelligence */}
          {engagementScore ? (
            <div className={styles.card}>
              <div className={styles.cardTitle}>
                Engagement Score
                {engagementScore.tier_recommendation_changed ? (
                  <span style={{ padding: "0.05rem 0.35rem", borderRadius: 4, background: "#fef3c7", color: "#854d0e", fontSize: "0.65rem", fontWeight: 600, textTransform: "uppercase" }}>
                    Tier rec differs
                  </span>
                ) : null}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                <div style={{
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  background: scoreColor(engagementScore.score),
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "1.4rem",
                  fontWeight: 700,
                }}>
                  {engagementScore.score}
                </div>
                <div style={{ flex: 1, fontSize: "0.85rem" }}>
                  <div>
                    Recommended tier:{" "}
                    {engagementScore.tier_recommendation ? (
                      <strong>{engagementScore.tier_recommendation}</strong>
                    ) : "—"}
                  </div>
                  <div className={styles.muted} style={{ fontSize: "0.75rem" }}>
                    Calculated {relativeTime(engagementScore.calculated_at)}
                  </div>
                </div>
              </div>
              {scoreHistory.length > 1 ? (
                <div style={{ marginTop: "0.6rem" }}>
                  <svg viewBox="0 0 100 30" style={{ width: "100%", height: 30 }}>
                    {(() => {
                      const max = 100;
                      const points = scoreHistory.map((h, i) => {
                        const x = (i / Math.max(1, scoreHistory.length - 1)) * 100;
                        const y = 30 - (h.score / max) * 30;
                        return `${x},${y}`;
                      }).join(" ");
                      return <polyline fill="none" stroke={scoreColor(engagementScore.score)} strokeWidth={1.5} points={points} />;
                    })()}
                  </svg>
                  <div className={styles.muted} style={{ fontSize: "0.7rem", textAlign: "center" }}>
                    {scoreHistory.length}-day trend
                  </div>
                </div>
              ) : null}
              <details style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
                <summary style={{ cursor: "pointer", color: "#1b2856" }}>Why this score?</summary>
                <ul style={{ paddingLeft: "1.2rem", marginTop: "0.3rem", fontSize: "0.78rem" }}>
                  {engagementScore.explanation.map((line, i) => <li key={i}>{line}</li>)}
                </ul>
                <div className={styles.muted} style={{ fontSize: "0.72rem", marginTop: "0.3rem" }}>
                  Recency {engagementScore.components.recency}/25 ·
                  Frequency {engagementScore.components.frequency}/20 ·
                  Two-way {engagementScore.components.two_way}/15 ·
                  Referrals {engagementScore.components.referrals}/25 ·
                  Financial {engagementScore.components.financials}/15
                </div>
              </details>
            </div>
          ) : null}

          {activeFlags.length > 0 ? (
            <div className={styles.card}>
              <div className={styles.cardTitle}>Active Flags</div>
              {activeFlags.map((f) => {
                const sev = SEVERITY_META[f.severity];
                return (
                  <div key={f.id} style={{ padding: "0.4rem 0", borderBottom: "1px solid #f3f4f6", fontSize: "0.85rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                      <span>{FLAG_ICONS[f.flag_type]}</span>
                      <strong>{FLAG_LABELS[f.flag_type]}</strong>
                      <span style={{ marginLeft: "auto", padding: "0.05rem 0.35rem", borderRadius: 4, background: sev.bg, color: sev.fg, fontSize: "0.65rem", fontWeight: 600 }}>
                        {sev.label}
                      </span>
                    </div>
                    <div className={styles.muted} style={{ fontSize: "0.78rem", marginTop: "0.2rem" }}>
                      {f.reasoning}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className={styles.card}>
            <div className={styles.cardTitle}>
              Active Pipeline
              {!a.do_not_contact && a.status !== "deleted" ? (
                <Link
                  href={`/agent-hub/referrals/new?agent_id=${a.id}`}
                  className={styles.btnGhost}
                  style={{ fontSize: "0.78rem" }}
                >
                  + Add
                </Link>
              ) : null}
            </div>
            {(() => {
              const active = referrals.filter((r) => r.stage !== "lost" && r.stage !== "declined" && r.stage !== "active_management");
              const completed = referrals.filter((r) => r.stage === "active_management");
              if (active.length === 0 && completed.length === 0) {
                return <div className={styles.muted} style={{ fontSize: "0.85rem" }}>No referrals yet.</div>;
              }
              return (
                <>
                  {active.length === 0 ? (
                    <div className={styles.muted} style={{ fontSize: "0.85rem" }}>No active referrals.</div>
                  ) : (
                    active.map((r) => (
                      <Link
                        key={r.id}
                        href={`/agent-hub/pipeline/${r.id}`}
                        style={{ display: "block", padding: "0.4rem 0", borderBottom: "1px solid #f3f4f6", textDecoration: "none", color: "inherit" }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.85rem" }}>
                          <span style={{ fontWeight: 500 }}>{r.owner_name}</span>
                          <span style={{ padding: "0.05rem 0.35rem", borderRadius: 9999, background: STAGE_META[r.stage as Stage].bg, color: STAGE_META[r.stage as Stage].fg, fontSize: "0.65rem", fontWeight: 600 }}>
                            {STAGE_LABELS[r.stage as Stage]}
                          </span>
                        </div>
                        {r.property_address ? (
                          <div className={styles.muted} style={{ fontSize: "0.75rem" }}>
                            {r.property_address}
                          </div>
                        ) : null}
                      </Link>
                    ))
                  )}
                  {completed.length > 0 ? (
                    <details style={{ marginTop: "0.5rem" }}>
                      <summary className={styles.muted} style={{ cursor: "pointer", fontSize: "0.85rem" }}>
                        {completed.length} converted
                      </summary>
                      {completed.map((r) => (
                        <Link
                          key={r.id}
                          href={`/agent-hub/pipeline/${r.id}`}
                          style={{ display: "block", padding: "0.3rem 0", textDecoration: "none", color: "inherit" }}
                        >
                          <div style={{ fontSize: "0.85rem" }}>
                            {r.owner_name} {r.property_address ? `· ${r.property_address}` : ""}
                          </div>
                        </Link>
                      ))}
                    </details>
                  ) : null}
                </>
              );
            })()}
          </div>

          <div className={styles.card}>
            <div className={styles.cardTitle}>
              Lifetime Value
              {(perms.role === "owner" || perms.role === "manager") ? (
                <button
                  className={styles.btnGhost}
                  style={{ fontSize: "0.78rem" }}
                  onClick={refreshLtv}
                  disabled={refreshingLtv}
                  title="Recompute lifetime value now"
                >
                  {refreshingLtv ? "Refreshing…" : "Refresh"}
                </button>
              ) : null}
            </div>
            {ltv ? (
              <div className={styles.flexCol} style={{ gap: "0.3rem", fontSize: "0.85rem" }}>
                <Row label="Referrals" value={`${ltv.total_referrals_received} (${ltv.total_referrals_in_pipeline} active)`} />
                <Row label="Converted" value={`${ltv.total_referrals_converted} of ${ltv.total_referrals_received}`} />
                <Row label="Conversion rate" value={formatPct(ltv.conversion_rate_pct)} />
                <Row label="Fees paid" value={formatMoney(ltv.total_referral_fees_paid)} />
                <Row label="Revenue generated" value={formatMoney(ltv.total_revenue_generated)} />
                <Row
                  label="Net relationship"
                  value={
                    <span style={{ color: ltv.lifetime_relationship_value >= 0 ? "#15803d" : "#b91c1c", fontWeight: 600 }}>
                      {formatMoney(ltv.lifetime_relationship_value)}
                    </span>
                  }
                />
                {ltv.avg_days_to_convert != null ? (
                  <Row label="Avg days to convert" value={`${Math.round(ltv.avg_days_to_convert)}d`} />
                ) : null}
                {ltv.last_calculated_at ? (
                  <div className={styles.muted} style={{ fontSize: "0.72rem", marginTop: "0.4rem" }}>
                    Calculated {relativeTime(ltv.last_calculated_at)}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className={styles.muted} style={{ fontSize: "0.85rem" }}>No data yet.</div>
            )}
          </div>

          <div className={styles.card}>
            <div className={styles.cardTitle}>Connected agents</div>
            {data.relationships.length === 0 ? (
              <div className={styles.muted} style={{ fontSize: "0.85rem" }}>None linked.</div>
            ) : (
              data.relationships.map((r) => {
                const isA = r.agent_a_id === a.id;
                const otherId = isA ? r.agent_b_id : r.agent_a_id;
                const otherName = isA ? r.agent_b_name : r.agent_a_name;
                const label = isA ? r.relationship_type : invertRelationship(r.relationship_type);
                return (
                  <Link key={r.id} href={`/agent-hub/agents/${otherId}`} className={styles.row} style={{ padding: "0.3rem 0", textDecoration: "none", color: "inherit" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500 }}>{otherName}</div>
                      <div className={styles.muted} style={{ fontSize: "0.78rem" }}>{label}</div>
                    </div>
                  </Link>
                );
              })
            )}
          </div>

          <div className={styles.card}>
            <div className={styles.cardTitle}>Notes</div>
            <div className={styles.muted} style={{ fontSize: "0.85rem", whiteSpace: "pre-wrap" }}>
              {a.notes || "—"}
            </div>
          </div>
        </div>
      </div>

      {toast ? <Toast message={toast.msg} variant={toast.variant} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: "0.5rem" }}>
      <span style={{ minWidth: 110, color: "#6a737b", fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
      <span style={{ flex: 1, color: "#1f2937" }}>{value || <span style={{ color: "#9ca3af" }}>—</span>}</span>
    </div>
  );
}

function invertRelationship(t: string): string {
  if (t === "mentor") return "mentee of";
  if (t === "mentee") return "mentor to";
  return t;
}

function PersonalForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: PersonalDetails;
  onSave: (p: Partial<PersonalDetails>) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState(initial);
  return (
    <div className={styles.flexCol} style={{ gap: "0.4rem" }}>
      <div className={styles.gridTwo}>
        <FieldGroup label="Birthday month">
          <input
            className={styles.input}
            type="number"
            min={1}
            max={12}
            value={f.birthday_month ?? ""}
            onChange={(e) => setF({ ...f, birthday_month: e.target.value ? Number(e.target.value) : null })}
          />
        </FieldGroup>
        <FieldGroup label="Birthday day">
          <input
            className={styles.input}
            type="number"
            min={1}
            max={31}
            value={f.birthday_day ?? ""}
            onChange={(e) => setF({ ...f, birthday_day: e.target.value ? Number(e.target.value) : null })}
          />
        </FieldGroup>
      </div>
      <FieldGroup label="Spouse name">
        <input
          className={styles.input}
          value={f.spouse_name ?? ""}
          onChange={(e) => setF({ ...f, spouse_name: e.target.value })}
        />
      </FieldGroup>
      <FieldGroup label="Anniversary">
        <input
          className={styles.input}
          type="date"
          value={f.anniversary_date ?? ""}
          onChange={(e) => setF({ ...f, anniversary_date: e.target.value || null })}
        />
      </FieldGroup>
      <FieldGroup label="Hometown">
        <input
          className={styles.input}
          value={f.hometown ?? ""}
          onChange={(e) => setF({ ...f, hometown: e.target.value })}
        />
      </FieldGroup>
      <FieldGroup label="Hobbies">
        <textarea
          className={styles.textarea}
          rows={2}
          value={f.hobbies ?? ""}
          onChange={(e) => setF({ ...f, hobbies: e.target.value })}
        />
      </FieldGroup>
      <FieldGroup label="Gift preferences">
        <textarea
          className={styles.textarea}
          rows={2}
          value={f.gift_preferences ?? ""}
          onChange={(e) => setF({ ...f, gift_preferences: e.target.value })}
        />
      </FieldGroup>
      <FieldGroup label="Personal notes">
        <textarea
          className={styles.textarea}
          rows={3}
          value={f.personal_notes ?? ""}
          onChange={(e) => setF({ ...f, personal_notes: e.target.value })}
        />
      </FieldGroup>
      <div style={{ display: "flex", gap: "0.4rem", justifyContent: "flex-end" }}>
        <button className={styles.btn} onClick={onCancel} type="button">Cancel</button>
        <button
          className={`${styles.btn} ${styles.btnPrimary}`}
          type="button"
          onClick={() => onSave({
            birthday_month: f.birthday_month,
            birthday_day: f.birthday_day,
            spouse_name: f.spouse_name,
            anniversary_date: f.anniversary_date,
            hometown: f.hometown,
            hobbies: f.hobbies,
            gift_preferences: f.gift_preferences,
            personal_notes: f.personal_notes,
          })}
        >
          Save
        </button>
      </div>
    </div>
  );
}

export default function AgentHubAgentDetailPage() {
  return <AgentHubGate>{(perms) => <DetailInner perms={perms} />}</AgentHubGate>;
}
