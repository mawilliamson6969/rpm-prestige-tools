/**
 * Shared validators for Monday-style board (mb_) routes. Each throws a
 * 400-marked Error (Object.assign(new Error(msg), { http: 400 })) — handlers
 * catch and respond. Mirrors lib/agentHub/validators.js conventions.
 */

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export const BOARD_VIEWS = new Set([
  "table",
  "dashboard",
  "calendar",
  "kanban",
  "workload",
  "map",
]);

export const COLUMN_TYPES = new Set([
  "text",
  "status",
  "priority",
  "date",
  "money",
  "person",
  "tags",
  "number",
  "score",
  "longtext",
  "url",
  "file",
]);

export const SUBITEM_STATUSES = new Set([
  "pending",
  "in_progress",
  "done",
  "blocked",
  "skipped",
]);

export const UPDATE_TYPES = new Set([
  "comment",
  "status_change",
  "system",
  "appfolio_sync",
]);

function bad(msg) {
  return Object.assign(new Error(msg), { http: 400 });
}

export function vIntId(v, label = "id") {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    throw bad(`${label} is invalid.`);
  }
  return n;
}

export function vIntIdOpt(v, label = "id") {
  if (v == null || v === "") return null;
  return vIntId(v, label);
}

export function vStringReq(v, label, { maxLen = 1000 } = {}) {
  if (v == null) throw bad(`${label} is required.`);
  const s = String(v).trim();
  if (!s) throw bad(`${label} is required.`);
  if (s.length > maxLen) throw bad(`${label} too long (max ${maxLen}).`);
  return s;
}

export function vStringOpt(v, { maxLen = 1000 } = {}) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.length > maxLen) throw bad(`Value too long (max ${maxLen}).`);
  return s;
}

export function vSlug(v, label = "slug") {
  const s = vStringReq(v, label, { maxLen: 64 }).toLowerCase();
  if (!SLUG_RE.test(s)) {
    throw bad(`${label} must be lowercase alphanumeric with optional hyphens.`);
  }
  return s;
}

export function vBoardView(v, { allowNull = true } = {}) {
  if (v == null || v === "") {
    if (allowNull) return null;
    throw bad("default_view is required.");
  }
  const s = String(v);
  if (!BOARD_VIEWS.has(s)) throw bad("default_view is invalid.");
  return s;
}

export function vColumnType(v) {
  const s = String(v ?? "");
  if (!COLUMN_TYPES.has(s)) throw bad("column_type is invalid.");
  return s;
}

export function vSubitemStatus(v, { allowNull = true } = {}) {
  if (v == null || v === "") {
    if (allowNull) return null;
    throw bad("status is required.");
  }
  const s = String(v);
  if (!SUBITEM_STATUSES.has(s)) throw bad("status is invalid.");
  return s;
}

export function vUpdateType(v, { allowNull = true } = {}) {
  if (v == null || v === "") {
    if (allowNull) return null;
    throw bad("update_type is invalid.");
  }
  const s = String(v);
  if (!UPDATE_TYPES.has(s)) throw bad("update_type is invalid.");
  return s;
}

export function vBool(v, { allowNull = true } = {}) {
  if (v == null) {
    if (allowNull) return null;
    throw bad("boolean required.");
  }
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  throw bad("boolean required.");
}

export function vIntOpt(v, label, { min = null, max = null } = {}) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw bad(`${label} must be an integer.`);
  }
  if (min != null && n < min) throw bad(`${label} must be >= ${min}.`);
  if (max != null && n > max) throw bad(`${label} must be <= ${max}.`);
  return n;
}

export function vNumOpt(v, label) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw bad(`${label} must be a number.`);
  return n;
}

/**
 * Validate an arbitrary JSON object/array. Returns the parsed value as-is.
 * Rejects strings (caller should JSON.parse first if accepting wire format).
 */
export function vJson(v, label, { allowNull = true, requireObject = false } = {}) {
  if (v == null) {
    if (allowNull) return null;
    throw bad(`${label} is required.`);
  }
  if (typeof v !== "object") {
    throw bad(`${label} must be a JSON object${requireObject ? "" : " or array"}.`);
  }
  if (requireObject && Array.isArray(v)) {
    throw bad(`${label} must be a JSON object.`);
  }
  return v;
}

export function vTimestampOpt(v, label) {
  if (v == null || v === "") return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw bad(`${label} is not a valid timestamp.`);
  return d.toISOString();
}
