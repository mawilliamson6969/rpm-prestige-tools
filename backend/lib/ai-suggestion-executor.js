import { getPool } from "./db.js";
import { logActivity, recordStageEntry } from "./process-activity.js";
import { executeImmediateSendsForStage } from "./process-messaging.js";

/**
 * Phase 6 — execute an accepted AI suggestion.
 *
 * Returns a structured result the frontend can interpret. For email/text
 * actions we do NOT auto-send: we hand the prefill to the UI so the operator
 * confirms before it goes out. Stage changes and reassignments execute
 * immediately because they're trivially reversible.
 */
export async function executeSuggestion(suggestionId, userId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM process_ai_suggestions WHERE id = $1`,
    [suggestionId]
  );
  const suggestion = rows[0];
  if (!suggestion) return { action: "not_found" };
  // Only run when transitioning into accepted; idempotent for re-clicks.
  if (suggestion.status !== "accepted" && suggestion.status !== "pending") {
    return { action: "already_handled", status: suggestion.status };
  }

  const payload = suggestion.action_payload || {};
  const processId = suggestion.process_id;

  switch (suggestion.action_type) {
    case "send_email":
      return {
        action: "open_email_composer",
        processId,
        prefill: {
          recipientType:
            typeof payload.recipientType === "string" ? payload.recipientType : "tenant",
          subject: payload.suggestedSubject || "",
          body: payload.suggestedBody || "",
        },
      };

    case "send_text":
      return {
        action: "open_text_composer",
        processId,
        prefill: {
          recipientType:
            typeof payload.recipientType === "string" ? payload.recipientType : "tenant",
          body: payload.suggestedBody || "",
        },
      };

    case "change_stage": {
      const targetName =
        typeof payload.suggestedStage === "string" ? payload.suggestedStage.trim() : "";
      if (!targetName) return { action: "stage_not_found" };
      const { rows: stage } = await pool.query(
        `SELECT s.id, s.name, s.is_final
         FROM process_template_stages s
         JOIN processes p ON p.template_id = s.template_id
         WHERE p.id = $1 AND LOWER(s.name) = LOWER($2)
         LIMIT 1`,
        [processId, targetName]
      );
      if (!stage.length) {
        return { action: "stage_not_found", suggestedStage: targetName };
      }
      const stageRow = stage[0];
      const { rows: prevRows } = await pool.query(
        `SELECT current_stage_id FROM processes WHERE id = $1`,
        [processId]
      );
      const prevStageId = prevRows[0]?.current_stage_id ?? null;
      await pool.query(
        `UPDATE processes SET
           current_stage_id = $1,
           stage_entered_at = NOW(),
           status = CASE WHEN $2 THEN 'completed' ELSE status END,
           completed_at = CASE WHEN $2 THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
           last_activity_at = NOW(),
           last_activity_type = 'ai_stage_changed',
           last_activity_by = $3,
           updated_at = NOW()
         WHERE id = $4`,
        [stageRow.id, !!stageRow.is_final, userId ?? null, processId]
      );
      // Best-effort logging + side effects.
      try {
        await recordStageEntry(processId, stageRow.id, { userId });
        await logActivity(processId, {
          actionType: "stage_changed",
          description: `AI suggestion: moved to stage ${stageRow.name}`,
          metadata: { suggestionId, fromStageId: prevStageId, toStageId: stageRow.id },
          actorType: "ai",
          actor: { id: userId ?? null },
        });
        await executeImmediateSendsForStage(processId, stageRow.id, {
          actorUserId: userId ?? null,
        });
      } catch (err) {
        console.warn("[ai-suggestion] stage-change side effects failed:", err.message);
      }
      return { action: "stage_changed", stageId: stageRow.id, stageName: stageRow.name };
    }

    case "reassign": {
      const toName =
        typeof payload.toUser === "string" ? payload.toUser.trim() : "";
      if (!toName) return { action: "user_not_found" };
      const { rows: user } = await pool.query(
        `SELECT id, display_name, username FROM users
         WHERE LOWER(display_name) = LOWER($1) OR LOWER(username) = LOWER($1)
         LIMIT 1`,
        [toName]
      );
      if (!user.length) return { action: "user_not_found", suggestedUser: toName };
      const targetId = user[0].id;
      // Reassign all currently-incomplete steps on this process to that user.
      const { rowCount } = await pool.query(
        `UPDATE process_steps
         SET assigned_user_id = $1, updated_at = NOW()
         WHERE process_id = $2 AND status NOT IN ('completed','skipped')`,
        [targetId, processId]
      );
      try {
        await logActivity(processId, {
          actionType: "assignee_changed",
          description: `AI suggestion: reassigned ${rowCount} step${
            rowCount === 1 ? "" : "s"
          } to ${user[0].display_name}`,
          metadata: { suggestionId, toUserId: targetId, count: rowCount },
          actorType: "ai",
          actor: { id: userId ?? null },
        });
      } catch {
        /* ignore */
      }
      return {
        action: "reassigned",
        toUserId: targetId,
        toUserName: user[0].display_name,
        stepsTouched: rowCount,
      };
    }

    case "create_process":
      return {
        action: "prompt_create_process",
        processId,
        templateName:
          typeof payload.templateName === "string" ? payload.templateName : null,
        reason: typeof payload.reason === "string" ? payload.reason : null,
      };

    default:
      return { action: "no_action" };
  }
}
