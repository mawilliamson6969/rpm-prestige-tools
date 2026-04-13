"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiUrl } from "../../../../lib/api";
import styles from "./marketing-calendar.module.css";

export type Channel = {
  id: number;
  name: string;
  slug: string;
  icon: string;
  color: string;
  isActive?: boolean;
};

export type Campaign = {
  id: number;
  name: string;
  description?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  status?: string;
  color?: string | null;
  contentCount?: number;
};

export type TeamUser = {
  id: number;
  displayName: string;
  username: string;
};

export type ContentItem = {
  id: number;
  title: string;
  description: string | null;
  contentBody: string | null;
  channelId: number | null;
  status: string;
  scheduledDate: string | null;
  scheduledTime: string | null;
  dueDate: string | null;
  assignedTo: number | null;
  assignedToName?: string | null;
  contentType: string;
  tags: string[];
  recurring: string | null;
  recurringEndDate: string | null;
  notes: string | null;
  channel?: { id: number; name: string; slug: string; icon: string; color: string } | null;
  campaigns: { id: number; name: string; color?: string }[];
};

const CONTENT_TYPES = [
  "post",
  "article",
  "email",
  "video",
  "story",
  "ad",
  "flyer",
  "event",
  "guide",
  "other",
] as const;

const STATUSES = ["idea", "draft", "review", "scheduled", "published", "archived"] as const;

const RECUR = [
  { v: "", label: "None" },
  { v: "daily", label: "Daily" },
  { v: "weekly", label: "Weekly" },
  { v: "biweekly", label: "Biweekly" },
  { v: "monthly", label: "Monthly" },
] as const;

const CHANNEL_LIMITS: Record<string, number> = {
  gbp: 1500,
  facebook: 500,
  instagram: 2200,
  linkedin: 3000,
  sms: 160,
};

function charLimit(slug: string | undefined) {
  if (!slug) return 8000;
  return CHANNEL_LIMITS[slug] ?? 8000;
}

function toYmd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type Props = {
  open: boolean;
  onClose: () => void;
  contentId: number | null;
  defaultDate: string | null;
  channels: Channel[];
  campaigns: Campaign[];
  teamUsers: TeamUser[];
  authHeaders: () => Record<string, string>;
  onSaved: () => void;
};

