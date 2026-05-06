/**
 * Phase 5: filesystem layer for inbox attachments.
 *
 * Storage root defaults to /app/uploads/inbox-attachments inside the
 * container (the existing `backend_uploads` Docker volume). Override with
 * INBOX_ATTACHMENT_ROOT for tests / non-Docker hosts.
 *
 * Path layout:
 *   ROOT/{yyyy}/{mm}/{thread_id_safe}/{uuid}-{filename}
 * Filename gets a UUID prefix so multiple attachments with the same
 * original filename can coexist; the user-facing filename comes from the
 * `attachments.filename` DB column on download.
 *
 * Allowlist enforces both extension AND MIME type. Filenames pass through
 * a strict sanitizer before they ever land on disk so a hostile sender
 * can't traverse out of the storage root.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const ROOT =
  process.env.INBOX_ATTACHMENT_ROOT ||
  path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "uploads", "inbox-attachments");

/** 25 MB total per send (Graph's hard cap is 35 MB; we leave headroom). */
export const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
/** Per-file inline cap: Graph rejects fileAttachment > 3 MB without an
 *  upload session. Anything larger needs the upload-session protocol,
 *  which is a follow-up. */
export const MAX_INLINE_BYTES = 3 * 1024 * 1024;
/** Eager-vs-lazy threshold for inbound. Anything above this gets fetched
 *  on demand when the user opens the thread, not during sync. */
export const EAGER_FETCH_BYTES = 1 * 1024 * 1024;

/** Allowed extensions (case-insensitive, no leading dot). */
const ALLOW_EXT = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "png", "jpg", "jpeg", "gif", "bmp", "webp", "heic", "heif", "tif", "tiff",
  "txt", "csv", "log", "md", "rtf",
  "zip", "ics",
  "eml", "msg",
]);
/** Hard-block list — even if the client lies about MIME, never accept these. */
const BLOCK_EXT = new Set([
  "exe", "bat", "scr", "cmd", "com", "vbs", "vbe", "ps1", "psm1", "psd1",
  "sh", "bash", "zsh", "csh", "ksh", "fish",
  "app", "dmg", "pkg", "msi", "deb", "rpm", "apk", "ipa",
  "jar", "js", "jse", "wsf", "wsh", "lnk", "ade", "adp", "msc",
]);

/** MIME type allowlist — each maps to a canonical extension we accept.
 *  Used as a sanity check against the file extension. */
