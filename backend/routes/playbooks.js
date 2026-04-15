import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import multer from "multer";
import { getPool } from "../lib/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const playbookUploadRoot = path.join(__dirname, "..", "uploads", "playbooks");

function slugify(raw) {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
  return s || "untitled";
}

function diffStats(prev, next) {
  const a = prev ?? "";
  const b = next ?? "";
  let i = 0;
  const maxI = Math.min(a.length, b.length);
  while (i < maxI && a[i] === b[i]) i++;
  let ei = a.length - 1;
  let ej = b.length - 1;
  while (ei >= i && ej >= i && a[ei] === b[ej]) {
    ei--;
    ej--;
  }
  const removed = Math.max(0, ei - i + 1);
  const added = Math.max(0, ej - i + 1);
  return { added, removed };
}

async function uniqueCategorySlug(pool, base, excludeId = null) {
  let slug = base;
  let n = 2;
  for (;;) {
    const q = excludeId
      ? `SELECT id FROM playbook_categories WHERE slug = $1 AND id <> $2`
      : `SELECT id FROM playbook_categories WHERE slug = $1`;
    const params = excludeId ? [slug, excludeId] : [slug];
    const { rows } = await pool.query(q, params);
    if (!rows.length) return slug;
    slug = `${base}-${n++}`;
  }
}

async function uniquePageSlug(pool, categoryId, base, excludeId = null) {
  let slug = base;
  let n = 2;
  for (;;) {
    const q = excludeId
      ? `SELECT id FROM playbook_pages WHERE category_id = $1 AND slug = $2 AND id <> $3`
      : `SELECT id FROM playbook_pages WHERE category_id = $1 AND slug = $2`;
    const params = excludeId ? [categoryId, slug, excludeId] : [categoryId, slug];
    const { rows } = await pool.query(q, params);
    if (!rows.length) return slug;
    slug = `${base}-${n++}`;
  }
}

