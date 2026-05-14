/**
 * Phase 5: subitems (as mb_items rows with parent_item_id) + subitem
 * templates with embedded instructions + per-subitem checklist state.
 *
 * Subitems are full mb_items rows — they inherit the column-value
 * machinery from Phase 3 (status, person, date, etc.) and the system-
 * event recorder from Phase 4. We deliberately do NOT log system events
 * for subitem value changes (they would clutter the parent's updates
 * feed, which is item-level only per Phase 4 spec); the suppression
 * happens in mbItems.updateItem via a `parent_item_id IS NULL` check.
 *
 * Templates use mb_subitem_templates with its `instructions` JSONB blob
 * carrying all 8 sections. Detached subitems store their own copy of
 * the blob in mb_items.instructions. Subitems with a NULL
 * subitem_detached_at read instructions live from the template — so
 * template edits propagate.
 */

import { getPool } from "../lib/db.js";
import {
  vIntId,
  vStringReq,
  vStringOpt,
  vNumOpt,
  vBool,
  vJson,
} from "../lib/mb/validators.js";

const SECTION_KEYS = new Set([
  "objective",
  "steps",
  "decision_matrix",
  "email_templates",
  "sms_templates",
  "escalations",
  "completion_checklist",
  "related_resources",
]);

function isAdmin(user) {
  return user?.role === "admin" || user?.role === "owner";
}

function requireAdminRoleRes(req, res) {
  if (!isAdmin(req.user)) {
    res.status(403).json({ error: "Admin access required." });
    return false;
  }
  return true;
}

// ============================================================
// Subitems: CRUD
// ============================================================

/**
 * GET /mb/items/:itemId/subitems
 *
 * Returns all subitems (mb_items rows where parent_item_id = :itemId).
 * Sorted by subitem_position ASC, then created_at ASC for ties.
 */
export async function listSubitems(req, res) {
  try {
    const itemId = vIntId(req.params.itemId, "item id");
    const pool = getPool();
    const includeArchived = req.query.include_archived === "true";
    const archivedClause = includeArchived ? "" : "AND archived_at IS NULL";
    const { rows } = await pool.query(
      `SELECT * FROM mb_items
        WHERE parent_item_id = $1 ${archivedClause}
        ORDER BY subitem_position ASC NULLS LAST, created_at ASC, id ASC`,
      [itemId]
    );
    res.json({ subitems: rows });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] list subitems", e);
    res.status(500).json({ error: "Could not load subitems." });
  }
}

/**
 * POST /mb/items/:itemId/subitems
 *
 * Body:
 *   { name?: string, from_template_id?: int, values?: object }
 *
 * If `from_template_id` is supplied:
 *   * The subitem links to that template (subitem_template_id set).
 *   * Title defaults to the template's name.
 *   * subitem_detached_at stays NULL — instructions read live from the
 *     template on every page load.
 *
 * If not, it's a "scratch" subitem with NULL template_id. The caller
 * can later edit mb_items.instructions for custom content.
 */
