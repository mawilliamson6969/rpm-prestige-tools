import { getPool } from "./db.js";

/**
 * Phase 3: resolve {{namespace.field}} merge tokens in email/text template
 * bodies and subjects against the running process, its linked AppFolio
 * cached property/tenant/owner data, custom field values, and the sender.
 *
 * Returns the rendered text. Unknown tokens render as empty string so the
 * recipient never sees a raw {{...}}.
 */

const COMPANY_DEFAULTS = {
  name: "Real Property Management Prestige",
  phone: "(281) 984-7463",
  website: "www.rpmhouston.com",
};

function firstWord(s) {
  if (!s || typeof s !== "string") return "";
  return s.trim().split(/\s+/)[0] || "";
}

function fmtDate(v) {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function fmtMoney(v) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(String(v).replace(/[$,]/g, ""));
  if (!Number.isFinite(n)) return String(v);
  return `$${n.toLocaleString()}`;
}

function pickValueRow(r) {
  const t = r.field_type;
  if (t === "boolean") return r.value_boolean;
  if (t === "date") return r.value_date;
  if (t === "datetime") return r.value_datetime;
  if (
    t === "number" ||
    t === "currency" ||
    t === "percentage" ||
    t === "rating" ||
    t === "user"
  )
    return r.value_number;
  if (
    t === "multiselect" ||
    t === "file" ||
    t === "property" ||
    t === "address" ||
    t === "checklist"
  )
    return r.value_json;
  return r.value_text;
}

/**
 * Build the merge-context object for a process. Cached for the duration of
 * a single send; do not memoize across sends or stale values would leak.
 */
export async function buildMergeContext(processId, senderId, poolArg) {
  const pool = poolArg || getPool();

  const { rows: procRows } = await pool.query(
    `SELECT p.*, t.name AS template_name,
            cs.name AS current_stage_name
     FROM processes p
     LEFT JOIN process_templates t ON t.id = p.template_id
     LEFT JOIN process_template_stages cs ON cs.id = p.current_stage_id
     WHERE p.id = $1`,
    [processId]
  );
  const proc = procRows[0] || null;

  // Property — match on property_id (string-cast in JSONB) or name.
  let prop = null;
  if (proc?.property_id) {
    const { rows } = await pool.query(
      `SELECT appfolio_data FROM cached_properties
       WHERE appfolio_data->>'property_id' = $1::text LIMIT 1`,
      [proc.property_id]
    );
    if (rows.length) prop = rows[0].appfolio_data;
  }
  if (!prop && proc?.property_name) {
    const { rows } = await pool.query(
      `SELECT appfolio_data FROM cached_properties
       WHERE LOWER(appfolio_data->>'property_name') = LOWER($1)
          OR LOWER(appfolio_data->>'property') = LOWER($1)
       ORDER BY LENGTH(appfolio_data->>'property_name')
       LIMIT 1`,
      [proc.property_name]
    );
    if (rows.length) prop = rows[0].appfolio_data;
  }

  // Tenant — from rent roll.
  let tenant = null;
  if (proc?.property_id) {
    const { rows } = await pool.query(
      `SELECT appfolio_data FROM cached_rent_roll
       WHERE appfolio_data->>'property_id' = $1::text LIMIT 1`,
      [proc.property_id]
    );
    if (rows.length) tenant = rows[0].appfolio_data;
  }
  if (!tenant && proc?.property_name) {
    const { rows } = await pool.query(
      `SELECT appfolio_data FROM cached_rent_roll
       WHERE LOWER(appfolio_data->>'property_name') = LOWER($1) LIMIT 1`,
      [proc.property_name]
    );
    if (rows.length) tenant = rows[0].appfolio_data;
  }

  // Owner — via property's owner_i_ds, falling back to process.contact_*.
  let owner = null;
  const ownerIds = Array.isArray(prop?.owner_i_ds)
    ? prop.owner_i_ds
    : typeof prop?.owner_i_ds === "string"
    ? prop.owner_i_ds
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  if (ownerIds.length) {
    const { rows } = await pool.query(
      `SELECT appfolio_data FROM cached_owners
       WHERE appfolio_data->>'owner_id' = ANY($1::text[]) LIMIT 1`,
      [ownerIds]
    );
    if (rows.length) owner = rows[0].appfolio_data;
  }

  // Custom field values (process-level + step-level).
  const fieldsByLabel = new Map();
  if (proc?.id) {
    const { rows: pv } = await pool.query(
      `SELECT v.*, d.field_label, d.field_type
       FROM custom_field_values v
       JOIN custom_field_definitions d ON d.id = v.field_definition_id
       WHERE v.entity_type = 'process' AND v.entity_id = $1
       ORDER BY v.updated_at DESC`,
      [proc.id]
    );
    for (const r of pv) {
      if (!fieldsByLabel.has(r.field_label)) {
        fieldsByLabel.set(r.field_label, pickValueRow(r));
      }
    }
    const { rows: sv } = await pool.query(
      `SELECT v.*, d.field_label, d.field_type
       FROM custom_field_values v
       JOIN custom_field_definitions d ON d.id = v.field_definition_id
       JOIN process_steps s ON s.id = v.entity_id
       WHERE v.entity_type = 'process_step' AND s.process_id = $1
       ORDER BY v.updated_at DESC`,
      [proc.id]
    );
    for (const r of sv) {
      if (!fieldsByLabel.has(r.field_label)) {
        fieldsByLabel.set(r.field_label, pickValueRow(r));
      }
    }
  }

  // Sender.
  let sender = null;
  if (Number.isFinite(Number(senderId))) {
    const { rows } = await pool.query(
      `SELECT id, display_name, username FROM users WHERE id = $1`,
      [Number(senderId)]
    );
    if (rows.length) sender = rows[0];
  }

  // Sender's outgoing email — best-effort: pick their personal Microsoft
  // connection if available.
  let senderEmail = null;
  if (sender?.id) {
    const { rows } = await pool.query(
      `SELECT mailbox_email FROM email_connections
       WHERE user_id = $1 AND is_active = true
       ORDER BY id DESC LIMIT 1`,
      [sender.id]
    );
    if (rows.length) senderEmail = rows[0].mailbox_email;
  }

  return {
    process: proc,
    property: prop,
    tenant,
    owner,
    customFields: fieldsByLabel,
    sender,
    senderEmail,
  };
}

