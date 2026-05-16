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
  ChevronUp,
  ChevronDown,
  Pencil,
  X,
  Save,
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

interface NamedTpl {
  id: number;
  name: string;
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

const ALL_KINDS: StepKind[] = ["todo", "email", "text", "call", "meet", "branch", "stagechange"];

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

const CATEGORY_ORDER = STAGE_GROUPS.map((g) => g.category);

const STAGE_FALLBACK_COLORS = [
  "var(--pms-stg-1)",
  "var(--pms-stg-2)",
  "var(--pms-stg-3)",
  "var(--pms-stg-4)",
  "var(--pms-stg-5)",
  "var(--pms-stg-6)",
];

// Concrete hexes for the stage color picker (the CSS-var palette
// resolved — the API only accepts #rrggbb).
const COLOR_SWATCHES = [
  "#E26B2B",
  "#D89A2F",
  "#B7A12E",
  "#7E9E32",
  "#3D8C49",
  "#2D7A6C",
  "#1E7B45",
  "#C04132",
  "#5468A0",
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
  const [emailTpls, setEmailTpls] = useState<NamedTpl[]>([]);
  const [textTpls, setTextTpls] = useState<NamedTpl[]>([]);
  const [selectedStageId, setSelectedStageId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Inline-edit UI state
  const [editingStepId, setEditingStepId] = useState<number | null>(null);
  const [editingStageId, setEditingStageId] = useState<number | null>(null);
  const [addStageCat, setAddStageCat] = useState<string | null>(null);
  const [newStageName, setNewStageName] = useState("");
  const [addStepOpen, setAddStepOpen] = useState(false);

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

      const [stRes, spRes, emRes, txRes] = await Promise.all([
        fetch(apiUrl(`/processes/templates/${tpl.id}/stages`), {
          headers: { ...authHeaders() },
          cache: "no-store",
        }),
        fetch(apiUrl(`/processes/templates/${tpl.id}/steps`), {
          headers: { ...authHeaders() },
          cache: "no-store",
        }),
        fetch(apiUrl(`/processes/templates/${tpl.id}/email-templates`), {
          headers: { ...authHeaders() },
          cache: "no-store",
        }).catch(() => null),
        fetch(apiUrl(`/processes/templates/${tpl.id}/text-templates`), {
          headers: { ...authHeaders() },
          cache: "no-store",
        }).catch(() => null),
      ]);
      const stBody = stRes.ok ? await stRes.json() : { stages: [] };
      const spBody = spRes.ok ? await spRes.json() : { steps: [] };
      const emBody = emRes && emRes.ok ? await emRes.json() : { templates: [] };
      const txBody = txRes && txRes.ok ? await txRes.json() : { templates: [] };

      setStages(
        (stBody.stages || []).map((s: Record<string, unknown>) => ({
          id: Number(s.id),
          name: String(s.name ?? ""),
          color: (s.color as string | null) ?? null,
          category: String(s.category ?? "active"),
          stageOrder: Number(s.stageOrder ?? 0),
        }))
      );
      setSteps(
        (spBody.steps || []).map((s: Record<string, unknown>) => ({
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
        }))
      );
      const mapNamed = (b: { templates?: Record<string, unknown>[] }): NamedTpl[] =>
        (b.templates || []).map((t) => ({ id: Number(t.id), name: String(t.name ?? "") }));
      setEmailTpls(mapNamed(emBody));
      setTextTpls(mapNamed(txBody));

      setStages((cur) => {
        setSelectedStageId((sel) =>
          sel && cur.some((s) => s.id === sel) ? sel : cur[0]?.id ?? null
        );
        return cur;
      });
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

  // Global stage order: category group order, then stageOrder within.
  const orderedStages = useMemo(() => {
    return [...stages].sort((a, b) => {
      const ca = CATEGORY_ORDER.indexOf(a.category);
      const cb = CATEGORY_ORDER.indexOf(b.category);
      if (ca !== cb) return ca - cb;
      return a.stageOrder - b.stageOrder;
    });
  }, [stages]);

  async function api(path: string, method: string, body?: unknown): Promise<unknown> {
    const res = await fetch(apiUrl(path), {
      method,
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error((b as { error?: string }).error || `Request failed (${res.status}).`);
    }
    return res.json().catch(() => ({}));
  }

  async function addStageInline(category: string) {
    if (!template || busy || !newStageName.trim()) return;
    setBusy(true);
    try {
      const b = (await api(`/processes/templates/${template.id}/stages`, "POST", {
        name: newStageName.trim(),
        category,
      })) as { stage?: { id?: number } };
      setAddStageCat(null);
      setNewStageName("");
      await load();
      if (b.stage?.id) setSelectedStageId(Number(b.stage.id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create stage.");
    } finally {
      setBusy(false);
    }
  }

  async function saveStage(stageId: number, patch: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/processes/template-stages/${stageId}`, "PUT", patch);
      setEditingStageId(null);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not update stage.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteStage(stageId: number) {
    if (busy || !window.confirm("Delete this stage? Its steps lose their stage link.")) return;
    setBusy(true);
    try {
      await api(`/processes/template-stages/${stageId}`, "DELETE");
      setEditingStageId(null);
      if (selectedStageId === stageId) setSelectedStageId(null);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not delete stage.");
    } finally {
      setBusy(false);
    }
  }

  async function reorderStage(stageId: number, dir: -1 | 1) {
    if (!template || busy) return;
    const stage = stages.find((s) => s.id === stageId);
    if (!stage) return;
    const siblings = orderedStages.filter((s) => s.category === stage.category);
    const idx = siblings.findIndex((s) => s.id === stageId);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= siblings.length) return;
    const reordered = [...siblings];
    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
    // Rebuild the full global stage id list with this category reordered.
    const fullOrder: number[] = [];
    for (const cat of CATEGORY_ORDER) {
      if (cat === stage.category) {
        fullOrder.push(...reordered.map((s) => s.id));
      } else {
        fullOrder.push(
          ...orderedStages.filter((s) => s.category === cat).map((s) => s.id)
        );
      }
    }
    setBusy(true);
    try {
      await api(`/processes/templates/${template.id}/stages/reorder`, "PUT", {
        stageIds: fullOrder,
      });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not reorder stage.");
    } finally {
      setBusy(false);
    }
  }

  async function addStepInline(kind: StepKind, name: string) {
    if (!template || !selectedStage || busy || !name.trim()) return;
    setBusy(true);
    try {
      await api(`/processes/templates/${template.id}/steps`, "POST", {
        name: name.trim(),
        stageId: selectedStage.id,
        kind,
        actor:
          kind === "email" || kind === "text" || kind === "stagechange"
            ? "auto"
            : "manual",
      });
      setAddStepOpen(false);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create step.");
    } finally {
      setBusy(false);
    }
  }

  async function saveStep(stepId: number, patch: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/processes/template-steps/${stepId}`, "PUT", patch);
      setEditingStepId(null);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not update step.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteStep(stepId: number) {
    if (busy || !window.confirm("Delete this workflow step?")) return;
    setBusy(true);
    try {
      await api(`/processes/template-steps/${stepId}`, "DELETE");
      setSteps((cur) => cur.filter((s) => s.id !== stepId));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not delete step.");
    } finally {
      setBusy(false);
    }
  }

  async function reorderStep(stepId: number, dir: -1 | 1) {
    if (!template || busy) return;
    const idx = stageSteps.findIndex((s) => s.id === stepId);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= stageSteps.length) return;
    const reordered = [...stageSteps];
    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
    // Build the full global step id list so other stages keep their order.
    const fullOrder: number[] = [];
    for (const st of orderedStages) {
      if (st.id === selectedStageId) {
        fullOrder.push(...reordered.map((s) => s.id));
      } else {
        fullOrder.push(
          ...steps
            .filter((s) => s.stageId === st.id)
            .sort((a, b) => a.stepNumber - b.stepNumber)
            .map((s) => s.id)
        );
      }
    }
    // Unstaged steps last (preserve their order).
    fullOrder.push(
      ...steps
        .filter((s) => s.stageId == null)
        .sort((a, b) => a.stepNumber - b.stepNumber)
        .map((s) => s.id)
    );
    setBusy(true);
    try {
      await api(`/processes/templates/${template.id}/steps/reorder`, "PUT", {
        stepIds: fullOrder,
      });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not reorder step.");
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
            const items = orderedStages.filter(
              (s) => (s.category || "active") === g.category
            );
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
                      onClick={() => {
                        setAddStageCat((c) => (c === g.category ? null : g.category));
                        setNewStageName("");
                      }}
                      disabled={busy}
                      title={`Add ${g.title.toLowerCase()}`}
                    >
                      <Plus size={13} />
                    </button>
                  )}
                </div>
                <div className={styles.stageGroupHelp}>{g.help}</div>

                {isAdmin && addStageCat === g.category && (
                  <div className={styles.inlineAdd}>
                    <input
                      autoFocus
                      className={styles.inlineInput}
                      placeholder="Stage name…"
                      value={newStageName}
                      onChange={(e) => setNewStageName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") addStageInline(g.category);
                        if (e.key === "Escape") setAddStageCat(null);
                      }}
                    />
                    <button
                      type="button"
                      className={styles.miniPrimary}
                      onClick={() => addStageInline(g.category)}
                      disabled={busy || !newStageName.trim()}
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      className={styles.miniGhost}
                      onClick={() => setAddStageCat(null)}
                    >
                      <X size={13} />
                    </button>
                  </div>
                )}

                {items.length === 0 ? (
                  <div className={styles.stageEmpty}>No stages yet.</div>
                ) : (
                  <div className={styles.stageItems}>
                    {items.map((s, i) => {
                      const c = stageColor(s, i);
                      const count = steps.filter((st) => st.stageId === s.id).length;
                      const active = s.id === selectedStageId;
                      const isEditing = editingStageId === s.id;
                      return (
                        <div key={s.id}>
                          <div
                            className={styles.stageChip}
                            style={{
                              background: c,
                              boxShadow: active
                                ? `0 0 0 3px ${c}55, 0 4px 10px rgba(0,0,0,.10)`
                                : "0 1px 2px rgba(0,0,0,.06)",
                            }}
                            onClick={() => setSelectedStageId(s.id)}
                            role="button"
                            tabIndex={0}
                          >
                            <span className={`${styles.stageChipName} pms-cond`}>{s.name}</span>
                            {isAdmin && (
                              <span className={styles.stageChipCtl}>
                                <button
                                  type="button"
                                  className={styles.chipBtn}
                                  disabled={busy || i === 0}
                                  title="Move up"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    reorderStage(s.id, -1);
                                  }}
                                >
                                  <ChevronUp size={13} />
                                </button>
                                <button
                                  type="button"
                                  className={styles.chipBtn}
                                  disabled={busy || i === items.length - 1}
                                  title="Move down"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    reorderStage(s.id, 1);
                                  }}
                                >
                                  <ChevronDown size={13} />
                                </button>
                                <button
                                  type="button"
                                  className={styles.chipBtn}
                                  title="Edit stage"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingStageId((cur) => (cur === s.id ? null : s.id));
                                  }}
                                >
                                  <Pencil size={13} />
                                </button>
                              </span>
                            )}
                            <span className={styles.stageStat}>
                              <span className={`${styles.stageStatN} pms-cond`}>{count}</span>
                              <span className={styles.stageStatU}>steps</span>
                            </span>
                          </div>
                          {isAdmin && isEditing && (
                            <StageEditor
                              stage={s}
                              busy={busy}
                              onSave={(patch) => saveStage(s.id, patch)}
                              onDelete={() => deleteStage(s.id)}
                              onCancel={() => setEditingStageId(null)}
                            />
                          )}
                        </div>
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

                {stageSteps.map((step, i) => (
                  <WorkflowStepRow
                    key={step.id}
                    step={step}
                    canEdit={isAdmin}
                    isFirst={i === 0}
                    isLast={i === stageSteps.length - 1}
                    editing={editingStepId === step.id}
                    busy={busy}
                    emailTpls={emailTpls}
                    textTpls={textTpls}
                    onToggleEdit={() =>
                      setEditingStepId((cur) => (cur === step.id ? null : step.id))
                    }
                    onSave={(patch) => saveStep(step.id, patch)}
                    onDelete={() => deleteStep(step.id)}
                    onMove={(dir) => reorderStep(step.id, dir)}
                  />
                ))}

                {stageSteps.length === 0 && (
                  <div className={styles.noSteps}>No steps in this stage yet.</div>
                )}

                {isAdmin &&
                  (addStepOpen ? (
                    <AddStepForm
                      busy={busy}
                      onAdd={addStepInline}
                      onCancel={() => setAddStepOpen(false)}
                    />
                  ) : (
                    <div className={styles.addStepRow}>
                      <button
                        type="button"
                        className={styles.addStepBtn}
                        onClick={() => setAddStepOpen(true)}
                        disabled={busy}
                      >
                        <Plus size={13} /> Add step
                      </button>
                    </div>
                  ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StageEditor({
  stage,
  busy,
  onSave,
  onDelete,
  onCancel,
}: {
  stage: Stage;
  busy: boolean;
  onSave: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(stage.name);
  const [color, setColor] = useState(
    stage.color && stage.color.startsWith("#") ? stage.color : COLOR_SWATCHES[0]
  );
  const [category, setCategory] = useState(stage.category);
  return (
    <div className={styles.editor}>
      <label className={styles.editorLabel}>Name</label>
      <input
        className={styles.inlineInput}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <label className={styles.editorLabel}>Color</label>
      <div className={styles.swatchRow}>
        {COLOR_SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            className={styles.swatch}
            style={{
              background: c,
              outline: c === color ? "2px solid var(--pms-ink)" : "none",
            }}
            onClick={() => setColor(c)}
            aria-label={c}
          />
        ))}
      </div>
      <label className={styles.editorLabel}>Group</label>
      <select
        className={styles.inlineSelect}
        value={category}
        onChange={(e) => setCategory(e.target.value)}
      >
        {STAGE_GROUPS.map((g) => (
          <option key={g.category} value={g.category}>
            {g.title}
          </option>
        ))}
      </select>
      <div className={styles.editorActions}>
        <button
          type="button"
          className={styles.miniPrimary}
          disabled={busy || !name.trim()}
          onClick={() => onSave({ name: name.trim(), color, category })}
        >
          <Save size={12} /> Save
        </button>
        <button type="button" className={styles.miniGhost} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={styles.miniDanger}
          disabled={busy}
          onClick={onDelete}
        >
          <Trash2 size={12} /> Delete
        </button>
      </div>
    </div>
  );
}

function AddStepForm({
  busy,
  onAdd,
  onCancel,
}: {
  busy: boolean;
  onAdd: (kind: StepKind, name: string) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<StepKind>("todo");
  const [name, setName] = useState("");
  return (
    <div className={styles.editor}>
      <label className={styles.editorLabel}>Step type</label>
      <select
        className={styles.inlineSelect}
        value={kind}
        onChange={(e) => setKind(e.target.value as StepKind)}
      >
        {ALL_KINDS.map((k) => (
          <option key={k} value={k}>
            {KIND_META[k].label}
          </option>
        ))}
      </select>
      <label className={styles.editorLabel}>Description</label>
      <input
        autoFocus
        className={styles.inlineInput}
        placeholder="What should happen…"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onAdd(kind, name);
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className={styles.editorActions}>
        <button
          type="button"
          className={styles.miniPrimary}
          disabled={busy || !name.trim()}
          onClick={() => onAdd(kind, name)}
        >
          <Plus size={12} /> Add step
        </button>
        <button type="button" className={styles.miniGhost} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function WorkflowStepRow({
  step,
  canEdit,
  isFirst,
  isLast,
  editing,
  busy,
  emailTpls,
  textTpls,
  onToggleEdit,
  onSave,
  onDelete,
  onMove,
}: {
  step: Step;
  canEdit: boolean;
  isFirst: boolean;
  isLast: boolean;
  editing: boolean;
  busy: boolean;
  emailTpls: NamedTpl[];
  textTpls: NamedTpl[];
  onToggleEdit: () => void;
  onSave: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const m = KIND_META[step.kind] ?? KIND_META.todo;
  const Icon = m.icon;
  const isAuto = step.actor === "auto";

  const [name, setName] = useState(step.name);
  const [kind, setKind] = useState<StepKind>(step.kind);
  const [actor, setActor] = useState<"auto" | "manual">(step.actor);
  const [whenText, setWhenText] = useState(step.whenText ?? "");
  const [dayOffset, setDayOffset] = useState(
    step.dayOffset != null ? String(step.dayOffset) : ""
  );
  const [role, setRole] = useState(step.assignedRole ?? "");
  const [emailTemplateId, setEmailTemplateId] = useState(step.emailTemplateId ?? 0);
  const [textTemplateId, setTextTemplateId] = useState(step.textTemplateId ?? 0);

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
      <div className={styles.stepCardWrap}>
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
            <div className={styles.stepCtl}>
              <button
                type="button"
                className={styles.chipBtnDark}
                disabled={busy || isFirst}
                title="Move up"
                onClick={() => onMove(-1)}
              >
                <ChevronUp size={13} />
              </button>
              <button
                type="button"
                className={styles.chipBtnDark}
                disabled={busy || isLast}
                title="Move down"
                onClick={() => onMove(1)}
              >
                <ChevronDown size={13} />
              </button>
              <button
                type="button"
                className={styles.chipBtnDark}
                title="Edit step"
                onClick={onToggleEdit}
              >
                <Pencil size={13} />
              </button>
              <button
                type="button"
                className={styles.stepDelete}
                onClick={onDelete}
                title="Delete step"
              >
                <Trash2 size={13} />
              </button>
            </div>
          )}
        </div>

        {canEdit && editing && (
          <div className={styles.editor}>
            <label className={styles.editorLabel}>Description</label>
            <input
              className={styles.inlineInput}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div className={styles.editorGrid}>
              <div>
                <label className={styles.editorLabel}>Type</label>
                <select
                  className={styles.inlineSelect}
                  value={kind}
                  onChange={(e) => setKind(e.target.value as StepKind)}
                >
                  {ALL_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_META[k].label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={styles.editorLabel}>Actor</label>
                <select
                  className={styles.inlineSelect}
                  value={actor}
                  onChange={(e) => setActor(e.target.value as "auto" | "manual")}
                >
                  <option value="manual">Manual</option>
                  <option value="auto">Auto</option>
                </select>
              </div>
              <div>
                <label className={styles.editorLabel}>When</label>
                <input
                  className={styles.inlineInput}
                  placeholder="e.g. immediately"
                  value={whenText}
                  onChange={(e) => setWhenText(e.target.value)}
                />
              </div>
              <div>
                <label className={styles.editorLabel}>Day</label>
                <input
                  className={styles.inlineInput}
                  type="number"
                  value={dayOffset}
                  onChange={(e) => setDayOffset(e.target.value)}
                />
              </div>
            </div>
            {actor === "manual" && (
              <>
                <label className={styles.editorLabel}>Assigned role</label>
                <input
                  className={styles.inlineInput}
                  placeholder="e.g. PM"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                />
              </>
            )}
            {kind === "email" && (
              <>
                <label className={styles.editorLabel}>Email template</label>
                <select
                  className={styles.inlineSelect}
                  value={emailTemplateId}
                  onChange={(e) => setEmailTemplateId(Number(e.target.value))}
                >
                  <option value={0}>— none —</option>
                  {emailTpls.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </>
            )}
            {kind === "text" && (
              <>
                <label className={styles.editorLabel}>Text template</label>
                <select
                  className={styles.inlineSelect}
                  value={textTemplateId}
                  onChange={(e) => setTextTemplateId(Number(e.target.value))}
                >
                  <option value={0}>— none —</option>
                  {textTpls.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </>
            )}
            <div className={styles.editorActions}>
              <button
                type="button"
                className={styles.miniPrimary}
                disabled={busy || !name.trim()}
                onClick={() =>
                  onSave({
                    name: name.trim(),
                    kind,
                    actor,
                    whenText: whenText.trim() || null,
                    dayOffset: dayOffset === "" ? null : Number(dayOffset),
                    assignedRole: actor === "manual" ? role.trim() || null : null,
                    emailTemplateId: kind === "email" ? emailTemplateId || null : null,
                    textTemplateId: kind === "text" ? textTemplateId || null : null,
                  })
                }
              >
                <Save size={12} /> Save
              </button>
              <button type="button" className={styles.miniGhost} onClick={onToggleEdit}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
