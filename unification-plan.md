# Prestige Dash — Unification Plan

> Merging Operations Hub Processes (System A) and Monday Boards (System B) into one coherent operations layer.

## Why this document exists

Through Phases 1–6 of the Monday Boards work, a parallel system was built without recognizing that Prestige Dash already had a more complete workflow engine in the Operations Hub. The duplication needs to be resolved deliberately, with a clear plan, before any more code is written.

This document is the single source of truth for how the two systems merge. Every subsequent Claude Code prompt should reference back to this document for the canonical answer on schema, routes, naming, and boundaries.

## Locked-in decisions

These were settled in conversation. Do not relitigate.

1. **Engine:** System A (Operations Hub processes) is the workflow engine. Stages, steps, automations, templates, custom fields, autopilot, dependencies — all from System A.
2. **View:** System B (Monday Boards) is the primary visual surface. The table-style board view is the default way users see and interact with work.
3. **Item detail page:** System A's process detail page (image 6 from the conversation) becomes the canonical detail page, *reskinned* to match the Monday Board look and *enhanced* with System B's Updates feed (comments, @mentions, reactions, replies, attachments).
4. **User-facing terminology:** "Processes" (System A's name). A renewal is a process. A maintenance ticket is a process. Items on the board ARE processes.
5. **URLs:** All under `/operations/boards/*` (System B's URL space). System A's `/operations/processes/*` URLs redirect to the equivalent board URL.
6. **System B's existing seed data:** Delete entirely (Phase 3 seed renewals, Phase 5 subitem templates as a separate concept, Phase 6 aggregation cache). No production usage to preserve.
7. **System A's production usage:** Zero. Maximum flexibility to refactor without backward compatibility concerns.

## What "unified" means concretely

**One concept, two views:**

- A **process** is an instance of work (one renewal, one maintenance ticket, one inspection). It lives in System A's `processes` table.
- A **template** defines a process type (Lease Renewal, Move-In, Maintenance Escalation, etc.). Lives in System A's templates.
- A **board** is the Monday-style table view of all processes for one template. There is one board per template.
- A **process detail page** is the single-process view, accessed by clicking into a row on a board.

So: "the Renewals board" is the Monday-style view of all active Lease Renewal processes. "Garcia Family Renewal" is one row on that board, and clicking it opens the process detail page (the reskinned System A page with System B's Updates feed welded in).

There are no longer separate concepts for "Monday board items" vs. "processes." They are the same thing, displayed in different ways.

**One database for processes, one for the visual layer:**

- Process state, stages, steps, automation, templates, custom fields → System A's tables (`processes`, `process_stages`, `process_steps`, `process_templates`, etc.)
- Updates feed (comments/mentions/reactions/replies/attachments from Phase 4) → System B's tables (`mb_updates`, `mb_update_mentions`, etc.), but rekeyed to `process_id` instead of `mb_item_id`
- Board configuration (columns shown, sort order, group-by, view preferences) → could be either; recommend System A's `process_templates` extended with display config, or a new lightweight `board_view_config` table

**One set of URLs:**

- `/operations/boards/[slug]` — Monday-style table view of all processes for a template (renewals, maintenance, etc.)
- `/operations/boards/[slug]/items/[id]` — single process detail page
- `/operations/boards/[slug]/triage`, `/calendar`, `/dashboards` — view variants from Phase 6
- `/operations/boards/manage` — admin page for creating/editing templates (formerly System A's template editor)
- `/operations/processes/*` — redirect to corresponding `/operations/boards/*`

## What gets ripped, kept, or refactored

### From System B (Monday Boards, Phases 1–6) — what stays, what goes

**Keep and integrate:**
- The Monday-style table view (Phase 3) — becomes the rendering layer for processes
- The board customization UI (Phase 3.5) — refactored to edit System A templates instead of System B boards
- The Updates feed (Phase 4) — rekeyed from items to processes; otherwise unchanged
- The Triage dashboard (Phase 6) — rewritten to query processes instead of items, scoring formula stays
- The Calendar dashboard (Phase 6) — same, reads processes
- The sidebar boards navigation (Phase 6.1 hotfix) — repurposed to list templates

**Rip out:**
- The Phase 3 Renewals seed data (8–12 sample items in `mb_items`)
- The Phase 5 subitem templates as a separate concept — System A's stages and steps replace them. The 8 instruction sections (objective, decision matrix, email templates, etc.) become per-step fields on System A's `process_steps`.
- The Phase 6 auto-aggregation logic (`aggregated_status`, `auto_aggregate_status`, `auto_aggregate_progress` settings) — System A already tracks stage progress; aggregation is unnecessary because the engine reports actual state, not derived state.
- Most of the `mb_*` schema. Specifically: `mb_items`, `mb_columns`, `mb_groups`, `mb_subitems`, `mb_subitem_templates`, `mb_instructions`, `mb_subitem_checklist_state`, `mb_board_settings`. Keep only: `mb_updates`, `mb_update_mentions`, `mb_update_reactions`, `mb_update_attachments` (rekeyed to processes).

**Refactor:**
- The Phase 3.5 board customization → becomes the template editor (replacing System A's template editor UI from image 4, but driving the same underlying System A tables)
- The Phase 4 item detail page → becomes the process detail page, with column values replaced by System A's stages + steps + custom fields

### From System A (Operations Hub processes) — what stays, what goes

**Keep:**
- All backend logic and routes (`processes.js`, `processStages.js`, `processSettings.js`, `processTemplates.js`, `processAnalytics.js`, `processBoardExtras.js`)
- The schema: `processes`, `process_stages`, `process_steps`, `process_templates`, custom fields tables
- All 10+ existing process templates (Lease Renewal, Move-In, Maintenance Escalation, etc.) — these are the prior art we don't want to recreate
- The Launch Process wizard (image 1, 2) — keep as-is, accessible from the boards
- The Operations Hub top navigation (Tasks / My Tasks / Projects / Processes / Analytics / Templates) — the "Processes" tab now opens the boards view

**Rip out:**
- System A's existing process detail page (image 6 — the kanban-column layout with the sidebar) — replaced by the reskinned page using System B's Phase 4 layout
- System A's "Board / Table / Timeline / Calendar / Dashboard" view toggle (image 3) — the new default IS the Monday board view; other views become Phase 6's dashboards
- System A's existing template editor UI (image 4) — replaced by the Phase 3.5 customization UI (reused/refactored)

**Don't touch:**
- Anything in `processAnalytics.js` or analytics views unless directly affected
- The cached_leadsimple_* tables (separate concern; LeadSimple integration is a different question handled in Phase 7.4)

## Sequencing — the phases

The work sequences into 6 phases. Each is a focused Claude Code session (or short series of sessions).

### Phase 7: Foundation — boards read from processes

The first and most important phase. Establishes the principle that boards are views of processes, not separate entities.

**Includes:**
- New route `/operations/boards/[slug]` that resolves slug → process template
- Renewals board reads from `processes` where `template = Lease Renewal`, displays as Monday-style table
- Each row shows: process name, current stage (as status column), assignee, due date, custom field values
- Click a row → goes to `/operations/boards/[slug]/items/[id]` (URL pattern from Phase 4, still works)
- Process detail page: System B Phase 4 layout, but driven by process data (stages + steps shown where column values were, Updates feed unchanged)
- The "Launch Process" button (image 2) is accessible from the board header
- Subitem section on the detail page is replaced by a "Stages & Steps" section that renders System A's stages and steps
- Each step has the 8 instruction fields from Phase 5 (objective, decision matrix, email/SMS templates, etc.) — stored on `process_steps`
- Old `mb_*` board UI removed; old System A process detail page removed
- Phase 3 seed renewal items deleted; Phase 5 subitem template concept deleted

**Migration in this phase:**
- The Lease Renewal template in System A is enriched with the 8 instruction-section data we'd designed for Phase 5 (objective text per step, email/SMS templates, decision matrices, etc.). If the System A template doesn't already have these, we add them.
- `mb_updates`, `mb_update_mentions`, `mb_update_reactions`, `mb_update_attachments` tables get a new `process_id` column (nullable for now); existing rows with `item_id` are either migrated (if any production data exists) or dropped.
- Schema migration drops most `mb_*` tables. The migration is destructive but safe because nobody is using the data.

**Out of scope for Phase 7:**
- Board customization (Phase 7.1)
- Dashboards (Phase 7.2)
- Conditional routing, cross-process spawning, autopilot, send tracking (Phase 7.3 and beyond)
- LeadSimple import (Phase 7.4)

**Definition of done:**
- Lori can navigate to `/operations/boards/renewals`, see a list of all Lease Renewal processes (initially zero, since none have been started), click "Launch Process" to start a new one, and the new process appears on the board.
- Clicking a process opens the detail page showing stages, steps, and Updates feed.
- System A's old process pages are gone or redirect.

### Phase 7.1: Board customization

After Phase 7, the boards work but you can't change what columns they show, what's grouped, etc. Phase 7.1 brings back the Phase 3.5 customization, but rewired to edit System A templates.

**Includes:**
- The Phase 3.5 "Manage boards" page → renamed "Manage process templates"
- Admin can: create a new template (= new board), rename, archive, restore, configure column display, manage status options (= stage configurations), reorder stages
- Each template's columns map to: process built-in fields (name, assignee, due date, stage) + custom fields defined on the template
- The Phase 3.5 status-options-with-color UI applies to stages (matches LeadSimple's color-per-stage in image 4)
- Lock down system templates (Lease Renewal, etc., that came from System A) from being deleted, but allow renaming/editing

**Out of scope:** Anything beyond what Phase 3.5 already did.

### Phase 7.2: Dashboards — triage and calendar over processes

The Phase 6 dashboards still exist but need rewiring to read from processes instead of items.

**Includes:**
- Rewrite Triage dashboard to query `processes` and compute the triage score from process state (overdue, unassigned, mentions, etc.)
- Rewrite Calendar dashboard to plot processes on their due date or primary date
- Drop auto-aggregation entirely (not needed; processes report real state)
- Per-template variants at `/operations/boards/[slug]/triage` and `/calendar`

**Out of scope:** Workload, Map (still deferred). New dashboard types.

### Phase 7.3: Workflow engine completion — conditional routing, cross-process, autopilot enhancements

System A's workflow engine has many but not all of LeadSimple's capabilities. This phase fills the gaps.

**Includes:**
- **Conditional routing** between stages: a step's completion + a custom field value determines which stage comes next (e.g., recommendation = Increase → Send Increase Offer stage)
- **Create Process step type** (cross-process spawning): a step in one process can start another process (Lease Renewal completion → Move-Out process if not renewing)
- **Stage Change as an explicit step type:** currently steps live in stages; add explicit "advance to stage X" step actions
- **Meet step type** (calendar event creation)
- **Time-based autopilot improvements:** more flexible recurrence and trigger conditions

**Verification:** Manually configure the Lease Renewal template to route conditionally based on the "Recommendation" custom field. Spawn a Move-Out process when a renewal completes with status = Not Renewing.

**Out of scope:** LeadSimple import (next phase). UI for visualizing the routing graph.

### Phase 7.4: LeadSimple import

Now that the engine is complete, import your existing process definitions from LeadSimple. This is the phase that saves you weeks of manual data entry.

**Includes:**
- A real LeadSimple API client (replacing the `triggerLeadSimpleOffboardingPlaceholder` stub)
- An importer that pulls process types, stages, steps, custom fields, contact roles, assignee roles
- Manual mapping UI: after import, admin reviews each imported template and maps LeadSimple step kinds to Prestige Dash step types, sets up routing rules and templates that don't import automatically (email templates, conditional logic)
- Email templates and SMS templates need to be re-keyed manually since LeadSimple doesn't expose template bodies via API — but the importer creates placeholder templates with names/usage pointers
- Ongoing sync (one-way: LeadSimple → Prestige Dash) for active process instances during the migration period

**Verification:** All 8+ of your LeadSimple process types appear in Prestige Dash with their stages and step structure. Active processes show up on their boards.

**Out of scope:** Two-way sync (Prestige Dash → LeadSimple). LeadSimple deprecation.

### Phase 7.5: Email/SMS send infrastructure

Step types of Email and SMS need to actually send things. Right now they're configured but inert.

**Includes:**
- Wire the Email step type to Microsoft Graph (your existing email integration)
- Wire the SMS step type to OpenPhone (your existing SMS integration)
- Template engine with variable substitution from process / contact / property / unit scopes
- Send tracking: opens, clicks, replies — stored per send
- Send log accessible on each process

**Verification:** A Send Offer step on a Lease Renewal process actually sends the renewal offer email to the tenant via Microsoft Graph. Tracking shows when it was opened.

**Out of scope:** Two-way reply parsing into the Updates feed (might come later).

### Phase 8: LeadSimple cutover

When the engine is complete and your team has been using one or two process types in Prestige Dash for a few weeks, cut over from LeadSimple.

**Includes:**
- Feature flag per process type: this process type is in Prestige Dash, that one is still in LeadSimple
- Side-by-side run for 1–2 weeks per process type as it migrates
- Process-by-process cutover (Lease Renewal first, then Maintenance Escalation, etc.)
- LeadSimple deactivation when the last process type migrates

**Out of scope:** Anything during the migration that goes wrong — those become hotfixes.

## Risks and how to handle them

**Risk 1: The reskinned process detail page is harder than it sounds.**
System A's existing detail page (image 6) is built differently than System B's Phase 4 page. Welding them together cleanly is real work, especially the stages-and-steps section. If Phase 7 starts running long, consider splitting: Phase 7 just makes boards read from processes; Phase 7.0a does the detail page refactor.

**Risk 2: Tables we plan to rip still have references.**
Other parts of Prestige Dash might be reading from `mb_items` or `mb_subitems`. Before the destructive migration in Phase 7, search the codebase exhaustively. Document references in `PHASE7_DEFERRED.md` if any are found.

**Risk 3: System A's process detail page has features we don't know about.**
Image 6 shows a few things: process details sidebar, activity/communications tabs, pause/mark complete actions. Verify these all carry over to the new layout. The "Communications" tab might overlap with the Updates feed in unexpected ways.

**Risk 4: System A's existing templates have fields that don't map cleanly.**
The 8 instruction sections we designed in Phase 5 (objective, decision matrix, email templates, etc.) may not all have equivalents on System A's `process_steps`. Phase 7 needs schema additions to support them, or we drop ones that don't fit.

**Risk 5: Naming collision in URLs during the redirect.**
`/operations/processes/*` redirects to `/operations/boards/*`. If users have bookmarks, they continue to work. But if any internal code links use the old URLs, those break. Audit and update.

## Integration points to verify

When the unified system is running, these must work:

- The Renewals board lists all active Lease Renewal processes
- "Launch Process" from the board header creates a new process via System A's existing logic
- Clicking a process opens the detail page; stages and steps display from System A; Updates feed displays from System B
- Comment + mention in Updates feed sends a notification (visual badge, no email)
- The Phase 6 Triage dashboard shows overdue processes
- The Phase 6 Calendar dashboard shows processes plotted on their dates
- Board customization (Phase 7.1) creates a new template in System A
- Property context and tenant context panels (from Phase 4) still work
- AppFolio sync still populates the data that powers context panels
- LeadSimple cached deal/task data continues to be read for the property-context route (unrelated to processes)

## Files this plan replaces

The following older planning documents are now superseded by this one:
- The various "Phase X" prompts referenced earlier in conversation (Phases 7, 7.1–7.6 as I'd outlined under the Path 2 framing)
- Any partial planning notes about Path 2 as a "build a workflow engine from scratch"

Going forward, every Claude Code prompt should reference this document and use its decisions as authoritative.

## Open questions to revisit later

These don't block Phase 7 but should be resolved during Phase 7.3 or 7.4:

1. **What happens to System A's `Projects`, `Tasks`, and `My Tasks` tabs?** Image 3 shows these in the Operations Hub navigation. They're related to but separate from processes. Do they stay, get unified, or get retired?
2. **What about LeadSimple's deals/pipelines vs. processes?** The API doc shows both. We've talked about processes only. Are deals/pipelines used too?
3. **AI Insights tab (image 3) — what is it and does it survive unification?**
4. **The cached_leadsimple_deals and cached_leadsimple_tasks tables — when are they updated, by what, and do they continue to serve their purpose post-migration?**

These are flagged. They are not pre-Phase-7 blockers.