export async function createSubitem(req, res) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const itemId = vIntId(req.params.itemId, "item id");
    const body = req.body ?? {};
    const templateId = body.from_template_id == null ? null : vIntId(body.from_template_id, "from_template_id");
    let name = vStringOpt(body.name, { maxLen: 200 });
    const values = body.values == null ? {} : vJson(body.values, "values", { requireObject: true });

    // Look up the parent to inherit board_id and group_id (the subitem
    // shares the parent's board for permissions/visibility).
    const { rows: parentRows } = await client.query(
      `SELECT id, board_id, group_id, parent_item_id
         FROM mb_items WHERE id = $1`,
      [itemId]
    );
    if (!parentRows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Item not found." });
    }
    const parent = parentRows[0];
    if (parent.parent_item_id != null) {
      // Defence in depth — DB trigger blocks too.
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Cannot add a subitem to another subitem (max one level deep).",
      });
    }

    // If from a template, pull defaults.
    let defaultValues = {};
    if (templateId != null) {
      const { rows: tpl } = await client.query(
        `SELECT id, name, board_id, instructions
           FROM mb_subitem_templates
          WHERE id = $1 AND archived_at IS NULL`,
        [templateId]
      );
      if (!tpl.length) {
        await client.query("ROLLBACK");
        return res
          .status(404)
          .json({ error: "Template not found or archived." });
      }
      if (tpl[0].board_id !== parent.board_id) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: "Template belongs to a different board.",
        });
      }
      if (!name) name = tpl[0].name;
    }
    if (!name) name = "New subitem";

    // Next sibling position.
    const { rows: maxRow } = await client.query(
      `SELECT COALESCE(MAX(subitem_position), 0) AS m
         FROM mb_items WHERE parent_item_id = $1`,
      [itemId]
    );
    const position = Number(maxRow[0].m) + 1024;

    // Subitem mb_items row.
    const { rows } = await client.query(
      `INSERT INTO mb_items
         (board_id, title, position, group_id, values,
          parent_item_id, subitem_template_id, subitem_position,
          created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
       RETURNING *`,
      [
        parent.board_id,
        name,
        position, // top-level position (kept for sanity; not actually rendered on the board)
        parent.group_id,
        JSON.stringify({ ...defaultValues, ...values }),
        itemId,
        templateId,
        position,
        req.user.id,
      ]
    );

    await client.query("COMMIT");
    res.status(201).json({ subitem: rows[0] });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    if (e.http) return res.status(e.http).json({ error: e.message });
    if (e.code === "23514") {
      // Trigger fired.
      return res.status(400).json({
        error: "Cannot add a subitem to another subitem (max one level deep).",
      });
    }
    console.error("[mb] create subitem", e);
    res.status(500).json({ error: "Could not create subitem." });
  } finally {
    client.release();
  }
}

/**
 * POST /mb/items/:itemId/subitems/from-workflow
 *
 * Body: { workflow_name: string }
 *
 * Bulk-creates one subitem per template in the workflow group on the
 * item's board, in template.position order. One transaction.
 */
export async function createWorkflowSubitems(req, res) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const itemId = vIntId(req.params.itemId, "item id");
    const workflowName = vStringReq(req.body?.workflow_name, "workflow_name", { maxLen: 120 });

    const { rows: parentRows } = await client.query(
      `SELECT id, board_id, group_id, parent_item_id
         FROM mb_items WHERE id = $1`,
      [itemId]
    );
    if (!parentRows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Item not found." });
    }
    const parent = parentRows[0];
    if (parent.parent_item_id != null) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Cannot add subitems to a subitem." });
    }

    const { rows: templates } = await client.query(
      `SELECT id, name, position FROM mb_subitem_templates
        WHERE board_id = $1
          AND workflow_name = $2
          AND archived_at IS NULL
        ORDER BY position ASC, id ASC`,
      [parent.board_id, workflowName]
    );
    if (templates.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: `No active templates found for workflow "${workflowName}" on this board.`,
      });
    }

    const { rows: maxRow } = await client.query(
      `SELECT COALESCE(MAX(subitem_position), 0) AS m
         FROM mb_items WHERE parent_item_id = $1`,
      [itemId]
    );
    let nextPos = Number(maxRow[0].m) + 1024;
    const created = [];
    for (const tpl of templates) {
      const { rows: ins } = await client.query(
        `INSERT INTO mb_items
           (board_id, title, position, group_id, values,
            parent_item_id, subitem_template_id, subitem_position, created_by)
         VALUES ($1, $2, $3, $4, '{}'::jsonb, $5, $6, $7, $8)
         RETURNING *`,
        [parent.board_id, tpl.name, nextPos, parent.group_id, itemId, tpl.id, nextPos, req.user.id]
      );
      created.push(ins[0]);
      nextPos += 1024;
    }
    await client.query("COMMIT");
    res.status(201).json({ subitems: created });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] create workflow subitems", e);
    res.status(500).json({ error: "Could not create workflow subitems." });
  } finally {
    client.release();
  }
}

