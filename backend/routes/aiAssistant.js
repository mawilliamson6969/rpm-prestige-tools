import { askAI, isAiConfigured } from "../lib/ai-provider.js";
import {
  AI_TOOLS,
  BRAND_VOICE,
  getBuiltInTool,
  resolveToolProvider,
  toolPublicView,
  formatUserMessage,
} from "../lib/ai-tools.js";
import { getPool } from "../lib/db.js";

/* ---------- helpers --------------------------------------------------- */

function notConfigured(res) {
  res.status(503).json({
    error: "AI assistant is not configured. Contact your administrator.",
    code: "AI_NOT_CONFIGURED",
  });
}

function badRequest(res, msg) {
  res.status(400).json({ error: msg, code: "BAD_REQUEST" });
}

function templateRowToObject(row) {
  return {
    id: `template:${row.id}`,
    templateId: row.id,
    ownerId: row.owner_id,
    name: row.name,
    icon: row.icon,
    description: row.description,
    builtIn: false,
    isShared: row.is_shared,
    systemPrompt: row.system_prompt,
    inputs: Array.isArray(row.inputs) ? row.inputs : [],
    createdAt: row.created_at,
  };
}

async function loadTemplateById(templateId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, owner_id, name, icon, description, system_prompt, inputs, is_shared, created_at
     FROM ai_templates WHERE id = $1`,
    [templateId]
  );
  return rows[0] ? templateRowToObject(rows[0]) : null;
}

/**
 * Accepts either:
 *   - a built-in tool id ("draft-notice")
 *   - a saved-template id ("template:42")
 */
async function resolveToolOrTemplate(idOrKey, userId, userRole) {
  if (typeof idOrKey !== "string" || !idOrKey.trim()) return null;
  if (idOrKey.startsWith("template:")) {
    const tid = Number(idOrKey.slice("template:".length));
    if (!Number.isFinite(tid)) return null;
    const t = await loadTemplateById(tid);
    if (!t) return null;
    const canSee = t.isShared || t.ownerId === userId || userRole === "admin";
    return canSee ? t : null;
  }
  return getBuiltInTool(idOrKey) || null;
}

/* ---------- GET /tools ------------------------------------------------- */

export async function getTools(req, res) {
  res.json({
    tools: AI_TOOLS.map(toolPublicView),
    brandVoiceConfigured: Boolean(BRAND_VOICE),
    aiConfigured: isAiConfigured(),
  });
}

/* ---------- POST /generate -------------------------------------------- */

/**
 * SSE-streamed AI generation. The provider layer's first-token failover
 * means: if Anthropic 5xx/429/timeout/conn-error BEFORE the first token,
 * we transparently switch to OpenAI. Mid-stream failures append a single
 * "[connection interrupted — please regenerate]" chunk.
 */
export async function postGenerate(req, res) {
  if (!isAiConfigured()) return notConfigured(res);

  const { toolId, inputs } = req.body || {};
  if (!toolId) return badRequest(res, "toolId is required.");
  if (inputs != null && typeof inputs !== "object") {
    return badRequest(res, "inputs must be an object of { key: value }.");
  }

  const tool = await resolveToolOrTemplate(toolId, req.user.id, req.user.role);
  if (!tool) {
    res.status(404).json({ error: "Tool or template not found.", code: "NOT_FOUND" });
    return;
  }

  // required-field check
  for (const def of tool.inputs || []) {
    if (def.required) {
      const v = inputs?.[def.key];
      if (v == null || String(v).trim() === "") {
        return badRequest(res, `Missing required field: ${def.label || def.key}`);
      }
    }
  }

  const systemPrompt = `${BRAND_VOICE}\n\n${tool.systemPrompt}`.trim();
  const userMessage = formatUserMessage(tool, inputs || {});
  if (!userMessage) return badRequest(res, "At least one input value is required.");

  const { provider, model } = resolveToolProvider(tool);

  // Set up SSE
  res.setHeader("content-type", "text/event-stream");
  res.setHeader("cache-control", "no-cache, no-transform");
  res.setHeader("connection", "keep-alive");
  res.setHeader("x-accel-buffering", "no"); // nginx: stream don't buffer
  res.flushHeaders?.();

  const writeEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  let started = false;
  try {
    const { provider: usedProvider, model: usedModel, stream } = await askAI({
      provider,
      model,
      feature: tool.builtIn ? `assistant:${tool.id}` : `template:${tool.templateId}`,
      systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      stream: true,
    });

    writeEvent("meta", { provider: usedProvider, model: usedModel });
    started = true;

    for await (const chunk of stream) {
      if (!chunk) continue;
      writeEvent("token", { text: chunk });
    }
    writeEvent("done", { ok: true });
  } catch (err) {
    if (!started) {
      const status = err.status || 502;
      // Non-failover errors (400/401/403) bubble up unchanged from provider.
      const code =
        status === 401 || status === 403
          ? "AI_AUTH_ERROR"
          : status === 400
          ? "AI_BAD_REQUEST"
          : "AI_GENERATE_FAILED";
      writeEvent("error", { code, message: err.message || "AI request failed." });
    } else {
      // Connection died after some tokens — let the client know cleanly.
      writeEvent("error", {
        code: "STREAM_INTERRUPTED",
        message: "Connection interrupted — please regenerate.",
      });
    }
    console.error("[ai-assistant/generate]", err);
  } finally {
    try {
      res.end();
    } catch {}
  }
}

/* ---------- Templates CRUD -------------------------------------------- */

/** GET /templates  — returns the caller's personal + all shared templates. */
export async function getTemplates(req, res) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, owner_id, name, icon, description, system_prompt, inputs, is_shared, created_at
     FROM ai_templates
     WHERE owner_id = $1 OR is_shared = TRUE
     ORDER BY is_shared ASC, created_at DESC`,
    [req.user.id]
  );
  res.json({ templates: rows.map(templateRowToObject) });
}

