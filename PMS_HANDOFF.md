# PMS Build — Session Handoff

Read this first if you're picking up the Process Management System (PMS)
build in a fresh session. It captures status, architecture, hard-won
pitfalls, and the concrete next steps.

## 1. Status: the design is fully delivered

Every screen/tab from the Claude Design handoff is built and **merged to
`main`**. There is no pending PMS PR.

| PR | What |
|----|------|
| #51 | Phase 7 — boards-over-processes unification (System A is the engine) |
| #52 | 7.0.1 — PMS brand tokens + Process Library + per-process tab strip |
| #53 | 7.1 — Stages & Workflows editor + Email/Text Templates tabs + migration 036 |
| #54 | 7.2 — Process Instance redesign (stepper + tabs + right rail) |
| #55 | 7.3 — Custom Fields tab |
| #56 | hotfix — self-heal `process_templates.slug` in operationsSchema |
| #57 | 7.1.1 — Stages & Workflows editor depth |
| #58 | 7.4 — Autopilot Rules tab |
| #59 | 7.5 — Settings tab (closed the last stub) |

Stale `feat/*`/`fix/*` remote branches showing "N commits ahead" are
squash-merge artifacts (squash creates new SHAs), **not** unmerged work.
Don't try to merge or rebase them.

## 2. The design source (re-extract — /tmp is ephemeral)

Original bundle: `~/Downloads/Process Management System-handoff.zip`
(persists). `/tmp/pms-handoff/` from prior sessions is gone — re-unzip.

```
unzip -o "$HOME/Downloads/Process Management System-handoff.zip" -d /tmp/pms-handoff
```

Per the bundle README: read `project/index.html` fully, then follow its
script imports. Key files: `data.jsx` (mock shapes), `shell.jsx`
(sidebar/topbar/router), `board.jsx`, `builder.jsx` (Stages &
Workflows — the centerpiece), `instance.jsx`, `screens.jsx`
(Library/Autopilot/Email/Text/CustomFields), `app.jsx` (tab shell).
These are HTML/CSS/JS prototypes — match the visual output, don't copy
structure.

## 3. Architecture map

**URL / routing.** Everything hangs off the tabbed shell at
`frontend/app/(protected)/operations/boards/[slug]/page.tsx`. It is the
router: reads `?tab=` and renders one client per tab. Tabs:

| tab | component | backend |
|-----|-----------|---------|
| board | `BoardClient.tsx` | `/processes?template=` |
| stages | `StagesWorkflowsClient.tsx` | `/processes/templates/:id/stages`,`/steps`, migration 036 fields |
| autopilot | `AutopilotClient.tsx` | autopilot routes |
| email | `MessageTemplatesClient.tsx` mode=email | `process_email_templates` |
| text | `MessageTemplatesClient.tsx` mode=text | `process_text_templates` |
| fields | `CustomFieldsClient.tsx` | `/custom-fields/definitions` (entity_type=process_template) |
| settings | `SettingsClient.tsx` | `PUT /processes/templates/:id`, `/templates/:id/roles` |

- Library: `frontend/app/(protected)/operations/processes/` →
  `ProcessLibraryClient.tsx`, data from `GET /processes/dashboard`.
- Instance detail: `…/boards/[slug]/items/[itemId]/ProcessDetailClient.tsx`
  (stepper + Tasks/Activity/Files/Notes tabs + right rail). Notes tab =
  the preserved Phase 4 updates feed (process-keyed).
- Legacy `/operations/processes/[id]` → `ProcessRedirectClient` →
  unified URL.

**Styling.** PMS screens opt in with `data-pms` on a parent; tokens are
`--pms-*` in `frontend/app/globals.css` (stage palette, status pairs,
shadows). Fonts: Barlow (`--font-pms-body`), Barlow Condensed
(`--font-display`), JetBrains Mono (`--font-pms-mono`) via `next/font`
in `layout.tsx`. Use class `pms-cond` / `pms-mono` for display/mono.

**Data model (System A).** `process_templates` (has `slug`,
`is_active`, aging/assignment cols) → `process_template_stages`
(`category` = Backlog/Active/Completed/Canceled) → `process_template_steps`
(migration 036: `kind`,`actor`,`when_text`,`day_offset`,
`branch_config`,`email_template_id`,`text_template_id`, + 8 instruction
JSON cols). Instances: `processes` → `process_stages` → `process_steps`
(instruction cols copied at launch). Plus `custom_field_definitions/values`,
`process_email_templates`, `process_text_templates`, `process_type_roles`,
autopilot tables, `process_activity_log`, `mb_item_updates` (updates feed).

## 4. Pitfalls — read before you commit

1. **Squash-merge breaks stacked branches.** Each PR was squash-merged,
   which rewrites SHAs. Branch every new phase **off fresh `main`**, keep
   PRs independent (don't stack). If you ever must stack, expect to
   `git rebase --onto origin/main <old-base>` after each merge.
2. **Boot schema chain swallows errors.** `backend/index.js` (~line
   2355) runs each `ensure*Schema` in a try/catch and *continues* on
   failure. Phase 7's `ensureMbUnifiedSchema` is large/destructive — if
   it throws, the server still boots but its columns are missing. Any
   column critical to a hot path **must be self-healed in
   `ensureOperationsSchema`** (idempotent `ADD COLUMN IF NOT EXISTS` +
   backfill), not only in the Phase 7 applier. Precedent: PR #56
   (`slug`). If you add columns relied on by the Library/board, do the
   same.
3. **Migrations apply at boot via `ensure*Schema`**, mirrored from
   `backend/migrations/*.sql`. Keep both in sync and idempotent.
4. **`gh` is not authenticated** in the worktree. Push the branch and
   hand the user the `…/pull/new/<branch>` URL; don't try `gh pr`.
5. Deferred-work docs already in repo: `PHASE7_DEFERRED.md`,
   `PHASE7_1_DEFERRED.md`, `PHASE7_VERIFICATION.md`.

## 5. Next steps (recommended order)

The core product is complete; what's left is enhancement, best driven by
real usage. Suggested priority:

1. **Smoke-test in prod** (do this first). Exercise Library → Board →
   Stages editor → launch a process → Instance detail → complete a step.
   For Autopilot, **Test before enabling any rule**.
2. **7.4.1 — Autopilot execution engine.** The Autopilot *tab* exists
   (rules CRUD) but there is **no runtime** that evaluates rules on a
   schedule and auto-starts processes / fires auto-steps. This is the
   single biggest remaining capability. Needs a `node-cron` evaluator +
   an auto-step dispatcher (email/text send, stage-change). ~4–5 days.
   Confirm scope with the user before building — it's the heaviest item.
3. **7.2.1 — Instance write-paths.** Activity note-add + file upload
   from the instance page (currently read-only); Advance Stage / Pin /
   Clone / Share header actions (display-only today).
4. **7.1.2 — Stages editor depth round 2.** Branch/stage-change *target*
   editor, exit-rule editor, true HTML5 drag (up/down arrows work now).
5. **7.3.1 — Custom Fields depth.** select/multiselect option editor +
   per-field defaults; Property/Contact scopes (need property & contact
   records modeled first — currently AppFolio-sourced).
6. **7.6 — Library polish.** Wire the placeholder header buttons
   (New Process / Import / Clone from library) and the filter chips;
   real `automationHitRate` once the engine (step 2) exists.
7. **Email/Text templates.** Variable-resolved preview (To/From/body
   with `{{…}}` filled) + send-test.

If you only do one thing next: **step 2 (the Autopilot engine)** — it's
the only remaining piece with real product depth; everything else is
polish.
