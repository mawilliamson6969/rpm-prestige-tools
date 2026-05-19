/**
 * Prestige Connect — Automations CRUD + run history.
 *
 * Authoring shape (POST / PUT body):
 * {
 *   name, description?, trigger_type, trigger_config?, enabled?, max_runs_per_day?,
 *   steps: [ { step_type, config }, ... ]
 * }
 *
 * The legacy step_order field is computed server-side from array
 * position so the editor UI never has to renumber.
 */

import { getPool } from "../lib/db.js";
import { emitEvent } from "../lib/eventBus.js";

const ALLOWED_TRIGGERS = new Set([
  "appfolio.work_order.created",
  "appfolio.work_order.updated",
  "appfolio.lease.signed",
  "appfolio.lease.created",
  "openphone.message.received",
  "openphone.call.completed",
  "openphone.voicemail.received",
  "ms_graph.message.created",
  "ms_graph.event.created",
  "internal.form.submitted",
  "internal.board.card_created",
  "internal.board.card_moved",
]);

const ALLOWED_STEP_TYPES = new Set(["filter", "send_sms", "send_email", "create_card", "ai_draft"]);

function badRequest(res, msg) {
  return res.status(400).json({ error: msg });
}

function parseId(raw, label = "id") {
  const n = Number(raw);
  if (!Number.isFinite(n) || Math.floor(n) !== n || n <= 0) {
    const err = new Error(`Invalid ${label}`);
    err.http = 400;
    throw err;
  }
  return n;
}

function normalizeSteps(body) {
  const arr = Array.isArray(body.steps) ? body.steps : [];
  return arr
    .map((s, i) => {
      if (!s || typeof s !== "object") return null;
      const step_type = String(s.step_type || "").trim();
      if (!ALLOWED_STEP_TYPES.has(step_type)) {
        const err = new Error(`Unsupported step_type: ${step_type || "(empty)"}`);
        err.http = 400;
        throw err;
      }
      const config = s.config && typeof s.config === "object" ? s.config : {};
      return { step_order: i + 1, step_type, config };
    })
    .filter(Boolean);
}

function shapeAutomation(row, steps) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    trigger_type: row.trigger_type,
    trigger_config: row.trigger_config || {},
    enabled: row.enabled,
    max_runs_per_day: row.max_runs_per_day,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    steps: (steps || []).map((s) => ({
      id: s.id,
      step_order: s.step_order,
      step_type: s.step_type,
      config: s.config || {},
    })),
  };
}

export async function listAutomations(_req, res) {
  try {
    const pool = getPool();
    // Pull recent run stats (last 20) per automation for the list page.
    const { rows } = await pool.query(`
      SELECT a.id, a.name, a.description, a.trigger_type, a.enabled, a.max_runs_per_day,
             a.created_at, a.updated_at,
             (SELECT COUNT(*)::int FROM automation_steps s WHERE s.automation_id = a.id) AS step_count,
             (SELECT MAX(started_at) FROM automation_runs r WHERE r.automation_id = a.id) AS last_run_at,
             COALESCE((
               SELECT ROUND(
                 100.0 * COUNT(*) FILTER (WHERE status = 'success')
                       / NULLIF(COUNT(*), 0)
               )
               FROM (
                 SELECT status FROM automation_runs
                 WHERE automation_id = a.id
                 ORDER BY started_at DESC
                 LIMIT 20
               ) recent
             ), NULL) AS success_rate_pct,
             (SELECT COUNT(*)::int FROM automation_runs r
               WHERE r.automation_id = a.id
                 AND r.started_at >= NOW() - INTERVAL '24 hours'
             ) AS runs_last_24h
        FROM automations a
       ORDER BY a.updated_at DESC
    `);
    res.json({ automations: rows });
  } catch (err) {
    console.error("[automations] list failed:", err);
    res.status(500).json({ error: "Could not load automations." });
  }
}

