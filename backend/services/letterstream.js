/**
 * LetterStream API integration.
 *
 * Auth pattern (per LetterStream API docs):
 *   unique_id (`t`) is a 10–18 digit, single-use integer (we use Date.now() in ms, 13 digits).
 *   hash (`h`) is md5(base64(last6(t) + api_key + first6(t))).
 *
 * Every API call POSTs application/x-www-form-urlencoded (or multipart when uploading a file)
 * with a, h, t plus call-specific fields. We force JSON responses with responseformat=json.
 *
 * All functions return { success, code, message, data } so callers can handle uniformly.
 * On network error or non-JSON parse failure (signature PDF stream excepted): success=false, code='NETWORK'.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIGNATURES_DIR = path.join(__dirname, "..", "uploads", "signatures");

const BASE_URL = () =>
  (process.env.LETTERSTREAM_BASE_URL || "https://www.letterstream.com/apis/").replace(/\/?$/, "/");
const API_ID = () => process.env.LETTERSTREAM_API_ID || "";
const API_KEY = () => process.env.LETTERSTREAM_API_KEY || "";
const TEST_MODE = () => String(process.env.LETTERSTREAM_TEST_MODE || "true").toLowerCase() === "true";

/* ----------------------------- auth ----------------------------- */

let lastUniqueId = 0;
function nextUniqueId() {
  // LetterStream: 10–18 digit integer, must be unique per request.
  let id = Date.now();
  if (id <= lastUniqueId) id = lastUniqueId + 1;
  lastUniqueId = id;
  return String(id);
}

export function buildAuth() {
  const uniqueId = nextUniqueId();
  const last6 = uniqueId.slice(-6);
  const first6 = uniqueId.slice(0, 6);
  const stringToHash = last6 + API_KEY() + first6;
  const base64 = Buffer.from(stringToHash, "utf8").toString("base64");
  const hash = crypto.createHash("md5").update(base64).digest("hex");
  return { a: API_ID(), h: hash, t: uniqueId };
}

/* ------------------------ status code mapping ------------------------ */

export const CODE_MAP = {
  "-100": { status: "sent", message: "Submitted successfully (live)" },
  "-105": { status: "sent_test", message: "Submitted successfully (TEST mode — will not mail)" },
  "-200": { status: "preauth_pending", message: "Preauthorization quoted, awaiting confirmation" },
  "-101": { status: "failed_funding", message: "Insufficient account funds" },
  "-911": { status: "failed_funding", message: "Account billing error" },
  "1":    { status: "delivered", message: "Delivered" },
  "0":    { status: "in_production", message: "Queued / in production" },
  "-104": { status: "in_production", message: "In production" },
  "-150": { status: "mailed", message: "Mailed (handed to USPS)" },
  "-1":   { status: "needs_attention", message: "Needs attention" },
  "-2":   { status: "deleted", message: "Deleted on LetterStream" },
  "-300": { status: "address_warning", message: "Address warning" },
};

export function codeToStatus(code) {
  const c = String(code ?? "");
  if (CODE_MAP[c]) return CODE_MAP[c];
  if (/^-9/.test(c) && c !== "-911") return { status: "failed", message: `LetterStream error ${c}` };
  return { status: "needs_attention", message: `Unknown LetterStream code ${c}` };
}

/* Map USPS scan codes from webhook payload to a higher-level mail_status enum value.
   See https://about.usps.com/publications/pub97/pub97_appi.htm */
export function uspsScanCodeToStatus(scanCode) {
  const c = String(scanCode || "").trim();
  // delivered
  if (c === "01" || c === "1" || c === "OF") return "delivered";
  // out for delivery / arrival at unit
  if (["07", "17", "AR", "OD"].includes(c)) return "out_for_delivery";
  // returns & undeliverables
  if (["21", "22", "23", "24", "25", "26", "27", "28", "30"].includes(c)) return "returned";
  // attempted but no recipient
  if (["02", "03", "53", "55"].includes(c)) return "attempted";
  // failure / problem (anything starting with E, 1x exception range)
  if (/^E/i.test(c)) return "failed";
  // accepted / mailed
  if (["MA", "PU", "AC"].includes(c)) return "mailed";
  // in transit otherwise
  return "in_transit";
}

