import { getPool } from "./db.js";
import { graphPost } from "./inbox/graph-client.js";
import { getValidAccessTokenForConnection } from "./inbox/microsoft-auth.js";

/**
 * Phase 6 — Daily AI Digest.
 *
 * 6:30 AM Central email summarising overdue processes, pending AI
 * suggestions, team workload, and yesterday's activity. Sent through the
 * existing Microsoft Graph connection (same path Phase 3 uses for outbound
 * emails). Best-effort: if no recipient email or no Graph connection,
 * we no-op rather than spam an error log.
 */

const DIGEST_RECIPIENT = process.env.AI_DIGEST_RECIPIENT?.trim();

async function gatherDigest(pool) {
  const { rows: overdue } = await pool.query(
    `SELECT p.id, p.name, p.property_name, p.target_completion,
            t.name AS template_name, s.name AS stage_name,
            EXTRACT(DAY FROM NOW() - p.stage_entered_at)::int AS days_in_stage
     FROM processes p
     LEFT JOIN process_templates t ON t.id = p.template_id
     LEFT JOIN process_template_stages s ON s.id = p.current_stage_id
     WHERE p.status = 'active'
       AND p.archived_at IS NULL AND p.deleted_at IS NULL
       AND ((p.target_completion IS NOT NULL AND p.target_completion < CURRENT_DATE)
            OR (p.stage_entered_at < NOW() - INTERVAL '14 days'))
     ORDER BY p.target_completion ASC NULLS LAST,
              p.stage_entered_at ASC NULLS LAST
     LIMIT 10`
  );

  const { rows: suggestions } = await pool.query(
    `SELECT s.title, s.description, s.confidence, s.suggestion_type,
            p.property_name, p.id AS process_id, t.name AS template_name
     FROM process_ai_suggestions s
     JOIN processes p ON p.id = s.process_id
     LEFT JOIN process_templates t ON t.id = p.template_id
     WHERE s.status = 'pending'
     ORDER BY s.confidence DESC NULLS LAST, s.created_at DESC
     LIMIT 8`
  );

  const { rows: workload } = await pool.query(
    `SELECT u.display_name AS name, u.role,
            COUNT(s.id) FILTER (
              WHERE s.assigned_user_id = u.id
                AND s.status NOT IN ('completed','skipped')
                AND p.status = 'active'
                AND p.archived_at IS NULL AND p.deleted_at IS NULL
            )::int AS active_tasks,
            COUNT(s.id) FILTER (
              WHERE s.assigned_user_id = u.id
                AND s.status NOT IN ('completed','skipped')
                AND p.status = 'active'
                AND s.due_date < CURRENT_DATE
                AND p.archived_at IS NULL AND p.deleted_at IS NULL
            )::int AS overdue_tasks
     FROM users u
     LEFT JOIN process_steps s ON s.assigned_user_id = u.id
     LEFT JOIN processes p ON p.id = s.process_id
     GROUP BY u.id, u.display_name, u.role
     HAVING COALESCE(SUM(CASE WHEN s.id IS NOT NULL THEN 1 ELSE 0 END), 0) > 0
     ORDER BY active_tasks DESC`
  );

  const { rows: yesterday } = await pool.query(
    `SELECT
       COUNT(*) FILTER (
         WHERE action_type IN ('step_completed','step_skipped')
       )::int AS steps_completed,
       COUNT(*) FILTER (
         WHERE action_type = 'process_created' AND actor_type = 'automation'
       )::int AS autopilot_created,
       COUNT(*) FILTER (WHERE action_type = 'email_sent')::int AS emails_sent,
       COUNT(*) FILTER (WHERE action_type = 'text_sent')::int AS texts_sent
     FROM process_activity_log
     WHERE created_at >= NOW() - INTERVAL '1 day'`
  );
  const { rows: completed } = await pool.query(
    `SELECT COUNT(*)::int AS c
     FROM processes
     WHERE status = 'completed'
       AND completed_at >= NOW() - INTERVAL '1 day'`
  );

  return {
    overdue,
    suggestions,
    workload,
    yesterday: { ...yesterday[0], processes_completed: completed[0]?.c ?? 0 },
  };
}

function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function capacityLabel(active, overdue) {
  const score = active * 5 + overdue * 15;
  if (score >= 80) return "⚠️ Over capacity";
  if (score >= 50) return "High load";
  if (score >= 20) return "Normal";
  return "✅ Available";
}

