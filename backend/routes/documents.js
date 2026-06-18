import Anthropic from "@anthropic-ai/sdk";
import { getPool } from "../lib/db.js";

const AI_MODEL = "claude-sonnet-4-5";

const AI_SYSTEM_PROMPT =
  "You are a helpful assistant for Real Property Management Prestige in Houston, TX. " +
  "Help improve, expand, or rewrite this property management document. " +
  "Return only the improved document content as clean HTML.";

function rowToDoc(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    content: row.content ?? "",
    folder: row.folder ?? "General",
    tags: Array.isArray(row.tags) ? row.tags : [],
    owner: row.owner ?? "",
    pinned: !!row.pinned,
    archived: !!row.archived,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseTags(input) {
  if (Array.isArray(input)) {
    return input.map((t) => String(t ?? "").trim()).filter(Boolean);
  }
  if (typeof input === "string") {
    return input
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

function parseBool(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v === "true" || v === "1";
  if (typeof v === "number") return v === 1;
  return false;
}

export async function getDocuments(req, res) {
  try {
    const pool = getPool();
    const { folder, owner, search, archived } = req.query;

    const where = [];
    const params = [];

    if (typeof archived === "string") {
      params.push(parseBool(archived));
      where.push(`archived = $${params.length}`);
    } else {
      where.push(`archived = false`);
    }

    if (typeof folder === "string" && folder.trim()) {
      params.push(folder.trim());
      where.push(`folder = $${params.length}`);
    }

    if (typeof owner === "string" && owner.trim()) {
      params.push(owner.trim());
      where.push(`owner = $${params.length}`);
    }

    if (typeof search === "string" && search.trim()) {
      params.push(`%${search.trim()}%`);
      const idx = params.length;
      where.push(`(title ILIKE $${idx} OR content ILIKE $${idx})`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const sql = `
      SELECT id, title, content, folder, tags, owner, pinned, archived, created_at, updated_at
      FROM documents
      ${whereSql}
      ORDER BY pinned DESC, updated_at DESC
      LIMIT 500
    `;
    const { rows } = await pool.query(sql, params);
    res.json({ documents: rows.map(rowToDoc) });
  } catch (e) {
    console.error("[documents] list", e);
    res.status(500).json({ error: "Could not load documents." });
  }
}

export async function getDocumentById(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  try {
    const { rows } = await getPool().query(
      `SELECT id, title, content, folder, tags, owner, pinned, archived, created_at, updated_at
       FROM documents WHERE id = $1`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    res.json({ document: rowToDoc(rows[0]) });
  } catch (e) {
    console.error("[documents] get", e);
    res.status(500).json({ error: "Could not load document." });
  }
}

export async function postDocument(req, res) {
  try {
    const body = req.body ?? {};
    const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "Untitled Document";
    const content = typeof body.content === "string" ? body.content : "";
    const folder = typeof body.folder === "string" && body.folder.trim() ? body.folder.trim() : "General";
    const owner =
      typeof body.owner === "string" && body.owner.trim()
        ? body.owner.trim()
        : req.user?.displayName || req.user?.username || "Unknown";
    const tags = parseTags(body.tags);
    const pinned = parseBool(body.pinned);

    const { rows } = await getPool().query(
      `INSERT INTO documents (title, content, folder, tags, owner, pinned)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, title, content, folder, tags, owner, pinned, archived, created_at, updated_at`,
      [title, content, folder, tags, owner, pinned]
    );
    res.status(201).json({ document: rowToDoc(rows[0]) });
  } catch (e) {
    console.error("[documents] create", e);
    res.status(500).json({ error: "Could not create document." });
  }
}

export async function putDocument(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  try {
    const body = req.body ?? {};
    const sets = [];
    const params = [];

    if (typeof body.title === "string") {
      params.push(body.title.trim() || "Untitled Document");
      sets.push(`title = $${params.length}`);
    }
    if (typeof body.content === "string") {
      params.push(body.content);
      sets.push(`content = $${params.length}`);
    }
    if (typeof body.folder === "string") {
      params.push(body.folder.trim() || "General");
      sets.push(`folder = $${params.length}`);
    }
    if (typeof body.owner === "string") {
      params.push(body.owner.trim());
      sets.push(`owner = $${params.length}`);
    }
    if (Array.isArray(body.tags) || typeof body.tags === "string") {
      params.push(parseTags(body.tags));
      sets.push(`tags = $${params.length}`);
    }
    if (typeof body.pinned === "boolean" || typeof body.pinned === "string") {
      params.push(parseBool(body.pinned));
      sets.push(`pinned = $${params.length}`);
    }
    if (typeof body.archived === "boolean" || typeof body.archived === "string") {
      params.push(parseBool(body.archived));
      sets.push(`archived = $${params.length}`);
    }

    if (!sets.length) {
      res.status(400).json({ error: "No updatable fields supplied." });
      return;
    }

    params.push(id);
    const sql = `
      UPDATE documents SET ${sets.join(", ")}
      WHERE id = $${params.length}
      RETURNING id, title, content, folder, tags, owner, pinned, archived, created_at, updated_at
    `;
    const { rows } = await getPool().query(sql, params);
    if (!rows.length) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    res.json({ document: rowToDoc(rows[0]) });
  } catch (e) {
    console.error("[documents] update", e);
    res.status(500).json({ error: "Could not update document." });
  }
}

export async function deleteDocument(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  try {
    const { rowCount } = await getPool().query(`DELETE FROM documents WHERE id = $1`, [id]);
    if (!rowCount) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("[documents] delete", e);
    res.status(500).json({ error: "Could not delete document." });
  }
}

export async function postDocumentDuplicate(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows: src } = await pool.query(
      `SELECT title, content, folder, tags, owner FROM documents WHERE id = $1`,
      [id]
    );
    if (!src.length) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    const original = src[0];
    const { rows } = await pool.query(
      `INSERT INTO documents (title, content, folder, tags, owner)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, title, content, folder, tags, owner, pinned, archived, created_at, updated_at`,
      [`${original.title} (Copy)`, original.content, original.folder, original.tags, original.owner]
    );
    res.status(201).json({ document: rowToDoc(rows[0]) });
  } catch (e) {
    console.error("[documents] duplicate", e);
    res.status(500).json({ error: "Could not duplicate document." });
  }
}

export async function postDocumentAiAssist(req, res) {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    res.status(503).json({ error: "AI assistant is not configured.", code: "AI_NOT_CONFIGURED" });
    return;
  }
  const body = req.body ?? {};
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
  if (!content && !instruction) {
    res.status(400).json({ error: "Provide document content or an instruction." });
    return;
  }

  const userMessage = instruction
    ? `Document content (HTML):\n${content || "(empty document)"}\n\nUser instruction:\n${instruction}\n\nReturn only the updated document as clean HTML.`
    : `Document content (HTML):\n${content}\n\nImprove and polish this document. Return only the improved document as clean HTML.`;

  try {
    const anthropic = new Anthropic({ apiKey });
    const msg = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 4096,
      system: AI_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });
    const parts = [];
    for (const block of msg.content || []) {
      if (block.type === "text") parts.push(block.text);
    }
    let html = parts.join("\n").trim();
    const fence = /^```(?:html)?\s*([\s\S]*?)```\s*$/i.exec(html);
    if (fence) html = fence[1].trim();
    res.json({ content: html });
  } catch (e) {
    console.error("[documents] ai-assist", e);
    res.status(502).json({ error: "AI request failed." });
  }
}