export async function getAutomation(req, res) {
  try {
    const id = parseId(req.params.id);
    const pool = getPool();
    const { rows } = await pool.query(`SELECT * FROM automations WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Automation not found." });
    const { rows: steps } = await pool.query(
      `SELECT id, step_order, step_type, config
         FROM automation_steps
        WHERE automation_id = $1
        ORDER BY step_order ASC`,
      [id]
    );
    res.json({ automation: shapeAutomation(rows[0], steps) });
  } catch (err) {
    if (err.http) return res.status(err.http).json({ error: err.message });
    console.error("[automations] get failed:", err);
    res.status(500).json({ error: "Could not load automation." });
  }
}

export async function createAutomation(req, res) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const body = req.body || {};
    const name = String(body.name || "").trim();
    if (!name) return badRequest(res, "Name is required.");
    const triggerType = String(body.trigger_type || "").trim();
    if (!triggerType) return badRequest(res, "Trigger is required.");
    if (!ALLOWED_TRIGGERS.has(triggerType) && !triggerType.startsWith("custom.")) {
      return badRequest(res, `Unsupported trigger_type: ${triggerType}`);
    }
    const steps = normalizeSteps(body);

    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO automations
         (name, description, trigger_type, trigger_config, enabled, max_runs_per_day, created_by)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
       RETURNING *`,
      [
        name,
        body.description ?? null,
        triggerType,
        JSON.stringify(body.trigger_config || {}),
        Boolean(body.enabled),
        Number.isFinite(Number(body.max_runs_per_day)) && Number(body.max_runs_per_day) > 0
          ? Number(body.max_runs_per_day)
          : null,
        req.user?.id ?? null,
      ]
    );
    const automation = rows[0];

    const insertedSteps = [];
    for (const s of steps) {
      const { rows: sr } = await client.query(
        `INSERT INTO automation_steps (automation_id, step_order, step_type, config)
         VALUES ($1, $2, $3, $4::jsonb)
         RETURNING id, step_order, step_type, config`,
        [automation.id, s.step_order, s.step_type, JSON.stringify(s.config)]
      );
      insertedSteps.push(sr[0]);
    }
    await client.query("COMMIT");
    res.status(201).json({ automation: shapeAutomation(automation, insertedSteps) });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err.http) return res.status(err.http).json({ error: err.message });
    console.error("[automations] create failed:", err);
    res.status(500).json({ error: "Could not create automation." });
  } finally {
    client.release();
  }
}

