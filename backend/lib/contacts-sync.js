/**
 * Contacts sync: cached AppFolio mirror → contacts hub.
 *
 * Runs at the end of every runFullSync (and on demand via
 * POST /contacts/resync). Reads the freshly reloaded cached_* tables and
 * upserts into contacts / contact_identities. Never references cache row
 * ids — those are wiped every sync. Identity is (source, external_id);
 * fallback dedup is exact lowercased email.
 *
 * Match precedence per incoming row:
 *   1. contact_identities (source, external_id)  → update that contact
 *   2. contacts by LOWER(email)                  → attach identity to it
 *   3. contacts by LOWER(display_name) among same-source contacts
 *      (only when the row has no email — keeps email-less tenants from
 *      duplicating every sync without risking cross-source name merges)
 *   4. insert a new contact (+ identity when external_id exists)
 *
 * Field updates respect contacts.manual_overrides: any column key
 * present there was hand-edited and is never overwritten by sync.
 * Incoming empty values never clobber existing data.
 */

/**
 * db.js is loaded lazily so the pure extractors above can be unit-tested
 * without the full backend dependency tree (db.js imports bcryptjs/pg at
 * module load). Same pattern as lib/appfolio-db/client.js.
 */
let _getPool = null;
async function pool() {
  if (!_getPool) {
    const m = await import("./db.js");
    _getPool = m.getPool;
  }
  return _getPool();
}

/* ============================================================
   Pure extractors — no DB. Exported for unit tests.
   ============================================================ */

function firstString(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}

/** "Doe, John" → { first: "John", last: "Doe" }; "John Doe" → split on last space. */
export function splitPersonName(raw) {
  const s = (raw || "").trim();
  if (!s) return { first: null, last: null, display: null };
  if (s.includes(",")) {
    const [last, first] = s.split(",", 2).map((p) => p.trim());
    const display = [first, last].filter(Boolean).join(" ") || s;
    return { first: first || null, last: last || null, display };
  }
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { first: s, last: null, display: s };
  const first = parts.slice(0, -1).join(" ");
  const last = parts[parts.length - 1];
  return { first, last, display: s };
}

/** cached_rent_roll row → normalized contact record (null = unusable). */
export function extractTenant(data) {
  if (!data || typeof data !== "object") return null;
  const rawName = firstString(data, ["tenant", "primary_tenant", "tenant_name"]);
  if (!rawName) return null; // vacant unit rows have no tenant
  const { first, last, display } = splitPersonName(rawName);
  return {
    source: "appfolio_tenant",
    externalId: firstString(data, ["tenant_id", "tenant_i_d", "occupancy_id"]),
    displayName: display,
    firstName: first,
    lastName: last,
    company: null,
    email: firstString(data, ["primary_tenant_email", "tenant_email", "email"]),
    phone: firstString(data, [
      "primary_tenant_phone_number",
      "tenant_phone",
      "phone_numbers",
      "phone",
    ]),
    metadata: {
      property_id: firstString(data, ["property_id"]),
      property_name: firstString(data, ["property_name"]),
      unit: firstString(data, ["unit", "unit_name"]),
      lease_from: firstString(data, ["lease_from"]),
      lease_to: firstString(data, ["lease_to"]),
      status: firstString(data, ["status"]),
    },
  };
}

/** cached_owners row → normalized contact record. */
export function extractOwner(data) {
  if (!data || typeof data !== "object") return null;
  const rawName = firstString(data, ["owner_name", "name", "full_name"]);
  if (!rawName) return null;
  // Owner names are frequently companies/trusts — don't split into
  // first/last; a wrong split is worse than none.
  return {
    source: "appfolio_owner",
    externalId: firstString(data, ["owner_id", "owner_i_d"]),
    displayName: rawName,
    firstName: null,
    lastName: null,
    company: null,
    email: firstString(data, ["email", "owner_email"]),
    phone: firstString(data, ["phone", "phone_number", "owner_phone"]),
    metadata: {},
  };
}

/** cached_vendors row → normalized contact record. */
export function extractVendor(data) {
  if (!data || typeof data !== "object") return null;
  const rawName = firstString(data, ["vendor_name", "name", "company_name"]);
  if (!rawName) return null;
  return {
    source: "appfolio_vendor",
    externalId: firstString(data, ["vendor_id", "vendor_i_d"]),
    displayName: rawName,
    firstName: null,
    lastName: null,
    company: rawName,
    email: firstString(data, ["email", "vendor_email"]),
    phone: firstString(data, ["phone", "phone_number", "vendor_phone"]),
    metadata: {
      vendor_type: firstString(data, ["vendor_type", "type", "trade"]),
    },
  };
}

/**
 * Which synced columns should change, given the incoming record, the
 * current row, and manual_overrides. Pure — exported for unit tests.
 * Empty/null incoming values never clobber; overridden fields are skipped.
 */
export function diffSyncedFields(incoming, existingRow) {
  const overrides = existingRow.manual_overrides || {};
  const candidates = {
    display_name: incoming.displayName,
    first_name: incoming.firstName,
    last_name: incoming.lastName,
    company: incoming.company,
    email: incoming.email,
    phone: incoming.phone,
  };
  const changes = {};
  for (const [col, val] of Object.entries(candidates)) {
    if (val == null || val === "") continue;
    if (overrides[col]) continue;
    if ((existingRow[col] ?? null) === val) continue;
    changes[col] = val;
  }
  return changes;
}

