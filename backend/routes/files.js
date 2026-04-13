import Anthropic from "@anthropic-ai/sdk";
import { randomBytes, randomUUID } from "crypto";
import { createReadStream } from "fs";
import { promises as fs } from "fs";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { getPool } from "../lib/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_ROOT = path.join(__dirname, "..", "uploads", "files");
const MODEL = "claude-sonnet-4-20250514";
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_ANALYSIS_BYTES = 20 * 1024 * 1024;

function frontendOrigin() {
  return (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");
}

function sharePublicBase() {
  return `${frontendOrigin()}/files/shared`;
}

function sanitizeSearchFragment(q) {
  return String(q || "")
    .trim()
    .slice(0, 200)
    .replace(/%/g, "")
    .replace(/_/g, "");
}

function fileTypeFromMime(mime, originalFilename) {
  const m = String(mime || "").toLowerCase();
  const ext = path.extname(originalFilename || "").toLowerCase();
  if (m === "application/pdf" || ext === ".pdf") return "pdf";
  if (m.startsWith("image/")) return "image";
  if (
    m.includes("word") ||
    m === "application/msword" ||
    [".doc", ".docx"].includes(ext)
  ) {
    return "document";
  }
  if (
    m.includes("sheet") ||
    m.includes("excel") ||
    m === "text/csv" ||
    [".xls", ".xlsx", ".csv"].includes(ext)
  ) {
    return "spreadsheet";
  }
  if (m.includes("presentation") || [".ppt", ".pptx"].includes(ext)) return "presentation";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  return "other";
}

function mapFolderRow(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    parentFolderId: row.parent_folder_id,
    folderType: row.folder_type,
    linkedPropertyName: row.linked_property_name,
    linkedOwnerName: row.linked_owner_name,
    linkedVendorName: row.linked_vendor_name,
    icon: row.icon,
    createdBy: row.created_by,
    isSystem: row.is_system,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapFileRow(row) {
  const shareUrl =
    row.share_token && row.visibility === "shared"
      ? `${sharePublicBase()}/${row.share_token}`
      : null;
  return {
    id: row.id,
    folderId: row.folder_id,
    originalFilename: row.original_filename,
    storedFilename: row.stored_filename,
    fileSizeBytes: Number(row.file_size_bytes || 0),
    mimeType: row.mime_type,
    fileType: row.file_type,
    description: row.description,
    tags: Array.isArray(row.tags) ? row.tags : [],
    aiSummary: row.ai_summary,
    aiAnalysisStatus: row.ai_analysis_status || "none",
    uploadedBy: row.uploaded_by,
    uploadedByName: row.uploaded_by_name || null,
    visibility: row.visibility,
    shareToken: row.share_token,
    shareUrl,
    downloadCount: Number(row.download_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function ensureUploadRoot() {
  await fs.mkdir(UPLOAD_ROOT, { recursive: true });
  const tmp = path.join(UPLOAD_ROOT, "_tmp");
  await fs.mkdir(tmp, { recursive: true });
}

const uploadStorage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    try {
      await ensureUploadRoot();
      cb(null, path.join(UPLOAD_ROOT, "_tmp"));
    } catch (e) {
      cb(e);
    }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "") || "";
    cb(null, `${randomUUID()}${ext}`);
  },
});

export const uploadFilesMiddleware = multer({
  storage: uploadStorage,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 40 },
});

