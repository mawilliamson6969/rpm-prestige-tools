/**
 * Phase 2: referrals — the core deal record + stage transitions.
 *
 * Side effects matter. Each stage transition can:
 *   - Insert agent_hub_referral_stage_history (idempotent: unique on
 *     (referral_id, to_stage, changed_at))
 *   - Log an activity on the agent's timeline
 *   - On 'tenant_placed': create a system thank-you task (idempotent
 *     via partial unique index)
 *   - On 'active_management': flip property status, owner status, and
 *     refresh LTV
 *
 * DNC firewall: if the referring agent is DNC, refuse to create a new
 * referral. Existing referrals continue normally — DNC only blocks
 * NEW deal flow.
 *
 * NOT in this phase: any automation engine, drip sequences, generic
 * triggers. The thank-you task is a single SQL INSERT in this file.
 */

import { getPool } from "../lib/db.js";
import { logAudit, logFieldDiff } from "../lib/agentHub/audit.js";
import { allowedAgentIdsFor, assertManagerRole } from "../lib/agentHub/permissions.js";
import { mapReferral, mapStageHistory } from "../lib/agentHub/mappers.js";
import {
  assertValidTransition,
  isCompleted,
  isTerminal,
  PIPELINE_STAGES,
  STAGES,
} from "../lib/agentHub/stages.js";
import {
  vDate,
  vIntId,
  vIntOpt,
  vMoney,
  vPercent,
  vPriority,
  vStringOpt,
  vStringReq,
} from "../lib/agentHub/validators.js";
import { refreshAgentLifetimeValue } from "../lib/agentHubPhase2Schema.js";
import { clearAgentHubDashboardCache } from "./agentHubDashboard.js";
import { clearAgentHubFinancialsCache } from "./agentHubFinancials.js";

const REFERRAL_FIELDS = {
  expected_monthly_rent: (v) => vMoney(v, "expected_monthly_rent"),
  expected_management_fee_pct: (v) => vPercent(v, "expected_management_fee_pct"),
  expected_first_month_referral_fee: (v) => vMoney(v, "expected_first_month_referral_fee"),
  actual_monthly_rent: (v) => vMoney(v, "actual_monthly_rent"),
  actual_management_fee_pct: (v) => vPercent(v, "actual_management_fee_pct"),
  notes: (v) => vStringOpt(v, { maxLen: 50000 }),
  internal_priority: (v) => vPriority(v, { allowNull: false }),
  expected_close_date: (v) => (v == null || v === "" ? null : vDate(v, "expected_close_date")),
  property_id: (v) => (v == null || v === "" ? null : vIntId(v, "property_id")),
  source_activity_id: (v) => (v == null || v === "" ? null : vIntId(v, "source_activity_id")),
};

