/**
 * Prestige Connect webhook receivers.
 *
 * Every handler is built around the same shape: verify the source's
 * signature (reject 401 on mismatch), extract a stable external_id for
 * dedupe, write one row into the `events` table, return 200 fast. The
 * automation worker takes it from there.
 *
 * AppFolio is handled separately in routes/mbWebhooks.js because it
 * already exists; that handler now also mirrors into `events`.
 */

import crypto from "node:crypto";
import { emitEvent } from "../lib/eventBus.js";

function timingSafeEqualHex(a, b) {
  try {
    const aBuf = Buffer.from(String(a || ""), "hex");
    const bBuf = Buffer.from(String(b || ""), "hex");
    if (aBuf.length === 0 || aBuf.length !== bBuf.length) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

function rawBodyOf(req) {
  if (req.rawBody && Buffer.isBuffer(req.rawBody)) return req.rawBody;
  // Fallback for early requests where the verify hook didn't capture.
  if (req.body == null) return Buffer.alloc(0);
  try {
    return Buffer.from(JSON.stringify(req.body), "utf8");
  } catch {
    return Buffer.alloc(0);
  }
}

// ---------------------------------------------------------------------------
// OpenPhone — POST /webhooks/openphone
// Header: openphone-signature (HMAC-SHA256 of raw body, hex)
// Phase 1 supported types: message.received, call.completed, voicemail.received
// ---------------------------------------------------------------------------

export async function receiveOpenPhoneWebhook(req, res) {
  const secret = process.env.OPENPHONE_WEBHOOK_SECRET?.trim();
  const sig = String(req.headers["openphone-signature"] || "").trim();

  if (secret) {
    const expected = crypto.createHmac("sha256", secret).update(rawBodyOf(req)).digest("hex");
    if (!timingSafeEqualHex(sig, expected)) {
      return res.status(401).json({ error: "Invalid signature." });
    }
  } else if (process.env.NODE_ENV === "production") {
    // Fail-closed in production. In dev we let unsigned requests through
    // so devs can hit the endpoint with curl.
    return res.status(401).json({ error: "OPENPHONE_WEBHOOK_SECRET not configured." });
  }

  // Acknowledge immediately. Anything that throws below is logged but
  // never causes OpenPhone to retry — we already have the payload.
  res.status(200).json({ ok: true });

  try {
    const body = req.body || {};
    const opType = String(body.type || body.event || "").trim(); // e.g. 'message.received'
    if (!opType) return;
    const eventType = `openphone.${opType.toLowerCase()}`;
    const externalId = body.id || body.data?.id || body.data?.object?.id || null;
    emitEvent({
      type: eventType,
      source: "openphone",
      payload: body,
      externalId: externalId ? `${eventType}:${externalId}` : null,
    });
  } catch (err) {
    console.error("[webhook openphone] processing failed:", err.message || err);
  }
}

// ---------------------------------------------------------------------------
// Microsoft Graph — POST /webhooks/ms-graph
// Subscription validation: Graph hits the endpoint with ?validationToken=...
// and expects the token echoed back as plain text within 10 seconds.
// Change notifications: clientState in the payload must match our secret.
// ---------------------------------------------------------------------------

export async function receiveMsGraphWebhook(req, res) {
  // Validation handshake — return the token as text/plain.
  if (req.query?.validationToken) {
    res.set("Content-Type", "text/plain");
    return res.status(200).send(String(req.query.validationToken));
  }

  const expectedClientState = process.env.MS_GRAPH_CLIENT_STATE?.trim();
  const notifications = Array.isArray(req.body?.value) ? req.body.value : [];

  // Acknowledge fast. Any single bad notification is logged but doesn't
  // bring down a whole batch.
  res.status(202).json({ ok: true });

  for (const n of notifications) {
    try {
      if (expectedClientState && n.clientState !== expectedClientState) {
        console.warn("[webhook ms-graph] clientState mismatch — dropping notification");
        continue;
      }
      const resourceType = String(n.resourceData?.["@odata.type"] || "")
        .replace(/^#?microsoft\.graph\./i, "")
        .toLowerCase();
      const change = String(n.changeType || "").toLowerCase();
      // e.g. ms_graph.message.created, ms_graph.event.updated
      const eventType = resourceType
        ? `ms_graph.${resourceType}.${change || "changed"}`
        : `ms_graph.${change || "notification"}`;
      const externalId = n.resourceData?.id || n.resource || null;
      emitEvent({
        type: eventType,
        source: "ms_graph",
        payload: n,
        externalId: externalId ? `${eventType}:${externalId}` : null,
      });
    } catch (err) {
      console.error("[webhook ms-graph] notification failed:", err.message || err);
    }
  }
}
