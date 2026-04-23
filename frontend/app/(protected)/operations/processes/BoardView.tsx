"use client";

import { useEffect, useState } from "react";
import styles from "../operations.module.css";
import { apiUrl } from "../../../../lib/api";
import { useAuth } from "../../../../context/AuthContext";

type BoardStage = {
  id: number;
  name: string;
  color: string;
  textColor: string;
  stageOrder: number;
  isFinal: boolean;
  autoAdvance: boolean;
  virtual?: boolean;
};

type BoardCard = {
  id: number;
  title: string;
  propertyName: string | null;
  contactName: string | null;
  templateName: string | null;
  templateIcon: string | null;
  templateColor: string | null;
  status: string;
  currentStageId: number | null;
  currentStageName: string | null;
  currentStageColor: string | null;
  currentStageTextColor: string | null;
  currentStageIsFinal: boolean;
  boardPosition: number;
  startedAt: string;
  targetCompletion: string | null;
  completedAt: string | null;
  totalSteps: number;
  completedSteps: number;
  progress: number;
  currentStepName: string | null;
  overdue: boolean;
  lastActivityAt?: string | null;
  lastActivityType?: string | null;
  agingGreenHours?: number;
  agingYellowHours?: number;
  cardBadgeField?: string;
};

type Props = {
  templateId: number | null;
  assigneeId: number | null;
  search: string;
  priorityFilter: string;
  archived?: boolean;
  showStale?: boolean;
  onOpenCard: (processId: number) => void;
  refreshKey: number;
  onBulkChange?: (ids: number[]) => void;
};

function agingClass(card: BoardCard): string {
  if (!card.lastActivityAt) return styles.agingGreen;
  const hoursSince = (Date.now() - new Date(card.lastActivityAt).getTime()) / 3600000;
  const green = card.agingGreenHours ?? 48;
  const yellow = card.agingYellowHours ?? 96;
  if (hoursSince < green) return styles.agingGreen;
  if (hoursSince < yellow) return styles.agingYellow;
  return styles.agingRed;
}

function isStale(card: BoardCard): boolean {
  if (!card.lastActivityAt) return false;
  const hoursSince = (Date.now() - new Date(card.lastActivityAt).getTime()) / 3600000;
  return hoursSince >= (card.agingYellowHours ?? 96);
}

function badgeText(card: BoardCard): { text: string; cls: string } | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (card.targetCompletion) {
    const d = new Date(card.targetCompletion);
    const diffDays = Math.round((d.getTime() - today.getTime()) / 86400000);
    const text = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    if (diffDays < 0) return { text: `${text} · overdue`, cls: styles.badgePillOverdue };
    if (diffDays <= 7) return { text, cls: styles.badgePillDue };
    return { text, cls: styles.badgePill };
  }
  return null;
}