/**
 * POST /mb/subitems/:id/detach
 *
 * Snapshots the linked template's `instructions` blob into the subitem's
 * own `instructions` column and sets `subitem_detached_at`. Future
 * template edits stop affecting this subitem. One-way (per spec — no
 * re-attach in this phase).
 */
export async function detachSubitem(req, res) {
  if (!requireAdminRoleRes(req, res)) return;
  try {
    const id = vIntId(req.params.id, "subitem id");
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT s.id, s.subitem_template_id, s.subitem_detached_at,
              t.instructions AS template_instructions
         FROM mb_items s
         LEFT JOIN mb_subitem_templates t ON t.id = s.subitem_template_id
        WHERE s.id = $1 AND s.parent_item_id IS NOT NULL`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Subitem not found." });
    const sub = rows[0];
    if (sub.subitem_detached_at != null) {
      return res.status(400).json({ error: "Subitem is already detached." });
    }
    if (sub.subitem_template_id == null) {
      return res.status(400).json({ error: "Subitem is not linked to a template." });
    }
    const snapshot = sub.template_instructions ?? {};
    await pool.query(
      `UPDATE mb_items
          SET instructions = $1::jsonb,
              subitem_detached_at = NOW(),
              updated_at = NOW()
        WHERE id = $2`,
      [JSON.stringify(snapshot), id]
    );
    res.json({ ok: true });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] detach subitem", e);
    res.status(500).json({ error: "Could not detach subitem." });
  }
}

/**
 * POST /mb/items/:itemId/subitems/reorder
 *
 * Body: { order: [subitemId, ...] } — sets subitem_position = idx * 10
 * for each. One transaction.
 */
export async function reorderSubitems(req, res) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const itemId = vIntId(req.params.itemId, "item id");
    const order = Array.isArray(req.body?.order) ? req.body.order : null;
    if (!order || order.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "order array required." });
    }
    const ids = order.map((x, i) => vIntId(x, `order[${i}]`));

    const { rows: owned } = await client.query(
      `SELECT id FROM mb_items
        WHERE parent_item_id = $1 AND id = ANY($2::int[])`,
      [itemId, ids]
    );
    if (owned.length !== ids.length) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: "One or more subitems do not belong to this item." });
    }
    for (let i = 0; i < ids.length; i++) {
      await client.query(
        `UPDATE mb_items SET subitem_position = $1 WHERE id = $2`,
        [(i + 1) * 10, ids[i]]
      );
    }
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] reorder subitems", e);
    res.status(500).json({ error: "Could not reorder subitems." });
  } finally {
    client.release();
  }
}

// ============================================================
// Resolved instructions
// ============================================================

/**
 * GET /mb/subitems/:id/instructions
 *
 * Returns the effective instructions for a subitem:
 *   * If detached → mb_items.instructions
 *   * If linked   → mb_subitem_templates.instructions for the linked template
 *   * If scratch  → empty object
 *
 * Plus a `source` field telling the UI which case it is so it can show
 * the right badge ("Linked to X" / "Detached" / "Custom").
 */
export async function getSubitemInstructions(req, res) {
  try {
    const id = vIntId(req.params.id, "subitem id");
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT s.id, s.subitem_template_id, s.subitem_detached_at,
              s.instructions AS local_instructions,
              t.name AS template_name,
              t.instructions AS template_instructions
         FROM mb_items s
         LEFT JOIN mb_subitem_templates t ON t.id = s.subitem_template_id
        WHERE s.id = $1 AND s.parent_item_id IS NOT NULL`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Subitem not found." });
    const r = rows[0];
    let source = "custom";
    let instructions = r.local_instructions ?? {};
    let templateName = null;
    if (r.subitem_detached_at != null) {
      source = "detached";
      instructions = r.local_instructions ?? {};
      templateName = r.template_name;
    } else if (r.subitem_template_id != null) {
      source = "linked";
      instructions = r.template_instructions ?? {};
      templateName = r.template_name;
    }
    res.json({
      source,
      template_id: r.subitem_template_id,
      template_name: templateName,
      detached_at: r.subitem_detached_at,
      instructions,
    });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] get subitem instructions", e);
    res.status(500).json({ error: "Could not load instructions." });
  }
}

