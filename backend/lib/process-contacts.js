/**
 * Process ↔ contact attachment engine.
 *
 * Auto-attach: when a process launches against a property, find the
 * property's tenant (via contact_identities.metadata.property_id, kept
 * fresh by contacts-sync) and owner (via cached_properties.owner_i_ds →
 * appfolio_owner identities) and link them with the roles the template
 * declares in contact_roles.
 *
 * All lookups go through the stable contacts/contact_identities tables —
 * never cache row ids (the cached_* tables are wiped every sync). The
 * cached_properties read below is by VALUE (property_id / owner ids in
 * jsonb), which survives the wipe-and-reload.
 *
 * Best-effort: callers treat failures as non-fatal (a launch must never
 * fail because contact matching did).
 */

import { getPool } from "./db.js";

/** Roles array from a template row's contact_roles jsonb (tolerant). */
export function templateRoles(template) {
  const raw = template?.contact_roles;
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  return ["tenant", "owner"];
}

/**
 * Find tenant contacts for a property. Matches identity metadata by
 * property_id first (stable), property_name second (renames happen).
 */
export async function findTenantContacts(pool, { propertyId, propertyName }) {
  if (propertyId != null) {
    const { rows } = await pool.query(
      `SELECT c.*, ci.metadata
         FROM contact_identities ci
         JOIN contacts c ON c.id = ci.contact_id
        WHERE ci.source = 'appfolio_tenant'
          AND ci.metadata ->> 'property_id' = $1::text
          AND c.merged_into_contact_id IS NULL AND c.archived_at IS NULL
        ORDER BY c.id ASC`,
      [String(propertyId)]
    );
    if (rows.length) return rows;
  }
  if (propertyName) {
    const { rows } = await pool.query(
      `SELECT c.*, ci.metadata
         FROM contact_identities ci
         JOIN contacts c ON c.id = ci.contact_id
        WHERE ci.source = 'appfolio_tenant'
          AND LOWER(ci.metadata ->> 'property_name') = LOWER($1)
          AND c.merged_into_contact_id IS NULL AND c.archived_at IS NULL
        ORDER BY c.id ASC`,
      [propertyName]
    );
    return rows;
  }
  return [];
}

/**
 * Find owner contacts for a property: cached_properties row → owner_i_ds
 * → appfolio_owner identities. The cache read is by value, not row id.
 */
export async function findOwnerContacts(pool, { propertyId, propertyName }) {
  let prop = null;
  if (propertyId != null) {
    const { rows } = await pool.query(
      `SELECT appfolio_data FROM cached_properties
        WHERE appfolio_data ->> 'property_id' = $1::text LIMIT 1`,
      [String(propertyId)]
    );
    prop = rows[0]?.appfolio_data ?? null;
  }
  if (!prop && propertyName) {
    const { rows } = await pool.query(
      `SELECT appfolio_data FROM cached_properties
        WHERE LOWER(appfolio_data ->> 'property_name') = LOWER($1) LIMIT 1`,
      [propertyName]
    );
    prop = rows[0]?.appfolio_data ?? null;
  }
  if (!prop) return [];

  const ownerIds = Array.isArray(prop.owner_i_ds)
    ? prop.owner_i_ds.map(String)
    : typeof prop.owner_i_ds === "string"
    ? prop.owner_i_ds.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
    : [];
  if (!ownerIds.length) return [];

  const { rows } = await pool.query(
    `SELECT c.*, ci.metadata
       FROM contact_identities ci
       JOIN contacts c ON c.id = ci.contact_id
      WHERE ci.source = 'appfolio_owner'
        AND ci.external_id = ANY($1::text[])
        AND c.merged_into_contact_id IS NULL AND c.archived_at IS NULL
      ORDER BY c.id ASC`,
    [ownerIds]
  );
  return rows;
}

/**
 * Attach one contact to a process under a role. First attachment for a
 * role becomes primary. Idempotent via the UNIQUE constraint.
 * Returns the row (or the pre-existing one).
 */
export async function attachContact(
  pool,
  { processId, contactId, role, addedBy = null, addedVia = "manual" }
) {
  const { rows: existingPrimary } = await pool.query(
    `SELECT 1 FROM process_contacts
      WHERE process_id = $1 AND role = $2 AND is_primary = TRUE LIMIT 1`,
    [processId, role]
  );
  const { rows } = await pool.query(
    `INSERT INTO process_contacts
       (process_id, contact_id, role, is_primary, added_by, added_via)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (process_id, contact_id, role) DO NOTHING
     RETURNING *`,
    [processId, contactId, role, existingPrimary.length === 0, addedBy, addedVia]
  );
  if (rows.length) return rows[0];
  const { rows: existing } = await pool.query(
    `SELECT * FROM process_contacts
      WHERE process_id = $1 AND contact_id = $2 AND role = $3`,
    [processId, contactId, role]
  );
  return existing[0] ?? null;
}

/**
 * Auto-attach at launch. Loads the process + its template's contact_roles
 * and attaches the property's tenant(s) and owner(s) for whichever of
 * those roles the template declares. Vendors are never auto-attached —
 * the right vendor isn't knowable at launch time.
 */
export async function autoAttachProcessContacts(processId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT p.id, p.property_id, p.property_name, t.contact_roles
       FROM processes p
       LEFT JOIN process_templates t ON t.id = p.template_id
      WHERE p.id = $1`,
    [processId]
  );
  if (!rows.length) return { attached: 0 };
  const proc = rows[0];
  if (proc.property_id == null && !proc.property_name) return { attached: 0 };

  const roles = templateRoles(proc);
  const where = { propertyId: proc.property_id, propertyName: proc.property_name };
  let attached = 0;

  if (roles.includes("tenant")) {
    for (const c of await findTenantContacts(pool, where)) {
      const row = await attachContact(pool, {
        processId,
        contactId: c.id,
        role: "tenant",
        addedVia: "auto_launch",
      });
      if (row) attached += 1;
    }
  }
  if (roles.includes("owner")) {
    for (const c of await findOwnerContacts(pool, where)) {
      const row = await attachContact(pool, {
        processId,
        contactId: c.id,
        role: "owner",
        addedVia: "auto_launch",
      });
      if (row) attached += 1;
    }
  }
  return { attached };
}
