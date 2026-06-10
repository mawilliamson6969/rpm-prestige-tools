/**
 * Contacts hub: CRUD + search + merge + resync.
 *
 * Mounted under /contacts with requireAuth. Mutations are open to all
 * authenticated team members (matching the operations/tasks posture —
 * contacts are shared working data, not admin config). Merge and resync
 * are admin-only: merge is destructive-ish and resync hits the DB hard.
 *
 * Sync interplay: PATCHing a sync-managed column (display_name,
 * first/last name, company, email, phone) records that column in
 * manual_overrides so the next AppFolio sync won't overwrite the
 * human's edit. Pass clear_overrides: ["email", ...] to hand a field
 * back to the sync.
 */

import { getPool } from "../lib/db.js";
import { upsertContactsFromCache } from "../lib/contacts-sync.js";

const SYNC_MANAGED_COLUMNS = new Set([
  "display_name",
  "first_name",
  "last_name",
  "company",
  "email",
  "phone",
]);

const IDENTITY_SOURCES = new Set([
  "appfolio_tenant",
  "appfolio_owner",
  "appfolio_vendor",
  "rentengine_lead",
  "manual",
]);

function bad(msg) {
  return Object.assign(new Error(msg), { http: 400 });
}

function vIntId(v, label = "id") {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    throw bad(`${label} is invalid.`);
  }
  return n;
}

function vStrOpt(v, label, { maxLen = 500 } = {}) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.length > maxLen) throw bad(`${label} too long (max ${maxLen}).`);
  return s;
}

function vStrReq(v, label, opts) {
  const s = vStrOpt(v, label, opts);
  if (!s) throw bad(`${label} is required.`);
  return s;
}

function vStrArray(v, label, { maxLen = 200, maxItems = 25 } = {}) {
  if (v == null) return [];
  if (!Array.isArray(v)) throw bad(`${label} must be an array.`);
  if (v.length > maxItems) throw bad(`${label} too many items (max ${maxItems}).`);
  return v
    .map((t) => String(t).trim())
    .filter(Boolean)
    .map((t) => {
      if (t.length > maxLen) throw bad(`${label} item too long.`);
      return t;
    });
}

/* ============================================================
   List + search
   ============================================================ */

export async function listContacts(req, res) {
  try {
    const pool = getPool();
    const filters = [
      `c.merged_into_contact_id IS NULL`,
      req.query.archived === "true" ? `c.archived_at IS NOT NULL` : `c.archived_at IS NULL`,
    ];
    const vals = [];
    let n = 1;

    const q = vStrOpt(req.query.q, "q", { maxLen: 200 });
    if (q) {
      filters.push(
        `(c.display_name ILIKE $${n} OR c.email ILIKE $${n} OR c.company ILIKE $${n})`
      );
      vals.push(`%${q}%`);
      n += 1;
    }

    const source = vStrOpt(req.query.source, "source", { maxLen: 40 });
    if (source) {
      if (!IDENTITY_SOURCES.has(source)) throw bad("source is invalid.");
      filters.push(
        `EXISTS (SELECT 1 FROM contact_identities x
                  WHERE x.contact_id = c.id AND x.source = $${n})`
      );
      vals.push(source);
      n += 1;
    }

    const tag = vStrOpt(req.query.tag, "tag", { maxLen: 64 });
    if (tag) {
      filters.push(`$${n} = ANY(c.tags)`);
      vals.push(tag);
      n += 1;
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const { rows } = await pool.query(
      `SELECT c.id, c.display_name, c.first_name, c.last_name, c.company,
              c.email, c.phone, c.tags, c.updated_at,
              COALESCE(
                array_agg(DISTINCT ci.source) FILTER (WHERE ci.source IS NOT NULL),
                '{}'
              ) AS sources,
              COUNT(*) OVER() AS total_count
         FROM contacts c
         LEFT JOIN contact_identities ci ON ci.contact_id = c.id
        WHERE ${filters.join(" AND ")}
        GROUP BY c.id
        ORDER BY LOWER(c.display_name) ASC, c.id ASC
        LIMIT ${limit} OFFSET ${offset}`,
      vals
    );

    const total = rows.length ? Number(rows[0].total_count) : 0;
    res.json({
      contacts: rows.map(({ total_count, ...c }) => c),
      total,
      limit,
      offset,
    });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[contacts] list", e);
    res.status(500).json({ error: "Could not load contacts." });
  }
}

/* ============================================================
   Create (manual)
   ============================================================ */

export async function createContact(req, res) {
  try {
    const body = req.body ?? {};
    const displayName = vStrReq(body.display_name, "display_name", { maxLen: 200 });
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO contacts
         (display_name, first_name, last_name, company, email, phone,
          alt_emails, alt_phones, tags, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        displayName,
        vStrOpt(body.first_name, "first_name", { maxLen: 100 }),
        vStrOpt(body.last_name, "last_name", { maxLen: 100 }),
        vStrOpt(body.company, "company", { maxLen: 200 }),
        vStrOpt(body.email, "email", { maxLen: 254 }),
        vStrOpt(body.phone, "phone", { maxLen: 50 }),
        vStrArray(body.alt_emails, "alt_emails"),
        vStrArray(body.alt_phones, "alt_phones"),
        vStrArray(body.tags, "tags", { maxLen: 64 }),
        vStrOpt(body.notes, "notes", { maxLen: 10000 }),
        req.user.id,
      ]
    );
    res.status(201).json({ contact: rows[0] });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[contacts] create", e);
    res.status(500).json({ error: "Could not create contact." });
  }
}