/**
 * PUT /mb/subitems/:id/instructions/:section  (admin, detached or custom only)
 *
 * Replaces one section of mb_items.instructions on a detached or
 * scratch subitem. Linked subitems get a 400 — to edit them, edit the
 * template at /mb/subitem-templates/:tid/instructions/:section.
 */
export async function setSubitemInstructionSection(req, res) {
  if (!requireAdminRoleRes(req, res)) return;
  try {
    const id = vIntId(req.params.id, "subitem id");
    const section = String(req.params.section ?? "");
    if (!SECTION_KEYS.has(section)) {
      return res.status(400).json({ error: "Unknown instruction section." });
    }
    const content = vJson(req.body, "content", {
      requireObject: true,
      allowNull: false,
    });

    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT id, subitem_template_id, subitem_detached_at
         FROM mb_items
        WHERE id = $1 AND parent_item_id IS NOT NULL`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Subitem not found." });
    const r = rows[0];
    const isLinked = r.subitem_template_id != null && r.subitem_detached_at == null;
    if (isLinked) {
      return res.status(400).json({
        error: "Cannot edit instructions on a template-linked subitem. Edit the template or detach this subitem first.",
      });
    }
    await pool.query(
      `UPDATE mb_items
          SET instructions = COALESCE(instructions, '{}'::jsonb) || jsonb_build_object($1::text, $2::jsonb),
              updated_at = NOW()
        WHERE id = $3`,
      [section, JSON.stringify(content), id]
    );
    res.json({ ok: true });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] set subitem instructions section", e);
    res.status(500).json({ error: "Could not save instructions." });
  }
}

// ============================================================
// Templates: CRUD
// ============================================================

export async function listBoardTemplates(req, res) {
  try {
    const boardId = vIntId(req.params.boardId, "board id");
    const pool = getPool();
    const includeArchived = req.query.include_archived === "true";
    const archivedClause = includeArchived ? "" : "AND archived_at IS NULL";
    const { rows } = await pool.query(
      `SELECT id, board_id, name, description, position, workflow_name,
              archived_at, created_at, updated_at,
              (instructions ->> 'objective') AS objective_preview
         FROM mb_subitem_templates
        WHERE board_id = $1 ${archivedClause}
        ORDER BY workflow_name NULLS LAST, position ASC, id ASC`,
      [boardId]
    );
    res.json({ templates: rows });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] list templates", e);
    res.status(500).json({ error: "Could not load templates." });
  }
}

export async function getTemplate(req, res) {
  try {
    const id = vIntId(req.params.templateId, "template id");
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM mb_subitem_templates WHERE id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Template not found." });
    res.json({ template: rows[0] });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] get template", e);
    res.status(500).json({ error: "Could not load template." });
  }
}

export async function createTemplate(req, res) {
  if (!requireAdminRoleRes(req, res)) return;
  try {
    const boardId = vIntId(req.params.boardId, "board id");
    const body = req.body ?? {};
    const name = vStringReq(body.name, "name", { maxLen: 200 });
    const description = vStringOpt(body.description, { maxLen: 5000 });
    const workflowName = vStringOpt(body.workflow_name, { maxLen: 120 });

    const pool = getPool();
    const { rows: maxRow } = await pool.query(
      `SELECT COALESCE(MAX(position), 0) AS m
         FROM mb_subitem_templates WHERE board_id = $1`,
      [boardId]
    );
    const position = Number(maxRow[0].m) + 10;

    const emptyInstructions = {
      objective: { text: "" },
      steps: { steps: [] },
      decision_matrix: { rows: [] },
      email_templates: { templates: [] },
      sms_templates: { templates: [] },
      escalations: { text_html: "", text_plain: "" },
      completion_checklist: { items: [] },
      related_resources: { resources: [] },
    };

    const { rows } = await pool.query(
      `INSERT INTO mb_subitem_templates
         (board_id, name, description, position, workflow_name, instructions, escalation_triggers, completion_checklist)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, '[]'::jsonb, '[]'::jsonb)
       RETURNING *`,
      [
        boardId,
        name,
        description,
        position,
        workflowName,
        JSON.stringify(emptyInstructions),
      ]
    );
    res.status(201).json({ template: rows[0] });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    if (e.code === "23505") {
      return res.status(409).json({ error: "A template with that name already exists on this board." });
    }
    console.error("[mb] create template", e);
    res.status(500).json({ error: "Could not create template." });
  }
}

export async function updateTemplate(req, res) {
  if (!requireAdminRoleRes(req, res)) return;
  try {
    const id = vIntId(req.params.templateId, "template id");
    const body = req.body ?? {};
    const sets = [];
    const vals = [];
    let n = 1;
    if (body.name !== undefined) {
      sets.push(`name = $${n++}`);
      vals.push(vStringReq(body.name, "name", { maxLen: 200 }));
    }
    if (body.description !== undefined) {
      sets.push(`description = $${n++}`);
      vals.push(vStringOpt(body.description, { maxLen: 5000 }));
    }
    if (body.workflow_name !== undefined) {
      sets.push(`workflow_name = $${n++}`);
      vals.push(vStringOpt(body.workflow_name, { maxLen: 120 }));
    }
    if (body.archived !== undefined) {
      const archived = vBool(body.archived, { allowNull: false });
      sets.push(`archived_at = ${archived ? "NOW()" : "NULL"}`);
    }
    if (!sets.length) {
      return res.status(400).json({ error: "No valid fields to update." });
    }
    sets.push(`updated_at = NOW()`);
    vals.push(id);
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE mb_subitem_templates SET ${sets.join(", ")} WHERE id = $${n} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: "Template not found." });
    res.json({ template: rows[0] });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    if (e.code === "23505") {
      return res.status(409).json({ error: "A template with that name already exists on this board." });
    }
    console.error("[mb] update template", e);
    res.status(500).json({ error: "Could not update template." });
  }
}

export async function deleteTemplate(req, res) {
  if (!requireAdminRoleRes(req, res)) return;
  try {
    const id = vIntId(req.params.templateId, "template id");
    const pool = getPool();
    const { rowCount } = await pool.query(
      `UPDATE mb_subitem_templates
          SET archived_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND archived_at IS NULL`,
      [id]
    );
    if (!rowCount) {
      return res.status(404).json({ error: "Template not found or already archived." });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("[mb] delete template", e);
    res.status(500).json({ error: "Could not archive template." });
  }
}

/**
 * PUT /mb/subitem-templates/:templateId/instructions/:section  (admin)
 *
 * Replaces a single section's content. The handler doesn't validate
 * the inner JSON shape (the spec acknowledges this is application-layer
 * validation) beyond requiring an object.
 */
export async function setTemplateInstructionSection(req, res) {
  if (!requireAdminRoleRes(req, res)) return;
  try {
    const id = vIntId(req.params.templateId, "template id");
    const section = String(req.params.section ?? "");
    if (!SECTION_KEYS.has(section)) {
      return res.status(400).json({ error: "Unknown instruction section." });
    }
    const content = vJson(req.body, "content", { requireObject: true, allowNull: false });
    const pool = getPool();
    const { rowCount } = await pool.query(
      `UPDATE mb_subitem_templates
          SET instructions = COALESCE(instructions, '{}'::jsonb)
                            || jsonb_build_object($1::text, $2::jsonb),
              updated_at = NOW()
        WHERE id = $3`,
      [section, JSON.stringify(content), id]
    );
    if (!rowCount) return res.status(404).json({ error: "Template not found." });
    res.json({ ok: true });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] set template instructions section", e);
    res.status(500).json({ error: "Could not save section." });
  }
}

// ============================================================
// Variable resolution
// ============================================================

/**
 * GET /mb/subitems/:id/variables
 *
 * Returns a map of variable name → resolved value for both
 * `{{subitem.X}}` and `{{item.X}}` substitution. The client uses this
 * to render the email/SMS template previews and to power the variable
 * picker.
 *
 *   {
 *     subitem: { column_key: resolved_value, ... },
 *     item:    { column_key: resolved_value, ... },
 *     subitem_columns: [{ key, name, type }],
 *     item_columns:    [{ key, name, type }],
 *   }
 *
 * For status/dropdown columns we return the OPTION LABEL (not the
 * stable `value`) so the preview reads naturally.
 */
export async function getSubitemVariables(req, res) {
  try {
    const id = vIntId(req.params.id, "subitem id");
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT s.id, s.board_id, s.parent_item_id, s.values AS subitem_values,
              p.values AS parent_values
         FROM mb_items s
         JOIN mb_items p ON p.id = s.parent_item_id
        WHERE s.id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Subitem not found." });
    const row = rows[0];
    const { rows: columns } = await pool.query(
      `SELECT key, name, column_type, config
         FROM mb_board_columns
        WHERE board_id = $1 AND archived_at IS NULL
        ORDER BY position ASC`,
      [row.board_id]
    );

    function resolveAgainst(values) {
      const out = {};
      for (const c of columns) {
        const raw = values?.[c.key];
        out[c.key] = humanize(c, raw);
      }
      return out;
    }
    function humanize(col, raw) {
      if (raw == null || raw === "") return "";
      if (col.column_type === "status" || col.column_type === "dropdown") {
        const cfg = typeof col.config === "string" ? JSON.parse(col.config) : col.config || {};
        const opts = Array.isArray(cfg.options) ? cfg.options : [];
        const match = opts.find((o) => String(o.value) === String(raw));
        return match ? match.label : String(raw);
      }
      return typeof raw === "object" ? JSON.stringify(raw) : String(raw);
    }
    const summary = columns.map((c) => ({ key: c.key, name: c.name, type: c.column_type }));
    res.json({
      subitem: resolveAgainst(row.subitem_values ?? {}),
      item: resolveAgainst(row.parent_values ?? {}),
      subitem_columns: summary,
      item_columns: summary,
    });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] get subitem variables", e);
    res.status(500).json({ error: "Could not load variables." });
  }
}

// ============================================================
// Checklist state
// ============================================================

export async function getChecklistState(req, res) {
  try {
    const id = vIntId(req.params.id, "subitem id");
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT checklist_item_id, is_checked, checked_by, checked_at
         FROM mb_subitem_checklist_state
        WHERE subitem_item_id = $1`,
      [id]
    );
    const state = {};
    for (const r of rows) state[r.checklist_item_id] = r;
    res.json({ state });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] checklist state", e);
    res.status(500).json({ error: "Could not load checklist." });
  }
}

