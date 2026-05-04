import { getPool } from "./db.js";
import {
  resolveRecipient,
  sendProcessEmail,
  sendProcessSMS,
} from "./process-messaging.js";

/**
 * Phase 4: cron-driven sender for steps that Phase 3 scheduled with a delay.
 * Phase 3 stamps process_steps.scheduled_send_at when send_timing != 'immediately';
 * this fires those when their time arrives.
 *
 * Best-effort and idempotent: marks sent_at on success and stores a friendly
 * automation_error on failure so the next run can retry or surface the issue.
 */
export async function executeScheduledSteps() {
  const pool = getPool();
  let due;
  try {
    const { rows } = await pool.query(
      `SELECT s.*, p.status AS process_status
       FROM process_steps s
       JOIN processes p ON p.id = s.process_id
       WHERE s.scheduled_send_at IS NOT NULL
         AND s.scheduled_send_at <= NOW()
         AND s.sent_at IS NULL
         AND s.status NOT IN ('completed','skipped')
         AND COALESCE(s.task_type, 'todo') IN ('email','sms')
       ORDER BY s.scheduled_send_at ASC
       LIMIT 50`
    );
    due = rows;
  } catch (err) {
    console.warn("[scheduled-steps] query failed:", err.message);
    return { executed: 0, failed: 0, cancelled: 0 };
  }
  let executed = 0;
  let failed = 0;
  let cancelled = 0;

  for (const step of due) {
    if (step.process_status !== "active") {
      // Process is paused/completed/cancelled — drop the schedule.
      try {
        await pool.query(
          `UPDATE process_steps SET scheduled_send_at = NULL, updated_at = NOW() WHERE id = $1`,
          [step.id]
        );
        cancelled += 1;
      } catch {
        /* ignore */
      }
      continue;
    }
    try {
      const recipient = await resolveRecipient({
        processId: step.process_id,
        recipientType: step.recipient_type || "tenant",
        recipientValue: step.recipient_value,
      });
      let result = null;
      if (step.task_type === "email") {
        if (!recipient.email) throw new Error("No recipient email available.");
        result = await sendProcessEmail({
          processId: step.process_id,
          templateId: step.email_template_id,
          to: recipient.email,
          toName: recipient.name,
          senderId: null,
        });
      } else if (step.task_type === "sms") {
        if (!recipient.phone) throw new Error("No recipient phone available.");
        result = await sendProcessSMS({
          processId: step.process_id,
          templateId: step.text_template_id,
          to: recipient.phone,
          senderId: null,
        });
      }
      if (result?.communication) {
        await pool.query(
          `UPDATE process_steps SET
             status = 'completed',
             completed_at = NOW(),
             sent_at = NOW(),
             sent_communication_id = $1,
             scheduled_send_at = NULL,
             automation_error = NULL,
             updated_at = NOW()
           WHERE id = $2`,
          [result.communication.id, step.id]
        );
        executed += 1;
      }
    } catch (err) {
      failed += 1;
      console.warn(`[scheduled-steps] step ${step.id} failed:`, err.message);
      try {
        await pool.query(
          `UPDATE process_steps
           SET automation_status = 'failed',
               automation_error = $1,
               updated_at = NOW()
           WHERE id = $2`,
          [String(err.message || err).slice(0, 500), step.id]
        );
      } catch {
        /* ignore */
      }
    }
  }
  if (executed || failed || cancelled) {
    console.log(
      `[scheduled-steps] executed=${executed} cancelled=${cancelled} failed=${failed}`
    );
  }
  return { executed, failed, cancelled };
}
