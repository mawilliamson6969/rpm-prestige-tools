/**
 * Phase 2: referral payment tracking.
 *
 * Permissions:
 *   - List/get: any Hub user (subject to outreach agent restriction).
 *   - Create: manager+ (recording money out is sensitive).
 *   - Update: only the user who created the row, OR manager+.
 *   - Soft-delete: manager+ only.
 *
 * Side effects on create:
 *   - Recompute referral.actual_referral_fee_paid (cumulative non-deleted sum)
 *   - Log activity on agent timeline
 *   - Refresh LTV materialized view (best-effort, async)
 */

import { getPool } from "../lib/db.js";
import { logAudit, logFieldDiff } from "../lib/agentHub/audit.js";
import { allowedAgentIdsFor, assertManagerRole } from "../lib/agentHub/permissions.js";
import { mapPayment } from "../lib/agentHub/mappers.js";
import {
  vIntId,
  vMoney,
  vPastDate,
  vPaymentMethod,
  vStringOpt,
  vStringReq,
} from "../lib/agentHub/validators.js";
import { refreshAgentLifetimeValue } from "../lib/agentHubPhase2Schema.js";
import { clearAgentHubFinancialsCache } from "./agentHubFinancials.js";

async function recomputeReferralPaid(pool, referralId) {
  await pool.query(
    `UPDATE agent_hub_referrals
        SET actual_referral_fee_paid = COALESCE((
          SELECT SUM(amount)
            FROM agent_hub_referral_payments
           WHERE referral_id = $1 AND deleted_at IS NULL
        ), 0)
      WHERE id = $1`,
    [referralId]
  );
}

async function loadReferralForOps(client, referralId, perms) {
  const { rows } = await client.query(
    `SELECT id, agent_id FROM agent_hub_referrals WHERE id = $1`,
    [referralId]
  );
  if (!rows.length) {
    throw Object.assign(new Error("Referral not found."), { http: 404 });
  }
  const allowedAgentIds = allowedAgentIdsFor(perms);
  if (allowedAgentIds && !allowedAgentIds.includes(rows[0].agent_id)) {
    throw Object.assign(new Error("Not authorized."), { http: 403 });
  }
  return rows[0];
}

export async function listPayments(req, res) {
  try {
    const referralId = vIntId(req.params.id, "referral id");
    const pool = getPool();
    await loadReferralForOps(pool, referralId, req.agentHubPerms);
    const { rows } = await pool.query(
      `SELECT * FROM agent_hub_referral_payments
        WHERE referral_id = $1 AND deleted_at IS NULL
        ORDER BY payment_date DESC, id DESC`,
      [referralId]
    );
    res.json({ payments: rows.map(mapPayment) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] payments list", e);
    res.status(500).json({ error: "Could not load payments." });
  }
}

export async function recordPayment(req, res) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    assertManagerRole(req.agentHubPerms);
    const referralId = vIntId(req.params.id, "referral id");
    const body = req.body ?? {};
    const amount = vMoney(body.amount, "amount", { allowNull: false });
    const paymentDate = vPastDate(body.payment_date, "payment_date");
    const paymentMethod = vPaymentMethod(body.payment_method);
    const checkNumber = vStringOpt(body.check_number, { maxLen: 100 });
    const paidToName = vStringReq(body.paid_to_name, "paid_to_name", { maxLen: 200 });
    const notes = vStringOpt(body.notes, { maxLen: 5000 });
    if (paymentMethod === "check" && !checkNumber) {
      res.status(400).json({ error: "check_number is required when payment_method=check." });
      return;
    }

    await client.query("BEGIN");
    const ref = await loadReferralForOps(client, referralId, req.agentHubPerms);

    const { rows } = await client.query(
      `INSERT INTO agent_hub_referral_payments
         (referral_id, amount, payment_date, payment_method, check_number, paid_to_name, notes, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
       RETURNING *`,
      [referralId, amount, paymentDate, paymentMethod, checkNumber, paidToName, notes, req.user.id]
    );
    await recomputeReferralPaid(client, referralId);

    // Activity on agent timeline
    await client.query(
      `INSERT INTO agent_hub_activities
         (agent_id, type, direction, summary, metadata, occurred_at, created_by, updated_by)
       VALUES ($1, 'system_event', 'internal', $2, $3::jsonb, NOW(), $4, $4)`,
      [
        ref.agent_id,
        `Referral fee payment recorded: $${amount.toFixed(2)} via ${paymentMethod}`,
        JSON.stringify({ referral_id: referralId, payment_id: rows[0].id, amount }),
        req.user.id,
      ]
    );
    await client.query("COMMIT");

    await logAudit(req, {
      entity_type: "payment",
      entity_id: rows[0].id,
      action: "create",
      new_value: { referral_id: referralId, amount, payment_date: paymentDate },
    });
    refreshAgentLifetimeValue().catch((e) => console.error("[agent-hub] LTV refresh", e));
    clearAgentHubFinancialsCache();

    res.status(201).json({ payment: mapPayment(rows[0]) });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] payment create", e);
    res.status(500).json({ error: "Could not record payment." });
  } finally {
    client.release();
  }
}

