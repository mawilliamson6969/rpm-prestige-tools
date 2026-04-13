import Anthropic from "@anthropic-ai/sdk";
import { getPool } from "../db.js";

const MODEL = "claude-sonnet-4-20250514";

const SYSTEM_PROMPT = `You are drafting an email reply for RPM Prestige, a professional property management company in Houston, TX. Your role is to draft polished, helpful responses that the team member will review before sending.

COMMUNICATION STANDARDS:
- Professional but warm tone
- Address the person by first name
- Be specific and actionable — don't give vague responses
- If a question was asked, answer it directly
- If an issue was reported, acknowledge it and explain next steps
- If a maintenance request, confirm it's been received and give a timeline
- If about delinquency/payment, be firm but empathetic
- Include relevant details from the context provided (lease dates, work order status, etc.)
- Keep responses concise — 2-4 paragraphs max
- End with a clear next step or invitation to follow up
- Do NOT include a signature — the system adds that automatically
- Do NOT include "Dear" — just use the first name and a comma
- Do NOT make up information — only reference data from the context provided
- If you don't have enough context to fully answer, draft what you can and add [NEEDS REVIEW: specific detail needed] markers for the team member

RESPONSE TIME STANDARD: We aim to respond to all communications within 24 hours. If this email has been waiting more than 24 hours, acknowledge the delay.

COMPANY INFO:
- Company: Real Property Management Prestige (A Neighborly® Company)
- Location: Houston, TX
- Team: Mike Williamson (Owner), Lori (Client Success), Leslie (Leasing), Amanda (Maintenance), Amelia (Operations)`;

function stripHtml(html) {
  if (!html) return "";
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function jget(obj, ...keys) {
  const o = obj && typeof obj === "object" ? obj : {};
  for (const k of keys) {
    if (o[k] != null && o[k] !== "") return o[k];
  }
  return null;
}

function fmtMoney(v) {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ""));
  if (Number.isNaN(n)) return String(v);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function openWorkOrderStatus(status) {
  const s = String(status || "").trim().toLowerCase();
  return s && !["completed", "canceled", "cancelled"].includes(s);
}

function propertyMatchSql(paramIndex) {
  return `(appfolio_data->>'property_name' ILIKE $${paramIndex} OR appfolio_data->>'property_address' ILIKE $${paramIndex})`;
}

function buildContactNeedles(ticket) {
  const out = new Set();
  const add = (s) => {
    const t = String(s || "").trim();
    if (t.length >= 2) out.add(t);
  };
  add(ticket.linked_tenant_name);
  add(ticket.linked_owner_name);
  add(ticket.sender_name);
  const em = String(ticket.sender_email || "").split("@")[0];
  add(em);
  return [...out];
}

