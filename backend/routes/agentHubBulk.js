/**
 * Phase 1 Agent Hub: bulk operations + CSV export.
 *
 * All bulk ops require manager+ role. Each bulk op writes one audit row
 * per affected agent so the audit log can show "Lori bulk-tagged 47 agents
 * with 'Heights specialist' on 2026-01-04".
 *
 * Bulk operations skip merged/deleted agents silently — operating on a
 * merged loser is a no-op, not an error.
 */

import { getPool } from "../lib/db.js";
import { logAudit } from "../lib/agentHub/audit.js";
import { allowedAgentIdsFor, assertManagerRole, assertPermission } from "../lib/agentHub/permissions.js";
import { vStringReq, vTier } from "../lib/agentHub/validators.js";
import { clearAgentHubDashboardCache } from "./agentHubDashboard.js";

function vIdArray(v) {
  if (!Array.isArray(v)) {
    throw Object.assign(new Error("agent_ids must be an array."), { http: 400 });
  }
  if (!v.length || v.length > 1000) {
    throw Object.assign(new Error("agent_ids must have 1-1000 items."), { http: 400 });
  }
  return v.map((n) => {
    const x = Number(n);
    if (!Number.isFinite(x) || !Number.isInteger(x) || x < 1) {
      throw Object.assign(new Error("agent_ids must be positive integers."), { http: 400 });
    }
    return x;
  });
}

export async function bulkTagAgents(req, res) {
  try {
    assertManagerRole(req.agentHubPerms);
    const ids = vIdArray(req.body?.agent_ids);
    const tag = vStringReq(req.body?.tag, "tag", { maxLen: 64 });
    const pool = getPool();
    // INSERT with ON CONFLICT DO NOTHING — idempotent.
    const { rows } = await pool.query(
      `INSERT INTO agent_hub_tags (agent_id, tag, created_by)
       SELECT a.id, $1, $3
         FROM agent_hub_agents a
        WHERE a.id = ANY($2::int[])
          AND a.status != 'deleted'
          AND a.merged_into_agent_id IS NULL
       ON CONFLICT (agent_id, tag) DO NOTHING
       RETURNING agent_id`,
      [tag, ids, req.user.id]
    );
    await logAudit(req, {
      entity_type: "tag",
      action: "bulk_update",
      new_value: { tag, applied_to_count: rows.length },
      context: { requested_count: ids.length },
    });
    res.json({ ok: true, tagged: rows.length });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] bulk tag", e);
    res.status(500).json({ error: "Could not bulk-tag agents." });
  }
}

export async function bulkChangeTier(req, res) {
  try {
    assertManagerRole(req.agentHubPerms);
    assertPermission(req.agentHubPerms, "can_change_tier");
    const ids = vIdArray(req.body?.agent_ids);
    const tier = vTier(req.body?.tier, { allowNull: false });
    const pool = getPool();
    // Capture pre-update tier per row so we can write per-row diffs.
    const { rows: oldRows } = await pool.query(
      `SELECT id, tier FROM agent_hub_agents
        WHERE id = ANY($1::int[])
          AND status != 'deleted'
          AND merged_into_agent_id IS NULL`,
      [ids]
    );
    const { rows } = await pool.query(
      `UPDATE agent_hub_agents
          SET tier = $1, updated_by = $3
        WHERE id = ANY($2::int[])
          AND status != 'deleted'
          AND merged_into_agent_id IS NULL
       RETURNING id`,
      [tier, ids, req.user.id]
    );
    // Per-row audit so future "did Lori change agent X's tier on Tuesday?" queries work.
    await Promise.all(
      oldRows
        .filter((o) => o.tier !== tier)
        .map((o) =>
          logAudit(req, {
            entity_type: "agent",
            entity_id: o.id,
            action: "update",
            field_name: "tier",
            old_value: o.tier,
            new_value: tier,
            context: { bulk: true },
          })
        )
    );
    clearAgentHubDashboardCache();
    res.json({ ok: true, updated: rows.length });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] bulk tier", e);
    res.status(500).json({ error: "Could not bulk-change tier." });
  }
}

export async function bulkMarkDnc(req, res) {
  try {
    assertManagerRole(req.agentHubPerms);
    assertPermission(req.agentHubPerms, "can_mark_dnc");
    const ids = vIdArray(req.body?.agent_ids);
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE agent_hub_agents
          SET do_not_contact = TRUE,
              status = 'dnc',
              unsubscribed_at = COALESCE(unsubscribed_at, NOW()),
              updated_by = $2
        WHERE id = ANY($1::int[])
          AND status != 'deleted'
          AND merged_into_agent_id IS NULL
          AND do_not_contact = FALSE
       RETURNING id`,
      [ids, req.user.id]
    );
    // Per-row audit
    await Promise.all(
      rows.map((r) =>
        logAudit(req, {
          entity_type: "agent",
          entity_id: r.id,
          action: "update",
          field_name: "do_not_contact",
          old_value: false,
          new_value: true,
          context: { bulk: true },
        })
      )
    );
    clearAgentHubDashboardCache();
    res.json({ ok: true, marked: rows.length });
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] bulk dnc", e);
    res.status(500).json({ error: "Could not bulk-mark DNC." });
  }
}

// ============================================================
// CSV export
// ============================================================
function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  if (/[,"\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function exportAgentsCsv(req, res) {
  try {
    assertPermission(req.agentHubPerms, "can_export");
    const pool = getPool();
    // Outreach role: restrict export to assigned agents only.
    const allowed = allowedAgentIdsFor(req.agentHubPerms);
    const allowedClause = allowed ? `AND a.id = ANY($1::int[])` : "";
    const params = allowed ? [allowed] : [];
    const { rows } = await pool.query(
      `SELECT a.id, a.full_name, a.brokerage_name, a.email,
              a.phone_mobile, a.phone_office,
              a.tier, a.status, a.niche, a.target_zips,
              a.license_number, a.license_state,
              a.last_interaction_date, a.created_at,
              u.display_name AS relationship_owner
         FROM agent_hub_agents a
         LEFT JOIN users u ON u.id = a.relationship_owner_user_id
        WHERE a.status != 'deleted' AND a.merged_into_agent_id IS NULL
          ${allowedClause}
        ORDER BY a.full_name ASC`,
      params
    );
    const header = [
      "id",
      "full_name",
      "brokerage_name",
      "email",
      "phone_mobile",
      "phone_office",
      "tier",
      "status",
      "niche",
      "target_zips",
      "license_number",
      "license_state",
      "last_interaction_date",
      "created_at",
      "relationship_owner",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.id,
          r.full_name,
          r.brokerage_name,
          r.email,
          r.phone_mobile,
          r.phone_office,
          r.tier,
          r.status,
          r.niche,
          Array.isArray(r.target_zips) ? r.target_zips.join("|") : "",
          r.license_number,
          r.license_state,
          r.last_interaction_date,
          r.created_at,
          r.relationship_owner,
        ]
          .map(csvEscape)
          .join(",")
      );
    }
    await logAudit(req, {
      entity_type: "agent",
      action: "export",
      context: { row_count: rows.length, format: "csv" },
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="agent-hub-export-${Date.now()}.csv"`);
    res.send(lines.join("\n"));
  } catch (e) {
    if (e.http) {
      res.status(e.http).json({ error: e.message });
      return;
    }
    console.error("[agent-hub] csv export", e);
    res.status(500).json({ error: "Could not export." });
  }
}
