/**
 * Process People panel API: list/attach/detach contacts on a process.
 *
 * GET returns three things the panel needs in one round trip:
 *   contacts    — currently attached (joined with contact details)
 *   roles       — the template's contact_roles (which slots to offer)
 *   suggestions — property-matched tenant/owner candidates not yet
 *                 attached ("Tenant of 1234 Main St: Jane — Attach")
 */

import { getPool } from "../lib/db.js";
import {
  attachContact,
  findOwnerContacts,
  findTenantContacts,
  templateRoles,
} from "../lib/process-contacts.js";

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

async function loadProcessWithRoles(pool, processId) {
  const { rows } = await pool.query(
    `SELECT p.id, p.property_id, p.property_name, t.contact_roles
       FROM processes p
       LEFT JOIN process_templates t ON t.id = p.template_id
      WHERE p.id = $1`,
    [processId]
  );
  return rows[0] ?? null;
}

export async function listProcessContacts(req, res) {
  try {
    const processId = vIntId(req.params.id, "process id");
    const pool = getPool();
    const proc = await loadProcessWithRoles(pool, processId);
    if (!proc) return res.status(404).json({ error: "Process not found." });

    const { rows: attached } = await pool.query(
      `SELECT pc.id, pc.role, pc.is_primary, pc.added_via, pc.created_at,
              c.id AS contact_id, c.display_name, c.email, c.phone, c.company
         FROM process_contacts pc
         JOIN contacts c ON c.id = pc.contact_id
        WHERE pc.process_id = $1
          AND c.merged_into_contact_id IS NULL
        ORDER BY pc.role ASC, pc.is_primary DESC, pc.id ASC`,
      [processId]
    );

    // Property-matched candidates not yet attached.
    const attachedByRole = new Set(attached.map((a) => `${a.role}:${a.contact_id}`));
    const roles = templateRoles(proc);
    const where = { propertyId: proc.property_id, propertyName: proc.property_name };
    const suggestions = [];
    if (roles.includes("tenant")) {
      for (const c of await findTenantContacts(pool, where)) {
        if (!attachedByRole.has(`tenant:${c.id}`)) {
          suggestions.push({
            role: "tenant",
            contact_id: c.id,
            display_name: c.display_name,
            email: c.email,
            phone: c.phone,
            hint: c.metadata?.unit ? `Unit ${c.metadata.unit}` : null,
          });
        }
      }
    }
    if (roles.includes("owner")) {
      for (const c of await findOwnerContacts(pool, where)) {
        if (!attachedByRole.has(`owner:${c.id}`)) {
          suggestions.push({
            role: "owner",
            contact_id: c.id,
            display_name: c.display_name,
            email: c.email,
            phone: c.phone,
            hint: null,
          });
        }
      }
    }

    res.json({ contacts: attached, roles, suggestions });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[process-contacts] list", e);
    res.status(500).json({ error: "Could not load process contacts." });
  }
}

export async function addProcessContact(req, res) {
  try {
    const processId = vIntId(req.params.id, "process id");
    const contactId = vIntId(req.body?.contact_id, "contact_id");
    const role = String(req.body?.role ?? "").trim().toLowerCase();
    if (!role || role.length > 40 || !/^[a-z0-9_-]+$/.test(role)) {
      throw bad("role must be a short lowercase identifier.");
    }

    const pool = getPool();
    const proc = await loadProcessWithRoles(pool, processId);
    if (!proc) return res.status(404).json({ error: "Process not found." });
    const { rows: contactRows } = await pool.query(
      `SELECT id FROM contacts
        WHERE id = $1 AND merged_into_contact_id IS NULL AND archived_at IS NULL`,
      [contactId]
    );
    if (!contactRows.length) return res.status(404).json({ error: "Contact not found." });

    const row = await attachContact(pool, {
      processId,
      contactId,
      role,
      addedBy: req.user.id,
      addedVia: "manual",
    });
    res.status(201).json({ attached: row });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[process-contacts] add", e);
    res.status(500).json({ error: "Could not attach contact." });
  }
}

export async function removeProcessContact(req, res) {
  try {
    const processId = vIntId(req.params.id, "process id");
    const rowId = vIntId(req.params.rowId, "attachment id");
    const pool = getPool();
    const { rows } = await pool.query(
      `DELETE FROM process_contacts
        WHERE id = $1 AND process_id = $2
        RETURNING role, is_primary`,
      [rowId, processId]
    );
    if (!rows.length) return res.status(404).json({ error: "Attachment not found." });

    // If the primary for a role was removed, promote the oldest remaining.
    if (rows[0].is_primary) {
      await pool.query(
        `UPDATE process_contacts SET is_primary = TRUE
          WHERE id = (
            SELECT id FROM process_contacts
             WHERE process_id = $1 AND role = $2
             ORDER BY id ASC LIMIT 1
          )`,
        [processId, rows[0].role]
      );
    }
    res.json({ ok: true });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[process-contacts] remove", e);
    res.status(500).json({ error: "Could not detach contact." });
  }
}