export async function gatherInboxDraftContext(pool, ticket) {
  const propName = String(ticket.linked_property_name || "").trim();
  const tenName = String(ticket.linked_tenant_name || "").trim();
  const ownName = String(ticket.linked_owner_name || "").trim();
  const propPat = propName ? `%${propName.slice(0, 200)}%` : null;
  const tenPat = tenName ? `%${tenName.slice(0, 200)}%` : null;
  const ownPat = ownName ? `%${ownName.slice(0, 200)}%` : null;

  const contextUsed = {
    property: false,
    propertyName: null,
    tenant: false,
    tenantName: null,
    owner: false,
    ownerName: null,
    workOrders: 0,
    delinquency: null,
    leadsimple: false,
  };

  let propertyBlock = "";
  let rentRollPropertySample = "";
  let tenantBlock = "";
  let ownerBlock = "";
  let workOrdersLines = [];
  let leadsimpleBlock = "";

  if (propPat) {
    const { rows: propRows } = await pool.query(
      `SELECT appfolio_data FROM cached_properties WHERE ${propertyMatchSql(1)} LIMIT 1`,
      [propPat]
    );
    if (propRows[0]?.appfolio_data) {
      const d = propRows[0].appfolio_data;
      contextUsed.property = true;
      contextUsed.propertyName = jget(d, "property_name", "propertyName") || propName;
      const addr = [
        jget(d, "property_address", "propertyAddress"),
        [jget(d, "property_city", "propertyCity"), jget(d, "property_state", "propertyState"), jget(d, "property_zip", "propertyZip")]
          .filter(Boolean)
          .join(" "),
      ]
        .filter(Boolean)
        .join(", ");
      const mgmt = [
        jget(d, "management_fee_percent", "managementFeePercent"),
        jget(d, "management_fee_type", "managementFeeType"),
        jget(d, "management_flat_fee", "managementFlatFee"),
      ]
        .filter((x) => x != null && x !== "")
        .join(" ");
      const owners = jget(d, "owners", "Owners");
      const maint = jget(d, "maintenance_limit", "maintenanceLimit");
      const units = jget(d, "units", "Units");
      const ptype = jget(d, "property_type", "propertyType");
      propertyBlock = [
        `Name: ${contextUsed.propertyName}`,
        addr ? `Address: ${addr}` : "",
        owners ? `Owner(s) on record: ${owners}` : "",
        mgmt ? `Management fee: ${mgmt}` : "",
        maint != null && maint !== "" ? `Maintenance limit: ${maint}` : "",
        units != null && units !== "" ? `Units: ${units}` : "",
        ptype ? `Type: ${ptype}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    }

    const { rows: woRows } = await pool.query(
      `SELECT appfolio_data FROM cached_work_orders
       WHERE ${propertyMatchSql(1)}
       LIMIT 80`,
      [propPat]
    );
    const open = woRows.map((r) => r.appfolio_data).filter((d) => openWorkOrderStatus(jget(d, "status", "Status")));
    contextUsed.workOrders = open.length;
    workOrdersLines = open.slice(0, 15).map((d) => {
      const num = jget(d, "work_order_number", "workOrderNumber");
      const st = jget(d, "status", "Status");
      const issue = jget(d, "work_order_issue", "workOrderIssue", "job_description", "jobDescription");
      const unit = jget(d, "unit_name", "unitName");
      return `- #${num || "?"} [${st}] ${unit ? `${unit}: ` : ""}${issue || ""}`.trim();
    });

    const { rows: rrRows } = await pool.query(
      `SELECT appfolio_data FROM cached_rent_roll WHERE ${propertyMatchSql(1)} ORDER BY id LIMIT 40`,
      [propPat]
    );
    if (rrRows.length && !tenPat) {
      rentRollPropertySample = `Units / rent roll at this property (sample):\n${rrRows
        .slice(0, 12)
        .map((r) => {
          const d = r.appfolio_data;
          const unit = jget(d, "unit", "Unit");
          const stat = jget(d, "status", "Status");
          const tn = jget(d, "tenant", "Tenant");
          const rent = fmtMoney(jget(d, "rent", "Rent"));
          const lf = jget(d, "lease_from", "leaseFrom");
          const lt = jget(d, "lease_to", "leaseTo");
          return `- ${unit || "—"} | ${stat || "—"} | Tenant: ${tn || "—"} | Rent: ${rent || "—"} | Lease: ${lf || "—"} to ${lt || "—"}`;
        })
        .join("\n")}`;
    }

    const { rows: rrTen } = tenPat
      ? await pool.query(
          `SELECT appfolio_data FROM cached_rent_roll
           WHERE ${propertyMatchSql(1)} AND (appfolio_data->>'tenant' ILIKE $2)
           LIMIT 15`,
          [propPat, tenPat]
        )
      : { rows: [] };
    if (tenPat && rrTen.rows.length) {
      contextUsed.tenant = true;
      contextUsed.tenantName = tenName;
      tenantBlock = `Tenant lease rows (property + name match):\n${rrTen.rows
        .map((r) => {
          const d = r.appfolio_data;
          return `- ${jget(d, "tenant", "Tenant")} | ${jget(d, "unit", "Unit")} | ${jget(d, "status", "Status")} | Rent: ${fmtMoney(jget(d, "rent", "Rent")) || "—"} | Lease: ${jget(d, "lease_from", "leaseFrom") || "—"} to ${jget(d, "lease_to", "leaseTo") || "—"}`;
        })
        .join("\n")}`;
    }
  }

  if (tenPat && !contextUsed.tenant) {
    const { rows } = await pool.query(
      `SELECT appfolio_data FROM cached_rent_roll WHERE appfolio_data->>'tenant' ILIKE $1 LIMIT 15`,
      [tenPat]
    );
    if (rows.length) {
      contextUsed.tenant = true;
      contextUsed.tenantName = tenName;
      tenantBlock = `Tenant rent roll:\n${rows
        .map((r) => {
          const d = r.appfolio_data;
          return `- Property: ${jget(d, "property_name", "propertyName")} | Unit: ${jget(d, "unit", "Unit")} | ${jget(d, "status", "Status")} | Rent: ${fmtMoney(jget(d, "rent", "Rent")) || "—"} | Lease: ${jget(d, "lease_from", "leaseFrom") || "—"} to ${jget(d, "lease_to", "leaseTo") || "—"}`;
        })
        .join("\n")}`;
    }
  }

  if (tenPat) {
    const { rows: delRows } = await pool.query(
      `SELECT appfolio_data FROM cached_delinquency WHERE appfolio_data->>'name' ILIKE $1 LIMIT 5`,
      [tenPat]
    );
    if (delRows.length) {
      const d = delRows[0].appfolio_data;
      const amt = fmtMoney(jget(d, "amount_receivable", "amountReceivable"));
      contextUsed.delinquency = amt || jget(d, "amount_receivable", "amountReceivable") || "see data";
      tenantBlock = `${tenantBlock ? `${tenantBlock}\n\n` : ""}Delinquency:\n${delRows
        .map((r) => {
          const x = r.appfolio_data;
          return `- Balance: ${fmtMoney(jget(x, "amount_receivable", "amountReceivable")) || "—"} | Property: ${jget(x, "property_name", "propertyName")} | Unit: ${jget(x, "unit", "Unit")} | Aging 30/60/90+: ${[jget(x, "00_to30"), jget(x, "30_to60"), jget(x, "60_to90"), jget(x, "90_plus")].filter(Boolean).join(" / ")}`;
        })
        .join("\n")}`;
    }
  }

  if (ownPat) {
    const { rows } = await pool.query(
      `SELECT appfolio_data FROM cached_owners
       WHERE appfolio_data->>'name' ILIKE $1
          OR CONCAT(COALESCE(appfolio_data->>'first_name',''), ' ', COALESCE(appfolio_data->>'last_name','')) ILIKE $1
       LIMIT 3`,
      [ownPat]
    );
    if (rows.length) {
      const d = rows[0].appfolio_data;
      contextUsed.owner = true;
      contextUsed.ownerName = jget(d, "name", "Name") || ownName;
      ownerBlock = rows
        .map((r) => {
          const x = r.appfolio_data;
          return [
            `Name: ${jget(x, "name", "Name")}`,
            jget(x, "email", "Email") ? `Email: ${jget(x, "email", "Email")}` : "",
            jget(x, "phone_numbers", "phoneNumbers") ? `Phone: ${jget(x, "phone_numbers", "phoneNumbers")}` : "",
            jget(x, "properties_owned", "propertiesOwned") ? `Properties owned: ${jget(x, "properties_owned", "propertiesOwned")}` : "",
            jget(x, "last_payment_date", "lastPaymentDate") ? `Last payment: ${jget(x, "last_payment_date", "lastPaymentDate")}` : "",
          ]
            .filter(Boolean)
            .join("\n");
        })
        .join("\n\n---\n");
    }
  }

  const needles = buildContactNeedles(ticket).slice(0, 6);
  if (needles.length) {
    const iLike = needles.map((_, idx) => `appfolio_data::text ILIKE $${idx + 1}`).join(" OR ");
    const params = needles.map((n) => `%${n.slice(0, 120)}%`);
    const dealSql = `SELECT appfolio_data FROM cached_leadsimple_deals
      WHERE lower(coalesce(appfolio_data->>'status','')) NOT IN ('won','lost','cancelled','canceled')
        AND (${iLike})
      LIMIT 12`;
    const taskSql = `SELECT appfolio_data FROM cached_leadsimple_tasks
      WHERE (appfolio_data->>'completed' IS NULL OR lower(appfolio_data->>'completed') IN ('false','0',''))
        AND (${iLike})
      LIMIT 12`;
    const [deals, tasks] = await Promise.all([pool.query(dealSql, params), pool.query(taskSql, params)]);
    const dLines = deals.rows.map((r) => {
      const x = r.appfolio_data;
      return `- Deal: ${jget(x, "name", "Name")} | Stage: ${jget(x, "stage", "Stage")} | Status: ${jget(x, "status", "Status")}`;
    });
    const tLines = tasks.rows.map((r) => {
      const x = r.appfolio_data;
      return `- Task: ${jget(x, "name", "Name")} | Due: ${jget(x, "due_date", "dueDate") || "—"} | Assignee: ${jget(x, "assignee", "Assignee") || "—"}`;
    });
    if (dLines.length || tLines.length) {
      contextUsed.leadsimple = true;
      leadsimpleBlock = [dLines.join("\n"), tLines.join("\n")].filter(Boolean).join("\n");
    }
  }

  let propertySection = "";
  if (propName) {
    const parts = [];
    if (contextUsed.property && propertyBlock) {
      parts.push(`Details (cached_properties) for ${contextUsed.propertyName || propName}:\n${propertyBlock}`);
    } else {
      parts.push(`Ticket linked property: "${propName}" — no matching cached_properties row (address / name may still match rent roll & work orders).`);
    }
    parts.push(
      workOrdersLines.length
        ? `Open Work Orders:\n${workOrdersLines.join("\n")}`
        : "Open Work Orders: (none in cache for this property name)"
    );
    if (rentRollPropertySample) parts.push(rentRollPropertySample);
    propertySection = parts.join("\n\n");
  }

  const tenantSection = tenantBlock || (tenName ? `Tenant link: "${tenName}" — limited or no cached rent roll / delinquency match.` : "");

  const ownerSection = ownerBlock || (ownName ? `Owner link: "${ownName}" — no matching cached owner row found.` : "");

  const lsSection = leadsimpleBlock || "";

  const relevantContext = [
    propertySection && `Property:\n${propertySection}`,
    tenantSection && `Tenant:\n${tenantSection}`,
    ownerSection && `Owner:\n${ownerSection}`,
    lsSection && `LeadSimple:\n${lsSection}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { contextUsed, relevantContext: relevantContext || "No linked property/tenant/owner and no LeadSimple matches for known contact needles." };
}

function firstNameFromTicket(ticket) {
  const n = String(ticket.sender_name || "").trim();
  if (n) return n.split(/\s+/)[0];
  const em = String(ticket.sender_email || "").split("@")[0];
  return em || "there";
}

function emailBodyForPrompt(ticket) {
  const prev = String(ticket.body_preview || "").trim();
  if (prev.length >= 50) return prev.slice(0, 2000);
  const stripped = stripHtml(ticket.body_html || "");
  const body = stripped || prev;
  return body.slice(0, 2000);
}

export async function buildDraftUserMessage(ticket, responses, assigneeName) {
  const pool = getPool();
  const { contextUsed, relevantContext } = await gatherInboxDraftContext(pool, ticket);

  const prevText = (responses || [])
    .map((r) => {
      const when = r.created_at ? new Date(r.created_at).toISOString() : "";
      const who = r.responded_by_name || "—";
      const typ = r.response_type === "reply" ? "Reply" : r.response_type === "note" ? "Internal note" : r.response_type;
      const txt = stripHtml(r.body || r.body_html || "").slice(0, 4000);
      return `[${when}] ${typ} by ${who}:\n${txt}`;
    })
    .join("\n\n---\n\n");

  const received = ticket.received_at ? new Date(ticket.received_at) : null;
  const now = new Date();
  const hoursSince = received ? (now - received) / (1000 * 60 * 60) : null;
  const timeSince =
    hoursSince == null
      ? "unknown"
      : hoursSince < 24
        ? `${hoursSince.toFixed(1)} hours`
        : `${(hoursSince / 24).toFixed(1)} days (${hoursSince.toFixed(1)} hours)`;

  const userMsg = `INCOMING EMAIL:
From: ${ticket.sender_name || ""} <${ticket.sender_email || ""}>
Subject: ${ticket.subject || ""}
Body: ${emailBodyForPrompt(ticket)}

PREVIOUS REPLIES IN THIS THREAD:
${prevText || "(none)"}

RELEVANT CONTEXT FROM OUR SYSTEMS:

${relevantContext}

TICKET METADATA:
- Category: ${ticket.category || "—"}
- Priority: ${ticket.priority ?? "—"}
- Assigned to: ${assigneeName || "—"}
- Received: ${received ? received.toISOString() : "—"}
- Time since received: ${timeSince}
- AI summary (if any): ${ticket.ai_summary || "—"}

Draft a professional reply to this email. Remember to only reference information from the context provided above.
Address the sender as "${firstNameFromTicket(ticket)}" (first name) with a comma after the name — not "Dear".`;

  return { userMsg, contextUsed };
}

async function callClaudeDraft(userMessage) {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    const err = new Error("ANTHROPIC_API_KEY is not set.");
    err.code = "NO_AI_KEY";
    throw err;
  }
  const anthropic = new Anthropic({ apiKey: key });
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });
  return msg.content.map((b) => (b.type === "text" ? b.text : "")).join("\n").trim();
}

export async function upsertTicketAiDraft(client, ticketId, draftText, contextUsed, userId) {
  await client.query(
    `INSERT INTO ticket_ai_drafts (ticket_id, draft_text, context_used, drafted_by)
     VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (ticket_id) DO UPDATE SET
       draft_text = EXCLUDED.draft_text,
       context_used = EXCLUDED.context_used,
       drafted_by = EXCLUDED.drafted_by,
       created_at = NOW(),
       used_at = NULL`,
    [ticketId, draftText, JSON.stringify(contextUsed), userId]
  );
}

/**
 * Generates draft text + contextUsed and persists to ticket_ai_drafts.
 */
export async function runAiDraftForTicket(ticketId, userId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT t.*, u.display_name AS assignee_name
     FROM tickets t
     LEFT JOIN users u ON u.id = t.assigned_to
     WHERE t.id = $1`,
    [ticketId]
  );
  if (!rows.length) {
    const err = new Error("Ticket not found.");
    err.code = "NOT_FOUND";
    throw err;
  }
  const ticket = rows[0];
  const { rows: respRows } = await pool.query(
    `SELECT tr.*, u.display_name AS responded_by_name
     FROM ticket_responses tr
     LEFT JOIN users u ON u.id = tr.responded_by
     WHERE tr.ticket_id = $1 ORDER BY tr.created_at ASC`,
    [ticketId]
  );
  const { userMsg, contextUsed } = await buildDraftUserMessage(ticket, respRows, ticket.assignee_name);
  const draft = await callClaudeDraft(userMsg);
  if (!draft) {
    const err = new Error("Empty draft from model.");
    err.code = "EMPTY_DRAFT";
    throw err;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await upsertTicketAiDraft(client, ticketId, draft, contextUsed, userId);
    await client.query("COMMIT");
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
  return { draft, contextUsed };
}
