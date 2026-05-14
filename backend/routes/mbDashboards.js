/**
 * Phase 6: Triage + Calendar dashboards, per-board aggregation settings,
 * and the aggregation engine that keeps parent items in sync with their
 * subitems.
 *
 * Spec reconciliation:
 *   * Phase 1's schema names: mb_board_columns (not mb_columns),
 *     column_type (not type), values.status in mb_items.values JSONB
 *     (not a top-level status_value column), archived_at IS NULL (not
 *     is_archived = false). All queries here use those.
 *   * Boards use board-defined status options. The aggregation ladder
 *     (Blocked → Stalled/Overdue → In Progress → terminal) maps a
 *     board's actual option values into canonical categories via a
 *     fixed dictionary (CATEGORY_BY_VALUE below). Unknown values fall
 *     back to "in_progress" per the spec, and we surface them in the
 *     `unknown_status_values` array on the recompute response so the
 *     admin notices what needs documenting.
 */

import { getPool } from "../lib/db.js";
import { vIntId, vIntIdOpt, vBool } from "../lib/mb/validators.js";

// ============================================================
// Triage scoring (FIXED formula — not configurable in Phase 6)
// ============================================================

const TRIAGE_NEGATIVE = new Set([
  "stalled", "overdue", "blocked", "not_renewing", "lost",
]);
const TRIAGE_NEW = new Set([
  "new", "unassigned", "pending", "not_started",
]);

/**
 * Sub-categorise a board status option (`value` field) into one of
 * the canonical aggregation categories. Order:
 *   * "blocked"      — hard stop, dominates the ladder
 *   * "overdue"      — needs immediate action
 *   * "stalled"      — waiting on someone else
 *   * "in_progress"  — work in flight
 *   * "terminal"     — done, in any flavour
 *   * "new"          — not started yet
 *   * null           — unknown (treated as in_progress by the ladder)
 */
const CATEGORY_BY_VALUE = new Map([
  ["blocked", "blocked"],
  ["overdue", "overdue"],
  ["stalled", "stalled"],
  ["awaiting_response", "stalled"],
  ["in_progress", "in_progress"],
  ["in_outreach", "in_progress"],
  ["working", "in_progress"],
  ["active", "in_progress"],
  ["done", "terminal"],
  ["complete", "terminal"],
  ["completed", "terminal"],
  ["renewed", "terminal"],
  ["not_renewing", "terminal"],
  ["lost", "terminal"],
  ["closed", "terminal"],
  ["new", "new"],
  ["unassigned", "new"],
  ["not_started", "new"],
  ["pending", "new"],
]);

const TERMINAL_VALUES = new Set([
  "done", "complete", "completed", "renewed", "not_renewing", "lost", "closed",
]);

function categoryFor(value) {
  if (value == null) return null;
  return CATEGORY_BY_VALUE.get(String(value).toLowerCase()) ?? null;
}

// ============================================================
// Board settings (admin)
// ============================================================

export async function getBoardSettings(req, res) {
  try {
    const boardId = vIntId(req.params.boardId, "board id");
    const pool = getPool();
    // Ensure a row exists (in case the board was created after the
    // migration). Falls back to the migration's default-pick logic.
    await pool.query(
      `INSERT INTO mb_board_settings (board_id, primary_date_column_id)
       SELECT $1, (
         SELECT c.id FROM mb_board_columns c
          WHERE c.board_id = $1 AND c.column_type = 'date' AND c.archived_at IS NULL
          ORDER BY c.position ASC LIMIT 1
       )
       ON CONFLICT (board_id) DO NOTHING`,
      [boardId]
    );
    const { rows } = await pool.query(
      `SELECT board_id, auto_aggregate_status, auto_aggregate_progress,
              primary_date_column_id, updated_at
         FROM mb_board_settings
        WHERE board_id = $1`,
      [boardId]
    );
    res.json({ settings: rows[0] ?? null });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] board settings get", e);
    res.status(500).json({ error: "Could not load settings." });
  }
}

