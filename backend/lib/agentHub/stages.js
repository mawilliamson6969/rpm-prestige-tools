/**
 * Stage transition rules for agent_hub_referrals.
 *
 * One source of truth — both the API (advance-stage, mark-lost,
 * mark-declined, restore) and any future Phase 3 automation must use
 * isValidTransition() to gate moves. Keeping the rules in code rather
 * than just the DB CHECK lets us return helpful error messages.
 */

export const STAGES = [
  "lead_received",
  "owner_contacted",
  "property_toured",
  "agreement_pending",
  "agreement_signed",
  "tenant_placed",
  "active_management",
  "lost",
  "declined",
];

export const STAGE_LABELS = {
  lead_received: "Lead Received",
  owner_contacted: "Owner Contacted",
  property_toured: "Property Toured",
  agreement_pending: "Agreement Pending",
  agreement_signed: "Agreement Signed",
  tenant_placed: "Tenant Placed",
  active_management: "Active Management",
  lost: "Lost",
  declined: "Declined",
};

export const TERMINAL_STAGES = new Set(["lost", "declined"]);
// active_management is "completed pipeline" — different from terminal:
// the referral is still tracked (revenue, payments) but the kanban
// shouldn't show it.
export const COMPLETED_STAGES = new Set(["active_management"]);
export const PIPELINE_STAGES = STAGES.filter(
  (s) => !TERMINAL_STAGES.has(s) && !COMPLETED_STAGES.has(s)
);

// Valid forward transitions per the spec. The advance-stage endpoint
// uses this map; mark-lost / mark-declined have their own endpoints.
const ALLOWED = {
  lead_received: new Set(["owner_contacted", "lost", "declined"]),
  owner_contacted: new Set(["property_toured", "lost", "declined"]),
  property_toured: new Set(["agreement_pending", "lost", "declined"]),
  agreement_pending: new Set(["agreement_signed", "lost", "declined"]),
  agreement_signed: new Set(["tenant_placed", "lost"]),
  tenant_placed: new Set(["active_management"]),
  active_management: new Set([]), // Terminal-completed; restore endpoint handles back-transitions.
  lost: new Set([]), // Use restore endpoint.
  declined: new Set([]), // Use restore endpoint.
};

export function isValidTransition(fromStage, toStage) {
  if (!STAGES.includes(toStage)) return false;
  if (!ALLOWED[fromStage]) return false;
  return ALLOWED[fromStage].has(toStage);
}

export function nextAllowedStages(fromStage) {
  return Array.from(ALLOWED[fromStage] || []);
}

export function isTerminal(stage) {
  return TERMINAL_STAGES.has(stage);
}

export function isCompleted(stage) {
  return COMPLETED_STAGES.has(stage);
}

/**
 * Throwable error for invalid transitions. Caught at the route layer
 * and returned as 400.
 */
export function assertValidTransition(fromStage, toStage) {
  if (!isValidTransition(fromStage, toStage)) {
    const allowed = nextAllowedStages(fromStage);
    const reason = TERMINAL_STAGES.has(fromStage) || COMPLETED_STAGES.has(fromStage)
      ? `Use the restore endpoint to revert from ${fromStage}.`
      : allowed.length
        ? `Allowed: ${allowed.join(", ")}.`
        : `No forward transitions from ${fromStage}.`;
    throw Object.assign(
      new Error(`Invalid stage transition: ${fromStage} → ${toStage}. ${reason}`),
      { http: 400 }
    );
  }
}