async function getFolderById(pool, id) {
  const { rows } = await pool.query(`SELECT * FROM file_folders WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function getUncategorizedFolderId(pool) {
  const { rows } = await pool.query(
    `SELECT id FROM file_folders WHERE parent_folder_id IS NULL AND name = 'Uncategorized' LIMIT 1`
  );
  return rows[0]?.id ?? null;
}

async function folderBreadcrumb(pool, folderId) {
  const parts = [];
  let cur = folderId;
  const guard = new Set();
  while (cur && !guard.has(cur)) {
    guard.add(cur);
    const row = await getFolderById(pool, cur);
    if (!row) break;
    parts.unshift({ id: row.id, name: row.name });
    cur = row.parent_folder_id;
  }
  return parts;
}

async function buildTree(pool) {
  const { rows: folders } = await pool.query(
    `SELECT * FROM file_folders ORDER BY parent_folder_id NULLS FIRST, name ASC`
  );
  const { rows: counts } = await pool.query(
    `SELECT folder_id, COUNT(*)::int AS c FROM files GROUP BY folder_id`
  );
  const directCount = new Map(counts.map((r) => [r.folder_id, r.c]));

  const byParent = new Map();
  for (const f of folders) {
    const pid = f.parent_folder_id ?? 0;
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid).push(f);
  }

  function attachCounts(node) {
    const id = node.id;
    const self = directCount.get(id) || 0;
    const children = byParent.get(id) || [];
    let total = self;
    const childNodes = children.map((row) => {
      const n = { ...mapFolderRow(row), children: [], fileCount: 0, totalFileCount: 0 };
      attachCounts(n);
      total += n.totalFileCount;
      return n;
    });
    node.children = childNodes;
    node.fileCount = self;
    node.totalFileCount = total;
  }

  const roots = (byParent.get(0) || []).map((row) => {
    const n = { ...mapFolderRow(row), children: [], fileCount: 0, totalFileCount: 0 };
    attachCounts(n);
    return n;
  });
  return roots;
}

export async function getFilesStats(req, res) {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(file_size_bytes), 0)::bigint AS bytes FROM files`
    );
    res.json({
      fileCount: rows[0]?.n ?? 0,
      totalBytes: Number(rows[0]?.bytes ?? 0),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load file stats." });
  }
}

export async function getFoldersTree(req, res) {
  try {
    const pool = getPool();
    const tree = await buildTree(pool);
    res.json({ folders: tree });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load folders." });
  }
}

export async function getFolderByIdRoute(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid folder id." });
    return;
  }
  try {
    const pool = getPool();
    const folder = await getFolderById(pool, id);
    if (!folder) {
      res.status(404).json({ error: "Folder not found." });
      return;
    }
    const { rows: subs } = await pool.query(
      `SELECT * FROM file_folders WHERE parent_folder_id = $1 ORDER BY name ASC`,
      [id]
    );
    const { rows: files } = await pool.query(
      `SELECT f.*, u.display_name AS uploaded_by_name
       FROM files f
       LEFT JOIN users u ON u.id = f.uploaded_by
       WHERE f.folder_id = $1
       ORDER BY f.created_at DESC`,
      [id]
    );
    res.json({
      folder: mapFolderRow(folder),
      subfolders: subs.map(mapFolderRow),
      files: files.map(mapFileRow),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load folder." });
  }
}

export async function postFolder(req, res) {
  const name = String(req.body?.name || "").trim();
  const parentFolderId = req.body?.parentFolderId != null ? Number(req.body.parentFolderId) : null;
  const icon = String(req.body?.icon || "📁").trim().slice(0, 10) || "📁";
  if (!name) {
    res.status(400).json({ error: "name is required." });
    return;
  }
  if (parentFolderId != null && (!Number.isFinite(parentFolderId) || parentFolderId < 1)) {
    res.status(400).json({ error: "parentFolderId is invalid." });
    return;
  }
  try {
    const pool = getPool();
    if (parentFolderId != null) {
      const p = await getFolderById(pool, parentFolderId);
      if (!p) {
        res.status(400).json({ error: "Parent folder not found." });
        return;
      }
    }
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 200);
    const { rows } = await pool.query(
      `INSERT INTO file_folders (name, slug, parent_folder_id, folder_type, icon, created_by, is_system)
       VALUES ($1, $2, $3, 'custom', $4, $5, false)
       RETURNING *`,
      [name, slug || null, parentFolderId, icon, req.user.id]
    );
    res.status(201).json({ folder: mapFolderRow(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not create folder." });
  }
}

export async function putFolder(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid folder id." });
    return;
  }
  const name = req.body?.name != null ? String(req.body.name).trim() : null;
  const icon = req.body?.icon != null ? String(req.body.icon).trim().slice(0, 10) : null;
  if (name === "" && icon === null) {
    res.status(400).json({ error: "Nothing to update." });
    return;
  }
  try {
    const pool = getPool();
    const folder = await getFolderById(pool, id);
    if (!folder) {
      res.status(404).json({ error: "Folder not found." });
      return;
    }
    const nextName = name != null ? name : folder.name;
    const nextIcon = icon != null ? icon : folder.icon;
    const slug = nextName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 200);
    const { rows } = await pool.query(
      `UPDATE file_folders SET name = $1, slug = $2, icon = $3, updated_at = NOW() WHERE id = $4 RETURNING *`,
      [nextName, slug || null, nextIcon, id]
    );
    res.json({ folder: mapFolderRow(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update folder." });
  }
}

export async function deleteFolder(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  const moveFiles = String(req.query.moveFilesToParent || "") === "1" || req.body?.moveFilesToParent === true;
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid folder id." });
    return;
  }
  try {
    const pool = getPool();
    const folder = await getFolderById(pool, id);
    if (!folder) {
      res.status(404).json({ error: "Folder not found." });
      return;
    }
    if (folder.is_system) {
      res.status(403).json({ error: "System folders cannot be deleted." });
      return;
    }
    const { rows: childFolders } = await pool.query(
      `SELECT id FROM file_folders WHERE parent_folder_id = $1 LIMIT 1`,
      [id]
    );
    if (childFolders.length) {
      res.status(400).json({ error: "Folder is not empty (contains subfolders)." });
      return;
    }
    const { rows: fileRows } = await pool.query(`SELECT id FROM files WHERE folder_id = $1`, [id]);
    if (fileRows.length && !moveFiles) {
      res.status(400).json({ error: "Folder contains files. Pass moveFilesToParent=1 or empty the folder first." });
      return;
    }
    if (fileRows.length && moveFiles) {
      const parentId = folder.parent_folder_id;
      let target = parentId;
      if (!target) {
        target = await getUncategorizedFolderId(pool);
      }
      if (!target) {
        res.status(400).json({ error: "No parent folder to move files into." });
        return;
      }
      await pool.query(`UPDATE files SET folder_id = $1, updated_at = NOW() WHERE folder_id = $2`, [
        target,
        id,
      ]);
    }
    await pool.query(`DELETE FROM file_folders WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete folder." });
  }
}

function parseTags(input) {
  if (Array.isArray(input)) return input.map((t) => String(t).trim()).filter(Boolean).slice(0, 50);
  if (typeof input === "string") {
    return input
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 50);
  }
  return [];
}

async function diskPathForFile(row) {
  return path.join(UPLOAD_ROOT, String(row.folder_id), row.stored_filename);
}

export async function postFilesUpload(req, res) {
  const folderId = Number.parseInt(String(req.body?.folderId ?? ""), 10);
  const description = req.body?.description != null ? String(req.body.description).trim() : "";
  const tags = parseTags(req.body?.tags);
  if (!Number.isFinite(folderId) || folderId < 1) {
    res.status(400).json({ error: "folderId is required (multipart field)." });
    return;
  }
  const files = req.files;
  if (!files?.length) {
    res.status(400).json({ error: 'No files uploaded (field name "files").' });
    return;
  }
  try {
    const pool = getPool();
    const folder = await getFolderById(pool, folderId);
    if (!folder) {
      for (const f of files) {
        try {
          await fs.unlink(f.path);
        } catch {
          /* ignore */
        }
      }
      res.status(400).json({ error: "Folder not found." });
      return;
    }
    const destDir = path.join(UPLOAD_ROOT, String(folderId));
    await fs.mkdir(destDir, { recursive: true });
    const created = [];
    for (const f of files) {
      const orig = path.basename(f.originalname || "file");
      const ext = path.extname(orig) || path.extname(f.filename || "");
      const stored = `${randomUUID()}${ext}`;
      const finalPath = path.join(destDir, stored);
      await fs.rename(f.path, finalPath);
      const stat = await fs.stat(finalPath);
      const mime = f.mimetype || "application/octet-stream";
      const ft = fileTypeFromMime(mime, orig);
      const { rows } = await pool.query(
        `INSERT INTO files (
           folder_id, original_filename, stored_filename, file_size_bytes, mime_type, file_type,
           description, tags, uploaded_by, visibility
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'private')
         RETURNING *`,
        [folderId, orig.slice(0, 255), stored.slice(0, 255), stat.size, mime, ft, description || null, tags, req.user.id]
      );
      const full = await pool.query(
        `SELECT f.*, u.display_name AS uploaded_by_name FROM files f
         LEFT JOIN users u ON u.id = f.uploaded_by WHERE f.id = $1`,
        [rows[0].id]
      );
      const rec = mapFileRow(full.rows[0]);
      created.push(rec);
      if ((ft === "pdf" || ft === "image") && process.env.ANTHROPIC_API_KEY?.trim()) {
        setImmediate(() => {
          runFileAnalysis(rows[0].id).catch((err) => console.error("[files] auto-analyze", err));
        });
      }
    }
    res.status(201).json({ files: created });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Upload failed." });
  }
}

async function listFilesQuery(pool, { folderId, search, fileType, uploadedBy, page, perPage }) {
  const conds = [];
  const params = [];
  let i = 1;
  if (folderId != null && Number.isFinite(folderId)) {
    conds.push(`f.folder_id = $${i++}`);
    params.push(folderId);
  }
  if (fileType) {
    conds.push(`f.file_type = $${i++}`);
    params.push(String(fileType));
  }
  if (uploadedBy != null && Number.isFinite(uploadedBy)) {
    conds.push(`f.uploaded_by = $${i++}`);
    params.push(uploadedBy);
  }
  const safeSearch = search ? sanitizeSearchFragment(search) : "";
  if (safeSearch) {
    const frag = `%${safeSearch}%`;
    const p = `$${i++}`;
    conds.push(
      `(f.original_filename ILIKE ${p} OR f.description ILIKE ${p} OR f.ai_summary ILIKE ${p} OR EXISTS (
         SELECT 1 FROM unnest(f.tags) t WHERE t ILIKE ${p}
       ))`
    );
    params.push(frag);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const countSql = `SELECT COUNT(*)::int AS c FROM files f ${where}`;
  const { rows: countRows } = await pool.query(countSql, params);
  const total = countRows[0]?.c ?? 0;
  const offset = (page - 1) * perPage;
  const limitIdx = i++;
  const offsetIdx = i;
  const listParams = [...params, perPage, offset];
  const listSql = `
    SELECT f.*, u.display_name AS uploaded_by_name
    FROM files f
    LEFT JOIN users u ON u.id = f.uploaded_by
    ${where}
    ORDER BY f.created_at DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;
  const { rows } = await pool.query(listSql, listParams);
  return { rows, total };
}

export async function getFilesList(req, res) {
  const folderIdRaw = req.query.folderId;
  const folderId =
    folderIdRaw != null && folderIdRaw !== ""
      ? Number.parseInt(String(folderIdRaw), 10)
      : null;
  const search = req.query.search ? String(req.query.search) : "";
  const fileType = req.query.fileType ? String(req.query.fileType) : "";
  const uploadedByRaw = req.query.uploadedBy;
  const uploadedBy =
    uploadedByRaw != null && uploadedByRaw !== ""
      ? Number.parseInt(String(uploadedByRaw), 10)
      : null;
  const page = Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1);
  const perPage = Math.min(100, Math.max(1, Number.parseInt(String(req.query.perPage || "50"), 10) || 50));
  try {
    const pool = getPool();
    const { rows, total } = await listFilesQuery(pool, {
      folderId: Number.isFinite(folderId) ? folderId : null,
      search,
      fileType,
      uploadedBy: Number.isFinite(uploadedBy) ? uploadedBy : null,
      page,
      perPage,
    });
    const out = [];
    for (const row of rows) {
      const bc = await folderBreadcrumb(pool, row.folder_id);
      out.push({ ...mapFileRow(row), folderPath: bc });
    }
    res.json({
      files: out,
      page,
      perPage,
      total,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not list files." });
  }
}

export async function getFileById(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT f.*, u.display_name AS uploaded_by_name
       FROM files f
       LEFT JOIN users u ON u.id = f.uploaded_by
       WHERE f.id = $1`,
      [id]
    );
    if (!rows[0]) {
      res.status(404).json({ error: "File not found." });
      return;
    }
    const folderPath = await folderBreadcrumb(pool, rows[0].folder_id);
    res.json({ file: { ...mapFileRow(rows[0]), folderPath } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load file." });
  }
}

async function streamFileToResponse(req, res, fileRow, disposition) {
  const fp = await diskPathForFile(fileRow);
  try {
    await fs.access(fp);
  } catch {
    res.status(404).json({ error: "File missing on disk." });
    return;
  }
  const orig = fileRow.original_filename || "download";
  const ascii = orig.replace(/[^\x20-\x7E]/g, "_");
  res.setHeader("Content-Type", fileRow.mime_type || "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(orig)}`
  );
  createReadStream(fp).pipe(res);
}

export async function getFileDownload(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(`SELECT * FROM files WHERE id = $1`, [id]);
    if (!rows[0]) {
      res.status(404).json({ error: "File not found." });
      return;
    }
    await pool.query(`UPDATE files SET download_count = download_count + 1, updated_at = NOW() WHERE id = $1`, [id]);
    await streamFileToResponse(req, res, rows[0], "attachment");
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: "Download failed." });
  }
}

export async function getFilePreview(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(`SELECT * FROM files WHERE id = $1`, [id]);
    if (!rows[0]) {
      res.status(404).json({ error: "File not found." });
      return;
    }
    await streamFileToResponse(req, res, rows[0], "inline");
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: "Preview failed." });
  }
}