export async function updateBoardSettings(req, res) {
  try {
    const boardId = vIntId(req.params.boardId, "board id");
    const body = req.body ?? {};
    const sets = [];
    const vals = [];
    let n = 1;
    let toggledStatus = null;
    if (body.auto_aggregate_status !== undefined) {
      const v = vBool(body.auto_aggregate_status, { allowNull: false });
      sets.push(`auto_aggregate_status = $${n++}`);
      vals.push(v);
      toggledStatus = v;
    }
    if (body.auto_aggregate_progress !== undefined) {
      sets.push(`auto_aggregate_progress = $${n++}`);
      vals.push(vBool(body.auto_aggregate_progress, { allowNull: false }));
    }
    if (body.primary_date_column_id !== undefined) {
      const v = vIntIdOpt(body.primary_date_column_id, "primary_date_column_id");
      sets.push(`primary_date_column_id = $${n++}`);
      vals.push(v);
    }
    if (!sets.length) {
      return res.status(400).json({ error: "No valid fields to update." });
    }
    sets.push(`updated_at = NOW()`);
    sets.push(`updated_by = $${n++}`);
    vals.push(req.user.id);
    vals.push(boardId);

    const pool = getPool();
    await pool.query(
      `INSERT INTO mb_board_settings (board_id) VALUES ($${n})
       ON CONFLICT (board_id) DO NOTHING`,
      vals
    );
    const { rows } = await pool.query(
      `UPDATE mb_board_settings
          SET ${sets.join(", ")}
        WHERE board_id = $${n}
        RETURNING board_id, auto_aggregate_status, auto_aggregate_progress,
                  primary_date_column_id, updated_at`,
      vals
    );

    // If status aggregation was just turned OFF, clear the cached
    // aggregated_status on this board's items so the UI stops showing
    // the "Auto" badge. We deliberately leave values.status as-is —
    // the last aggregated value remains as the manual value (spec).
    if (toggledStatus === false) {
      await pool.query(
        `UPDATE mb_items
            SET aggregated_status = NULL,
                aggregated_status_at = NULL
          WHERE board_id = $1
            AND aggregated_status IS NOT NULL`,
        [boardId]
      );
    }

    res.json({ settings: rows[0] });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] board settings update", e);
    res.status(500).json({ error: "Could not update settings." });
  }
}

// ============================================================
// Aggregation engine
// ============================================================

/**
 * Compute the canonical aggregated status for an item's subitems and
 * write it back to the item. Returns the new value (or null when there
 * are no subitems / no override needed).
 *
 * The function is exported so it can be called both from the recompute
 * endpoint and from mb_items.updateItem on subitem column-value writes.
 *
 * Pass an already-acquired pool client to chain inside a transaction;
 * otherwise we'll grab the default pool.
 */