function renderHtml(d) {
  const dateLabel = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const overdueRows = d.overdue.length
    ? d.overdue
        .map((p) => {
          const meta = [
            p.template_name,
            p.property_name || p.name,
            p.stage_name ? `${p.days_in_stage}d in ${p.stage_name}` : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return `<li>${escapeHtml(meta)}</li>`;
        })
        .join("")
    : `<li style="color:#6a737b">No overdue processes 🎉</li>`;
  const suggestionRows = d.suggestions.length
    ? d.suggestions
        .map((s) => {
          const conf = s.confidence != null ? ` (${Math.round(s.confidence * 100)}% conf.)` : "";
          return `<li><strong>${escapeHtml(s.title)}</strong>${conf} — ${escapeHtml(
            s.description || ""
          )}<br><span style="color:#6a737b;font-size:12px">${escapeHtml(
            s.template_name || ""
          )} · ${escapeHtml(s.property_name || "")}</span></li>`;
        })
        .join("")
    : `<li style="color:#6a737b">No pending suggestions.</li>`;
  const workloadRows = d.workload.length
    ? d.workload
        .map(
          (w) =>
            `<li><strong>${escapeHtml(w.name)}</strong>${
              w.role ? ` (${escapeHtml(w.role)})` : ""
            }: ${w.active_tasks} task${w.active_tasks === 1 ? "" : "s"}, ${w.overdue_tasks} overdue — ${capacityLabel(
              w.active_tasks,
              w.overdue_tasks
            )}</li>`
        )
        .join("")
    : `<li style="color:#6a737b">No active assignments.</li>`;
  const y = d.yesterday;
  return `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1B2856;max-width:640px;margin:0 auto;padding:24px">
  <h2 style="color:#1B2856;margin:0 0 4px">PrestigeDash AI Daily Digest</h2>
  <div style="color:#6a737b;font-size:13px;margin-bottom:24px">${escapeHtml(dateLabel)}</div>

  <h3 style="color:#B32317;font-size:14px;margin:0 0 8px">🔴 OVERDUE PROCESSES (${d.overdue.length})</h3>
  <ul style="margin:0 0 24px;padding-left:20px;font-size:13px">${overdueRows}</ul>

  <h3 style="color:#6C5CE7;font-size:14px;margin:0 0 8px">✨ AI SUGGESTIONS (${d.suggestions.length} pending)</h3>
  <ul style="margin:0 0 24px;padding-left:20px;font-size:13px">${suggestionRows}</ul>

  <h3 style="color:#0098D0;font-size:14px;margin:0 0 8px">👥 TEAM WORKLOAD</h3>
  <ul style="margin:0 0 24px;padding-left:20px;font-size:13px">${workloadRows}</ul>

  <h3 style="color:#10b981;font-size:14px;margin:0 0 8px">📊 YESTERDAY</h3>
  <ul style="margin:0 0 24px;padding-left:20px;font-size:13px">
    <li>${y.steps_completed ?? 0} steps completed</li>
    <li>${y.processes_completed ?? 0} process${(y.processes_completed ?? 0) === 1 ? "" : "es"} completed</li>
    <li>${y.autopilot_created ?? 0} auto-created by Autopilot</li>
    <li>${y.emails_sent ?? 0} emails, ${y.texts_sent ?? 0} texts sent</li>
  </ul>

  <p style="font-size:13px;color:#6a737b">
    <a href="https://dashboard.prestigedash.com/operations" style="color:#0098D0">Open the dashboard →</a>
  </p>
</body></html>`;
}

async function pickConnection(pool) {
  const { rows } = await pool.query(
    `SELECT * FROM email_connections WHERE is_active = true ORDER BY id ASC LIMIT 1`
  );
  return rows[0] || null;
}

export async function sendDailyDigest({ to } = {}) {
  const recipient = (to || DIGEST_RECIPIENT || "").trim();
  if (!recipient) {
    console.warn("[ai-digest] no recipient set (AI_DIGEST_RECIPIENT) — skipping");
    return { skipped: "no_recipient" };
  }
  const pool = getPool();
  const conn = await pickConnection(pool);
  if (!conn) {
    console.warn("[ai-digest] no active Microsoft connection — skipping");
    return { skipped: "no_email_connection" };
  }
  const data = await gatherDigest(pool);
  const html = renderHtml(data);
  const subject = `PrestigeDash AI Daily Digest — ${new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })}`;

  const { accessToken } = await getValidAccessTokenForConnection(conn.id);
  const path =
    conn.mailbox_type === "shared" && conn.mailbox_email
      ? `/users/${encodeURIComponent(conn.mailbox_email)}/sendMail`
      : "/me/sendMail";
  await graphPost(path, accessToken, {
    message: {
      subject,
      body: { contentType: "HTML", content: html },
      toRecipients: [{ emailAddress: { address: recipient } }],
    },
    saveToSentItems: false,
  });
  console.log(`[ai-digest] sent to ${recipient}`);
  return { sent: true };
}