export async function updatePayment(req, res) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const id = vIntId(req.params.id, "payment id");
    const { rows: oldRows } = await pool.query(
      `SELECT * FROM agent_hub_referral_payments WHERE id = $1`,
      [id]
    );
    if (!oldRows.length || oldRows[0].deleted_at) {
      res.status(404).json({ error: "Payment not found." });
      return;
    }
    const old = oldRows[0];
    // Edit gate: creator OR manager+.
    const isManager = req.agentHubPerms.role === "owner" || req.agentHubPerms.role === "manager";
    if (!isManager && old.created_by !== req.user.id) {
      res.status(403).json({ error: "Only the creator (or a manager) can edit this payment." });
      return;
    }

    const body = req.body ?? {};
    const updates = {};
    if (body.amount !== undefined) updates.amount = vMoney(body.amount, "amount", { allowNull: false });
    if (body.payment_date !== undefined) updates.payment_date = vPastDate(body.payment_date, "payment_date");
    if (body.payment_method !== undefined) updates.payment_method = vPaymentMethod(body.payment_method);
    if (body.check_number !== undefined) updates.check_number = vStringOpt(body.check_number, { maxLen: 100 });
    if (body.paid_to_name !== undefined) updates.paid_to_name = vStringReq(body.paid_to_name, "paid_to_name", { maxLen: 200 });
    if (body.notes !== undefined) updates.notes = vStringOpt(body.notes, { maxLen: 5000 });
    if (!Object.keys(updates).length) {
      res.status(400).json({ error: "No valid fields to update." });
      return;
    }
    await client.query("BEGIN");
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
    const { rows } = await client.query(
      `UPDATE agent_hub_referral_payments SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    if (updates.amount !== undefined) {
      await recomputeReferralPaid(client, old.referral_id);
    }
    await client.query("COMMIT");
    await logFieldDiff(req, "payment", id, old, rows[0], Object.keys(updates));
    refreshAgentLifetimeValue().catch((e) => console.error("[agent-hub] LTV refresh", e));
    clearAgentHubFinancialsCache();
    res.json({ payment: mapPayment(rows[0]) });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] payment update", e);
    res.status(500).json({ error: "Could not update payment." });
  } finally {
    client.release();
  }
}

export async function deletePayment(req, res) {
  try {
    assertManagerRole(req.agentHubPerms);
    const id = vIntId(req.params.id, "payment id");
    const pool = getPool();
    const { rows: oldRows } = await pool.query(
      `SELECT * FROM agent_hub_referral_payments WHERE id = $1`,
      [id]
    );
    if (!oldRows.length || oldRows[0].deleted_at) {
      res.status(404).json({ error: "Payment not found." });
      return;
    }
    const referralId = oldRows[0].referral_id;
    await pool.query(
      `UPDATE agent_hub_referral_payments SET deleted_at = NOW(), deleted_by = $2, updated_by = $2
        WHERE id = $1`,
      [id, req.user.id]
    );
    await recomputeReferralPaid(pool, referralId);
    await logAudit(req, {
      entity_type: "payment",
      entity_id: id,
      action: "delete",
      old_value: { amount: oldRows[0].amount, payment_date: oldRows[0].payment_date },
    });
    refreshAgentLifetimeValue().catch((e) => console.error("[agent-hub] LTV refresh", e));
    clearAgentHubFinancialsCache();
    res.json({ ok: true });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] payment delete", e);
    res.status(500).json({ error: "Could not delete payment." });
  }
}
