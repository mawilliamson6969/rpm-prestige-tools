/**
 * Phase 6: inbox AI cockpit — context panel + AI follow-up suggestions.
 *
 * Three endpoint families on the conversation view:
 *   - GET  /inbox/threads/:thread_id/context        — composite payload
 *   - POST /inbox/threads/:thread_id/notes          — add free-form note
 *   - DELETE /inbox/threads/notes/:note_id          — remove note
 *   - POST /inbox/threads/:thread_id/ai-suggestions — 2–4 follow-up chips
 *
 * Strategy:
 *   - Property/Lease/WorkOrders pulled from existing /property-context
 *     internals via a direct lib call rather than rebuilding the
 *     AppFolio data plumbing.
 *   - Past conversations queried straight off threads.linked_property_name.
 *   - Notes live in thread_entity_notes (Phase 6 migration 033).
 *   - AI suggestions piggyback on the existing Anthropic client used by
 *     the AI draft pipeline. Returns short action chips, not a draft.
 */

import { getPool } from "../lib/db.js";

const ENTITY_KINDS = new Set(["property", "tenant", "owner"]);

function normalizeKey(s) {
  return String(s || "").trim().toLowerCase();
}

/** Look up the thread + permission state. Returns the row + 403/404 res
 *  handling. */
async function loadThreadForUser(req, res) {
  const threadId = String(req.params.thread_id || "").trim();
  if (!threadId) {
    res.status(400).json({ error: "thread_id is required." });
    return null;
  }
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT th.*, ec.mailbox_email
       FROM threads th
       LEFT JOIN email_connections ec ON ec.id = th.connection_id
      WHERE th.thread_id = $1`,
    [threadId]
  );
  if (!rows.length) {
    res.status(404).json({ error: "Thread not found." });
    return null;
  }
  return { thread: rows[0], pool };
}

/* ────────────────────────── Context endpoint ────────────────────────── */

async function fetchPropertyContextSafe(pool, propertyName) {
  if (!propertyName) return null;
  // Reuse the property-context module's heavy lifting. Import lazily
  // since this is the only consumer outside its own route file and we
  // don't want a circular module graph at module-load time.
  const mod = await import("./property-context.js");
  try {
    if (typeof mod.fetchPropertyContextForName === "function") {
      return await mod.fetchPropertyContextForName(pool, propertyName);
    }
    // The route file exports the Express handlers but not the inner
    // builder. Fall back to a thin direct query against the cache.
    const { rows } = await pool.query(
      `SELECT appfolio_data FROM cached_properties
        WHERE LOWER(appfolio_data->>'property_name') = LOWER($1)
           OR LOWER(appfolio_data->>'property_address') = LOWER($1)
        LIMIT 1`,
      [propertyName]
    );
    if (!rows.length) return null;
    return { property: rows[0].appfolio_data, source: "fallback" };
  } catch (e) {
    console.error("[inbox/context] property lookup", e);
    return null;
  }
}

async function fetchWorkOrders(pool, propertyName) {
  if (!propertyName) return [];
  // cached_work_orders is a current snapshot; cached_work_orders_all
  // includes historicals. The panel wants "open + recent".
  const { rows: open } = await pool.query(
    `SELECT appfolio_data FROM cached_work_orders
      WHERE LOWER(appfolio_data->>'property') = LOWER($1)
         OR LOWER(appfolio_data->>'property_name') = LOWER($1)
      LIMIT 10`,
    [propertyName]
  );
  return open.map((r) => {
    const d = r.appfolio_data || {};
    return {
      id: d.work_order_number || d.id || null,
      title: d.work_order_issue || d.title || d.description || "Work order",
      vendor: d.vendor || d.vendor_name || null,
      status: d.status || d.work_order_status || null,
      priority:
        d.priority ||
        (Number(d.priority_rank) >= 80 ? "high" : Number(d.priority_rank) >= 40 ? "med" : "low"),
      date: d.created_at || d.work_order_created || null,
    };
  });
}

async function fetchPastConversations(pool, threadId, propertyName, allowedConnectionIds) {
  if (!propertyName) return [];
  if (!allowedConnectionIds || !allowedConnectionIds.length) return [];
  const { rows } = await pool.query(
    `SELECT thread_id, subject, last_message_at, channel
       FROM threads
      WHERE LOWER(linked_property_name) = LOWER($1)
        AND thread_id <> $2
        AND (connection_id IS NULL OR connection_id = ANY($3::int[]))
      ORDER BY last_message_at DESC
      LIMIT 10`,
    [propertyName, threadId, allowedConnectionIds]
  );
  return rows.map((r) => ({
    threadId: r.thread_id,
    subject: r.subject,
    lastMessageAt: r.last_message_at,
    channel: r.channel || "email",
  }));
}

async function fetchNotes(pool, entityKey) {
  if (!entityKey) return [];
  const { rows } = await pool.query(
    `SELECT n.id, n.entity_kind, n.entity_key, n.body, n.created_at,
            u.display_name AS author_name
       FROM thread_entity_notes n
       LEFT JOIN users u ON u.id = n.author_id
      WHERE n.entity_kind = 'property' AND LOWER(n.entity_key) = LOWER($1)
      ORDER BY n.created_at DESC
      LIMIT 10`,
    [entityKey]
  );
  return rows.map((r) => ({
    id: r.id,
    entityKind: r.entity_kind,
    body: r.body,
    authorName: r.author_name,
    createdAt: r.created_at,
  }));
}

/**
 * GET /inbox/threads/:thread_id/context
 *
 * Shape:
 *   { hasLinkedEntity, property?, lease?, workOrders[], pastConversations[],
 *     notes[], entityKey? }
 */
export async function getInboxThreadContext(req, res) {
  const ctx = await loadThreadForUser(req, res);
  if (!ctx) return;
  const { thread, pool } = ctx;
  try {
    const propertyName = thread.linked_property_name?.trim() || null;
    const tenantName = thread.linked_tenant_name?.trim() || null;
    const ownerName = thread.linked_owner_name?.trim() || null;

    const hasLinkedEntity = !!(propertyName || tenantName || ownerName);
    if (!hasLinkedEntity) {
      res.json({
        hasLinkedEntity: false,
        property: null,
        lease: null,
        workOrders: [],
        pastConversations: [],
        notes: [],
        entityKey: null,
        linkedTenant: null,
        linkedOwner: null,
      });
      return;
    }

    // Allowed connection ids for past-conversation scoping.
    const { rows: permRows } = await pool.query(
      `SELECT DISTINCT ip.connection_id AS id
         FROM inbox_permissions ip
         JOIN email_connections ec ON ec.id = ip.connection_id AND ec.is_active = true
        WHERE ip.user_id = $1`,
      [req.user.id]
    );
    const allowedConnectionIds = permRows.map((r) => r.id);

    const [propertyCtx, workOrders, past, notes] = await Promise.all([
      fetchPropertyContextSafe(pool, propertyName),
      fetchWorkOrders(pool, propertyName),
      fetchPastConversations(pool, thread.thread_id, propertyName, allowedConnectionIds),
      fetchNotes(pool, propertyName),
    ]);

    const property = propertyCtx?.property
      ? {
          name: propertyCtx.property.property_name || propertyName,
          address: propertyCtx.property.property_address || null,
          city: propertyCtx.property.property_city || null,
          state: propertyCtx.property.property_state || null,
          zip: propertyCtx.property.property_zip || null,
          portfolio: propertyCtx.property.portfolio || null,
          beds: propertyCtx.property.bedrooms || null,
          baths: propertyCtx.property.bathrooms || null,
          sqft: propertyCtx.property.square_feet || null,
          type: propertyCtx.property.property_type || null,
        }
      : propertyName
        ? { name: propertyName, address: null }
        : null;

    const lease = propertyCtx?.occupancy
      ? {
          status: propertyCtx.lease?.status || (propertyCtx.occupancy.lease_to ? "Active" : null),
          tenant: propertyCtx.occupancy.tenant_name || tenantName,
          rent: propertyCtx.occupancy.rent || null,
          marketRent: propertyCtx.occupancy.market_rent || null,
          start: propertyCtx.occupancy.lease_from || null,
          end: propertyCtx.occupancy.lease_to || null,
          tenantEmail: propertyCtx.occupancy.tenant_email || null,
          tenantPhone: propertyCtx.occupancy.tenant_phone || null,
          additionalTenants: propertyCtx.occupancy.additional_tenants || null,
        }
      : tenantName
        ? { status: null, tenant: tenantName, rent: null, start: null, end: null }
        : null;

    res.json({
      hasLinkedEntity: true,
      property,
      lease,
      workOrders,
      pastConversations: past,
      notes,
      entityKey: propertyName,
      linkedTenant: tenantName,
      linkedOwner: ownerName,
    });
  } catch (e) {
    console.error("[inbox] context", e);
    res.status(500).json({ error: "Could not load thread context." });
  }
}

/* ────────────────────────── Notes endpoints ────────────────────────── */

/**
 * POST /inbox/threads/:thread_id/notes
 * Body: { body, entityKind? }  entityKind defaults to 'property'.
 *
 * The note is keyed on the thread's linked_<kind>_name.
 */
export async function postInboxThreadNote(req, res) {
  const ctx = await loadThreadForUser(req, res);
  if (!ctx) return;
  const { thread, pool } = ctx;
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  const kindRaw = String(req.body?.entityKind || "property");
  if (!body) return res.status(400).json({ error: "body is required." });
  if (!ENTITY_KINDS.has(kindRaw)) {
    return res.status(400).json({
      error: `entityKind must be one of: ${[...ENTITY_KINDS].join(", ")}.`,
    });
  }
  const entityKey =
    kindRaw === "property"
      ? thread.linked_property_name
      : kindRaw === "tenant"
        ? thread.linked_tenant_name
        : thread.linked_owner_name;
  if (!entityKey) {
    return res.status(400).json({
      error: `Thread has no linked ${kindRaw} to attach a note to.`,
    });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO thread_entity_notes (entity_kind, entity_key, body, author_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, entity_kind, entity_key, body, created_at`,
      [kindRaw, entityKey, body, req.user.id]
    );
    const note = rows[0];
    res.status(201).json({
      note: {
        id: note.id,
        entityKind: note.entity_kind,
        body: note.body,
        authorName: req.user.displayName || req.user.username || null,
        createdAt: note.created_at,
      },
    });
  } catch (e) {
    console.error("[inbox] post note", e);
    res.status(500).json({ error: "Could not add note." });
  }
}

