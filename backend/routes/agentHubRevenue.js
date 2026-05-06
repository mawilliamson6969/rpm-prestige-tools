/**
 * Phase 2: monthly revenue tracking + bulk CSV import.
 *
 * Phase 2 doesn't sync from AppFolio. The bulk import endpoint takes a
 * CSV with columns:
 *   referral_id, month, rent_collected, management_fee_earned, notes
 * The 'month' must be the first day of the month (YYYY-MM-01).
 *
 * Idempotent: the partial unique index on (referral_id, month) lets us
 * UPSERT on month. Re-uploading the same month overwrites.
 */

import { getPool } from "../lib/db.js";
import { logAudit, logFieldDiff } from "../lib/agentHub/audit.js";
import { allowedAgentIdsFor, assertManagerRole } from "../lib/agentHub/permissions.js";
import { mapRevenue } from "../lib/agentHub/mappers.js";
import { vIntId, vMoney, vMonth, vStringOpt } from "../lib/agentHub/validators.js";
import { refreshAgentLifetimeValue } from "../lib/agentHubPhase2Schema.js";
import { clearAgentHubFinancialsCache } from "./agentHubFinancials.js";

async function loadReferralForOps(pool, referralId, perms) {
  const { rows } = await pool.query(
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

export async function listRevenue(req, res) {
  try {
    const referralId = vIntId(req.params.id, "referral id");
    const pool = getPool();
    await loadReferralForOps(pool, referralId, req.agentHubPerms);
    const { rows } = await pool.query(
      `SELECT * FROM agent_hub_revenue_tracking
        WHERE referral_id = $1 AND deleted_at IS NULL
        ORDER BY month DESC`,
      [referralId]
    );
    res.json({ revenue: rows.map(mapRevenue) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] revenue list", e);
    res.status(500).json({ error: "Could not load revenue." });
  }
}

export async function addRevenue(req, res) {
  try {
    assertManagerRole(req.agentHubPerms);
    const referralId = vIntId(req.params.id, "referral id");
    const body = req.body ?? {};
    const month = vMonth(body.month, "month");
    const rent = vMoney(body.rent_collected, "rent_collected", { allowNull: false });
    const fee = vMoney(body.management_fee_earned, "management_fee_earned", { allowNull: false });
    const notes = vStringOpt(body.notes, { maxLen: 5000 });

    const pool = getPool();
    await loadReferralForOps(pool, referralId, req.agentHubPerms);

    // UPSERT: re-uploading the same month overwrites. Soft-deleted rows
    // for the same (referral, month) are not in the partial unique index,
    // so they don't conflict — but we should also exclude them from the
    // ON CONFLICT target.
    const { rows } = await pool.query(
      `INSERT INTO agent_hub_revenue_tracking
         (referral_id, month, rent_collected, management_fee_earned, notes, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       ON CONFLICT (referral_id, month)
         WHERE deleted_at IS NULL
       DO UPDATE SET
         rent_collected = EXCLUDED.rent_collected,
         management_fee_earned = EXCLUDED.management_fee_earned,
         notes = COALESCE(EXCLUDED.notes, agent_hub_revenue_tracking.notes),
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
       RETURNING *`,
      [referralId, month, rent, fee, notes, req.user.id]
    );
    await logAudit(req, {
      entity_type: "revenue",
      entity_id: rows[0].id,
      action: "create",
      new_value: { referral_id: referralId, month, rent_collected: rent, management_fee_earned: fee },
    });
    refreshAgentLifetimeValue().catch((e) => console.error("[agent-hub] LTV refresh", e));
    clearAgentHubFinancialsCache();
    res.status(201).json({ revenue: mapRevenue(rows[0]) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] revenue add", e);
    res.status(500).json({ error: "Could not add revenue entry." });
  }
}

export async function updateRevenue(req, res) {
  try {
    assertManagerRole(req.agentHubPerms);
    const id = vIntId(req.params.id, "revenue id");
    const body = req.body ?? {};
    const updates = {};
    if (body.rent_collected !== undefined)
      updates.rent_collected = vMoney(body.rent_collected, "rent_collected", { allowNull: false });
    if (body.management_fee_earned !== undefined)
      updates.management_fee_earned = vMoney(body.management_fee_earned, "management_fee_earned", { allowNull: false });
    if (body.notes !== undefined) updates.notes = vStringOpt(body.notes, { maxLen: 5000 });
    if (!Object.keys(updates).length) {
      res.status(400).json({ error: "No valid fields to update." });
      return;
    }
    const pool = getPool();
    const { rows: oldRows } = await pool.query(
      `SELECT * FROM agent_hub_revenue_tracking WHERE id = $1`,
      [id]
    );
    if (!oldRows.length || oldRows[0].deleted_at) {
      res.status(404).json({ error: "Revenue entry not found." });
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
      `UPDATE agent_hub_revenue_tracking SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    await logFieldDiff(req, "revenue", id, oldRows[0], rows[0], Object.keys(updates));
    refreshAgentLifetimeValue().catch((e) => console.error("[agent-hub] LTV refresh", e));
    clearAgentHubFinancialsCache();
    res.json({ revenue: mapRevenue(rows[0]) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] revenue update", e);
    res.status(500).json({ error: "Could not update revenue entry." });
  }
}

export async function deleteRevenue(req, res) {
  try {
    assertManagerRole(req.agentHubPerms);
    const id = vIntId(req.params.id, "revenue id");
    const pool = getPool();
    const { rows: oldRows } = await pool.query(
      `SELECT * FROM agent_hub_revenue_tracking WHERE id = $1`,
      [id]
    );
    if (!oldRows.length || oldRows[0].deleted_at) {
      res.status(404).json({ error: "Revenue entry not found." });
      return;
    }
    await pool.query(
      `UPDATE agent_hub_revenue_tracking SET deleted_at = NOW(), deleted_by = $2, updated_by = $2
        WHERE id = $1`,
      [id, req.user.id]
    );
    await logAudit(req, { entity_type: "revenue", entity_id: id, action: "delete" });
    refreshAgentLifetimeValue().catch((e) => console.error("[agent-hub] LTV refresh", e));
    clearAgentHubFinancialsCache();
    res.json({ ok: true });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] revenue delete", e);
    res.status(500).json({ error: "Could not delete revenue entry." });
  }
}

// ============================================================
// BULK CSV IMPORT
// ============================================================
// POST /agent-hub/revenue/bulk-import
// Body: { csv: "<csv text>", strict: false }
// Columns required: referral_id, month, rent_collected, management_fee_earned
// Optional: notes
// If strict=true, abort on any row error. Otherwise skip bad rows and report.
/**
 * Parse CSV as a single character stream (handles quoted fields with
 * embedded commas, quotes, and NEWLINES). Returns an array of rows,
 * each an array of cell strings.
 *
 * Why not a library: the project doesn't have one wired up and the
 * input is small (<10MB import limit).
 */
function parseCsv(text) {
  // Strip UTF-8 BOM that Excel exports include.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let cur = "";
  let row = [];
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuote = false;
        }
      } else {
        cur += c;
      }
    } else {
      if (c === '"') {
        inQuote = true;
      } else if (c === ",") {
        row.push(cur);
        cur = "";
      } else if (c === "\n") {
        row.push(cur);
        rows.push(row);
        cur = "";
        row = [];
      } else if (c === "\r") {
        // Skip CR (handled by the LF that follows in CRLF, or as a stand-alone in CR-only).
        if (text[i + 1] !== "\n") {
          row.push(cur);
          rows.push(row);
          cur = "";
          row = [];
        }
      } else {
        cur += c;
      }
    }
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  // Drop empty trailing rows from extra blank lines.
  while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") {
    rows.pop();
  }
  return rows;
}

export async function bulkImportRevenue(req, res) {
  try {
    assertManagerRole(req.agentHubPerms);
    const csv = String(req.body?.csv || "").trim();
    if (!csv) {
      res.status(400).json({ error: "csv body field is required." });
      return;
    }
    const strict = req.body?.strict === true;
    const rows = parseCsv(csv);
    if (rows.length < 2) {
      res.status(400).json({ error: "CSV must have a header row and at least one data row." });
      return;
    }
    const header = rows[0].map((s) => s.trim().toLowerCase());
    const required = ["referral_id", "month", "rent_collected", "management_fee_earned"];
    for (const r of required) {
      if (!header.includes(r)) {
        res.status(400).json({ error: `Missing required column: ${r}` });
        return;
      }
    }
    const idx = (k) => header.indexOf(k);

    const pool = getPool();
    const errors = [];
    let imported = 0;
    let updated = 0;
    for (let i = 1; i < rows.length; i++) {
      const cols = rows[i];
      try {
        const referralId = vIntId(cols[idx("referral_id")], "referral_id");
        const month = vMonth(cols[idx("month")], "month");
        const rent = vMoney(cols[idx("rent_collected")], "rent_collected", { allowNull: false });
        const fee = vMoney(cols[idx("management_fee_earned")], "management_fee_earned", { allowNull: false });
        const notes = idx("notes") >= 0 ? vStringOpt(cols[idx("notes")], { maxLen: 5000 }) : null;

        const { rows } = await pool.query(
          `INSERT INTO agent_hub_revenue_tracking
             (referral_id, month, rent_collected, management_fee_earned, notes, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $6)
           ON CONFLICT (referral_id, month)
             WHERE deleted_at IS NULL
           DO UPDATE SET
             rent_collected = EXCLUDED.rent_collected,
             management_fee_earned = EXCLUDED.management_fee_earned,
             notes = COALESCE(EXCLUDED.notes, agent_hub_revenue_tracking.notes),
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()
           RETURNING (xmax = 0) AS inserted`,
          [referralId, month, rent, fee, notes, req.user.id]
        );
        if (rows[0].inserted) imported++;
        else updated++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push({ row: i + 1, error: msg });
        if (strict) break;
      }
    }
    await logAudit(req, {
      entity_type: "revenue",
      action: "bulk_update",
      context: { imported, updated, error_count: errors.length },
    });
    if (imported + updated > 0) {
      refreshAgentLifetimeValue().catch((e) => console.error("[agent-hub] LTV refresh", e));
    clearAgentHubFinancialsCache();
    }
    res.json({ imported, updated, errors, ok: errors.length === 0 });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] revenue bulk import", e);
    res.status(500).json({ error: "Could not import." });
  }
}