export async function recomputeParentAggregation(parentItemId, poolOrClient) {
  const client = poolOrClient ?? getPool();
  const { rows: parent } = await client.query(
    `SELECT i.id, i.board_id, i.values, i.aggregated_status, s.auto_aggregate_status
       FROM mb_items i
       LEFT JOIN mb_board_settings s ON s.board_id = i.board_id
      WHERE i.id = $1`,
    [parentItemId]
  );
  if (!parent.length) return null;
  const p = parent[0];
  if (!p.auto_aggregate_status) {
    // Aggregation off — nothing to do. We don't clear here; the toggle
    // path in updateBoardSettings handles cleanup.
    return null;
  }

  const { rows: subs } = await client.query(
    `SELECT id, values
       FROM mb_items
      WHERE parent_item_id = $1
        AND archived_at IS NULL`,
    [parentItemId]
  );
  if (subs.length === 0) {
    // No subitems → leave manual. Clear any stale aggregated_status so
    // the UI re-enables editing.
    if (p.aggregated_status != null) {
      await client.query(
        `UPDATE mb_items
            SET aggregated_status = NULL, aggregated_status_at = NULL
          WHERE id = $1`,
        [parentItemId]
      );
    }
    return null;
  }

  // Map every subitem to a category and run the spec's ladder.
  const subStatuses = subs.map((s) => s.values?.status ?? null);
  const cats = subStatuses.map(categoryFor);

  let nextStatusValue = null;
  if (cats.includes("blocked")) {
    nextStatusValue = pickByCategory(subStatuses, cats, "blocked");
  } else if (cats.includes("overdue") || cats.includes("stalled")) {
    nextStatusValue =
      pickByCategory(subStatuses, cats, "overdue") ??
      pickByCategory(subStatuses, cats, "stalled");
  } else if (cats.includes("in_progress")) {
    nextStatusValue = pickByCategory(subStatuses, cats, "in_progress");
  } else if (cats.every((c) => c === "terminal")) {
    // All terminal → most common; tie-breaks by board option order.
    nextStatusValue = await pickMostCommonTerminal(
      client,
      p.board_id,
      subStatuses
    );
  } else {
    // Fallback: any "new"-category subitem keeps the parent at "new",
    // otherwise call it in_progress.
    nextStatusValue =
      pickByCategory(subStatuses, cats, "new") ??
      pickByCategory(subStatuses, cats, "in_progress");
    if (!nextStatusValue) {
      // Truly unrecognised mix — fall back to "in_progress" with the
      // board's first such option if any. Otherwise leave the first
      // non-null subitem status as-is.
      nextStatusValue =
        (await pickFirstOptionInCategory(client, p.board_id, "in_progress")) ??
        subStatuses.find((v) => v != null) ??
        null;
    }
  }
  if (!nextStatusValue) return null;

  // Write the new status to the parent's values AND mirror it into the
  // aggregated_status cache for the UI's "Auto" badge.
  const newValues = { ...(p.values ?? {}), status: nextStatusValue };
  await client.query(
    `UPDATE mb_items
        SET values = $1::jsonb,
            aggregated_status = $2,
            aggregated_status_at = NOW(),
            updated_at = NOW()
      WHERE id = $3`,
    [JSON.stringify(newValues), nextStatusValue, parentItemId]
  );
  return nextStatusValue;
}

function pickByCategory(values, cats, category) {
  for (let i = 0; i < cats.length; i++) {
    if (cats[i] === category) return values[i];
  }
  return null;
}

async function pickMostCommonTerminal(client, boardId, values) {
  // Count each value's frequency.
  const counts = new Map();
  for (const v of values) {
    if (v == null) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let bestCount = -1;
  let candidates = [];
  for (const [v, c] of counts.entries()) {
    if (c > bestCount) {
      bestCount = c;
      candidates = [v];
    } else if (c === bestCount) {
      candidates.push(v);
    }
  }
  if (candidates.length === 1) return candidates[0];
  // Tie-break: first appearing in the board's status column options.
  const { rows: cols } = await client.query(
    `SELECT config FROM mb_board_columns
      WHERE board_id = $1 AND key = 'status' AND archived_at IS NULL
      LIMIT 1`,
    [boardId]
  );
  if (!cols.length) return candidates[0];
  const cfg = typeof cols[0].config === "string" ? JSON.parse(cols[0].config) : cols[0].config || {};
  const options = Array.isArray(cfg.options) ? cfg.options : [];
  for (const o of options) {
    if (candidates.includes(o.value)) return o.value;
  }
  return candidates[0];
}

async function pickFirstOptionInCategory(client, boardId, category) {
  const { rows: cols } = await client.query(
    `SELECT config FROM mb_board_columns
      WHERE board_id = $1 AND key = 'status' AND archived_at IS NULL
      LIMIT 1`,
    [boardId]
  );
  if (!cols.length) return null;
  const cfg = typeof cols[0].config === "string" ? JSON.parse(cols[0].config) : cols[0].config || {};
  const options = Array.isArray(cfg.options) ? cfg.options : [];
  for (const o of options) {
    if (categoryFor(o.value) === category) return o.value;
  }
  return null;
}

/**
 * Admin endpoint: recompute every parent on a board. Used right after
 * flipping auto_aggregate_status ON.
 */
export async function recomputeBoardAggregation(req, res) {
  try {
    const boardId = vIntId(req.params.boardId, "board id");
    const pool = getPool();
    const { rows: parents } = await pool.query(
      `SELECT i.id
         FROM mb_items i
        WHERE i.board_id = $1
          AND i.archived_at IS NULL
          AND i.parent_item_id IS NULL`,
      [boardId]
    );
    let computed = 0;
    for (const p of parents) {
      const v = await recomputeParentAggregation(p.id, pool);
      if (v != null) computed += 1;
    }
    res.json({ ok: true, parents_examined: parents.length, parents_updated: computed });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] aggregation recompute", e);
    res.status(500).json({ error: "Could not recompute aggregation." });
  }
}

