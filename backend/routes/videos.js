import { randomBytes, randomUUID } from "crypto";
import { createReadStream } from "fs";
import { promises as fs } from "fs";
import OpenAI from "openai";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { getPool } from "../lib/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.resolve(__dirname, "..", "uploads", "videos");
const SHARE_BASE_URL = "https://dashboard.prestigedash.com/videos/shared";
const TRANSCRIPT_NO_OPENAI_MSG = "Transcription not configured. Add OPENAI_API_KEY to enable.";

async function ensureUploadDir() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} failed (${code}): ${stderr || stdout}`));
    });
  });
}

async function probeDurationSeconds(inputPath) {
  const { stdout } = await runProcess("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    inputPath,
  ]);
  const parsed = Math.round(Number.parseFloat(String(stdout).trim()) || 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

async function generateThumbnail(inputPath, outputPath) {
  await runProcess("ffmpeg", [
    "-y",
    "-i",
    inputPath,
    "-ss",
    "00:00:01",
    "-vframes",
    "1",
    "-vf",
    "scale=640:-1",
    outputPath,
  ]);
}

function mapVideoRow(row) {
  const shareUrl =
    row.visibility === "shared" && row.share_token ? `${SHARE_BASE_URL}/${row.share_token}` : null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    filename: row.filename,
    thumbnailFilename: row.thumbnail_filename,
    durationSeconds: row.duration_seconds,
    fileSizeBytes: Number(row.file_size_bytes || 0),
    mimeType: row.mime_type,
    recordingType: row.recording_type,
    transcript: row.transcript,
    transcriptStatus: row.transcript_status,
    processingStatus: row.processing_status || "none",
    visibility: row.visibility,
    shareToken: row.share_token,
    shareUrl,
    recordedBy: row.recorded_by,
    recordedByName: row.recorded_by_name || "Unknown",
    folderId: row.folder_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    viewsCount: row.views_count ?? 0,
  };
}

async function getVideoById(videoId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT v.*, u.display_name AS recorded_by_name
     FROM videos v
     LEFT JOIN users u ON u.id = v.recorded_by
     WHERE v.id = $1`,
    [videoId]
  );
  return rows[0] || null;
}

function canManageVideo(user, videoRow) {
  return user?.role === "admin" || Number(videoRow?.recorded_by) === Number(user?.id);
}

async function setVideoTranscriptUnavailable(videoId, message) {
  await getPool().query(
    `UPDATE videos
     SET transcript_status = 'unavailable',
         transcript = $2,
         processing_status = 'none',
         updated_at = NOW()
     WHERE id = $1`,
    [videoId, message]
  );
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureUploadDir()
      .then(() => cb(null, UPLOAD_DIR))
      .catch((err) => cb(err));
  },
  filename: (_req, _file, cb) => {
    cb(null, `${randomUUID()}.webm`);
  },
});

/** 500MB max per uploaded video */
export const uploadVideoMiddleware = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype?.startsWith("video/")) {
      cb(new Error("Only video uploads are allowed."));
      return;
    }
    cb(null, true);
  },
}).single("video");