function validateTemplatePayload(body) {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const systemPrompt = typeof body?.systemPrompt === "string" ? body.systemPrompt.trim() : "";
  if (!name) return { error: "Template name is required." };
  if (!systemPrompt) return { error: "Template instructions are required." };
  const icon = typeof body?.icon === "string" ? body.icon.trim().slice(0, 64) : null;
  const description =
    typeof body?.description === "string" ? body.description.trim().slice(0, 500) : null;
  const inputs = Array.isArray(body?.inputs) ? body.inputs.slice(0, 12) : [];
  for (const i of inputs) {
    if (!i || typeof i !== "object") return { error: "Invalid input definition." };
    if (typeof i.key !== "string" || !/^[a-z0-9_]+$/i.test(i.key)) {
      return { error: `Input key must be a-z, 0-9, underscore (got: ${i.key}).` };
    }
    if (typeof i.label !== "string" || !i.label.trim()) {
      return { error: `Input "${i.key}" is missing a label.` };
    }
    if (i.type && !["text", "textarea", "select"].includes(i.type)) {
      return { error: `Input "${i.key}" has an invalid type.` };
    }
  }
  return {
    value: {
      name: name.slice(0, 160),
      icon: icon || "Bookmark",
      description,
      systemPrompt,
      inputs,
    },
  };
}

/** POST /templates  — create a personal template. */
export async function postTemplate(req, res) {
  const v = validateTemplatePayload(req.body);
  if (v.error) return badRequest(res, v.error);
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO ai_templates (owner_id, name, icon, description, system_prompt, inputs)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING id, owner_id, name, icon, description, system_prompt, inputs, is_shared, created_at`,
    [
      req.user.id,
      v.value.name,
      v.value.icon,
      v.value.description,
      v.value.systemPrompt,
      JSON.stringify(v.value.inputs),
    ]
  );
  res.status(201).json({ template: templateRowToObject(rows[0]) });
}

/** PUT /templates/:id  — owner edits; admins can also flip is_shared. */
export async function putTemplate(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return badRequest(res, "Invalid template id.");
  const pool = getPool();
  const { rows: existing } = await pool.query(
    `SELECT owner_id FROM ai_templates WHERE id = $1`,
    [id]
  );
  if (!existing[0]) {
    res.status(404).json({ error: "Template not found.", code: "NOT_FOUND" });
    return;
  }
  const isOwner = existing[0].owner_id === req.user.id;
  const isAdmin = req.user.role === "admin";
  if (!isOwner && !isAdmin) {
    res.status(403).json({ error: "Not allowed.", code: "FORBIDDEN" });
    return;
  }

  // Admin-only is_shared toggle
  if (typeof req.body?.isShared === "boolean" && isAdmin) {
    const { rows } = await pool.query(
      `UPDATE ai_templates
       SET is_shared = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING id, owner_id, name, icon, description, system_prompt, inputs, is_shared, created_at`,
      [id, req.body.isShared]
    );
    res.json({ template: templateRowToObject(rows[0]) });
    return;
  }

  // Owner-edit path
  if (!isOwner) {
    res.status(403).json({ error: "Only the owner can edit template content.", code: "FORBIDDEN" });
    return;
  }
  const v = validateTemplatePayload(req.body);
  if (v.error) return badRequest(res, v.error);
  const { rows } = await pool.query(
    `UPDATE ai_templates
     SET name = $2, icon = $3, description = $4, system_prompt = $5, inputs = $6::jsonb, updated_at = NOW()
     WHERE id = $1
     RETURNING id, owner_id, name, icon, description, system_prompt, inputs, is_shared, created_at`,
    [
      id,
      v.value.name,
      v.value.icon,
      v.value.description,
      v.value.systemPrompt,
      JSON.stringify(v.value.inputs),
    ]
  );
  res.json({ template: templateRowToObject(rows[0]) });
}

/** DELETE /templates/:id  — owner or admin. */
export async function deleteTemplate(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return badRequest(res, "Invalid template id.");
  const pool = getPool();
  const { rows: existing } = await pool.query(
    `SELECT owner_id FROM ai_templates WHERE id = $1`,
    [id]
  );
  if (!existing[0]) {
    res.status(404).json({ error: "Template not found.", code: "NOT_FOUND" });
    return;
  }
  if (existing[0].owner_id !== req.user.id && req.user.role !== "admin") {
    res.status(403).json({ error: "Not allowed.", code: "FORBIDDEN" });
    return;
  }
  await pool.query(`DELETE FROM ai_templates WHERE id = $1`, [id]);
  res.json({ ok: true });
}
