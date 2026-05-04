import { getPool } from "./db.js";

/**
 * Bump last_activity_* on a process. Used by step completion, note add,
 * file upload, stage change, assignee change — anything that should move
 * the aging dot back to green.
 */
export async function bumpActivity(processId, { type, userId } = {}) {
  if (!Number.isFinite(Number(processId))) return;
  try {
    const pool = getPool();
    await pool.query(
      `UPDATE processes SET
         last_activity_at = NOW(),
         last_activity_type = $1,
         last_activity_by = $2,
         updated_at = NOW()
       WHERE id = $3`,
      [type || "update", Number.isFinite(Number(userId)) ? Number(userId) : null, processId]
    );
  } catch (err) {
    console.warn("[activity] bump failed:", err.message);
  }
}

/**
 * Append a row to process_activity_log. Returns the inserted row, or null on failure.
 * Best-effort: never throws — callers shouldn't fail the whole request when audit
 * logging breaks.
 */
export async function logActivity(
  processId,
  { actionType, description, metadata = null, actor = null, actorType = "user" } = {}
) {
  if (!Number.isFinite(Number(processId)) || !actionType || !description) return null;
  try {
    const pool = getPool();
    const actorId =
      actor && Number.isFinite(Number(actor.id)) ? Number(actor.id) : null;
    const actorName =
      actor && typeof actor.displayName === "string"
        ? actor.displayName
        : actor && typeof actor.name === "string"
        ? actor.name
        : null;
    const { rows } = await pool.query(
      `INSERT INTO process_activity_log
         (process_id, action_type, description, metadata,
          actor_type, actor_id, actor_name)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7) RETURNING *`,
      [
        Number(processId),
        actionType,
        description,
        metadata != null ? JSON.stringify(metadata) : null,
        actorType,
        actorId,
        actorName,
      ]
    );
    return rows[0];
  } catch (err) {
    console.warn("[activity] log failed:", err.message);
    return null;
  }
}

/**
 * Record a stage transition: close the current open row's exited_at and open a new
 * row for the new stage. Also stamps processes.stage_entered_at. Best-effort.
 */
export async function recordStageEntry(processId, stageId, { userId } = {}) {
  if (!Number.isFinite(Number(processId))) return;
  try {
    const pool = getPool();
    await pool.query(
      `UPDATE process_stage_history SET exited_at = NOW()
       WHERE process_id = $1 AND exited_at IS NULL`,
      [processId]
    );
    if (!Number.isFinite(Number(stageId))) {
      await pool.query(
        `UPDATE processes SET stage_entered_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [processId]
      );
      return;
    }
    const { rows: stage } = await pool.query(
      `SELECT name FROM process_template_stages WHERE id = $1`,
      [Number(stageId)]
    );
    await pool.query(
      `INSERT INTO process_stage_history
         (process_id, stage_id, stage_name, entered_at, changed_by)
       VALUES ($1, $2, $3, NOW(), $4)`,
      [
        Number(processId),
        Number(stageId),
        stage[0]?.name || null,
        Number.isFinite(Number(userId)) ? Number(userId) : null,
      ]
    );
    await pool.query(
      `UPDATE processes SET stage_entered_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [processId]
    );
  } catch (err) {
    console.warn("[activity] stage history failed:", err.message);
  }
}
