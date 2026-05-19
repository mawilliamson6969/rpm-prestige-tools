"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import OperationsTopBar from "../../../../OperationsTopBar";
import UpdateComposer from "./components/UpdateComposer";
import UpdateEntry from "./components/UpdateEntry";
import type { MentionableUser } from "./components/MentionDropdown";
import { apiUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import type { UpdateType } from "@/types/mb";
import styles from "./instance.module.css";

/**
 * Phase 7.2 (PMS): the redesigned process-instance detail page.
 *
 * Pixel-target: process-management-system/project/instance.jsx.
 * Layout = header + horizontal stage stepper + (current-stage card
 * with Tasks/Activity/Files/Notes tabs + What's-next) | right rail
 * (Property / People / Custom Fields / Process Info).
 *
 * The Phase 4 updates feed (UpdateComposer/UpdateEntry, process-keyed
 * since Phase 7) becomes the "Notes" tab. Activity / Files / Custom
 * Fields are read-only views over the existing processSettings.js
 * endpoints.
 */

const POLL_INTERVAL_MS = 30_000;

type TabId = "tasks" | "activity" | "files" | "notes";

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
  kind: string | null;
  actor: string | null;
  whenText: string | null;
  dayOffset: number | null;
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

interface ActivityRow {
  id: number;
  actionType: string;
  description: string;
  actorName: string | null;
  actorType: string | null;
  createdAt: string;
}

interface AttachmentRow {
  id: number;
  filename: string;
  fileSize: number | null;
  mimeType: string | null;
  uploadedByName: string | null;
  createdAt: string;
}

interface CustomFieldRow {
  label: string;
  fieldType: string;
  value: unknown;
  scope: string;
  stepName: string | null;
}

const STAGE_FALLBACK_COLORS = [
  "var(--pms-stg-1)",
  "var(--pms-stg-2)",
  "var(--pms-stg-3)",
  "var(--pms-stg-4)",
  "var(--pms-stg-5)",
  "var(--pms-stg-6)",
];

function stageColor(s: { color: string | null }, idx: number): string {
  if (s.color && s.color.startsWith("#")) return s.color;
  return STAGE_FALLBACK_COLORS[idx % STAGE_FALLBACK_COLORS.length];
}

const KIND_META: Record<string, { color: string; label: string }> = {
  todo: { color: "#0C5A8A", label: "TODO" },
  email: { color: "#0098D0", label: "EMAIL" },
  text: { color: "#7E4FBF", label: "TEXT" },
  call: { color: "#1E7B45", label: "CALL" },
  meet: { color: "#D89A2F", label: "MEETING" },
  stagechange: { color: "#B32317", label: "STAGE" },
  branch: { color: "#6A737B", label: "BRANCH" },
  exit: { color: "#8A91A6", label: "EXIT" },
};

function fmtDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString();
}

