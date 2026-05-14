"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import operationsStyles from "../../../operations.module.css";
import renewalsStyles from "../../renewals/renewals.module.css";
import customizationStyles from "../../components/customization.module.css";
import subitemStyles from "../../components/subitems/subitems.module.css";
import OperationsTopBar from "../../../OperationsTopBar";
import ConfirmDialog from "../../components/ConfirmDialog";
import {
  CompletionChecklistPanel,
  DecisionMatrixPanel,
  EmailTemplatesPanel,
  EscalationsPanel,
  ObjectivePanel,
  RelatedResourcesPanel,
  SmsTemplatesPanel,
  StepsPanel,
} from "../../components/subitems/InstructionPanels";
import { apiUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import type {
  Board,
  InstructionSection,
  InstructionsBlob,
  SubitemTemplate,
  SubitemVariableMap,
} from "@/types/mb";

interface BoardWithSchema extends Board {
  columns: Array<{ key: string; name: string; column_type: string }>;
}

/**
 * Admin-only templates management page.
 *
 * Routing flow:
 *   /operations/boards/templates/manage              → list of boards + their templates
 *   /operations/boards/templates/manage?board=N      → templates filtered to that board
 *   /operations/boards/templates/manage?template=N   → template editor
 *
 * Single-page with query-string state — no nested routes. Keeps the
 * surface small for Phase 5 and easy to graduate to nested routes later.
 */
export default function ManageTemplatesClient() {
  const { authHeaders, token, isAdmin, loading: authLoading } = useAuth();
  const router = useRouter();

  const [boards, setBoards] = useState<Board[]>([]);
  const [templatesByBoard, setTemplatesByBoard] = useState<Record<number, SubitemTemplate[]>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [editingTemplateId, setEditingTemplateId] = useState<number | null>(null);

  // Non-admin redirect.
  useEffect(() => {
    if (authLoading) return;
    if (!isAdmin) router.replace("/operations/boards/renewals");
  }, [authLoading, isAdmin, router]);

  const loadAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const boardsRes = await fetch(apiUrl("/mb/boards"), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!boardsRes.ok) throw new Error("Could not load boards.");
      const boardsBody = await boardsRes.json();
      const activeBoards: Board[] = (boardsBody.boards || []).filter(
        (b: Board) => b.archived_at == null
      );
      setBoards(activeBoards);

      // Fetch templates per board in parallel.
      const tplResults = await Promise.all(
        activeBoards.map((b) =>
          fetch(apiUrl(`/mb/boards/${b.id}/subitem-templates`), {
            headers: { ...authHeaders() },
            cache: "no-store",
          })
            .then((r) => (r.ok ? r.json() : { templates: [] }))
            .then((j) => [b.id, j.templates as SubitemTemplate[]] as const)
            .catch(() => [b.id, [] as SubitemTemplate[]] as const)
        )
      );
      const map: Record<number, SubitemTemplate[]> = {};
      for (const [bid, tpls] of tplResults) {
        map[bid] = tpls;
      }
      setTemplatesByBoard(map);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load templates.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function createTemplate(boardId: number) {
    const name = window.prompt("Template name:");
    if (!name?.trim()) return;
    try {
      const res = await fetch(
        apiUrl(`/mb/boards/${boardId}/subitem-templates`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ name: name.trim() }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Create failed.");
      }
      const body = await res.json();
      await loadAll();
      if (body.template?.id) setEditingTemplateId(body.template.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create template.");
    }
  }

  async function renameTemplate(t: SubitemTemplate) {
    const name = window.prompt(`Rename "${t.name}" to:`, t.name);
    if (!name?.trim() || name.trim() === t.name) return;
    try {
      const res = await fetch(apiUrl(`/mb/subitem-templates/${t.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Rename failed.");
      }
      await loadAll();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not rename.");
    }
  }

  async function archiveTemplate(t: SubitemTemplate) {
    if (!window.confirm(`Archive "${t.name}"?`)) return;
    try {
      const res = await fetch(apiUrl(`/mb/subitem-templates/${t.id}`), {
        method: "DELETE",
        headers: { ...authHeaders() },
      });
      if (!res.ok) throw new Error("Archive failed.");
      await loadAll();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not archive.");
    }
  }

  const editingBoard = useMemo(() => {
    if (editingTemplateId == null) return null;
    for (const b of boards) {
      const tpls = templatesByBoard[b.id] ?? [];
      if (tpls.some((t) => t.id === editingTemplateId)) return b;
    }
    return null;
  }, [editingTemplateId, boards, templatesByBoard]);

  if (authLoading || !isAdmin) {
    return (
      <div className={operationsStyles.page}>
        <OperationsTopBar />
        <div className={operationsStyles.main}>
          <div className={renewalsStyles.loadingState}>Checking permissions…</div>
        </div>
      </div>
    );
  }

  if (editingTemplateId != null && editingBoard) {
    return (
      <TemplateEditor
        templateId={editingTemplateId}
        board={editingBoard}
        onBack={() => {
          setEditingTemplateId(null);
          loadAll();
        }}
      />
    );
  }

  return (
    <div className={`${operationsStyles.page} ${renewalsStyles.page}`}>
      <OperationsTopBar />
      <div className={renewalsStyles.main}>
        <div className={renewalsStyles.boardHeader}>
          <div>
            <h2 className={renewalsStyles.boardTitle}>
              Manage Templates
              <span className={renewalsStyles.betaBadge}>Beta</span>
            </h2>
            <p className={renewalsStyles.boardDescription}>
              Subitem templates and their embedded SOPs. Per-board.
            </p>
          </div>
        </div>

        {err ? <div className={renewalsStyles.errorBanner}>{err}</div> : null}
        {loading ? (
          <div className={renewalsStyles.loadingState}>Loading…</div>
        ) : (
          boards.map((b) => {
            const tpls = templatesByBoard[b.id] ?? [];
            const active = tpls.filter((t) => t.archived_at == null);
            const archived = tpls.filter((t) => t.archived_at != null);
            return (
              <div key={b.id} style={{ marginBottom: "1.5rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                  <h3 className={customizationStyles.sectionTitle}>
                    {b.icon || "📋"} {b.name}
                  </h3>
                  <button
                    type="button"
                    className={customizationStyles.btnPrimary}
                    onClick={() => createTemplate(b.id)}
                  >
                    + New template
                  </button>
                </div>
                {active.length === 0 ? (
                  <div className={subitemStyles.instrEmpty}>
                    No templates yet for this board.
                  </div>
                ) : (
                  active.map((t) => (
                    <div key={t.id} className={subitemStyles.tmplCard}>
                      <div style={{ flex: 1 }}>
                        <div className={subitemStyles.tmplName}>
                          {t.name}
                          {t.workflow_name ? (
                            <span
                              className={subitemStyles.tmplWorkflow}
                              style={{ marginLeft: "0.5rem" }}
                            >
                              {t.workflow_name}
                            </span>
                          ) : null}
                        </div>
                        {t.description ? (
                          <div className={subitemStyles.tmplDesc}>{t.description}</div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className={customizationStyles.btnGhost}
                        onClick={() => setEditingTemplateId(t.id)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className={customizationStyles.btnGhost}
                        onClick={() => renameTemplate(t)}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className={`${customizationStyles.iconBtn} ${customizationStyles.iconBtnDanger}`}
                        onClick={() => archiveTemplate(t)}
                      >
                        Archive
                      </button>
                    </div>
                  ))
                )}
                {archived.length > 0 ? (
                  <details style={{ marginTop: "0.5rem" }}>
                    <summary
                      style={{
                        cursor: "pointer",
                        fontSize: "0.85rem",
                        color: "#6a737b",
                      }}
                    >
                      {archived.length} archived
                    </summary>
                    {archived.map((t) => (
                      <div
                        key={t.id}
                        className={subitemStyles.tmplCard}
                        style={{ opacity: 0.6 }}
                      >
                        <div className={subitemStyles.tmplName}>{t.name}</div>
                        <button
                          type="button"
                          className={customizationStyles.btnGhost}
                          onClick={async () => {
                            await fetch(apiUrl(`/mb/subitem-templates/${t.id}`), {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json", ...authHeaders() },
                              body: JSON.stringify({ archived: false }),
                            });
                            loadAll();
                          }}
                        >
                          Restore
                        </button>
                      </div>
                    ))}
                  </details>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ============================================================
// Template editor
// ============================================================

function TemplateEditor({
  templateId,
  board,
  onBack,
}: {
  templateId: number;
  board: Board;
  onBack: () => void;
}) {
  const { authHeaders } = useAuth();
  const [template, setTemplate] = useState<SubitemTemplate | null>(null);
  const [variables, setVariables] = useState<SubitemVariableMap | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [savingSection, setSavingSection] = useState<InstructionSection | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await fetch(apiUrl(`/mb/subitem-templates/${templateId}`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Could not load template.");
      const body = await res.json();
      setTemplate(body.template);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load template.");
    }
  }, [authHeaders, templateId]);

  useEffect(() => {
    load();
  }, [load]);

  // Build a synthetic variable map from the board's columns so the
  // editor's variable picker works without needing a real subitem.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl(`/mb/boards/${board.id}`), {
          headers: { ...authHeaders() },
          cache: "no-store",
        });
        if (!res.ok) return;
        const body = await res.json();
        if (cancelled) return;
        const cols = (body.columns || []).map((c: { key: string; name: string; column_type: string }) => ({
          key: c.key,
          name: c.name,
          type: c.column_type,
        }));
        const empty: Record<string, string> = {};
        for (const c of cols) empty[c.key] = "";
        setVariables({
          subitem: empty,
          item: empty,
          subitem_columns: cols,
          item_columns: cols,
        });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authHeaders, board.id]);

  const instructions: InstructionsBlob = template?.instructions ?? {};

  async function saveSection(section: InstructionSection, content: object) {
    setSavingSection(section);
    setErr(null);
    try {
      const res = await fetch(
        apiUrl(`/mb/subitem-templates/${templateId}/instructions/${section}`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(content),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Save failed.");
      }
      // Reload so any normalization the server did is reflected.
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSavingSection(null);
    }
  }

  return (
    <div className={`${operationsStyles.page} ${renewalsStyles.page}`}>
      <OperationsTopBar />
      <div className={renewalsStyles.main}>
        <div className={renewalsStyles.boardHeader}>
          <div>
            <button
              type="button"
              className={customizationStyles.btnGhost}
              onClick={onBack}
              style={{ marginBottom: "0.5rem" }}
            >
              ← Back to templates
            </button>
            <h2 className={renewalsStyles.boardTitle}>
              {template?.name ?? "Loading…"}
            </h2>
            <p className={renewalsStyles.boardDescription}>
              {board.icon || "📋"} {board.name}
              {template?.workflow_name ? ` · workflow: ${template.workflow_name}` : ""}
            </p>
          </div>
          {savingSection ? (
            <span style={{ marginLeft: "auto", color: "#6a737b", fontSize: "0.85rem" }}>
              Saving {savingSection}…
            </span>
          ) : null}
        </div>

        {err ? <div className={renewalsStyles.errorBanner}>{err}</div> : null}

        {!template ? (
          <div className={renewalsStyles.loadingState}>Loading template…</div>
        ) : (
          <>
            <SectionBlock title="Objective">
              <ObjectivePanel
                content={instructions.objective}
                vars={variables}
                editable
                onSave={(next) => saveSection("objective", next)}
              />
            </SectionBlock>
            <SectionBlock title="Step-by-step">
              <StepsPanel
                content={instructions.steps}
                vars={variables}
                editable
                onSave={(next) => saveSection("steps", next)}
              />
            </SectionBlock>
            <SectionBlock title="Decision matrix">
              <DecisionMatrixPanel
                content={instructions.decision_matrix}
                editable
                onSave={(next) => saveSection("decision_matrix", next)}
              />
            </SectionBlock>
            <SectionBlock title="Email templates">
              <EmailTemplatesPanel
                content={instructions.email_templates}
                vars={variables}
                editable
                onSave={(next) => saveSection("email_templates", next)}
              />
            </SectionBlock>
            <SectionBlock title="SMS templates">
              <SmsTemplatesPanel
                content={instructions.sms_templates}
                vars={variables}
                editable
                onSave={(next) => saveSection("sms_templates", next)}
              />
            </SectionBlock>
            <SectionBlock title="Escalation triggers">
              <EscalationsPanel
                content={instructions.escalations}
                editable
                onSave={(next) => saveSection("escalations", next)}
              />
            </SectionBlock>
            <SectionBlock title="Completion checklist">
              <CompletionChecklistPanel
                content={instructions.completion_checklist}
                editable
                onSave={(next) => saveSection("completion_checklist", next)}
              />
            </SectionBlock>
            <SectionBlock title="Related resources">
              <RelatedResourcesPanel
                content={instructions.related_resources}
                editable
                onSave={(next) => saveSection("related_resources", next)}
              />
            </SectionBlock>
          </>
        )}
      </div>
    </div>
  );
}

function SectionBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className={subitemStyles.tmplEditorSection}>
      <div className={subitemStyles.tmplEditorHead}>
        <span className={subitemStyles.tmplEditorTitle}>{title}</span>
      </div>
      {children}
    </div>
  );
}
