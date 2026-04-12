import Anthropic from "@anthropic-ai/sdk";
import { getPool } from "./db.js";

const MODEL = "claude-sonnet-4-20250514";
const RATE_LIMIT_PER_HOUR = 30;
const MAX_ROWS_FOR_INTERPRET = 50;

const SQL_SYSTEM_PROMPT = `You are an AI assistant for RPM Prestige, a property management company in Houston, TX. You answer questions by querying our PostgreSQL database containing cached data from AppFolio and RentEngine.

AVAILABLE TABLES AND THEIR JSONB FIELDS:

cached_rent_roll — One row per unit. Key fields in appfolio_data JSONB:
- property_name, property_address, property_city, property_state, property_zip, property_type, property_id
- unit, unit_id, unit_type, sqft, bd_ba
- tenant, tenant_id, tenant_tags
- status (values: "Current", "Vacant-Unrented", "Notice-Unrented")
- rent, market_rent, advertised_rent, computed_market_rent, legal_rent
- lease_from, lease_to, lease_expires_month
- move_in, move_out, last_move_out
- deposit, late, nsf, past_due
- occupancy_id, additional_tenants

cached_properties — One row per property. Key fields in appfolio_data JSONB:
- property_name, property_address, property_city, property_state, property_zip
- property_type (values: "Single-Family", "Multi-Family")
- property_id, units, sqft, year_built
- owners, owner_i_ds
- management_fee_percent, management_fee_type, management_flat_fee
- management_start_date, management_end_date
- maintenance_limit, reserve
- lease_fee_percent, lease_flat_fee
- renewal_fee_percent, renewal_flat_fee
- late_fee_type, late_fee_base_amount, late_fee_grace_period
- insurance_expiration, home_warranty_expiration
- portfolio, portfolio_id, visibility

cached_owners — One row per owner. Key fields in appfolio_data JSONB:
- name, first_name, last_name
- email, phone_numbers
- street, street2, city, state, zip
- owner_id, properties_owned, properties_owned_i_ds
- payment_type, hold_payments, last_payment_date, tags

cached_work_orders — One row per work order. Key fields in appfolio_data JSONB:
- work_order_number, work_order_issue, work_order_type
- status (values: "New", "Assigned", "Estimated", "Scheduled", "Completed", "Canceled")
- priority (values: "Normal", "Urgent")
- property_name, property_address, unit_name
- vendor, vendor_id, vendor_trade
- primary_tenant, primary_tenant_email, primary_tenant_phone_number
- job_description, service_request_description
- created_at, completed_on, work_completed_on
- scheduled_start, scheduled_end
- amount, vendor_bill_amount, estimate_amount
- assigned_user, created_by

cached_delinquency — One row per delinquent tenant. Key fields in appfolio_data JSONB:
- name, property_name, unit, rent
- amount_receivable (total owed)
- 00_to30, 30_to60, 60_to90, 90_plus (aging buckets)
- delinquent_rent, monthly_charges
- move_in, last_payment, tenant_status
- in_collections, late, nsf
- primary_tenant_email, phone_numbers

cached_income_statement — One row per GL account. Key fields in appfolio_data JSONB:
- account_name, account_number
- year_to_date, month_to_date, last_year_to_date (ALL ARE STRINGS — use ::numeric to cast)
- Account number patterns:
  - 0-4xxxx = Property owner revenue (rent, tenant charges) — pass-through
  - 0-5xxxx = Property expenses
  - 4xxxxx = Company revenue (management fees, leasing fees, maintenance markup)
  - 5xxxxx = Company cost of services
  - 6xxxxx = Company operating expenses
  - 7xxxxx = Payroll

cached_vendors — One row per vendor. Key fields in appfolio_data JSONB:
- Vendor information (name, contact, trade)

cached_lease_expirations — One row per expiring lease. Key fields in appfolio_data JSONB:
- tenant_name, property_name, unit
- lease_expires, lease_expires_month
- rent, market_rent
- status (values: "Eligible", "Not Eligible", "Renewed")
- notice_given_date, move_in

cached_rental_applications — One row per application. Key fields in appfolio_data JSONB:
- applicants, email, phone_number
- property_name, unit_name
- status (values: "Converted", "Canceled", "Pending")
- received, desired_move_in, move_in_date
- lead_source, monthly_salary

cached_rentengine_leads — One row per prospect/lead from RentEngine (synced from the RentEngine API). Key fields in appfolio_data JSONB:
- name, email, phone — prospect contact info
- status — current status (e.g., "Showing Scheduled", "Not Interested", "Applied")
- source — lead source (e.g., "Zillow", "Apartments.com", "RentEngine")
- unit_of_interest — unit ID they are interested in
- prescreened — boolean whether they passed prescreening
- prospect_type — e.g. "Self" or "Agent"
- created_at, updated_at — timestamps

cached_rentengine_units — One row per unit listing from RentEngine. Key fields vary; often includes id, name, address, and unit identifiers for joining to unit_of_interest on leads.

IMPORTANT QUERY RULES:
- All data is in JSONB columns called "appfolio_data"
- Access fields with: appfolio_data->>'field_name'
- For numeric comparisons, cast strings: (appfolio_data->>'amount')::numeric
- For date comparisons, cast: (appfolio_data->>'created_at')::date
- Property names may vary slightly between tables (e.g., "4017 Briar Hollow Dr" vs "4017 Briar Hollow Dr - 4017 Briar Hollow Dr Houston, TX 77027")
- Use ILIKE with % wildcards for fuzzy matching on names and addresses
- Always limit results to 50 rows unless the user specifically asks for all
- Return ONLY a valid SQL query. No explanation, no markdown, no backticks. Just the raw SQL.`;