// ============================================================
// LIST
// ============================================================
export async function listReferrals(req, res) {
  try {
    const pool = getPool();
    const filters = [];
    const params = [];
    let p = 1;

    if (req.query.stage) {
      const stages = String(req.query.stage).split(",").filter(Boolean);
      if (stages.some((s) => !STAGES.includes(s))) {
        res.status(400).json({ error: "Unknown stage in filter." });
        return;
      }
      filters.push(`r.stage = ANY($${p++}::text[])`);
      params.push(stages);
    }
    if (req.query.agent_id) {
      filters.push(`r.agent_id = $${p++}`);
      params.push(Number(req.query.agent_id));
    }
    if (req.query.owner_id) {
      filters.push(`r.owner_id = $${p++}`);
      params.push(Number(req.query.owner_id));
    }
    if (req.query.priority) {
      filters.push(`r.internal_priority = $${p++}`);
      params.push(String(req.query.priority));
    }
    if (req.query.zip) {
      filters.push(`pr.zip = $${p++}`);
      params.push(String(req.query.zip));
    }
    if (req.query.from_date) {
      filters.push(`r.created_at >= $${p++}::timestamptz`);
      params.push(String(req.query.from_date));
    }
    if (req.query.to_date) {
      filters.push(`r.created_at < $${p++}::timestamptz`);
      params.push(String(req.query.to_date));
    }
    if (req.query.exclude_terminal === "true") {
      filters.push(`r.stage NOT IN ('lost','declined')`);
    }

    const allowedAgentIds = allowedAgentIdsFor(req.agentHubPerms);
    if (allowedAgentIds) {
      filters.push(`r.agent_id = ANY($${p++}::int[])`);
      params.push(allowedAgentIds);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const perPage = Math.min(Math.max(Number(req.query.per_page) || 100, 1), 500);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const offset = (page - 1) * perPage;

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS total
         FROM agent_hub_referrals r
         LEFT JOIN agent_hub_properties pr ON pr.id = r.property_id
         ${where}`,
      params
    );
    const { rows } = await pool.query(
      `SELECT r.*,
              ag.full_name AS agent_name,
              ag.brokerage_name AS agent_brokerage_name,
              ag.tier AS agent_tier,
              ag.photo_url AS agent_photo_url,
              o.full_name AS owner_name,
              pr.address_1 AS property_address,
              pr.city AS property_city
         FROM agent_hub_referrals r
         JOIN agent_hub_agents ag ON ag.id = r.agent_id
         JOIN agent_hub_owners o ON o.id = r.owner_id
         LEFT JOIN agent_hub_properties pr ON pr.id = r.property_id
         ${where}
        ORDER BY r.stage_changed_at DESC, r.id DESC
        LIMIT $${p++} OFFSET $${p++}`,
      [...params, perPage, offset]
    );
    res.json({ referrals: rows.map(mapReferral), total: countRows[0].total, page, per_page: perPage });
  } catch (e) {
    console.error("[agent-hub] referrals list", e);
    res.status(500).json({ error: "Could not load referrals." });
  }
}

// ============================================================
// GET ONE
// ============================================================
export async function getReferral(req, res) {
  try {
    const id = vIntId(req.params.id, "referral id");
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT r.*,
              ag.full_name AS agent_name, ag.brokerage_name AS agent_brokerage_name,
              ag.tier AS agent_tier, ag.photo_url AS agent_photo_url,
              o.full_name AS owner_name,
              pr.address_1 AS property_address, pr.city AS property_city
         FROM agent_hub_referrals r
         JOIN agent_hub_agents ag ON ag.id = r.agent_id
         JOIN agent_hub_owners o ON o.id = r.owner_id
         LEFT JOIN agent_hub_properties pr ON pr.id = r.property_id
        WHERE r.id = $1`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Referral not found." });
      return;
    }
    const referral = rows[0];

    const allowedAgentIds = allowedAgentIdsFor(req.agentHubPerms);
    if (allowedAgentIds && !allowedAgentIds.includes(referral.agent_id)) {
      res.status(403).json({ error: "Not authorized." });
      return;
    }

    const [history, payments, revenue, tasks] = await Promise.all([
      pool.query(
        `SELECT h.*, u.display_name AS changed_by_name
           FROM agent_hub_referral_stage_history h
           LEFT JOIN users u ON u.id = h.changed_by
          WHERE h.referral_id = $1
          ORDER BY h.changed_at ASC`,
        [id]
      ),
      pool.query(
        `SELECT * FROM agent_hub_referral_payments
          WHERE referral_id = $1 AND deleted_at IS NULL
          ORDER BY payment_date DESC, id DESC`,
        [id]
      ),
      pool.query(
        `SELECT * FROM agent_hub_revenue_tracking
          WHERE referral_id = $1 AND deleted_at IS NULL
          ORDER BY month DESC`,
        [id]
      ),
      pool.query(
        `SELECT t.*, u.display_name AS assigned_to_name
           FROM agent_hub_tasks t
           LEFT JOIN users u ON u.id = t.assigned_to
          WHERE t.related_referral_id = $1 AND t.status != 'cancelled'
          ORDER BY t.due_date ASC NULLS LAST, t.created_at DESC`,
        [id]
      ),
    ]);

    res.json({
      referral: mapReferral(referral),
      stage_history: history.rows.map(mapStageHistory),
      payments: payments.rows,
      revenue: revenue.rows,
      tasks: tasks.rows,
    });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] referral get", e);
    res.status(500).json({ error: "Could not load referral." });
  }
}

