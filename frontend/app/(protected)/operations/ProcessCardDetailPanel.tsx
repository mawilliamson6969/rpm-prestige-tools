"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./operations.module.css";
import { apiUrl } from "../../../lib/api";
import { useAuth } from "../../../context/AuthContext";
import type {
  ProcessRecord,
  ProcessStageRecord,
  ProcessStep,
  TemplateStage,
} from "./types";

type Props = {
  processId: number;
  onClose: () => void;
  onChanged?: () => void;
};

type StageWithFlags = TemplateStage & {
  textColor?: string;
  isFinal?: boolean;
  autoAdvance?: boolean;
};

export default function ProcessCardDetailPanel({ processId, onClose, onChanged }: Props) {
  const { authHeaders, token } = useAuth();
  const [processData, setProcessData] = useState<ProcessRecord | null>(null);
  const [steps, setSteps] = useState<ProcessStep[]>([]);
  const [stages, setStages] = useState<ProcessStageRecord[]>([]);
  const [templateStages, setTemplateStages] = useState<StageWithFlags[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(apiUrl(`/processes/${processId}`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(typeof body.error === "string" ? body.error : "Could not load.");
      setProcessData(body.process);
      setSteps(body.steps || []);
      setStages(body.stages || []);
      if (body.process?.templateId) {
        try {
          const tplRes = await fetch(
            apiUrl(`/processes/templates/${body.process.templateId}/stages`),
            { headers: { ...authHeaders() }, cache: "no-store" }
          );
          if (tplRes.ok) {
            const tplBody = await tplRes.json();
            if (Array.isArray(tplBody.stages)) setTemplateStages(tplBody.stages);
          }
        } catch {
          /* ignore */
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token, processId]);

  useEffect(() => {
    load();
  }, [load]);

  const completeStep = async (step: ProcessStep) => {
    try {
      const res = await fetch(apiUrl(`/processes/steps/${step.id}/complete`), {
        method: "PUT",
        headers: { ...authHeaders() },
      });
      if (!res.ok) throw new Error("Could not complete step.");
      await load();
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not complete step.");
    }
  };

  const nextIncompleteStep = useMemo(
    () => steps.find((s) => s.status === "pending" || s.status === "in_progress"),
    [steps]
  );

  const stepsByTemplateStage = useMemo(() => {
    const map = new Map<number | null, ProcessStep[]>();
    for (const s of steps) {
      // Join via the per-process stage to find the template_stage_id
      const perInstStage = stages.find((st) => st.id === s.stageId);
      const tmplStageId = perInstStage?.templateStageId ?? null;
      if (!map.has(tmplStageId)) map.set(tmplStageId, []);
      map.get(tmplStageId)!.push(s);
    }
    return map;
  }, [steps, stages]);

  if (loading || !processData) {
    return (
      <div className={styles.slideOverlay} onClick={onClose}>
        <div className={styles.slidePanel} onClick={(e) => e.stopPropagation()}>
          {err ? (
            <div className={styles.errorBanner}>{err}</div>
          ) : (
            <div className={styles.loading}>Loading…</div>
          )}
        </div>
      </div>
    );
  }

  const total = steps.length;
  const done = steps.filter((s) => s.status === "completed" || s.status === "skipped").length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const currentTemplateStageIdx = templateStages.findIndex(
    (ts) => Number(ts.id) === Number((processData as ProcessRecord & { currentStageId?: number }).currentStageId)
  );

  return (
    <div className={styles.slideOverlay} onClick={onClose}>
      <div className={styles.slidePanel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.slideHeader}>
          <div className={styles.slideHeaderTitle}>
            <h2>{processData.name}</h2>
            {processData.propertyName ? (
              <div className={styles.slideHeaderSub}>🏠 {processData.propertyName}</div>
            ) : null}
            {processData.contactName ? (
              <div className={styles.slideHeaderSub}>👤 {processData.contactName}</div>
            ) : null}
          </div>
          <button className={styles.slideClose} type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className={styles.slideBody}>
          {err ? <div className={styles.errorBanner}>{err}</div> : null}

          <div className={styles.slideGrid}>
            <div className={styles.slideGridItem}>
              <div className={styles.slideGridLabel}>Template</div>
              <div className={styles.slideGridValue}>{processData.templateName ?? "—"}</div>
            </div>
            <div className={styles.slideGridItem}>
              <div className={styles.slideGridLabel}>Status</div>
              <div className={styles.slideGridValue}>{processData.status}</div>
            </div>
            <div className={styles.slideGridItem}>
              <div className={styles.slideGridLabel}>Started</div>
              <div className={styles.slideGridValue}>
                {new Date(processData.startedAt).toLocaleDateString()}
              </div>
            </div>
            <div className={styles.slideGridItem}>
              <div className={styles.slideGridLabel}>Target</div>
              <div className={styles.slideGridValue}>
                {processData.targetCompletion
                  ? new Date(processData.targetCompletion).toLocaleDateString()
                  : "—"}
              </div>
            </div>
          </div>

          <div>
            <div style={{ fontSize: "0.78rem", color: "#6a737b", marginBottom: "0.2rem" }}>
              Progress: {done} of {total} steps ({pct}%)
            </div>
            <div className={styles.progressBar}>
              <div className={styles.progressFill} style={{ width: `${pct}%` }} />
            </div>
          </div>

          {templateStages.length ? (
            <div className={styles.stageStepper}>
              {templateStages.map((ts, idx) => {
                const isCurrent = idx === currentTemplateStageIdx;
                const isDone = currentTemplateStageIdx > -1 && idx < currentTemplateStageIdx;
                return (
                  <div
                    key={ts.id}
                    className={`${styles.stepperDot} ${isDone ? styles.stepperDotDone : ""} ${
                      isCurrent ? styles.stepperDotActive : ""
                    }`}
                    style={
                      isCurrent
                        ? {
                            background: ts.color || "#0098D0",
                            borderColor: ts.color || "#0098D0",
                            color: ts.textColor || "#fff",
                          }
                        : undefined
                    }
                    title={ts.name}
                  >
                    {isDone ? "✓ " : ""}
                    {ts.name}
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className={styles.slideSection}>
            <h3>Checklist</h3>
            {templateStages.length ? (
              templateStages.map((ts) => {
                const stageSteps = stepsByTemplateStage.get(ts.id) || [];
                if (!stageSteps.length) return null;
                return (
                  <div key={ts.id} className={styles.slideStageGroup}>
                    <div
                      className={styles.slideStageHeader}
                      style={{ background: ts.color || "#e5e7eb", color: ts.textColor || "#1b2856" }}
                    >
                      <span>{ts.name}</span>
                      <span>
                        {stageSteps.filter((s) => s.status === "completed" || s.status === "skipped").length} /{" "}
                        {stageSteps.length}
                      </span>
                    </div>
                    {stageSteps.map((s) => {
                      const isDone = s.status === "completed" || s.status === "skipped";
                      return (
                        <div
                          key={s.id}
                          className={`${styles.slideStepRow} ${isDone ? styles.slideStepRowDone : ""}`}
                        >
                          <button
                            type="button"
                            className={`${styles.taskCheckbox} ${isDone ? styles.taskCheckboxDone : ""}`}
                            onClick={() => !isDone && completeStep(s)}
                            style={{ width: 16, height: 16 }}
                          >
                            {isDone ? "✓" : ""}
                          </button>
                          <span className={styles.slideStepTitle}>{s.name}</span>
                          {s.assignedUserName ? (
                            <span className={styles.slideStepMeta}>{s.assignedUserName}</span>
                          ) : null}
                          {s.dueDate ? (
                            <span className={styles.slideStepMeta}>
                              {new Date(s.dueDate).toLocaleDateString()}
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                );
              })
            ) : (
              // Ungrouped fallback when template has no stages
              steps.map((s) => {
                const isDone = s.status === "completed" || s.status === "skipped";
                return (
                  <div
                    key={s.id}
                    className={`${styles.slideStepRow} ${isDone ? styles.slideStepRowDone : ""}`}
                  >
                    <button
                      type="button"
                      className={`${styles.taskCheckbox} ${isDone ? styles.taskCheckboxDone : ""}`}
                      onClick={() => !isDone && completeStep(s)}
                      style={{ width: 16, height: 16 }}
                    >
                      {isDone ? "✓" : ""}
                    </button>
                    <span className={styles.slideStepTitle}>{s.name}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className={styles.slideActions}>
          {nextIncompleteStep ? (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => completeStep(nextIncompleteStep)}
            >
              ✓ Complete next step
            </button>
          ) : null}
          <Link
            href={`/operations/processes/${processId}`}
            className={`${styles.btn} ${styles.btnGhost}`}
          >
            Full details →
          </Link>
        </div>
      </div>
    </div>
  );
}