export async function putFile(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  const description = req.body?.description != null ? String(req.body.description) : undefined;
  const tags = req.body?.tags !== undefined ? parseTags(req.body.tags) : undefined;
  const folderId = req.body?.folderId != null ? Number.parseInt(String(req.body.folderId), 10) : undefined;
  try {
    const pool = getPool();
    const { rows } = await pool.query(`SELECT * FROM files WHERE id = $1`, [id]);
    if (!rows[0]) {
      res.status(404).json({ error: "File not found." });
      return;
    }
    const row = rows[0];
    if (folderId !== undefined) {
      if (!Number.isFinite(folderId) || folderId < 1) {
        res.status(400).json({ error: "Invalid folderId." });
        return;
      }
      const f = await getFolderById(pool, folderId);
      if (!f) {
        res.status(400).json({ error: "Target folder not found." });
        return;
      }
      const oldDir = path.join(UPLOAD_ROOT, String(row.folder_id));
      const newDir = path.join(UPLOAD_ROOT, String(folderId));
      await fs.mkdir(newDir, { recursive: true });
      const oldPath = path.join(oldDir, row.stored_filename);
      const newPath = path.join(newDir, row.stored_filename);
      try {
        await fs.rename(oldPath, newPath);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Could not move file on disk." });
        return;
      }
      await pool.query(`UPDATE files SET folder_id = $1, updated_at = NOW() WHERE id = $2`, [folderId, id]);
    }
    if (description !== undefined) {
      await pool.query(`UPDATE files SET description = $1, updated_at = NOW() WHERE id = $2`, [description, id]);
    }
    if (tags !== undefined) {
      await pool.query(`UPDATE files SET tags = $1, updated_at = NOW() WHERE id = $2`, [tags, id]);
    }
    const { rows: out } = await pool.query(
      `SELECT f.*, u.display_name AS uploaded_by_name FROM files f
       LEFT JOIN users u ON u.id = f.uploaded_by WHERE f.id = $1`,
      [id]
    );
    const folderPath = await folderBreadcrumb(pool, out[0].folder_id);
    res.json({ file: { ...mapFileRow(out[0]), folderPath } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update file." });
  }
}

function canDeleteFile(user, fileRow) {
  return user?.role === "admin" || Number(fileRow.uploaded_by) === Number(user?.id);
}

export async function deleteFile(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(`SELECT * FROM files WHERE id = $1`, [id]);
    if (!rows[0]) {
      res.status(404).json({ error: "File not found." });
      return;
    }
    if (!canDeleteFile(req.user, rows[0])) {
      res.status(403).json({ error: "You may only delete files you uploaded (or be an admin)." });
      return;
    }
    const fp = await diskPathForFile(rows[0]);
    await pool.query(`DELETE FROM files WHERE id = $1`, [id]);
    try {
      await fs.unlink(fp);
    } catch {
      /* ignore */
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete file." });
  }
}

export async function postFileShare(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  try {
    const pool = getPool();
    const token = randomBytes(32).toString("hex");
    const { rows } = await pool.query(
      `UPDATE files SET share_token = $1, visibility = 'shared', updated_at = NOW() WHERE id = $2 RETURNING *`,
      [token, id]
    );
    if (!rows[0]) {
      res.status(404).json({ error: "File not found." });
      return;
    }
    res.json({ shareToken: token, shareUrl: `${sharePublicBase()}/${token}` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not create share link." });
  }
}

export async function deleteFileShare(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  try {
    const pool = getPool();
    await pool.query(
      `UPDATE files SET share_token = NULL, visibility = 'private', updated_at = NOW() WHERE id = $1`,
      [id]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not revoke share link." });
  }
}

export async function getFileSharedMeta(req, res) {
  const shareToken = String(req.params.shareToken || "").trim();
  if (!shareToken) {
    res.status(400).json({ error: "Invalid token." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT id, original_filename, mime_type, file_type, file_size_bytes, description, ai_summary, created_at
       FROM files WHERE share_token = $1 AND visibility = 'shared'`,
      [shareToken]
    );
    if (!rows[0]) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    const r = rows[0];
    res.json({
      file: {
        id: r.id,
        originalFilename: r.original_filename,
        mimeType: r.mime_type,
        fileType: r.file_type,
        fileSizeBytes: Number(r.file_size_bytes || 0),
        description: r.description,
        aiSummary: r.ai_summary,
        createdAt: r.created_at,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load file." });
  }
}

export async function getFileSharedDownload(req, res) {
  const shareToken = String(req.params.shareToken || "").trim();
  if (!shareToken) {
    res.status(400).json({ error: "Invalid token." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(`SELECT * FROM files WHERE share_token = $1 AND visibility = 'shared'`, [
      shareToken,
    ]);
    if (!rows[0]) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    await pool.query(`UPDATE files SET download_count = download_count + 1, updated_at = NOW() WHERE id = $1`, [
      rows[0].id,
    ]);
    await streamFileToResponse(req, res, rows[0], "attachment");
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: "Download failed." });
  }
}

export async function getFilesSearch(req, res) {
  const q = req.query.q ? String(req.query.q) : "";
  if (!sanitizeSearchFragment(q)) {
    res.json({ files: [] });
    return;
  }
  const page = Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1);
  const perPage = Math.min(100, Math.max(1, Number.parseInt(String(req.query.perPage || "30"), 10) || 30));
  try {
    const pool = getPool();
    const { rows, total } = await listFilesQuery(pool, {
      folderId: null,
      search: q,
      fileType: "",
      uploadedBy: null,
      page,
      perPage,
    });
    const out = [];
    for (const row of rows) {
      const bc = await folderBreadcrumb(pool, row.folder_id);
      out.push({ ...mapFileRow(row), folderPath: bc });
    }
    res.json({ files: out, page, perPage, total });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Search failed." });
  }
}

export async function postBulkMove(req, res) {
  const fileIds = Array.isArray(req.body?.fileIds) ? req.body.fileIds.map((x) => Number(x)) : [];
  const folderId = Number.parseInt(String(req.body?.folderId ?? ""), 10);
  if (!fileIds.length || !fileIds.every((n) => Number.isFinite(n))) {
    res.status(400).json({ error: "fileIds must be a non-empty array of numeric ids." });
    return;
  }
  if (!Number.isFinite(folderId) || folderId < 1) {
    res.status(400).json({ error: "folderId is required." });
    return;
  }
  try {
    const pool = getPool();
    const folder = await getFolderById(pool, folderId);
    if (!folder) {
      res.status(400).json({ error: "Target folder not found." });
      return;
    }
    for (const fid of fileIds) {
      const { rows } = await pool.query(`SELECT * FROM files WHERE id = $1`, [fid]);
      if (!rows[0]) continue;
      const row = rows[0];
      if (Number(row.folder_id) === folderId) continue;
      const oldDir = path.join(UPLOAD_ROOT, String(row.folder_id));
      const newDir = path.join(UPLOAD_ROOT, String(folderId));
      await fs.mkdir(newDir, { recursive: true });
      const oldPath = path.join(oldDir, row.stored_filename);
      const newPath = path.join(newDir, row.stored_filename);
      await fs.rename(oldPath, newPath);
      await pool.query(`UPDATE files SET folder_id = $1, updated_at = NOW() WHERE id = $2`, [folderId, fid]);
    }
    res.json({ ok: true, moved: fileIds.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Bulk move failed." });
  }
}

export async function postBulkDelete(req, res) {
  const fileIds = Array.isArray(req.body?.fileIds) ? req.body.fileIds.map((x) => Number(x)) : [];
  if (!fileIds.length || !fileIds.every((n) => Number.isFinite(n))) {
    res.status(400).json({ error: "fileIds must be a non-empty array of numeric ids." });
    return;
  }
  try {
    const pool = getPool();
    for (const fid of fileIds) {
      const { rows } = await pool.query(`SELECT * FROM files WHERE id = $1`, [fid]);
      if (!rows[0]) continue;
      const fp = await diskPathForFile(rows[0]);
      await pool.query(`DELETE FROM files WHERE id = $1`, [fid]);
      try {
        await fs.unlink(fp);
      } catch {
        /* ignore */
      }
    }
    res.json({ ok: true, deleted: fileIds.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Bulk delete failed." });
  }
}

export async function postBulkTag(req, res) {
  const fileIds = Array.isArray(req.body?.fileIds) ? req.body.fileIds.map((x) => Number(x)) : [];
  const newTags = Array.isArray(req.body?.tags) ? req.body.tags.map((t) => String(t).trim()).filter(Boolean) : [];
  if (!fileIds.length || !fileIds.every((n) => Number.isFinite(n))) {
    res.status(400).json({ error: "fileIds must be a non-empty array of numeric ids." });
    return;
  }
  if (!newTags.length) {
    res.status(400).json({ error: "tags must be a non-empty array." });
    return;
  }
  try {
    const pool = getPool();
    for (const fid of fileIds) {
      await pool.query(
        `UPDATE files SET tags = (
           SELECT ARRAY(SELECT DISTINCT unnest(COALESCE(tags, '{}') || $1::text[]))
         ), updated_at = NOW() WHERE id = $2`,
        [newTags, fid]
      );
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Bulk tag failed." });
  }
}

const ANALYSIS_PROMPT = `You are analyzing a document uploaded to a property management company's file system.

Please provide:
1. A brief summary (2-3 sentences) of what this document is
2. Key details: dates, names, addresses, amounts mentioned
3. Document type classification: lease, invoice, inspection report, insurance certificate, PMA, correspondence, legal notice, financial report, photo, or other
4. Any action items or deadlines mentioned

Format your response as clean text, not JSON.`;

export async function runFileAnalysis(fileId) {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT * FROM files WHERE id = $1`, [fileId]);
  if (!rows[0]) return;
  const row = rows[0];
  const ft = row.file_type;
  if (ft !== "pdf" && ft !== "image") {
    await pool.query(
      `UPDATE files SET ai_analysis_status = 'failed', ai_summary = $2 WHERE id = $1`,
      [fileId, "AI analysis is only available for PDFs and images."]
    );
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    await pool.query(
      `UPDATE files SET ai_analysis_status = 'failed', ai_summary = $2 WHERE id = $1`,
      [fileId, "AI is not configured."]
    );
    return;
  }
  await pool.query(`UPDATE files SET ai_analysis_status = 'processing', ai_summary = NULL WHERE id = $1`, [fileId]);
  const fp = await diskPathForFile(row);
  let buf;
  try {
    buf = await fs.readFile(fp);
  } catch {
    await pool.query(
      `UPDATE files SET ai_analysis_status = 'failed', ai_summary = $2 WHERE id = $1`,
      [fileId, "Could not read file from disk."]
    );
    return;
  }
  if (buf.length > MAX_ANALYSIS_BYTES) {
    await pool.query(
      `UPDATE files SET ai_analysis_status = 'failed', ai_summary = $2 WHERE id = $1`,
      [fileId, `File exceeds ${MAX_ANALYSIS_BYTES / (1024 * 1024)} MB limit for AI analysis.`]
    );
    return;
  }
  const mime = row.mime_type || "application/octet-stream";
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const content = [];
  if (ft === "pdf") {
    content.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: buf.toString("base64"),
      },
    });
  } else {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: mime.startsWith("image/") ? mime : "image/jpeg",
        data: buf.toString("base64"),
      },
    });
  }
  content.push({ type: "text", text: ANALYSIS_PROMPT });
  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      messages: [{ role: "user", content }],
    });
    const text = (resp.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    await pool.query(
      `UPDATE files SET ai_summary = $1, ai_analysis_status = 'completed', updated_at = NOW() WHERE id = $2`,
      [text || "(No summary returned.)", fileId]
    );
  } catch (err) {
    console.error("[files] analyze", err);
    await pool.query(
      `UPDATE files SET ai_analysis_status = 'failed', ai_summary = $2 WHERE id = $1`,
      [fileId, `Analysis failed: ${err.message || "Unknown error"}`]
    );
  }
}

export async function postFileAnalyze(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(`SELECT * FROM files WHERE id = $1`, [id]);
    if (!rows[0]) {
      res.status(404).json({ error: "File not found." });
      return;
    }
    if (!process.env.ANTHROPIC_API_KEY?.trim()) {
      res.status(503).json({ error: "AI is not configured.", code: "AI_NOT_CONFIGURED" });
      return;
    }
    await pool.query(
      `UPDATE files SET ai_analysis_status = 'processing', ai_summary = NULL, updated_at = NOW() WHERE id = $1`,
      [id]
    );
    setImmediate(() => {
      runFileAnalysis(id).catch((e) => console.error("[files] analyze bg", e));
    });
    res.json({ ok: true, aiAnalysisStatus: "processing" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not start analysis." });
  }
}
