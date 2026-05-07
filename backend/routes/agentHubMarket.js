/**
 * Phase 4: market intelligence CRUD + bulk import.
 * Manual entry only; automated MLS/AppFolio fetch is Phase 5.
 */

import { getPool } from "../lib/db.js";
import { logAudit, logFieldDiff } from "../lib/agentHub/audit.js";
import { assertManagerRole } from "../lib/agentHub/permissions.js";
import {
  vIntId,
  vIntOpt,
  vMonth,
  vMoney,
  vNumOpt,
  vStringOpt,
  vStringReq,
  vZip,
} from "../lib/agentHub/validators.js";

const VALID_INVENTORY = new Set(["low", "balanced", "high"]);
const VALID_SOURCE = new Set(["manual", "appfolio", "mls_export", "external"]);

function mapEntry(r) {
  if (!r) return null;
  return {
    id: r.id,
    zip: r.zip,
    month: r.month,
    avg_lease_price: r.avg_lease_price != null ? Number(r.avg_lease_price) : null,
    median_lease_price: r.median_lease_price != null ? Number(r.median_lease_price) : null,
    total_active_listings: r.total_active_listings,
    total_leased: r.total_leased,
    avg_days_on_market: r.avg_days_on_market != null ? Number(r.avg_days_on_market) : null,
    inventory_level: r.inventory_level ?? null,
    notable_events: r.notable_events ?? null,
    data_source: r.data_source,
    source_notes: r.source_notes ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export async function listMarket(req, res) {
  try {
    const pool = getPool();
    const filters = [];
    const params = [];
    let p = 1;
    if (req.query.zip) {
      filters.push(`zip = $${p++}`);
      params.push(String(req.query.zip));
    }
    if (req.query.from_month) {
      filters.push(`month >= $${p++}::date`);
      params.push(String(req.query.from_month));
    }
    if (req.query.to_month) {
      filters.push(`month < $${p++}::date`);
      params.push(String(req.query.to_month));
    }
    if (req.query.data_source) {
      filters.push(`data_source = $${p++}`);
      params.push(String(req.query.data_source));
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `SELECT * FROM agent_hub_market_intelligence ${where} ORDER BY zip, month DESC LIMIT 500`,
      params
    );
    res.json({ entries: rows.map(mapEntry) });
  } catch (e) {
    console.error("[agent-hub] market list", e);
    res.status(500).json({ error: "Could not load market data." });
  }
}

export async function getLatestForZip(req, res) {
  try {
    const zip = vZip(req.params.zip, { allowNull: false });
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM agent_hub_market_intelligence
        WHERE zip = $1
        ORDER BY month DESC LIMIT 1`,
      [zip]
    );
    if (!rows.length) {
      res.status(404).json({ error: "No data for this zip." });
      return;
    }
    res.json({ entry: mapEntry(rows[0]) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] market latest", e);
    res.status(500).json({ error: "Could not load." });
  }
}

function validateEntry(body) {
  const out = {};
  out.zip = vZip(body.zip, { allowNull: false });
  out.month = vMonth(body.month, "month");
  out.avg_lease_price = body.avg_lease_price != null ? vMoney(body.avg_lease_price, "avg_lease_price") : null;
  out.median_lease_price = body.median_lease_price != null ? vMoney(body.median_lease_price, "median_lease_price") : null;
  out.total_active_listings = body.total_active_listings != null ? vIntOpt(body.total_active_listings, "total_active_listings", { min: 0 }) : null;
  out.total_leased = body.total_leased != null ? vIntOpt(body.total_leased, "total_leased", { min: 0 }) : null;
  out.avg_days_on_market = body.avg_days_on_market != null ? vNumOpt(body.avg_days_on_market, "avg_days_on_market", { min: 0 }) : null;
  if (body.inventory_level != null && !VALID_INVENTORY.has(body.inventory_level)) {
    throw Object.assign(new Error("inventory_level must be low/balanced/high."), { http: 400 });
  }
  out.inventory_level = body.inventory_level || null;
  out.notable_events = vStringOpt(body.notable_events, { maxLen: 5000 });
  out.data_source = VALID_SOURCE.has(body.data_source) ? body.data_source : "manual";
  out.source_notes = vStringOpt(body.source_notes, { maxLen: 1000 });
  return out;
}

export async function createMarket(req, res) {
  try {
    assertManagerRole(req.agentHubPerms);
    const v = validateEntry(req.body || {});
    const pool = getPool();
    const cols = Object.keys(v);
    const vals = cols.map((k) => v[k]);
    const placeholders = cols.map((_, i) => `$${i + 1}`);
    cols.push("created_by", "updated_by");
    placeholders.push(`$${vals.length + 1}`, `$${vals.length + 1}`);
    vals.push(req.user.id);
    const { rows } = await pool.query(
      `INSERT INTO agent_hub_market_intelligence (${cols.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`,
      vals
    );
    await logAudit(req, {
      entity_type: "market_intelligence",
      entity_id: rows[0].id,
      action: "create",
      new_value: { zip: v.zip, month: v.month, data_source: v.data_source },
    });
    res.status(201).json({ entry: mapEntry(rows[0]) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    if (e.code === "23505") {
      res.status(409).json({ error: "Entry already exists for this zip + month + source." });
      return;
    }
    console.error("[agent-hub] market create", e);
    res.status(500).json({ error: "Could not create." });
  }
}

export async function updateMarket(req, res) {
  try {
    assertManagerRole(req.agentHubPerms);
    const id = vIntId(req.params.id, "market id");
    const v = validateEntry(req.body || {});
    const pool = getPool();
    const { rows: oldRows } = await pool.query(
      `SELECT * FROM agent_hub_market_intelligence WHERE id = $1`,
      [id]
    );
    if (!oldRows.length) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    const sets = [];
    const vals = [];
    let n = 1;
    for (const [k, val] of Object.entries(v)) {
      sets.push(`${k} = $${n++}`);
      vals.push(val);
    }
    sets.push(`updated_by = $${n++}`);
    vals.push(req.user.id);
    vals.push(id);
    const { rows } = await pool.query(
      `UPDATE agent_hub_market_intelligence SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    await logFieldDiff(req, "market_intelligence", id, oldRows[0], rows[0], Object.keys(v));
    res.json({ entry: mapEntry(rows[0]) });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] market update", e);
    res.status(500).json({ error: "Could not update." });
  }
}

export async function deleteMarket(req, res) {
  try {
    assertManagerRole(req.agentHubPerms);
    const id = vIntId(req.params.id, "market id");
    const pool = getPool();
    const { rowCount } = await pool.query(
      `DELETE FROM agent_hub_market_intelligence WHERE id = $1`,
      [id]
    );
    if (!rowCount) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    await logAudit(req, { entity_type: "market_intelligence", entity_id: id, action: "delete" });
    res.json({ ok: true });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] market delete", e);
    res.status(500).json({ error: "Could not delete." });
  }
}

// Reuses the same parseCsv from revenue route conceptually but we'll
// keep it inline + simple here. Multi-line quoted fields supported.
function parseCsv(text) {
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
        } else inQuote = false;
      } else cur += c;
    } else if (c === '"') inQuote = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); rows.push(row); cur = ""; row = []; }
    else if (c === "\r") {
      if (text[i + 1] !== "\n") { row.push(cur); rows.push(row); cur = ""; row = []; }
    }
    else cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") rows.pop();
  return rows;
}

