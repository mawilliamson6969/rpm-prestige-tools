import { createReadStream } from "fs";
import { statSync } from "fs";
import path from "path";
import { getPool } from "../lib/db.js";
import { generateSubmissionPdf } from "../lib/form-pdf.js";
import {
  exportSubmissionsCsv,
  exportSubmissionsXlsx,
  exportSubmissionsPdfZip,
} from "../lib/form-export.js";
import {
  executeFormAutomations,
  testAutomation as testAutomationAction,
  FORM_ACTION_TYPES,
  FORM_TRIGGER_TYPES,
} from "../lib/form-automations.js";

const ANALYTICS_EVENT_TYPES = new Set([
  "form_view", "form_start", "page_view", "page_drop",
  "field_focus", "field_error", "form_submit", "form_abandon",
]);

/** Public analytics event ingestion (no auth). */
export async function postPublicAnalytics(req, res) {
  const slug = typeof req.params.slug === "string" ? req.params.slug.trim() : "";
  const { eventType, eventData, sessionId, durationMs } = req.body || {};
  if (!ANALYTICS_EVENT_TYPES.has(eventType)) {
    return res.status(400).json({ error: "Invalid event type." });
  }
  const sid = typeof sessionId === "string" ? sessionId.slice(0, 64) : null;
  try {
    const pool = getPool();
    const { rows } = await pool.query(`SELECT id FROM forms WHERE slug = $1`, [slug]);
    if (!rows.length) return res.status(404).json({ error: "Form not found." });
    const formId = rows[0].id;

    if (sid) {
      const { rows: existing } = await pool.query(
        `SELECT COUNT(*)::int AS c FROM form_analytics
         WHERE form_id = $1 AND session_id = $2`,
        [formId, sid]
      );
      if (existing[0].c > 100) {
        return res.status(429).json({ error: "Rate limit exceeded." });
      }
    }

    await pool.query(
      `INSERT INTO form_analytics (form_id, event_type, event_data, session_id, duration_ms)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        formId, eventType,
        eventData && typeof eventData === "object" ? eventData : null,
        sid,
        Number.isFinite(Number.parseInt(durationMs, 10)) ? Number.parseInt(durationMs, 10) : null,
      ]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("[form analytics]", e);
    res.status(500).json({ error: "Could not log event." });
  }
}

/** Analytics dashboard aggregation (JWT). Replaces the simple Phase 2 handler. */
export async function getFormAnalyticsV2(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid form id." });
  const fromParam = typeof req.query.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from)
    ? req.query.from : null;
  const toParam = typeof req.query.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to)
    ? req.query.to : null;
  try {
    const pool = getPool();
    const { rows: formRows } = await pool.query(
      `SELECT id, name, views_count, submissions_count FROM forms WHERE id = $1`, [id]
    );
    if (!formRows.length) return res.status(404).json({ error: "Form not found." });

    const filters = [`form_id = $1`];
    const vals = [id];
    let n = 2;
    if (fromParam) { filters.push(`created_at >= $${n++}::date`); vals.push(fromParam); }
    if (toParam) { filters.push(`created_at <= ($${n++}::date + INTERVAL '1 day')`); vals.push(toParam); }
    const whereEvents = filters.join(" AND ");

    // Event counts
    const { rows: counts } = await pool.query(
      `SELECT event_type, COUNT(*)::int AS c FROM form_analytics
       WHERE ${whereEvents} GROUP BY event_type`,
      vals
    );
    const countMap = Object.fromEntries(counts.map((r) => [r.event_type, r.c]));
    const totalViews = countMap.form_view || 0;
    const totalStarts = countMap.form_start || 0;
    const totalSubmissions = countMap.form_submit || 0;
    const totalAbandons = countMap.form_abandon || 0;
    const conversionRate = totalViews > 0 ? (totalSubmissions / totalViews) * 100 : 0;
    const startToSubmitRate = totalStarts > 0 ? (totalSubmissions / totalStarts) * 100 : 0;
    const abandonRate = totalStarts > 0 ? (totalAbandons / totalStarts) * 100 : 0;

    // Average completion time from sessions that both started and submitted
    const { rows: completionRows } = await pool.query(
      `SELECT AVG(EXTRACT(EPOCH FROM (submit_at - start_at)))::int AS avg_seconds
       FROM (
         SELECT session_id,
                MIN(CASE WHEN event_type = 'form_start' THEN created_at END) AS start_at,
                MIN(CASE WHEN event_type = 'form_submit' THEN created_at END) AS submit_at
         FROM form_analytics
         WHERE ${whereEvents} AND session_id IS NOT NULL
         GROUP BY session_id
       ) s WHERE start_at IS NOT NULL AND submit_at IS NOT NULL`,
      vals
    );
    const avgCompletionTimeSeconds = completionRows[0]?.avg_seconds || 0;

    // Over time (daily)
    const { rows: overTime } = await pool.query(
      `SELECT TO_CHAR(DATE_TRUNC('day', created_at), 'YYYY-MM-DD') AS date,
              SUM(CASE WHEN event_type = 'form_view' THEN 1 ELSE 0 END)::int AS views,
              SUM(CASE WHEN event_type = 'form_start' THEN 1 ELSE 0 END)::int AS starts,
              SUM(CASE WHEN event_type = 'form_submit' THEN 1 ELSE 0 END)::int AS submissions
       FROM form_analytics WHERE ${whereEvents}
       GROUP BY date ORDER BY date ASC`,
      vals
    );

    // By page (multi-step)
    const { rows: pages } = await pool.query(
      `SELECT id, title, page_order FROM form_pages WHERE form_id = $1 ORDER BY page_order ASC`,
      [id]
    );
    const byPage = [];
    for (const p of pages) {
      const { rows: pageCounts } = await pool.query(
        `SELECT event_type, COUNT(*)::int AS c FROM form_analytics
         WHERE ${whereEvents} AND event_type IN ('page_view','page_drop')
         AND (event_data->>'pageId')::int = $${n}
         GROUP BY event_type`,
        [...vals, p.id]
      );
      const pcMap = Object.fromEntries(pageCounts.map((r) => [r.event_type, r.c]));
      const views = pcMap.page_view || 0;
      const drops = pcMap.page_drop || 0;
      const completions = Math.max(0, views - drops);
      byPage.push({
        page: p.page_order,
        pageId: p.id,
        pageTitle: p.title || `Page ${p.page_order + 1}`,
        views,
        completions,
        dropRate: views > 0 ? Math.round((drops / views) * 1000) / 10 : 0,
      });
    }

    // By field (top 10 error rates)
    const { rows: fieldRows } = await pool.query(
      `SELECT event_data->>'fieldKey' AS field_key,
              COUNT(*)::int AS errors
       FROM form_analytics
       WHERE ${whereEvents} AND event_type = 'field_error'
         AND event_data->>'fieldKey' IS NOT NULL
       GROUP BY field_key ORDER BY errors DESC LIMIT 10`,
      vals
    );
    const byField = [];
    if (fieldRows.length) {
      const keys = fieldRows.map((r) => r.field_key);
      const { rows: fieldMeta } = await pool.query(
        `SELECT field_key, label FROM form_fields WHERE form_id = $1 AND field_key = ANY($2::text[])`,
        [id, keys]
      );
      const labelMap = Object.fromEntries(fieldMeta.map((r) => [r.field_key, r.label]));
      for (const r of fieldRows) {
        byField.push({
          fieldKey: r.field_key,
          label: labelMap[r.field_key] || r.field_key,
          errorCount: r.errors,
        });
      }
    }

    // Top referrers
    const { rows: referrers } = await pool.query(
      `SELECT COALESCE(NULLIF(event_data->>'referrer', ''), 'direct') AS referrer, COUNT(*)::int AS c
       FROM form_analytics
       WHERE ${whereEvents} AND event_type = 'form_view'
       GROUP BY referrer ORDER BY c DESC LIMIT 5`,
      vals
    );

    res.json({
      summary: {
        totalViews,
        totalStarts,
        totalSubmissions,
        totalAbandons,
        conversionRate: Math.round(conversionRate * 10) / 10,
        startToSubmitRate: Math.round(startToSubmitRate * 10) / 10,
        abandonRate: Math.round(abandonRate * 10) / 10,
        avgCompletionTimeSeconds,
      },
      overTime,
      byPage,
      byField,
      topReferrers: referrers.map((r) => ({ referrer: r.referrer, count: r.c })),
    });
  } catch (e) {
    console.error("[form analytics v2]", e);
    res.status(500).json({ error: "Could not load analytics." });
  }
}

/** Serve a submission PDF (JWT). Regenerates if missing. */
export async function getSubmissionPdf(req, res) {
  const id = Number.parseInt(req.params.submissionId, 10);
  if (!Number.isFinite(id)) return res.status(400).send("Invalid submission id.");
  try {
    const pdf = await generateSubmissionPdf(id);
    const stat = statSync(pdf.filePath);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${pdf.fileName}"`);
    res.setHeader("Content-Length", stat.size);
    createReadStream(pdf.filePath).pipe(res);
  } catch (e) {
    console.error("[submission pdf]", e);
    res.status(500).send("Could not generate PDF.");
  }
}