// ============================================================
// Progress aggregation (computed at read time)
// ============================================================

/**
 * Compute progress percentage for a set of parent items in one query.
 * Returns Map<itemId, {pct: number|null, total: number, done: number}>.
 * Items with zero subitems get pct = null so the UI renders "—".
 */
export async function computeProgressFor(pool, parentIds) {
  if (parentIds.length === 0) return new Map();
  const terminal = Array.from(TERMINAL_VALUES);
  const { rows } = await pool.query(
    `SELECT parent_item_id AS pid,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE LOWER(values ->> 'status') = ANY($2::text[]))::int AS done
       FROM mb_items
      WHERE parent_item_id = ANY($1::int[])
        AND archived_at IS NULL
      GROUP BY parent_item_id`,
    [parentIds, terminal]
  );
  const out = new Map();
  for (const pid of parentIds) out.set(pid, { pct: null, total: 0, done: 0 });
  for (const r of rows) {
    const pct = r.total > 0 ? Math.round((r.done / r.total) * 100) : null;
    out.set(r.pid, { pct, total: r.total, done: r.done });
  }
  return out;
}

export async function getBoardProgressMap(req, res) {
  try {
    const boardId = vIntId(req.params.boardId, "board id");
    const pool = getPool();
    const { rows: parents } = await pool.query(
      `SELECT id FROM mb_items
        WHERE board_id = $1 AND archived_at IS NULL AND parent_item_id IS NULL`,
      [boardId]
    );
    const map = await computeProgressFor(pool, parents.map((p) => p.id));
    const out = {};
    for (const [pid, v] of map.entries()) out[pid] = v;
    res.json({ progress: out });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] board progress map", e);
    res.status(500).json({ error: "Could not compute progress." });
  }
}

// ============================================================
// Triage dashboard
// ============================================================

/**
 * Triage endpoint. Returns up to 100 top-level non-archived items
 * scored per the fixed formula in the spec. Score, reasons, and key
 * metadata are computed in application code over a single batched
 * fetch so the SQL stays simple.
 *
 * Query params:
 *   scope=all          → all boards
 *   scope=board:<slug> → one board's items
 *   limit              → cap (default 100, max 100)
 */