/* ============================================================
   Upsert engine
   ============================================================ */

async function applyFieldChanges(pool, contactId, changes) {
  const cols = Object.keys(changes);
  if (!cols.length) return;
  const sets = cols.map((c, i) => `${c} = $${i + 2}`);
  sets.push("updated_at = NOW()");
  await pool.query(
    `UPDATE contacts SET ${sets.join(", ")} WHERE id = $1`,
    [contactId, ...cols.map((c) => changes[c])]
  );
}

async function upsertOne(pool, rec, counters) {
  // 1. Identity match.
  if (rec.externalId) {
    const { rows } = await pool.query(
      `SELECT c.* FROM contact_identities ci
        JOIN contacts c ON c.id = ci.contact_id
       WHERE ci.source = $1 AND ci.external_id = $2`,
      [rec.source, rec.externalId]
    );
    if (rows.length) {
      const contact = rows[0];
      await pool.query(
        `UPDATE contact_identities
            SET metadata = $3::jsonb, last_synced_at = NOW()
          WHERE source = $1 AND external_id = $2`,
        [rec.source, rec.externalId, JSON.stringify(rec.metadata || {})]
      );
      await applyFieldChanges(pool, contact.id, diffSyncedFields(rec, contact));
      counters.updated += 1;
      return;
    }
  }

  // 2. Email match (non-merged, non-archived).
  let contactId = null;
  if (rec.email) {
    const { rows } = await pool.query(
      `SELECT * FROM contacts
        WHERE LOWER(email) = LOWER($1)
          AND merged_into_contact_id IS NULL
          AND archived_at IS NULL
        ORDER BY id ASC LIMIT 1`,
      [rec.email]
    );
    if (rows.length) {
      contactId = rows[0].id;
      await applyFieldChanges(pool, contactId, diffSyncedFields(rec, rows[0]));
    }
  }

  // 3. Name match within the same source (only when the row has no email).
  if (!contactId && !rec.email && rec.displayName) {
    const { rows } = await pool.query(
      `SELECT c.* FROM contacts c
        JOIN contact_identities ci ON ci.contact_id = c.id AND ci.source = $2
       WHERE LOWER(c.display_name) = LOWER($1)
         AND c.merged_into_contact_id IS NULL
         AND c.archived_at IS NULL
       ORDER BY c.id ASC LIMIT 1`,
      [rec.displayName, rec.source]
    );
    if (rows.length) {
      contactId = rows[0].id;
      await applyFieldChanges(pool, contactId, diffSyncedFields(rec, rows[0]));
    }
  }

  // 4. Insert.
  if (!contactId) {
    const { rows } = await pool.query(
      `INSERT INTO contacts
         (display_name, first_name, last_name, company, email, phone)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id`,
      [
        rec.displayName,
        rec.firstName,
        rec.lastName,
        rec.company,
        rec.email,
        rec.phone,
      ]
    );
    contactId = rows[0].id;
    counters.created += 1;
  } else {
    counters.updated += 1;
  }

  // Attach the identity when we have a stable external id. ON CONFLICT
  // keeps re-runs idempotent (a concurrent path may have created it).
  if (rec.externalId) {
    await pool.query(
      `INSERT INTO contact_identities
         (contact_id, source, external_id, metadata, last_synced_at)
       VALUES ($1,$2,$3,$4::jsonb,NOW())
       ON CONFLICT (source, external_id)
       DO UPDATE SET metadata = EXCLUDED.metadata, last_synced_at = NOW()`,
      [contactId, rec.source, rec.externalId, JSON.stringify(rec.metadata || {})]
    );
  }
}

/**
 * Upsert contacts from the cached AppFolio tables. Called at the end of
 * runFullSync and from POST /contacts/resync. Per-row failures are
 * counted, logged, and skipped — one bad row never aborts the pass.
 */
export async function upsertContactsFromCache(triggeredBy = "sync") {
  const db = await pool();
  const counters = { created: 0, updated: 0, skipped: 0, errors: 0 };

  const sources = [
    { table: "cached_rent_roll", extract: extractTenant },
    { table: "cached_owners", extract: extractOwner },
    { table: "cached_vendors", extract: extractVendor },
  ];

  for (const { table, extract } of sources) {
    let rows;
    try {
      ({ rows } = await db.query(`SELECT appfolio_data FROM ${table}`));
    } catch (e) {
      console.error(`[contacts-sync] read ${table} failed:`, e.message);
      counters.errors += 1;
      continue;
    }
    for (const row of rows) {
      const rec = extract(row.appfolio_data);
      if (!rec) {
        counters.skipped += 1;
        continue;
      }
      try {
        await upsertOne(db, rec, counters);
      } catch (e) {
        counters.errors += 1;
        console.error(
          `[contacts-sync] upsert failed (${rec.source} ${rec.displayName}):`,
          e.message
        );
      }
    }
  }

  console.log(
    `[contacts-sync] ${triggeredBy}: created=${counters.created} updated=${counters.updated} skipped=${counters.skipped} errors=${counters.errors}`
  );
  return counters;
}