/** Exports */
export async function getSubmissionsExport(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).send("Invalid form id.");
  const format = (typeof req.query.format === "string" ? req.query.format : "csv").toLowerCase();
  const filters = {
    status: typeof req.query.status === "string" && req.query.status !== "all" ? req.query.status : null,
    from: typeof req.query.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : null,
    to: typeof req.query.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : null,
  };
  try {
    if (format === "xlsx" || format === "excel") {
      const out = await exportSubmissionsXlsx(id, filters);
      res.setHeader("Content-Type", out.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${out.filename}"`);
      return res.send(out.buffer);
    }
    if (format === "csv") {
      const out = await exportSubmissionsCsv(id, filters);
      res.setHeader("Content-Type", out.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${out.filename}"`);
      return res.send(out.buffer);
    }
    res.status(400).send("Unsupported format.");
  } catch (e) {
    console.error("[export]", e);
    res.status(500).send("Export failed.");
  }
}

export async function postSubmissionsExportPdf(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).send("Invalid form id.");
  const body = req.body || {};
  const filters = {
    status: typeof body.status === "string" && body.status !== "all" ? body.status : null,
    from: typeof body.from === "string" ? body.from : null,
    to: typeof body.to === "string" ? body.to : null,
    ids: Array.isArray(body.submissionIds)
      ? body.submissionIds.map((x) => Number.parseInt(x, 10)).filter(Number.isFinite)
      : null,
  };
  try {
    await exportSubmissionsPdfZip(id, filters, res);
  } catch (e) {
    console.error("[export pdf zip]", e);
    if (!res.headersSent) res.status(500).send("Export failed.");
  }
}

