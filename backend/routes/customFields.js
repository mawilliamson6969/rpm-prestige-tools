import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import multer from "multer";
import { getPool } from "../lib/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadRoot = path.join(__dirname, "..", "uploads", "custom-fields");
fs.mkdirSync(uploadRoot, { recursive: true });

const VALID_ENTITY_TYPES = new Set([
  "process_template",
  "process",
  "process_template_step",
  "process_step",
  "project",
]);

const VALID_FIELD_TYPES = new Set([
  "text",
  "textarea",
  "number",
  "currency",
  "percentage",
  "date",
  "datetime",
  "boolean",
  "select",
  "multiselect",
  "email",
  "phone",
  "url",
  "file",
  "user",
  "property",
  "address",
  "rating",
  "color",
  "checklist",
]);

const TEXT_TYPES = new Set(["text", "textarea", "select", "email", "phone", "url", "color"]);
const NUMBER_TYPES = new Set(["number", "currency", "percentage", "rating", "user"]);
const JSON_TYPES = new Set(["multiselect", "file", "property", "address", "checklist"]);

function valueColumnFor(fieldType) {
  if (TEXT_TYPES.has(fieldType)) return "value_text";
  if (NUMBER_TYPES.has(fieldType)) return "value_number";
  if (JSON_TYPES.has(fieldType)) return "value_json";
  if (fieldType === "boolean") return "value_boolean";
  if (fieldType === "date") return "value_date";
  if (fieldType === "datetime") return "value_datetime";
  return "value_text";
}

function coerceValue(fieldType, raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  if (TEXT_TYPES.has(fieldType)) return String(raw);
  if (NUMBER_TYPES.has(fieldType)) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (fieldType === "boolean") return raw === true || raw === "true" || raw === 1 || raw === "1";
  if (fieldType === "date" || fieldType === "datetime") return String(raw);
  if (JSON_TYPES.has(fieldType)) {
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
    return raw;
  }
  return raw;
}