function extractSqlFromAssistantText(text) {
  if (!text || typeof text !== "string") return "";
  let s = text.trim();
  const fence = /^```(?:sql)?\s*([\s\S]*?)```/im.exec(s);
  if (fence) s = fence[1].trim();
  s = s.replace(/^```sql\s*/i, "").replace(/```\s*$/i, "").trim();
  return s;
}

function textFromMessage(msg) {
  if (!msg?.content) return "";
  const parts = [];
  for (const block of msg.content) {
    if (block.type === "text") parts.push(block.text);
  }
  return parts.join("\n").trim();
}

/** Reject anything that isn't a single read-only statement. */
export function isSafeReadOnlySql(sqlRaw) {
  const sql = sqlRaw.trim().replace(/;+\s*$/g, "").trim();
  if (!sql) return false;
  const forbidden =
    /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|EXECUTE|CALL|COPY|MERGE)\b/i;
  if (forbidden.test(sql)) return false;
  const noComments = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .trim();
  if (!/^(WITH|SELECT)\b/is.test(noComments)) return false;
  const semi = sql.split(";").filter((p) => p.trim());
  if (semi.length > 1) return false;
  return true;
}

function ensureLimit50(sqlRaw) {
  const sql = sqlRaw.trim().replace(/;+\s*$/g, "").trim();
  if (/\blimit\s+\d+/i.test(sql)) return sql;
  return `${sql} LIMIT 50`;
}

function getAnthropic() {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    const err = new Error("ANTHROPIC_API_KEY is not set.");
    err.code = "AI_NOT_CONFIGURED";
    throw err;
  }
  return new Anthropic({ apiKey: key });
}

export async function checkAskAiRateLimit(userId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM ask_ai_history
     WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '1 hour'`,
    [userId]
  );
  return rows[0].c < RATE_LIMIT_PER_HOUR;
}

async function generateSql(anthropic, question, fixHint) {
  const userContent = fixHint
    ? `The previous SQL failed or was invalid.\nError or instruction:\n${fixHint}\n\nOriginal question:\n${question}\n\nReturn ONLY the corrected SQL query, nothing else.`
    : question;

  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: SQL_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });
  return extractSqlFromAssistantText(textFromMessage(msg));
}

async function interpretAnswer(anthropic, question, rows) {
  const payload = rows.slice(0, MAX_ROWS_FOR_INTERPRET);
  const userMsg = `You are an AI assistant for RPM Prestige, a property management company. 
The user asked: ${JSON.stringify(question)}

Here are the query results:
${JSON.stringify(payload, null, 2)}

Provide a clear, helpful answer based on this data. Format numbers nicely (currency with $, percentages with %). If the results are empty, say you couldn't find matching data and suggest what they might try instead. Keep your answer concise but complete. If there are multiple results, summarize and highlight key items.`;

  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: "user", content: userMsg }],
  });
  return textFromMessage(msg);
}

/**
 * @returns {{ answer: string, query: string, rowCount: number, responseTimeMs: number }}
 */
export async function runAskAi(userId, question) {
  const started = Date.now();
  const q = typeof question === "string" ? question.trim() : "";
  if (!q) {
    const err = new Error("question is required.");
    err.code = "BAD_REQUEST";
    throw err;
  }

  const okRate = await checkAskAiRateLimit(userId);
  if (!okRate) {
    const err = new Error("Rate limit exceeded. You can ask up to 30 questions per hour.");
    err.code = "RATE_LIMIT";
    throw err;
  }

  const anthropic = getAnthropic();
  const pool = getPool();

  let sql = "";
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const hint = attempt === 0 ? null : lastErr;
    sql = await generateSql(anthropic, q, hint);
    if (!sql) {
      lastErr = "Empty SQL returned. Return a single SELECT (or WITH … SELECT) query only.";
      continue;
    }
    if (!isSafeReadOnlySql(sql)) {
      lastErr =
        "The query must be a single SELECT or WITH … SELECT statement only. No INSERT, UPDATE, DELETE, DDL, or multiple statements.";
      continue;
    }
    const toRun = ensureLimit50(sql);
    try {
      const { rows: data } = await pool.query(toRun);
      const rowCount = data.length;
      let answer;
      try {
        answer = await interpretAnswer(anthropic, q, data);
      } catch (interpErr) {
        console.error("[ask-ai] interpretAnswer", interpErr);
        answer = `Here are ${rowCount} row(s) from your data. (The assistant could not format a full narrative — raw keys: ${Object.keys(data[0] || {}).slice(0, 8).join(", ") || "none"}.)`;
      }
      const responseTimeMs = Date.now() - started;

      await pool.query(
        `INSERT INTO ask_ai_history (user_id, question, sql_query, answer, row_count, response_time_ms)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, q, toRun, answer, rowCount, responseTimeMs]
      );

      return { answer, query: toRun, rowCount, responseTimeMs };
    } catch (e) {
      lastErr = e.message || String(e);
    }
  }

  const err = new Error(
    "I couldn't find an answer to that question. Try rephrasing or ask something more specific."
  );
  err.code = "AI_QUERY_FAILED";
  err.detail = lastErr;
  throw err;
}

export async function getAskHistoryForUser(userId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, question, sql_query, answer, row_count, response_time_ms, created_at
     FROM ask_ai_history WHERE user_id = $1
     ORDER BY created_at DESC LIMIT 50`,
    [userId]
  );
  return rows.map((r) => ({
    id: r.id,
    question: r.question,
    sqlQuery: r.sql_query,
    answer: r.answer,
    rowCount: r.row_count,
    responseTimeMs: r.response_time_ms,
    createdAt: r.created_at,
  }));
}