export async function updateAutomation(req, res) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const id = parseId(req.params.id);
    const body = req.body || {};
    const sets = [];
    const vals = [];
    let n = 1;

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return badRequest(res, "Name cannot be empty.");
      sets.push(`name = $${n++}`);
      vals.push(name);
    }
    if (body.description !== undefined) {
      sets.push(`description = $${n++}`);
      vals.push(body.description ?? null);
    }
    if (body.trigger_type !== undefined) {
      const tt = String(body.trigger_type).trim();
      if (!ALLOWED_TRIGGERS.has(tt) && !tt.startsWith("custom.")) {
        return badRequest(res, `Unsupported trigger_type: ${tt}`);
      }
      sets.push(`trigger_type = $${n++}`);
      vals.push(tt);
    }
    if (body.trigger_config !== undefined) {
      sets.push(`trigger_config = $${n++}::jsonb`);
      vals.push(JSON.stringify(body.trigger_config || {}));
    }
    if (body.enabled !== undefined) {
      sets.push(`enabled = $${n++}`);
      vals.push(Boolean(body.enabled));
    }
    if (body.max_runs_per_day !== undefined) {
      const v =
        Number.isFinite(Number(body.max_runs_per_day)) && Number(body.max_runs_per_day) > 0
          ? Number(body.max_runs_per_day)
          : null;
      sets.push(`max_runs_per_day = $${n++}`);
      vals.push(v);
    }
    sets.push(`updated_at = NOW()`);

    await client.query("BEGIN");
    if (sets.length > 1) {
      vals.push(id);
      const { rowCount } = await client.query(
        `UPDATE automations SET ${sets.join(", ")} WHERE id = $${n}`,
        vals
      );
      if (!rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Automation not found." });
      }
    }
    // Replace steps when body includes a steps array. Otherwise leave alone.
    if (Array.isArray(body.steps)) {
      const steps = normalizeSteps(body);
      await client.query(`DELETE FROM automation_steps WHERE automation_id = $1`, [id]);
      for (const s of steps) {
        await client.query(
          `INSERT INTO automation_steps (automation_id, step_order, step_type, config)
           VALUES ($1, $2, $3, $4::jsonb)`,
          [id, s.step_order, s.step_type, JSON.stringify(s.config)]
        );
      }
    }
    await client.query("COMMIT");

    const { rows } = await pool.query(`SELECT * FROM automations WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Automation not found." });
    const { rows: steps } = await pool.query(
      `SELECT id, step_order, step_type, config
         FROM automation_steps
        WHERE automation_id = $1
        ORDER BY step_order ASC`,
      [id]
    );
    res.json({ automation: shapeAutomation(rows[0], steps) });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err.http) return res.status(err.http).json({ error: err.message });
    console.error("[automations] update failed:", err);
    res.status(500).json({ error: "Could not update automation." });
  } finally {
    client.release();
  }
}

export async function deleteAutomation(req, res) {
  try {
    const id = parseId(req.params.id);
    const pool = getPool();
    const { rowCount } = await pool.query(`DELETE FROM automations WHERE id = $1`, [id]);
    if (!rowCount) return res.status(404).json({ error: "Automation not found." });
    res.json({ ok: true });
  } catch (err) {
    if (err.http) return res.status(err.http).json({ error: err.message });
    console.error("[automations] delete failed:", err);
    res.status(500).json({ error: "Could not delete automation." });
  }
}

export async function listRuns(req, res) {
  try {
    const id = parseId(req.params.id);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT r.id, r.status, r.started_at, r.finished_at, r.step_results, r.error,
              r.event_id, e.type AS event_type, e.payload AS event_payload
         FROM automation_runs r
         LEFT JOIN events e ON e.id = r.event_id
        WHERE r.automation_id = $1
        ORDER BY r.started_at DESC
        LIMIT $2`,
      [id, limit]
    );
    res.json({ runs: rows });
  } catch (err) {
    if (err.http) return res.status(err.http).json({ error: err.message });
    console.error("[automations] runs failed:", err);
    res.status(500).json({ error: "Could not load runs." });
  }
}

export async function getRun(req, res) {
  try {
    const automationId = parseId(req.params.id);
    const runId = parseId(req.params.runId, "run id");
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT r.*, e.type AS event_type, e.payload AS event_payload
         FROM automation_runs r
         LEFT JOIN events e ON e.id = r.event_id
        WHERE r.automation_id = $1 AND r.id = $2`,
      [automationId, runId]
    );
    if (!rows.length) return res.status(404).json({ error: "Run not found." });
    res.json({ run: rows[0] });
  } catch (err) {
    if (err.http) return res.status(err.http).json({ error: err.message });
    console.error("[automations] run get failed:", err);
    res.status(500).json({ error: "Could not load run." });
  }
}

/**
 * "Test" button — synthesize a fake event with the provided payload and
 * write it to the bus. The worker will pick it up. This is the simplest
 * round-trip that proves the wiring works end-to-end.
 */
export async function testAutomation(req, res) {
  try {
    const id = parseId(req.params.id);
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT trigger_type FROM automations WHERE id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Automation not found." });
    const sample = req.body?.payload && typeof req.body.payload === "object" ? req.body.payload : {};
    const eventId = await emitEvent({
      type: rows[0].trigger_type,
      source: "test",
      payload: { ...sample, _test: true, _user_id: req.user?.id ?? null },
    });
    res.json({ ok: true, event_id: eventId });
  } catch (err) {
    if (err.http) return res.status(err.http).json({ error: err.message });
    console.error("[automations] test failed:", err);
    res.status(500).json({ error: "Could not enqueue test event." });
  }
}

/** Static lookup for the editor UI — which triggers and step types we accept. */
export function getAutomationMeta(_req, res) {
  res.json({
    triggers: Array.from(ALLOWED_TRIGGERS).map((t) => ({ value: t, label: t })),
    step_types: Array.from(ALLOWED_STEP_TYPES).map((t) => ({ value: t, label: t })),
  });
}
