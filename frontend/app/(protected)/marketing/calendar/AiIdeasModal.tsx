"use client";

import { useState } from "react";
import { apiUrl } from "../../../../lib/api";
import type { Channel } from "./ContentEditorModal";
import styles from "./marketing-calendar.module.css";

export type Idea = {
  title: string;
  description: string;
  channelId: number | null;
  contentType: string;
  suggestedDate: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  channels: Channel[];
  authHeaders: () => Record<string, string>;
  onAdded: () => void;
};

export default function AiIdeasModal({ open, onClose, channels, authHeaders, onAdded }: Props) {
  const [timeframe, setTimeframe] = useState<"week" | "month">("week");
  const [busy, setBusy] = useState(false);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [channelPick, setChannelPick] = useState<number[]>([]);
  const [adding, setAdding] = useState<number | null>(null);

  const active = channels.filter((c) => c.isActive !== false);

  const runGenerate = async () => {
    setBusy(true);
    setIdeas([]);
    try {
      const res = await fetch(apiUrl("/marketing/content/ai-ideas"), {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          timeframe,
          channels: channelPick.length ? channelPick : active.map((c) => c.id),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to generate ideas");
      setIdeas(Array.isArray(body.ideas) ? body.ideas : []);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const addIdea = async (idea: Idea, ix: number) => {
    setAdding(ix);
    try {
      const res = await fetch(apiUrl("/marketing/content"), {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          title: idea.title,
          description: idea.description,
          channelId: idea.channelId,
          contentType: idea.contentType || "post",
          status: "idea",
          scheduledDate: idea.suggestedDate,
          tags: [],
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not add");
      onAdded();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not add");
    } finally {
      setAdding(null);
    }
  };

  const addAll = async () => {
    setBusy(true);
    try {
      for (const idea of ideas) {
        const res = await fetch(apiUrl("/marketing/content"), {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
            title: idea.title,
            description: idea.description,
            channelId: idea.channelId,
            contentType: idea.contentType || "post",
            status: "idea",
            scheduledDate: idea.suggestedDate,
            tags: [],
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Could not add item");
        }
      }
      onAdded();
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not add all");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className={styles.modalOverlay} role="dialog" aria-modal onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.modalHead}>
          <h2>AI Ideas ✨</h2>
          <button type="button" className={styles.btnGhost} onClick={onClose}>
            Close
          </button>
        </div>
        <div className={styles.modalBody}>
          <p style={{ marginTop: 0, color: "#6a737b", fontSize: "0.9rem" }}>
            {busy ? "Generating content ideas for this week/month…" : "Pick a timeframe and generate a batch of ideas for your calendar."}
          </p>
          <div className={styles.field}>
            <label>Timeframe</label>
            <select value={timeframe} onChange={(e) => setTimeframe(e.target.value as "week" | "month")}>
              <option value="week">This week</option>
              <option value="month">This month</option>
            </select>
          </div>
          <div className={styles.field}>
            <label>Channels (optional — default all)</label>
            <select
              multiple
              value={channelPick.map(String)}
              onChange={(e) => {
                const v = Array.from(e.target.selectedOptions).map((o) => Number(o.value));
                setChannelPick(v.filter((n) => Number.isFinite(n)));
              }}
              style={{ minHeight: "6rem" }}
            >
              {active.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            <button type="button" className={styles.btnAi} onClick={runGenerate} disabled={busy}>
              {busy ? (
                <>
                  <span className={styles.spinner} style={{ marginRight: 6, verticalAlign: "middle" }} /> Generating…
                </>
              ) : (
                "Generate ideas"
              )}
            </button>
            {ideas.length > 0 ? (
              <>
                <button type="button" className={styles.btnGhost} onClick={runGenerate} disabled={busy}>
                  Regenerate
                </button>
                <button type="button" className={styles.btnPrimary} onClick={addAll} disabled={busy || adding !== null}>
                  Add all
                </button>
              </>
            ) : null}
          </div>
          {ideas.map((idea, ix) => {
            const ch = idea.channelId != null ? active.find((c) => c.id === idea.channelId) : null;
            return (
              <div key={`${idea.title}-${ix}`} className={styles.ideaRow}>
                <h4>{idea.title}</h4>
                <p style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", color: "#6a737b" }}>{idea.description}</p>
                <div style={{ fontSize: "0.78rem", color: "#1b2856", marginBottom: "0.5rem" }}>
                  {ch ? (
                    <>
                      <span>{ch.icon}</span> {ch.name} · {idea.contentType}
                    </>
                  ) : (
                    idea.contentType
                  )}
                  {idea.suggestedDate ? ` · ${idea.suggestedDate}` : ""}
                </div>
                <button type="button" className={styles.btnPrimary} disabled={adding !== null} onClick={() => addIdea(idea, ix)}>
                  {adding === ix ? "Adding…" : "Add to Calendar"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