/**
 * Render a single token like "tenant.first_name" into its value using ctx.
 * Returns "" when unknown.
 */
function resolveToken(token, ctx) {
  const trimmed = token.trim();
  if (trimmed.startsWith("field.")) {
    const label = trimmed.slice("field.".length).trim();
    const v = ctx.customFields.get(label);
    if (v === null || v === undefined) return "";
    if (typeof v === "boolean") return v ? "Yes" : "No";
    if (Array.isArray(v)) return v.join(", ");
    return String(v);
  }
  const [ns, ...rest] = trimmed.split(".");
  const key = rest.join(".");
  const proc = ctx.process || {};
  const prop = ctx.property || {};
  const tenant = ctx.tenant || {};
  const owner = ctx.owner || {};
  const sender = ctx.sender || {};

  if (ns === "process") {
    if (key === "name") return proc.name || "";
    if (key === "stage") return proc.current_stage_name || "";
    if (key === "due_date") return fmtDate(proc.target_completion);
    if (key === "created_date") return fmtDate(proc.started_at);
    return "";
  }
  if (ns === "property") {
    if (key === "address") {
      const street = prop.property_address || prop.address || prop.property_name;
      const city = prop.city || "";
      const state = prop.state || "";
      const zip = prop.zip_code || prop.zip || "";
      const tail = [city, state].filter(Boolean).join(", ");
      const full = [street, tail, zip].filter(Boolean).join(", ");
      return full || proc.property_name || "";
    }
    if (key === "city") return prop.city || "";
    if (key === "state") return prop.state || "";
    if (key === "zip") return prop.zip_code || prop.zip || "";
    if (key === "type") return prop.property_type || prop.type || "";
    if (key === "rent") return fmtMoney(prop.rent || tenant.rent);
    if (key === "sqft") return prop.sqft || prop.square_feet || "";
    if (key === "beds_baths") {
      const b = prop.bedrooms ?? prop.beds;
      const ba = prop.bathrooms ?? prop.baths;
      if (b == null && ba == null) return "";
      return `${b ?? "?"}/${ba ?? "?"}`;
    }
    return "";
  }
  if (ns === "tenant") {
    const name = tenant.tenant || tenant.name || tenant.primary_tenant || "";
    if (key === "name") return name;
    if (key === "first_name") return firstWord(name);
    if (key === "email") return tenant.primary_tenant_email || tenant.email || "";
    if (key === "phone")
      return tenant.primary_tenant_phone_number || tenant.phone_numbers || tenant.phone || "";
    if (key === "lease_from") return fmtDate(tenant.lease_from);
    if (key === "lease_to") return fmtDate(tenant.lease_to);
    if (key === "deposit") return fmtMoney(tenant.deposit);
    if (key === "status") return tenant.status || "";
    return "";
  }
  if (ns === "owner") {
    const name =
      owner.owner_name || owner.name || owner.full_name || proc.contact_name || "";
    if (key === "name") return name;
    if (key === "first_name") return firstWord(name);
    if (key === "email") return owner.email || proc.contact_email || "";
    if (key === "phone") return owner.phone || owner.phone_number || proc.contact_phone || "";
    return "";
  }
  if (ns === "sender") {
    if (key === "name") return sender.display_name || sender.username || "";
    if (key === "email") return ctx.senderEmail || "";
    if (key === "phone") return COMPANY_DEFAULTS.phone;
    return "";
  }
  if (ns === "company") {
    if (key === "name") return COMPANY_DEFAULTS.name;
    if (key === "phone") return COMPANY_DEFAULTS.phone;
    if (key === "website") return COMPANY_DEFAULTS.website;
    return "";
  }
  return "";
}

/**
 * Replace every {{token}} in `text` using ctx (built via buildMergeContext).
 * Tolerates spaces inside the braces.
 */
export function applyMergeContext(text, ctx) {
  if (typeof text !== "string" || !text) return text;
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, token) => {
    try {
      return resolveToken(token, ctx);
    } catch {
      return "";
    }
  });
}

/** Convenience: build context + render in one shot. */
export async function resolveMergeFields(text, processId, senderId) {
  if (typeof text !== "string" || !text) return text;
  const ctx = await buildMergeContext(processId, senderId);
  return applyMergeContext(text, ctx);
}