function playbookPageUploadDir(pageId) {
  const dir = path.join(playbookUploadRoot, String(pageId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const playbookUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        cb(new Error("Invalid page id"));
        return;
      }
      try {
        cb(null, playbookPageUploadDir(id));
      } catch (e) {
        cb(e);
      }
    },
    filename: (_req, file, cb) => {
      const safe = path.basename(file.originalname || "file").replace(/[^\w.\-()+ ]/g, "_");
      cb(null, `${randomUUID()}-${safe || "file"}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

export function playbookUploadMiddleware(req, res, next) {
  playbookUpload.single("file")(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(400).json({ error: "File too large (max 25MB)." });
        return;
      }
      res.status(400).json({ error: err.message || "Upload failed." });
      return;
    }
    next();
  });
}

export async function getPlaybookCategories(req, res) {
  try {
    const p = getPool();
    const { rows: cats } = await p.query(
      `SELECT c.id, c.name, c.slug, c.description, c.icon, c.display_order, c.created_at,
              COUNT(w.id)::int AS page_count
       FROM playbook_categories c
       LEFT JOIN playbook_pages w ON w.category_id = c.id
       GROUP BY c.id
       ORDER BY c.display_order ASC, c.name ASC`
    );
    const { rows: tc } = await p.query(`SELECT COUNT(*)::int AS c FROM playbook_pages`);
    const { rows: recent } = await p.query(
      `SELECT w.id, w.title, w.slug, w.updated_at, w.status,
              c.name AS category_name, c.slug AS category_slug,
              eu.display_name AS last_edited_by_name
       FROM playbook_pages w
       JOIN playbook_categories c ON c.id = w.category_id
       LEFT JOIN users eu ON eu.id = w.last_edited_by
       ORDER BY w.updated_at DESC
       LIMIT 10`
    );
    res.json({ categories: cats, totalPages: tc[0]?.c ?? 0, recentPages: recent });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load playbook categories." });
  }
}

export async function postPlaybookCategory(req, res) {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const description =
    typeof req.body?.description === "string" ? req.body.description.trim() : null;
  const icon = typeof req.body?.icon === "string" ? req.body.icon.trim().slice(0, 50) : "📁";
  if (!name) {
    res.status(400).json({ error: "name is required." });
    return;
  }
  try {
    const p = getPool();
    const base = slugify(name);
    const slug = await uniqueCategorySlug(p, base);
    const { rows } = await p.query(
      `INSERT INTO playbook_categories (name, slug, description, icon, created_by, display_order)
       VALUES ($1, $2, $3, $4, $5,
         (SELECT COALESCE(MAX(display_order), -1) + 1 FROM playbook_categories))
       RETURNING id, name, slug, description, icon, display_order, created_at`,
      [name, slug, description || null, icon || "📁", req.user.id]
    );
    res.status(201).json({ category: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not create category." });
  }
}

export async function putPlaybookCategory(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Invalid category id." });
    return;
  }
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const description =
    typeof req.body?.description === "string" ? req.body.description.trim() : undefined;
  const icon = typeof req.body?.icon === "string" ? req.body.icon.trim().slice(0, 50) : undefined;
  if (!name) {
    res.status(400).json({ error: "name is required." });
    return;
  }
  try {
    const p = getPool();
    const base = slugify(name);
    const slug = await uniqueCategorySlug(p, base, id);
    const { rows } = await p.query(
      `UPDATE playbook_categories
       SET name = $1, slug = $2,
           description = COALESCE($3, description),
           icon = COALESCE($4, icon)
       WHERE id = $5
       RETURNING id, name, slug, description, icon, display_order, created_at`,
      [name, slug, description ?? null, icon ?? null, id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Category not found." });
      return;
    }
    res.json({ category: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update category." });
  }
}

export async function deletePlaybookCategory(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Invalid category id." });
    return;
  }
  try {
    const p = getPool();
    const { rows: cnt } = await p.query(`SELECT COUNT(*)::int AS c FROM playbook_pages WHERE category_id = $1`, [id]);
    if ((cnt[0]?.c ?? 0) > 0) {
      res.status(400).json({ error: "Category still has pages; delete or move them first." });
      return;
    }
    const { rowCount } = await p.query(`DELETE FROM playbook_categories WHERE id = $1`, [id]);
    if (!rowCount) {
      res.status(404).json({ error: "Category not found." });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete category." });
  }
}

export async function getPlaybookPages(req, res) {
  const categoryId = req.query.categoryId != null ? Number(req.query.categoryId) : null;
  const categorySlug = typeof req.query.categorySlug === "string" ? req.query.categorySlug.trim() : "";
  const pageSlug = typeof req.query.pageSlug === "string" ? req.query.pageSlug.trim() : "";
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
  try {
    const p = getPool();
    let catId = Number.isFinite(categoryId) && categoryId > 0 ? categoryId : null;
    if (!catId && categorySlug) {
      const { rows: cr } = await p.query(`SELECT id FROM playbook_categories WHERE slug = $1`, [categorySlug]);
      catId = cr[0]?.id ?? null;
    }
    const params = [];
    const where = [];
    let i = 1;
    if (catId) {
      where.push(`w.category_id = $${i++}`);
      params.push(catId);
    }
    if (pageSlug) {
      where.push(`w.slug = $${i++}`);
      params.push(pageSlug);
    }
    if (search) {
      where.push(`(w.title ILIKE $${i} OR w.content_markdown ILIKE $${i})`);
      params.push(`%${search.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`);
      i++;
    }
    if (status === "published" || status === "draft") {
      where.push(`w.status = $${i++}`);
      params.push(status);
    }
    const sql = `
      SELECT w.id, w.category_id, w.title, w.slug, w.status, w.is_pinned, w.display_order,
             w.created_at, w.updated_at,
             c.slug AS category_slug, c.name AS category_name,
             cu.display_name AS created_by_name,
             eu.display_name AS last_edited_by_name
      FROM playbook_pages w
      JOIN playbook_categories c ON c.id = w.category_id
      LEFT JOIN users cu ON cu.id = w.created_by
      LEFT JOIN users eu ON eu.id = w.last_edited_by
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY w.is_pinned DESC, w.display_order ASC, w.updated_at DESC
    `;
    const { rows } = await p.query(sql, params);
    res.json({ pages: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load playbook pages." });
  }
}

export async function getPlaybookPage(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Invalid page id." });
    return;
  }
  try {
    const p = getPool();
    const { rows } = await p.query(
      `SELECT w.*, c.slug AS category_slug, c.name AS category_name,
              cu.display_name AS created_by_name,
              eu.display_name AS last_edited_by_name,
              (SELECT MAX(version_number)::int FROM playbook_page_versions v WHERE v.page_id = w.id) AS current_version
       FROM playbook_pages w
       JOIN playbook_categories c ON c.id = w.category_id
       LEFT JOIN users cu ON cu.id = w.created_by
       LEFT JOIN users eu ON eu.id = w.last_edited_by
       WHERE w.id = $1`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Page not found." });
      return;
    }
    const { rows: atts } = await p.query(
      `SELECT a.id, a.filename, a.file_size_bytes, a.mime_type, a.created_at, a.uploaded_by,
              u.display_name AS uploaded_by_name
       FROM playbook_attachments a
       LEFT JOIN users u ON u.id = a.uploaded_by
       WHERE a.page_id = $1
       ORDER BY a.created_at DESC`,
      [id]
    );
    res.json({ page: rows[0], attachments: atts });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load page." });
  }
}

export async function postPlaybookPage(req, res) {
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const categoryId = Number(req.body?.categoryId);
  const contentMarkdown =
    typeof req.body?.contentMarkdown === "string" ? req.body.contentMarkdown : "";
  const statusRaw = typeof req.body?.status === "string" ? req.body.status.trim().toLowerCase() : "published";
  const status = statusRaw === "draft" ? "draft" : "published";
  if (!title || !Number.isFinite(categoryId) || categoryId <= 0) {
    res.status(400).json({ error: "title and categoryId are required." });
    return;
  }
  try {
    const p = getPool();
    const { rows: cat } = await p.query(`SELECT id FROM playbook_categories WHERE id = $1`, [categoryId]);
    if (!cat.length) {
      res.status(400).json({ error: "Invalid category." });
      return;
    }
    const baseSlug = slugify(title);
    const slug = await uniquePageSlug(p, categoryId, baseSlug);
    const { rows } = await p.query(
      `INSERT INTO playbook_pages (
         category_id, title, slug, content_markdown, status,
         created_by, last_edited_by, display_order
       )
       VALUES (
         $1, $2, $3, $4, $5,
         $6, $6,
         (SELECT COALESCE(MAX(display_order), -1) + 1 FROM playbook_pages WHERE category_id = $1)
       )
       RETURNING *`,
      [categoryId, title, slug, contentMarkdown, status, req.user.id]
    );
    const page = rows[0];
    await p.query(
      `INSERT INTO playbook_page_versions (page_id, version_number, title, content_markdown, change_summary, edited_by)
       VALUES ($1, 1, $2, $3, $4, $5)`,
      [page.id, title, contentMarkdown, "Initial version", req.user.id]
    );
    res.status(201).json({ page });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not create page." });
  }
}

export async function putPlaybookPage(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Invalid page id." });
    return;
  }
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const contentMarkdown =
    typeof req.body?.contentMarkdown === "string" ? req.body.contentMarkdown : "";
  const changeSummary =
    typeof req.body?.changeSummary === "string" ? req.body.changeSummary.trim() : "";
  const statusRaw = typeof req.body?.status === "string" ? req.body.status.trim().toLowerCase() : "";
  if (!title) {
    res.status(400).json({ error: "title is required." });
    return;
  }
  if (!changeSummary) {
    res.status(400).json({ error: "changeSummary is required when editing a page." });
    return;
  }
  const status =
    statusRaw === "draft" ? "draft" : statusRaw === "published" ? "published" : null;
  try {
    const p = getPool();
    const { rows: cur } = await p.query(
      `SELECT id, category_id, title, slug, content_markdown, status FROM playbook_pages WHERE id = $1`,
      [id]
    );
    if (!cur.length) {
      res.status(404).json({ error: "Page not found." });
      return;
    }
    const row = cur[0];
    const nextStatus = status ?? row.status;
    const baseSlug = slugify(title);
    const slug =
      title === row.title && row.slug
        ? row.slug
        : await uniquePageSlug(p, row.category_id, baseSlug, id);
    const { rows: vmax } = await p.query(
      `SELECT COALESCE(MAX(version_number), 0)::int AS m FROM playbook_page_versions WHERE page_id = $1`,
      [id]
    );
    const nextVer = (vmax[0]?.m ?? 0) + 1;
    await p.query(
      `INSERT INTO playbook_page_versions (page_id, version_number, title, content_markdown, change_summary, edited_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, nextVer, title, contentMarkdown, changeSummary.slice(0, 255), req.user.id]
    );
    const { rows } = await p.query(
      `UPDATE playbook_pages
       SET title = $1, slug = $2, content_markdown = $3, status = $4,
           last_edited_by = $5, updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [title, slug, contentMarkdown, nextStatus, req.user.id, id]
    );
    res.json({ page: rows[0], versionNumber: nextVer });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update page." });
  }
}

export async function deletePlaybookPage(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Invalid page id." });
    return;
  }
  try {
    const p = getPool();
    const { rows } = await p.query(`SELECT id, created_by FROM playbook_pages WHERE id = $1`, [id]);
    if (!rows.length) {
      res.status(404).json({ error: "Page not found." });
      return;
    }
    const createdBy = rows[0].created_by;
    if (req.user.role !== "admin" && createdBy !== req.user.id) {
      res.status(403).json({ error: "You may only delete pages you created (or be an admin)." });
      return;
    }
    const dir = path.join(playbookUploadRoot, String(id));
    await p.query(`DELETE FROM playbook_pages WHERE id = $1`, [id]);
    fs.rmSync(dir, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete page." });
  }
}

export async function putPlaybookPagePin(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Invalid page id." });
    return;
  }
  try {
    const p = getPool();
    const { rows } = await p.query(
      `UPDATE playbook_pages SET is_pinned = NOT COALESCE(is_pinned, false), updated_at = NOW()
       WHERE id = $1
       RETURNING id, is_pinned`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Page not found." });
      return;
    }
    res.json({ isPinned: !!rows[0].is_pinned });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not toggle pin." });
  }
}

export async function putPlaybookPageReorder(req, res) {
  const id = Number(req.params.id);
  const displayOrder = Number(req.body?.displayOrder);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Invalid page id." });
    return;
  }
  if (!Number.isFinite(displayOrder)) {
    res.status(400).json({ error: "displayOrder is required." });
    return;
  }
  try {
    const p = getPool();
    const { rows } = await p.query(
      `UPDATE playbook_pages SET display_order = $1, updated_at = NOW() WHERE id = $2 RETURNING id, display_order`,
      [displayOrder, id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Page not found." });
      return;
    }
    res.json({ displayOrder: rows[0].display_order });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not reorder page." });
  }
}

export async function getPlaybookPageVersions(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Invalid page id." });
    return;
  }
  try {
    const p = getPool();
    const { rows: verRows } = await p.query(
      `SELECT v.id, v.version_number, v.title, v.change_summary, v.created_at,
              u.display_name AS edited_by_name,
              v.content_markdown
       FROM playbook_page_versions v
       LEFT JOIN users u ON u.id = v.edited_by
       WHERE v.page_id = $1
       ORDER BY v.version_number ASC`,
      [id]
    );
    const { rows: cur } = await p.query(
      `SELECT MAX(version_number)::int AS m FROM playbook_page_versions WHERE page_id = $1`,
      [id]
    );
    const currentVersion = cur[0]?.m ?? 0;
    const enriched = verRows.map((v, idx) => {
      const prev = idx > 0 ? verRows[idx - 1] : null;
      const stats = prev ? diffStats(prev.content_markdown, v.content_markdown) : { added: 0, removed: 0 };
      const { content_markdown: _c, ...rest } = v;
      return { ...rest, charsAdded: stats.added, charsRemoved: stats.removed, isCurrent: v.version_number === currentVersion };
    });
    res.json({ versions: enriched, currentVersion });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load versions." });
  }
}

export async function getPlaybookPageVersion(req, res) {
  const pageId = Number(req.params.id);
  const versionId = Number(req.params.versionId);
  if (!Number.isFinite(pageId) || pageId <= 0 || !Number.isFinite(versionId) || versionId <= 0) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  try {
    const p = getPool();
    const { rows } = await p.query(
      `SELECT v.*, u.display_name AS edited_by_name
       FROM playbook_page_versions v
       LEFT JOIN users u ON u.id = v.edited_by
       WHERE v.id = $1 AND v.page_id = $2`,
      [versionId, pageId]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Version not found." });
      return;
    }
    res.json({ version: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load version." });
  }
}

export async function postPlaybookRestoreVersion(req, res) {
  const pageId = Number(req.params.id);
  const versionId = Number(req.params.versionId);
  if (!Number.isFinite(pageId) || pageId <= 0 || !Number.isFinite(versionId) || versionId <= 0) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  try {
    const p = getPool();
    const { rows: vr } = await p.query(
      `SELECT version_number, title, content_markdown FROM playbook_page_versions WHERE id = $1 AND page_id = $2`,
      [versionId, pageId]
    );
    if (!vr.length) {
      res.status(404).json({ error: "Version not found." });
      return;
    }
    const snap = vr[0];
    const { rows: vmax } = await p.query(
      `SELECT COALESCE(MAX(version_number), 0)::int AS m FROM playbook_page_versions WHERE page_id = $1`,
      [pageId]
    );
    const nextVer = (vmax[0]?.m ?? 0) + 1;
    const summary = `Restored from version ${snap.version_number}`;
    await p.query(
      `INSERT INTO playbook_page_versions (page_id, version_number, title, content_markdown, change_summary, edited_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [pageId, nextVer, snap.title, snap.content_markdown, summary, req.user.id]
    );
    const { rows } = await p.query(
      `UPDATE playbook_pages
       SET title = $1, content_markdown = $2, last_edited_by = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [snap.title, snap.content_markdown, req.user.id, pageId]
    );
    res.json({ page: rows[0], versionNumber: nextVer });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not restore version." });
  }
}

export async function postPlaybookAttachment(req, res) {
  const pageId = Number(req.params.id);
  if (!Number.isFinite(pageId) || pageId <= 0) {
    res.status(400).json({ error: "Invalid page id." });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "No file received." });
    return;
  }
  try {
    const p = getPool();
    const { rows } = await p.query(`SELECT id FROM playbook_pages WHERE id = $1`, [pageId]);
    if (!rows.length) {
      fs.unlinkSync(req.file.path);
      res.status(404).json({ error: "Page not found." });
      return;
    }
    const { rows: ins } = await p.query(
      `INSERT INTO playbook_attachments (page_id, filename, stored_filename, file_size_bytes, mime_type, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, filename, file_size_bytes, mime_type, created_at`,
      [
        pageId,
        req.file.originalname || req.file.filename,
        req.file.filename,
        req.file.size,
        req.file.mimetype || null,
        req.user.id,
      ]
    );
    res.status(201).json({ attachment: ins[0] });
  } catch (e) {
    console.error(e);
    if (req.file?.path) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: "Could not save attachment." });
  }
}

export async function getPlaybookAttachment(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Invalid attachment id." });
    return;
  }
  try {
    const p = getPool();
    const { rows } = await p.query(
      `SELECT a.*, w.id AS page_id FROM playbook_attachments a JOIN playbook_pages w ON w.id = a.page_id WHERE a.id = $1`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Attachment not found." });
      return;
    }
    const row = rows[0];
    const abs = path.join(playbookUploadRoot, String(row.page_id), row.stored_filename);
    if (!fs.existsSync(abs)) {
      res.status(404).json({ error: "File missing on disk." });
      return;
    }
    res.setHeader("Content-Type", row.mime_type || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(row.filename)}"`);
    fs.createReadStream(abs).pipe(res);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not download attachment." });
  }
}

export async function deletePlaybookAttachment(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Invalid attachment id." });
    return;
  }
  try {
    const p = getPool();
    const { rows } = await p.query(
      `SELECT a.id, a.page_id, a.stored_filename, a.filename, a.uploaded_by
       FROM playbook_attachments a WHERE a.id = $1`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Attachment not found." });
      return;
    }
    const row = rows[0];
    if (req.user.role !== "admin" && row.uploaded_by !== req.user.id) {
      res.status(403).json({ error: "You may only delete attachments you uploaded (or be an admin)." });
      return;
    }
    const abs = path.join(playbookUploadRoot, String(row.page_id), row.stored_filename);
    await p.query(`DELETE FROM playbook_attachments WHERE id = $1`, [id]);
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete attachment." });
  }
}

function searchSnippet(haystack, term, maxLen = 200) {
  const h = haystack ?? "";
  const t = (term ?? "").trim();
  if (!t) return h.slice(0, maxLen) + (h.length > maxLen ? "…" : "");
  const lower = h.toLowerCase();
  const idx = lower.indexOf(t.toLowerCase());
  if (idx < 0) return h.slice(0, maxLen) + (h.length > maxLen ? "…" : "");
  const half = Math.floor(maxLen / 2);
  let start = Math.max(0, idx - half);
  let end = Math.min(h.length, start + maxLen);
  if (end - start < maxLen) start = Math.max(0, end - maxLen);
  let s = h.slice(start, end);
  if (start > 0) s = `…${s}`;
  if (end < h.length) s = `${s}…`;
  return s;
}

export async function getPlaybookSearch(req, res) {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q || q.length > 200) {
    res.status(400).json({ error: "Query q is required (max 200 chars)." });
    return;
  }
  try {
    const pool = getPool();
    const like = `%${q.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
    const { rows } = await pool.query(
      `SELECT w.id, w.title, w.slug, w.updated_at, w.content_markdown,
              c.name AS category_name, c.slug AS category_slug
       FROM playbook_pages w
       JOIN playbook_categories c ON c.id = w.category_id
       WHERE w.title ILIKE $1 OR w.content_markdown ILIKE $1
       ORDER BY w.updated_at DESC
       LIMIT 50`,
      [like]
    );
    const results = rows.map((r) => ({
      id: r.id,
      title: r.title,
      slug: r.slug,
      categoryName: r.category_name,
      categorySlug: r.category_slug,
      snippet: searchSnippet(r.content_markdown, q),
      updatedAt: r.updated_at,
    }));
    res.json({ results });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Search failed." });
  }
}