function initials(name: string | null | undefined) {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function progressColor(pct: number): string {
  if (pct < 50) return "#0098D0";
  if (pct < 80) return "#f59e0b";
  return "#10b981";
}

export default function BoardView({
  templateId,
  assigneeId,
  search,
  priorityFilter,
  archived,
  showStale,
  onOpenCard,
  refreshKey,
  onBulkChange,
}: Props) {
  const { authHeaders, token } = useAuth();
  const [stages, setStages] = useState<BoardStage[]>([]);
  const [byStage, setByStage] = useState<Record<string, BoardCard[]>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [dragCardId, setDragCardId] = useState<number | null>(null);
  const [hoverStage, setHoverStage] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    onBulkChange?.(Array.from(selectedIds));
  }, [selectedIds, onBulkChange]);

  useEffect(() => {
    if (!token) return;
    const params = new URLSearchParams();
    if (templateId) params.set("templateId", String(templateId));
    if (assigneeId) params.set("assignee", String(assigneeId));
    if (priorityFilter) params.set("priority", priorityFilter);
    if (archived) params.set("archived", "true");
    setLoading(true);
    setErr(null);
    (async () => {
      try {
        const res = await fetch(apiUrl(`/processes/board?${params.toString()}`), {
          headers: { ...authHeaders() },
          cache: "no-store",
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Load failed");
        setStages(body.stages || []);
        setByStage(body.processes || {});
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Load failed");
      } finally {
        setLoading(false);
      }
    })();
  }, [authHeaders, token, templateId, assigneeId, priorityFilter, archived, refreshKey]);

  const filtered = (cards: BoardCard[]) => {
    let arr = cards;
    if (showStale) arr = arr.filter(isStale);
    if (!search.trim()) return arr;
    const q = search.trim().toLowerCase();
    return arr.filter(
      (c) =>
        c.title?.toLowerCase().includes(q) ||
        c.propertyName?.toLowerCase().includes(q) ||
        c.contactName?.toLowerCase().includes(q) ||
        c.templateName?.toLowerCase().includes(q)
    );
  };

  const toggleSelect = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const moveCard = async (cardId: number, targetStageId: number) => {
    if (!Number.isFinite(targetStageId) || targetStageId < 0) return;
    // Optimistic update
    setByStage((prev) => {
      const next: Record<string, BoardCard[]> = {};
      let moved: BoardCard | null = null;
      for (const [key, cards] of Object.entries(prev)) {
        next[key] = cards.filter((c) => {
          if (c.id === cardId) {
            moved = { ...c, currentStageId: targetStageId };
            return false;
          }
          return true;
        });
      }
      if (moved) {
        const bucket = next[String(targetStageId)] ?? [];
        next[String(targetStageId)] = [moved, ...bucket];
      }
      return next;
    });
    try {
      const res = await fetch(apiUrl(`/processes/${cardId}/stage`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ stageId: targetStageId }),
      });
      if (!res.ok) throw new Error("Move failed");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Move failed");
    }
  };

  if (loading) return <div className={styles.loading}>Loading board…</div>;

  return (
    <>
      {err ? <div className={styles.errorBanner}>{err}</div> : null}
      <div className={styles.boardContainer}>
        {stages.map((st) => {
          const cards = filtered(byStage[String(st.id)] || []);
          const isOver = hoverStage === st.id;
          return (
            <div key={st.id} className={styles.boardCol}>
              <div
                className={styles.boardColHeader}
                style={{ background: st.color, color: st.textColor }}
              >
                <span>
                  {st.isFinal ? "✓ " : ""}
                  {st.name}
                </span>
                <span className={styles.boardColCount}>{cards.length}</span>
              </div>
              <div
                className={`${styles.boardColBody} ${isOver ? styles.boardColBodyOver : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (hoverStage !== st.id) setHoverStage(st.id);
                }}
                onDragLeave={() => setHoverStage(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = Number(e.dataTransfer.getData("text/plain"));
                  setHoverStage(null);
                  setDragCardId(null);
                  if (Number.isFinite(id) && !st.virtual) moveCard(id, st.id);
                }}
              >
                {cards.length === 0 ? (
                  <div className={styles.pickerEmpty} style={{ background: "transparent" }}>
                    No processes
                  </div>
                ) : (
                  cards.map((c) => {
                    const pct = c.progress ?? 0;
                    const barColor = progressColor(pct);
                    const aging = agingClass(c);
                    const badge = badgeText(c);
                    const isSelected = selectedIds.has(c.id);
                    return (
                      <div
                        key={c.id}
                        className={`${styles.processCardBoard} ${
                          c.overdue ? styles.processCardBoardOverdue : ""
                        } ${dragCardId === c.id ? styles.processCardBoardDragging : ""}`}
                        style={{ position: "relative" }}
                        draggable={!st.virtual}
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", String(c.id));
                          setDragCardId(c.id);
                        }}
                        onDragEnd={() => setDragCardId(null)}
                        onClick={() => onOpenCard(c.id)}
                      >
                        <input
                          type="checkbox"
                          className={styles.cardCheckbox}
                          checked={isSelected}
                          onChange={() => {
                            /* handled by onClick */
                          }}
                          onClick={(e) => toggleSelect(c.id, e)}
                          aria-label="Select card"
                        />
                        <span className={styles.agingDotWrap}>
                          <span
                            className={`${styles.agingDot} ${aging}`}
                            title={
                              c.lastActivityAt
                                ? `Last activity ${new Date(c.lastActivityAt).toLocaleString()}`
                                : "No activity recorded"
                            }
                          />
                        </span>
                        <h4 className={styles.processCardTitle} style={{ paddingRight: "1rem" }}>
                          {c.templateIcon ? `${c.templateIcon} ` : ""}
                          {c.title}
                        </h4>
                        {c.propertyName ? (
                          <div className={styles.processCardSub}>{c.propertyName}</div>
                        ) : null}
                        {c.templateName ? (
                          <div className={styles.processCardTags}>
                            <span
                              className={styles.categoryTag}
                              style={{ background: "rgba(0, 152, 208, 0.1)", color: "#007aa8" }}
                            >
                              {c.templateName}
                            </span>
                          </div>
                        ) : null}
                        <div className={styles.progressBarSlim}>
                          <div
                            className={styles.progressBarSlimFill}
                            style={{ width: `${pct}%`, background: barColor }}
                          />
                        </div>
                        <div className={styles.processCardFootRow}>
                          <span className={styles.processCardAvatar}>{initials(c.contactName)}</span>
                          {badge ? (
                            <span className={badge.cls}>{badge.text}</span>
                          ) : (
                            <span style={{ color: "#9ca3af" }}>No target</span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
