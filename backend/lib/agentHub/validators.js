/**
 * Shared validators for Agent Hub routes. Each throws a 400-marked Error
 * (Object.assign(new Error(msg), { http: 400 })) — handlers catch & respond.
 */

export const TIERS = new Set(["cold", "prospect", "warm", "partner", "vip", "dormant"]);
export const STATUSES = new Set(["active", "paused", "dnc", "skipped", "converted", "deleted"]);
export const CHANNELS = new Set(["email", "text", "call", "mail"]);
export const NICHES = new Set(["luxury", "first_time", "investor", "leases", "relocation", "multi", "other"]);
export const SOURCES = new Set([
  "manual",
  "mls_listing",
  "linkedin",
  "event",
  "referral_from_agent",
  "website_form",
  "other",
]);
export const ACTIVITY_TYPES = new Set([
  "email_sent",
  "email_received",
  "call_made",
  "call_received",
  "text_sent",
  "text_received",
  "postcard_sent",
  "letter_sent",
  "gift_sent",
  "meeting_in_person",
  "event_attended",
  "note_added",
  "system_event",
]);
export const DIRECTIONS = new Set(["inbound", "outbound", "internal"]);
export const RELATIONSHIP_TYPES = new Set(["team", "mentor", "mentee", "spouse", "competitor", "friend", "other"]);
export const HUB_ROLES = new Set(["owner", "manager", "team", "outreach", "read_only"]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZIP_RE = /^\d{5}(-\d{4})?$/;
// Texas license is typically 6-7 digits, but we allow 4-10 to accept legacy formats and other states.
const LICENSE_RE = /^[A-Za-z0-9-]{3,15}$/;

function bad(msg) {
  return Object.assign(new Error(msg), { http: 400 });
}

export function vEmail(v, { allowNull = true } = {}) {
  if (v == null || v === "") {
    if (allowNull) return null;
    throw bad("email is required.");
  }
  const s = String(v).trim().toLowerCase();
  if (!EMAIL_RE.test(s)) throw bad("email format is invalid.");
  if (s.length > 254) throw bad("email is too long.");
  return s;
}

export function vPhone(v, { allowNull = true } = {}) {
  if (v == null || v === "") {
    if (allowNull) return null;
    throw bad("phone is required.");
  }
  const s = String(v).trim();
  if (s.length > 50) throw bad("phone is too long.");
  const digits = s.replace(/[^\d]/g, "");
  if (digits.length < 10 || digits.length > 15) {
    throw bad("phone must be 10-15 digits.");
  }
  // Normalize US: bare 10 digits → +1XXXXXXXXXX, 11 starting with 1 → +1XXXXXXXXXX.
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  // International (12-15 digits): user must have included a country code.
  // Require an explicit '+' prefix to disambiguate; otherwise reject.
  if (!s.startsWith("+")) {
    throw bad("phone must start with + and country code (or be a 10/11-digit US number).");
  }
  return `+${digits}`;
}

export function vZip(v, { allowNull = true } = {}) {
  if (v == null || v === "") {
    if (allowNull) return null;
    throw bad("zip is required.");
  }
  const s = String(v).trim();
  if (!ZIP_RE.test(s)) throw bad("zip must be 5 or 9-digit US format.");
  return s;
}

export function vLicense(v, { allowNull = true } = {}) {
  if (v == null || v === "") {
    if (allowNull) return null;
    throw bad("license_number is required.");
  }
  const s = String(v).trim().toUpperCase();
  if (!LICENSE_RE.test(s)) throw bad("license_number format is invalid.");
  return s;
}

export function vEnum(v, set, label, { allowNull = true } = {}) {
  if (v == null || v === "") {
    if (allowNull) return null;
    throw bad(`${label} is required.`);
  }
  const s = String(v);
  if (!set.has(s)) throw bad(`${label} is invalid.`);
  return s;
}

export function vTier(v, opts) {
  return vEnum(v, TIERS, "tier", opts);
}

export function vStatus(v, opts) {
  return vEnum(v, STATUSES, "status", opts);
}

export function vChannel(v, opts) {
  return vEnum(v, CHANNELS, "preferred_channel", opts);
}

export function vNiche(v, opts) {
  return vEnum(v, NICHES, "niche", opts);
}

export function vSource(v, opts) {
  return vEnum(v, SOURCES, "source", opts);
}

export function vActivityType(v) {
  return vEnum(v, ACTIVITY_TYPES, "type", { allowNull: false });
}

export function vDirection(v) {
  return vEnum(v, DIRECTIONS, "direction", { allowNull: false });
}

export function vRelationshipType(v) {
  return vEnum(v, RELATIONSHIP_TYPES, "relationship_type", { allowNull: false });
}

export function vHubRole(v) {
  return vEnum(v, HUB_ROLES, "role", { allowNull: false });
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

export function vIntId(v, label = "id") {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    throw bad(`${label} is invalid.`);
  }
  return n;
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

export function vNumOpt(v, label, { min = null } = {}) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw bad(`${label} must be a number.`);
  if (min != null && n < min) throw bad(`${label} must be >= ${min}.`);
  return n;
}

export function vStringOpt(v, { maxLen = 1000 } = {}) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.length > maxLen) throw bad(`Value too long (max ${maxLen}).`);
  return s;
}