const ALLOW_MIME_TO_EXT = new Map([
  ["application/pdf", "pdf"],
  ["application/msword", "doc"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
  ["application/vnd.ms-excel", "xls"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
  ["application/vnd.ms-powerpoint", "ppt"],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx"],
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/gif", "gif"],
  ["image/bmp", "bmp"],
  ["image/webp", "webp"],
  ["image/heic", "heic"],
  ["image/heif", "heif"],
  ["image/tiff", "tif"],
  ["text/plain", "txt"],
  ["text/csv", "csv"],
  ["text/markdown", "md"],
  ["application/rtf", "rtf"],
  ["application/zip", "zip"],
  ["text/calendar", "ics"],
  ["message/rfc822", "eml"],
  ["application/vnd.ms-outlook", "msg"],
  ["application/octet-stream", null], // common Graph MIME — fall back to extension
]);

export function rootDir() {
  return ROOT;
}

export async function ensureRoot() {
  await fs.mkdir(ROOT, { recursive: true });
}

function sanitizeFilename(name) {
  const base = String(name || "attachment").trim().replace(/[\x00-\x1f\x7f]/g, "");
  // Strip directory separators + any leading dots so we never emit a
  // dotfile or path-fragment from user input.
  const noPath = base.replace(/[\\/]+/g, "_").replace(/^\.+/, "");
  // Cap at 200 chars to keep paths sane on every filesystem.
  return noPath.slice(0, 200) || "attachment";
}

function extOf(name) {
  const m = String(name || "").toLowerCase().match(/\.([a-z0-9]{1,6})$/);
  return m ? m[1] : "";
}

/** Sanitize a Graph thread_id for use as a directory name.
 *  Graph conversation ids are base64-ish and may contain `/` `+` `=`. */
function sanitizeThreadDirName(threadId) {
  if (!threadId) return "_unknown";
  const safe = String(threadId).replace(/[^A-Za-z0-9_-]/g, "_");
  return safe.slice(0, 200) || "_unknown";
}

/** Validate a filename + content type. Returns { ok: true } on success or
 *  { ok: false, error } when the file should be rejected. */
export function validateAttachment({ filename, contentType, size }) {
  const ext = extOf(filename);
  if (!ext) {
    return { ok: false, error: `"${filename}" has no recognizable extension.` };
  }
  if (BLOCK_EXT.has(ext)) {
    return { ok: false, error: `${ext.toUpperCase()} files are blocked.` };
  }
  if (!ALLOW_EXT.has(ext)) {
    return { ok: false, error: `${ext.toUpperCase()} files aren't allowed. Convert to PDF or use a supported format.` };
  }
  // MIME cross-check: if the client supplied one and it's in our map, the
  // canonical extension must agree (or be NULL = "trust the extension").
  if (contentType) {
    const canonical = ALLOW_MIME_TO_EXT.get(String(contentType).toLowerCase());
    if (canonical === undefined) {
      // Unknown MIME — accept on extension alone since email clients emit
      // a wide variety of types ("application/x-pdf" etc.).
    } else if (canonical !== null && canonical !== ext && !(canonical === "jpg" && ext === "jpeg")) {
      return { ok: false, error: `MIME ${contentType} doesn't match .${ext}.` };
    }
  }
  if (size != null && Number(size) > MAX_TOTAL_BYTES) {
    return { ok: false, error: `${filename} is over the 25 MB cap.` };
  }
  return { ok: true };
}

/**
 * Compose a target path for a new attachment write. Doesn't create the
 * file — caller passes the result to `writeBuffer` or hands it to multer.
 */
export function buildStorageRelPath({ threadId, filename, when = new Date() }) {
  const yyyy = String(when.getUTCFullYear());
  const mm = String(when.getUTCMonth() + 1).padStart(2, "0");
  const dir = path.posix.join(yyyy, mm, sanitizeThreadDirName(threadId));
  const safe = sanitizeFilename(filename);
  return path.posix.join(dir, `${randomUUID()}-${safe}`);
}

export function absolutePathFor(relPath) {
  if (!relPath || typeof relPath !== "string") {
    throw new Error("relPath is required");
  }
  const resolved = path.resolve(ROOT, relPath);
  // Defense-in-depth: refuse paths that would escape ROOT.
  if (!resolved.startsWith(path.resolve(ROOT) + path.sep) && resolved !== path.resolve(ROOT)) {
    throw new Error("attachment path escapes storage root");
  }
  return resolved;
}

/** Write a buffer to a fresh path under the storage root. Returns the
 *  relative path (the value to persist in attachments.storage_path). */
export async function writeBuffer({ threadId, filename, when, buffer }) {
  await ensureRoot();
  const rel = buildStorageRelPath({ threadId, filename, when });
  const abs = absolutePathFor(rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buffer);
  return rel;
}

/** Move a file already on disk (e.g. from multer) into the canonical
 *  layout. Returns the relative path. */
export async function adoptFile({ threadId, filename, when, srcAbsolutePath }) {
  await ensureRoot();
  const rel = buildStorageRelPath({ threadId, filename, when });
  const abs = absolutePathFor(rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.rename(srcAbsolutePath, abs);
  return rel;
}

export async function readBuffer(relPath) {
  return fs.readFile(absolutePathFor(relPath));
}

export async function statFile(relPath) {
  return fs.stat(absolutePathFor(relPath));
}

export async function unlinkFile(relPath) {
  try {
    await fs.unlink(absolutePathFor(relPath));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