/* ----------------------------- HTTP core ----------------------------- */

async function postForm(fields, { multipartFile = null } = {}) {
  const url = BASE_URL();
  let body;
  let headers = {};

  if (multipartFile) {
    // node 18+ has global FormData/Blob via undici
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) {
        for (const item of v) fd.append(k, String(item));
      } else {
        fd.append(k, String(v));
      }
    }
    const blob = new Blob([multipartFile.buffer], { type: multipartFile.type || "application/pdf" });
    fd.append(multipartFile.fieldName || "single_file", blob, multipartFile.filename || "letter.pdf");
    body = fd;
    // fetch sets Content-Type with boundary automatically
  } else {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) {
        for (const item of v) params.append(k, String(item));
      } else {
        params.append(k, String(v));
      }
    }
    body = params;
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }

  try {
    const resp = await fetch(url, { method: "POST", body, headers });
    const text = await resp.text();

    // Some endpoints (signature download) stream PDF; signal raw to caller
    if (text.startsWith("%PDF")) {
      return { __raw: true, buffer: Buffer.from(text, "binary"), text };
    }

    try {
      const data = JSON.parse(text);
      return { __raw: false, data, text };
    } catch (_e) {
      // Could be base64-encoded binary, or XML if responseformat=json was missed
      return { __raw: true, buffer: Buffer.from(text, "utf8"), text };
    }
  } catch (e) {
    console.error("[letterstream] network", e.message);
    return { __error: e.message || "Network error" };
  }
}

