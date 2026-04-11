import {
  postTeamsWebhookPlaceholder,
  sendOwnerRetainedTeamNotification,
  sendTeamEmailNotification,
  triggerLeadSimpleOffboardingPlaceholder,
} from "../lib/notifications.js";
import { getPool } from "../lib/db.js";

const REASONS = new Set([
  "selling_the_property",
  "dissatisfied_with_rpm",
  "other_property_management",
  "self_management",
  "financial",
  "other",
]);

const STATUSES = new Set(["pending", "retained", "in_progress", "completed", "cancelled"]);

function startOfTodayUtc() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function parseDateOnly(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, day] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

function validatePayload(body) {
  const errors = [];
  const submitter =
    body.submitter_type === "staff" ? "staff" : body.submitter_type === "property_owner" ? "property_owner" : null;
  if (!submitter) errors.push("Select who is submitting this form.");

  const staff_member_name =
    typeof body.staff_member_name === "string" ? body.staff_member_name.trim() : "";
  if (submitter === "staff" && !staff_member_name) {
    errors.push("Staff member name is required.");
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push("A valid email address is required.");
  }

  const owner_first_name = typeof body.owner_first_name === "string" ? body.owner_first_name.trim() : "";
  const owner_last_name = typeof body.owner_last_name === "string" ? body.owner_last_name.trim() : "";
  if (!owner_first_name) errors.push("Owner first name is required.");
  if (!owner_last_name) errors.push("Owner last name is required.");

  const street_address = typeof body.street_address === "string" ? body.street_address.trim() : "";
  const street_address_2Raw =
    typeof body.street_address_2 === "string" ? body.street_address_2.trim() : "";
  const street_address_2 = street_address_2Raw || null;
  const city = typeof body.city === "string" ? body.city.trim() : "";
  const state = typeof body.state === "string" ? body.state.trim() : "";
  const zip_code = typeof body.zip_code === "string" ? body.zip_code.trim() : "";
  if (!street_address) errors.push("Street address is required.");
  if (!city) errors.push("City is required.");
  if (!state) errors.push("State is required.");
  if (!zip_code) errors.push("Postal / ZIP code is required.");

  const dr = typeof body.date_received_in_writing === "string" ? body.date_received_in_writing : "";
  const rt = typeof body.requested_termination_date === "string" ? body.requested_termination_date : "";
  const date_received_in_writing = parseDateOnly(dr);
  const requested_termination_date = parseDateOnly(rt);
  if (!date_received_in_writing) errors.push("Date termination request received in writing is required.");
  if (!requested_termination_date) errors.push("Date owner wants termination to be effective is required.");
  else {
    const today = startOfTodayUtc();
    if (requested_termination_date <= today) {
      errors.push("Requested termination date must be in the future.");
    }
  }

  const termination_reason =
    typeof body.termination_reason === "string" ? body.termination_reason.trim() : "";
  if (!termination_reason || !REASONS.has(termination_reason)) {
    errors.push("Please select a reason for termination.");
  }

  const reason_detailsRaw =
    typeof body.reason_details === "string" ? body.reason_details.trim() : "";
  const reason_details = reason_detailsRaw || null;

  const retention =
    body.retention_offer_accepted === "yes"
      ? "yes"
      : body.retention_offer_accepted === "no"
        ? "no"
        : null;
  if (!retention) {
    errors.push("Please answer the retention offer question.");
  }

  let improvement_feedbackRaw =
    typeof body.improvement_feedback === "string" ? body.improvement_feedback.trim() : "";
  let improvement_feedback = improvement_feedbackRaw || null;

  let guarantees_acknowledged = null;
  let deposit_waiver_acknowledged = null;
  let deposit_return_acknowledged = null;
  let keys_balance_acknowledged = null;
  const signatureRaw = typeof body.signature_data === "string" ? body.signature_data.trim() : "";
  let signature_data = signatureRaw || null;

  let status = "pending";

  if (retention === "yes") {
    status = "retained";
    improvement_feedback = null;
    guarantees_acknowledged = null;
    deposit_waiver_acknowledged = null;
    deposit_return_acknowledged = null;
    keys_balance_acknowledged = null;
    signature_data = null;
  } else if (retention === "no") {
    if (!improvement_feedback) {
      errors.push("Please tell us what we can improve.");
    }
    const g = body.guarantees_acknowledged === true;
    const d1 = body.deposit_waiver_acknowledged === true;
    const d2 = body.deposit_return_acknowledged === true;
    const k = body.keys_balance_acknowledged === true;
    if (!g) errors.push("You must acknowledge the guarantees statement.");
    if (!d1) errors.push("You must acknowledge the security deposit waiver statement.");
    if (!d2) errors.push("You must acknowledge the security deposit return statement.");
    if (!k) errors.push("You must acknowledge the keys / balance statement.");
    guarantees_acknowledged = g;
    deposit_waiver_acknowledged = d1;
    deposit_return_acknowledged = d2;
    keys_balance_acknowledged = k;
    if (!signature_data || signature_data.length < 50) {
      errors.push("A digital signature is required.");
    }
  }

  return {
    errors,
    value: {
      submitter_type: submitter,
      staff_member_name: submitter === "staff" ? staff_member_name : null,
      email,
      owner_first_name,
      owner_last_name,
      street_address,
      street_address_2: street_address_2 || null,
      city,
      state,
      zip_code,
      date_received_in_writing: dr,
      requested_termination_date: rt,
      termination_reason,
      reason_details,
      retention_offer_accepted: retention,
      improvement_feedback,
      guarantees_acknowledged,
      deposit_waiver_acknowledged,
      deposit_return_acknowledged,
      keys_balance_acknowledged,
      signature_data,
      status,
    },
  };
}