/** DELETE /inbox/threads/notes/:note_id */
export async function deleteInboxThreadNote(req, res) {
  const id = Number(req.params.note_id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid note id." });
  try {
    const pool = getPool();
    // Authors can delete their own notes; admins/owners can delete any.
    const { rows } = await pool.query(
      `SELECT author_id FROM thread_entity_notes WHERE id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Note not found." });
    const isOwn = rows[0].author_id === req.user.id;
    const isElevated = req.user.role === "admin" || req.user.role === "owner";
    if (!isOwn && !isElevated) {
      return res.status(403).json({ error: "Only the author or an admin can delete this note." });
    }
    await pool.query(`DELETE FROM thread_entity_notes WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error("[inbox] delete note", e);
    res.status(500).json({ error: "Could not delete note." });
  }
}

/* ───────────────────── AI follow-up suggestions ─────────────────────── */

const SUGGEST_ACTION_KINDS = new Set([
  "task",
  "work_order",
  "sms",
  "checklist",
  "info",
]);

function fallbackSuggestions(thread) {
  // When we can't reach the model (no key, error, parse failure), return
  // safe defaults derived from the thread's category. Better than an
  // empty pane.
  const cat = (thread.category || "").toLowerCase();
  if (cat === "maintenance") {
    return [
      { label: "Create a follow-up task to confirm vendor scheduling", kind: "task" },
      { label: "Open the AppFolio work order page for this property", kind: "work_order" },
      { label: "Insert a punch-list checklist into the reply", kind: "checklist" },
    ];
  }
  if (cat === "leasing") {
    return [
      { label: "Create a task to follow up on application status", kind: "task" },
      { label: "Send the tenant the application checklist", kind: "checklist" },
    ];
  }
  if (cat === "owner") {
    return [
      { label: "Schedule a 15-minute owner call this week", kind: "task" },
      { label: "Send the standard owner status update", kind: "checklist" },
    ];
  }
  return [
    { label: "Create a follow-up task on this thread", kind: "task" },
    { label: "Insert a 3-bullet checklist into the reply", kind: "checklist" },
  ];
}

async function callClaudeForSuggestions(thread, recentMessages) {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;

  const lastInbound = recentMessages
    .filter((m) => m.direction === "inbound")
    .slice(-1)[0];
  const userPrompt = [
    "You are an assistant helping a property-management operator decide what to do next.",
    "Given the conversation context, return 3 short, concrete follow-up actions.",
    "Each action MUST be one of: task, work_order, sms, checklist, info.",
    "  - task: create an internal task to remember to do X",
    "  - work_order: open AppFolio to create a maintenance work order",
    "  - sms: send a short templated SMS to the tenant",
    "  - checklist: insert a checklist into the operator's reply draft",
    "  - info: surface a fact for the operator to act on manually",
    "",
    "Labels must be under 60 characters, imperative voice, no trailing period.",
    "",
    "Reply with a JSON array of objects: [{label, kind}], NOTHING ELSE.",
    "",
    "── Thread context ──",
    `Subject: ${thread.subject || "(no subject)"}`,
    `Category: ${thread.category || "(uncategorized)"}`,
    `Property: ${thread.linked_property_name || "(no property linked)"}`,
    `Tenant: ${thread.linked_tenant_name || "(no tenant linked)"}`,
    `Status: ${thread.status}`,
    lastInbound?.body_preview
      ? `\nLast inbound message excerpt:\n"""${lastInbound.body_preview.slice(0, 1200)}"""`
      : "",
  ].join("\n");

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        temperature: 0.4,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    const text = body?.content?.[0]?.text;
    if (!text) return null;
    // Strip code fences if the model wrapped the JSON.
    const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    const arr = JSON.parse(cleaned);
    if (!Array.isArray(arr)) return null;
    const out = [];
    for (const it of arr) {
      const label = typeof it?.label === "string" ? it.label.trim() : "";
      const kind = SUGGEST_ACTION_KINDS.has(it?.kind) ? it.kind : "info";
      if (label && label.length <= 80) out.push({ label, kind });
      if (out.length >= 4) break;
    }
    return out.length ? out : null;
  } catch (e) {
    console.warn("[inbox] ai-suggestions claude call failed", e.message);
    return null;
  }
}

/**
 * POST /inbox/threads/:thread_id/ai-suggestions
 *
 * Returns up to 4 follow-up action chips for the open thread. Falls
 * back to category-based defaults when the model is unavailable.
 */
export async function postInboxThreadAiSuggestions(req, res) {
  const ctx = await loadThreadForUser(req, res);
  if (!ctx) return;
  const { thread, pool } = ctx;
  try {
    const { rows: messages } = await pool.query(
      `SELECT direction, body_preview, received_at
         FROM tickets
        WHERE thread_id = $1 AND deleted_at IS NULL
        ORDER BY received_at DESC NULLS LAST, id DESC
        LIMIT 5`,
      [thread.thread_id]
    );
    const fromModel = await callClaudeForSuggestions(thread, messages);
    const suggestions = fromModel ?? fallbackSuggestions(thread);
    res.json({ suggestions, source: fromModel ? "model" : "fallback" });
  } catch (e) {
    console.error("[inbox] ai-suggestions", e);
    res.status(500).json({ error: "Could not load AI suggestions." });
  }
}