// ============================================================
// CREATE
// ============================================================
export async function createReferral(req, res) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const body = req.body ?? {};
    const agentId = vIntId(body.agent_id, "agent_id");
    const ownerId = vIntId(body.owner_id, "owner_id");

    await client.query("BEGIN");

    // DNC firewall — refuse to create new referrals for DNC agents.
    const { rows: agentRows } = await client.query(
      `SELECT id, full_name, do_not_contact, status, source_agent_id
         FROM agent_hub_agents WHERE id = $1 FOR UPDATE`,
      [agentId]
    );
    if (!agentRows.length || agentRows[0].status === "deleted") {
      await client.query("ROLLBACK");
      res.status(400).json({ error: "Agent does not exist." });
      return;
    }
    if (agentRows[0].do_not_contact === true) {
      await client.query("ROLLBACK");
      res.status(400).json({
        error: "Agent is marked Do Not Contact. Cannot create a new referral. Existing referrals are unaffected.",
        code: "AGENT_DNC",
      });
      return;
    }

    // Owner exists?
    const { rows: ownerRows } = await client.query(
      `SELECT id, source_agent_id, status FROM agent_hub_owners WHERE id = $1 FOR UPDATE`,
      [ownerId]
    );
    if (!ownerRows.length || ownerRows[0].status === "deleted") {
      await client.query("ROLLBACK");
      res.status(400).json({ error: "Owner does not exist." });
      return;
    }
    // First-referrer-wins: if owner has no source_agent_id yet, set it.
    if (ownerRows[0].source_agent_id == null) {
      await client.query(
        `UPDATE agent_hub_owners
            SET source_agent_id = $1,
                first_referral_date = COALESCE(first_referral_date, CURRENT_DATE),
                updated_by = $2
          WHERE id = $3`,
        [agentId, req.user.id, ownerId]
      );
    }

    // Property optional but if specified must exist + belong to owner.
    let propertyId = null;
    if (body.property_id != null && body.property_id !== "") {
      propertyId = vIntId(body.property_id, "property_id");
      const { rows: propRows } = await client.query(
        `SELECT id, owner_id, status FROM agent_hub_properties WHERE id = $1 FOR UPDATE`,
        [propertyId]
      );
      if (!propRows.length || propRows[0].status === "deleted") {
        await client.query("ROLLBACK");
        res.status(400).json({ error: "Property does not exist." });
        return;
      }
      if (propRows[0].owner_id !== ownerId) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: "Property does not belong to this owner." });
        return;
      }
    }

    const updates = {
      agent_id: agentId,
      owner_id: ownerId,
      property_id: propertyId,
    };
    for (const [k, fn] of Object.entries(REFERRAL_FIELDS)) {
      if (body[k] !== undefined && k !== "property_id") {
        updates[k] = fn(body[k]);
      }
    }

    const cols = Object.keys(updates);
    const vals = cols.map((k) => updates[k]);
    const placeholders = cols.map((_, i) => `$${i + 1}`);
    cols.push("created_by", "updated_by", "stage_changed_by");
    placeholders.push(`$${vals.length + 1}`, `$${vals.length + 1}`, `$${vals.length + 1}`);
    vals.push(req.user.id);

    let referralRow;
    try {
      const { rows } = await client.query(
        `INSERT INTO agent_hub_referrals (${cols.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`,
        vals
      );
      referralRow = rows[0];
    } catch (e) {
      if (e.code === "23505") {
        await client.query("ROLLBACK");
        res.status(409).json({
          error: "Owner already has an active referral on this property. Resolve it before creating another.",
          code: "DUPLICATE_ACTIVE_REFERRAL",
        });
        return;
      }
      throw e;
    }

    // Initial stage history row.
    await client.query(
      `INSERT INTO agent_hub_referral_stage_history
         (referral_id, from_stage, to_stage, changed_at, changed_by, notes)
       VALUES ($1, NULL, $2, NOW(), $3, 'Referral created')
       ON CONFLICT (referral_id, to_stage, changed_at) DO NOTHING`,
      [referralRow.id, referralRow.stage, req.user.id]
    );

    // Side effect: log activity on agent timeline + bump last_interaction.
    const { rows: ownerNameRows } = await client.query(
      `SELECT full_name FROM agent_hub_owners WHERE id = $1`,
      [ownerId]
    );
    await client.query(
      `INSERT INTO agent_hub_activities
         (agent_id, type, direction, summary, metadata, occurred_at, created_by, updated_by)
       VALUES ($1, 'note_added', 'inbound', $2, $3::jsonb, NOW(), $4, $4)`,
      [
        agentId,
        `Referral received: ${ownerNameRows[0]?.full_name || "owner"}`,
        JSON.stringify({ referral_id: referralRow.id, source: "system_referral_create" }),
        req.user.id,
      ]
    );

    await client.query("COMMIT");

    await logAudit(req, {
      entity_type: "referral",
      entity_id: referralRow.id,
      action: "create",
      new_value: { agent_id: agentId, owner_id: ownerId, property_id: propertyId },
    });
    clearAgentHubDashboardCache();
    clearAgentHubFinancialsCache();

    res.status(201).json({ referral: mapReferral(referralRow) });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] referral create", e);
    res.status(500).json({ error: "Could not create referral." });
  } finally {
    client.release();
  }
}

