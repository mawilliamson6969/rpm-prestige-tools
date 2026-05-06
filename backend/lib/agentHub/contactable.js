/**
 * isContactable() — single source of truth for "may we send to this agent".
 *
 * Phase 1 doesn't actually send anything, but every outreach feature added
 * in Phase 2+ MUST gate through this function. Putting the rule in one place
 * means the DNC firewall is impossible to forget.
 *
 * Channels covered: email, sms, postcard, call.
 *
 * Rules (apply in order, most-restrictive first):
 *   1. status === 'deleted' → never contactable, on any channel.
 *   2. do_not_contact === true → never contactable.
 *   3. status === 'dnc' → never contactable. (Belt + suspenders: do_not_contact
 *      should also be true here per the DB CHECK constraint, but enforce again
 *      in code in case the data ever drifts.)
 *   4. unsubscribed_at is set → never contactable for email/sms.
 *   5. Email channel requires consent_to_email === true.
 *   6. SMS channel requires consent_to_sms === true.
 *   7. Postcard / call: no explicit consent flag in Phase 1, but we still
 *      respect the master DNC. (Consent for these is implicit by being a
 *      manually-added contact in our CRM.)
 *
 * Returns { contactable: bool, reason: string|null }.
 */

const ALL_CHANNELS = new Set(["email", "sms", "postcard", "call", "any"]);

export function isContactable(agent, channel = "any") {
  if (!agent) return { contactable: false, reason: "Agent not found." };
  if (!ALL_CHANNELS.has(channel)) {
    return { contactable: false, reason: `Unknown channel: ${channel}.` };
  }
  if (agent.status === "deleted") {
    return { contactable: false, reason: "Agent is deleted." };
  }
  if (agent.do_not_contact === true) {
    return { contactable: false, reason: "Agent is marked Do Not Contact." };
  }
  if (agent.status === "dnc") {
    return { contactable: false, reason: "Agent status is DNC." };
  }
  if (agent.unsubscribed_at) {
    if (channel === "email" || channel === "sms" || channel === "any") {
      return { contactable: false, reason: "Agent has unsubscribed." };
    }
  }
  if (channel === "email") {
    if (!agent.consent_to_email) {
      return { contactable: false, reason: "No email consent on file." };
    }
    if (!agent.email) {
      return { contactable: false, reason: "No email address on file." };
    }
  }
  if (channel === "sms") {
    if (!agent.consent_to_sms) {
      return { contactable: false, reason: "No SMS consent on file." };
    }
    if (!agent.phone_mobile) {
      return { contactable: false, reason: "No mobile phone on file." };
    }
  }
  if (channel === "postcard" || channel === "mail") {
    if (!agent.mailing_address_1) {
      return { contactable: false, reason: "No mailing address on file." };
    }
  }
  if (channel === "call") {
    if (!agent.phone_mobile && !agent.phone_office) {
      return { contactable: false, reason: "No phone number on file." };
    }
  }
  return { contactable: true, reason: null };
}