export function vStringReq(v, label, { maxLen = 1000 } = {}) {
  if (v == null) throw bad(`${label} is required.`);
  const s = String(v).trim();
  if (!s) throw bad(`${label} is required.`);
  if (s.length > maxLen) throw bad(`${label} too long (max ${maxLen}).`);
  return s;
}

export function vZipArray(v) {
  if (v == null) return [];
  if (!Array.isArray(v)) throw bad("target_zips must be an array.");
  return v
    .map((z) => {
      const s = String(z).trim();
      if (!s) return null;
      if (!ZIP_RE.test(s)) throw bad(`Invalid zip in target_zips: ${s}`);
      return s;
    })
    .filter(Boolean);
}

export function vTagsArray(v) {
  if (v == null) return [];
  if (!Array.isArray(v)) throw bad("tags must be an array.");
  return v
    .map((t) => {
      const s = String(t).trim();
      if (!s) return null;
      if (s.length > 64) throw bad(`Tag too long: ${s}`);
      return s;
    })
    .filter(Boolean);
}

export function vDate(v, label, { allowNull = true } = {}) {
  if (v == null || v === "") {
    if (allowNull) return null;
    throw bad(`${label} is required.`);
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw bad(`${label} is not a valid date.`);
  return d.toISOString().slice(0, 10);
}

export function vTimestamp(v, label, { allowNull = true } = {}) {
  if (v == null || v === "") {
    if (allowNull) return null;
    throw bad(`${label} is required.`);
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw bad(`${label} is not a valid timestamp.`);
  return d.toISOString();
}

// Allowed schemes for stored URLs. Reject `javascript:` and `data:` to
// prevent XSS-via-href when these strings get rendered as <a href={...}>.
const URL_SCHEME_RE = /^(https?:)?\/\//i;
const URL_DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+/i;

export function vUrl(v, { allowNull = true } = {}) {
  if (v == null || v === "") {
    if (allowNull) return null;
    throw bad("URL is required.");
  }
  const s = String(v).trim();
  if (s.length > 1024) throw bad("URL is too long.");
  // Block dangerous schemes outright.
  if (/^javascript:/i.test(s) || /^data:/i.test(s) || /^vbscript:/i.test(s) || /^file:/i.test(s)) {
    throw bad("URL scheme not allowed.");
  }
  // Accept full URLs (http/https) or bare domains (e.g. "linkedin.com/in/x").
  // Anything that has a colon but isn't http(s) is rejected.
  if (s.includes(":") && !URL_SCHEME_RE.test(s)) {
    throw bad("URL must use http or https.");
  }
  if (!URL_SCHEME_RE.test(s) && !URL_DOMAIN_RE.test(s)) {
    throw bad("URL must be a valid http(s) URL or domain.");
  }
  return s;
}