export async function postOwnerTermination(req, res) {
  try {
    getPool();
  } catch {
    return res.status(503).json({ error: "Database is not configured." });
  }
  try {
    const { errors, value } = validatePayload(req.body ?? {});
    if (errors.length) {
      return res.status(400).json({ error: "Validation failed.", details: errors });
    }

    const pool = getPool();
    const insert = `
      INSERT INTO owner_termination_requests (
        submitter_type, staff_member_name, email,
        owner_first_name, owner_last_name,
        street_address, street_address_2, city, state, zip_code,
        date_received_in_writing, requested_termination_date,
        termination_reason, reason_details,
        retention_offer_accepted, improvement_feedback,
        guarantees_acknowledged, deposit_waiver_acknowledged,
        deposit_return_acknowledged, keys_balance_acknowledged,
        signature_data, status
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
      )
      RETURNING *
    `;
    const params = [
      value.submitter_type,
      value.staff_member_name,
      value.email,
      value.owner_first_name,
      value.owner_last_name,
      value.street_address,
      value.street_address_2,
      value.city,
      value.state,
      value.zip_code,
      value.date_received_in_writing,
      value.requested_termination_date,
      value.termination_reason,
      value.reason_details,
      value.retention_offer_accepted,
      value.improvement_feedback,
      value.guarantees_acknowledged,
      value.deposit_waiver_acknowledged,
      value.deposit_return_acknowledged,
      value.keys_balance_acknowledged,
      value.signature_data,
      value.status,
    ];
    const { rows } = await pool.query(insert, params);
    const row = rows[0];

    await sendTeamEmailNotification(row).catch((e) => console.error("[email]", e));
    if (value.retention_offer_accepted === "yes") {
      await sendOwnerRetainedTeamNotification(row).catch((e) => console.error("[email retained]", e));
    }
    await postTeamsWebhookPlaceholder(row).catch((e) => console.error("[teams]", e));
    await triggerLeadSimpleOffboardingPlaceholder(row).catch((e) => console.error("[leadsimple]", e));

    return res.status(201).json({ id: row.id, status: row.status });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Could not save submission." });
  }
}

export async function listOwnerTerminations(req, res) {
  let pool;
  try {
    pool = getPool();
  } catch {
    return res.status(503).json({ error: "Database is not configured." });
  }
  try {
    const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
    let q = `SELECT * FROM owner_termination_requests`;
    const params = [];
    if (status && status !== "all" && STATUSES.has(status)) {
      params.push(status);
      q += ` WHERE status = $1`;
    }
    q += ` ORDER BY submitted_at DESC`;
    const { rows } = await pool.query(q, params);
    res.json({ items: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load requests." });
  }
}

export async function patchOwnerTermination(req, res) {
  let pool;
  try {
    pool = getPool();
  } catch {
    return res.status(503).json({ error: "Database is not configured." });
  }
  const id = req.params.id;
  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Invalid id." });
  }
  const nextStatus = req.body?.status;
  if (!nextStatus || !STATUSES.has(nextStatus)) {
    return res.status(400).json({ error: "Invalid status." });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE owner_termination_requests SET status = $1 WHERE id = $2::uuid RETURNING *`,
      [nextStatus, id],
    );
    if (!rows.length) return res.status(404).json({ error: "Not found." });
    res.json({ item: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update." });
  }
}

function csvEscape(s) {
  if (s == null) return "";
  const t = String(s);
  if (/[",\n]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

export async function exportOwnerTerminationsCsv(req, res) {
  let pool;
  try {
    pool = getPool();
  } catch {
    return res.status(503).send("Database is not configured.");
  }
  try {
    const { rows } = await pool.query(
      `SELECT * FROM owner_termination_requests ORDER BY submitted_at DESC`,
    );
    const headers = [
      "id",
      "submitted_at",
      "status",
      "submitter_type",
      "staff_member_name",
      "email",
      "owner_first_name",
      "owner_last_name",
      "street_address",
      "street_address_2",
      "city",
      "state",
      "zip_code",
      "date_received_in_writing",
      "requested_termination_date",
      "termination_reason",
      "reason_details",
      "retention_offer_accepted",
      "improvement_feedback",
      "guarantees_acknowledged",
      "deposit_waiver_acknowledged",
      "deposit_return_acknowledged",
      "keys_balance_acknowledged",
      "signature_data",
    ];
    const lines = [headers.join(",")];
    for (const r of rows) {
      lines.push(
        headers
          .map((h) => csvEscape(h === "signature_data" && r[h] ? "[base64 image]" : r[h]))
          .join(","),
      );
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="owner-terminations.csv"');
    res.send(lines.join("\n"));
  } catch (e) {
    console.error(e);
    res.status(500).send("Could not export.");
  }
}
