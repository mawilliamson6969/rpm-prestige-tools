import { randomBytes, randomUUID } from "crypto";
import { promises as fs } from "fs";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { getPool } from "../lib/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FORMS_UPLOAD_ROOT = path.join(__dirname, "..", "uploads", "forms");
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

fs.mkdir(FORMS_UPLOAD_ROOT, { recursive: true }).catch(() => {});

const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    try {
      await fs.mkdir(FORMS_UPLOAD_ROOT, { recursive: true });
      cb(null, FORMS_UPLOAD_ROOT);
    } catch (e) {
      cb(e);
    }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "") || "";
    cb(null, `${randomUUID()}${ext}`);
  },
});

export const formsUploadMiddleware = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
}).single("file");

const FORM_STATUSES = new Set(["draft", "published", "archived"]);
const SUBMISSION_STATUSES = new Set(["submitted", "reviewed", "archived"]);
const ACCESS_TYPES = new Set(["public", "private", "internal"]);

const FIELD_TYPES = new Set([
  "text", "textarea", "number", "currency", "email", "phone", "address", "fullname",
  "dropdown", "multiselect", "radio", "checkbox", "yesno",
  "date", "time", "datetime",
  "file", "signature", "image",
  "rating", "scale", "table",
  "heading", "paragraph", "divider", "spacer",
  "hidden",
]);

const NON_INPUT_TYPES = new Set(["heading", "paragraph", "divider", "spacer"]);

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "form";
}

function keyify(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "field";
}

async function uniqueSlug(pool, base) {
  let slug = slugify(base);
  let i = 0;
  while (true) {
    const candidate = i === 0 ? slug : `${slug}-${i}`;
    const { rows } = await pool.query(`SELECT 1 FROM forms WHERE slug = $1`, [candidate]);
    if (!rows.length) return candidate;
    i += 1;
  }
}

async function uniqueFieldKey(pool, formId, base) {
  let key = keyify(base);
  let i = 0;
  while (true) {
    const candidate = i === 0 ? key : `${key}_${i}`;
    const { rows } = await pool.query(
      `SELECT 1 FROM form_fields WHERE form_id = $1 AND field_key = $2`,
      [formId, candidate]
    );
    if (!rows.length) return candidate;
    i += 1;
  }
}

