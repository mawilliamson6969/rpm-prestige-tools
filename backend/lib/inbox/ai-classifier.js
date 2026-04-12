import Anthropic from "@anthropic-ai/sdk";
import { getPool } from "../db.js";

const MODEL = "claude-sonnet-4-20250514";

function marketingPattern(senderEmail) {
  const e = String(senderEmail || "").toLowerCase();
  if (!e) return false;
  return (
    e.includes("noreply@") ||
    e.includes("no-reply@") ||
    e.includes("newsletter@") ||
    e.includes("marketing@") ||
    e.includes("donotreply@") ||
    e.includes("notification@")
  );
}

async function lookupProperty(pool, fragment) {
  if (!fragment?.trim()) return null;
  const q = `%${fragment.trim().slice(0, 80)}%`;
  const { rows } = await pool.query(
    `SELECT appfolio_data->>'property_name' AS n FROM cached_properties
     WHERE appfolio_data->>'property_name' ILIKE $1 OR appfolio_data->>'property_address' ILIKE $1
     LIMIT 1`,
    [q]
  );
  return rows[0]?.n?.trim() || null;
}

async function lookupTenant(pool, fragment) {
  if (!fragment?.trim()) return null;
  const q = `%${fragment.trim().slice(0, 80)}%`;
  const { rows } = await pool.query(
    `SELECT appfolio_data->>'tenant' AS n FROM cached_rent_roll
     WHERE appfolio_data->>'tenant' ILIKE $1 LIMIT 1`,
    [q]
  );
  return rows[0]?.n?.trim() || null;
}

async function lookupOwner(pool, fragment) {
  if (!fragment?.trim()) return null;
  const q = `%${fragment.trim().slice(0, 80)}%`;
  const { rows } = await pool.query(
    `SELECT appfolio_data->>'name' AS n FROM cached_owners
     WHERE appfolio_data->>'name' ILIKE $1 LIMIT 1`,
    [q]
  );
  return rows[0]?.n?.trim() || null;
}

async function resolveAssigneeUsername(pool, username) {
  const u = String(username || "")
    .trim()
    .toLowerCase();
  if (!u) return null;
  const { rows } = await pool.query(`SELECT id FROM users WHERE lower(username) = $1 LIMIT 1`, [u]);
  return rows[0]?.id ?? null;
}

function extractJson(text) {
  if (!text) return null;
  let s = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/im.exec(s);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * Classify ticket by id; updates tickets row.
 */
export async function classifyTicket(ticketId) {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return;

  const pool = getPool();
  const { rows } = await pool.query(`SELECT * FROM tickets WHERE id = $1`, [ticketId]);
  if (!rows.length) return;
  const t = rows[0];

  if (marketingPattern(t.sender_email)) {
    await pool.query(
      `UPDATE tickets SET priority = 5, category = 'marketing', updated_at = NOW() WHERE id = $1`,
      [ticketId]
    );
    return;
  }

  const preview = String(t.body_preview || "").slice(0, 500);
  const prompt = `You are classifying an incoming email for RPM Prestige, a property management company in Houston, TX.

Email subject: ${JSON.stringify(t.subject || "")}
Email from: ${JSON.stringify(t.sender_name || "")} <${t.sender_email || ""}>
Email body (first 500 chars): ${JSON.stringify(preview)}

Classify this email and return ONLY valid JSON:
{
  "priority": (0-100, where: legal/emergency=90-100, owner complaints=70-89, maintenance=50-69, leasing=40-59, routine=20-39, newsletters/marketing/spam=0-19),
  "category": (one of: "maintenance", "leasing", "accounting", "owner", "tenant", "vendor", "legal", "internal", "marketing", "other"),
  "assignee": (one of: "amanda" for maintenance, "leslie" for leasing, "lori" for owner relations/accounting, "mike" for legal/general/other, "amelia" for operations),
  "propertySearch": (a property name or address fragment to search for, or null),
  "tenantSearch": (a tenant name to search for, or null),
  "ownerSearch": (an owner name to search for, or null),
  "summary": (one sentence summary of what this email is about),
  "isActionable": (true if this requires a response or action, false for newsletters/receipts/notifications)
}`;

  const anthropic = new Anthropic({ apiKey: key });
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
  const data = extractJson(text);
  if (!data || typeof data.priority !== "number") {
    return;
  }

  if (data.priority < 10) {
    await pool.query(
      `UPDATE tickets SET priority = $1, category = COALESCE($2, 'other'), ai_summary = $3, updated_at = NOW() WHERE id = $4`,
      [Math.max(0, Math.min(100, data.priority)), data.category || "other", data.summary || null, ticketId]
    );
    return;
  }

  const [propName, tenName, ownName] = await Promise.all([
    lookupProperty(pool, data.propertySearch),
    lookupTenant(pool, data.tenantSearch),
    lookupOwner(pool, data.ownerSearch),
  ]);

  const assigneeId = await resolveAssigneeUsername(pool, data.assignee);

  await pool.query(
    `UPDATE tickets SET
      priority = $1,
      category = $2,
      ai_summary = $3,
      assigned_to = COALESCE($4, assigned_to),
      linked_property_name = COALESCE($5, linked_property_name),
      linked_tenant_name = COALESCE($6, linked_tenant_name),
      linked_owner_name = COALESCE($7, linked_owner_name),
      updated_at = NOW()
     WHERE id = $8`,
    [
      Math.max(0, Math.min(100, Math.round(data.priority))),
      String(data.category || "other").slice(0, 50),
      data.summary || null,
      assigneeId,
      propName,
      tenName,
      ownName,
      ticketId,
    ]
  );
}
