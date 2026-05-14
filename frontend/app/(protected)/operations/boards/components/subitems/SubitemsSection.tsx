"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./subitems.module.css";
import {
  CompletionChecklistPanel,
  DecisionMatrixPanel,
  EmailTemplatesPanel,
  EscalationsPanel,
  InstructionAccordion,
  ObjectivePanel,
  RelatedResourcesPanel,
  SmsTemplatesPanel,
  StepsPanel,
} from "./InstructionPanels";
import {
  DateCell,
  LongTextCell,
  NumberCell,
  PersonCell,
  ScoreCell,
  StatusCell,
  TextCell,
} from "../../renewals/components/CellEditors";
import type { TeamUser } from "../../renewals/components/types";
import ConfirmDialog from "../ConfirmDialog";
import { apiUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import type {
  BoardColumn,
  ChecklistStateEntry,
  Item,
  ResolvedInstructions,
  SubitemTemplate,
  SubitemVariableMap,
} from "@/types/mb";

/**
 * Inline subitems section on the item detail page. Owns:
 *   * fetching the subitem list for the parent item,
 *   * an "Add subitem" picker (blank, single template, or full workflow),
 *   * per-row expand/collapse state,
 *   * inline column-value editing reusing Phase 3 cell editors,
 *   * lazy-loading instructions / variables / checklist state on expand,
 *   * detach-from-template confirmation (admin only),
 *   * persisting changes through Phase 5 routes.
 *
 * Deliberately does NOT touch Phase 4's updates feed. Subitem activity
 * is invisible at the parent-item level per spec.
 */
export default function SubitemsSection({
  parentItem,
  columns,
  users,
  onSubitemChanged,
}: {
  parentItem: Item;
  columns: BoardColumn[];
  users: TeamUser[];
  /** Notify the parent (item detail page) when subitems mutate, so a
   * future Phase 6 aggregator can refresh. Optional. */
  onSubitemChanged?: () => void;
}) {
  const { authHeaders, token, isAdmin } = useAuth();
  const [subitems, setSubitems] = useState<Item[]>([]);
  const [templates, setTemplates] = useState<SubitemTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const [subRes, tplRes] = await Promise.all([
        fetch(apiUrl(`/mb/items/${parentItem.id}/subitems`), {
          headers: { ...authHeaders() },
          cache: "no-store",
        }),
        fetch(apiUrl(`/mb/boards/${parentItem.board_id}/subitem-templates`), {
          headers: { ...authHeaders() },
          cache: "no-store",
        }),
      ]);
      if (!subRes.ok) throw new Error("Could not load subitems.");
      if (!tplRes.ok) throw new Error("Could not load templates.");
      const subBody = await subRes.json();
      const tplBody = await tplRes.json();
      setSubitems(subBody.subitems || []);
      setTemplates(tplBody.templates || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load subitems.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, parentItem.board_id, parentItem.id, token]);

  useEffect(() => {
    load();
  }, [load]);

  // -------- Mutations --------

  const saveValue = useCallback(
    async (subitemId: number, columnKey: string, next: unknown) => {
      const sub = subitems.find((s) => s.id === subitemId);
      if (!sub) return;
      const prevValues = sub.values ?? {};
      const newValues = { ...prevValues, [columnKey]: next };
      setSubitems((arr) =>
        arr.map((s) => (s.id === subitemId ? { ...s, values: newValues } : s))
      );
      try {
        const res = await fetch(apiUrl(`/mb/items/${subitemId}`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ values: newValues }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Save failed.");
        }
        const body = await res.json();
        if (body.item) {
          setSubitems((arr) =>
            arr.map((s) => (s.id === subitemId ? body.item : s))
          );
        }
        onSubitemChanged?.();
      } catch (e) {
        // Revert.
        setSubitems((arr) =>
          arr.map((s) => (s.id === subitemId ? { ...s, values: prevValues } : s))
        );
        setErr(e instanceof Error ? e.message : "Could not save change.");
      }
    },
    [authHeaders, onSubitemChanged, subitems]
  );

  async function archiveSubitem(id: number) {
    if (!window.confirm("Archive this subitem? You can restore it later.")) return;
    try {
      const res = await fetch(apiUrl(`/mb/items/${id}`), {
        method: "DELETE",
        headers: { ...authHeaders() },
      });
      if (!res.ok) throw new Error("Archive failed.");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not archive subitem.");
    }
  }

  async function moveSubitem(idx: number, delta: number) {
    const target = idx + delta;
    if (target < 0 || target >= subitems.length) return;
    const next = [...subitems];
    const [moved] = next.splice(idx, 1);
    next.splice(target, 0, moved);
    setSubitems(next);
    try {
      const res = await fetch(
        apiUrl(`/mb/items/${parentItem.id}/subitems/reorder`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ order: next.map((s) => s.id) }),
        }
      );
      if (!res.ok) throw new Error("Reorder failed.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not reorder.");
      load();
    }
  }

  async function addBlankSubitem() {
    try {
      const res = await fetch(
        apiUrl(`/mb/items/${parentItem.id}/subitems`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ name: "New subitem" }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Create failed.");
      }
      setPickerOpen(false);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add subitem.");
    }
  }

  async function addFromTemplate(templateId: number) {
    try {
      const res = await fetch(
        apiUrl(`/mb/items/${parentItem.id}/subitems`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ from_template_id: templateId }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Create failed.");
      }
      setPickerOpen(false);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add subitem.");
    }
  }

  async function addWorkflow(workflowName: string) {
    try {
      const res = await fetch(
        apiUrl(`/mb/items/${parentItem.id}/subitems/from-workflow`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ workflow_name: workflowName }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Workflow add failed.");
      }
      setPickerOpen(false);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add workflow.");
    }
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Subitems</h2>
        <span className={styles.sectionCount}>{subitems.length}</span>
        <button
          type="button"
          className={styles.addBtn}
          onClick={() => setPickerOpen(true)}
        >
          + Add subitem
        </button>
      </div>

      {err ? <div className={styles.errBanner}>{err}</div> : null}

      {loading ? (
        <div className={styles.instrEmpty}>Loading subitems…</div>
      ) : subitems.length === 0 ? (
        <div className={styles.instrEmpty}>
          No subitems yet. Click “Add subitem” to break this work down into steps.
        </div>
      ) : (
        subitems.map((s, idx) => (
          <SubitemRow
            key={s.id}
            subitem={s}
            columns={columns}
            users={users}
            isAdmin={isAdmin}
            position={idx}
            count={subitems.length}
            onMove={(d) => moveSubitem(idx, d)}
            onArchive={() => archiveSubitem(s.id)}
            onSaveValue={(key, v) => saveValue(s.id, key, v)}
            onDetached={load}
          />
        ))
      )}

      {pickerOpen ? (
        <AddSubitemModal
          templates={templates.filter((t) => t.archived_at == null)}
          onClose={() => setPickerOpen(false)}
          onAddBlank={addBlankSubitem}
          onAddTemplate={addFromTemplate}
          onAddWorkflow={addWorkflow}
        />
      ) : null}
    </div>
  );
}