export default function ContentEditorModal({
  open,
  onClose,
  contentId,
  defaultDate,
  channels,
  campaigns,
  teamUsers,
  authHeaders,
  onSaved,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [contentBody, setContentBody] = useState("");
  const [channelId, setChannelId] = useState<number | "">("");
  const [status, setStatus] = useState<string>("idea");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [assignedTo, setAssignedTo] = useState<number | "">("");
  const [contentType, setContentType] = useState("post");
  const [tagsRaw, setTagsRaw] = useState("");
  const [notes, setNotes] = useState("");
  const [recurring, setRecurring] = useState("");
  const [recurringEndDate, setRecurringEndDate] = useState("");
  const [campaignIds, setCampaignIds] = useState<number[]>([]);
  const [bodyTab, setBodyTab] = useState<"write" | "preview">("write");

  const activeChannels = useMemo(() => channels.filter((c) => c.isActive !== false), [channels]);

  const selectedSlug = useMemo(() => {
    const ch = activeChannels.find((c) => c.id === channelId);
    return ch?.slug;
  }, [activeChannels, channelId]);

  const limit = charLimit(selectedSlug);
  const count = contentBody.length;
  const over = count > limit;

  const tagPills = useMemo(
    () =>
      tagsRaw
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    [tagsRaw]
  );

  const load = useCallback(async () => {
    if (!contentId) {
      setTitle("");
      setDescription("");
      setContentBody("");
      setChannelId(activeChannels[0]?.id ?? "");
      setStatus("idea");
      setScheduledDate(defaultDate ?? toYmd(new Date()));
      setScheduledTime("");
      setDueDate("");
      setAssignedTo("");
      setContentType("post");
      setTagsRaw("");
      setNotes("");
      setRecurring("");
      setRecurringEndDate("");
      setCampaignIds([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(apiUrl(`/marketing/content/${contentId}`), { headers: { ...authHeaders() } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Load failed");
      const it = body.item as ContentItem;
      setTitle(it.title);
      setDescription(it.description ?? "");
      setContentBody(it.contentBody ?? "");
      setChannelId(it.channelId ?? "");
      setStatus(it.status);
      setScheduledDate(it.scheduledDate ?? "");
      setScheduledTime(it.scheduledTime ?? "");
      setDueDate(it.dueDate ?? "");
      setAssignedTo(it.assignedTo ?? "");
      setContentType(it.contentType || "post");
      setTagsRaw((it.tags || []).join(", "));
      setNotes(it.notes ?? "");
      setRecurring(it.recurring ?? "");
      setRecurringEndDate(it.recurringEndDate ?? "");
      setCampaignIds((it.campaigns || []).map((c) => c.id));
    } catch {
      setTitle("");
    } finally {
      setLoading(false);
    }
  }, [contentId, defaultDate, authHeaders, activeChannels]);

  useEffect(() => {
    if (!open) return;
    load();
  }, [open, load]);

  const toggleCampaign = (id: number) => {
    setCampaignIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const onAiGenerate = async () => {
    if (!title.trim()) {
      alert("Add a title first so AI can draft around it.");
      return;
    }
    setAiBusy(true);
    try {
      const res = await fetch(apiUrl("/marketing/content/ai-generate"), {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `Write the full marketing piece for this working title: "${title.trim()}".`,
          channelId: channelId === "" ? null : channelId,
          contentType,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "AI failed");
      if (body.generatedContent) setContentBody(String(body.generatedContent));
      if (body.suggestedTitle && !title.trim()) setTitle(String(body.suggestedTitle));
    } catch (e) {
      alert(e instanceof Error ? e.message : "AI failed");
    } finally {
      setAiBusy(false);
    }
  };

  const onSave = async () => {
    if (!title.trim()) {
      alert("Title is required.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        description: description || null,
        contentBody: contentBody || null,
        channelId: channelId === "" ? null : channelId,
        status,
        scheduledDate: scheduledDate || null,
        scheduledTime: scheduledTime || null,
        dueDate: dueDate || null,
        assignedTo: assignedTo === "" ? null : assignedTo,
        contentType,
        tags: tagPills,
        campaignIds,
        notes: notes || null,
        recurring: recurring || null,
        recurringEndDate: recurringEndDate || null,
      };
      const url = contentId ? apiUrl(`/marketing/content/${contentId}`) : apiUrl("/marketing/content");
      const res = await fetch(url, {
        method: contentId ? "PUT" : "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Save failed");
      onSaved();
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (!contentId) return;
    if (!confirm("Delete this content item?")) return;
    setSaving(true);
    try {
      const res = await fetch(apiUrl(`/marketing/content/${contentId}`), {
        method: "DELETE",
        headers: { ...authHeaders() },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Delete failed");
      }
      onSaved();
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className={styles.modalOverlay} role="dialog" aria-modal onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`${styles.modal} ${styles.modalWide}`}>
        <div className={styles.modalHead}>
          <h2>{contentId ? "Edit content" : "New content"}</h2>
          <button type="button" className={styles.btnGhost} onClick={onClose}>
            Close
          </button>
        </div>
        <div className={styles.modalBody}>
          {loading ? (
            <p className={styles.emptyHint}>Loading…</p>
          ) : (
            <>
              <div className={styles.field}>
                <label htmlFor="mc-title">Title *</label>
                <input id="mc-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Working title" />
              </div>
              <div className={styles.field}>
                <label htmlFor="mc-ch">Channel</label>
                <select id="mc-ch" value={channelId === "" ? "" : String(channelId)} onChange={(e) => setChannelId(e.target.value ? Number(e.target.value) : "")}>
                  <option value="">—</option>
                  {activeChannels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.icon} {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label htmlFor="mc-ct">Content type</label>
                <select id="mc-ct" value={contentType} onChange={(e) => setContentType(e.target.value)}>
                  {CONTENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label htmlFor="mc-st">Status</label>
                <select id="mc-st" value={status} onChange={(e) => setStatus(e.target.value)}>
                  {STATUSES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label htmlFor="mc-sd">Scheduled date</label>
                <input id="mc-sd" type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
              </div>
              <div className={styles.field}>
                <label htmlFor="mc-stm">Scheduled time (optional)</label>
                <input id="mc-stm" type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} />
              </div>
              <div className={styles.field}>
                <label htmlFor="mc-due">Due date</label>
                <input id="mc-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
              <div className={styles.field}>
                <label htmlFor="mc-as">Assigned to</label>
                <select
                  id="mc-as"
                  value={assignedTo === "" ? "" : String(assignedTo)}
                  onChange={(e) => setAssignedTo(e.target.value ? Number(e.target.value) : "")}
                >
                  <option value="">—</option>
                  {teamUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.displayName}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label>Campaigns</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                  {campaigns.map((c) => (
                    <label
                      key={c.id}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.25rem",
                        fontSize: "0.82rem",
                        padding: "0.25rem 0.5rem",
                        borderRadius: 8,
                        border: campaignIds.includes(c.id) ? `2px solid ${c.color || "#0098d0"}` : "1px solid rgba(27,40,86,0.15)",
                        cursor: "pointer",
                        background: campaignIds.includes(c.id) ? "rgba(0,152,208,0.08)" : "#fff",
                      }}
                    >
                      <input type="checkbox" checked={campaignIds.includes(c.id)} onChange={() => toggleCampaign(c.id)} />
                      {c.name}
                    </label>
                  ))}
                </div>
              </div>
              <div className={styles.field}>
                <label htmlFor="mc-tags">Tags (comma-separated)</label>
                <input id="mc-tags" value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} placeholder="houston, landlords, tips" />
                {tagPills.length > 0 ? (
                  <div className={styles.tagPills}>
                    {tagPills.map((t) => (
                      <span key={t} className={styles.tagPill}>
                        {t}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className={styles.field}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
                  <label>Content body (Markdown)</label>
                  <button type="button" className={styles.btnAi} onClick={onAiGenerate} disabled={aiBusy}>
                    {aiBusy ? "✨ Working…" : "✨ AI Generate"}
                  </button>
                </div>
                <div className={styles.tabs}>
                  <button type="button" className={bodyTab === "write" ? styles.active : ""} onClick={() => setBodyTab("write")}>
                    Write
                  </button>
                  <button type="button" className={bodyTab === "preview" ? styles.active : ""} onClick={() => setBodyTab("preview")}>
                    Preview
                  </button>
                </div>
                {bodyTab === "write" ? (
                  <textarea className={styles.body} value={contentBody} onChange={(e) => setContentBody(e.target.value)} placeholder="Write or paste markdown…" />
                ) : (
                  <div className={styles.previewBox}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{contentBody || "_Nothing to preview._"}</ReactMarkdown>
                  </div>
                )}
                <div className={`${styles.charHint} ${over ? styles.warn : ""}`}>
                  {count} / {limit} characters {selectedSlug ? `(${selectedSlug})` : ""}
                </div>
              </div>
              <div className={styles.field}>
                <label htmlFor="mc-desc">Description</label>
                <textarea id="mc-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <div className={styles.field}>
                <label htmlFor="mc-notes">Internal notes</label>
                <textarea id="mc-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              <div className={styles.field}>
                <label htmlFor="mc-rec">Recurring</label>
                <select id="mc-rec" value={recurring} onChange={(e) => setRecurring(e.target.value)}>
                  {RECUR.map((r) => (
                    <option key={r.v || "none"} value={r.v}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
              {recurring ? (
                <div className={styles.field}>
                  <label htmlFor="mc-rend">Recurring end date</label>
                  <input id="mc-rend" type="date" value={recurringEndDate} onChange={(e) => setRecurringEndDate(e.target.value)} />
                </div>
              ) : null}
            </>
          )}
        </div>
        <div className={styles.modalFoot}>
          {contentId ? (
            <button type="button" className={`${styles.btnGhost} ${styles.btnDanger}`} onClick={onDelete} disabled={saving}>
              Delete
            </button>
          ) : (
            <span />
          )}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" className={styles.btnGhost} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={styles.btnPrimary} onClick={onSave} disabled={saving || loading}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