function mapForm(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    category: r.category,
    status: r.status,
    isMultiStep: r.is_multi_step,
    settings: r.settings || {},
    branding: r.branding || {},
    accessType: r.access_type,
    accessToken: r.access_token,
    slug: r.slug,
    submitButtonText: r.submit_button_text,
    successMessage: r.success_message,
    successRedirectUrl: r.success_redirect_url,
    isActive: r.is_active,
    submissionsCount: r.submissions_count,
    viewsCount: r.views_count,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapPage(r) {
  return {
    id: r.id,
    formId: r.form_id,
    title: r.title,
    description: r.description,
    pageOrder: r.page_order,
    isVisible: r.is_visible,
    visibilityConditions: r.visibility_conditions,
    createdAt: r.created_at,
  };
}

function mapField(r) {
  return {
    id: r.id,
    formId: r.form_id,
    pageId: r.page_id,
    fieldKey: r.field_key,
    fieldType: r.field_type,
    label: r.label,
    description: r.description,
    placeholder: r.placeholder,
    helpText: r.help_text,
    isRequired: r.is_required,
    isHidden: r.is_hidden,
    defaultValue: r.default_value,
    validation: r.validation || {},
    fieldConfig: r.field_config || {},
    conditionalLogic: r.conditional_logic,
    preFillConfig: r.pre_fill_config,
    layout: r.layout || { width: "full" },
    sortOrder: r.sort_order,
  };
}

function mapSubmission(r) {
  return {
    id: r.id,
    formId: r.form_id,
    submissionData: r.submission_data,
    status: r.status,
    submittedAt: r.submitted_at,
    reviewedAt: r.reviewed_at,
    reviewedBy: r.reviewed_by,
    notes: r.notes,
    processId: r.process_id,
    propertyId: r.property_id,
    propertyName: r.property_name,
    contactName: r.contact_name,
    contactEmail: r.contact_email,
    tags: r.tags || [],
    ipAddress: r.ip_address,
    userAgent: r.user_agent,
    referrer: r.referrer,
  };
}

function mapAutomation(r) {
  return {
    id: r.id,
    formId: r.form_id,
    name: r.name,
    triggerType: r.trigger_type,
    actionType: r.action_type,
    actionConfig: r.action_config,
    isActive: r.is_active,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
  };
}

/** Form CRUD */
export async function getForms(req, res) {
  try {
    const pool = getPool();
    const filters = [];
    const vals = [];
    let n = 1;
    const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
    const category = typeof req.query.category === "string" ? req.query.category.trim() : "";
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const includeArchived = req.query.includeArchived === "1" || req.query.includeArchived === "true";
    if (!includeArchived) filters.push(`is_active = true`);
    if (status && FORM_STATUSES.has(status)) {
      filters.push(`status = $${n++}`);
      vals.push(status);
    }
    if (category) {
      filters.push(`category = $${n++}`);
      vals.push(category);
    }
    if (search) {
      filters.push(`(LOWER(name) LIKE $${n} OR LOWER(description) LIKE $${n})`);
      vals.push(`%${search.toLowerCase()}%`);
      n++;
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `SELECT * FROM forms ${where} ORDER BY updated_at DESC`,
      vals
    );
    res.json({ forms: rows.map(mapForm) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load forms." });
  }
}

export async function getForm(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "Invalid form id." });
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(`SELECT * FROM forms WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Form not found." });
    const { rows: pages } = await pool.query(
      `SELECT * FROM form_pages WHERE form_id = $1 ORDER BY page_order ASC`,
      [id]
    );
    const { rows: fields } = await pool.query(
      `SELECT * FROM form_fields WHERE form_id = $1 ORDER BY sort_order ASC`,
      [id]
    );
    const { rows: automations } = await pool.query(
      `SELECT * FROM form_automations WHERE form_id = $1 ORDER BY sort_order ASC`,
      [id]
    );
    res.json({
      form: mapForm(rows[0]),
      pages: pages.map(mapPage),
      fields: fields.map(mapField),
      automations: automations.map(mapAutomation),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load form." });
  }
}

export async function postForm(req, res) {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) return res.status(400).json({ error: "name is required." });
  const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";
  const category = typeof req.body?.category === "string" ? req.body.category.trim() : null;
  try {
    const pool = getPool();
    const slug = await uniqueSlug(pool, name);
    const accessToken = randomBytes(24).toString("hex");
    const { rows } = await pool.query(
      `INSERT INTO forms (name, description, category, slug, access_token, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, description || null, category, slug, accessToken, req.user?.id ?? null]
    );
    const formId = rows[0].id;
    await pool.query(
      `INSERT INTO form_pages (form_id, title, page_order) VALUES ($1, $2, 0)`,
      [formId, "Page 1"]
    );
    res.status(201).json({ form: mapForm(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not create form." });
  }
}

export async function putForm(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid form id." });
  const sets = [];
  const vals = [];
  let n = 1;
  const b = req.body || {};
  const fields = [
    ["name", "name", (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined)],
    ["description", "description", (v) => (typeof v === "string" ? v.trim() || null : undefined)],
    ["category", "category", (v) => (typeof v === "string" ? v.trim() || null : undefined)],
    ["isMultiStep", "is_multi_step", (v) => (typeof v === "boolean" ? v : undefined)],
    ["settings", "settings", (v) => (typeof v === "object" && v !== null ? v : undefined)],
    ["branding", "branding", (v) => (typeof v === "object" && v !== null ? v : undefined)],
    ["accessType", "access_type", (v) => (ACCESS_TYPES.has(v) ? v : undefined)],
    ["submitButtonText", "submit_button_text", (v) => (typeof v === "string" ? v.trim() : undefined)],
    ["successMessage", "success_message", (v) => (typeof v === "string" ? v : undefined)],
    ["successRedirectUrl", "success_redirect_url", (v) => (typeof v === "string" ? v.trim() || null : undefined)],
    ["slug", "slug", (v) => (typeof v === "string" && v.trim() ? slugify(v) : undefined)],
  ];
  for (const [key, col, parse] of fields) {
    if (b[key] !== undefined) {
      const v = parse(b[key]);
      if (v !== undefined) {
        sets.push(`${col} = $${n++}`);
        vals.push(v);
      }
    }
  }
  if (!sets.length) return res.status(400).json({ error: "No valid fields to update." });
  sets.push(`updated_at = NOW()`);
  vals.push(id);
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE forms SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: "Form not found." });
    res.json({ form: mapForm(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update form." });
  }
}

export async function putFormPublish(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid form id." });
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE forms SET status = 'published', is_active = true, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Form not found." });
    res.json({ form: mapForm(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not publish form." });
  }
}

export async function putFormUnpublish(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid form id." });
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE forms SET status = 'draft', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Form not found." });
    res.json({ form: mapForm(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not unpublish form." });
  }
}

export async function deleteForm(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid form id." });
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE forms SET is_active = false, status = 'archived', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Form not found." });
    res.json({ form: mapForm(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not archive form." });
  }
}

export async function postFormDuplicate(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid form id." });
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: src } = await client.query(`SELECT * FROM forms WHERE id = $1`, [id]);
    if (!src.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Form not found." });
    }
    const s = src[0];
    const newSlug = await uniqueSlug(pool, `${s.name} copy`);
    const newToken = randomBytes(24).toString("hex");
    const { rows: newForm } = await client.query(
      `INSERT INTO forms (name, description, category, is_multi_step, settings, branding,
                          access_type, access_token, slug, submit_button_text, success_message,
                          success_redirect_url, status, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'draft', true, $13) RETURNING *`,
      [
        `${s.name} (copy)`, s.description, s.category, s.is_multi_step, s.settings, s.branding,
        s.access_type, newToken, newSlug, s.submit_button_text, s.success_message,
        s.success_redirect_url, req.user?.id ?? null,
      ]
    );
    const newId = newForm[0].id;
    const { rows: pageMap } = await client.query(
      `SELECT id, title, description, page_order, is_visible, visibility_conditions
       FROM form_pages WHERE form_id = $1 ORDER BY page_order ASC`,
      [id]
    );
    const pageIdMap = new Map();
    for (const p of pageMap) {
      const { rows: np } = await client.query(
        `INSERT INTO form_pages (form_id, title, description, page_order, is_visible, visibility_conditions)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [newId, p.title, p.description, p.page_order, p.is_visible, p.visibility_conditions]
      );
      pageIdMap.set(p.id, np[0].id);
    }
    const { rows: srcFields } = await client.query(
      `SELECT * FROM form_fields WHERE form_id = $1 ORDER BY sort_order ASC`,
      [id]
    );
    for (const f of srcFields) {
      await client.query(
        `INSERT INTO form_fields (form_id, page_id, field_key, field_type, label, description,
                                  placeholder, help_text, is_required, is_hidden, default_value,
                                  validation, field_config, conditional_logic, pre_fill_config, layout, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
          newId, f.page_id ? pageIdMap.get(f.page_id) : null, f.field_key, f.field_type, f.label,
          f.description, f.placeholder, f.help_text, f.is_required, f.is_hidden, f.default_value,
          f.validation, f.field_config, f.conditional_logic, f.pre_fill_config, f.layout, f.sort_order,
        ]
      );
    }
    await client.query(
      `INSERT INTO form_automations (form_id, name, trigger_type, action_type, action_config, is_active, sort_order)
       SELECT $1, name, trigger_type, action_type, action_config, is_active, sort_order
       FROM form_automations WHERE form_id = $2`,
      [newId, id]
    );
    await client.query("COMMIT");
    res.status(201).json({ form: mapForm(newForm[0]) });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    res.status(500).json({ error: "Could not duplicate form." });
  } finally {
    client.release();
  }
}

/** Form pages */
export async function getFormPages(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid form id." });
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM form_pages WHERE form_id = $1 ORDER BY page_order ASC`,
      [id]
    );
    res.json({ pages: rows.map(mapPage) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load pages." });
  }
}

export async function postFormPage(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid form id." });
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "New Page";
  const description = typeof req.body?.description === "string" ? req.body.description.trim() : null;
  try {
    const pool = getPool();
    const { rows: nextRow } = await pool.query(
      `SELECT COALESCE(MAX(page_order), -1) + 1 AS next FROM form_pages WHERE form_id = $1`,
      [id]
    );
    const order = Number.isFinite(Number.parseInt(req.body?.pageOrder, 10))
      ? Number.parseInt(req.body.pageOrder, 10)
      : nextRow[0].next;
    const { rows } = await pool.query(
      `INSERT INTO form_pages (form_id, title, description, page_order) VALUES ($1, $2, $3, $4) RETURNING *`,
      [id, title, description, order]
    );
    await pool.query(
      `UPDATE forms SET is_multi_step = true, updated_at = NOW() WHERE id = $1 AND (SELECT COUNT(*) FROM form_pages WHERE form_id = $1) > 1`,
      [id]
    );
    res.status(201).json({ page: mapPage(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not create page." });
  }
}

export async function putFormPage(req, res) {
  const pageId = Number.parseInt(req.params.pageId, 10);
  if (!Number.isFinite(pageId)) return res.status(400).json({ error: "Invalid page id." });
  const sets = [];
  const vals = [];
  let n = 1;
  const b = req.body || {};
  if (typeof b.title === "string") { sets.push(`title = $${n++}`); vals.push(b.title.trim()); }
  if (typeof b.description === "string") { sets.push(`description = $${n++}`); vals.push(b.description.trim() || null); }
  if (typeof b.isVisible === "boolean") { sets.push(`is_visible = $${n++}`); vals.push(b.isVisible); }
  if (b.visibilityConditions !== undefined) {
    sets.push(`visibility_conditions = $${n++}`);
    vals.push(b.visibilityConditions);
  }
  if (Number.isFinite(Number.parseInt(b.pageOrder, 10))) {
    sets.push(`page_order = $${n++}`);
    vals.push(Number.parseInt(b.pageOrder, 10));
  }
  if (!sets.length) return res.status(400).json({ error: "No valid fields to update." });
  vals.push(pageId);
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE form_pages SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: "Page not found." });
    res.json({ page: mapPage(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update page." });
  }
}

export async function deleteFormPage(req, res) {
  const pageId = Number.parseInt(req.params.pageId, 10);
  if (!Number.isFinite(pageId)) return res.status(400).json({ error: "Invalid page id." });
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: pageRows } = await client.query(`SELECT form_id, page_order FROM form_pages WHERE id = $1`, [pageId]);
    if (!pageRows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Page not found." });
    }
    const { form_id: formId, page_order: pageOrder } = pageRows[0];
    const { rows: prev } = await client.query(
      `SELECT id FROM form_pages WHERE form_id = $1 AND page_order < $2 ORDER BY page_order DESC LIMIT 1`,
      [formId, pageOrder]
    );
    const fallbackPageId = prev[0]?.id ?? null;
    if (fallbackPageId) {
      await client.query(`UPDATE form_fields SET page_id = $1 WHERE page_id = $2`, [fallbackPageId, pageId]);
    } else {
      await client.query(`UPDATE form_fields SET page_id = NULL WHERE page_id = $1`, [pageId]);
    }
    await client.query(`DELETE FROM form_pages WHERE id = $1`, [pageId]);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    res.status(500).json({ error: "Could not delete page." });
  } finally {
    client.release();
  }
}

export async function putFormPagesReorder(req, res) {
  const formId = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(formId)) return res.status(400).json({ error: "Invalid form id." });
  const ids = Array.isArray(req.body?.pageIds) ? req.body.pageIds : null;
  if (!ids) return res.status(400).json({ error: "pageIds array required." });
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < ids.length; i++) {
      const pid = Number.parseInt(ids[i], 10);
      if (!Number.isFinite(pid)) continue;
      await client.query(
        `UPDATE form_pages SET page_order = $1 WHERE id = $2 AND form_id = $3`,
        [i, pid, formId]
      );
    }
    await client.query("COMMIT");
    const { rows } = await pool.query(
      `SELECT * FROM form_pages WHERE form_id = $1 ORDER BY page_order ASC`,
      [formId]
    );
    res.json({ pages: rows.map(mapPage) });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    res.status(500).json({ error: "Could not reorder pages." });
  } finally {
    client.release();
  }
}

/** Form fields */
export async function getFormFields(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid form id." });
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM form_fields WHERE form_id = $1 ORDER BY sort_order ASC`,
      [id]
    );
    res.json({ fields: rows.map(mapField) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load fields." });
  }
}

export async function postFormField(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid form id." });
  const b = req.body || {};
  const fieldType = typeof b.fieldType === "string" ? b.fieldType.trim() : "";
  if (!FIELD_TYPES.has(fieldType)) return res.status(400).json({ error: "Invalid fieldType." });
  const label = typeof b.label === "string" ? b.label.trim() : "";
  if (!NON_INPUT_TYPES.has(fieldType) && !label) {
    return res.status(400).json({ error: "label is required." });
  }
  const finalLabel = label || fieldType;
  try {
    const pool = getPool();
    const fieldKeyBase = typeof b.fieldKey === "string" && b.fieldKey.trim()
      ? b.fieldKey.trim()
      : finalLabel;
    const fieldKey = await uniqueFieldKey(pool, id, fieldKeyBase);
    const pageId = Number.isFinite(Number.parseInt(b.pageId, 10)) ? Number.parseInt(b.pageId, 10) : null;
    const { rows: nextRow } = await pool.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM form_fields WHERE form_id = $1`,
      [id]
    );
    const sortOrder = Number.isFinite(Number.parseInt(b.sortOrder, 10))
      ? Number.parseInt(b.sortOrder, 10)
      : nextRow[0].next;
    const { rows } = await pool.query(
      `INSERT INTO form_fields (form_id, page_id, field_key, field_type, label, description,
                                placeholder, help_text, is_required, is_hidden, default_value,
                                validation, field_config, conditional_logic, pre_fill_config, layout, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING *`,
      [
        id, pageId, fieldKey, fieldType, finalLabel,
        typeof b.description === "string" ? b.description : null,
        typeof b.placeholder === "string" ? b.placeholder : null,
        typeof b.helpText === "string" ? b.helpText : null,
        b.isRequired === true,
        b.isHidden === true,
        typeof b.defaultValue === "string" ? b.defaultValue : null,
        b.validation && typeof b.validation === "object" ? b.validation : {},
        b.fieldConfig && typeof b.fieldConfig === "object" ? b.fieldConfig : {},
        b.conditionalLogic || null,
        b.preFillConfig || null,
        b.layout && typeof b.layout === "object" ? b.layout : { width: "full" },
        sortOrder,
      ]
    );
    res.status(201).json({ field: mapField(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not create field." });
  }
}

export async function putFormField(req, res) {
  const fieldId = Number.parseInt(req.params.fieldId, 10);
  if (!Number.isFinite(fieldId)) return res.status(400).json({ error: "Invalid field id." });
  const b = req.body || {};
  const sets = [];
  const vals = [];
  let n = 1;
  const fields = [
    ["label", "label", (v) => (typeof v === "string" ? v.trim() : undefined)],
    ["description", "description", (v) => (typeof v === "string" ? v.trim() || null : undefined)],
    ["placeholder", "placeholder", (v) => (typeof v === "string" ? v : undefined)],
    ["helpText", "help_text", (v) => (typeof v === "string" ? v : undefined)],
    ["isRequired", "is_required", (v) => (typeof v === "boolean" ? v : undefined)],
    ["isHidden", "is_hidden", (v) => (typeof v === "boolean" ? v : undefined)],
    ["defaultValue", "default_value", (v) => (v === null ? null : typeof v === "string" ? v : undefined)],
    ["validation", "validation", (v) => (v && typeof v === "object" ? v : undefined)],
    ["fieldConfig", "field_config", (v) => (v && typeof v === "object" ? v : undefined)],
    ["conditionalLogic", "conditional_logic", (v) => (v === null ? null : v && typeof v === "object" ? v : undefined)],
    ["preFillConfig", "pre_fill_config", (v) => (v === null ? null : v && typeof v === "object" ? v : undefined)],
    ["layout", "layout", (v) => (v && typeof v === "object" ? v : undefined)],
    ["sortOrder", "sort_order", (v) => (Number.isFinite(Number.parseInt(v, 10)) ? Number.parseInt(v, 10) : undefined)],
    ["pageId", "page_id", (v) => (v === null ? null : Number.isFinite(Number.parseInt(v, 10)) ? Number.parseInt(v, 10) : undefined)],
  ];
  for (const [key, col, parse] of fields) {
    if (b[key] !== undefined) {
      const v = parse(b[key]);
      if (v !== undefined) {
        sets.push(`${col} = $${n++}`);
        vals.push(v);
      }
    }
  }
  if (!sets.length) return res.status(400).json({ error: "No valid fields to update." });
  vals.push(fieldId);
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE form_fields SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: "Field not found." });
    res.json({ field: mapField(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update field." });
  }
}

export async function deleteFormField(req, res) {
  const fieldId = Number.parseInt(req.params.fieldId, 10);
  if (!Number.isFinite(fieldId)) return res.status(400).json({ error: "Invalid field id." });
  try {
    const pool = getPool();
    const { rows } = await pool.query(`DELETE FROM form_fields WHERE id = $1 RETURNING id`, [fieldId]);
    if (!rows.length) return res.status(404).json({ error: "Field not found." });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete field." });
  }
}

export async function putFormFieldsReorder(req, res) {
  const formId = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(formId)) return res.status(400).json({ error: "Invalid form id." });
  const ids = Array.isArray(req.body?.fieldIds) ? req.body.fieldIds : null;
  if (!ids) return res.status(400).json({ error: "fieldIds array required." });
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < ids.length; i++) {
      const fid = Number.parseInt(ids[i], 10);
      if (!Number.isFinite(fid)) continue;
      await client.query(
        `UPDATE form_fields SET sort_order = $1 WHERE id = $2 AND form_id = $3`,
        [i, fid, formId]
      );
    }
    await client.query("COMMIT");
    const { rows } = await pool.query(
      `SELECT * FROM form_fields WHERE form_id = $1 ORDER BY sort_order ASC`,
      [formId]
    );
    res.json({ fields: rows.map(mapField) });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    res.status(500).json({ error: "Could not reorder fields." });
  } finally {
    client.release();
  }
}

export async function putFormFieldMove(req, res) {
  const fieldId = Number.parseInt(req.params.fieldId, 10);
  if (!Number.isFinite(fieldId)) return res.status(400).json({ error: "Invalid field id." });
  const pageId = req.body?.pageId === null ? null
    : Number.isFinite(Number.parseInt(req.body?.pageId, 10)) ? Number.parseInt(req.body.pageId, 10) : undefined;
  if (pageId === undefined) return res.status(400).json({ error: "pageId required." });
  const sortOrder = Number.isFinite(Number.parseInt(req.body?.sortOrder, 10))
    ? Number.parseInt(req.body.sortOrder, 10) : null;
  try {
    const pool = getPool();
    const sets = [`page_id = $1`];
    const vals = [pageId];
    let n = 2;
    if (sortOrder !== null) { sets.push(`sort_order = $${n++}`); vals.push(sortOrder); }
    vals.push(fieldId);
    const { rows } = await pool.query(
      `UPDATE form_fields SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: "Field not found." });
    res.json({ field: mapField(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not move field." });
  }
}

/** Form automations */
export async function getFormAutomations(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid form id." });
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM form_automations WHERE form_id = $1 ORDER BY sort_order ASC`,
      [id]
    );
    res.json({ automations: rows.map(mapAutomation) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load automations." });
  }
}

export async function postFormAutomation(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid form id." });
  const b = req.body || {};
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const actionType = typeof b.actionType === "string" ? b.actionType.trim() : "";
  if (!actionType) return res.status(400).json({ error: "actionType is required." });
  try {
    const pool = getPool();
    const { rows: nextRow } = await pool.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM form_automations WHERE form_id = $1`,
      [id]
    );
    const { rows } = await pool.query(
      `INSERT INTO form_automations (form_id, name, trigger_type, action_type, action_config, is_active, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        id, name || actionType,
        typeof b.triggerType === "string" ? b.triggerType : "on_submit",
        actionType,
        b.actionConfig && typeof b.actionConfig === "object" ? b.actionConfig : {},
        b.isActive !== false,
        nextRow[0].next,
      ]
    );
    res.status(201).json({ automation: mapAutomation(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not create automation." });
  }
}

export async function putFormAutomation(req, res) {
  const automationId = Number.parseInt(req.params.automationId, 10);
  if (!Number.isFinite(automationId)) return res.status(400).json({ error: "Invalid automation id." });
  const b = req.body || {};
  const sets = [];
  const vals = [];
  let n = 1;
  if (typeof b.name === "string") { sets.push(`name = $${n++}`); vals.push(b.name.trim()); }
  if (typeof b.triggerType === "string") { sets.push(`trigger_type = $${n++}`); vals.push(b.triggerType); }
  if (typeof b.actionType === "string") { sets.push(`action_type = $${n++}`); vals.push(b.actionType); }
  if (b.actionConfig && typeof b.actionConfig === "object") { sets.push(`action_config = $${n++}`); vals.push(b.actionConfig); }
  if (typeof b.isActive === "boolean") { sets.push(`is_active = $${n++}`); vals.push(b.isActive); }
  if (!sets.length) return res.status(400).json({ error: "No valid fields to update." });
  vals.push(automationId);
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE form_automations SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: "Automation not found." });
    res.json({ automation: mapAutomation(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update automation." });
  }
}

export async function deleteFormAutomation(req, res) {
  const automationId = Number.parseInt(req.params.automationId, 10);
  if (!Number.isFinite(automationId)) return res.status(400).json({ error: "Invalid automation id." });
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `DELETE FROM form_automations WHERE id = $1 RETURNING id`,
      [automationId]
    );
    if (!rows.length) return res.status(404).json({ error: "Automation not found." });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete automation." });
  }
}

/** Public: form structure */
export async function getPublicForm(req, res) {
  const slug = typeof req.params.slug === "string" ? req.params.slug.trim() : "";
  if (!slug) return res.status(400).json({ error: "Invalid slug." });
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM forms WHERE slug = $1 AND is_active = true AND status = 'published'`,
      [slug]
    );
    if (!rows.length) return res.status(404).json({ error: "Form not found or not published." });
    const form = rows[0];
    if (form.access_type === "private") {
      const token = typeof req.query.token === "string" ? req.query.token.trim() : "";
      if (!token || token !== form.access_token) {
        return res.status(403).json({ error: "Access token required." });
      }
    }
    const { rows: pages } = await pool.query(
      `SELECT * FROM form_pages WHERE form_id = $1 ORDER BY page_order ASC`,
      [form.id]
    );
    const { rows: fields } = await pool.query(
      `SELECT * FROM form_fields WHERE form_id = $1 ORDER BY sort_order ASC`,
      [form.id]
    );
    await pool.query(`UPDATE forms SET views_count = views_count + 1 WHERE id = $1`, [form.id]);
    await pool.query(
      `INSERT INTO form_analytics (form_id, event_type, event_data) VALUES ($1, 'form_view', $2)`,
      [form.id, { referrer: req.get?.("referer") || null }]
    ).catch(() => {});
    res.json({
      form: mapForm(form),
      pages: pages.map(mapPage),
      fields: fields.map(mapField),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load form." });
  }
}

/** Public: pre-fill */
export async function getPublicFormPrefill(req, res) {
  const slug = typeof req.params.slug === "string" ? req.params.slug.trim() : "";
  try {
    const pool = getPool();
    const { rows } = await pool.query(`SELECT id FROM forms WHERE slug = $1`, [slug]);
    if (!rows.length) return res.status(404).json({ error: "Form not found." });
    const formId = rows[0].id;
    const { rows: fields } = await pool.query(
      `SELECT field_key, pre_fill_config FROM form_fields WHERE form_id = $1 AND pre_fill_config IS NOT NULL`,
      [formId]
    );
    const prefill = {};
    for (const f of fields) {
      const cfg = f.pre_fill_config;
      if (!cfg || !cfg.source) continue;
      const c = cfg.config || {};
      if (cfg.source === "url_param" && c.paramName) {
        const v = req.query[c.paramName];
        if (typeof v === "string") prefill[f.field_key] = v;
      } else if (cfg.source === "static" && c.value !== undefined) {
        prefill[f.field_key] = c.value;
      } else if (cfg.source === "appfolio_property" && req.query.pid) {
        try {
          const { rows: p } = await pool.query(
            `SELECT appfolio_data FROM cached_units WHERE id = 1 LIMIT 1`
          );
          if (p.length && Array.isArray(p[0].appfolio_data)) {
            const unit = p[0].appfolio_data.find((u) => String(u.PropertyId) === String(req.query.pid));
            if (unit && c.field) {
              const map = {
                property_name: unit.PropertyName,
                property_address: unit.PropertyAddress1,
                property_type: unit.PropertyType,
              };
              if (map[c.field] !== undefined) prefill[f.field_key] = map[c.field];
            }
          }
        } catch {/* ignore */}
      }
    }
    res.json({ prefill });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load pre-fill data." });
  }
}

/** Public: upload file */
export async function postPublicFormUpload(req, res) {
  if (!req.file) return res.status(400).json({ error: "No file uploaded." });
  try {
    res.json({
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimeType: req.file.mimetype,
      url: `/uploads/forms/${req.file.filename}`,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not upload file." });
  }
}

/** Evaluate conditional logic server-side to determine which fields are visible/required */
function evaluateCondition(condition, values) {
  const { fieldKey, operator, value } = condition || {};
  const actual = values[fieldKey];
  const strActual = actual == null ? "" : String(actual);
  const strValue = value == null ? "" : String(value);
  switch (operator) {
    case "equals": return strActual === strValue;
    case "not_equals": return strActual !== strValue;
    case "contains": return strActual.toLowerCase().includes(strValue.toLowerCase());
    case "not_contains": return !strActual.toLowerCase().includes(strValue.toLowerCase());
    case "starts_with": return strActual.toLowerCase().startsWith(strValue.toLowerCase());
    case "ends_with": return strActual.toLowerCase().endsWith(strValue.toLowerCase());
    case "greater_than": return Number(actual) > Number(value);
    case "less_than": return Number(actual) < Number(value);
    case "is_empty": return actual == null || actual === "" || (Array.isArray(actual) && !actual.length);
    case "is_not_empty": return !(actual == null || actual === "" || (Array.isArray(actual) && !actual.length));
    default: return false;
  }
}

function evaluateLogic(logic, values) {
  if (!logic || !logic.enabled || !Array.isArray(logic.conditions) || !logic.conditions.length) {
    return { visible: true, required: null };
  }
  const results = logic.conditions.map((c) => evaluateCondition(c, values));
  const matched = logic.logic === "any" ? results.some(Boolean) : results.every(Boolean);
  if (logic.action === "show") return { visible: matched, required: null };
  if (logic.action === "hide") return { visible: !matched, required: null };
  if (logic.action === "require") return { visible: true, required: matched };
  if (logic.action === "unrequire") return { visible: true, required: !matched };
  return { visible: true, required: null };
}

/** Public: submit */
export async function postPublicFormSubmit(req, res) {
  const slug = typeof req.params.slug === "string" ? req.params.slug.trim() : "";
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM forms WHERE slug = $1 AND is_active = true AND status = 'published'`,
      [slug]
    );
    if (!rows.length) return res.status(404).json({ error: "Form not found or not published." });
    const form = rows[0];
    if (form.access_type === "private") {
      const token = typeof req.query.token === "string" ? req.query.token.trim() : "";
      if (!token || token !== form.access_token) {
        return res.status(403).json({ error: "Access token required." });
      }
    }
    const { rows: fields } = await pool.query(
      `SELECT * FROM form_fields WHERE form_id = $1 ORDER BY sort_order ASC`,
      [form.id]
    );

    const submittedData = (req.body && typeof req.body.data === "object") ? req.body.data : {};
    const errors = [];
    const cleanedData = {};

    // First pass: for each field, figure out visibility/required
    for (const f of fields) {
      if (NON_INPUT_TYPES.has(f.field_type)) continue;
      const logic = evaluateLogic(f.conditional_logic, submittedData);
      if (!logic.visible) continue;
      const isRequired = logic.required !== null ? logic.required : f.is_required;
      const val = submittedData[f.field_key];
      const isEmpty = val == null || val === "" || (Array.isArray(val) && !val.length);
      if (isRequired && isEmpty) {
        errors.push(`${f.label} is required.`);
      }
      if (!isEmpty) {
        if (f.field_type === "email" && typeof val === "string" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
          errors.push(`${f.label} must be a valid email.`);
        }
        cleanedData[f.field_key] = val;
      }
    }

    if (errors.length) {
      return res.status(400).json({ error: "Validation failed.", details: errors });
    }

    // Try to extract contact info from first fullname and email fields
    let contactName = null, contactEmail = null, propertyName = null;
    for (const f of fields) {
      if (f.field_type === "fullname" && cleanedData[f.field_key]) {
        const v = cleanedData[f.field_key];
        if (typeof v === "object") {
          contactName = [v.first, v.middle, v.last].filter(Boolean).join(" ").trim() || null;
        } else {
          contactName = String(v);
        }
        if (contactName) break;
      }
    }
    for (const f of fields) {
      if (f.field_type === "email" && cleanedData[f.field_key]) {
        contactEmail = String(cleanedData[f.field_key]);
        break;
      }
    }
    for (const f of fields) {
      if (/property/i.test(f.field_key) && typeof cleanedData[f.field_key] === "string") {
        propertyName = cleanedData[f.field_key];
        break;
      }
    }

    const { rows: submissionRows } = await pool.query(
      `INSERT INTO form_submissions (form_id, submission_data, ip_address, user_agent, referrer,
                                     contact_name, contact_email, property_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        form.id, cleanedData,
        (req.ip || "").slice(0, 45),
        (req.get?.("user-agent") || "").slice(0, 500),
        (req.get?.("referer") || "").slice(0, 500),
        contactName, contactEmail, propertyName,
      ]
    );
    const submission = submissionRows[0];

    await pool.query(
      `UPDATE forms SET submissions_count = submissions_count + 1 WHERE id = $1`,
      [form.id]
    );
    await pool.query(
      `INSERT INTO form_analytics (form_id, event_type, event_data) VALUES ($1, 'form_submit', $2)`,
      [form.id, { submissionId: submission.id }]
    ).catch(() => {});

    // Run automations — delegate to the Phase 3 engine (which handles all action types).
    try {
      const { executeFormAutomations } = await import("../lib/form-automations.js");
      await executeFormAutomations(form.id, submission.id, cleanedData);
    } catch (err) {
      console.error("[form automation]", err?.message || err);
    }

    res.status(201).json({
      submissionId: submission.id,
      successMessage: form.success_message,
      successRedirectUrl: form.success_redirect_url,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not save submission." });
  }
}

function replaceVars(template, ctx) {
  if (typeof template !== "string") return template;
  return template.replace(/\{\{([^}]+)\}\}/g, (_m, key) => {
    const k = key.trim();
    if (k.startsWith("field:")) {
      return String(ctx.data?.[k.slice(6).trim()] ?? "");
    }
    if (k === "form_name") return ctx.form?.name ?? "";
    if (k === "submission_id") return String(ctx.submission?.id ?? "");
    if (k === "contact_name") return ctx.submission?.contact_name ?? "";
    if (k === "contact_email") return ctx.submission?.contact_email ?? "";
    return "";
  });
}

async function runAutomation(pool, automation, form, submission, data) {
  const ctx = { form, submission, data };
  const config = automation.action_config || {};
  if (automation.action_type === "send_notification") {
    const userIds = Array.isArray(config.userIds) ? config.userIds : [];
    const message = replaceVars(config.message || `New submission for ${form.name}`, ctx);
    const link = `/forms/${form.id}/submissions`;
    for (const uid of userIds) {
      const n = Number.parseInt(uid, 10);
      if (!Number.isFinite(n)) continue;
      await pool.query(
        `INSERT INTO notifications (user_id, message, link) VALUES ($1, $2, $3)`,
        [n, message, link]
      ).catch(() => {});
    }
  } else if (automation.action_type === "create_task") {
    const title = replaceVars(config.title || `Review ${form.name} submission`, ctx);
    const assignedUserId = Number.isFinite(Number.parseInt(config.assignedUserId, 10))
      ? Number.parseInt(config.assignedUserId, 10) : null;
    const priority = typeof config.priority === "string" ? config.priority : "normal";
    const category = typeof config.category === "string" ? config.category : null;
    await pool.query(
      `INSERT INTO tasks (title, status, priority, assigned_user_id, category, contact_name)
       VALUES ($1, 'pending', $2, $3, $4, $5)`,
      [title, priority, assignedUserId, category, submission.contact_name]
    ).catch(() => {});
  } else if (automation.action_type === "launch_process") {
    const templateId = Number.parseInt(config.templateId, 10);
    if (Number.isFinite(templateId)) {
      const name = replaceVars(config.name || `${form.name}: ${submission.contact_name || "New"}`, ctx);
      await pool.query(
        `INSERT INTO processes (template_id, name, property_name, contact_name, contact_email)
         VALUES ($1, $2, $3, $4, $5)`,
        [templateId, name, submission.property_name, submission.contact_name, submission.contact_email]
      ).catch(() => {});
    }
  }
  // webhook, send_email stubs can be added later
}

/** Submissions (admin) */
export async function getFormSubmissions(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid form id." });
  try {
    const pool = getPool();
    const filters = [`form_id = $1`];
    const vals = [id];
    let n = 2;
    const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
    if (status && SUBMISSION_STATUSES.has(status)) {
      filters.push(`status = $${n++}`);
      vals.push(status);
    }
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    if (search) {
      filters.push(`(LOWER(COALESCE(contact_name,'')) LIKE $${n} OR LOWER(COALESCE(contact_email,'')) LIKE $${n})`);
      vals.push(`%${search.toLowerCase()}%`);
      n++;
    }
    if (typeof req.query.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from)) {
      filters.push(`submitted_at >= $${n++}::date`);
      vals.push(req.query.from);
    }
    if (typeof req.query.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to)) {
      filters.push(`submitted_at <= ($${n++}::date + INTERVAL '1 day')`);
      vals.push(req.query.to);
    }
    const limit = Math.min(200, Number.parseInt(req.query.limit, 10) || 50);
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    const { rows } = await pool.query(
      `SELECT id, form_id, status, submitted_at, contact_name, contact_email, property_name
       FROM form_submissions
       WHERE ${filters.join(" AND ")}
       ORDER BY submitted_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      vals
    );
    res.json({ submissions: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load submissions." });
  }
}

export async function getFormSubmission(req, res) {
  const submissionId = Number.parseInt(req.params.submissionId, 10);
  if (!Number.isFinite(submissionId)) return res.status(400).json({ error: "Invalid submission id." });
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM form_submissions WHERE id = $1`, [submissionId]
    );
    if (!rows.length) return res.status(404).json({ error: "Submission not found." });
    const s = rows[0];
    const { rows: form } = await pool.query(`SELECT * FROM forms WHERE id = $1`, [s.form_id]);
    const { rows: fields } = await pool.query(
      `SELECT * FROM form_fields WHERE form_id = $1 ORDER BY sort_order ASC`, [s.form_id]
    );
    const { rows: files } = await pool.query(
      `SELECT * FROM form_submission_files WHERE submission_id = $1`, [submissionId]
    );
    res.json({
      submission: mapSubmission(s),
      form: mapForm(form[0]),
      fields: fields.map(mapField),
      files,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load submission." });
  }
}

export async function putFormSubmission(req, res) {
  const submissionId = Number.parseInt(req.params.submissionId, 10);
  if (!Number.isFinite(submissionId)) return res.status(400).json({ error: "Invalid submission id." });
  const b = req.body || {};
  const sets = [];
  const vals = [];
  let n = 1;
  if (typeof b.status === "string" && SUBMISSION_STATUSES.has(b.status)) {
    sets.push(`status = $${n++}`);
    vals.push(b.status);
    if (b.status === "reviewed") {
      sets.push(`reviewed_at = NOW()`);
      sets.push(`reviewed_by = $${n++}`);
      vals.push(req.user?.id ?? null);
    }
  }
  if (typeof b.notes === "string") { sets.push(`notes = $${n++}`); vals.push(b.notes); }
  if (!sets.length) return res.status(400).json({ error: "No valid fields to update." });
  vals.push(submissionId);
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE form_submissions SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: "Submission not found." });
    res.json({ submission: mapSubmission(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update submission." });
  }
}

export async function deleteFormSubmission(req, res) {
  const submissionId = Number.parseInt(req.params.submissionId, 10);
  if (!Number.isFinite(submissionId)) return res.status(400).json({ error: "Invalid submission id." });
  try {
    const pool = getPool();
    await pool.query(`DELETE FROM form_submissions WHERE id = $1`, [submissionId]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete submission." });
  }
}

function csvEscape(s) {
  if (s == null) return "";
  const t = String(s);
  if (/[",\n]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

export async function getFormSubmissionsExport(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).send("Invalid form id.");
  try {
    const pool = getPool();
    const { rows: fields } = await pool.query(
      `SELECT field_key, label, field_type FROM form_fields WHERE form_id = $1 ORDER BY sort_order ASC`,
      [id]
    );
    const inputFields = fields.filter((f) => !NON_INPUT_TYPES.has(f.field_type));
    const { rows } = await pool.query(
      `SELECT * FROM form_submissions WHERE form_id = $1 ORDER BY submitted_at DESC`, [id]
    );
    const headers = ["id", "submitted_at", "status", "contact_name", "contact_email", ...inputFields.map((f) => f.label)];
    const lines = [headers.map(csvEscape).join(",")];
    for (const r of rows) {
      const data = r.submission_data || {};
      const line = [r.id, r.submitted_at, r.status, r.contact_name, r.contact_email,
        ...inputFields.map((f) => {
          const v = data[f.field_key];
          if (v == null) return "";
          if (typeof v === "object") return JSON.stringify(v);
          return String(v);
        })
      ];
      lines.push(line.map(csvEscape).join(","));
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="form-${id}-submissions.csv"`);
    res.send(lines.join("\n"));
  } catch (e) {
    console.error(e);
    res.status(500).send("Could not export.");
  }
}

/** Analytics */
export async function getFormAnalytics(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid form id." });
  try {
    const pool = getPool();
    const { rows: form } = await pool.query(
      `SELECT views_count, submissions_count FROM forms WHERE id = $1`, [id]
    );
    if (!form.length) return res.status(404).json({ error: "Form not found." });
    const totalViews = form[0].views_count || 0;
    const totalSubmissions = form[0].submissions_count || 0;
    const conversionRate = totalViews > 0 ? (totalSubmissions / totalViews) * 100 : 0;
    const { rows: byDay } = await pool.query(
      `SELECT TO_CHAR(DATE_TRUNC('day', submitted_at), 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
       FROM form_submissions WHERE form_id = $1 AND submitted_at >= NOW() - INTERVAL '30 days'
       GROUP BY day ORDER BY day ASC`,
      [id]
    );
    res.json({
      totalViews,
      totalSubmissions,
      conversionRate: Math.round(conversionRate * 10) / 10,
      submissionsByDay: byDay,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load analytics." });
  }
}