/* ============================================================
   Subitem row
   ============================================================ */

function SubitemRow({
  subitem,
  columns,
  users,
  isAdmin,
  position,
  count,
  onMove,
  onArchive,
  onSaveValue,
  onDetached,
}: {
  subitem: Item;
  columns: BoardColumn[];
  users: TeamUser[];
  isAdmin: boolean;
  position: number;
  count: number;
  onMove: (delta: number) => void;
  onArchive: () => void;
  onSaveValue: (columnKey: string, next: unknown) => Promise<void>;
  onDetached: () => void;
}) {
  const { authHeaders } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [resolved, setResolved] = useState<ResolvedInstructions | null>(null);
  const [variables, setVariables] = useState<SubitemVariableMap | null>(null);
  const [checklistState, setChecklistState] = useState<Record<string, ChecklistStateEntry>>({});
  const [detachConfirm, setDetachConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const status = typeof subitem.values?.status === "string" ? subitem.values.status : null;
  const statusCol = columns.find((c) => c.key === "status");
  const statusOption = useMemo(() => {
    if (!status || !statusCol) return null;
    const cfg = statusCol.config as { options?: Array<{ value: string; label: string; color?: string }> } | undefined;
    return (cfg?.options ?? []).find((o) => o.value === status) ?? null;
  }, [status, statusCol]);

  const linkLabel = subitem.subitem_detached_at
    ? "Detached"
    : subitem.subitem_template_id != null
      ? "Template"
      : "Custom";
  const linkClass = subitem.subitem_detached_at
    ? styles.linkBadgeDetached
    : subitem.subitem_template_id != null
      ? styles.linkBadgeLinked
      : styles.linkBadgeCustom;

  const ownerVal = typeof subitem.values?.owner === "number" ? subitem.values.owner : null;
  const ownerName = ownerVal != null ? users.find((u) => u.id === ownerVal)?.displayName : null;
  const dueDate = typeof subitem.values?.last_contact_date === "string" ? subitem.values.last_contact_date : null;

  const fetchExpanded = useCallback(async () => {
    setBusy(true);
    try {
      const [insRes, varsRes, chkRes] = await Promise.all([
        fetch(apiUrl(`/mb/subitems/${subitem.id}/instructions`), {
          headers: { ...authHeaders() },
          cache: "no-store",
        }),
        fetch(apiUrl(`/mb/subitems/${subitem.id}/variables`), {
          headers: { ...authHeaders() },
          cache: "no-store",
        }),
        fetch(apiUrl(`/mb/subitems/${subitem.id}/checklist`), {
          headers: { ...authHeaders() },
          cache: "no-store",
        }),
      ]);
      if (insRes.ok) setResolved(await insRes.json());
      if (varsRes.ok) setVariables(await varsRes.json());
      if (chkRes.ok) {
        const b = await chkRes.json();
        setChecklistState(b.state ?? {});
      }
    } finally {
      setBusy(false);
    }
  }, [authHeaders, subitem.id]);

  useEffect(() => {
    if (expanded) fetchExpanded();
  }, [expanded, fetchExpanded]);

  async function toggleCheck(checklistItemId: string, nextChecked: boolean) {
    // Optimistic update.
    const prev = checklistState[checklistItemId];
    setChecklistState((s) => ({
      ...s,
      [checklistItemId]: { ...(prev ?? { checklist_item_id: checklistItemId, checked_by: null, checked_at: null, is_checked: false }), is_checked: nextChecked },
    }));
    try {
      const res = await fetch(
        apiUrl(`/mb/subitems/${subitem.id}/checklist/${encodeURIComponent(checklistItemId)}`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ is_checked: nextChecked }),
        }
      );
      if (!res.ok) throw new Error("Could not save check.");
    } catch {
      // Revert.
      setChecklistState((s) => ({ ...s, [checklistItemId]: prev ?? { ...s[checklistItemId], is_checked: !nextChecked } }));
    }
  }

  async function doDetach() {
    setDetachConfirm(false);
    try {
      const res = await fetch(apiUrl(`/mb/subitems/${subitem.id}/detach`), {
        method: "POST",
        headers: { ...authHeaders() },
      });
      if (!res.ok) throw new Error("Detach failed.");
      onDetached();
      fetchExpanded();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not detach subitem.");
    }
  }

  return (
    <div className={styles.subitemRow}>
      <div className={styles.subitemRowHead} onClick={() => setExpanded((v) => !v)}>
        <span
          className={`${styles.expandCaret} ${expanded ? styles.expandCaretOpen : ""}`}
        />
        <span className={styles.subitemTitle}>{subitem.title}</span>
        <span className={styles.subitemMeta}>
          {statusOption ? (
            <span
              className={styles.statusChip}
              style={{ background: statusOption.color || "#6a737b" }}
            >
              {statusOption.label}
            </span>
          ) : null}
          {ownerName ? <span>👤 {ownerName}</span> : null}
          {dueDate ? <span>📅 {dueDate}</span> : null}
          <span className={`${styles.linkBadge} ${linkClass}`}>{linkLabel}</span>
        </span>
        <div style={{ display: "flex", gap: "0.25rem" }} onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={styles.tinyBtn}
            disabled={position === 0}
            onClick={() => onMove(-1)}
            aria-label="Move up"
          >
            ↑
          </button>
          <button
            type="button"
            className={styles.tinyBtn}
            disabled={position === count - 1}
            onClick={() => onMove(+1)}
            aria-label="Move down"
          >
            ↓
          </button>
          <button
            type="button"
            className={styles.archiveBtn}
            onClick={onArchive}
          >
            Archive
          </button>
        </div>
      </div>

      {expanded ? (
        <div className={styles.subitemBody}>
          {/* Column values, two columns. */}
          {columns.map((c) => {
            const raw = subitem.values?.[c.key];
            return (
              <div key={c.id} className={styles.subitemBodyRow}>
                <label className={styles.subitemBodyLabel}>{c.name}</label>
                <SubitemValueField
                  column={c}
                  raw={raw}
                  users={users}
                  onSave={(v) => onSaveValue(c.key, v)}
                />
              </div>
            );
          })}

          {busy && !resolved ? (
            <div className={styles.instrEmpty} style={{ marginTop: "0.75rem" }}>
              Loading instructions…
            </div>
          ) : (
            <div className={styles.accordion}>
              <InstructionAccordion title="Objective" defaultOpen>
                <ObjectivePanel
                  content={resolved?.instructions?.objective}
                  vars={variables}
                  editable={false}
                />
              </InstructionAccordion>
              <InstructionAccordion title="Step-by-step" defaultOpen>
                <StepsPanel
                  content={resolved?.instructions?.steps}
                  vars={variables}
                  editable={false}
                />
              </InstructionAccordion>
              <InstructionAccordion title="Decision matrix">
                <DecisionMatrixPanel
                  content={resolved?.instructions?.decision_matrix}
                  editable={false}
                />
              </InstructionAccordion>
              <InstructionAccordion title="Email templates">
                <EmailTemplatesPanel
                  content={resolved?.instructions?.email_templates}
                  vars={variables}
                  editable={false}
                />
              </InstructionAccordion>
              <InstructionAccordion title="SMS templates">
                <SmsTemplatesPanel
                  content={resolved?.instructions?.sms_templates}
                  vars={variables}
                  editable={false}
                />
              </InstructionAccordion>
              <InstructionAccordion title="Escalation triggers">
                <EscalationsPanel
                  content={resolved?.instructions?.escalations}
                  editable={false}
                />
              </InstructionAccordion>
              <InstructionAccordion title="Completion checklist" defaultOpen>
                <CompletionChecklistPanel
                  content={resolved?.instructions?.completion_checklist}
                  state={checklistState}
                  editable={false}
                  onToggleCheck={toggleCheck}
                />
              </InstructionAccordion>
              <InstructionAccordion title="Related resources">
                <RelatedResourcesPanel
                  content={resolved?.instructions?.related_resources}
                  editable={false}
                />
              </InstructionAccordion>
            </div>
          )}

          {isAdmin && resolved?.source === "linked" ? (
            <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <span className={styles.instrEmpty}>
                Instructions are read live from template:{" "}
                <strong>{resolved.template_name}</strong>
              </span>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                className={styles.detachBtn}
                onClick={() => setDetachConfirm(true)}
              >
                Detach from template
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {detachConfirm ? (
        <ConfirmDialog
          title="Detach from template?"
          body={
            `This copies the current instructions into the subitem. Future edits to the "${resolved?.template_name}" template will no longer affect this subitem. You can't re-attach in this phase.`
          }
          confirmLabel="Detach"
          destructive
          onConfirm={doDetach}
          onCancel={() => setDetachConfirm(false)}
        />
      ) : null}
    </div>
  );
}

function SubitemValueField({
  column,
  raw,
  users,
  onSave,
}: {
  column: BoardColumn;
  raw: unknown;
  users: TeamUser[];
  onSave: (v: unknown) => Promise<void>;
}) {
  switch (column.column_type) {
    case "text":
      return <TextCell column={column} value={typeof raw === "string" ? raw : null} onSave={(v) => onSave(v)} />;
    case "longtext":
      return <LongTextCell column={column} value={typeof raw === "string" ? raw : null} onSave={(v) => onSave(v)} expanded />;
    case "number":
      return <NumberCell column={column} value={typeof raw === "number" ? raw : null} onSave={(v) => onSave(v)} />;
    case "score":
      return <ScoreCell column={column} value={typeof raw === "number" ? raw : null} onSave={(v) => onSave(v)} />;
    case "date":
      return <DateCell column={column} value={typeof raw === "string" ? raw : null} onSave={(v) => onSave(v)} />;
    case "status":
    case "dropdown":
      return <StatusCell column={column} value={typeof raw === "string" ? raw : null} onSave={(v) => onSave(v)} />;
    case "person":
      return <PersonCell column={column} value={typeof raw === "number" ? raw : null} users={users} onSave={(v) => onSave(v)} />;
    default:
      return (
        <div className={styles.instrEmpty}>
          {raw == null ? "—" : typeof raw === "object" ? JSON.stringify(raw) : String(raw)}
        </div>
      );
  }
}

/* ============================================================
   Add Subitem modal
   ============================================================ */

function AddSubitemModal({
  templates,
  onClose,
  onAddBlank,
  onAddTemplate,
  onAddWorkflow,
}: {
  templates: SubitemTemplate[];
  onClose: () => void;
  onAddBlank: () => void;
  onAddTemplate: (id: number) => void;
  onAddWorkflow: (workflowName: string) => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const workflowMap = useMemo(() => {
    const m = new Map<string, SubitemTemplate[]>();
    const standalone: SubitemTemplate[] = [];
    for (const t of templates) {
      if (t.workflow_name) {
        const arr = m.get(t.workflow_name) ?? [];
        arr.push(t);
        m.set(t.workflow_name, arr);
      } else {
        standalone.push(t);
      }
    }
    return { workflows: m, standalone };
  }, [templates]);

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>Add subitem</h3>
          <button
            type="button"
            className={styles.modalClose}
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className={styles.modalBody}>
          <div className={styles.pickerSection}>
            <h4 className={styles.pickerSectionTitle}>Blank</h4>
            <button
              type="button"
              className={styles.pickerItem}
              onClick={onAddBlank}
            >
              <div className={styles.pickerItemTitle}>Blank subitem</div>
              <div className={styles.pickerItemDesc}>
                Just a row with a title — no embedded instructions.
              </div>
            </button>
          </div>

          {Array.from(workflowMap.workflows.entries()).map(([name, tpls]) => (
            <div key={name} className={styles.pickerSection}>
              <h4 className={styles.pickerSectionTitle}>Workflow: {name}</h4>
              <div className={styles.workflowCard}>
                <div className={styles.workflowHead}>
                  <span className={styles.workflowName}>
                    {tpls.length} step{tpls.length === 1 ? "" : "s"}
                  </span>
                  <button
                    type="button"
                    className={styles.workflowAddAll}
                    onClick={() => onAddWorkflow(name)}
                  >
                    Add all {tpls.length}
                  </button>
                </div>
                {tpls.map((t) => (
                  <button
                    type="button"
                    key={t.id}
                    className={styles.workflowTemplate}
                    onClick={() => onAddTemplate(t.id)}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          ))}

          {workflowMap.standalone.length > 0 ? (
            <div className={styles.pickerSection}>
              <h4 className={styles.pickerSectionTitle}>Standalone templates</h4>
              {workflowMap.standalone.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  className={styles.pickerItem}
                  onClick={() => onAddTemplate(t.id)}
                >
                  <div className={styles.pickerItemTitle}>{t.name}</div>
                  {t.description ? (
                    <div className={styles.pickerItemDesc}>{t.description}</div>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}

          {templates.length === 0 ? (
            <div className={styles.instrEmpty}>
              No templates exist yet for this board.{" "}
              <a href="/operations/boards/templates/manage">Manage templates</a>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
