import { getPool } from "./db.js";
import { logActivity, recordStageEntry } from "./process-activity.js";
import { executeImmediateSendsForStage } from "./process-messaging.js";

/**
 * Phase 7.4.1: dispatcher for auto stage-change steps.
 *
 * A step with kind='stagechange' and actor='auto' has no `auto_action`, so the
 * auto_action-keyed automation runner never touches it. Left alone it sits
 * incomplete in its stage forever, which also stalls the linear stage
 * auto-advance (the stage never empties). This cron finds those steps once they
 * are the next actionable item in the process's active stage and:
 *   1. completes the step (unblocking dependents),
 *   2. moves the process to the target stage — an explicit target from
 *      branch_config if set (forward-compat for the future target editor),
 *      otherwise the next template stage by order,
 *   3. records stage history + activity and fires the target stage's
 *      immediate email/SMS sends — mirroring PUT /processes/:id/stage.
 *
 * Idempotent: completing the step (status -> completed) is the guard, so a
 * re-run cannot double-fire. Best-effort and isolated per step.
 */

const TARGET_KEYS = [
  "target_stage_id",
  "targetStageId",
  "target_stage",
  "stage_id",
  "stageId",
];

function parseBranchConfig(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function explicitTargetStageId(branchConfig) {
  const cfg = parseBranchConfig(branchConfig);
  for (const key of TARGET_KEYS) {
    const n = Number.parseInt(cfg?.[key], 10);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

async function resolveTargetStage(pool, candidate) {
  // Explicit target wins, but must be a real stage of this process's template.
  const explicit = explicitTargetStageId(candidate.branch_config);
  if (explicit != null && explicit !== candidate.current_stage_id) {
    const { rows } = await pool.query(
      `SELECT id, is_final FROM process_template_stages
       WHERE id = $1 AND template_id = $2`,
      [explicit, candidate.template_id]
    );
    if (rows.length) {
      return { id: rows[0].id, isFinal: rows[0].is_final === true };
    }
  }
  // Default: the next template stage by order after the step's own stage.
  const { rows } = await pool.query(
    `SELECT id, is_final FROM process_template_stages
     WHERE template_id = $1 AND stage_order > $2
     ORDER BY stage_order ASC, id ASC
     LIMIT 1`,
    [candidate.template_id, candidate.current_stage_order ?? -1]
  );
  if (rows.length) return { id: rows[0].id, isFinal: rows[0].is_final === true };
  return null;
}

export async function executeAutoStageChanges() {
  const pool = getPool();
  let candidates;
  try {
    const { rows } = await pool.query(
      `SELECT s.id AS step_id, s.process_id, s.name AS step_name,
              s.branch_config, s.step_number,
              ts.stage_id AS step_template_stage_id,
              p.template_id, p.current_stage_id, p.status AS process_status,
              cs.stage_order AS current_stage_order
       FROM process_steps s
       JOIN processes p ON p.id = s.process_id
       JOIN process_template_steps ts ON ts.id = s.template_step_id
       LEFT JOIN process_template_stages cs ON cs.id = p.current_stage_id
       WHERE s.kind = 'stagechange'
         AND s.actor = 'auto'
         AND s.status NOT IN ('completed','skipped','blocked')
         AND p.status = 'active'
         AND ts.stage_id IS NOT NULL
         AND ts.stage_id = p.current_stage_id
         AND NOT EXISTS (
           SELECT 1 FROM process_steps s2
           JOIN process_template_steps ts2 ON ts2.id = s2.template_step_id
           WHERE s2.process_id = s.process_id
             AND ts2.stage_id = ts.stage_id
             AND s2.status NOT IN ('completed','skipped')
             AND s2.step_number < s.step_number
         )
       ORDER BY s.process_id ASC, s.step_number ASC
       LIMIT 50`
    );
    candidates = rows;
  } catch (err) {
    console.warn("[auto-stage] query failed:", err.message);
    return { advanced: 0, completed: 0, failed: 0 };
  }

  let advanced = 0;
  let completed = 0;
  let failed = 0;

  for (const c of candidates) {
    let target = null;
    try {
      target = await resolveTargetStage(pool, c);
    } catch (err) {
      console.warn(
        `[auto-stage] target resolve failed for step ${c.step_id}:`,
        err.message
      );
      failed += 1;
      continue;
    }

    const client = await pool.connect();
    let didComplete = false;
    let didAdvance = false;
    try {
      await client.query("BEGIN");
      const { rows: done } = await client.query(
        `UPDATE process_steps
         SET status = 'completed', completed_at = NOW(), completed_by = NULL,
             updated_at = NOW()
         WHERE id = $1 AND status NOT IN ('completed','skipped')
         RETURNING id`,
        [c.step_id]
      );
      if (!done.length) {
        await client.query("ROLLBACK");
        continue; // already handled by a concurrent run
      }
      didComplete = true;

      await client.query(
        `UPDATE process_steps SET status = 'pending', updated_at = NOW()
         WHERE depends_on_step_id = $1 AND status = 'blocked'`,
        [c.step_id]
      );

      const moving =
        target && Number.isFinite(target.id) && target.id !== c.current_stage_id;
      if (moving) {
        await client.query(
          `UPDATE processes SET
             current_stage_id = $1,
             status = CASE WHEN $2 THEN 'completed' ELSE status END,
             completed_at = CASE WHEN $2 THEN COALESCE(completed_at, NOW())
                                 ELSE completed_at END,
             last_activity_at = NOW(),
             last_activity_type = 'stage_changed',
             updated_at = NOW()
           WHERE id = $3`,
          [target.id, target.isFinal === true, c.process_id]
        );
        // Keep the per-instance process_stages mirror consistent.
        await client.query(
          `UPDATE process_stages SET status = 'completed', completed_at = NOW()
           WHERE process_id = $1 AND template_stage_id = $2 AND status <> 'completed'`,
          [c.process_id, c.step_template_stage_id]
        );
        await client.query(
          `UPDATE process_stages
           SET status = 'active', started_at = COALESCE(started_at, NOW())
           WHERE process_id = $1 AND template_stage_id = $2 AND status = 'pending'`,
          [c.process_id, target.id]
        );
      } else {
        // No forward target (last stage): if all steps are now done, finish.
        const { rows: rem } = await client.query(
          `SELECT COUNT(*)::int AS c FROM process_steps
           WHERE process_id = $1 AND status NOT IN ('completed','skipped')`,
          [c.process_id]
        );
        if (rem[0].c === 0) {
          await client.query(
            `UPDATE processes
             SET status = 'completed', completed_at = COALESCE(completed_at, NOW()),
                 updated_at = NOW()
             WHERE id = $1`,
            [c.process_id]
          );
        }
      }
      await client.query("COMMIT");
      didAdvance = moving;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.warn(
        `[auto-stage] step ${c.step_id} (process ${c.process_id}) failed:`,
        err.message
      );
      failed += 1;
      client.release();
      continue;
    }
    client.release();

    if (didComplete) completed += 1;
    if (didAdvance) advanced += 1;

    // Out-of-transaction side effects mirror PUT /processes/:id/stage.
    try {
      await logActivity(c.process_id, {
        actionType: "step_completed",
        description: `Auto stage-change step completed: ${c.step_name}`,
        metadata: { stepId: c.step_id, kind: "stagechange" },
        actorType: "automation",
      });
      if (didAdvance && target) {
        await recordStageEntry(c.process_id, target.id, { userId: null });
        await logActivity(c.process_id, {
          actionType: "stage_changed",
          description: "Auto-advanced via stage-change step",
          metadata: {
            fromStageId: c.current_stage_id,
            toStageId: target.id,
            stepId: c.step_id,
          },
          actorType: "automation",
        });
        await executeImmediateSendsForStage(c.process_id, target.id, {
          actorUserId: null,
        });
      }
    } catch (err) {
      console.warn(
        `[auto-stage] post-advance tasks failed for process ${c.process_id}:`,
        err.message
      );
    }
  }

  if (advanced || completed || failed) {
    console.log(
      `[auto-stage] completed=${completed} advanced=${advanced} failed=${failed}`
    );
  }
  return { advanced, completed, failed };
}