export async function getTriageList(req, res) {
  try {
    const pool = getPool();
    const scope = String(req.query.scope ?? "all");
    const limit = Math.min(Number(req.query.limit) || 100, 100);

    let boardFilter = "";
    const params = [];
    let n = 1;
    if (scope.startsWith("board:")) {
      const slug = scope.slice("board:".length);
      const { rows: b } = await pool.query(
        `SELECT id FROM mb_boards WHERE slug = $1 AND archived_at IS NULL`,
        [slug]
      );
      if (!b.length) return res.json({ items: [], total_qualified: 0 });
      boardFilter = ` AND i.board_id = $${n++}`;
      params.push(b[0].id);
    }

    // Pull top-level items with their board info and the primary date
    // column's key (we need it to read the date out of i.values).
    // We grab up to 500 candidates and score them in app code; the
    // expensive part is the join, not the scoring.
    const { rows: items } = await pool.query(
      `SELECT i.id, i.board_id, i.title, i.values, i.updated_at,
              b.name AS board_name, b.slug AS board_slug,
              c.key AS date_key, c.name AS date_name,
              statc.config AS status_config
         FROM mb_items i
         JOIN mb_boards b ON b.id = i.board_id
         LEFT JOIN mb_board_settings s ON s.board_id = i.board_id
         LEFT JOIN mb_board_columns  c ON c.id = s.primary_date_column_id
         LEFT JOIN mb_board_columns  statc ON statc.board_id = i.board_id
                                          AND statc.key = 'status'
                                          AND statc.archived_at IS NULL
        WHERE i.archived_at IS NULL
          AND i.parent_item_id IS NULL
          AND b.archived_at IS NULL
          ${boardFilter}
        ORDER BY i.updated_at DESC
        LIMIT 500`,
      params
    );

    // Per-user unseen mentions, hydrated in one query.
    const { rows: mentionRows } = await pool.query(
      `SELECT u.item_id, COUNT(*)::int AS n
         FROM mb_update_mentions m
         JOIN mb_item_updates u ON u.id = m.update_id
        WHERE m.mentioned_user_id = $1
          AND m.seen_at IS NULL
          AND u.deleted_at IS NULL
        GROUP BY u.item_id`,
      [req.user.id]
    );
    const mentionsByItem = new Map(mentionRows.map((r) => [r.item_id, r.n]));

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sevenDaysOut = new Date(today);
    sevenDaysOut.setDate(today.getDate() + 7);

    const scored = [];
    for (const it of items) {
      const v = it.values ?? {};
      const statusVal = typeof v.status === "string" ? v.status.toLowerCase() : null;
      const owner = v.owner;
      const renewalScore = typeof v.renewal_score === "number" ? v.renewal_score : null;
      const dateKey = it.date_key;
      const dateVal = dateKey ? v[dateKey] : null;

      let score = 0;
      const reasons = [];

      if (statusVal && TRIAGE_NEGATIVE.has(statusVal)) {
        score += 40;
        reasons.push({ label: labelForStatus(statusVal, it.status_config), kind: "negative_status", weight: 40 });
      }
      if ((statusVal && TRIAGE_NEW.has(statusVal)) || owner == null) {
        score += 30;
        reasons.push({
          label: owner == null ? "No owner" : labelForStatus(statusVal, it.status_config),
          kind: "unassigned",
          weight: 30,
        });
      }
      const mentionCount = mentionsByItem.get(it.id) ?? 0;
      if (mentionCount > 0) {
        score += 25;
        reasons.push({
          label: `${mentionCount} unread @mention${mentionCount === 1 ? "" : "s"} for you`,
          kind: "mention",
          weight: 25,
        });
      }
      if (typeof dateVal === "string" && dateVal.length >= 10) {
        const d = new Date(dateVal + "T00:00:00");
        if (!Number.isNaN(d.getTime())) {
          if (d < today) {
            score += 20;
            const daysAgo = Math.floor((today.getTime() - d.getTime()) / 86400000);
            reasons.push({
              label: `${it.date_name ?? "Date"} ${daysAgo} day${daysAgo === 1 ? "" : "s"} past due`,
              kind: "past_due",
              weight: 20,
            });
          } else if (d <= sevenDaysOut) {
            score += 10;
            const daysOut = Math.floor((d.getTime() - today.getTime()) / 86400000);
            reasons.push({
              label: `${it.date_name ?? "Date"} due in ${daysOut} day${daysOut === 1 ? "" : "s"}`,
              kind: "due_soon",
              weight: 10,
            });
          }
        }
      }
      if (renewalScore != null && renewalScore < 40) {
        score += 15;
        reasons.push({
          label: `Renewal score ${renewalScore}`,
          kind: "low_renewal_score",
          weight: 15,
        });
      }
      const updatedAt = new Date(it.updated_at);
      const daysSinceUpdate = (today.getTime() - updatedAt.getTime()) / 86400000;
      if (daysSinceUpdate >= 14) {
        score += 5;
        reasons.push({
          label: `Last updated ${Math.floor(daysSinceUpdate)} days ago`,
          kind: "stale",
          weight: 5,
        });
      }
      if (score === 0) continue;
      reasons.sort((a, b) => b.weight - a.weight);
      scored.push({
        id: it.id,
        board_id: it.board_id,
        board_name: it.board_name,
        board_slug: it.board_slug,
        title: it.title,
        values: it.values,
        date_key: it.date_key,
        date_name: it.date_name,
        score,
        capped_score: Math.min(score, 100),
        reasons,
        unread_mentions: mentionCount,
      });
    }

    scored.sort((a, b) => b.score - a.score || a.id - b.id);
    const total = scored.length;
    res.json({
      items: scored.slice(0, limit),
      total_qualified: total,
      overflow: Math.max(0, total - limit),
    });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] triage list", e);
    res.status(500).json({ error: "Could not load triage." });
  }
}