function relTime(s: string): string {
  const d = new Date(s);
  const diff = Date.now() - d.getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
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
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [customFields, setCustomFields] = useState<CustomFieldRow[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>("tasks");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [composerErr, setComposerErr] = useState<string | null>(null);
  const [expandedStepId, setExpandedStepId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [stageBusy, setStageBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  const loadActivity = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl(`/processes/${processId}/activity`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = await res.json();
      setActivity(
        (body.activity || []).map((a: Record<string, unknown>) => ({
          id: Number(a.id),
          actionType: String(a.actionType ?? ""),
          description: String(a.description ?? ""),
          actorName: (a.actorName as string | null) ?? null,
          actorType: (a.actorType as string | null) ?? null,
          createdAt: String(a.createdAt ?? ""),
        })),
      );
    } catch {
      /* ignore */
    }
  }, [authHeaders, processId, token]);

  const loadAttachments = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl(`/processes/${processId}/attachments`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = await res.json();
      setAttachments(
        (body.attachments || []).map((a: Record<string, unknown>) => ({
          id: Number(a.id),
          filename: String(a.filename ?? ""),
          fileSize: a.fileSize != null ? Number(a.fileSize) : null,
          mimeType: (a.mimeType as string | null) ?? null,
          uploadedByName: (a.uploadedByName as string | null) ?? null,
          createdAt: String(a.createdAt ?? ""),
        })),
      );
    } catch {
      /* ignore */
    }
  }, [authHeaders, processId, token]);

  const loadCustomFields = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl(`/processes/${processId}/custom-field-summary`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = await res.json();
      setCustomFields(
        (body.fields || []).map((f: Record<string, unknown>) => ({
          label: String(f.label ?? ""),
          fieldType: String(f.fieldType ?? ""),
          value: f.value ?? null,
          scope: String(f.scope ?? ""),
          stepName: (f.stepName as string | null) ?? null,
        })),
      );
    } catch {
      /* ignore */
    }
  }, [authHeaders, processId, token]);

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
        await Promise.all([
          loadProcess(),
          loadUpdates(),
          loadUsers(),
          loadActivity(),
          loadAttachments(),
          loadCustomFields(),
          markMentionsSeen(),
        ]);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Could not load.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    loadProcess,
    loadUpdates,
    loadUsers,
    loadActivity,
    loadAttachments,
    loadCustomFields,
    markMentionsSeen,
  ]);

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
        await Promise.all([loadProcess(), loadActivity()]);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not complete step.");
      }
    },
    [authHeaders, loadProcess, loadActivity],
  );

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setUploading(true);
      setFileErr(null);
      try {
        for (const f of files) {
          const fd = new FormData();
          fd.append("file", f);
          const res = await fetch(apiUrl(`/processes/${processId}/attachments`), {
            method: "POST",
            headers: { ...authHeaders() },
            body: fd,
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || `Upload failed for ${f.name}.`);
          }
        }
        await Promise.all([loadAttachments(), loadActivity()]);
      } catch (e) {
        setFileErr(e instanceof Error ? e.message : "Upload failed.");
      } finally {
        setUploading(false);
      }
    },
    [authHeaders, processId, loadAttachments, loadActivity],
  );

  const deleteAttachment = useCallback(
    async (attachmentId: number) => {
      setFileErr(null);
      try {
        const res = await fetch(
          apiUrl(`/processes/process-attachments/${attachmentId}`),
          { method: "DELETE", headers: { ...authHeaders() } },
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Could not delete file.");
        }
        await loadAttachments();
      } catch (e) {
        setFileErr(e instanceof Error ? e.message : "Could not delete file.");
      }
    },
    [authHeaders, loadAttachments],
  );

  const changeStage = useCallback(
    async (stageId: number) => {
      setStageBusy(true);
      setErr(null);
      try {
        const res = await fetch(apiUrl(`/processes/${processId}/stage`), {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ stageId }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Could not change stage.");
        }
        await Promise.all([loadProcess(), loadActivity()]);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not change stage.");
      } finally {
        setStageBusy(false);
      }
    },
    [authHeaders, processId, loadProcess, loadActivity],
  );

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

  const orderedStages = useMemo(
    () => [...stages].sort((a, b) => a.stageOrder - b.stageOrder),
    [stages],
  );

  const currentStageIdx = useMemo(() => {
    if (!process?.currentStageId) return 0;
    const i = orderedStages.findIndex((s) => s.id === process.currentStageId);
    return i >= 0 ? i : 0;
  }, [orderedStages, process?.currentStageId]);

  const currentStage = orderedStages[currentStageIdx] ?? null;
  const nextStage = orderedStages[currentStageIdx + 1] ?? null;

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

  const currentStageSteps = currentStage
    ? stepsByStage.get(currentStage.id) ?? []
    : [];
  const doneCount = currentStageSteps.filter(
    (s) => s.status === "completed" || s.status === "skipped",
  ).length;

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

  const upcoming = orderedStages.slice(currentStageIdx + 1, currentStageIdx + 3);

  return (
    <div data-pms className={styles.root}>
      <OperationsTopBar />

      {err ? <div className={styles.errBanner}>{err}</div> : null}

      {loading || !process ? (
        <div className={styles.loadingState}>Loading process…</div>
      ) : (
        <div className={styles.page}>
          {/* Header */}
          <div className={styles.header}>
            <Link href={`/operations/boards/${boardSlug}`} className={styles.backBtn} aria-label="Back to board">
              ←
            </Link>
            <div className={styles.headerText}>
              <div className={`${styles.eyebrow} pms-cond`}>
                {process.templateName || "PROCESS"} · Started {fmtDate(process.startedAt) ?? "—"}
              </div>
              <h1 className={`${styles.title} pms-cond`}>{process.name}</h1>
              <div className={styles.headerMeta}>
                {process.propertyName && <span>{process.propertyName}</span>}
                {process.contactName && (
                  <>
                    <span className={styles.dot}>·</span>
                    <span>
                      Contact: <b>{process.contactName}</b>
                    </span>
                  </>
                )}
              </div>
            </div>
            <div className={styles.headerActions}>
              {process.status === "active" && nextStage && (
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  disabled={stageBusy}
                  onClick={() => changeStage(nextStage.id)}
                  title={`Advance to ${nextStage.name}`}
                >
                  {stageBusy ? "Advancing…" : `Advance → ${nextStage.name}`}
                </button>
              )}
              <span className={`${styles.statusPill} ${statusToneClass(process.status, styles)}`}>
                {process.status}
              </span>
            </div>
          </div>

          {/* Stepper */}
          {orderedStages.length > 0 && (
            <div className={styles.stepper}>
              {orderedStages.map((s, i) => {
                const done = i < currentStageIdx || s.status === "completed";
                const current = i === currentStageIdx;
                const c = stageColor(s, i);
                return (
                  <div key={s.id} className={styles.stepperItem}>
                    <div className={styles.stepperNode}>
                      <div
                        className={styles.stepperCircle}
                        style={{
                          background: done || current ? c : "#fff",
                          color: done || current ? "#fff" : "var(--pms-ink-4)",
                          border: done || current ? "none" : "2px dashed var(--pms-line-2)",
                          boxShadow: current ? `0 0 0 4px ${c}33` : "none",
                        }}
                      >
                        {done ? "✓" : i + 1}
                      </div>
                      <div
                        className={`${styles.stepperLabel} pms-cond`}
                        style={{ color: current ? c : "var(--pms-ink-3)", fontWeight: current ? 800 : 600 }}
                      >
                        {s.name}
                      </div>
                    </div>
                    {i < orderedStages.length - 1 && (
                      <div
                        className={styles.stepperBar}
                        style={{ background: i < currentStageIdx ? c : "var(--pms-line)" }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className={styles.grid}>
            {/* Left: current stage card + what's next */}
            <div className={styles.leftCol}>
              <div className={styles.card}>
                <div
                  className={styles.stageCardHead}
                  style={{
                    borderLeft: `4px solid ${currentStage ? stageColor(currentStage, currentStageIdx) : "var(--pms-ink-4)"}`,
                  }}
                >
                  <span className={`${styles.stageEyebrow} pms-cond`}>CURRENT STAGE</span>
                  <h2
                    className={`${styles.stageName} pms-cond`}
                    style={{ color: currentStage ? stageColor(currentStage, currentStageIdx) : "var(--pms-ink)" }}
                  >
                    {currentStage?.name ?? "—"}
                  </h2>
                  <span className={styles.stageProgress}>
                    {doneCount} / {currentStageSteps.length} tasks
                  </span>
                </div>

                <div className={styles.tabBar}>
                  {(
                    [
                      { id: "tasks", label: "Tasks", count: currentStageSteps.length - doneCount },
                      { id: "activity", label: "Activity", count: activity.length },
                      { id: "files", label: "Files", count: attachments.length },
                      { id: "notes", label: "Notes", count: topLevel.length },
                    ] as Array<{ id: TabId; label: string; count: number }>
                  ).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`${styles.tab} ${activeTab === t.id ? styles.tabActive : ""}`}
                      onClick={() => setActiveTab(t.id)}
                    >
                      {t.label}
                      <span className={styles.tabCount}>{t.count}</span>
                      {activeTab === t.id && <span className={styles.tabUnderline} />}
                    </button>
                  ))}
                </div>

                <div className={styles.tabBody}>
                  {activeTab === "tasks" &&
                    (currentStageSteps.length === 0 ? (
                      <div className={styles.empty}>No tasks in this stage.</div>
                    ) : (
                      currentStageSteps.map((step) => (
                        <TaskRow
                          key={step.id}
                          step={step}
                          expanded={expandedStepId === step.id}
                          onToggle={() =>
                            setExpandedStepId((cur) => (cur === step.id ? null : step.id))
                          }
                          onComplete={() => completeStep(step.id)}
                        />
                      ))
                    ))}

                  {activeTab === "activity" &&
                    (activity.length === 0 ? (
                      <div className={styles.empty}>No activity recorded yet.</div>
                    ) : (
                      <div className={styles.activityList}>
                        {activity.map((a) => (
                          <div key={a.id} className={styles.activityRow}>
                            <div className={styles.activityDot} />
                            <div>
                              <div className={styles.activityText}>{a.description}</div>
                              <div className={styles.activityMeta}>
                                {a.actorName || a.actorType || "system"} · {relTime(a.createdAt)}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}

                  {activeTab === "files" && (
                    <>
                      <div className={styles.fileToolbar}>
                        <span className={styles.fileToolbarHint}>
                          Up to 25MB per file.
                        </span>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnLight}`}
                          disabled={uploading}
                          onClick={() => fileInputRef.current?.click()}
                        >
                          {uploading ? "Uploading…" : "Upload file"}
                        </button>
                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          hidden
                          onChange={(e) => {
                            const list = e.target.files
                              ? Array.from(e.target.files)
                              : [];
                            e.target.value = "";
                            void uploadFiles(list);
                          }}
                        />
                      </div>
                      {fileErr && <div className={styles.fileErr}>{fileErr}</div>}
                      {attachments.length === 0 ? (
                        <div className={styles.empty}>No files attached.</div>
                      ) : (
                        <div className={styles.fileGrid}>
                          {attachments.map((f) => (
                            <div key={f.id} className={styles.fileCard}>
                              <div className={styles.fileIcon}>📄</div>
                              <div className={styles.fileMeta}>
                                <div className={styles.fileName}>{f.filename}</div>
                                <div className={styles.fileSub}>
                                  {f.fileSize != null ? `${Math.round(f.fileSize / 1024)} KB · ` : ""}
                                  {fmtDate(f.createdAt)}
                                </div>
                              </div>
                              <button
                                type="button"
                                className={styles.fileDelete}
                                aria-label={`Delete ${f.filename}`}
                                title="Delete file"
                                onClick={() => deleteAttachment(f.id)}
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  {activeTab === "notes" && (
                    <div className={styles.notesWrap}>
                      <UpdateComposer
                        users={mentionUsers}
                        submitting={submitting}
                        errorText={composerErr}
                        onSubmit={postComment}
                      />
                      {topLevel.length === 0 ? (
                        <div className={styles.empty}>
                          No notes yet. Be the first to post.
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
                  )}
                </div>
              </div>

              {activeTab === "tasks" && upcoming.length > 0 && (
                <div className={styles.card}>
                  <div className={styles.cardHead}>What&rsquo;s next</div>
                  <div className={styles.nextList}>
                    {upcoming.map((s, i) => {
                      const idx = currentStageIdx + 1 + i;
                      const c = stageColor(s, idx);
                      const cnt = (stepsByStage.get(s.id) ?? []).length;
                      return (
                        <div
                          key={s.id}
                          className={styles.nextRow}
                          style={{ borderLeft: `4px solid ${c}` }}
                        >
                          <div className={`${styles.nextName} pms-cond`} style={{ color: c }}>
                            {s.name}
                          </div>
                          <div className={styles.nextSub}>{cnt} steps</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Right rail */}
            <div className={styles.rightCol}>
              <RailCard title="Property">
                <Field label="Address" value={process.propertyName} />
                <Field
                  label="Active processes"
                  value={process.templateName ? `1 (${process.templateName})` : "—"}
                />
              </RailCard>

              <RailCard title="People">
                {process.contactName && (
                  <div className={styles.person}>
                    <div className={styles.personRole}>CONTACT</div>
                    <div className={styles.personName}>{process.contactName}</div>
                    {(process.contactEmail || process.contactPhone) && (
                      <div className={styles.personSub}>
                        {process.contactEmail}
                        {process.contactEmail && process.contactPhone ? " · " : ""}
                        {process.contactPhone}
                      </div>
                    )}
                  </div>
                )}
                {!process.contactName && <div className={styles.empty}>No contact on file.</div>}
              </RailCard>

              <RailCard title="Custom Fields">
                {customFields.length === 0 ? (
                  <div className={styles.empty}>No custom field values.</div>
                ) : (
                  customFields.map((f, i) => (
                    <FieldRow
                      key={`${f.label}-${i}`}
                      label={f.stepName ? `${f.label} (${f.stepName})` : f.label}
                      value={renderCfValue(f.value)}
                    />
                  ))
                )}
              </RailCard>

              <RailCard title="Process Info">
                <FieldRow label="Template" value={process.templateName ?? "—"} />
                <FieldRow label="Status" value={process.status} />
                <FieldRow label="Started" value={fmtDate(process.startedAt) ?? "—"} />
                <FieldRow label="Target" value={fmtDate(process.targetCompletion) ?? "—"} />
                <FieldRow
                  label="Completed"
                  value={process.completedAt ? fmtDate(process.completedAt) ?? "—" : "—"}
                />
                {process.notes && (
                  <div className={styles.notesBlock}>{process.notes}</div>
                )}
              </RailCard>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function statusToneClass(status: string, s: Record<string, string>): string {
  const v = status.toLowerCase();
  if (v === "completed") return s.statusOk;
  if (v === "cancelled" || v === "canceled") return s.statusNeutral;
  if (v === "paused") return s.statusWarn;
  return s.statusActive;
}

function renderCfValue(v: unknown): string {
  if (v == null) return "—";
  if (Array.isArray(v)) return v.join(", ") || "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function TaskRow({
  step,
  expanded,
  onToggle,
  onComplete,
}: {
  step: Step;
  expanded: boolean;
  onToggle: () => void;
  onComplete: () => void;
}) {
  const done = step.status === "completed" || step.status === "skipped";
  const kindKey = (step.kind || step.taskType || "todo").toLowerCase();
  const m = KIND_META[kindKey] ?? KIND_META.todo;
  const isAuto = (step.actor || "manual") === "auto";
  return (
    <div className={styles.task}>
      <div className={styles.taskMain}>
        <button
          type="button"
          className={styles.taskCheck}
          style={{
            background: done ? "var(--pms-ok)" : "#fff",
            borderColor: done ? "var(--pms-ok)" : "var(--pms-line-2)",
          }}
          onClick={onComplete}
          disabled={done}
          aria-label={done ? "Completed" : "Mark complete"}
        >
          {done ? "✓" : ""}
        </button>
        <div className={styles.taskBody} onClick={onToggle} role="button" tabIndex={0}>
          <div className={styles.taskMeta}>
            <span
              className={`${styles.kindChip} pms-cond`}
              style={{ background: `${m.color}14`, color: m.color }}
            >
              {m.label}
            </span>
            {isAuto ? (
              <span className={`${styles.miniPill} ${styles.pillInfo}`}>AUTO</span>
            ) : (
              <span className={`${styles.miniPill} ${styles.pillNeutral}`}>
                {step.assignedRole || "MANUAL"}
              </span>
            )}
            {step.whenText && <span className={styles.whenText}>· {step.whenText}</span>}
          </div>
          <div
            className={styles.taskName}
            style={{
              textDecoration: done ? "line-through" : "none",
              color: done ? "var(--pms-ink-3)" : "var(--pms-ink)",
            }}
          >
            {step.name}
          </div>
        </div>
        <button type="button" className={styles.taskExpand} onClick={onToggle}>
          {expanded ? "▾" : "▸"}
        </button>
      </div>
      {expanded && <StepInstructions step={step} />}
    </div>
  );
}

function RailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={styles.card}>
      <div className={`${styles.railHead} pms-cond`}>{title}</div>
      <div className={styles.railBody}>{children}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={styles.fieldValue}>{value || "—"}</span>
    </div>
  );
}

function FieldRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className={styles.fieldRow}>
      <span className={styles.fieldRowLabel}>{label}</span>
      <span className={styles.fieldRowValue}>{value || "—"}</span>
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
    kind: (s.kind as string | null) ?? null,
    actor: (s.actor as string | null) ?? null,
    whenText: (s.whenText as string | null) ?? null,
    dayOffset: typeof s.dayOffset === "number" ? s.dayOffset : null,
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
