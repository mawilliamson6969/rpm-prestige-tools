"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Hand,
  Mail,
  MessageSquare,
  Phone,
  Calendar,
  Shuffle,
  GitBranch,
  ArrowRight,
  Plus,
  Trash2,
  Bot,
  User,
  FileText,
  Check,
  type LucideIcon,
} from "lucide-react";
import { apiUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import styles from "./stages-workflows.module.css";

type StepKind = "todo" | "email" | "text" | "call" | "meet" | "stagechange" | "branch" | "exit";

interface Template {
  id: number;
  name: string;
  slug: string | null;
  color: string | null;
}

interface Stage {
  id: number;
  name: string;
  color: string | null;
  category: string;
  stageOrder: number;
}

interface Step {
  id: number;
  stepNumber: number;
  name: string;
  stageId: number | null;
  kind: StepKind;
  actor: "auto" | "manual";
  whenText: string | null;
  dayOffset: number | null;
  assignedRole: string | null;
  emailTemplateId: number | null;
  textTemplateId: number | null;
}

const KIND_META: Record<StepKind, { icon: LucideIcon; color: string; label: string }> = {
  todo: { icon: Hand, color: "#0C5A8A", label: "TODO" },
  email: { icon: Mail, color: "#0098D0", label: "EMAIL" },
  text: { icon: MessageSquare, color: "#7E4FBF", label: "TEXT" },
  call: { icon: Phone, color: "#1E7B45", label: "CALL" },
  meet: { icon: Calendar, color: "#D89A2F", label: "MEETING" },
  stagechange: { icon: Shuffle, color: "#B32317", label: "STAGE CHANGE" },
  branch: { icon: GitBranch, color: "#6A737B", label: "BRANCH" },
  exit: { icon: ArrowRight, color: "#8A91A6", label: "EXIT" },
};

const ADD_KINDS: StepKind[] = ["todo", "email", "text", "call", "meet", "branch", "stagechange"];

const STAGE_GROUPS: Array<{ category: string; title: string; color: string; help: string }> = [
  {
    category: "backlog",
    title: "Backlog Stages",
    color: "var(--pms-stg-backlog)",
    help: "Milestones before the process becomes active.",
  },
  {
    category: "active",
    title: "Active Stages",
    color: "var(--pms-stg-1)",
    help: "Stages for processes you are actively working on.",
  },
  {
    category: "completed",
    title: "Completed Stages",
    color: "var(--pms-stg-done)",
    help: "Successful end states.",
  },
  {
    category: "cancelled",
    title: "Canceled Stages",
    color: "var(--pms-stg-cancel)",
    help: "Failure or skipped end states.",
  },
];

const STAGE_FALLBACK_COLORS = [
  "var(--pms-stg-1)",
  "var(--pms-stg-2)",
  "var(--pms-stg-3)",
  "var(--pms-stg-4)",
  "var(--pms-stg-5)",
  "var(--pms-stg-6)",
];

function stageColor(s: Stage, idx: number): string {
  if (s.color && s.color.startsWith("#")) return s.color;
  return STAGE_FALLBACK_COLORS[idx % STAGE_FALLBACK_COLORS.length];
}

export default function StagesWorkflowsClient({ slug }: { slug: string }) {
  const { authHeaders, token, isAdmin } = useAuth();
  const [template, setTemplate] = useState<Template | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [selectedStageId, setSelectedStageId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const tRes = await fetch(apiUrl("/processes/templates"), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!tRes.ok) throw new Error("Could not load templates.");
      const tBody = await tRes.json();
      const match = (tBody.templates || []).find(
        (t: Record<string, unknown>) => t.slug === slug
      );
      if (!match) throw new Error(`No process template matches "${slug}".`);
      const tpl: Template = {
        id: Number(match.id),
        name: String(match.name ?? ""),
        slug: (match.slug as string | null) ?? null,
        color: (match.color as string | null) ?? null,
      };
      setTemplate(tpl);

      const [stRes, spRes] = await Promise.all([
        fetch(apiUrl(`/processes/templates/${tpl.id}/stages`), {
          headers: { ...authHeaders() },
          cache: "no-store",
        }),
        fetch(apiUrl(`/processes/templates/${tpl.id}/steps`), {
          headers: { ...authHeaders() },
          cache: "no-store",
        }),
      ]);
      const stBody = stRes.ok ? await stRes.json() : { stages: [] };
      const spBody = spRes.ok ? await spRes.json() : { steps: [] };
      const loadedStages: Stage[] = (stBody.stages || []).map(
        (s: Record<string, unknown>) => ({
          id: Number(s.id),
          name: String(s.name ?? ""),
          color: (s.color as string | null) ?? null,
          category: String(s.category ?? "active"),
          stageOrder: Number(s.stageOrder ?? 0),
        })
      );
      const loadedSteps: Step[] = (spBody.steps || []).map(
        (s: Record<string, unknown>) => ({
          id: Number(s.id),
          stepNumber: Number(s.stepNumber ?? 0),
          name: String(s.name ?? ""),
          stageId: s.stageId != null ? Number(s.stageId) : null,
          kind: ((s.kind as StepKind) ?? "todo") as StepKind,
          actor: (s.actor as "auto" | "manual") ?? "manual",
          whenText: (s.whenText as string | null) ?? null,
          dayOffset: s.dayOffset != null ? Number(s.dayOffset) : null,
          assignedRole: (s.assignedRole as string | null) ?? null,
          emailTemplateId: s.emailTemplateId != null ? Number(s.emailTemplateId) : null,
          textTemplateId: s.textTemplateId != null ? Number(s.textTemplateId) : null,
        })
      );
      setStages(loadedStages);
      setSteps(loadedSteps);
      setSelectedStageId((cur) =>
        cur && loadedStages.some((s) => s.id === cur)
          ? cur
          : loadedStages[0]?.id ?? null
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load stages.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, slug, token]);

  useEffect(() => {
    load();
  }, [load]);

  const selectedStage = useMemo(
    () => stages.find((s) => s.id === selectedStageId) ?? null,
    [stages, selectedStageId]
  );
  const selectedStageIdx = useMemo(
    () => stages.findIndex((s) => s.id === selectedStageId),
    [stages, selectedStageId]
  );
  const stageSteps = useMemo(
    () =>
      steps
        .filter((s) => s.stageId === selectedStageId)
        .sort((a, b) => a.stepNumber - b.stepNumber),
    [steps, selectedStageId]
  );

  async function addStage(category: string) {
    if (!template || busy) return;
    const name = window.prompt(`New ${category} stage name:`);
    if (!name || !name.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(apiUrl(`/processes/templates/${template.id}/stages`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name: name.trim(), category }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || "Could not create stage.");
      }
      const b = await res.json();
      const newId = b.stage?.id;
      await load();
      if (newId) setSelectedStageId(Number(newId));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create stage.");
    } finally {
      setBusy(false);
    }
  }

  async function addStep(kind: StepKind) {
    if (!template || !selectedStage || busy) return;
    const name = window.prompt(`New ${KIND_META[kind].label} step description:`);
    if (!name || !name.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(apiUrl(`/processes/templates/${template.id}/steps`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          name: name.trim(),
          stageId: selectedStage.id,
          kind,
          actor: kind === "email" || kind === "text" || kind === "stagechange" ? "auto" : "manual",
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || "Could not create step.");
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create step.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteStep(stepId: number) {
    if (busy || !window.confirm("Delete this workflow step?")) return;
    setBusy(true);
    try {
      const res = await fetch(apiUrl(`/processes/template-steps/${stepId}`), {
        method: "DELETE",
        headers: { ...authHeaders() },
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || "Could not delete step.");
      }
      setSteps((cur) => cur.filter((s) => s.id !== stepId));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not delete step.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div data-pms className={styles.loading}>Loading stages &amp; workflows…</div>;
  }

  return (
    <div data-pms className={styles.root}>
      <div className={styles.header}>
        <div>
          <div className={`${styles.eyebrow} pms-cond`}>
            {template ? template.name : slug}
          </div>
          <h1 className={`${styles.title} pms-cond`}>Stages &amp; Workflows</h1>
          <p className={styles.sub}>
            Stages are the milestones of your process. Workflows inside a stage are the steps
            (todos, emails, texts, calls, meetings, stage changes) that should happen there.
          </p>
        </div>
      </div>

      {err && <div className={styles.err}>{err}</div>}

      <div className={styles.split}>
        {/* Left rail — stage groups */}
        <div className={styles.stageList}>
          {STAGE_GROUPS.map((g) => {
            const items = stages
              .filter((s) => (s.category || "active") === g.category)
              .sort((a, b) => a.stageOrder - b.stageOrder);
            return (
              <div key={g.category} className={styles.stageGroup}>
                <div className={styles.stageGroupHead}>
                  <span className={`${styles.stageGroupTitle} pms-cond`} style={{ color: g.color }}>
                    {g.title}
                  </span>
                  {isAdmin && (
                    <button
                      type="button"
                      className={styles.addStageBtn}
                      style={{ background: g.color }}
                      onClick={() => addStage(g.category)}
                      disabled={busy}
                      title={`Add ${g.title.toLowerCase()}`}
                    >
                      <Plus size={13} />
                    </button>
                  )}
                </div>
                <div className={styles.stageGroupHelp}>{g.help}</div>
                {items.length === 0 ? (
                  <div className={styles.stageEmpty}>No stages yet.</div>
                ) : (
                  <div className={styles.stageItems}>
                    {items.map((s, i) => {
                      const c = stageColor(s, i);
                      const count = steps.filter((st) => st.stageId === s.id).length;
                      const active = s.id === selectedStageId;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          className={styles.stageChip}
                          style={{
                            background: c,
                            boxShadow: active
                              ? `0 0 0 3px ${c}55, 0 4px 10px rgba(0,0,0,.10)`
                              : "0 1px 2px rgba(0,0,0,.06)",
                          }}
                          onClick={() => setSelectedStageId(s.id)}
                        >
                          <span className={`${styles.stageChipName} pms-cond`}>{s.name}</span>
                          <span className={styles.stageStat}>
                            <span className={`${styles.stageStatN} pms-cond`}>{count}</span>
                            <span className={styles.stageStatU}>steps</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Right pane — workflow timeline */}
        <div className={styles.workflowPanel}>
          {!selectedStage ? (
            <div className={styles.workflowEmpty}>
              Select a stage on the left to see its workflow.
            </div>
          ) : (
            <>
              <div
                className={styles.workflowHead}
                style={{ borderLeft: `4px solid ${stageColor(selectedStage, selectedStageIdx)}` }}
              >
                <div
                  className={styles.workflowHeadBar}
                  style={{ background: stageColor(selectedStage, selectedStageIdx) }}
                />
                <h2
                  className={`${styles.workflowTitle} pms-cond`}
                  style={{ color: stageColor(selectedStage, selectedStageIdx) }}
                >
                  {selectedStage.name}
                </h2>
                <span className={styles.workflowCount}>
                  {stageSteps.length} {stageSteps.length === 1 ? "step" : "steps"}
                </span>
              </div>

              <div className={styles.timeline}>
                <div className={styles.enterBanner}>
                  <div
                    className={styles.enterIcon}
                    style={{ background: stageColor(selectedStage, selectedStageIdx) }}
                  >
                    <ArrowRight size={16} color="#fff" />
                  </div>
                  <span>
                    Process enters stage{" "}
                    <b style={{ color: stageColor(selectedStage, selectedStageIdx) }}>
                      {selectedStage.name}
                    </b>
                    .
                  </span>
                </div>

                {stageSteps.map((step) => (
                  <WorkflowStepRow
                    key={step.id}
                    step={step}
                    canEdit={isAdmin}
                    onDelete={() => deleteStep(step.id)}
                  />
                ))}

                {stageSteps.length === 0 && (
                  <div className={styles.noSteps}>No steps in this stage yet.</div>
                )}

                {isAdmin && (
                  <div className={styles.addStepRow}>
                    <span className={styles.addStepLabel}>Add step:</span>
                    {ADD_KINDS.map((k) => {
                      const m = KIND_META[k];
                      const Icon = m.icon;
                      return (
                        <button
                          key={k}
                          type="button"
                          className={styles.addStepBtn}
                          onClick={() => addStep(k)}
                          disabled={busy}
                        >
                          <Icon size={13} color={m.color} />
                          {m.label.charAt(0) + m.label.slice(1).toLowerCase()}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function WorkflowStepRow({
  step,
  canEdit,
  onDelete,
}: {
  step: Step;
  canEdit: boolean;
  onDelete: () => void;
}) {
  const m = KIND_META[step.kind] ?? KIND_META.todo;
  const Icon = m.icon;
  const isAuto = step.actor === "auto";
  return (
    <div className={styles.tlRow}>
      <div className={styles.tlWhen}>
        {step.whenText && <div>{step.whenText}</div>}
        {step.dayOffset != null && (
          <div className={`${styles.tlDay} pms-mono`}>day {step.dayOffset}</div>
        )}
      </div>
      <div className={styles.tlRail}>
        <span className={styles.tlRailLine} />
      </div>
      <div className={styles.stepCard}>
        <div className={styles.stepBubble} style={{ background: `${m.color}22`, color: m.color }}>
          <Check size={14} />
        </div>
        <div className={styles.stepBody}>
          <div className={styles.stepMeta}>
            <span
              className={`${styles.kindChip} pms-cond`}
              style={{ background: `${m.color}14`, color: m.color }}
            >
              <Icon size={11} /> {m.label}
            </span>
            {isAuto ? (
              <span className={`${styles.pill} ${styles.pillInfo}`}>
                <Bot size={11} /> AUTO
              </span>
            ) : (
              <span className={`${styles.pill} ${styles.pillNeutral}`}>
                <User size={11} /> MANUAL{step.assignedRole ? ` · ${step.assignedRole}` : ""}
              </span>
            )}
            {(step.emailTemplateId != null || step.textTemplateId != null) && (
              <span className={styles.tplRef}>
                <FileText size={11} /> template linked
              </span>
            )}
          </div>
          <div className={styles.stepName}>{step.name}</div>
        </div>
        {canEdit && (
          <button
            type="button"
            className={styles.stepDelete}
            onClick={onDelete}
            title="Delete step"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