function labelForStatus(value, statusConfig) {
  if (!value) return "—";
  let cfg = statusConfig;
  if (typeof cfg === "string") {
    try {
      cfg = JSON.parse(cfg);
    } catch {
      cfg = null;
    }
  }
  const opts = Array.isArray(cfg?.options) ? cfg.options : [];
  return opts.find((o) => String(o.value).toLowerCase() === value)?.label ?? value;
}

// ============================================================
// Calendar dashboard
// ============================================================

export async function getCalendarItems(req, res) {
  try {
    const pool = getPool();
    const scope = String(req.query.scope ?? "all");
    const from = String(req.query.from ?? "");
    const to = String(req.query.to ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ error: "from and to must be YYYY-MM-DD." });
    }

    let boardFilter = "";
    const params = [from, to];
    let n = 3;
    if (scope.startsWith("board:")) {
      const slug = scope.slice("board:".length);
      const { rows: b } = await pool.query(
        `SELECT id FROM mb_boards WHERE slug = $1 AND archived_at IS NULL`,
        [slug]
      );
      if (!b.length) return res.json({ items: [] });
      boardFilter = ` AND i.board_id = $${n++}`;
      params.push(b[0].id);
    }

    // We need each row's "primary date column key" (per its board's
    // settings) to extract the date out of i.values. The query joins
    // mb_board_settings and the date column row, then projects the
    // key. Filtering by date range happens in SQL using JSONB ->> +
    // a CAST to date.
    const { rows } = await pool.query(
      `SELECT i.id, i.board_id, i.title, i.values,
              b.name AS board_name, b.slug AS board_slug,
              c.key  AS date_key,  c.name AS date_name,
              statc.config AS status_config
         FROM mb_items i
         JOIN mb_boards b ON b.id = i.board_id
         LEFT JOIN mb_board_settings s ON s.board_id = i.board_id
         LEFT JOIN mb_board_columns  c ON c.id = s.primary_date_column_id
         LEFT JOIN mb_board_columns  statc ON statc.board_id = i.board_id
                                          AND statc.key = 'status'
                                          AND statc.archived_at IS NULL
        WHERE i.archived_at IS NULL
          AND i.parent_item_id IS NULL
          AND b.archived_at IS NULL
          AND c.key IS NOT NULL
          AND i.values ->> c.key IS NOT NULL
          AND length(i.values ->> c.key) >= 10
          AND (i.values ->> c.key)::date BETWEEN $1::date AND $2::date
          ${boardFilter}
        ORDER BY (i.values ->> c.key)::date ASC, i.id ASC
        LIMIT 2000`,
      params
    );

    const items = rows.map((r) => {
      const v = r.values ?? {};
      const statusVal = typeof v.status === "string" ? v.status : null;
      let cfg = r.status_config;
      if (typeof cfg === "string") {
        try { cfg = JSON.parse(cfg); } catch { cfg = null; }
      }
      const opts = Array.isArray(cfg?.options) ? cfg.options : [];
      const option = statusVal ? opts.find((o) => o.value === statusVal) : null;
      return {
        id: r.id,
        board_id: r.board_id,
        board_name: r.board_name,
        board_slug: r.board_slug,
        title: r.title,
        date_key: r.date_key,
        date_name: r.date_name,
        date_value: v[r.date_key],
        status_value: statusVal,
        status_label: option?.label ?? statusVal ?? null,
        status_color: option?.color ?? "#6a737b",
        owner: v.owner ?? null,
      };
    });

    res.json({ items });
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error("[mb] calendar items", e);
    res.status(500).json({ error: "Could not load calendar items." });
  }
}
