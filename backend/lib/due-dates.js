import { getPool } from "./db.js";

/**
 * Calculate the due date for a step at launch time.
 * Returns an ISO date string (YYYY-MM-DD) or null.
 *
 * Inputs:
 *   type: one of the DUE_DATE_TYPES keys
 *   config: JSON config
 *   ctx: { startedAt: Date, templateStepToProcessStepId: Map<number, number> (optional) }
 */
export function calculateDueDateAtLaunch(type, config = {}, ctx = {}) {
  const startedAt = ctx.startedAt instanceof Date ? ctx.startedAt : new Date();
  const t = type || "offset_from_start";
  switch (t) {
    case "offset_from_start": {
      const days = Number(config.days) || 0;
      const d = new Date(startedAt);
      d.setDate(d.getDate() + days);
      return d.toISOString().slice(0, 10);
    }
    case "fixed_date": {
      const raw = config.date;
      if (typeof raw === "string" && raw.trim()) return raw.slice(0, 10);
      return null;
    }
    case "no_due_date":
      return null;
    case "offset_from_step":
    case "offset_from_stage":
    case "offset_from_field":
    case "same_day_as_step":
      // These depend on future events; initial due_date is null, recalculated later.
      return null;
    default:
      return null;
  }
}

/**
 * Recalculate dependent due dates. Called after:
 *  - A step is completed (look for offset_from_step / same_day_as_step referencing it)
 *  - A stage is completed (offset_from_stage)
 *  - A date field value changes (offset_from_field)
 *
 * Uses a transaction.
 */
export async function recalcDependentDueDates({
  processId,
  completedStepId,
  completedStepTemplateId,
  completedStageId,
  completedStageTemplateId,
  changedFieldDefinitionId,
  changedFieldValue,
}) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // offset_from_step / same_day_as_step — match by completed step's template_step_id
    if (completedStepId) {
      const { rows: completed } = await client.query(
        `SELECT completed_at, template_step_id FROM process_steps WHERE id = $1`,
        [completedStepId]
      );
      const completedAt = completed[0]?.completed_at
        ? new Date(completed[0].completed_at)
        : new Date();
      const tmplStepId = completedStepTemplateId ?? completed[0]?.template_step_id ?? null;
      if (tmplStepId) {
        const { rows: dependents } = await client.query(
          `SELECT id, due_date_type, due_date_config FROM process_steps
           WHERE process_id = $1
             AND due_date_type IN ('offset_from_step','same_day_as_step')
             AND (due_date_config->>'stepId')::int = $2
             AND status NOT IN ('completed','skipped')`,
          [processId, tmplStepId]
        );
        for (const dep of dependents) {
          const cfg = dep.due_date_config || {};
          const d = new Date(completedAt);
          if (dep.due_date_type === "offset_from_step") {
            d.setDate(d.getDate() + (Number(cfg.days) || 0));
          }
          await client.query(
            `UPDATE process_steps SET due_date = $1::date, updated_at = NOW() WHERE id = $2`,
            [d.toISOString().slice(0, 10), dep.id]
          );
        }
      }
    }

    // offset_from_stage — match by completed stage's template_stage_id
    if (completedStageId) {
      const { rows: stg } = await client.query(
        `SELECT completed_at, template_stage_id FROM process_stages WHERE id = $1`,
        [completedStageId]
      );
      const at = stg[0]?.completed_at ? new Date(stg[0].completed_at) : new Date();
      const tmplStageId = completedStageTemplateId ?? stg[0]?.template_stage_id ?? null;
      if (tmplStageId) {
        const { rows: dependents } = await client.query(
          `SELECT id, due_date_config FROM process_steps
           WHERE process_id = $1
             AND due_date_type = 'offset_from_stage'
             AND (due_date_config->>'stageId')::int = $2
             AND status NOT IN ('completed','skipped')`,
          [processId, tmplStageId]
        );
        for (const dep of dependents) {
          const cfg = dep.due_date_config || {};
          const d = new Date(at);
          d.setDate(d.getDate() + (Number(cfg.days) || 0));
          await client.query(
            `UPDATE process_steps SET due_date = $1::date, updated_at = NOW() WHERE id = $2`,
            [d.toISOString().slice(0, 10), dep.id]
          );
        }
      }
    }

    // offset_from_field — recalc when a date field value changes
    if (changedFieldDefinitionId && changedFieldValue) {
      const base = new Date(changedFieldValue);
      if (!isNaN(base.getTime())) {
        const { rows: dependents } = await client.query(
          `SELECT id, due_date_config FROM process_steps
           WHERE process_id = $1
             AND due_date_type = 'offset_from_field'
             AND (due_date_config->>'fieldDefinitionId')::int = $2
             AND status NOT IN ('completed','skipped')`,
          [processId, changedFieldDefinitionId]
        );
        for (const dep of dependents) {
          const cfg = dep.due_date_config || {};
          const d = new Date(base);
          const days = Number(cfg.days) || 0;
          const direction = cfg.direction === "before" ? -1 : 1;
          d.setDate(d.getDate() + days * direction);
          await client.query(
            `UPDATE process_steps SET due_date = $1::date, updated_at = NOW() WHERE id = $2`,
            [d.toISOString().slice(0, 10), dep.id]
          );
        }
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.warn("[due-dates] recalc failed:", err.message);
  } finally {
    client.release();
  }
}