/** Templates — list templates (is_template=true) */
export async function getFormTemplates(_req, res) {
  try {
    const pool = getPool();
    const { rows: templates } = await pool.query(
      `SELECT f.*,
              (SELECT COUNT(*)::int FROM form_fields WHERE form_id = f.id
                 AND field_type NOT IN ('heading','paragraph','divider','spacer')) AS field_count,
              (SELECT COUNT(*)::int FROM form_pages WHERE form_id = f.id) AS page_count
       FROM forms f WHERE is_template = true AND is_active = true
       ORDER BY template_category, name`
    );
    res.json({
      templates: templates.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.template_description || r.description,
        category: r.template_category || r.category,
        icon: r.template_icon || "📋",
        fieldCount: r.field_count,
        pageCount: r.page_count,
      })),
    });
  } catch (e) {
    console.error("[form templates]", e);
    res.status(500).json({ error: "Could not load templates." });
  }
}

export async function postFormFromTemplate(req, res) {
  const templateId = Number.parseInt(req.body?.templateId, 10);
  if (!Number.isFinite(templateId)) return res.status(400).json({ error: "Invalid templateId." });
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: tmplRows } = await client.query(
      `SELECT * FROM forms WHERE id = $1 AND is_template = true`, [templateId]
    );
    if (!tmplRows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Template not found." });
    }
    const tmpl = tmplRows[0];
    const { randomBytes } = await import("crypto");
    const newName = name || tmpl.name;
    const baseSlug = newName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "form";
    let slug = baseSlug;
    for (let i = 0; ; i++) {
      const s = i === 0 ? baseSlug : `${baseSlug}-${i}`;
      const { rows } = await client.query(`SELECT 1 FROM forms WHERE slug = $1`, [s]);
      if (!rows.length) { slug = s; break; }
    }
    const newToken = randomBytes(24).toString("hex");
    const { rows: newForm } = await client.query(
      `INSERT INTO forms (name, description, category, is_multi_step, settings, branding,
                          access_type, access_token, slug, submit_button_text, success_message,
                          success_redirect_url, status, is_active, is_template, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'draft', true, false, $13) RETURNING *`,
      [
        newName, tmpl.description, tmpl.category, tmpl.is_multi_step, tmpl.settings, tmpl.branding,
        tmpl.access_type, newToken, slug, tmpl.submit_button_text, tmpl.success_message,
        tmpl.success_redirect_url, req.user?.id ?? null,
      ]
    );
    const newId = newForm[0].id;
    const { rows: pageRows } = await client.query(
      `SELECT * FROM form_pages WHERE form_id = $1 ORDER BY page_order ASC`, [templateId]
    );
    const pageIdMap = new Map();
    for (const p of pageRows) {
      const { rows: np } = await client.query(
        `INSERT INTO form_pages (form_id, title, description, page_order, is_visible, visibility_conditions)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [newId, p.title, p.description, p.page_order, p.is_visible, p.visibility_conditions]
      );
      pageIdMap.set(p.id, np[0].id);
    }
    const { rows: fieldRows } = await client.query(
      `SELECT * FROM form_fields WHERE form_id = $1 ORDER BY sort_order ASC`, [templateId]
    );
    for (const f of fieldRows) {
      await client.query(
        `INSERT INTO form_fields (form_id, page_id, field_key, field_type, label, description,
                                  placeholder, help_text, is_required, is_hidden, default_value,
                                  validation, field_config, conditional_logic, pre_fill_config, layout, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
          newId, f.page_id ? pageIdMap.get(f.page_id) : null, f.field_key, f.field_type, f.label,
          f.description, f.placeholder, f.help_text, f.is_required, f.is_hidden, f.default_value,
          f.validation, f.field_config, f.conditional_logic, f.pre_fill_config, f.layout, f.sort_order,
        ]
      );
    }
    await client.query("COMMIT");
    res.status(201).json({ formId: newId });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[form from template]", e);
    res.status(500).json({ error: "Could not create from template." });
  } finally {
    client.release();
  }
}

