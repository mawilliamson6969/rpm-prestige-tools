import Anthropic from "@anthropic-ai/sdk";
import { randomBytes, randomUUID } from "crypto";
import { promises as fs } from "fs";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { getPool } from "../lib/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.resolve(__dirname, "..", "uploads", "videos");
const SHARE_BASE_URL = "https://dashboard.prestigedash.com/videos/shared";
const TRANSCRIPTION_PROMPT = `You are transcribing audio from a screen recording made by a property management team member.
The audio has been extracted from a video recording.

Please transcribe the spoken content accurately. Include timestamps every 30 seconds in the format [MM:SS].
If there are pauses or silence, note them as [pause].
If any words are unclear, use [inaudible] rather than guessing.

Format the transcription as clean, readable paragraphs with timestamp markers.`;

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
    "csv=p=0",
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

async function extractMp3Audio(inputPath, outputPath) {
  await runProcess("ffmpeg", ["-y", "-i", inputPath, "-vn", "-acodec", "libmp3lame", "-q:a", "4", outputPath]);
}

function textFromClaudeMessage(msg) {
  const parts = [];
  for (const block of msg?.content || []) {
    if (block.type === "text" && block.text) {
      parts.push(block.text);
    }
  }
  return parts.join("\n").trim();
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
    visibility: row.visibility,
    shareToken: row.share_token,
    shareUrl,
    recordedBy: row.recorded_by,
    recordedByName: row.recorded_by_name || "Unknown",
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

async function runVideoTranscription(videoId, audioPath) {
  const pool = getPool();
  try {
    await pool.query(`UPDATE videos SET transcript_status = 'processing', updated_at = NOW() WHERE id = $1`, [videoId]);
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }
    const audioBuffer = await fs.readFile(audioPath);
    const audioBase64 = audioBuffer.toString("base64");
    const anthropic = new Anthropic({ apiKey });
    const result = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: TRANSCRIPTION_PROMPT },
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "audio/mp3",
                data: audioBase64,
              },
            },
          ],
        },
      ],
    });
    const transcript = textFromClaudeMessage(result);
    await pool.query(
      `UPDATE videos
       SET transcript = $2, transcript_status = 'completed', updated_at = NOW()
       WHERE id = $1`,
      [videoId, transcript || "[No transcript returned]"]
    );
  } catch (error) {
    console.error("[videos] transcription failed", error);
    await pool.query(`UPDATE videos SET transcript_status = 'failed', updated_at = NOW() WHERE id = $1`, [videoId]);
  } finally {
    fs.unlink(audioPath).catch(() => {});
  }
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

export async function postVideoUpload(req, res) {
  const file = req.file;
  const title = String(req.body?.title || "").trim();
  const description = String(req.body?.description || "").trim() || null;
  const recordingType = String(req.body?.recording_type || "screen").trim().slice(0, 20) || "screen";
  if (!file) {
    res.status(400).json({ error: "video file is required (field: video)." });
    return;
  }
  if (!title) {
    res.status(400).json({ error: "title is required." });
    return;
  }

  try {
    const durationSeconds = await probeDurationSeconds(file.path);
    const baseName = path.basename(file.filename, path.extname(file.filename));
    const thumbnailFilename = `${baseName}.jpg`;
    const thumbnailPath = path.join(UPLOAD_DIR, thumbnailFilename);
    const audioFilename = `${baseName}.mp3`;
    const audioPath = path.join(UPLOAD_DIR, audioFilename);
    await generateThumbnail(file.path, thumbnailPath);
    await extractMp3Audio(file.path, audioPath);

    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO videos (
        title, description, filename, thumbnail_filename, duration_seconds, file_size_bytes,
        mime_type, recording_type, transcript_status, visibility, recorded_by, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, 'pending', 'private', $9, NOW(), NOW()
      )
      RETURNING *`,
      [
        title,
        description,
        file.filename,
        thumbnailFilename,
        durationSeconds,
        file.size,
        file.mimetype || "video/webm",
        recordingType,
        req.user.id,
      ]
    );

    const created = await getVideoById(rows[0].id);
    res.status(201).json({ video: mapVideoRow(created) });

    runVideoTranscription(rows[0].id, audioPath).catch((e) => {
      console.error("[videos] background transcription crashed", e);
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

function parseRangeHeader(rangeHeader, totalSize) {
  if (!rangeHeader?.startsWith("bytes=")) return null;
  const [startText, endText] = rangeHeader.replace("bytes=", "").split("-");
  const start = Number(startText);
  const end = endText ? Number(endText) : totalSize - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end >= totalSize) {
    return null;
  }
  return { start, end };
}

async function streamVideoFile(res, filePath, mimeType, rangeHeader) {
  const stat = await fs.stat(filePath);
  const total = stat.size;
  const range = parseRangeHeader(rangeHeader, total);
  if (!range) {
    res.status(200);
    res.setHeader("Content-Type", mimeType || "video/webm");
    res.setHeader("Content-Length", total);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    const stream = (await import("fs")).createReadStream(filePath);
    stream.pipe(res);
    return;
  }

  const chunkSize = range.end - range.start + 1;
  res.status(206);
  res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${total}`);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Length", chunkSize);
  res.setHeader("Content-Type", mimeType || "video/webm");
  res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
  const stream = (await import("fs")).createReadStream(filePath, { start: range.start, end: range.end });
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
    const filePath = path.join(UPLOAD_DIR, video.filename);
    await streamVideoFile(res, filePath, video.mime_type, req.headers.range);
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
    const filePath = path.join(UPLOAD_DIR, video.filename);
    await streamVideoFile(res, filePath, video.mime_type, req.headers.range);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(404).json({ error: "Video file unavailable." });
    }
  }
}