function stringifyMessage(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function parseSubmitResponse(resp) {
  if (resp.__error) return { success: false, code: "NETWORK", message: stringifyMessage(resp.__error), data: null };
  if (resp.__raw) {
    // Non-JSON body — LetterStream returned HTML or unexpected stream
    const snippet = (resp.text || "").slice(0, 200);
    return { success: false, code: "PARSE", message: `Non-JSON response: ${snippet}`, data: null };
  }
  const data = resp.data || {};
  const code = data.code != null ? String(data.code) : "UNKNOWN";
  // `details` is normally a string but with debug=3 LetterStream can return an object — flatten it.
  const message = stringifyMessage(data.details ?? data.message);
  const ok = ["-100", "-105", "-200"].includes(code);
  return { success: ok, code, message, data };
}

/* ----------------------------- public API ----------------------------- */

/** Build "Name1:Name2:Addr1:Addr2:City:State:Zip" with empty slots preserved. */
function fmtAddress({ name1 = "", name2 = "", addr1 = "", addr2 = "", city = "", state = "", zip = "" } = {}) {
  // Per LetterStream: each Name field max 20 chars.
  const trim20 = (s) => String(s || "").slice(0, 20);
  return [trim20(name1), trim20(name2), addr1, addr2, city, state, zip]
    .map((s) => String(s ?? "").replace(/:/g, " "))
    .join(":");
}

/**
 * Build a LetterStream identifier that:
 *  - starts with `prefix`
 *  - is at least `minTotal` chars (LetterStream rejects job names < 8 chars)
 *  - is at most `maxTotal` chars
 *  - contains only [a-zA-Z0-9_-]
 *  - is unique across retries by appending the last 6 digits of Date.now()
 */
function shortIdSafe(prefix, value, { minTotal = 8, maxTotal = 20, alnumOnly = false } = {}) {
  const cleaned = String(value).replace(/[^a-zA-Z0-9]/g, "");
  // Append last 6 digits of Date.now() so retries don't collide.
  // Separator is "_" for job names; for alnumOnly identifiers (doc) we skip it.
  const sep = alnumOnly ? "" : "_";
  const tailSuffix = `${sep}${String(Date.now()).slice(-6)}`;
  const reserved = tailSuffix.length;
  const idBudget = Math.max(0, maxTotal - prefix.length - reserved);
  const truncatedId = cleaned.slice(0, idBudget);
  // Pad the id portion with leading zeros so prefix+id+tail meets the minimum length
  const minIdLen = Math.max(0, minTotal - prefix.length - reserved);
  const paddedId = truncatedId.padStart(minIdLen, "0");
  return `${prefix}${paddedId}${tailSuffix}`.slice(0, maxTotal);
}

const LS_MAIL_TYPE_MAP = {
  certified_return_receipt: "certified",      // certified WITH electronic return receipt
  certified: "certnoerr",                     // certified WITHOUT return receipt
  first_class: "firstclass",
  first_class_hse: "firstclass_hse",
  flat: "flat",
  priority: "firstclass",                     // LS doesn't have a priority class — closest is firstclass
  postcard: "postcard",
  marketing: "firstclass",                    // marketing class uses firstclass with bulk
};

/**
 * submitMailer — submit a mailer to LetterStream.
 *
 * @param {Object} mailer — the mailers row (snake_case)
 * @param {Object} opts
 * @param {Buffer} opts.pdfBuffer — generated PDF for the letter
 * @param {number} opts.pageCount — page count of the PDF (LetterStream requires)
 * @param {boolean} [opts.preauth] — if true, requests a price quote instead of mailing immediately
 *
 * On -100/-105/-200 success, returns parsed `data` with code, batch, quantity, cost, doc[], authcode.
 */
export async function submitMailer(mailer, { pdfBuffer, pageCount, preauth = false } = {}) {
  if (!API_ID() || !API_KEY()) {
    return { success: false, code: "NOT_CONFIGURED", message: "LetterStream API credentials missing.", data: null };
  }
  if (!pdfBuffer || !pageCount) {
    return { success: false, code: "BAD_REQUEST", message: "pdfBuffer and pageCount are required.", data: null };
  }

  const auth = buildAuth();
  // job name: LetterStream requires 8–20 chars, [a-zA-Z0-9_-]. Pad short IDs and tail with
  // last 6 digits of Date.now() so retries don't collide.
  // Example for mailer id=6: pd_000006_851234 → 15 chars.
  const jobName = shortIdSafe("pd_", mailer.id, { minTotal: 8, maxTotal: 20 });
  // doc identifier: max 20 alphanumeric only — no underscore separator.
  // Example for mailer id=6: d0000006851234 → 14 chars.
  const docName = shortIdSafe("d", mailer.id, { minTotal: 8, maxTotal: 20, alnumOnly: true });

  const fromStr = fmtAddress({
    name1: mailer.sender_name || "Real Property Management Prestige",
    name2: "",
    addr1: mailer.sender_address || "4811 Hwy 6 N, Suite B",
    addr2: "",
    city: mailer.sender_city || "Houston",
    state: mailer.sender_state || "TX",
    zip: mailer.sender_zip || "77084",
  });

  const toStr =
    `${docName}:` +
    fmtAddress({
      name1: mailer.recipient_name,
      name2: "",
      addr1: mailer.recipient_address,
      addr2: "",
      city: mailer.recipient_city,
      state: mailer.recipient_state,
      zip: mailer.recipient_zip,
    });

  const mailtype = LS_MAIL_TYPE_MAP[mailer.mail_type] || "firstclass";

  const fields = {
    ...auth,
    job: jobName,
    from: fromStr,
    "to[]": [toStr],
    pages: pageCount,
    mailtype,
    coversheet: "Y",
    duplex: pageCount > 1 ? "Y" : "N",
    ink: "B",
    paper: "W",
    returnenv: mailer.include_return_envelope ? "9RWS" : "N",
    debug: process.env.NODE_ENV === "production" ? "" : "3",
    responseformat: "json",
  };
  if (preauth) fields.preauth = "1";
  if (TEST_MODE()) fields.test = "1";

  const resp = await postForm(fields, {
    multipartFile: {
      fieldName: "single_file",
      buffer: pdfBuffer,
      filename: `${jobName}.pdf`,
      type: "application/pdf",
    },
  });
  return parseSubmitResponse(resp);
}

/**
 * confirmPreauth — release a preauthorized job into production using the authcode.
 */
export async function confirmPreauth(authcode) {
  if (!authcode) return { success: false, code: "BAD_REQUEST", message: "authcode is required.", data: null };
  const auth = buildAuth();
  const resp = await postForm({
    ...auth,
    doauth: authcode,
    responseformat: "json",
    debug: process.env.NODE_ENV === "production" ? "" : "3",
  });
  return parseSubmitResponse(resp);
}

export async function getJobStatus(jobId) {
  if (!jobId) return { success: false, code: "BAD_REQUEST", message: "jobId is required.", data: null };
  const auth = buildAuth();
  const resp = await postForm({ ...auth, jobstatus: jobId, responseformat: "json" });
  if (resp.__error) return { success: false, code: "NETWORK", message: resp.__error, data: null };
  const data = resp.data || {};
  return { success: true, code: String(data.code ?? ""), message: data.details || "", data };
}

export async function getDocStatus(docId) {
  if (!docId) return { success: false, code: "BAD_REQUEST", message: "docId is required.", data: null };
  const auth = buildAuth();
  const resp = await postForm({ ...auth, docstatus: docId, responseformat: "json" });
  if (resp.__error) return { success: false, code: "NETWORK", message: resp.__error, data: null };
  const data = resp.data || {};
  return { success: true, code: String(data.code ?? ""), message: data.details || "", data };
}

export async function getTracking(docId) {
  if (!docId) return { success: false, code: "BAD_REQUEST", message: "docId is required.", data: null };
  const auth = buildAuth();
  const resp = await postForm({
    ...auth,
    doc_id: docId,
    getinfo: "trackx",
    responseformat: "json",
  });
  if (resp.__error) return { success: false, code: "NETWORK", message: resp.__error, data: null };
  const data = resp.data || {};
  return { success: true, code: String(data.code ?? ""), message: data.details || "", data };
}

/**
 * getSignatureFile — fetch signature PDF for delivered certified mail.
 * Saves to /uploads/signatures/<trackingNumber>.pdf and returns the file path.
 *
 * IMPORTANT: this endpoint returns RAW binary PDF data — do NOT request json format.
 */
export async function getSignatureFile(trackingNumber) {
  if (!trackingNumber) {
    return { success: false, code: "BAD_REQUEST", message: "tracking number required.", data: null };
  }
  const auth = buildAuth();
  // Do NOT set responseformat=json here — endpoint streams binary
  const resp = await postForm({ ...auth, cert: trackingNumber, getinfo: "sig" });
  if (resp.__error) return { success: false, code: "NETWORK", message: resp.__error, data: null };

  let pdfBuffer = null;
  if (resp.__raw && resp.buffer && resp.text?.startsWith("%PDF")) {
    pdfBuffer = resp.buffer;
  } else if (resp.text && resp.text.length > 200 && !resp.text.startsWith("{")) {
    // Likely base64 encoded
    try {
      const decoded = Buffer.from(resp.text, "base64");
      if (decoded.slice(0, 4).toString() === "%PDF") pdfBuffer = decoded;
    } catch (_e) {
      /* ignore */
    }
  } else if (resp.data && resp.data.code) {
    return {
      success: false,
      code: String(resp.data.code),
      message: resp.data.details || "Signature not available",
      data: resp.data,
    };
  }

  if (!pdfBuffer) {
    return { success: false, code: "PARSE", message: "Could not parse signature PDF.", data: null };
  }

  await fs.promises.mkdir(SIGNATURES_DIR, { recursive: true });
  const filename = `${String(trackingNumber).replace(/[^a-zA-Z0-9]/g, "")}.pdf`;
  const filePath = path.join(SIGNATURES_DIR, filename);
  await fs.promises.writeFile(filePath, pdfBuffer);

  return {
    success: true,
    code: "OK",
    message: "Signature saved.",
    data: { path: filePath, filename, relativePath: `/uploads/signatures/${filename}` },
  };
}

export async function getAccountBalance() {
  if (!API_ID() || !API_KEY()) {
    return { success: false, code: "NOT_CONFIGURED", message: "LetterStream credentials missing.", data: null };
  }
  const auth = buildAuth();
  const resp = await postForm({ ...auth, accountstatus: "1", responseformat: "json" });
  if (resp.__error) return { success: false, code: "NETWORK", message: resp.__error, data: null };
  const data = resp.data || {};
  // LetterStream returns balance in dollars (string); normalize to cents.
  const balanceCents = data.balance != null ? Math.round(parseFloat(String(data.balance)) * 100) : null;
  return {
    success: true,
    code: String(data.code ?? "0"),
    message: data.details || "",
    data: { ...data, balanceCents },
  };
}