async function processUploadedVideoInBackground(videoId, filePath, fileSize, mimeType) {
  const pool = getPool();
  const baseName = path.basename(filePath, path.extname(filePath));
  const thumbnailFilename = `${baseName}.jpg`;
  const thumbnailPath = path.join(UPLOAD_DIR, thumbnailFilename);
  const audioPath = path.join(UPLOAD_DIR, `${baseName}.mp3`);
  try {
    const durationSeconds = await probeDurationSeconds(filePath);
    await generateThumbnail(filePath, thumbnailPath);
    await pool.query(
      `UPDATE videos SET
        thumbnail_filename = $2,
        duration_seconds = $3,
        file_size_bytes = $4,
        mime_type = COALESCE(NULLIF(trim($5), ''), mime_type),
        processing_status = 'none',
        updated_at = NOW()
       WHERE id = $1`,
      [videoId, thumbnailFilename, durationSeconds, fileSize, mimeType || "video/webm"]
    );

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      await setVideoTranscriptUnavailable(videoId, TRANSCRIPT_NO_OPENAI_MSG);
      return;
    }

    await pool.query(`UPDATE videos SET transcript_status = 'processing', updated_at = NOW() WHERE id = $1`, [videoId]);

    try {
      await runProcess("ffmpeg", [
        "-y",
        "-i",
        filePath,
        "-vn",
        "-acodec",
        "libmp3lame",
        "-q:a",
        "4",
        audioPath,
      ]);
      const openai = new OpenAI({ apiKey });
      const transcription = await openai.audio.transcriptions.create({
        file: createReadStream(audioPath),
        model: "whisper-1",
        response_format: "text",
      });
      const text = typeof transcription === "string" ? transcription : String(transcription ?? "");
      await pool.query(
        `UPDATE videos SET transcript_status = 'completed', transcript = $2, updated_at = NOW() WHERE id = $1`,
        [videoId, text]
      );
    } catch (transcriptionError) {
      console.error("[videos] transcription failed", transcriptionError);
      await pool.query(
        `UPDATE videos SET transcript_status = 'failed', transcript = NULL, updated_at = NOW() WHERE id = $1`,
        [videoId]
      );
    } finally {
      await fs.unlink(audioPath).catch(() => {});
    }
  } catch (error) {
    console.error("[videos] ffmpeg processing failed", error);
    await pool.query(`UPDATE videos SET processing_status = 'error', updated_at = NOW() WHERE id = $1`, [videoId]);
    fs.unlink(thumbnailPath).catch(() => {});
    await fs.unlink(audioPath).catch(() => {});
  }
}

export async function postVideoUpload(req, res) {
  const file = req.file;
  const title = String(req.body?.title || "").trim();
  const description = String(req.body?.description || "").trim() || null;
  const recordingType = String(req.body?.recording_type || "screen").trim().slice(0, 20) || "screen";
  let folderId = null;
  if (req.body?.folder_id != null && String(req.body.folder_id).trim() !== "") {
    const n = Number(req.body.folder_id);
    if (Number.isFinite(n) && n > 0) folderId = n;
  }
  if (!file) {
    res.status(400).json({ error: "video file is required (field: video)." });
    return;
  }
  if (!title) {
    res.status(400).json({ error: "title is required." });
    return;
  }

  try {
    const pool = getPool();
    if (folderId != null) {
      const { rows: frows } = await pool.query(`SELECT id FROM video_folders WHERE id = $1`, [folderId]);
      if (!frows.length) {
        res.status(400).json({ error: "Invalid folder_id." });
        return;
      }
    }
    const { rows } = await pool.query(
      `INSERT INTO videos (
        title, description, filename, thumbnail_filename, duration_seconds, file_size_bytes,
        mime_type, recording_type, transcript_status, processing_status, visibility, recorded_by, folder_id, created_at, updated_at
      ) VALUES (
        $1, $2, $3, NULL, NULL, $4, $5, $6, 'pending', 'ffmpeg', 'private', $7, $8, NOW(), NOW()
      )
      RETURNING *`,
      [title, description, file.filename, file.size, file.mimetype || "video/webm", recordingType, req.user.id, folderId]
    );

    const created = await getVideoById(rows[0].id);
    res.status(201).json({ video: mapVideoRow(created) });

    processUploadedVideoInBackground(rows[0].id, file.path, file.size, file.mimetype || "video/webm").catch((e) => {
      console.error("[videos] background processing crashed", e);
    });
  } catch (error) {
    console.error("[videos] upload failed", error);
    res.status(500).json({ error: "Could not process uploaded video." });
  }
}

