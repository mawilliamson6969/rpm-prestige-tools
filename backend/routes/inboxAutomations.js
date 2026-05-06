/**
 * Phase 4: workflow automation rules + log endpoints.
 *
 * Read access: any authenticated user. Mutations to rules + revert: admin.
 * The shadow-review feedback endpoint is open to any authenticated user
 * since the spec wants Mike + Lori reviewing weekly without a separate
 * permission tier.
 */

import { getPool } from "../lib/db.js";
import {
  executeSuggestedAutomation,
  getRuleAccuracySummary,
  revertAutomationLog,
} from "../lib/inbox/automation-engine.js";

const VALID_MODES = new Set(["shadow", "suggested", "auto"]);
const VALID_TRIGGERS = new Set([
  "new_thread",
  "message_received",
  "classification_changed",
  "sla_warning",
  "sla_breached",
]);
const VALID_ACTIONS = new Set([
  "assign",
  "set_status",
  "set_priority",
  "close",
  "star",
  "escalate",
  "create_task",
  "create_work_order",
  "apply_label",
]);

function mapRule(r) {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    trigger: r.trigger,
    conditions: r.conditions ?? {},
    action: r.action,
    action_params: r.action_params ?? {},
    confidence_min: r.confidence_min != null ? Number(r.confidence_min) : 0,
    mode: r.mode,
    active: r.active !== false,
    priority_rank: r.priority_rank,
    created_by: r.created_by ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function mapLog(r) {
  return {
    id: r.id,
    rule_id: r.rule_id,
    rule_name: r.rule_name ?? null,
    rule_mode: r.rule_mode ?? null,
    thread_id: r.thread_id,
    thread_subject: r.thread_subject ?? null,
    trigger: r.trigger,
    matched: r.matched === true,
    proposed_action: r.proposed_action ?? null,
    revert_payload: r.revert_payload ?? null,
    confidence: r.confidence != null ? Number(r.confidence) : null,
    mode: r.mode,
    executed: r.executed === true,
    executed_at: r.executed_at ?? null,
    reverted: r.reverted === true,
    reverted_at: r.reverted_at ?? null,
    reverted_by: r.reverted_by ?? null,
    skipped_reason: r.skipped_reason ?? null,
    feedback: r.feedback ?? null,
    feedback_by: r.feedback_by ?? null,
    feedback_at: r.feedback_at ?? null,
    created_at: r.created_at,
  };
}

export async function getInboxAutomationRules(_req, res) {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM automation_rules ORDER BY priority_rank ASC, id ASC`
    );
    res.json({ rules: rows.map(mapRule) });
  } catch (e) {
    console.error("[automation] list rules", e);
    res.status(500).json({ error: "Could not load rules." });
  }
}

export async function postInboxAutomationRule(req, res) {
  try {
    const body = req.body ?? {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return res.status(400).json({ error: "name is required." });
    if (!VALID_TRIGGERS.has(String(body.trigger))) {
      return res.status(400).json({
        error: `trigger must be one of ${[...VALID_TRIGGERS].join(", ")}.`,
      });
    }
    if (!VALID_ACTIONS.has(String(body.action))) {
      return res.status(400).json({ error: `action must be one of ${[...VALID_ACTIONS].join(", ")}.` });
    }
    const conditions = body.conditions && typeof body.conditions === "object" ? body.conditions : {};
    const actionParams =
      body.action_params && typeof body.action_params === "object" ? body.action_params : {};
    const confMin = body.confidence_min != null ? Number(body.confidence_min) : 0.9;
    if (!Number.isFinite(confMin) || confMin < 0 || confMin > 1) {
      return res.status(400).json({ error: "confidence_min must be between 0 and 1." });
    }
    const mode = String(body.mode || "shadow");
    if (!VALID_MODES.has(mode)) {
      return res.status(400).json({ error: "mode must be shadow | suggested | auto." });
    }
    const priorityRank = Number(body.priority_rank ?? 100);
    if (!Number.isFinite(priorityRank)) {
      return res.status(400).json({ error: "priority_rank must be a number." });
    }
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO automation_rules
         (name, description, trigger, conditions, action, action_params,
          confidence_min, mode, active, priority_rank, created_by)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        name,
        body.description ?? null,
        body.trigger,
        JSON.stringify(conditions),
        body.action,
        JSON.stringify(actionParams),
        confMin,
        mode,
        body.active !== false,
        priorityRank,
        req.user?.id ?? null,
      ]
    );
    res.status(201).json({ rule: mapRule(rows[0]) });
  } catch (e) {
    if (e.code === "23505") {
      return res.status(409).json({ error: "A rule with that name already exists." });
    }
    console.error("[automation] create rule", e);
    res.status(500).json({ error: "Could not create rule." });
  }
}

export async function patchInboxAutomationRule(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid rule id." });
    const body = req.body ?? {};
    const sets = [];
    const vals = [];
    let n = 1;
    if (body.name !== undefined) {
      sets.push(`name = $${n++}`);
      vals.push(String(body.name));
    }
    if (body.description !== undefined) {
      sets.push(`description = $${n++}`);
      vals.push(body.description == null ? null : String(body.description));
    }
    if (body.trigger !== undefined) {
      if (!VALID_TRIGGERS.has(String(body.trigger))) {
        return res.status(400).json({ error: "Invalid trigger." });
      }
      sets.push(`trigger = $${n++}`);
      vals.push(String(body.trigger));
    }
    if (body.action !== undefined) {
      if (!VALID_ACTIONS.has(String(body.action))) {
        return res.status(400).json({ error: "Invalid action." });
      }
      sets.push(`action = $${n++}`);
      vals.push(String(body.action));
    }
    if (body.conditions !== undefined) {
      if (!body.conditions || typeof body.conditions !== "object") {
        return res.status(400).json({ error: "conditions must be an object." });
      }
      sets.push(`conditions = $${n++}::jsonb`);
      vals.push(JSON.stringify(body.conditions));
    }
    if (body.action_params !== undefined) {
      if (!body.action_params || typeof body.action_params !== "object") {
        return res.status(400).json({ error: "action_params must be an object." });
      }
      sets.push(`action_params = $${n++}::jsonb`);
      vals.push(JSON.stringify(body.action_params));
    }
    if (body.confidence_min !== undefined) {
      const v = Number(body.confidence_min);
      if (!Number.isFinite(v) || v < 0 || v > 1) {
        return res.status(400).json({ error: "confidence_min must be between 0 and 1." });
      }
      sets.push(`confidence_min = $${n++}`);
      vals.push(v);
    }
    if (body.mode !== undefined) {
      if (!VALID_MODES.has(String(body.mode))) {
        return res.status(400).json({ error: "Invalid mode." });
      }
      sets.push(`mode = $${n++}`);
      vals.push(String(body.mode));
    }
    if (body.active !== undefined) {
      sets.push(`active = $${n++}`);
      vals.push(body.active !== false);
    }
    if (body.priority_rank !== undefined) {
      const v = Number(body.priority_rank);
      if (!Number.isFinite(v)) {
        return res.status(400).json({ error: "priority_rank must be a number." });
      }
      sets.push(`priority_rank = $${n++}`);
      vals.push(v);
    }
    if (!sets.length) return res.status(400).json({ error: "No valid fields to update." });
    sets.push(`updated_at = NOW()`);
    vals.push(id);
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE automation_rules SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: "Rule not found." });
    res.json({ rule: mapRule(rows[0]) });
  } catch (e) {
    if (e.code === "23505") {
      return res.status(409).json({ error: "A rule with that name already exists." });
    }
    console.error("[automation] patch rule", e);
    res.status(500).json({ error: "Could not update rule." });
  }
}

export async function deleteInboxAutomationRule(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid rule id." });
    const pool = getPool();
    const { rowCount } = await pool.query(`DELETE FROM automation_rules WHERE id = $1`, [id]);
    if (!rowCount) return res.status(404).json({ error: "Rule not found." });
    res.json({ ok: true });
  } catch (e) {
    console.error("[automation] delete rule", e);
    res.status(500).json({ error: "Could not delete rule." });
  }
}

/**
 * GET /inbox/automation-log
 * Query params:
 *   - mode=shadow|suggested|auto
 *   - rule_id=N
 *   - thread_id=...
 *   - since=ISO  (default: 7 days ago)
 *   - limit=N (default 200, max 500)
 *   - matched_only=true
 */
export async function getInboxAutomationLog(req, res) {
  try {
    const pool = getPool();
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const since = req.query.since
      ? new Date(String(req.query.since))
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const filters = ["l.created_at >= $1"];
    const params = [since];
    let n = 2;
    if (req.query.mode) {
      if (!VALID_MODES.has(String(req.query.mode))) {
        return res.status(400).json({ error: "Invalid mode filter." });
      }
      filters.push(`l.mode = $${n++}`);
      params.push(String(req.query.mode));
    }
    if (req.query.rule_id) {
      const id = Number(req.query.rule_id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid rule_id." });
      filters.push(`l.rule_id = $${n++}`);
      params.push(id);
    }
    if (req.query.thread_id) {
      filters.push(`l.thread_id = $${n++}`);
      params.push(String(req.query.thread_id));
    }
    if (req.query.matched_only === "true") {
      filters.push(`l.matched = TRUE`);
    }
    const { rows } = await pool.query(
      `SELECT l.*, r.name AS rule_name, r.mode AS rule_mode,
              th.subject AS thread_subject
         FROM automation_log l
         LEFT JOIN automation_rules r ON r.id = l.rule_id
         LEFT JOIN threads th ON th.thread_id = l.thread_id
        WHERE ${filters.join(" AND ")}
        ORDER BY l.created_at DESC
        LIMIT ${limit}`,
      params
    );
    res.json({ entries: rows.map(mapLog) });
  } catch (e) {
    console.error("[automation] log query", e);
    res.status(500).json({ error: "Could not load automation log." });
  }
}

export async function getInboxAutomationAccuracy(_req, res) {
  try {
    const summary = await getRuleAccuracySummary();
    res.json({ rules: summary });
  } catch (e) {
    console.error("[automation] accuracy", e);
    res.status(500).json({ error: "Could not compute accuracy." });
  }
}

/** Operator marks a shadow firing as 'good' or 'wrong'. Used by the
 *  shadow-review page to compute per-rule accuracy. */
export async function postInboxAutomationFeedback(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid log id." });
    const verdict = String(req.body?.feedback || "").trim().toLowerCase();
    if (verdict !== "good" && verdict !== "wrong" && verdict !== "clear") {
      return res.status(400).json({ error: "feedback must be 'good' or 'wrong' (or 'clear')." });
    }
    const pool = getPool();
    if (verdict === "clear") {
      await pool.query(
        `UPDATE automation_log SET feedback = NULL, feedback_by = NULL, feedback_at = NULL WHERE id = $1`,
        [id]
      );
    } else {
      await pool.query(
        `UPDATE automation_log
            SET feedback = $1, feedback_by = $2, feedback_at = NOW()
          WHERE id = $3`,
        [verdict, req.user?.id ?? null, id]
      );
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("[automation] feedback", e);
    res.status(500).json({ error: "Could not save feedback." });
  }
}

/** Execute a suggested automation (one-click from the thread detail). */
export async function postInboxAutomationExecute(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid log id." });
    const r = await executeSuggestedAutomation(id, req.user?.id ?? null);
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (e) {
    console.error("[automation] execute", e);
    res.status(500).json({ error: "Could not execute automation." });
  }
}

/** Revert an auto-action within the 24h window. */
export async function postInboxAutomationRevert(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid log id." });
    const r = await revertAutomationLog(id, req.user?.id ?? null);
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (e) {
    console.error("[automation] revert", e);
    res.status(500).json({ error: "Could not revert automation." });
  }
}
