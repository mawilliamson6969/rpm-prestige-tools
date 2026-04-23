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