/** Form categories */
export async function getFormCategories(_req, res) {
  try {
    const pool = getPool();
    const { rows } = await pool.query(`SELECT * FROM form_categories ORDER BY sort_order, name`);
    res.json({ categories: rows });
  } catch (e) {
    console.error("[form categories]", e);
    res.status(500).json({ error: "Could not load categories." });
  }
}

/** Automation test (dry-run) */
export async function postAutomationTest(req, res) {
  const automationId = Number.parseInt(req.params.automationId, 10);
  if (!Number.isFinite(automationId)) return res.status(400).json({ error: "Invalid automation id." });
  try {
    const pool = getPool();
    const { rows } = await pool.query(`SELECT * FROM form_automations WHERE id = $1`, [automationId]);
    if (!rows.length) return res.status(404).json({ error: "Automation not found." });
    const sample = req.body?.sampleData && typeof req.body.sampleData === "object"
      ? req.body.sampleData : {};
    const result = await testAutomationAction(rows[0], sample);
    res.json(result);
  } catch (e) {
    console.error("[automation test]", e);
    res.status(500).json({ error: "Test failed." });
  }
}

/** Re-run automations on an existing submission (admin) */
export async function postReRunAutomations(req, res) {
  const submissionId = Number.parseInt(req.params.submissionId, 10);
  if (!Number.isFinite(submissionId)) return res.status(400).json({ error: "Invalid submission id." });
  try {
    const pool = getPool();
    const { rows } = await pool.query(`SELECT * FROM form_submissions WHERE id = $1`, [submissionId]);
    if (!rows.length) return res.status(404).json({ error: "Submission not found." });
    const results = await executeFormAutomations(rows[0].form_id, submissionId, rows[0].submission_data);
    res.json({ results });
  } catch (e) {
    console.error("[rerun automations]", e);
    res.status(500).json({ error: "Could not run automations." });
  }
}

/** Meta: list supported trigger + action types (for the UI to populate dropdowns). */
export function getAutomationMeta(_req, res) {
  res.json({
    triggerTypes: Array.from(FORM_TRIGGER_TYPES),
    actionTypes: Array.from(FORM_ACTION_TYPES),
  });
}

/** Automation execution log (for debugging) */
export async function getAutomationLog(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid form id." });
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT l.*, a.name AS automation_name FROM form_automation_log l
       LEFT JOIN form_automations a ON a.id = l.automation_id
       WHERE l.form_id = $1 ORDER BY l.executed_at DESC LIMIT 100`,
      [id]
    );
    res.json({ entries: rows });
  } catch (e) {
    console.error("[automation log]", e);
    res.status(500).json({ error: "Could not load log." });
  }
}
