/**
 * Maintenance Management System — Prestige Connect event discovery (Phase 6).
 *
 * GET /maintenance/event-types — returns the maintenance.* event catalog so
 * operators (and the automations UI) can see which lifecycle events exist and
 * what each payload carries when building automations.
 */

import { MAINT_EVENT_CATALOG } from "../lib/maint-events.js";

export function getMaintEventTypes(_req, res) {
  res.json({ eventTypes: MAINT_EVENT_CATALOG });
}