/* ============================================================
   Detail — contact + identities + recent inbox threads
   ============================================================ */

export async function getContact(req, res) {
  try {
    const id = vIntId(req.params.id, "contact id");
    const pool = getPool();
    const { rows } = await pool.query(`SELECT * FROM contacts WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Contact not found." });
    const contact = rows[0];

    // Follow a merge pointer so stale links land on the survivor.
    if (contact.merged_into_contact_id) {
      return res.json({ merged_into: contact.merged_into_contact_id });
    }

    const { rows: identities } = await pool.query(
      `SELECT id, source, external_id, metadata, last_synced_at, created_at
         FROM contact_identities
        WHERE contact_id = $1
        ORDER BY source ASC, id ASC`,
      [id]
    );

    // Recent inbox threads where this contact appears as sender or
    // recipient (primary email only — alt_emails join lands in PR 2).
    let threads = [];
    if (contact.email) {
      try {
        const { rows: t } = await pool.query(
          `SELECT t.thread_id, t.subject, t.status, t.last_message_at,
                  t.message_count
             FROM threads t
            WHERE EXISTS (
                    SELECT 1 FROM tickets k
                     WHERE k.thread_id = t.thread_id
                       AND k.deleted_at IS NULL
                       AND (
                         LOWER(k.sender_email) = LOWER($1)
                         OR LOWER(COALESCE(k.recipient_emails, '')) LIKE '%' || LOWER($1) || '%'
                       )
                  )
            ORDER BY t.last_message_at DESC
            LIMIT 15`,
          [contact.email]
        );
        threads = t;
      } catch (e) {
        // Inbox tables may be empty/absent in dev — the card still renders.
        console.error("[contacts] threads lookup", e.message);
      }
    }

    // Processes this contact is attached to (PR 2).
    let processes = [];
    try {
      const { rows: p } = await pool.query(
        `SELECT pc.role, pc.is_primary, p.id, p.name, p.status,
                p.property_name, p.started_at, t.slug AS template_slug
           FROM process_contacts pc
           JOIN processes p ON p.id = pc.process_id
           LEFT JOIN process_templates t ON t.id = p.template_id
          WHERE pc.contact_id = $1
          ORDER BY p.started_at DESC NULLS LAST, p.id DESC
          LIMIT 25`,
        [id]
      );
      processes = p;
    } catch (e) {
      console.error("[contacts] processes lookup", e.message);
    }

    res.json({ contact, identities, threads, processes });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[contacts] get", e);
    res.status(500).json({ error: "Could not load contact." });
  }
}

/* ============================================================
   Update — tracks manual_overrides for sync-managed columns
   ============================================================ */

export async function updateContact(req, res) {
  try {
    const id = vIntId(req.params.id, "contact id");
    const body = req.body ?? {};
    const pool = getPool();

    const { rows: existing } = await pool.query(
      `SELECT * FROM contacts WHERE id = $1 AND merged_into_contact_id IS NULL`,
      [id]
    );
    if (!existing.length) return res.status(404).json({ error: "Contact not found." });
    const current = existing[0];

    const allowed = {
      display_name: (v) => vStrReq(v, "display_name", { maxLen: 200 }),
      first_name: (v) => vStrOpt(v, "first_name", { maxLen: 100 }),
      last_name: (v) => vStrOpt(v, "last_name", { maxLen: 100 }),
      company: (v) => vStrOpt(v, "company", { maxLen: 200 }),
      email: (v) => vStrOpt(v, "email", { maxLen: 254 }),
      phone: (v) => vStrOpt(v, "phone", { maxLen: 50 }),
      alt_emails: (v) => vStrArray(v, "alt_emails"),
      alt_phones: (v) => vStrArray(v, "alt_phones"),
      tags: (v) => vStrArray(v, "tags", { maxLen: 64 }),
      notes: (v) => vStrOpt(v, "notes", { maxLen: 10000 }),
    };

    const sets = [];
    const vals = [];
    let n = 1;
    const overrides = { ...(current.manual_overrides || {}) };

    for (const [k, fn] of Object.entries(allowed)) {
      if (body[k] === undefined) continue;
      sets.push(`${k} = $${n++}`);
      vals.push(fn(body[k]));
      // A human edited a sync-managed field: pin it against future syncs.
      if (SYNC_MANAGED_COLUMNS.has(k)) overrides[k] = true;
    }

    // Hand fields back to the sync.
    const clears = vStrArray(body.clear_overrides, "clear_overrides", { maxLen: 40 });
    for (const k of clears) delete overrides[k];

    if (!sets.length && !clears.length) {
      return res.status(400).json({ error: "No valid fields to update." });
    }

    sets.push(`manual_overrides = $${n++}::jsonb`);
    vals.push(JSON.stringify(overrides));
    sets.push(`updated_at = NOW()`);
    vals.push(id);

    const { rows } = await pool.query(
      `UPDATE contacts SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    res.json({ contact: rows[0] });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[contacts] update", e);
    res.status(500).json({ error: "Could not update contact." });
  }
}

/* ============================================================
   Archive (soft-delete)
   ============================================================ */

export async function archiveContact(req, res) {
  try {
    const id = vIntId(req.params.id, "contact id");
    const pool = getPool();
    const { rowCount } = await pool.query(
      `UPDATE contacts SET archived_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND archived_at IS NULL AND merged_into_contact_id IS NULL`,
      [id]
    );
    if (!rowCount) {
      return res.status(404).json({ error: "Contact not found or already archived." });
    }
    res.json({ ok: true });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[contacts] archive", e);
    res.status(500).json({ error: "Could not archive contact." });
  }
}

/* ============================================================
   Merge — admin only (route-level gate)
   ============================================================ */

export async function mergeContacts(req, res) {
  const targetId = Number(req.params.id);
  const sourceId = Number(req.body?.source_contact_id);
  try {
    vIntId(targetId, "target contact id");
    vIntId(sourceId, "source_contact_id");
    if (targetId === sourceId) throw bad("Cannot merge a contact into itself.");

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `SELECT * FROM contacts WHERE id = ANY($1::int[]) FOR UPDATE`,
        [[targetId, sourceId]]
      );
      const target = rows.find((r) => r.id === targetId);
      const source = rows.find((r) => r.id === sourceId);
      if (!target || !source) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Contact not found." });
      }
      if (target.merged_into_contact_id || source.merged_into_contact_id) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "One of these contacts is already merged." });
      }

      // Move identities; a duplicate (source, external_id) on the target
      // can't happen (UNIQUE spans all contacts), so a plain UPDATE works.
      await client.query(
        `UPDATE contact_identities SET contact_id = $1 WHERE contact_id = $2`,
        [targetId, sourceId]
      );

      // Fill the target's empty fields from the loser; never overwrite.
      const fillable = ["first_name", "last_name", "company", "email", "phone", "notes"];
      const sets = [];
      const vals = [];
      let n = 1;
      for (const col of fillable) {
        if ((target[col] ?? null) === null && source[col] != null) {
          sets.push(`${col} = $${n++}`);
          vals.push(source[col]);
        }
      }
      // Union tags + alt arrays.
      sets.push(`tags = (SELECT ARRAY(SELECT DISTINCT unnest(tags || $${n++}::text[])))`);
      vals.push(source.tags || []);
      sets.push(`alt_emails = (SELECT ARRAY(SELECT DISTINCT unnest(alt_emails || $${n++}::text[])))`);
      vals.push(
        [source.email, ...(source.alt_emails || [])].filter(
          (e) => e && e.toLowerCase() !== (target.email || "").toLowerCase()
        )
      );
      sets.push(`alt_phones = (SELECT ARRAY(SELECT DISTINCT unnest(alt_phones || $${n++}::text[])))`);
      vals.push([source.phone, ...(source.alt_phones || [])].filter(Boolean));
      sets.push(`updated_at = NOW()`);
      vals.push(targetId);
      await client.query(
        `UPDATE contacts SET ${sets.join(", ")} WHERE id = $${n}`,
        vals
      );

      await client.query(
        `UPDATE contacts
            SET merged_into_contact_id = $1, merged_at = NOW(), merged_by = $2,
                updated_at = NOW()
          WHERE id = $3`,
        [targetId, req.user.id, sourceId]
      );

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    res.json({ ok: true, merged_into: targetId });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[contacts] merge", e);
    res.status(500).json({ error: "Could not merge contacts." });
  }
}

/* ============================================================
   Resync — admin only (route-level gate). Re-derives from cache
   without waiting for the next 4-hour AppFolio sync.
   ============================================================ */

export async function resyncContacts(_req, res) {
  try {
    const counters = await upsertContactsFromCache("manual");
    res.json({ ok: true, ...counters });
  } catch (e) {
    console.error("[contacts] resync", e);
    res.status(500).json({ error: "Could not resync contacts." });
  }
}
