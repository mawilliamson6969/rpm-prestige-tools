"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import operationsStyles from "../../../../operations.module.css";
import detailStyles from "./components/detail.module.css";
import OperationsTopBar from "../../../../OperationsTopBar";
import UpdateComposer from "./components/UpdateComposer";
import UpdateEntry from "./components/UpdateEntry";
import type { MentionableUser } from "./components/MentionDropdown";
import { apiUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import type { UpdateType } from "@/types/mb";

/**
 * Phase 7 (Unification): the canonical process detail page.
 *
 * Replaces the Phase 4 mb-item detail. Layout follows the Phase 4
 * pattern (header / left main column / right side panel / Updates
 * feed below), but the "column values" section becomes a Stages &
 * Steps section driven by System A's process_stages + process_steps.
 *
 * The Updates feed components (UpdateComposer, UpdateEntry, ReactionBar,
 * AttachmentChip, MentionDropdown) are reused verbatim from Phase 4 —
 * their backend handlers have been rekeyed to process_id.
 */

const POLL_INTERVAL_MS = 30_000;

interface Process {
  id: number;
  templateId: number;
  templateName: string | null;
  name: string;
  status: string;
  propertyName: string | null;
  propertyId: number | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  startedAt: string;
  targetCompletion: string | null;
  completedAt: string | null;
  notes: string | null;
  currentStageId: number | null;
  currentStageName: string | null;
  currentStageColor: string | null;
}

interface Stage {
  id: number;
  processId: number;
  templateStageId: number | null;
  name: string;
  stageOrder: number;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  color: string | null;
  icon: string | null;
}

interface Step {
  id: number;
  processId: number;
  templateStepId: number | null;
  stepNumber: number;
  name: string;
  description: string | null;
  status: string;
  assignedUserId: number | null;
  assignedUserName: string | undefined;
  assignedRole: string | null;
  dueDate: string | null;
  completedAt: string | null;
  completedBy: number | null;
  completedByName: string | undefined;
  stageId: number | null;
  instructions: string | null;
  taskType: string | null;
  instructionObjective: string | null;
  instructionSteps: InstructionStep[] | null;
  instructionDecisionMatrix: DecisionRow[] | null;
  instructionEmailTemplates: EmailTemplate[] | null;
  instructionSmsTemplates: SmsTemplate[] | null;
  instructionEscalations: string | null;
  instructionCompletionChecklist: ChecklistItem[] | null;
  instructionRelatedResources: Resource[] | null;
}

interface InstructionStep { id: string; text_html?: string; text_plain?: string; has_checkbox?: boolean; position?: number }
interface DecisionRow { id: string; condition?: string; action?: string }
interface EmailTemplate { id: string; name?: string; subject?: string; body_html?: string; body_plain?: string }
interface SmsTemplate { id: string; name?: string; body?: string }
interface ChecklistItem { id: string; label?: string; is_required?: boolean; position?: number }
interface Resource { id: string; label?: string; url?: string }

interface UpdateRow {
  id: number;
  process_id: number | null;
  parent_update_id: number | null;
  user_id: number | null;
  body: string;
  body_html: string | null;
  update_type: UpdateType;
  metadata: Record<string, unknown>;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  user_display_name: string | null;
  user_username: string | null;
  reactions?: Array<{ emoji: string; count: number; users: Array<{ user_id: number; display_name: string | null }> }>;
  mentions?: Array<{ mentioned_user_id: number; seen_at: string | null; display_name: string | null }>;
  attachments?: Array<{ id: number; filename: string; mime_type: string; size_bytes: number; uploaded_by: number | null; created_at: string }>;
}

interface TeamUser {
  id: number;
  username: string;
  displayName: string;
}

export default function ProcessDetailClient({
  boardSlug,
  processId,
}: {
  boardSlug: string;
  processId: number;
}) {
  const { authHeaders, token, user, isAdmin } = useAuth();
  const [process, setProcess] = useState<Process | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [updates, setUpdates] = useState<UpdateRow[]>([]);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [composerErr, setComposerErr] = useState<string | null>(null);
  const [expandedStepId, setExpandedStepId] = useState<number | null>(null);

  const loadProcess = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl(`/processes/${processId}`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Could not load process (${res.status}).`);
      }
      const body = await res.json();
      setProcess(coerceProcess(body.process));
      setStages((body.stages || []).map(coerceStage));
      setSteps((body.steps || []).map(coerceStep));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load process.");
    }
  }, [authHeaders, processId, token]);

  const loadUpdates = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl(`/mb/items/${processId}/updates`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = await res.json();
      setUpdates(body.updates || []);
    } catch {
      /* ignore */
    }
  }, [authHeaders, processId, token]);

  const loadUsers = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl("/users"), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = await res.json();
      if (Array.isArray(body.users)) {
        setUsers(
          body.users.map((u: { id: number; username: string; displayName?: string }) => ({
            id: u.id,
            username: u.username,
            displayName: u.displayName || u.username,
          })),
        );
      }
    } catch {
      /* ignore */
    }
  }, [authHeaders, token]);

  const markMentionsSeen = useCallback(async () => {
    if (!token) return;
    try {
      await fetch(apiUrl(`/mb/items/${processId}/mark-mentions-seen`), {
        method: "POST",
        headers: { ...authHeaders() },
      });
    } catch {
      /* non-fatal */
    }
  }, [authHeaders, processId, token]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        await Promise.all([loadProcess(), loadUpdates(), loadUsers(), markMentionsSeen()]);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Could not load.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadProcess, loadUpdates, loadUsers, markMentionsSeen]);

  // Poll updates feed + window-focus refresh — same pattern as Phase 4.
  useEffect(() => {
    if (!token) return;
    const interval = setInterval(loadUpdates, POLL_INTERVAL_MS);
    const onFocus = () => {
      loadUpdates();
      markMentionsSeen();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadUpdates, markMentionsSeen, token]);

  // ----- Step completion / skip -----

  const completeStep = useCallback(
    async (stepId: number) => {
      try {
        const res = await fetch(apiUrl(`/processes/steps/${stepId}/complete`), {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({}),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Could not complete step.");
        }
        await loadProcess();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not complete step.");
      }
    },
    [authHeaders, loadProcess],
  );

  // ----- Updates feed actions (reuse Phase 4 patterns) -----

  async function uploadAttachmentsFor(updateId: number, files: File[]) {
    for (const f of files) {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch(apiUrl(`/mb/updates/${updateId}/attachments`), {
        method: "POST",
        headers: { ...authHeaders() },
        body: fd,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Attachment upload failed for ${f.name}.`);
      }
    }
  }

  const postComment = useCallback(
    async ({ bodyHtml, files }: { bodyHtml: string; text: string; files: File[] }): Promise<boolean> => {
      setSubmitting(true);
      setComposerErr(null);
      try {
        const res = await fetch(apiUrl(`/mb/items/${processId}/updates`), {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ body_html: bodyHtml }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Could not post comment.");
        }
        const body = await res.json();
        if (files.length > 0 && body.update?.id) {
          await uploadAttachmentsFor(body.update.id, files);
        }
        await loadUpdates();
        return true;
      } catch (e) {
        setComposerErr(e instanceof Error ? e.message : "Could not post comment.");
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [authHeaders, processId, loadUpdates], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const postReply = useCallback(
    async (parentId: number, data: { bodyHtml: string; text: string; files: File[] }): Promise<boolean> => {
      try {
        const res = await fetch(apiUrl(`/mb/updates/${parentId}/replies`), {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ body_html: data.bodyHtml }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Could not post reply.");
        }
        const body = await res.json();
        if (data.files.length > 0 && body.update?.id) {
          await uploadAttachmentsFor(body.update.id, data.files);
        }
        await loadUpdates();
        return true;
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not post reply.");
        return false;
      }
    },
    [authHeaders, loadUpdates], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const editComment = useCallback(
    async (id: number, data: { bodyHtml: string }): Promise<boolean> => {
      try {
        const res = await fetch(apiUrl(`/mb/updates/${id}`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ body_html: data.bodyHtml }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Could not edit comment.");
        }
        await loadUpdates();
        return true;
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not edit comment.");
        return false;
      }
    },
    [authHeaders, loadUpdates],
  );

  const deleteComment = useCallback(
    async (id: number) => {
      if (!window.confirm("Delete this comment? This cannot be undone.")) return;
      try {
        const res = await fetch(apiUrl(`/mb/updates/${id}`), {
          method: "DELETE",
          headers: { ...authHeaders() },
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Could not delete comment.");
        }
        await loadUpdates();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not delete comment.");
      }
    },
    [authHeaders, loadUpdates],
  );

  const toggleReaction = useCallback(
    async (updateId: number, emoji: string, mine: boolean) => {
      setUpdates((arr) =>
        arr.map((u) => {
          if (u.id !== updateId) return u;
          const reactions = [...(u.reactions ?? [])];
          const idx = reactions.findIndex((r) => r.emoji === emoji);
          if (mine && idx >= 0) {
            const next = {
              ...reactions[idx],
              count: Math.max(0, reactions[idx].count - 1),
              users: reactions[idx].users.filter((x) => x.user_id !== user?.id),
            };
            if (next.count <= 0) reactions.splice(idx, 1);
            else reactions[idx] = next;
          } else if (!mine && idx >= 0) {
            reactions[idx] = {
              ...reactions[idx],
              count: reactions[idx].count + 1,
              users: [
                ...reactions[idx].users,
                { user_id: user!.id, display_name: user!.displayName },
              ],
            };
          } else if (!mine) {
            reactions.push({
              emoji,
              count: 1,
              users: [{ user_id: user!.id, display_name: user!.displayName }],
            });
          }
          return { ...u, reactions };
        }),
      );
      try {
        const res = await fetch(apiUrl(`/mb/updates/${updateId}/reactions`), {
          method: mine ? "DELETE" : "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ emoji }),
        });
        if (!res.ok) throw new Error("Reaction failed.");
      } catch {
        await loadUpdates();
      }
    },
    [authHeaders, loadUpdates, user],
  );

  // ----- Render helpers -----

  const stepsByStage = useMemo(() => {
    const m = new Map<number | null, Step[]>();
    for (const s of steps) {
      const key = s.stageId ?? null;
      const arr = m.get(key) ?? [];
      arr.push(s);
      m.set(key, arr);
    }
    for (const arr of Array.from(m.values())) {
      arr.sort((a, b) => a.stepNumber - b.stepNumber);
    }
    return m;
  }, [steps]);

  const { topLevel, repliesByParent } = useMemo(() => {
    const top: UpdateRow[] = [];
    const byParent = new Map<number, UpdateRow[]>();
    for (const u of updates) {
      if (u.parent_update_id == null) top.push(u);
      else {
        const arr = byParent.get(u.parent_update_id) ?? [];
        arr.push(u);
        byParent.set(u.parent_update_id, arr);
      }
    }
    top.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
    for (const arr of Array.from(byParent.values())) {
      arr.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
    }
    return { topLevel: top, repliesByParent: byParent };
  }, [updates]);

  const mentionUsers: MentionableUser[] = useMemo(
    () => users.map((u) => ({ id: u.id, username: u.username, displayName: u.displayName })),
    [users],
  );

  return (
    <div className={`${operationsStyles.page} ${detailStyles.page}`}>
      <OperationsTopBar />
      <div className={detailStyles.main}>
        <div className={detailStyles.headerBar}>
          <Link
            href={`/operations/boards/${boardSlug}`}
            className={detailStyles.backLink}
          >
            ← Back to board
          </Link>
          {process?.templateName ? (
            <>
              <span className={detailStyles.crumb}>/</span>
              <span className={detailStyles.crumb}>{process.templateName}</span>
            </>
          ) : null}
        </div>

        {err ? <div className={detailStyles.errBanner}>{err}</div> : null}

        {loading || !process ? (
          <div className={detailStyles.loadingState}>Loading process…</div>
        ) : (
          <>
            <h1 className={detailStyles.title}>{process.name}</h1>
            <p className={detailStyles.subtitle}>
              {process.currentStageName ? (
                <span
                  style={{
                    display: "inline-block",
                    padding: "0.15rem 0.55rem",
                    borderRadius: 999,
                    background: process.currentStageColor || "#0086c0",
                    color: "white",
                    fontWeight: 700,
                    fontSize: "0.78rem",
                    marginRight: "0.5rem",
                  }}
                >
                  {process.currentStageName}
                </span>
              ) : null}
              {process.propertyName ?? ""}
            </p>

            <div className={detailStyles.grid}>
              <div>
                {/* Stages & Steps (replaces Phase 4's column-values area) */}
                <div className={detailStyles.card}>
                  <h3 className={detailStyles.cardTitle}>Stages & Steps</h3>
                  {stages.length === 0 ? (
                    <div className={detailStyles.notLinked}>
                      No stages configured on this template.
                    </div>
                  ) : (
                    stages.map((stage) => (
                      <StageCard
                        key={stage.id}
                        stage={stage}
                        steps={stepsByStage.get(stage.id) ?? []}
                        expandedStepId={expandedStepId}
                        onToggleStep={(id) =>
                          setExpandedStepId((cur) => (cur === id ? null : id))
                        }
                        onCompleteStep={completeStep}
                      />
                    ))
                  )}
                </div>
              </div>

              <div>
                <ProcessMetaPanel process={process} />
              </div>
            </div>

            <div className={detailStyles.feedCard}>
              <h3 className={detailStyles.feedTitle}>Updates</h3>
              <UpdateComposer
                users={mentionUsers}
                submitting={submitting}
                errorText={composerErr}
                onSubmit={postComment}
              />
              {topLevel.length === 0 ? (
                <div className={detailStyles.emptyState}>
                  No updates yet. Be the first to post a comment.
                </div>
              ) : (
                topLevel.map((u) => (
                  <UpdateEntry
                    key={u.id}
                    update={u}
                    replies={repliesByParent.get(u.id) ?? []}
                    currentUserId={user?.id ?? null}
                    isAdmin={isAdmin}
                    users={mentionUsers}
                    onReply={postReply}
                    onEdit={editComment}
                    onDelete={deleteComment}
                    onReact={toggleReaction}
                  />
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Stage / Step / Instruction views
// ============================================================

function StageCard({
  stage,
  steps,
  expandedStepId,
  onToggleStep,
  onCompleteStep,
}: {
  stage: Stage;
  steps: Step[];
  expandedStepId: number | null;
  onToggleStep: (id: number) => void;
  onCompleteStep: (id: number) => Promise<void>;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const doneCount = steps.filter((s) => s.status === "completed" || s.status === "done").length;
  return (
    <div
      style={{
        border: "1px solid rgba(27,40,86,0.12)",
        borderRadius: 10,
        marginBottom: "0.6rem",
        overflow: "hidden",
        background: "#fff",
      }}
    >
      <div
        onClick={() => setCollapsed((c) => !c)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setCollapsed((c) => !c);
          }
        }}
        style={{
          padding: "0.55rem 0.75rem",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          cursor: "pointer",
          background: "rgba(27,40,86,0.02)",
        }}
      >
        <span
          style={{
            width: 10, height: 10, borderRadius: 999,
            background: stage.color || "#6a737b",
          }}
        />
        <span style={{ fontWeight: 700, color: "#1b2856" }}>{stage.name}</span>
        <span style={{ fontSize: "0.78rem", color: "#6a737b", marginLeft: "auto" }}>
          {doneCount} / {steps.length} done
        </span>
        <span style={{ fontSize: "0.78rem", color: "#6a737b" }}>
          {collapsed ? "▶" : "▼"}
        </span>
      </div>
      {!collapsed
        ? steps.length === 0
          ? <div style={{ padding: "0.6rem 0.75rem", color: "#6a737b", fontStyle: "italic", fontSize: "0.85rem" }}>No steps.</div>
          : steps.map((step) => (
              <StepRow
                key={step.id}
                step={step}
                expanded={expandedStepId === step.id}
                onToggle={() => onToggleStep(step.id)}
                onComplete={onCompleteStep}
              />
            ))
        : null}
    </div>
  );
}

function StepRow({
  step,
  expanded,
  onToggle,
  onComplete,
}: {
  step: Step;
  expanded: boolean;
  onToggle: () => void;
  onComplete: (id: number) => Promise<void>;
}) {
  const done = step.status === "completed" || step.status === "done";
  const taskType = (step.taskType || "todo").toLowerCase();
  const typeIcon = taskType === "email" ? "✉️" : taskType === "text" || taskType === "sms" ? "💬" : taskType === "call" ? "📞" : "✓";
  return (
    <div style={{ borderTop: "1px solid rgba(27,40,86,0.08)" }}>
      <div
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        style={{
          padding: "0.55rem 0.75rem",
          display: "flex",
          alignItems: "center",
          gap: "0.55rem",
          cursor: "pointer",
        }}
      >
        <span style={{ fontSize: "0.95rem" }}>{typeIcon}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (!done) onComplete(step.id);
          }}
          aria-label={done ? "Step completed" : "Mark step complete"}
          style={{
            width: 18, height: 18, borderRadius: 4,
            border: `1.5px solid ${done ? "#00c875" : "#6a737b"}`,
            background: done ? "#00c875" : "transparent",
            color: "white",
            cursor: done ? "default" : "pointer",
            fontWeight: 800,
            fontSize: "0.8rem",
            padding: 0,
          }}
        >
          {done ? "✓" : ""}
        </button>
        <span
          style={{
            fontWeight: 600,
            color: "#1b2856",
            textDecoration: done ? "line-through" : "none",
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {step.name}
        </span>
        <span style={{ fontSize: "0.78rem", color: "#6a737b" }}>
          {step.assignedUserName ?? step.assignedRole ?? "—"}
        </span>
        <span style={{ fontSize: "0.78rem", color: "#6a737b" }}>
          {step.dueDate ?? "—"}
        </span>
        <span style={{ fontSize: "0.78rem", color: "#6a737b" }}>{expanded ? "▼" : "▶"}</span>
      </div>
      {expanded ? <StepInstructions step={step} /> : null}
    </div>
  );
}

function StepInstructions({ step }: { step: Step }) {
  const sections: Array<{ title: string; render: () => React.ReactNode; show: boolean }> = [
    {
      title: "Objective",
      show: !!step.instructionObjective?.trim(),
      render: () => (
        <p style={{ margin: 0, color: "#1b2856" }}>{step.instructionObjective}</p>
      ),
    },
    {
      title: "Step-by-step",
      show: !!(step.instructionSteps && step.instructionSteps.length > 0),
      render: () => (
        <ol style={{ margin: 0, paddingLeft: "1.25rem", color: "#1b2856" }}>
          {(step.instructionSteps ?? []).map((s, i) => (
            <li key={s.id ?? i} style={{ marginBottom: "0.25rem" }}>
              <span
                dangerouslySetInnerHTML={{ __html: s.text_html ?? s.text_plain ?? "" }}
              />
            </li>
          ))}
        </ol>
      ),
    },
    {
      title: "Decision matrix",
      show: !!(step.instructionDecisionMatrix && step.instructionDecisionMatrix.length > 0),
      render: () => (
        <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
          {(step.instructionDecisionMatrix ?? []).map((r, i) => (
            <li
              key={r.id ?? i}
              style={{
                padding: "0.5rem 0.6rem",
                marginBottom: "0.35rem",
                background: "#fff",
                border: "1px solid rgba(27,40,86,0.12)",
                borderRadius: 8,
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "0.5rem",
                fontSize: "0.88rem",
              }}
            >
              <div style={{ color: "#6a737b" }}>
                <strong style={{ color: "#1b2856" }}>If </strong>
                {r.condition}
              </div>
              <div style={{ color: "#1b2856" }}>
                <strong>Then </strong>
                {r.action}
              </div>
            </li>
          ))}
        </ul>
      ),
    },
    {
      title: "Email templates",
      show: !!(step.instructionEmailTemplates && step.instructionEmailTemplates.length > 0),
      render: () => (
        <div>
          {(step.instructionEmailTemplates ?? []).map((t, i) => (
            <div
              key={t.id ?? i}
              style={{
                padding: "0.55rem 0.65rem",
                marginBottom: "0.4rem",
                background: "#fff",
                border: "1px solid rgba(27,40,86,0.12)",
                borderRadius: 8,
              }}
            >
              <div style={{ fontWeight: 700, color: "#1b2856", marginBottom: "0.2rem" }}>
                {t.name}
              </div>
              <div style={{ fontSize: "0.84rem", color: "#6a737b" }}>
                <strong>Subject:</strong> {t.subject}
              </div>
              <div
                style={{ fontSize: "0.88rem", color: "#1b2856", marginTop: "0.3rem" }}
                dangerouslySetInnerHTML={{ __html: t.body_html ?? "" }}
              />
            </div>
          ))}
        </div>
      ),
    },
    {
      title: "SMS templates",
      show: !!(step.instructionSmsTemplates && step.instructionSmsTemplates.length > 0),
      render: () => (
        <div>
          {(step.instructionSmsTemplates ?? []).map((t, i) => (
            <div
              key={t.id ?? i}
              style={{
                padding: "0.45rem 0.65rem",
                marginBottom: "0.35rem",
                background: "#fff",
                border: "1px solid rgba(27,40,86,0.12)",
                borderRadius: 8,
              }}
            >
              <div style={{ fontWeight: 700, color: "#1b2856", marginBottom: "0.2rem" }}>
                {t.name}
              </div>
              <div style={{ fontSize: "0.88rem", color: "#1b2856", whiteSpace: "pre-wrap" }}>
                {t.body}
              </div>
            </div>
          ))}
        </div>
      ),
    },
    {
      title: "Escalation triggers",
      show: !!step.instructionEscalations?.trim(),
      render: () => (
        <p style={{ margin: 0, color: "#1b2856" }}>{step.instructionEscalations}</p>
      ),
    },
    {
      title: "Completion checklist",
      show: !!(step.instructionCompletionChecklist && step.instructionCompletionChecklist.length > 0),
      render: () => (
        <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
          {(step.instructionCompletionChecklist ?? []).map((c, i) => (
            <li
              key={c.id ?? i}
              style={{
                padding: "0.3rem 0",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                color: "#1b2856",
                fontSize: "0.88rem",
              }}
            >
              <input type="checkbox" disabled />
              <span>{c.label}</span>
              {c.is_required ? (
                <span style={{ color: "#b32317", fontSize: "0.74rem", fontWeight: 700 }}>required</span>
              ) : null}
            </li>
          ))}
        </ul>
      ),
    },
    {
      title: "Related resources",
      show: !!(step.instructionRelatedResources && step.instructionRelatedResources.length > 0),
      render: () => (
        <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
          {(step.instructionRelatedResources ?? []).map((r, i) => (
            <li key={r.id ?? i} style={{ padding: "0.25rem 0" }}>
              <a
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#0086c0", fontWeight: 600, textDecoration: "none" }}
              >
                🔗 {r.label}
              </a>
            </li>
          ))}
        </ul>
      ),
    },
  ];

  const visible = sections.filter((s) => s.show);
  if (visible.length === 0) {
    return (
      <div style={{ padding: "0.6rem 0.85rem", background: "rgba(27,40,86,0.02)", fontSize: "0.85rem", color: "#6a737b", fontStyle: "italic" }}>
        No embedded instructions on this step yet. Edit the template to add them.
      </div>
    );
  }
  return (
    <div style={{ padding: "0.7rem 0.85rem", background: "rgba(27,40,86,0.02)" }}>
      {visible.map((sec) => (
        <div key={sec.title} style={{ marginBottom: "0.85rem" }}>
          <div
            style={{
              fontSize: "0.72rem",
              fontWeight: 700,
              color: "#6a737b",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: "0.35rem",
            }}
          >
            {sec.title}
          </div>
          {sec.render()}
        </div>
      ))}
    </div>
  );
}

function ProcessMetaPanel({ process }: { process: Process }) {
  return (
    <div className={detailStyles.card}>
      <h3 className={detailStyles.cardTitle}>Process details</h3>
      <Row label="Template" value={process.templateName} />
      <Row label="Status" value={process.status} />
      <Row label="Property" value={process.propertyName} />
      <Row label="Contact" value={process.contactName} />
      <Row label="Email" value={process.contactEmail} />
      <Row label="Phone" value={process.contactPhone} />
      <Row label="Started" value={process.startedAt ? new Date(process.startedAt).toLocaleDateString() : null} />
      <Row label="Target" value={process.targetCompletion} />
      <Row label="Completed" value={process.completedAt ? new Date(process.completedAt).toLocaleString() : null} />
      {process.notes ? (
        <div style={{ marginTop: "0.5rem", padding: "0.5rem 0.6rem", background: "rgba(27,40,86,0.04)", borderRadius: 6, fontSize: "0.86rem", color: "#1b2856" }}>
          {process.notes}
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (value == null || value === "") return null;
  return (
    <div className={detailStyles.field}>
      <span className={detailStyles.fieldLabel}>{label}</span>
      <span className={detailStyles.fieldValue}>{value}</span>
    </div>
  );
}

// ===== shape coercion =====

function coerceProcess(p: Record<string, unknown>): Process {
  return {
    id: Number(p.id),
    templateId: Number(p.templateId ?? p.template_id),
    templateName: (p.templateName as string | null) ?? null,
    name: String(p.name ?? ""),
    status: String(p.status ?? "active"),
    propertyName: (p.propertyName as string | null) ?? null,
    propertyId: (p.propertyId as number | null) ?? null,
    contactName: (p.contactName as string | null) ?? null,
    contactEmail: (p.contactEmail as string | null) ?? null,
    contactPhone: (p.contactPhone as string | null) ?? null,
    startedAt: String(p.startedAt ?? p.started_at ?? ""),
    targetCompletion: (p.targetCompletion as string | null) ?? null,
    completedAt: (p.completedAt as string | null) ?? null,
    notes: (p.notes as string | null) ?? null,
    currentStageId: typeof p.currentStageId === "number" ? p.currentStageId : null,
    currentStageName: (p.currentStageName as string | null) ?? null,
    currentStageColor: (p.currentStageColor as string | null) ?? null,
  };
}

function coerceStage(s: Record<string, unknown>): Stage {
  return {
    id: Number(s.id),
    processId: Number(s.processId ?? s.process_id),
    templateStageId: typeof s.templateStageId === "number" ? s.templateStageId : null,
    name: String(s.name ?? ""),
    stageOrder: Number(s.stageOrder ?? s.stage_order ?? 0),
    status: String(s.status ?? "pending"),
    startedAt: (s.startedAt as string | null) ?? null,
    completedAt: (s.completedAt as string | null) ?? null,
    color: (s.color as string | null) ?? null,
    icon: (s.icon as string | null) ?? null,
  };
}

function coerceStep(s: Record<string, unknown>): Step {
  return {
    id: Number(s.id),
    processId: Number(s.processId ?? s.process_id),
    templateStepId: typeof s.templateStepId === "number" ? s.templateStepId : null,
    stepNumber: Number(s.stepNumber ?? s.step_number ?? 0),
    name: String(s.name ?? ""),
    description: (s.description as string | null) ?? null,
    status: String(s.status ?? "pending"),
    assignedUserId: typeof s.assignedUserId === "number" ? s.assignedUserId : null,
    assignedUserName: typeof s.assignedUserName === "string" ? s.assignedUserName : undefined,
    assignedRole: (s.assignedRole as string | null) ?? null,
    dueDate: (s.dueDate as string | null) ?? null,
    completedAt: (s.completedAt as string | null) ?? null,
    completedBy: typeof s.completedBy === "number" ? s.completedBy : null,
    completedByName: typeof s.completedByName === "string" ? s.completedByName : undefined,
    stageId: typeof s.stageId === "number" ? s.stageId : null,
    instructions: (s.instructions as string | null) ?? null,
    taskType: (s.taskType as string | null) ?? null,
    instructionObjective: (s.instructionObjective as string | null) ?? null,
    instructionSteps: extractList(s.instructionSteps, "steps"),
    instructionDecisionMatrix: extractList(s.instructionDecisionMatrix, "rows"),
    instructionEmailTemplates: extractList(s.instructionEmailTemplates, "templates"),
    instructionSmsTemplates: extractList(s.instructionSmsTemplates, "templates"),
    instructionEscalations:
      typeof s.instructionEscalations === "string"
        ? s.instructionEscalations
        : extractText(s.instructionEscalations),
    instructionCompletionChecklist: extractList(s.instructionCompletionChecklist, "items"),
    instructionRelatedResources: extractList(s.instructionRelatedResources, "resources"),
  };
}

/**
 * The Phase 5 instruction blobs were stored as `{steps:[...]}`,
 * `{rows:[...]}`, etc. — wrapper objects. Phase 7 keeps that nesting on
 * the database side (the JSONB columns get the same payload), so the
 * coercer extracts the inner array.
 */
function extractList<T>(v: unknown, key: string): T[] | null {
  if (!v) return null;
  if (Array.isArray(v)) return v as T[];
  if (typeof v === "object" && v != null) {
    const inner = (v as Record<string, unknown>)[key];
    if (Array.isArray(inner)) return inner as T[];
  }
  return null;
}

function extractText(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    if (typeof obj.text_html === "string") return obj.text_html;
    if (typeof obj.text_plain === "string") return obj.text_plain;
  }
  return null;
}
