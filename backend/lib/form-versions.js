import { getPool } from "./db.js";

function diffFieldSets(prevFields, nextFields) {
  const prevByKey = new Map((prevFields || []).map((f) => [f.field_key, f]));
  const nextByKey = new Map((nextFields || []).map((f) => [f.field_key, f]));
  const added = [];
  const removed = [];
  const modified = [];
  for (const [k, f] of nextByKey) {
    if (!prevByKey.has(k)) {
      if (!["heading", "paragraph", "divider", "spacer"].includes(f.field_type)) {
        added.push(f.label || k);
      }
    } else {
      const p = prevByKey.get(k);
      const changed =
        p.label !== f.label ||
        p.is_required !== f.is_required ||
        JSON.stringify(p.field_config || {}) !== JSON.stringify(f.field_config || {}) ||
        JSON.stringify(p.conditional_logic || null) !== JSON.stringify(f.conditional_logic || null);
      if (changed) modified.push(f.label || k);
    }
  }
  for (const [k, f] of prevByKey) {
    if (!nextByKey.has(k) && !["heading", "paragraph", "divider", "spacer"].includes(f.field_type)) {
      removed.push(f.label || k);
    }
  }
  return { added, removed, modified };
}

function buildChangeSummary(prev, next) {
  if (!prev) return "Initial publish.";
  const fieldDiff = diffFieldSets(prev.fields_snapshot, next.fields);
  const prevPageCount = Array.isArray(prev.pages_snapshot) ? prev.pages_snapshot.length : 0;
  const nextPageCount = (next.pages || []).length;
  const parts = [];
  if (fieldDiff.added.length) parts.push(`Added: ${fieldDiff.added.join(", ")}`);
  if (fieldDiff.removed.length) parts.push(`Removed: ${fieldDiff.removed.join(", ")}`);
  if (fieldDiff.modified.length) parts.push(`Modified: ${fieldDiff.modified.join(", ")}`);
  if (nextPageCount > prevPageCount) parts.push(`Added ${nextPageCount - prevPageCount} page(s)`);
  if (nextPageCount < prevPageCount) parts.push(`Removed ${prevPageCount - nextPageCount} page(s)`);
  return parts.length ? parts.join(". ") + "." : "No substantive changes.";
}

/**
 * Snapshot the current form state (form + pages + fields) into form_versions
 * and increment forms.current_version. Should be called on publish.
 */
export async function snapshotFormVersion(formId, userId, explicitSummary) {
  const pool = getPool();
  const { rows: formRows } = await pool.query(`SELECT * FROM forms WHERE id = $1`, [formId]);
  if (!formRows.length) throw new Error("Form not found.");
  const form = formRows[0];
  const { rows: fields } = await pool.query(
    `SELECT * FROM form_fields WHERE form_id = $1 ORDER BY sort_order ASC`, [formId]
  );
  const { rows: pages } = await pool.query(
    `SELECT * FROM form_pages WHERE form_id = $1 ORDER BY page_order ASC`, [formId]
  );

  const { rows: prevRows } = await pool.query(
    `SELECT * FROM form_versions WHERE form_id = $1 ORDER BY version_number DESC LIMIT 1`,
    [formId]
  );
  const prev = prevRows[0] || null;

  const summary = explicitSummary || buildChangeSummary(prev, { fields, pages });
  const nextNumber = prev ? prev.version_number + 1 : 1;

  const { rows: inserted } = await pool.query(
    `INSERT INTO form_versions (
       form_id, version_number, form_snapshot, fields_snapshot, pages_snapshot,
       logic_snapshot, change_summary, published_at, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8) RETURNING *`,
    [formId, nextNumber, form, fields, pages, null, summary, userId || null]
  );
  await pool.query(`UPDATE forms SET current_version = $1 WHERE id = $2`, [nextNumber, formId]);
  return inserted[0];
}

export async function listVersions(formId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT v.*, u.display_name AS created_by_name
     FROM form_versions v
     LEFT JOIN users u ON u.id = v.created_by
     WHERE v.form_id = $1 ORDER BY v.version_number DESC`,
    [formId]
  );
  return rows;
}

export async function getVersion(formId, versionId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM form_versions WHERE id = $1 AND form_id = $2`,
    [versionId, formId]
  );
  return rows[0] || null;
}

/**
 * Restore a previous version by overwriting the current form's pages+fields+relevant
 * settings with the snapshot from the target version, then snapshotting again
 * so the restore itself becomes a new version.
 */
export async function restoreVersion(formId, versionId, userId) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: vRows } = await client.query(
      `SELECT * FROM form_versions WHERE id = $1 AND form_id = $2`,
      [versionId, formId]
    );
    if (!vRows.length) throw new Error("Version not found.");
    const v = vRows[0];

    const pagesSnap = Array.isArray(v.pages_snapshot) ? v.pages_snapshot : [];
    const fieldsSnap = Array.isArray(v.fields_snapshot) ? v.fields_snapshot : [];

    // Delete existing pages + fields (fields are cascade-deleted by page, but
    // fields might be on page_id=null, so delete fields directly first)
    await client.query(`DELETE FROM form_fields WHERE form_id = $1`, [formId]);
    await client.query(`DELETE FROM form_pages WHERE form_id = $1`, [formId]);

    // Recreate pages with new ids, keep a mapping from old id → new id
    const pageIdMap = new Map();
    for (const p of pagesSnap) {
      const { rows: np } = await client.query(
        `INSERT INTO form_pages (form_id, title, description, page_order, is_visible, visibility_conditions)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [formId, p.title || null, p.description || null, p.page_order || 0, p.is_visible !== false, p.visibility_conditions || null]
      );
      pageIdMap.set(p.id, np[0].id);
    }
    for (const f of fieldsSnap) {
      await client.query(
        `INSERT INTO form_fields (
           form_id, page_id, field_key, field_type, label, description, placeholder, help_text,
           is_required, is_hidden, default_value, validation, field_config, conditional_logic,
           pre_fill_config, layout, sort_order
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
          formId, f.page_id ? pageIdMap.get(f.page_id) || null : null,
          f.field_key, f.field_type, f.label,
          f.description || null, f.placeholder || null, f.help_text || null,
          !!f.is_required, !!f.is_hidden, f.default_value || null,
          f.validation || {}, f.field_config || {}, f.conditional_logic || null,
          f.pre_fill_config || null, f.layout || { width: "full" }, f.sort_order || 0,
        ]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  // Snapshot again so the restore itself is a new version
  return await snapshotFormVersion(formId, userId, `Restored from v${versionId}`);
}