export async function bulkImportMarket(req, res) {
  try {
    assertManagerRole(req.agentHubPerms);
    const csv = String(req.body?.csv || "").trim();
    if (!csv) {
      res.status(400).json({ error: "csv body field is required." });
      return;
    }
    const rows = parseCsv(csv);
    if (rows.length < 2) {
      res.status(400).json({ error: "CSV needs a header + at least one data row." });
      return;
    }
    const header = rows[0].map((s) => s.trim().toLowerCase());
    const required = ["zip", "month"];
    for (const r of required) {
      if (!header.includes(r)) {
        res.status(400).json({ error: `Missing required column: ${r}` });
        return;
      }
    }
    const idx = (k) => header.indexOf(k);
    const errors = [];
    let imported = 0;
    let updated = 0;
    const pool = getPool();
    for (let i = 1; i < rows.length; i++) {
      const cols = rows[i];
      try {
        const entry = validateEntry({
          zip: cols[idx("zip")],
          month: cols[idx("month")],
          avg_lease_price: idx("avg_lease_price") >= 0 ? cols[idx("avg_lease_price")] : null,
          median_lease_price: idx("median_lease_price") >= 0 ? cols[idx("median_lease_price")] : null,
          total_active_listings: idx("total_active_listings") >= 0 ? cols[idx("total_active_listings")] : null,
          total_leased: idx("total_leased") >= 0 ? cols[idx("total_leased")] : null,
          avg_days_on_market: idx("avg_days_on_market") >= 0 ? cols[idx("avg_days_on_market")] : null,
          inventory_level: idx("inventory_level") >= 0 ? cols[idx("inventory_level")] : null,
          notable_events: idx("notable_events") >= 0 ? cols[idx("notable_events")] : null,
          data_source: idx("data_source") >= 0 ? cols[idx("data_source")] : "manual",
          source_notes: idx("source_notes") >= 0 ? cols[idx("source_notes")] : null,
        });
        const { rows: r } = await pool.query(
          `INSERT INTO agent_hub_market_intelligence
             (zip, month, avg_lease_price, median_lease_price, total_active_listings, total_leased,
              avg_days_on_market, inventory_level, notable_events, data_source, source_notes,
              created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
           ON CONFLICT (zip, month, data_source) DO UPDATE SET
             avg_lease_price = EXCLUDED.avg_lease_price,
             median_lease_price = EXCLUDED.median_lease_price,
             total_active_listings = EXCLUDED.total_active_listings,
             total_leased = EXCLUDED.total_leased,
             avg_days_on_market = EXCLUDED.avg_days_on_market,
             inventory_level = EXCLUDED.inventory_level,
             notable_events = COALESCE(EXCLUDED.notable_events, agent_hub_market_intelligence.notable_events),
             source_notes = COALESCE(EXCLUDED.source_notes, agent_hub_market_intelligence.source_notes),
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()
           RETURNING (xmax = 0) AS inserted`,
          [
            entry.zip, entry.month, entry.avg_lease_price, entry.median_lease_price,
            entry.total_active_listings, entry.total_leased, entry.avg_days_on_market,
            entry.inventory_level, entry.notable_events, entry.data_source, entry.source_notes,
            req.user.id,
          ]
        );
        if (r[0].inserted) imported++;
        else updated++;
      } catch (e) {
        errors.push({ row: i + 1, error: e.message });
      }
    }
    await logAudit(req, {
      entity_type: "market_intelligence",
      action: "bulk_update",
      context: { imported, updated, errors: errors.length },
    });
    res.json({ imported, updated, errors });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] market bulk import", e);
    res.status(500).json({ error: "Could not import." });
  }
}