export async function toggleChecklistItem(req, res) {
  try {
    const id = vIntId(req.params.id, "subitem id");
    const checklistItemId = String(req.params.checklistItemId ?? "").slice(0, 100);
    if (!checklistItemId) {
      return res.status(400).json({ error: "checklist_item_id required." });
    }
    const isChecked = vBool(req.body?.is_checked, { allowNull: false });
    const pool = getPool();
    if (isChecked) {
      await pool.query(
        `INSERT INTO mb_subitem_checklist_state
           (subitem_item_id, checklist_item_id, is_checked, checked_by, checked_at)
         VALUES ($1, $2, TRUE, $3, NOW())
         ON CONFLICT (subitem_item_id, checklist_item_id)
         DO UPDATE SET is_checked = TRUE, checked_by = $3, checked_at = NOW()`,
        [id, checklistItemId, req.user.id]
      );
    } else {
      await pool.query(
        `INSERT INTO mb_subitem_checklist_state
           (subitem_item_id, checklist_item_id, is_checked)
         VALUES ($1, $2, FALSE)
         ON CONFLICT (subitem_item_id, checklist_item_id)
         DO UPDATE SET is_checked = FALSE, checked_by = NULL, checked_at = NULL`,
        [id, checklistItemId]
      );
    }
    res.json({ ok: true });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] toggle checklist item", e);
    res.status(500).json({ error: "Could not update checklist." });
  }
}
