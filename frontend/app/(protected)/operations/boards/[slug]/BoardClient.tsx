"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import operationsStyles from "../../operations.module.css";
import boardStyles from "./board.module.css";
import OperationsTopBar from "../../OperationsTopBar";
import { apiUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

/**
 * Phase 7 (Unification): the Monday-style board view of all active
 * processes for one template.
 *
 * Source of truth: unification-plan.md. The board is a thin
 * presentational layer over System A's `/processes` API. Rows are
 * processes. Status is the current stage. Click a row → process detail.
 */

interface Template {
  id: number;
  name: string;
  slug: string | null;
  description: string | null;
  icon: string | null;
  color: string | null;
  estimatedDays: number | null;
}

interface StageOption {
  id: number;
  name: string;
  color: string | null;
  stageOrder: number;
}

interface ProcessRow {
  id: number;
  templateId: number;
  templateName: string | null;
  name: string;
  status: string;
  propertyName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  startedAt: string;
  targetCompletion: string | null;
  completedAt: string | null;
  currentStageId: number | null;
  currentStageName: string | null;
  currentStageColor: string | null;
  assignedUserNames: string[] | null;
  nextDueDate: string | null;
  stepsTotal: number | null;
  stepsCompleted: number | null;
}

export default function BoardClient({ slug }: { slug: string }) {
  const { authHeaders, token } = useAuth();
  const router = useRouter();
  const [template, setTemplate] = useState<Template | null>(null);
  const [stageOptions, setStageOptions] = useState<StageOption[]>([]);
  const [rows, setRows] = useState<ProcessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launchOpen, setLaunchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");

  // Resolve slug → template via /processes/templates, then load
  // processes filtered to that template id.
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
      const tmpls: Template[] = (tBody.templates || []).map(coerceTemplate);
      const match = tmpls.find((t) => t.slug === slug);
      if (!match) {
        throw new Error(
          `No process template matches "${slug}". Open Manage Templates to create one.`
        );
      }
      setTemplate(match);

      const [stRes, pRes] = await Promise.all([
        fetch(apiUrl(`/processes/templates/${match.id}/stages`), {
          headers: { ...authHeaders() },
          cache: "no-store",
        }).catch(() => null),
        fetch(
          apiUrl(
            `/processes?template=${match.id}&status=${encodeURIComponent(statusFilter)}${search ? `&search=${encodeURIComponent(search)}` : ""}`
          ),
          { headers: { ...authHeaders() }, cache: "no-store" }
        ),
      ]);
      if (stRes && stRes.ok) {
        const stBody = await stRes.json();
        setStageOptions(
          (stBody.stages || []).map((s: Record<string, unknown>) => ({
            id: Number(s.id),
            name: String(s.name ?? ""),
            color: (s.color as string | null) ?? null,
            stageOrder: Number(s.stageOrder ?? s.stage_order ?? 0),
          })),
        );
      }
      if (!pRes.ok) throw new Error("Could not load processes.");
      const pBody = await pRes.json();
      setRows((pBody.processes || []).map(coerceProcess));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load board.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, search, slug, statusFilter, token]);

  useEffect(() => {
    load();
  }, [load]);

  async function launchProcess(form: LaunchForm) {
    if (!template) return;
    setLaunching(true);
    try {
      const res = await fetch(apiUrl("/processes"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          templateId: template.id,
          propertyName: form.propertyName.trim() || null,
          contactName: form.contactName.trim() || null,
          contactEmail: form.contactEmail.trim() || null,
          contactPhone: form.contactPhone.trim() || null,
          targetCompletion: form.targetCompletion || null,
          notes: form.notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Could not launch process.");
      }
      const body = await res.json();
      const newId = body.process?.id ?? body.id;
      setLaunchOpen(false);
      if (newId) {
        router.push(`/operations/boards/${slug}/items/${newId}`);
      } else {
        load();
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not launch process.");
    } finally {
      setLaunching(false);
    }
  }

  return (
    <div className={`${operationsStyles.page} ${boardStyles.page}`}>
      <OperationsTopBar />
      <div className={boardStyles.main}>
        <div className={boardStyles.header}>
          <div>
            <h2 className={boardStyles.title}>
              {template?.icon ?? "📋"} {template?.name ?? slug}
            </h2>
            {template?.description ? (
              <p className={boardStyles.subtitle}>{template.description}</p>
            ) : null}
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <button
              type="button"
              className={`${boardStyles.btn} ${boardStyles.btnPrimary}`}
              onClick={() => setLaunchOpen(true)}
              disabled={!template}
            >
              + Launch Process
            </button>
          </div>
        </div>

        <div className={boardStyles.toolbar}>
          <input
            type="search"
            className={boardStyles.input}
            placeholder="Search by name, property, contact…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className={boardStyles.input}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ flex: "0 0 auto" }}
          >
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="all">All</option>
          </select>
        </div>

        {err ? <div className={boardStyles.err}>{err}</div> : null}

        {loading ? (
          <div className={boardStyles.muted}>Loading board…</div>
        ) : rows.length === 0 ? (
          <div className={boardStyles.empty}>
            No active {template?.name ?? "processes"} yet.
            {" "}
            <button
              type="button"
              className={boardStyles.link}
              onClick={() => setLaunchOpen(true)}
            >
              Launch the first one.
            </button>
          </div>
        ) : (
          <div className={boardStyles.tableWrap}>
            <table className={boardStyles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Stage</th>
                  <th>Property</th>
                  <th>Contact</th>
                  <th>Assignee</th>
                  <th>Started</th>
                  <th>Target</th>
                  <th>Progress</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <ProcessRowView key={p.id} slug={slug} process={p} stageOptions={stageOptions} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {launchOpen && template ? (
        <LaunchProcessModal
          template={template}
          submitting={launching}
          onClose={() => setLaunchOpen(false)}
          onSubmit={launchProcess}
        />
      ) : null}
    </div>
  );
}

function ProcessRowView({
  slug,
  process,
  stageOptions,
}: {
  slug: string;
  process: ProcessRow;
  stageOptions: StageOption[];
}) {
  const stage = stageOptions.find((s) => s.id === process.currentStageId);
  const stageColor = stage?.color ?? process.currentStageColor ?? "#6a737b";
  const stageName = stage?.name ?? process.currentStageName ?? "—";
  const pct =
    process.stepsTotal && process.stepsTotal > 0 && process.stepsCompleted != null
      ? Math.round((process.stepsCompleted / process.stepsTotal) * 100)
      : null;
  return (
    <tr>
      <td>
        <Link
          href={`/operations/boards/${slug}/items/${process.id}`}
          className={boardStyles.rowTitle}
        >
          {process.name}
        </Link>
      </td>
      <td>
        <span
          className={boardStyles.stageChip}
          style={{ background: stageColor }}
        >
          {stageName}
        </span>
      </td>
      <td className={boardStyles.cellMuted}>{process.propertyName ?? "—"}</td>
      <td className={boardStyles.cellMuted}>{process.contactName ?? "—"}</td>
      <td className={boardStyles.cellMuted}>
        {process.assignedUserNames?.[0] ?? "—"}
      </td>
      <td className={boardStyles.cellMuted}>
        {process.startedAt ? new Date(process.startedAt).toLocaleDateString() : "—"}
      </td>
      <td className={boardStyles.cellMuted}>
        {process.targetCompletion ?? "—"}
      </td>
      <td className={boardStyles.cellMuted}>
        {pct == null ? "—" : `${pct}% (${process.stepsCompleted}/${process.stepsTotal})`}
      </td>
    </tr>
  );
}

interface LaunchForm {
  propertyName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  targetCompletion: string;
  notes: string;
}

function LaunchProcessModal({
  template,
  submitting,
  onClose,
  onSubmit,
}: {
  template: Template;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (form: LaunchForm) => void;
}) {
  const [form, setForm] = useState<LaunchForm>({
    propertyName: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    targetCompletion: "",
    notes: "",
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className={boardStyles.modalBackdrop} onClick={onClose}>
      <div className={boardStyles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={boardStyles.modalHead}>
          <h3>Launch {template.name}</h3>
          <button type="button" className={boardStyles.modalClose} onClick={onClose}>×</button>
        </div>
        <div className={boardStyles.modalBody}>
          <label className={boardStyles.field}>
            <span>Property</span>
            <input
              className={boardStyles.input}
              value={form.propertyName}
              autoFocus
              onChange={(e) => setForm((f) => ({ ...f, propertyName: e.target.value }))}
              placeholder="e.g., 1234 Oak St"
            />
          </label>
          <label className={boardStyles.field}>
            <span>Contact name</span>
            <input
              className={boardStyles.input}
              value={form.contactName}
              onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))}
              placeholder="Tenant or owner name"
            />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
            <label className={boardStyles.field}>
              <span>Contact email</span>
              <input
                className={boardStyles.input}
                type="email"
                value={form.contactEmail}
                onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
              />
            </label>
            <label className={boardStyles.field}>
              <span>Contact phone</span>
              <input
                className={boardStyles.input}
                value={form.contactPhone}
                onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))}
              />
            </label>
          </div>
          <label className={boardStyles.field}>
            <span>Target completion</span>
            <input
              className={boardStyles.input}
              type="date"
              value={form.targetCompletion}
              onChange={(e) => setForm((f) => ({ ...f, targetCompletion: e.target.value }))}
            />
          </label>
          <label className={boardStyles.field}>
            <span>Notes</span>
            <textarea
              className={boardStyles.input}
              rows={3}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </label>
        </div>
        <div className={boardStyles.modalFoot}>
          <button type="button" className={boardStyles.btn} onClick={onClose}>Cancel</button>
          <button
            type="button"
            className={`${boardStyles.btn} ${boardStyles.btnPrimary}`}
            onClick={() => onSubmit(form)}
            disabled={submitting}
          >
            {submitting ? "Launching…" : "Launch"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ----- shape coercion (server returns camelCase already, but defensive) -----

function coerceTemplate(t: Record<string, unknown>): Template {
  return {
    id: Number(t.id),
    name: String(t.name ?? ""),
    slug: (t.slug as string | null) ?? null,
    description: (t.description as string | null) ?? null,
    icon: (t.icon as string | null) ?? null,
    color: (t.color as string | null) ?? null,
    estimatedDays:
      typeof t.estimatedDays === "number"
        ? t.estimatedDays
        : typeof t.estimated_days === "number"
          ? t.estimated_days
          : null,
  };
}

function coerceProcess(p: Record<string, unknown>): ProcessRow {
  return {
    id: Number(p.id),
    templateId: Number(p.templateId ?? p.template_id),
    templateName: (p.templateName as string | null) ?? null,
    name: String(p.name ?? ""),
    status: String(p.status ?? "active"),
    propertyName: (p.propertyName as string | null) ?? null,
    contactName: (p.contactName as string | null) ?? null,
    contactEmail: (p.contactEmail as string | null) ?? null,
    startedAt: String(p.startedAt ?? p.started_at ?? ""),
    targetCompletion: (p.targetCompletion as string | null) ?? null,
    completedAt: (p.completedAt as string | null) ?? null,
    currentStageId:
      typeof p.currentStageId === "number"
        ? p.currentStageId
        : typeof p.current_stage_id === "number"
          ? p.current_stage_id
          : null,
    currentStageName: (p.currentStageName as string | null) ?? null,
    currentStageColor: (p.currentStageColor as string | null) ?? null,
    assignedUserNames: Array.isArray(p.assignedUserNames)
      ? (p.assignedUserNames as string[])
      : null,
    nextDueDate: (p.nextDueDate as string | null) ?? null,
    stepsTotal: typeof p.stepsTotal === "number" ? p.stepsTotal : null,
    stepsCompleted: typeof p.stepsCompleted === "number" ? p.stepsCompleted : null,
  };
}
