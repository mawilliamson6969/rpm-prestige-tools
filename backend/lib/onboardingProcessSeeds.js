// ============================================================
// Onboarding process family — June 2026 canonical templates.
//
// Seeds five process templates (the reusable Process Library
// definitions, NOT running instances):
//   - Initial Walkthrough — Vacant / Owner-Occupied v1.1  (insert)
//   - New Owner Onboarding v2.0                           (replaces v1.0 starter)
//   - New Property Onboarding v1.0                        (replaces "Property Onboarding" if present)
//   - Inherited Tenant Takeover v1.0                      (insert)
//   - Insurance Compliance v1.0                           (insert)
//
// Called from ensureOperationsSchema() on every boot. Idempotent:
// each template is matched by canonical slug or legacy name; when the
// stored name already equals the versioned name below and stages
// exist, the template is left untouched (so UI edits survive reboots).
//
// Replacement preserves the template row's id (instances reference it
// via processes.template_id). Before superseded stages/steps are
// deleted, instance references are made safe:
//   - processes.current_stage_id is remapped old stage -> new stage at
//     the same stage_order (clamped to the last new stage); the FK has
//     no ON DELETE rule, so unmapped deletes would crash.
//   - process_steps.template_step_id provenance pointers to deleted
//     template steps are nulled (instance steps carry their own copy
//     of name/description, so nothing user-visible is lost).
// ============================================================
import { getPool } from "./db.js";

// Stage palette — same hex pairs used by the STAGE_SEEDS starter
// stages in operationsSchema.js. Complete stages use the green pair.
const ACTIVE_PALETTE = [
  ["#B5D4F4", "#042C53"],
  ["#CECBF6", "#26215C"],
  ["#FAC775", "#412402"],
  ["#9FE1CB", "#04342C"],
  ["#F5C4B3", "#4A1B0C"],
  ["#F7C1C1", "#501313"],
];
const COMPLETE_COLORS = ["#C0DD97", "#173404"];

// JSON task type -> step kind. Everything unlisted maps to "todo" and
// keeps the original type as a "Type: …" description line.
const TYPE_TO_KIND = { "Email template": "email", Call: "call" };

// Owners that resolve to users rows (by username). Anything else
// (Auto, OJO, "Amanda + OJO") stays unassigned with an "Owner: …"
// description line.
const OWNER_TO_USERNAME = { Lori: "lori", Amanda: "amanda", Mike: "mike" };