// ============================================================
// UPDATE (general — not stage)
// ============================================================
export async function updateReferral(req, res) {
  try {
    const id = vIntId(req.params.id, "referral id");
    const body = req.body ?? {};
    const updates = {};
    for (const [k, fn] of Object.entries(REFERRAL_FIELDS)) {
      if (body[k] !== undefined) updates[k] = fn(body[k]);
    }
    if (!Object.keys(updates).length) {
      res.status(400).json({ error: "No valid fields to update." });
      return;
    }
    const pool = getPool();
    const { rows: oldRows } = await pool.query(`SELECT * FROM agent_hub_referrals WHERE id = $1`, [id]);
    if (!oldRows.length) {
      res.status(404).json({ error: "Referral not found." });
      return;
    }
    const sets = [];
    const vals = [];
    let n = 1;
    for (const k of Object.keys(updates)) {
      sets.push(`${k} = $${n++}`);
      vals.push(updates[k]);
    }
    sets.push(`updated_by = $${n++}`);
    vals.push(req.user.id);
    vals.push(id);
    const { rows } = await pool.query(
      `UPDATE agent_hub_referrals SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    await logFieldDiff(req, "referral", id, oldRows[0], rows[0], Object.keys(updates));
    res.json({ referral: mapReferral(rows[0]) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] referral update", e);
    res.status(500).json({ error: "Could not update referral." });
  }
}

// ============================================================
// ADVANCE STAGE (the headline action)
// ============================================================
export async function advanceReferralStage(req, res) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const id = vIntId(req.params.id, "referral id");
    const body = req.body ?? {};
    const toStage = vStringReq(body.to_stage, "to_stage", { maxLen: 50 });
    if (!STAGES.includes(toStage)) {
      res.status(400).json({ error: `Unknown stage: ${toStage}` });
      return;
    }
    const notes = vStringOpt(body.notes, { maxLen: 5000 });

    await client.query("BEGIN");

    const { rows: oldRows } = await client.query(
      `SELECT * FROM agent_hub_referrals WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!oldRows.length) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Referral not found." });
      return;
    }
    const old = oldRows[0];

    // Idempotency: advancing to the same stage is a no-op.
    if (old.stage === toStage) {
      await client.query("ROLLBACK");
      res.json({ referral: mapReferral(old), idempotent: true });
      return;
    }

    // Validate transition (uses centralized rules).
    assertValidTransition(old.stage, toStage);

    // mark-lost / mark-declined have their own endpoints with required reasons.
    // Block advance-stage from going to those states without using those endpoints.
    if (toStage === "lost" || toStage === "declined") {
      await client.query("ROLLBACK");
      res.status(400).json({
        error: `Use mark-${toStage} endpoint for terminal transitions (requires reason).`,
      });
      return;
    }

    // Compute duration in previous stage.
    const { rows: durRows } = await client.query(
      `SELECT NOW() - $1::timestamptz AS dur`,
      [old.stage_changed_at]
    );

    // Update stage on the referral row. Some transitions also stamp specific fields.
    const sets = [`stage = $1`, `stage_changed_at = NOW()`, `stage_changed_by = $2`, `updated_by = $2`];
    const vals = [toStage, req.user.id];
    let n = 3;

    if (toStage === "tenant_placed") {
      sets.push(`tenant_placed_at = NOW()`);
      // If body provides actual financials, pick them up here.
      if (body.actual_monthly_rent !== undefined) {
        const v = vMoney(body.actual_monthly_rent, "actual_monthly_rent");
        sets.push(`actual_monthly_rent = $${n++}`);
        vals.push(v);
      }
      if (body.actual_management_fee_pct !== undefined) {
        const v = vPercent(body.actual_management_fee_pct, "actual_management_fee_pct");
        sets.push(`actual_management_fee_pct = $${n++}`);
        vals.push(v);
      }
    }
    if (toStage === "active_management") {
      sets.push(`active_management_started_at = NOW()`);
    }

    vals.push(id);
    const { rows: updated } = await client.query(
      `UPDATE agent_hub_referrals SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    const referral = updated[0];

    // Insert stage history row (idempotent on uq).
    await client.query(
      `INSERT INTO agent_hub_referral_stage_history
         (referral_id, from_stage, to_stage, changed_at, changed_by, notes, duration_in_previous_stage)
       VALUES ($1, $2, $3, NOW(), $4, $5, $6)
       ON CONFLICT (referral_id, to_stage, changed_at) DO NOTHING`,
      [id, old.stage, toStage, req.user.id, notes, durRows[0].dur]
    );

    // Log activity on agent timeline.
    const { rows: ownerNameRows } = await client.query(
      `SELECT full_name FROM agent_hub_owners WHERE id = $1`,
      [referral.owner_id]
    );
    await client.query(
      `INSERT INTO agent_hub_activities
         (agent_id, type, direction, summary, metadata, occurred_at, created_by, updated_by)
       VALUES ($1, 'system_event', 'internal', $2, $3::jsonb, NOW(), $4, $4)`,
      [
        referral.agent_id,
        `Referral for ${ownerNameRows[0]?.full_name || "owner"} advanced to ${toStage.replace(/_/g, " ")}`,
        JSON.stringify({ referral_id: id, from_stage: old.stage, to_stage: toStage }),
        req.user.id,
      ]
    );

    // Side effect: tenant_placed → create thank-you task (idempotent).
    if (toStage === "tenant_placed") {
      const { rows: agentRows } = await client.query(
        `SELECT full_name FROM agent_hub_agents WHERE id = $1`,
        [referral.agent_id]
      );
      const { rows: propRows } = referral.property_id
        ? await client.query(
            `SELECT address_1, city, state FROM agent_hub_properties WHERE id = $1`,
            [referral.property_id]
          )
        : { rows: [{}] };
      const propAddr = propRows[0]
        ? [propRows[0].address_1, propRows[0].city, propRows[0].state].filter(Boolean).join(", ")
        : "(no property recorded)";

      // Find Mike's user id (owner). Fall back to assignee = creator if not found.
      const { rows: mikeRows } = await client.query(
        `SELECT id FROM users WHERE LOWER(username) = 'mike' AND active = TRUE LIMIT 1`
      );
      const assignee = mikeRows[0]?.id ?? req.user.id;

      await client.query(
        `INSERT INTO agent_hub_tasks
           (title, description, assigned_to, related_agent_id, related_referral_id,
            related_owner_id, related_property_id, status, priority, source, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', 'high', 'system_referral_thank_you', $3)
         ON CONFLICT (related_referral_id, source)
           WHERE source = 'system_referral_thank_you' AND related_referral_id IS NOT NULL
         DO NOTHING`,
        [
          `Send thank-you to ${agentRows[0]?.full_name || "agent"} for ${propAddr}`,
          `Tenant placed on ${propAddr}. Send a thank-you note (gift / handwritten card / call) to the referring agent.\n\nReferral ID: ${id}`,
          assignee,
          referral.agent_id,
          id,
          referral.owner_id,
          referral.property_id,
        ]
      );
    }

    // Side effect: active_management → flip property + owner status, refresh LTV.
    if (toStage === "active_management") {
      if (referral.property_id) {
        await client.query(
          `UPDATE agent_hub_properties SET status = 'under_management', updated_by = $2
            WHERE id = $1 AND status != 'deleted'`,
          [referral.property_id, req.user.id]
        );
      }
      await client.query(
        `UPDATE agent_hub_owners SET status = 'converted', updated_by = $2
          WHERE id = $1 AND status NOT IN ('deleted','converted')`,
        [referral.owner_id, req.user.id]
      );
    }

    await client.query("COMMIT");

    await logAudit(req, {
      entity_type: "referral",
      entity_id: id,
      action: "update",
      field_name: "stage",
      old_value: old.stage,
      new_value: toStage,
    });
    clearAgentHubDashboardCache();
    clearAgentHubFinancialsCache();

    // LTV refresh after active_management. Best-effort; don't fail the request.
    if (toStage === "active_management") {
      refreshAgentLifetimeValue().catch((e) => console.error("[agent-hub] LTV refresh", e));
    }

    res.json({ referral: mapReferral(referral) });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] referral advance", e);
    res.status(500).json({ error: "Could not advance referral." });
  } finally {
    client.release();
  }
}

// ============================================================
// MARK LOST / DECLINED
// ============================================================
async function markTerminal(req, res, kind /* 'lost' | 'declined' */) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const id = vIntId(req.params.id, "referral id");
    const reason = vStringReq(req.body?.reason, "reason", { maxLen: 1000 });

    await client.query("BEGIN");
    const { rows: oldRows } = await client.query(
      `SELECT * FROM agent_hub_referrals WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!oldRows.length) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Referral not found." });
      return;
    }
    const old = oldRows[0];
    if (old.stage === kind) {
      await client.query("ROLLBACK");
      res.json({ referral: mapReferral(old), idempotent: true });
      return;
    }
    assertValidTransition(old.stage, kind);

    const sets = [
      `stage = $1`,
      `stage_changed_at = NOW()`,
      `stage_changed_by = $2`,
      `updated_by = $2`,
      kind === "lost" ? `lost_reason = $3, lost_at = NOW()` : `declined_reason = $3, declined_at = NOW()`,
    ];
    const { rows: updated } = await client.query(
      `UPDATE agent_hub_referrals SET ${sets.join(", ")} WHERE id = $4 RETURNING *`,
      [kind, req.user.id, reason, id]
    );

    await client.query(
      `INSERT INTO agent_hub_referral_stage_history
         (referral_id, from_stage, to_stage, changed_at, changed_by, notes)
       VALUES ($1, $2, $3, NOW(), $4, $5)
       ON CONFLICT (referral_id, to_stage, changed_at) DO NOTHING`,
      [id, old.stage, kind, req.user.id, reason]
    );

    await client.query(
      `INSERT INTO agent_hub_activities
         (agent_id, type, direction, summary, metadata, occurred_at, created_by, updated_by)
       VALUES ($1, 'system_event', 'internal', $2, $3::jsonb, NOW(), $4, $4)`,
      [
        old.agent_id,
        `Referral marked ${kind}: ${reason}`,
        JSON.stringify({ referral_id: id, from_stage: old.stage, to_stage: kind }),
        req.user.id,
      ]
    );

    await client.query("COMMIT");

    await logAudit(req, {
      entity_type: "referral",
      entity_id: id,
      action: "update",
      field_name: "stage",
      old_value: old.stage,
      new_value: kind,
      context: { reason },
    });
    clearAgentHubDashboardCache();
    clearAgentHubFinancialsCache();

    res.json({ referral: mapReferral(updated[0]) });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error(`[agent-hub] referral mark-${kind}`, e);
    res.status(500).json({ error: `Could not mark referral ${kind}.` });
  } finally {
    client.release();
  }
}