function mapDefinition(r) {
  return {
    id: r.id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    fieldName: r.field_name,
    fieldLabel: r.field_label,
    fieldType: r.field_type,
    fieldConfig: r.field_config ?? {},
    isRequired: r.is_required,
    sortOrder: r.sort_order,
    sectionName: r.section_name,
    placeholder: r.placeholder,
    helpText: r.help_text,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapValueRow(r) {
  const col = valueColumnFor(r.field_type);
  return {
    id: r.id,
    fieldDefinitionId: r.field_definition_id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    fieldType: r.field_type,
    fieldLabel: r.field_label,
    fieldName: r.field_name,
    value: r[col] ?? null,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
  };
}

function slugifyName(label) {
  return String(label || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64);
}

export async function getFieldDefinitions(req, res) {
  const entityType = typeof req.query.entityType === "string" ? req.query.entityType : "";
  const entityId = Number.parseInt(req.query.entityId, 10);
  if (!VALID_ENTITY_TYPES.has(entityType) || !Number.isFinite(entityId)) {
    res.status(400).json({ error: "entityType and entityId are required." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM custom_field_definitions
       WHERE entity_type = $1 AND entity_id = $2
       ORDER BY section_name ASC NULLS LAST, sort_order ASC, id ASC`,
      [entityType, entityId]
    );
    res.json({ definitions: rows.map(mapDefinition) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load field definitions." });
  }
}

export async function postFieldDefinition(req, res) {
  const entityType = typeof req.body?.entityType === "string" ? req.body.entityType : "";
  const entityId = Number.parseInt(req.body?.entityId, 10);
  const fieldLabel = typeof req.body?.fieldLabel === "string" ? req.body.fieldLabel.trim() : "";
  const fieldType = typeof req.body?.fieldType === "string" ? req.body.fieldType.trim() : "";
  if (
    !VALID_ENTITY_TYPES.has(entityType) ||
    !Number.isFinite(entityId) ||
    !fieldLabel ||
    !VALID_FIELD_TYPES.has(fieldType)
  ) {
    res.status(400).json({ error: "entityType, entityId, fieldLabel, and valid fieldType are required." });
    return;
  }
  const fieldName =
    typeof req.body?.fieldName === "string" && req.body.fieldName.trim()
      ? slugifyName(req.body.fieldName)
      : slugifyName(fieldLabel);
  try {
    const pool = getPool();
    const { rows: next } = await pool.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM custom_field_definitions
       WHERE entity_type = $1 AND entity_id = $2`,
      [entityType, entityId]
    );
    const sortOrder = Number.isFinite(Number.parseInt(req.body?.sortOrder, 10))
      ? Number.parseInt(req.body.sortOrder, 10)
      : next[0].n;
    const { rows } = await pool.query(
      `INSERT INTO custom_field_definitions
         (entity_type, entity_id, field_name, field_label, field_type, field_config,
          is_required, sort_order, section_name, placeholder, help_text)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        entityType,
        entityId,
        fieldName,
        fieldLabel,
        fieldType,
        req.body?.fieldConfig && typeof req.body.fieldConfig === "object" ? req.body.fieldConfig : {},
        req.body?.isRequired === true,
        sortOrder,
        typeof req.body?.sectionName === "string" ? req.body.sectionName.trim() || "Details" : "Details",
        typeof req.body?.placeholder === "string" ? req.body.placeholder.trim() || null : null,
        typeof req.body?.helpText === "string" ? req.body.helpText.trim() || null : null,
      ]
    );
    res.status(201).json({ definition: mapDefinition(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not create field definition." });
  }
}

export async function putFieldDefinition(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid field id." });
    return;
  }
  const sets = [];
  const vals = [];
  let n = 1;
  const strings = [
    ["fieldLabel", "field_label"],
    ["sectionName", "section_name"],
    ["placeholder", "placeholder"],
    ["helpText", "help_text"],
  ];
  for (const [key, col] of strings) {
    if (typeof req.body?.[key] === "string") {
      sets.push(`${col} = $${n++}`);
      vals.push(req.body[key].trim() || null);
    }
  }
  if (typeof req.body?.fieldName === "string") {
    sets.push(`field_name = $${n++}`);
    vals.push(slugifyName(req.body.fieldName));
  }
  if (typeof req.body?.fieldType === "string" && VALID_FIELD_TYPES.has(req.body.fieldType)) {
    sets.push(`field_type = $${n++}`);
    vals.push(req.body.fieldType);
  }
  if (req.body?.fieldConfig !== undefined && typeof req.body.fieldConfig === "object") {
    sets.push(`field_config = $${n++}`);
    vals.push(req.body.fieldConfig);
  }
  if (typeof req.body?.isRequired === "boolean") {
    sets.push(`is_required = $${n++}`);
    vals.push(req.body.isRequired);
  }
  if (Number.isFinite(Number.parseInt(req.body?.sortOrder, 10))) {
    sets.push(`sort_order = $${n++}`);
    vals.push(Number.parseInt(req.body.sortOrder, 10));
  }
  if (!sets.length) {
    res.status(400).json({ error: "No valid fields to update." });
    return;
  }
  sets.push(`updated_at = NOW()`);
  vals.push(id);
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE custom_field_definitions SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    if (!rows.length) {
      res.status(404).json({ error: "Field not found." });
      return;
    }
    res.json({ definition: mapDefinition(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update field." });
  }
}

export async function deleteFieldDefinition(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid field id." });
    return;
  }
  try {
    const pool = getPool();
    const { rowCount } = await pool.query(`DELETE FROM custom_field_definitions WHERE id = $1`, [id]);
    if (!rowCount) {
      res.status(404).json({ error: "Field not found." });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete field." });
  }
}

export async function putFieldDefinitionsReorder(req, res) {
  const ids = Array.isArray(req.body?.fieldIds) ? req.body.fieldIds : null;
  if (!ids) {
    res.status(400).json({ error: "fieldIds array required." });
    return;
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < ids.length; i++) {
      const fid = Number.parseInt(ids[i], 10);
      if (!Number.isFinite(fid)) continue;
      await client.query(`UPDATE custom_field_definitions SET sort_order = $1 WHERE id = $2`, [i, fid]);
    }
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    res.status(500).json({ error: "Could not reorder fields." });
  } finally {
    client.release();
  }
}

export async function getFieldValues(req, res) {
  const entityType = typeof req.query.entityType === "string" ? req.query.entityType : "";
  const entityId = Number.parseInt(req.query.entityId, 10);
  if (!VALID_ENTITY_TYPES.has(entityType) || !Number.isFinite(entityId)) {
    res.status(400).json({ error: "entityType and entityId are required." });
    return;
  }
  try {
    const pool = getPool();
    // For process/process_step values, the definitions live on the template.
    // We figure out the definition entity_type/id via a map.
    let definitionEntityType = entityType;
    let definitionEntityId = entityId;
    if (entityType === "process") {
      const { rows: proc } = await pool.query(`SELECT template_id FROM processes WHERE id = $1`, [entityId]);
      if (proc.length && proc[0].template_id) {
        definitionEntityType = "process_template";
        definitionEntityId = proc[0].template_id;
      }
    } else if (entityType === "process_step") {
      const { rows: step } = await pool.query(`SELECT template_step_id FROM process_steps WHERE id = $1`, [entityId]);
      if (step.length && step[0].template_step_id) {
        definitionEntityType = "process_template_step";
        definitionEntityId = step[0].template_step_id;
      }
    }
    const { rows: defs } = await pool.query(
      `SELECT * FROM custom_field_definitions
       WHERE entity_type = $1 AND entity_id = $2
       ORDER BY section_name ASC NULLS LAST, sort_order ASC, id ASC`,
      [definitionEntityType, definitionEntityId]
    );
    const { rows: vals } = await pool.query(
      `SELECT v.*, d.field_type, d.field_label, d.field_name
       FROM custom_field_values v
       JOIN custom_field_definitions d ON d.id = v.field_definition_id
       WHERE v.entity_type = $1 AND v.entity_id = $2`,
      [entityType, entityId]
    );
    res.json({
      definitions: defs.map(mapDefinition),
      values: vals.map(mapValueRow),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load field values." });
  }
}

async function upsertValueOn(client, defId, entityType, entityId, value, userId) {
  const { rows: defRows } = await client.query(
    `SELECT field_type FROM custom_field_definitions WHERE id = $1`,
    [defId]
  );
  if (!defRows.length) {
    const err = new Error("field definition not found");
    err.status = 404;
    throw err;
  }
  const ft = defRows[0].field_type;
  const column = valueColumnFor(ft);
  const cols = ["value_text", "value_number", "value_boolean", "value_date", "value_datetime", "value_json"];
  const coerced = coerceValue(ft, value);
  const values = {};
  for (const c of cols) values[c] = null;
  if (coerced === null) {
    /* all nulls clears the value */
  } else if (column === "value_json") {
    values[column] = coerced;
  } else {
    values[column] = coerced;
  }
  const { rows } = await client.query(
    `INSERT INTO custom_field_values
       (field_definition_id, entity_type, entity_id, value_text, value_number, value_boolean,
        value_date, value_datetime, value_json, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
     ON CONFLICT (field_definition_id, entity_type, entity_id)
     DO UPDATE SET
       value_text = EXCLUDED.value_text,
       value_number = EXCLUDED.value_number,
       value_boolean = EXCLUDED.value_boolean,
       value_date = EXCLUDED.value_date,
       value_datetime = EXCLUDED.value_datetime,
       value_json = EXCLUDED.value_json,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()
     RETURNING *`,
    [
      defId,
      entityType,
      entityId,
      values.value_text,
      values.value_number,
      values.value_boolean,
      values.value_date,
      values.value_datetime,
      values.value_json != null ? JSON.stringify(values.value_json) : null,
      userId,
    ]
  );
  return { row: rows[0], fieldType: ft };
}

export async function putFieldValue(req, res) {
  const defId = Number.parseInt(req.body?.fieldDefinitionId, 10);
  const entityType = typeof req.body?.entityType === "string" ? req.body.entityType : "";
  const entityId = Number.parseInt(req.body?.entityId, 10);
  if (!Number.isFinite(defId) || !VALID_ENTITY_TYPES.has(entityType) || !Number.isFinite(entityId)) {
    res.status(400).json({ error: "fieldDefinitionId, entityType, entityId required." });
    return;
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    const { row, fieldType } = await upsertValueOn(
      client,
      defId,
      entityType,
      entityId,
      req.body?.value,
      req.user.id
    );
    res.json({
      value: mapValueRow({ ...row, field_type: fieldType, field_label: null, field_name: null }),
    });
  } catch (e) {
    const status = e.status || 500;
    console.error(e);
    res.status(status).json({ error: e.message || "Could not save value." });
  } finally {
    client.release();
  }
}

export async function putFieldValuesBulk(req, res) {
  const entityType = typeof req.body?.entityType === "string" ? req.body.entityType : "";
  const entityId = Number.parseInt(req.body?.entityId, 10);
  const values = Array.isArray(req.body?.values) ? req.body.values : null;
  if (!VALID_ENTITY_TYPES.has(entityType) || !Number.isFinite(entityId) || !values) {
    res.status(400).json({ error: "entityType, entityId, and values[] required." });
    return;
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const results = [];
    for (const v of values) {
      const defId = Number.parseInt(v?.fieldDefinitionId, 10);
      if (!Number.isFinite(defId)) continue;
      try {
        const { row, fieldType } = await upsertValueOn(
          client,
          defId,
          entityType,
          entityId,
          v.value,
          req.user.id
        );
        results.push(mapValueRow({ ...row, field_type: fieldType, field_label: null, field_name: null }));
      } catch (inner) {
        console.warn("bulk upsert skipped:", inner.message);
      }
    }
    await client.query("COMMIT");
    res.json({ values: results });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    res.status(500).json({ error: "Could not save values." });
  } finally {
    client.release();
  }
}

export async function deleteFieldValue(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid value id." });
    return;
  }
  try {
    const pool = getPool();
    const { rowCount } = await pool.query(`DELETE FROM custom_field_values WHERE id = $1`, [id]);
    if (!rowCount) {
      res.status(404).json({ error: "Value not found." });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete value." });
  }
}

/* File upload */

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const et = typeof req.body?.entityType === "string" ? req.body.entityType : "misc";
    const id = String(Number.parseInt(req.body?.entityId, 10) || 0);
    if (!VALID_ENTITY_TYPES.has(et)) {
      cb(new Error("Invalid entityType"), "");
      return;
    }
    const dir = path.join(uploadRoot, et, id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || "";
    cb(null, `${randomUUID()}${ext}`);
  },
});

export const customFieldUploadMiddleware = (req, res, next) => {
  multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }).single("file")(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(400).json({ error: "File too large (max 10MB)." });
        return;
      }
      res.status(400).json({ error: err.message || "Upload failed." });
      return;
    }
    next();
  });
};

export async function postFieldUpload(req, res) {
  if (!req.file) {
    res.status(400).json({ error: "No file received." });
    return;
  }
  const et = req.body?.entityType;
  const id = Number.parseInt(req.body?.entityId, 10);
  const rel = `/uploads/custom-fields/${et}/${id}/${req.file.filename}`;
  res.status(201).json({
    url: rel,
    filename: req.file.originalname,
    storedName: req.file.filename,
    size: req.file.size,
  });
}
