/**
 * Maintenance Management System — canonical Prestige Connect event surface.
 *
 * Single source of truth for every `maintenance.*` event type the modules
 * emit. Emit call sites import MAINT_EVENT constants (no string literals) so
 * types can't drift, routes/automations.js registers MAINT_EVENT_TYPES as
 * first-class automation triggers, and GET /maintenance/event-types serves
 * MAINT_EVENT_CATALOG so operators can discover what to build automations on.
 *
 * Operators can trigger on these either by selecting the exact type as an
 * automation trigger, or via a `custom.event` automation with an
 * `event_type_pattern` of `maintenance.*` (or a narrower prefix).
 *
 * All events are emitted with source "internal". Every payload includes the
 * primary entity id; job-scoped events also carry property_id where known.
 */

export const MAINT_EVENT = {
  JOB_CREATED: "maintenance.job_created",
  STATUS_CHANGED: "maintenance.status_changed",
  COI_EXPIRING: "maintenance.coi_expiring",
  TECH_ASSIGNED: "maintenance.tech_assigned",
  QUOTE_SENT: "maintenance.quote_sent",
  QUOTE_APPROVED: "maintenance.quote_approved",
  QUOTE_DECLINED: "maintenance.quote_declined",
  PROJECT_CREATED: "maintenance.project_created",
};

/**
 * Discovery catalog. `payload` lists the keys each event carries so an
 * automation author knows what a filter/template can reference.
 */
export const MAINT_EVENT_CATALOG = [
  {
    type: MAINT_EVENT.JOB_CREATED,
    label: "Job created",
    description: "A maintenance job/ticket was created.",
    payload: ["job_id", "property_id", "priority", "source"],
  },
  {
    type: MAINT_EVENT.STATUS_CHANGED,
    label: "Job status changed",
    description:
      "A job moved along the pipeline (new → triaged → quoted → scheduled → in_progress → complete → invoiced). Also fires when an approved quote schedules the job.",
    payload: ["job_id", "property_id", "from_status", "to_status", "priority"],
  },
  {
    type: MAINT_EVENT.COI_EXPIRING,
    label: "Subcontractor COI expiring",
    description:
      "A subcontractor's Certificate of Insurance is within 30 days of expiry or has lapsed.",
    payload: ["subcontractor_id", "company_name", "coi_expiry"],
  },
  {
    type: MAINT_EVENT.TECH_ASSIGNED,
    label: "Tech assigned",
    description: "A tech was scheduled onto a job.",
    payload: ["assignment_id", "job_id", "tech_id", "scheduled_start"],
  },
  {
    type: MAINT_EVENT.QUOTE_SENT,
    label: "Quote sent for signature",
    description: "A quote was sent to the owner for e-signature via PrestigeSign.",
    payload: ["quote_id", "job_id", "esign_request_id"],
  },
  {
    type: MAINT_EVENT.QUOTE_APPROVED,
    label: "Quote approved",
    description: "The owner approved a quote; the linked job advances to scheduled.",
    payload: ["quote_id", "job_id"],
  },
  {
    type: MAINT_EVENT.QUOTE_DECLINED,
    label: "Quote declined",
    description: "The owner declined a quote.",
    payload: ["quote_id", "job_id"],
  },
  {
    type: MAINT_EVENT.PROJECT_CREATED,
    label: "Make-ready project created",
    description: "A make-ready / multi-task project was created.",
    payload: ["project_id", "property_id", "name"],
  },
];

/** Flat list of every maintenance event type string. */
export const MAINT_EVENT_TYPES = MAINT_EVENT_CATALOG.map((e) => e.type);
