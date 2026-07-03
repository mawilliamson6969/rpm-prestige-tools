/**
 * Maintenance Management System — COI expiry SMS alerts (Phase 2).
 *
 * Daily cron scans maint_subcontractors for Certificate-of-Insurance expiries
 * inside the warning window (expiring soon OR already lapsed) and texts a
 * single digest to MAINT_ALERT_PHONE, then stamps coi_alerted_at so the same
 * vendor isn't re-texted every day. A renewed COI clears coi_alerted_at (see
 * updateSubcontractor), so a fresh expiry alerts again.
 *
 * Also emits a Prestige Connect event per expiring vendor so downstream
 * automations can react (e.g. create a task).
 *
 * Graceful degradation: if MAINT_ALERT_PHONE or OpenPhone is unconfigured we
 * log the at-risk vendors and skip the text — never throw, never block boot.
 */

import { getPool } from "./db.js";
import { sendSMS } from "./openphone.js";
import { emitEvent } from "./eventBus.js";
import { MAINT_EVENT } from "./maint-events.js";

/** Warn this many days before a COI lapses. */
const WARN_DAYS = 30;
/** Re-send the digest at most once every this many days per vendor. */
const REALERT_DAYS = 7;

export async function runCoiExpiryCheck() {
  const pool = getPool();

  // At-risk = COI on file, expires within WARN_DAYS (including already past),
  // and we haven't alerted in the last REALERT_DAYS.
  const { rows } = await pool.query(
    `SELECT id, company_name, coi_expiry
       FROM maint_subcontractors
      WHERE archived_at IS NULL
        AND coi_expiry IS NOT NULL
        AND coi_expiry <= (CURRENT_DATE + ($1 || ' days')::interval)
        AND (coi_alerted_at IS NULL
             OR coi_alerted_at < NOW() - ($2 || ' days')::interval)
      ORDER BY coi_expiry ASC`,
    [String(WARN_DAYS), String(REALERT_DAYS)]
  );

  if (!rows.length) return { checked: true, alerted: 0 };

  // Emit one Connect event per vendor regardless of SMS config.
  for (const s of rows) {
    await emitEvent({
      type: MAINT_EVENT.COI_EXPIRING,
      source: "internal",
      payload: {
        subcontractor_id: s.id,
        company_name: s.company_name,
        coi_expiry: s.coi_expiry,
      },
      externalId: `maintenance_coi:${s.id}:${s.coi_expiry}`,
    });
  }

  const toPhone = process.env.MAINT_ALERT_PHONE?.trim();
  const lines = rows.map((s) => {
    const d = new Date(s.coi_expiry);
    const label = Number.isNaN(d.getTime())
      ? String(s.coi_expiry)
      : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return `• ${s.company_name} — COI ${label}`;
  });
  const body =
    `RPM Maintenance: ${rows.length} subcontractor COI(s) expiring within ` +
    `${WARN_DAYS} days or lapsed:\n${lines.join("\n")}`;

  if (!toPhone) {
    console.warn(
      `[coi-alert] ${rows.length} COI(s) at risk but MAINT_ALERT_PHONE is unset — SMS skipped.\n${lines.join("\n")}`
    );
    return { checked: true, alerted: 0, atRisk: rows.length, reason: "no_recipient" };
  }

  try {
    await sendSMS(toPhone, body);
  } catch (e) {
    // OpenPhone not configured or send failed — log, leave coi_alerted_at
    // untouched so the next run retries.
    console.error(`[coi-alert] SMS send failed (${e.code || "err"}): ${e.message || e}`);
    return { checked: true, alerted: 0, atRisk: rows.length, reason: "sms_failed" };
  }

  // Stamp only after a successful send so failures retry next run.
  await pool.query(
    `UPDATE maint_subcontractors SET coi_alerted_at = NOW() WHERE id = ANY($1)`,
    [rows.map((s) => s.id)]
  );

  return { checked: true, alerted: rows.length };
}
