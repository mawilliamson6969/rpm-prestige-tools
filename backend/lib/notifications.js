import nodemailer from "nodemailer";

function parseTeamEmails() {
  const raw = process.env.TEAM_NOTIFICATION_EMAILS ?? "";
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user) {
    return null;
  }
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

const REASON_LABELS = {
  selling_the_property: "Selling the property",
  dissatisfied_with_rpm: "Dissatisfied with Real Property Management Prestige",
  other_property_management: "Going with another property management company",
  self_management: "Taking over management myself",
  financial: "Financial reasons",
  other: "Other",
};

function reasonLabel(key) {
  return REASON_LABELS[key] ?? key;
}

function formatSubmissionBody(row, { retainedHighlight = false } = {}) {
  const lines = [
    retainedHighlight ? "*** OWNER RETAINED — CREDIT ACCOUNT ***" : "",
    `Submitter: ${row.submitter_type}${row.staff_member_name ? ` (${row.staff_member_name})` : ""}`,
    `Email: ${row.email}`,
    `Owner: ${row.owner_first_name} ${row.owner_last_name}`,
    `Property: ${row.street_address}${row.street_address_2 ? `, ${row.street_address_2}` : ""}`,
    `          ${row.city}, ${row.state} ${row.zip_code}`,
    `Date request received (writing): ${row.date_received_in_writing}`,
    `Requested effective termination: ${row.requested_termination_date}`,
    `Reason: ${reasonLabel(row.termination_reason)}`,
    row.reason_details ? `Details: ${row.reason_details}` : "",
    `Retention offer accepted: ${row.retention_offer_accepted}`,
    row.improvement_feedback ? `Improvement feedback: ${row.improvement_feedback}` : "",
    "",
    "Acknowledgments (when applicable):",
    `  Guarantees: ${row.guarantees_acknowledged === true ? "yes" : row.guarantees_acknowledged === false ? "no" : "n/a"}`,
    `  Deposit waiver: ${row.deposit_waiver_acknowledged === true ? "yes" : row.deposit_waiver_acknowledged === false ? "no" : "n/a"}`,
    `  Deposit return: ${row.deposit_return_acknowledged === true ? "yes" : row.deposit_return_acknowledged === false ? "no" : "n/a"}`,
    `  Keys/balance: ${row.keys_balance_acknowledged === true ? "yes" : row.keys_balance_acknowledged === false ? "no" : "n/a"}`,
    "",
    `Status: ${row.status}`,
    `Submitted at: ${row.submitted_at}`,
    `ID: ${row.id}`,
  ].filter((l) => l !== "");
  return lines.join("\n");
}

export async function sendTeamEmailNotification(row, subjectPrefix = "Owner termination request") {
  const to = parseTeamEmails();
  const from = process.env.SMTP_FROM;
  const transport = buildTransporter();
  if (!to.length || !from || !transport) {
    console.warn(
      "[email] Skipping team notification (set TEAM_NOTIFICATION_EMAILS, SMTP_*, SMTP_FROM).",
    );
    return { sent: false, reason: "not_configured" };
  }
  const text = formatSubmissionBody(row);
  await transport.sendMail({
    from,
    to: to.join(", "),
    subject: `${subjectPrefix} — ${row.owner_last_name}, ${row.city}`,
    text,
  });
  return { sent: true };
}

export async function sendOwnerRetainedTeamNotification(row) {
  return sendTeamEmailNotification(row, "OWNER RETAINED — 3 months credit");
}

/**
 * Placeholder: POST a summary to Microsoft Teams Incoming Webhook.
 * Env: TEAMS_WEBHOOK_URL — optional; no-op if unset.
 */
export async function postTeamsWebhookPlaceholder(row) {
  const url = process.env.TEAMS_WEBHOOK_URL;
  if (!url) {
    return { posted: false, reason: "TEAMS_WEBHOOK_URL not set" };
  }
  const body = {
    "@type": "MessageCard",
    "@context": "https://schema.org/extensions",
    summary: "Owner termination request",
    themeColor: "B32317",
    title: "RPM Prestige — Owner termination",
    sections: [
      {
        activityTitle: `${row.owner_first_name} ${row.owner_last_name}`,
        facts: [
          { name: "Property", value: `${row.city}, ${row.state}` },
          { name: "Reason", value: reasonLabel(row.termination_reason) },
          { name: "Retention", value: String(row.retention_offer_accepted) },
          { name: "Status", value: String(row.status) },
        ],
      },
    ],
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.warn("[teams] Webhook returned", res.status, t);
    return { posted: false, status: res.status };
  }
  return { posted: true };
}

/**
 * Placeholder for LeadSimple offboarding trigger.
 * Env: LEADSIMPLE_API_KEY — wire real endpoint when available.
 */
export async function triggerLeadSimpleOffboardingPlaceholder(row) {
  const apiKey = process.env.LEADSIMPLE_API_KEY;
  if (!apiKey) {
    return { triggered: false, reason: "LEADSIMPLE_API_KEY not set" };
  }
  const payload = {
    event: "owner_termination_submitted",
    externalId: row.id,
    ownerEmail: row.email,
    property: {
      line1: row.street_address,
      line2: row.street_address_2,
      city: row.city,
      state: row.state,
      zip: row.zip_code,
    },
    requestedTerminationDate: row.requested_termination_date,
    status: row.status,
  };
  // Replace with: await fetch('https://api.leadsimple.com/...', { headers: { Authorization: `Bearer ${apiKey}` }, ... })
  console.log("[leadsimple] Placeholder offboarding payload:", JSON.stringify(payload));
  return { triggered: true, placeholder: true };
}