export function markReferralLost(req, res) {
  return markTerminal(req, res, "lost");
}
export function markReferralDeclined(req, res) {
  return markTerminal(req, res, "declined");
}

// ============================================================
// RESTORE (un-lose / un-decline)
// ============================================================
export async function restoreReferral(req, res) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    assertManagerRole(req.agentHubPerms);
    const id = vIntId(req.params.id, "referral id");
    const restoreToStage = vStringOpt(req.body?.restore_to_stage) || "lead_received";
    if (!PIPELINE_STAGES.includes(restoreToStage)) {
      res.status(400).json({ error: `Cannot restore to ${restoreToStage}; must be a pipeline stage.` });
      return;
    }

    await client.query("BEGIN");
    const { rows: oldRows } = await client.query(
      `SELECT * FROM agent_hub_referrals WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!oldRows.length) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Referral not found." });
      return;
    }
    const old = oldRows[0];
    if (!isTerminal(old.stage) && !isCompleted(old.stage)) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: `Referral is in ${old.stage}; nothing to restore.` });
      return;
    }
    // Active uniqueness on (owner, property): if another active referral
    // exists for the same combo, restore would violate the unique index.
    const { rows: conflict } = await client.query(
      `SELECT id FROM agent_hub_referrals
        WHERE owner_id = $1
          AND COALESCE(property_id, 0) = COALESCE($2, 0)
          AND id != $3
          AND stage NOT IN ('lost','declined','active_management')`,
      [old.owner_id, old.property_id, id]
    );
    if (conflict.length) {
      await client.query("ROLLBACK");
      res.status(409).json({
        error: "Another active referral exists for this owner/property. Resolve it first.",
        blocking_referral_id: conflict[0].id,
      });
      return;
    }

    const { rows: updated } = await client.query(
      `UPDATE agent_hub_referrals
          SET stage = $1,
              stage_changed_at = NOW(),
              stage_changed_by = $2,
              updated_by = $2,
              lost_reason = NULL,
              lost_at = NULL,
              declined_reason = NULL,
              declined_at = NULL
        WHERE id = $3
       RETURNING *`,
      [restoreToStage, req.user.id, id]
    );
    await client.query(
      `INSERT INTO agent_hub_referral_stage_history
         (referral_id, from_stage, to_stage, changed_at, changed_by, notes)
       VALUES ($1, $2, $3, NOW(), $4, 'Restored')
       ON CONFLICT (referral_id, to_stage, changed_at) DO NOTHING`,
      [id, old.stage, restoreToStage, req.user.id]
    );
    await client.query("COMMIT");
    await logAudit(req, {
      entity_type: "referral",
      entity_id: id,
      action: "update",
      field_name: "stage",
      old_value: old.stage,
      new_value: restoreToStage,
      context: {
        restored: true,
        restored_from: old.stage,
        restored_to: restoreToStage,
        // Manager-override flag — if restoring from active_management, the
        // restore intentionally skips backwards through normal flow.
        skipped_normal_flow: old.stage === "active_management",
      },
    });
    res.json({ referral: mapReferral(updated[0]) });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] referral restore", e);
    res.status(500).json({ error: "Could not restore referral." });
  } finally {
    client.release();
  }
}

// ============================================================
// STAGE HISTORY
// ============================================================
export async function getReferralStageHistory(req, res) {
  try {
    const id = vIntId(req.params.id, "referral id");
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT h.*, u.display_name AS changed_by_name
         FROM agent_hub_referral_stage_history h
         LEFT JOIN users u ON u.id = h.changed_by
        WHERE h.referral_id = $1
        ORDER BY h.changed_at ASC`,
      [id]
    );
    res.json({ history: rows.map(mapStageHistory) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] stage history", e);
    res.status(500).json({ error: "Could not load stage history." });
  }
}