export async function getVideos(req, res) {
  try {
    const pool = getPool();
    const limit = Math.min(Math.max(Number(req.query.limit) || 18, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const search = String(req.query.search || "").trim();
    const filter = String(req.query.filter || "all").trim();
    const sort = String(req.query.sort || "newest").trim();
    const recordedBy = req.query.recorded_by ? Number(req.query.recorded_by) : null;

    const parts = ["1=1"];
    const params = [];
    let n = 1;

    if (recordedBy) {
      parts.push(`v.recorded_by = $${n++}`);
      params.push(recordedBy);
    }
    if (filter === "my") {
      parts.push(`v.recorded_by = $${n++}`);
      params.push(req.user.id);
    } else if (filter === "shared") {
      parts.push(`v.visibility = 'shared'`);
    }
    if (req.query.unfiled === "1") {
      parts.push(`v.folder_id IS NULL`);
    } else if (req.query.folderId != null && String(req.query.folderId).trim() !== "" && req.query.folderId !== "all") {
      const fid = Number(req.query.folderId);
      if (Number.isFinite(fid) && fid > 0) {
        parts.push(`v.folder_id = $${n++}`);
        params.push(fid);
      }
    }
    if (search) {
      parts.push(`(v.title ILIKE $${n} OR coalesce(v.transcript, '') ILIKE $${n})`);
      params.push(`%${search}%`);
      n++;
    }

    let orderBy = "v.created_at DESC";
    if (sort === "oldest") orderBy = "v.created_at ASC";
    if (sort === "most_viewed") orderBy = "v.views_count DESC, v.created_at DESC";

    const where = parts.join(" AND ");
    const { rows } = await pool.query(
      `SELECT v.*, u.display_name AS recorded_by_name
       FROM videos v
       LEFT JOIN users u ON u.id = v.recorded_by
       WHERE ${where}
       ORDER BY ${orderBy}
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int AS c FROM videos v WHERE ${where}`, params);
    res.json({
      videos: rows.map(mapVideoRow),
      total: countRows[0]?.c || 0,
      limit,
      offset,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not list videos." });
  }
}

export async function getVideoByIdRoute(req, res) {
  try {
    const id = Number(req.params.id);
    const video = await getVideoById(id);
    if (!video) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    await getPool().query(`UPDATE videos SET views_count = views_count + 1, updated_at = NOW() WHERE id = $1`, [id]);
    const fresh = await getVideoById(id);
    res.json({ video: mapVideoRow(fresh) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not load video." });
  }
}

export async function putVideoById(req, res) {
  try {
    const id = Number(req.params.id);
    const pool = getPool();
    const current = await getVideoById(id);
    if (!current) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    if (!canManageVideo(req.user, current)) {
      res.status(403).json({ error: "Only the owner or an admin can edit this video." });
      return;
    }

    const b = req.body || {};
    const fields = [];
    const values = [];
    let n = 1;
    const set = (column, value) => {
      fields.push(`${column} = $${n++}`);
      values.push(value);
    };

    if (typeof b.title === "string" && b.title.trim()) set("title", b.title.trim().slice(0, 255));
    if (typeof b.description === "string") set("description", b.description.trim() || null);
    if (typeof b.visibility === "string" && ["private", "shared"].includes(b.visibility)) {
      set("visibility", b.visibility);
    }
    if (!fields.length) {
      res.status(400).json({ error: "Nothing to update." });
      return;
    }
    fields.push("updated_at = NOW()");
    values.push(id);
    const { rows } = await pool.query(`UPDATE videos SET ${fields.join(", ")} WHERE id = $${n} RETURNING *`, values);
    const updated = await getVideoById(rows[0].id);
    res.json({ video: mapVideoRow(updated) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not update video." });
  }
}

export async function deleteVideoById(req, res) {
  try {
    const id = Number(req.params.id);
    const pool = getPool();
    const current = await getVideoById(id);
    if (!current) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    if (!canManageVideo(req.user, current)) {
      res.status(403).json({ error: "Only the owner or an admin can delete this video." });
      return;
    }
    await pool.query(`DELETE FROM video_comments WHERE video_id = $1`, [id]);
    await pool.query(`DELETE FROM videos WHERE id = $1`, [id]);
    const paths = [path.join(UPLOAD_DIR, current.filename)];
    if (current.thumbnail_filename) {
      paths.push(path.join(UPLOAD_DIR, current.thumbnail_filename));
    }
    await Promise.all(paths.map((p) => fs.unlink(p).catch(() => {})));
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not delete video." });
  }
}

export async function postVideoShare(req, res) {
  try {
    const id = Number(req.params.id);
    const current = await getVideoById(id);
    if (!current) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    if (!canManageVideo(req.user, current)) {
      res.status(403).json({ error: "Only the owner or an admin can share this video." });
      return;
    }
    const shareToken = randomBytes(16).toString("hex");
    await getPool().query(
      `UPDATE videos
       SET share_token = $2, visibility = 'shared', updated_at = NOW()
       WHERE id = $1`,
      [id, shareToken]
    );
    res.json({ shareToken, shareUrl: `${SHARE_BASE_URL}/${shareToken}` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not create share link." });
  }
}

export async function deleteVideoShare(req, res) {
  try {
    const id = Number(req.params.id);
    const current = await getVideoById(id);
    if (!current) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    if (!canManageVideo(req.user, current)) {
      res.status(403).json({ error: "Only the owner or an admin can revoke sharing." });
      return;
    }
    await getPool().query(
      `UPDATE videos
       SET share_token = NULL, visibility = 'private', updated_at = NOW()
       WHERE id = $1`,
      [id]
    );
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not revoke share link." });
  }
}

/**
 * Parse Range: bytes=... for static file size `totalSize` (last byte index is totalSize - 1).
 * Clamps end past EOF. Returns null to mean "send full representation" (no usable range).
 */
function parseRangeHeader(rangeHeader, totalSize) {
  if (!rangeHeader || totalSize <= 0) return null;
  const raw = String(rangeHeader).trim();
  if (!raw.toLowerCase().startsWith("bytes=")) return null;
  const spec = raw.slice(6).trim();

  if (spec.startsWith("-")) {
    const suffixLen = Number(spec.slice(1));
    if (!Number.isFinite(suffixLen) || suffixLen <= 0) return null;
    const start = Math.max(0, totalSize - Math.floor(suffixLen));
    return { start, end: totalSize - 1 };
  }

  const dash = spec.indexOf("-");
  if (dash < 0) return null;
  const startText = spec.slice(0, dash);
  const endText = spec.slice(dash + 1);
  const start = Number(startText);
  if (!Number.isFinite(start) || start < 0) return null;
  if (start >= totalSize) return null;

  let end = endText === "" ? totalSize - 1 : Number(endText);
  if (!Number.isFinite(end)) return null;
  end = Math.min(Math.floor(end), totalSize - 1);
  if (end < start) return null;
  return { start: Math.floor(start), end };
}

async function streamVideoFile(res, filePath, mimeType, rangeHeader) {
  await fs.access(filePath);
  const stat = await fs.stat(filePath);
  const total = stat.size;
  const contentType = mimeType && String(mimeType).trim() ? String(mimeType).trim() : "video/webm";

  const range = rangeHeader ? parseRangeHeader(rangeHeader, total) : null;
  if (!range) {
    res.status(200);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", String(total));
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    const fsSync = await import("fs");
    const stream = fsSync.createReadStream(filePath);
    stream.on("error", () => {
      if (!res.writableEnded) res.destroy();
    });
    stream.pipe(res);
    return;
  }

  const chunkSize = range.end - range.start + 1;
  res.status(206);
  res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${total}`);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Length", String(chunkSize));
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
  const fsSync = await import("fs");
  const stream = fsSync.createReadStream(filePath, { start: range.start, end: range.end });
  stream.on("error", () => {
    if (!res.writableEnded) res.destroy();
  });
  stream.pipe(res);
}

export async function getVideoStream(req, res) {
  try {
    const id = Number(req.params.id);
    const video = await getVideoById(id);
    if (!video) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    const safeFilename = path.basename(String(video.filename || ""));
    if (!safeFilename) {
      res.status(404).json({ error: "Video file unavailable." });
      return;
    }
    const filePath = path.join(UPLOAD_DIR, safeFilename);
    const mime =
      (video.mime_type && String(video.mime_type).trim()) ||
      (safeFilename.toLowerCase().endsWith(".webm") ? "video/webm" : "application/octet-stream");
    await streamVideoFile(res, filePath, mime, req.headers.range);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(404).json({ error: "Video file unavailable." });
    }
  }
}

export async function getVideoThumbnail(req, res) {
  try {
    const id = Number(req.params.id);
    const video = await getVideoById(id);
    if (!video || !video.thumbnail_filename) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    const thumbnailPath = path.join(UPLOAD_DIR, video.thumbnail_filename);
    await fs.access(thumbnailPath);
    res.sendFile(thumbnailPath);
  } catch (error) {
    console.error(error);
    res.status(404).json({ error: "Thumbnail unavailable." });
  }
}

export async function postVideoComment(req, res) {
  try {
    const id = Number(req.params.id);
    const comment = String(req.body?.comment || "").trim();
    const timestampSeconds =
      req.body?.timestamp_seconds == null ? null : Math.max(0, Math.floor(Number(req.body.timestamp_seconds) || 0));
    if (!comment) {
      res.status(400).json({ error: "comment is required." });
      return;
    }
    const video = await getVideoById(id);
    if (!video) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    await getPool().query(
      `INSERT INTO video_comments (video_id, user_id, comment, timestamp_seconds)
       VALUES ($1, $2, $3, $4)`,
      [id, req.user.id, comment, timestampSeconds]
    );
    res.status(201).json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not add comment." });
  }
}

export async function getVideoComments(req, res) {
  try {
    const id = Number(req.params.id);
    const video = await getVideoById(id);
    if (!video) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    const { rows } = await getPool().query(
      `SELECT vc.*, u.display_name
       FROM video_comments vc
       LEFT JOIN users u ON u.id = vc.user_id
       WHERE vc.video_id = $1
       ORDER BY vc.created_at ASC`,
      [id]
    );
    res.json({
      comments: rows.map((row) => ({
        id: row.id,
        videoId: row.video_id,
        userId: row.user_id,
        displayName: row.display_name || "Unknown",
        comment: row.comment,
        timestampSeconds: row.timestamp_seconds,
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not load comments." });
  }
}

async function getSharedVideoByToken(shareToken) {
  const { rows } = await getPool().query(
    `SELECT v.*, u.display_name AS recorded_by_name
     FROM videos v
     LEFT JOIN users u ON u.id = v.recorded_by
     WHERE v.share_token = $1 AND v.visibility = 'shared'
     LIMIT 1`,
    [shareToken]
  );
  return rows[0] || null;
}

export async function getVideoByShareToken(req, res) {
  try {
    const video = await getSharedVideoByToken(String(req.params.shareToken || ""));
    if (!video) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    await getPool().query(`UPDATE videos SET views_count = views_count + 1, updated_at = NOW() WHERE id = $1`, [
      video.id,
    ]);
    const fresh = await getSharedVideoByToken(String(req.params.shareToken || ""));
    res.json({ video: mapVideoRow(fresh) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not load shared video." });
  }
}

export async function getVideoStreamByShareToken(req, res) {
  try {
    const video = await getSharedVideoByToken(String(req.params.shareToken || ""));
    if (!video) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    const safeFilename = path.basename(String(video.filename || ""));
    if (!safeFilename) {
      res.status(404).json({ error: "Video file unavailable." });
      return;
    }
    const filePath = path.join(UPLOAD_DIR, safeFilename);
    const mime =
      (video.mime_type && String(video.mime_type).trim()) ||
      (safeFilename.toLowerCase().endsWith(".webm") ? "video/webm" : "application/octet-stream");
    await streamVideoFile(res, filePath, mime, req.headers.range);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(404).json({ error: "Video file unavailable." });
    }
  }
}

function mapFolderNode(row, children) {
  return {
    id: row.id,
    name: row.name,
    parentFolderId: row.parent_folder_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    videoCount: row.video_count ?? 0,
    children: children || [],
  };
}

export async function getVideoFolders(req, res) {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT f.*,
        (SELECT COUNT(*)::int FROM videos v WHERE v.folder_id = f.id) AS video_count
       FROM video_folders f
       ORDER BY f.name ASC`
    );
    const byParent = new Map();
    for (const row of rows) {
      const pid = row.parent_folder_id;
      if (!byParent.has(pid)) byParent.set(pid, []);
      byParent.get(pid).push(row);
    }
    function buildTree(parentId) {
      const list = byParent.get(parentId) || [];
      return list.map((r) => mapFolderNode(r, buildTree(r.id)));
    }
    const { rows: uc } = await pool.query(`SELECT COUNT(*)::int AS c FROM videos WHERE folder_id IS NULL`);
    res.json({ folders: buildTree(null), unfiledVideoCount: uc[0]?.c ?? 0 });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not load folders." });
  }
}

export async function postVideoFolder(req, res) {
  try {
    console.log("[videos] creating folder:", req.body);
    const name = String(req.body?.name || "").trim().slice(0, 255);
    if (!name) {
      res.status(400).json({ error: "name is required." });
      return;
    }
    let parentFolderId = null;
    const pool = getPool();
    if (req.body?.parentFolderId != null && req.body?.parentFolderId !== "") {
      const p = Number(req.body.parentFolderId);
      if (!Number.isFinite(p) || p <= 0) {
        res.status(400).json({ error: "Invalid parentFolderId." });
        return;
      }
      const { rows } = await pool.query(`SELECT id FROM video_folders WHERE id = $1`, [p]);
      if (!rows.length) {
        res.status(400).json({ error: "Parent folder not found." });
        return;
      }
      parentFolderId = p;
    }
    const { rows } = await pool.query(
      `INSERT INTO video_folders (name, parent_folder_id, created_by)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [name, parentFolderId, req.user.id]
    );
    const { rows: cnt } = await pool.query(`SELECT COUNT(*)::int AS c FROM videos WHERE folder_id = $1`, [rows[0].id]);
    res.status(201).json({ folder: mapFolderNode({ ...rows[0], video_count: cnt[0].c }, []) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not create folder." });
  }
}

export async function putVideoFolder(req, res) {
  try {
    const id = Number(req.params.id);
    const name = String(req.body?.name || "").trim().slice(0, 255);
    if (!name) {
      res.status(400).json({ error: "name is required." });
      return;
    }
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE video_folders SET name = $2 WHERE id = $1 RETURNING *`,
      [id, name]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    const { rows: cnt } = await pool.query(`SELECT COUNT(*)::int AS c FROM videos WHERE folder_id = $1`, [id]);
    res.json({ folder: mapFolderNode({ ...rows[0], video_count: cnt[0].c }, []) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not rename folder." });
  }
}

export async function deleteVideoFolder(req, res) {
  try {
    const id = Number(req.params.id);
    const pool = getPool();
    const { rows: cur } = await pool.query(`SELECT id, parent_folder_id FROM video_folders WHERE id = $1`, [id]);
    if (!cur.length) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    const parentId = cur[0].parent_folder_id;
    await pool.query(`UPDATE videos SET folder_id = NULL, updated_at = NOW() WHERE folder_id = $1`, [id]);
    await pool.query(`UPDATE video_folders SET parent_folder_id = $2 WHERE parent_folder_id = $1`, [id, parentId]);
    await pool.query(`DELETE FROM video_folders WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not delete folder." });
  }
}

export async function putVideoMove(req, res) {
  try {
    const id = Number(req.params.id);
    const raw = req.body?.folderId;
    const folderId =
      raw === null || raw === undefined || raw === "" || raw === "null"
        ? null
        : (() => {
            const n = Number(raw);
            return Number.isFinite(n) && n > 0 ? n : null;
          })();
    const current = await getVideoById(id);
    if (!current) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    if (!canManageVideo(req.user, current)) {
      res.status(403).json({ error: "Only the owner or an admin can move this video." });
      return;
    }
    if (folderId != null) {
      const pool = getPool();
      const { rows } = await pool.query(`SELECT id FROM video_folders WHERE id = $1`, [folderId]);
      if (!rows.length) {
        res.status(400).json({ error: "Folder not found." });
        return;
      }
    }
    await getPool().query(`UPDATE videos SET folder_id = $2, updated_at = NOW() WHERE id = $1`, [id, folderId]);
    const updated = await getVideoById(id);
    res.json({ video: mapVideoRow(updated) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not move video." });
  }
}