// Step tuples: [ref, title, owner, due, type, notes]
const ONBOARDING_PROCESSES = [
  {
    slug: "initial-walkthrough",
    name: "Initial Walkthrough — Vacant / Owner-Occupied v1.1",
    matchNames: ["Initial Walkthrough — Vacant / Owner-Occupied"],
    matchPrefixes: ["Initial Walkthrough — Vacant / Owner-Occupied v"],
    category: "Operations",
    icon: "🚶",
    color: "#10b981",
    estimatedDays: 15,
    description: [
      "Trigger: PMA signed (vacant or owner-occupied properties only; tenant-occupied excluded)",
      "Target: Handoff to Make-Ready by Day 15",
      "Starts: Make-Ready (at Stage 6 Handoff)",
      "Operating rules:",
      "- Vacant + self-access: skip owner scheduling coordination; walk at next open slot, owner gets confirmation only",
      "- Never wait on the full intake form; five access questions ride in the Day 0 welcome email; Fast-Track Nudge fires Day 2 if unanswered",
      "- Shared inbox rule: access/walkthrough replies in owner@prestigerpm.com are assigned to Lori same day",
      "- Bid policy: line items over $2,500 or specialty trades (roofing, foundation, full HVAC replacement, major electrical) get one outside bid alongside Moon Shadow's estimate",
      "- Moon Shadow affiliation disclosed on every scope document and in the PMA",
      "- No funds, no work: work orders not scheduled until approved scope funding clears or reserve covers it",
      "- Declined safety (Bucket 1) items documented in writing with owner acknowledgment",
      "- Photo standard: minimum 4 photos per room, full interior video, every defect gets close-up + context shot",
    ].join("\n"),
    stages: [
      {
        name: "Initiate",
        exit: "Access method confirmed + occupancy field set",
        steps: [
          ["1.1", "Prep walkthrough record", "Lori", "Day 0", "Task",
            "Verify/create property record in AppFolio; pull access info and utility status into LeadSimple if available; confirm alarm/gate codes; set occupancy field (Vacant / Owner-Occupied)"],
          ["1.2", "Monitor owner@ for access reply and log answers", "Lori", "Day 0-2", "Task",
            "Access answers arrive via the onboarding Day 0 welcome email reply; assign to self in shared inbox same day; log occupancy, access method, codes, utilities, hazards"],
          ["1.3", "Send Fast-Track Nudge if no access answers in 48 hours", "Lori", "Day 2", "Email template",
            "Template A; sends from owner@; reintroduces Lori per Mike's welcome video"],
        ],
      },
      {
        name: "Schedule Walkthrough",
        exit: "Walkthrough on calendar with confirmed access; target: scheduled within 1 business day of access info, conducted by Day 5",
        steps: [
          ["2.1", "Vacant + self-access: book next open calendar slot", "Lori", "Day 1", "Task",
            "No owner coordination; owner gets confirmation only (rule)"],
          ["2.2", "Owner-access or owner-occupied: propose 2-3 time windows", "Lori", "Day 1", "Email template", null],
          ["2.3", "Confirm date/time; calendar event with address, codes, alarm/gate info", "Lori", "Day 2", "Task", null],
          ["2.4", "Send owner confirmation with date and what to expect", "Lori", "Day 2", "Email template", null],
          ["2.5", "Owner-occupied: log planned move-out date (make-ready anchor)", "Lori", "Day 2", "Task", null],
          ["2.6", "Day-before reminder (Lori + owner if meeting on site)", "Auto", "Day before walkthrough", "Automation", null],
        ],
      },
      {
        name: "Conduct Walkthrough",
        exit: "Safety form completed + media uploaded",
        steps: [
          ["3.1", "Conduct property walkthrough", "Lori", "Day 5", "Task",
            "Checklist in description: prep (codes, camera, lockbox+sign); exterior all four sides, roofline, fencing, landscaping, driveway, meters; interior room-by-room per photo standard incl. closets, garage, attic access, under sinks; systems (HVAC runs, water heater, all faucets/toilets, appliances, panel photo, GFCI test); key/remote/mailbox inventory; install RPM lockbox if vacant; note utility status and anything untestable"],
          ["3.2", "Complete safety/inspection form (pass/fail per item)", "Lori", "Day 5", "Form",
            "TX Property Code Ch. 92 items: smoke alarms in required locations, keyless deadbolts, keyed deadbolts, window latches, door viewers, sliding door pin/security bar"],
          ["3.3", "Upload all media to AppFolio same day", "Lori", "Day 5", "Task", null],
        ],
      },
      {
        name: "Condition Report & Make-Ready Scope",
        exit: "Priced scope with rent-ready projection, ready to send",
        steps: [
          ["4.1", "Build make-ready scope in three buckets", "Lori", "Day 7", "Task",
            "Scope of Work & Estimate Excel template. Bucket 1 Safety & Compliance (required); Bucket 2 Functional Repairs (recommended); Bucket 3 Cosmetic/Rent-Readiness (optional, rent impact noted)"],
          ["4.2", "Price the scope", "Lori", "Day 8", "Task",
            "Moon Shadow estimates by default; outside bid per bid policy (>$2,500 or specialty trade); flag specialist items"],
          ["4.3", "Set projected rent-ready date", "Lori", "Day 8", "Task",
            "Feeds marketing notification at Handoff"],
        ],
      },
      {
        name: "Owner Approval",
        exit: "Signed/confirmed scope + funds in hand (or reserve sufficient)",
        steps: [
          ["5.1", "Send scope to owner with bucket framing and a specific response date", "Lori", "Day 9", "Email template",
            "PDF of scope form + walkthrough photo highlights"],
          ["5.2", "Follow-up cadence if no response: Day 2 email, Day 4 call, Day 7 escalation note", "Auto", "Conditional", "Automation", null],
          ["5.3", "Log line-item decisions; obtain signed copy; file in AppFolio", "Lori", "On response", "Task",
            "Declined Bucket 1 items documented with written owner acknowledgment"],
          ["5.4", "Collect owner funds if approved scope exceeds reserve", "Lori", "On approval", "Task",
            "No funds, no work. Disclose maintenance coordination fee here if applicable"],
        ],
      },
      {
        name: "Handoff",
        exit: "Work orders live, Make-Ready running, marketing notified",
        steps: [
          ["6.1", "Create work orders in AppFolio for approved items", "Lori", "Day 1 of stage", "Task",
            "Moon Shadow items to techs; vendor items dispatched with approved scope language verbatim — no re-scoping by phone"],
          ["6.2", "Kick off Make-Ready process with target completion date", "Lori", "Day 1 of stage", "Process trigger", null],
          ["6.3", "Notify marketing of projected list date", "Lori", "Day 1 of stage", "Task",
            "Listing prep starts before work finishes — biggest Days-Without-Revenue lever"],
          ["6.4", "Sync with New Owner Onboarding (insurance proof, utility transfer, file changes)", "Lori", "Day 2 of stage", "Task", null],
        ],
      },
      {
        name: "Complete",
        exit: "Baseline archived; reference point for first move-out disposition and condition disputes",
        steps: [
          ["7.1", "Archive condition baseline (signed scope + safety form + media) as day-zero record; close process; log days-to-complete", "Lori", "Day 15", "Task", null],
        ],
      },
    ],
  },
  {
    slug: "owner-onboarding",
    name: "New Owner Onboarding v2.0",
    matchNames: ["New Owner Onboarding", "Owner Onboarding"],
    matchPrefixes: ["New Owner Onboarding v", "Owner Onboarding v"],
    category: "Owner Relations",
    icon: "🏠",
    color: "#0098D0",
    estimatedDays: 7,
    description: [
      "Trigger: PMA signed (Adobe Sign → auto-create)",
      "Target: Setup complete Day 7",
      "Replaces: New Owner Onboarding v1.0 (May 2026 build) — universal Day 0 broker call removed (welcome video replaces it); 90-day experience sequence split to separate Owner Experience 90 process",
      "Starts: Initial Walkthrough (vacant/owner-occupied) + Inherited Tenant Takeover (occupied) at Stage 1; New Property Onboarding (one instance per property) at Stage 3; Owner Experience 90 at Stage 5 complete",
      "Operating rules:",
      "- Never wait on the full intake form; five access questions ride in the Day 0 welcome email; Fast-Track Nudge fires Day 2 if unanswered",
      "- No funds, no work: work orders not scheduled until approved scope funding clears or reserve covers it",
      "- Flag-at-setup / act-at-event pattern: first-statement Loom video flag set during onboarding, fired by the monthly statement cycle, cleared when sent",
    ].join("\n"),
    stages: [
      {
        name: "Initiate",
        exit: "Welcome email sent + parallel processes confirmed running",
        steps: [
          ["1.1", "Send Day 0 welcome email from owner@", "Amanda", "Day 0", "Email template",
            "HARD TASK — Initial Walkthrough depends on this send. Contains: broker welcome video (top), five access questions (reply-now), owner intake form link (few-days deadline), note that Lori follows up on walkthrough date"],
          ["1.2", "Verify Initial Walkthrough auto-started; if occupied, kick off Inherited Tenant Takeover", "Amanda", "Day 0", "Task", null],
          ["1.3", "Create owner shell record in AppFolio", "Amanda", "Day 0", "Task", null],
          ["1.4", "Broker-call flag: multi-property / referral source / high-touch → notify Mike", "Amanda", "Day 0", "Task",
            "Conditional. Replaces universal Day 0 broker call"],
          ["1.5", "Log PMA signature timestamp (Day 7 SLA clock)", "Auto", "Day 0", "Automation", null],
        ],
      },
      {
        name: "Intake Form Collection",
        exit: "Complete intake form received and confirmed; target Day 3, hard stop Day 5",
        steps: [
          ["2.1", "Monitor JotForm submissions + owner@ replies daily", "Amanda", "Daily", "Task",
            "Access answers may arrive by email reply before the form — log them, don't wait"],
          ["2.2", "Reminder email if form not submitted", "Amanda", "Day 2", "Email template", null],
          ["2.3", "Personal call if still not submitted — 'anything giving you trouble?'", "Amanda", "Day 4", "Call", null],
          ["2.4", "Day 4 no-form = wobble flag → notify Mike for possible broker touch", "Amanda", "Day 4", "Task", null],
          ["2.5", "On submission: completeness review; resolve all gaps in ONE batched touch", "Amanda", "Day of submission", "Task", null],
          ["2.6", "Confirm receipt to owner with what happens next", "Amanda", "Day of submission", "Email template", null],
        ],
      },
      {
        name: "Property Registration",
        exit: "Property Onboarding instances running = property count field",
        steps: [
          ["3.1", "Fill custom fields: number of properties, each address, occupancy per property", "Amanda", "On form receipt", "Task", null],
          ["3.2", "Kick off New Property Onboarding — one instance per property", "Amanda", "Same day", "Process trigger",
            "Task incomplete until instance count matches property count field (fan-out check)"],
          ["3.3", "Verify single AppFolio record per property (link, never duplicate)", "Amanda", "Same day", "Task", null],
        ],
      },
      {
        name: "Account Setup & Records",
        exit: "AppFolio configured, banking verified, reserve funded, PMA filed",
        steps: [
          ["4.1", "Complete AppFolio owner record: entity type, names as on title, mailing address, W-9", "Amanda", "Day 4", "Task", null],
          ["4.2", "Enter fee structure verified against the EXECUTED PMA", "Amanda", "Day 4", "Task",
            "Management %, leasing fee, maintenance coordination fee if applicable, negotiated terms. Not from memory, not from the proposal"],
          ["4.3", "ACH/banking setup + verification", "Amanda", "Day 5", "Task", null],
          ["4.4", "Confirm owner reserve funded per PMA", "Amanda", "Day 5", "Task",
            "Feeds walkthrough's no-funds-no-work rule; reserve status visible cross-process"],
          ["4.5", "File executed PMA in AppFolio, tagged to owner + properties", "Amanda", "Day 4", "Task", null],
          ["4.6", "Activate owner portal, send invite with login walkthrough", "Amanda", "Day 5", "Email template", null],
          ["4.7", "Notify OJO: account live, fee structure, first statement cycle date", "Amanda", "Day 5", "Task", null],
        ],
      },
      {
        name: "Orientation & Close-Out",
        exit: "Portal login confirmed, packet delivered, Experience 90 running, open items documented",
        steps: [
          ["5.1", "Verify owner actually logged into portal; 2-minute walkthrough call if not", "Amanda", "Day 6", "Task", null],
          ["5.2", "Send welcome packet with communication expectations and optional 15-min call offer", "Amanda", "Day 6", "Email template",
            "Packet: how to read your statement, what triggers maintenance approval, common first-year surprises, who to contact"],
          ["5.3", "Cross-process status check: walkthrough on track? Property Onboarding instances moving?", "Amanda", "Day 7", "Task", null],
          ["5.4", "Confirm first statement cycle with OJO; set First Statement Video flag = Pending", "Amanda", "Day 7", "Task",
            "Flag is consumed by the monthly statement cycle: pending owners get an Amanda-recorded Loom walking through their actual first statement, sent same day it posts"],
          ["5.5", "Internal summary note: owner profile, fee terms, quirks, broker-flag status", "Amanda", "Day 7", "Task", null],
          ["5.6", "Log open items with owners and dates — nothing closes silently incomplete", "Amanda", "Day 7", "Task", null],
          ["5.7", "Trigger Owner Experience 90 process", "Amanda", "Day 7", "Process trigger", null],
        ],
      },
      {
        name: "Complete",
        exit: "Process closed; days-to-complete logged against Day 7 SLA",
        steps: [
          ["6.1", "Mark complete; log actual days-to-complete vs Day 7 SLA", "Amanda", "Day 7", "Task", null],
        ],
      },
    ],
  },
  {
    slug: "property-onboarding",
    name: "New Property Onboarding v1.0",
    matchNames: ["New Property Onboarding", "Property Onboarding"],
    matchPrefixes: ["New Property Onboarding v", "Property Onboarding v"],
    category: "Owner Relations",
    icon: "🏘️",
    color: "#8b5cf6",
    estimatedDays: 8,
    description: [
      "Trigger: Owner Onboarding Stage 3 (Property Registration) — one instance per property",
      "Target: Complete within 8 days of trigger (~Day 11-13 overall)",
      "Starts: Insurance Compliance (initial cert) at Stage 3",
    ].join("\n"),
    stages: [
      {
        name: "Initiate",
        exit: "Record linked, property form sent, lead paint clock started if applicable",
        steps: [
          ["1.1", "Verify AppFolio property record exists and link it (walkthrough may have created it)", "Amanda", "Day 1", "Task", null],
          ["1.2", "Send Property Information Form, pre-filled with address", "Amanda", "Day 1", "Form",
            "JotForm URL parameters pre-fill the address; one form per property"],
          ["1.3", "If pre-1978: send lead-based paint disclosure for signature", "Amanda", "Day 1", "Adobe Sign",
            "Year built is on the PMA — form-independent; required before any lease signs"],
        ],
      },
      {
        name: "Form Collection",
        exit: "Property form returned, or Day 5 hard stop with gaps logged",
        steps: [
          ["2.1", "Monitor submission", "Amanda", "Daily", "Task", null],
          ["2.2", "Reminder email if not returned", "Amanda", "Day 2", "Email template", null],
          ["2.3", "Phone call if still not returned", "Amanda", "Day 4", "Call", null],
          ["2.4", "Hard stop: proceed with knowns, gaps logged", "Amanda", "Day 5", "Task", null],
        ],
      },
      {
        name: "Records & Compliance",
        exit: "All applicable conditionals resolved or confirmed not-applicable",
        steps: [
          ["3.1", "Populate property custom fields from form: occupancy, HOA, warranty, utilities, appliance ages", "Amanda", "On form receipt", "Task", null],
          ["3.2", "Kick off Insurance Compliance process", "Amanda", "Same day", "Process trigger",
            "Agent/policy info from the form makes the cert request faster"],
          ["3.3", "If home warranty: log company/plan/account; set maintenance dispatch flag", "Amanda", "Same day", "Task",
            "Flag means: warranty claim before Moon Shadow rolls a truck"],
          ["3.4", "If HOA: log contacts/dues, file covenants, send management notification letter", "Amanda", "Day +1", "Email template",
            "Routes violations to RPM, not the owner's home address"],
          ["3.5", "Log utility strategy with account numbers (RPM vacant account vs owner name until lease)", "Amanda", "Day +1", "Task", null],
        ],
      },
      {
        name: "Physical Assets",
        exit: "Keys reconciled (hard requirement); documents filed (whatever came)",
        steps: [
          ["4.1", "Keys/remotes/mailbox keys received; reconcile against walkthrough key inventory; resolve mismatches with owner now", "Amanda", "Day 4 of stage", "Task", null],
          ["4.2", "Collect manuals, warranties, paint colors, vendor history — one ask, take what they have", "Amanda", "Day 4 of stage", "Email template", null],
        ],
      },
      {
        name: "Complete",
        exit: "Every custom field has a value or explicit N/A — blank means unknown, N/A means checked",
        steps: [
          ["5.1", "Verify all fields valued; close; log days-to-complete", "Amanda", "Day 8", "Task", null],
        ],
      },
    ],
  },
  {
    slug: "inherited-tenant-takeover",
    name: "Inherited Tenant Takeover v1.0",
    matchNames: ["Inherited Tenant Takeover"],
    matchPrefixes: ["Inherited Tenant Takeover v"],
    category: "Leasing",
    icon: "🔑",
    color: "#f59e0b",
    estimatedDays: 30,
    description: [
      "Trigger: PMA signed + property occupied (fired from Owner Onboarding 1.2)",
      "Target: Tenant fully transitioned by first rent cycle",
    ].join("\n"),
    stages: [
      {
        name: "Records Acquisition",
        exit: "Takeover packet received; gaps explicitly listed. Constraint stage — escalate to owner if stalled past Day 10",
        steps: [
          ["1.1", "Request takeover packet from owner or prior manager (with owner authorization)", "Amanda", "Day 0", "Email template",
            "Executed lease + amendments, tenant contact info, ledger/rent roll, deposit amount, pet/vehicle/occupant records, open maintenance or disputes"],
          ["1.2", "Follow-up: Day 3 nudge, Day 5 call — owner applies pressure on prior manager, not us", "Amanda", "Day 3-5", "Automation", null],
          ["1.3", "Log received items; list gaps explicitly (lease missing an amendment = gap)", "Amanda", "On receipt", "Task", null],
        ],
      },
      {
        name: "Deposit Transfer & Verification",
        exit: "Deposit in trust, posting confirmed, written acknowledgment delivered",
        steps: [
          ["2.1", "Verify deposit amount three ways: lease, owner, ledger; resolve mismatches in writing before funds move", "Amanda", "Day 5", "Task", null],
          ["2.2", "Deposit funds received into RPM trust account; OJO confirms posting", "Amanda + OJO", "Day 7", "Task", null],
          ["2.3", "Written acknowledgment to owner of exact deposit amount received and held", "Amanda", "Day 7", "Email template",
            "Mirrors TX Prop. Code §92.105 signed-statement requirement; protection at move-out disposition. Retain permanently"],
        ],
      },
      {
        name: "Lease Audit",
        exit: "Lease audited; flagged items have a remediation or routing plan. Runs parallel with Stage 2",
        steps: [
          ["3.1", "Audit lease vs TX requirements and RPM standards", "Lori", "Day 8", "Task",
            "Rent, expiration, late fee terms (§92.019), security device gaps, unusual owner concessions now ours to honor. Licensed-judgment task"],
          ["3.2", "Flag actions: non-compliant terms → remediation plan; expiring-soon leases → route to Renewal early", "Lori", "Day 8", "Task", null],
        ],
      },
      {
        name: "Tenant Introduction",
        exit: "Tenant portal login confirmed (an invite is not an introduction)",
        steps: [
          ["4.1", "Send tenant introduction letter (email + mail)", "Amanda", "Day 8", "Email template",
            "Who we are, where rent goes starting [date], portal link, maintenance channel, your-lease-terms-don't-change reassurance"],
          ["4.2", "Activate tenant portal; confirm login", "Amanda", "Day 10", "Task", null],
        ],
      },
      {
        name: "Rent Collection Switch",
        exit: "First rent through RPM; opening balance verified against inherited ledger",
        steps: [
          ["5.1", "Confirm prior payment method is dead — tell the owner in writing to stop accepting direct payment", "Amanda", "Before 1st of month", "Task", null],
          ["5.2", "First rent received through RPM; ledger opening balance verified", "Amanda + OJO", "5th of month", "Task", null],
        ],
      },
      {
        name: "Complete",
        exit: "Inherited file archived as tenant baseline",
        steps: [
          ["6.1", "Archive inherited file as baseline; close; log days-to-complete", "Amanda", "After first rent cycle", "Task", null],
        ],
      },
    ],
  },
  {
    slug: "insurance-compliance",
    name: "Insurance Compliance v1.0",
    matchNames: ["Insurance Compliance"],
    matchPrefixes: ["Insurance Compliance v"],
    category: "Operations",
    icon: "🛡️",
    color: "#6A737B",
    estimatedDays: 21,
    description: [
      "Trigger: DUAL: (a) Property Onboarding Stage 3 — initial cert; (b) 30 days before any cert expiration — renewal",
      "Target: Cert on file within 21 days; standing process, never fully closes",
    ].join("\n"),
    stages: [
      {
        name: "Collect & Verify",
        exit: "Verified cert on file; expiration date logged (arms the renewal trigger)",
        steps: [
          ["1.1", "Request certificate — owner and/or directly to their insurance agent", "Amanda", "Day 0", "Email template",
            "Agents respond faster than owners; agent info comes from the property form"],
          ["1.2", "Follow-up cadence: Day 7 nudge, Day 14 second touch, Day 21 broker escalation", "Amanda", "Day 7-21", "Automation",
            "Day 21 framing: PMA requires coverage; uninsured property under management is mutual liability exposure"],
          ["1.3", "Verify: RPM Prestige named additional insured, coverage adequate, dates current", "Amanda", "On receipt", "Task", null],
          ["1.4", "Log expiration date — this arms the 30-day renewal trigger", "Amanda", "On receipt", "Task", null],
          ["1.5", "Close instance", "Amanda", "On verification", "Task", null],
        ],
      },
    ],
  },
];

function parsePlainDay(due) {
  const m = /^Day (\d+)$/.exec(due || "");
  return m ? Number(m[1]) : null;
}

function buildStepDescription([ref, , owner, due, type, notes]) {
  const lines = [`Ref: ${ref}`];
  if (notes) lines.push(notes);
  if (!TYPE_TO_KIND[type]) lines.push(`Type: ${type}`);
  if (!OWNER_TO_USERNAME[owner]) lines.push(`Owner: ${owner}`);
  if (parsePlainDay(due) == null) lines.push(`Due: ${due}`);
  return lines.join("\n");
}

export async function ensureOnboardingProcessSeeds() {
  const pool = getPool();

  const { rows: userRows } = await pool.query(
    `SELECT id, LOWER(username) AS username FROM users WHERE LOWER(username) = ANY($1)`,
    [Object.values(OWNER_TO_USERNAME)]
  );
  const userIdByUsername = Object.fromEntries(userRows.map((u) => [u.username, u.id]));

  for (const proc of ONBOARDING_PROCESSES) {
    // Match by canonical slug first, then legacy/old-version names.
    const { rows: found } = await pool.query(
      `SELECT id, name FROM process_templates
        WHERE slug = $1 OR name = ANY($2::text[]) OR name ILIKE ANY($3::text[])
        ORDER BY (slug = $1) DESC, id ASC
        LIMIT 1`,
      [proc.slug, [...proc.matchNames, proc.name], proc.matchPrefixes.map((p) => `${p}%`)]
    );

    let templateId;
    if (found.length > 0) {
      templateId = found[0].id;
      if (found[0].name === proc.name) {
        const { rows: stageCount } = await pool.query(
          `SELECT COUNT(*)::int AS c FROM process_template_stages WHERE template_id = $1`,
          [templateId]
        );
        // Current version already loaded — leave it (and any UI edits) alone.
        if (stageCount[0].c > 0) continue;
      }
      await pool.query(
        `UPDATE process_templates
            SET name = $2, slug = $3, description = $4, category = $5,
                icon = $6, color = $7, estimated_days = $8, is_active = true,
                updated_at = NOW()
          WHERE id = $1`,
        [templateId, proc.name, proc.slug, proc.description, proc.category, proc.icon, proc.color, proc.estimatedDays]
      );
    } else {
      const { rows: inserted } = await pool.query(
        `INSERT INTO process_templates (name, slug, description, category, icon, color, estimated_days, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true)
         RETURNING id`,
        [proc.name, proc.slug, proc.description, proc.category, proc.icon, proc.color, proc.estimatedDays]
      );
      templateId = inserted[0].id;
    }

    // Capture superseded stages/steps before inserting replacements.
    const { rows: oldStages } = await pool.query(
      `SELECT id, stage_order FROM process_template_stages WHERE template_id = $1 ORDER BY stage_order, id`,
      [templateId]
    );
    const { rows: oldSteps } = await pool.query(
      `SELECT id FROM process_template_steps WHERE template_id = $1`,
      [templateId]
    );

    const { rows: instanceCount } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM processes WHERE template_id = $1`,
      [templateId]
    );
    if (instanceCount[0].c > 0) {
      console.warn(
        `[onboarding-seeds] Template "${proc.name}" (id ${templateId}) has ${instanceCount[0].c} instance(s); ` +
          `remapping current_stage_id by stage position and nulling template_step_id provenance before replacing stages/steps.`
      );
    }

    // Insert the new stages (all "active" except the final Complete stage).
    const newStageIds = [];
    for (const [i, stage] of proc.stages.entries()) {
      const isComplete = stage.name === "Complete";
      const [color, textColor] = isComplete
        ? COMPLETE_COLORS
        : ACTIVE_PALETTE[i % ACTIVE_PALETTE.length];
      const { rows: ins } = await pool.query(
        `INSERT INTO process_template_stages
           (template_id, name, description, stage_order, color, text_color, is_final, auto_advance, category)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)
         RETURNING id`,
        [
          templateId,
          stage.name,
          `Exit: ${stage.exit}`,
          i,
          color,
          textColor,
          isComplete,
          isComplete ? "completed" : "active",
        ]
      );
      newStageIds.push(ins[0].id);
    }

    // Make instance references safe, then delete the superseded rows.
    if (oldStages.length > 0) {
      for (const [i, old] of oldStages.entries()) {
        const replacement = newStageIds[Math.min(i, newStageIds.length - 1)];
        await pool.query(
          `UPDATE processes SET current_stage_id = $2 WHERE current_stage_id = $1`,
          [old.id, replacement]
        );
      }
    }
    if (oldSteps.length > 0) {
      const oldStepIds = oldSteps.map((s) => s.id);
      await pool.query(
        `UPDATE process_steps SET template_step_id = NULL WHERE template_step_id = ANY($1::int[])`,
        [oldStepIds]
      );
      await pool.query(`DELETE FROM process_template_steps WHERE id = ANY($1::int[])`, [oldStepIds]);
    }
    if (oldStages.length > 0) {
      await pool.query(`DELETE FROM process_template_stages WHERE id = ANY($1::int[])`, [
        oldStages.map((s) => s.id),
      ]);
    }

    // Insert steps, numbered sequentially across the template in JSON order.
    let stepNumber = 0;
    for (const [i, stage] of proc.stages.entries()) {
      for (const step of stage.steps) {
        stepNumber += 1;
        const [, title, owner, due, type] = step;
        const days = parsePlainDay(due);
        const username = OWNER_TO_USERNAME[owner];
        const isAuto = owner === "Auto";
        await pool.query(
          `INSERT INTO process_template_steps
             (template_id, stage_id, step_number, name, description,
              assigned_role, assigned_user_id, due_days_offset,
              due_date_type, due_date_config, kind, task_type, actor,
              when_text, day_offset)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            templateId,
            newStageIds[i],
            stepNumber,
            title,
            buildStepDescription(step),
            username ? owner : null,
            username ? (userIdByUsername[username] ?? null) : null,
            days,
            days != null ? "offset_from_start" : "no_due_date",
            JSON.stringify(days != null ? { days } : {}),
            TYPE_TO_KIND[type] || "todo",
            TYPE_TO_KIND[type] || "todo",
            isAuto ? "auto" : "manual",
            due,
            days,
          ]
        );
      }
    }
    console.log(`[onboarding-seeds] Loaded "${proc.name}" (template id ${templateId}).`);
  }
}
