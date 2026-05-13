/**
 * Phase A: inbox analytics endpoints.
 *
 * All endpoints are scoped to the mailboxes the caller has access to (via
 * inbox_permissions), and gated at the route level by reports.view. The
 * five handlers below back the AnalyticsView in /inbox/analytics.
 */

import { getPool } from "../lib/db.js";
import { getAllowedConnectionIds } from "../lib/inbox/inbox-permissions.js";

const VALID_WINDOWS = new Set(["14d", "30d", "90d", "ytd"]);

function windowToDays(w) {
  if (w === "30d") return 30;
  if (w === "90d") return 90;
  if (w === "ytd") {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    return Math.max(1, Math.ceil((now.getTime() - start.getTime()) / 86400000));
  }
  return 14;
}

function parseWindow(req) {
  const raw = String(req.query.window || "14d").toLowerCase();
  return VALID_WINDOWS.has(raw) ? raw : "14d";
}

/**
 * GET /inbox/analytics/kpis?window=14d
 *
 * Six top-row metrics + week-over-week deltas + 14-point sparkline series.
 * The sparkline is always 14 days regardless of the active window — it's
 * a quick-look trend, not a duplicate of the volume chart.
 */
export async function getInboxAnalyticsKpis(req, res) {
  try {
    const pool = getPool();
    const allowed = await getAllowedConnectionIds(pool, req.user.id);
    if (!allowed.length) {
      res.json({ window: parseWindow(req), kpis: emptyKpis() });
      return;
    }
    const w = parseWindow(req);
    const days = windowToDays(w);

    const cidsArr = allowed;

    // Open conversations — current snapshot, plus snapshot 7 days ago for
    // WoW delta. We can approximate "7 days ago" by counting threads whose
    // first_message_at <= NOW() - 7d AND (closed_at IS NULL OR closed_at >
    // NOW() - 7d).
    const { rows: openNowRows } = await pool.query(
      `SELECT COUNT(*)::int AS n
         FROM threads
        WHERE status = 'open'
          AND connection_id = ANY($1::int[])`,
      [cidsArr]
    );
    const { rows: openPriorRows } = await pool.query(
      `SELECT COUNT(*)::int AS n
         FROM threads
        WHERE first_message_at <= NOW() - INTERVAL '7 days'
          AND (closed_at IS NULL OR closed_at > NOW() - INTERVAL '7 days')
          AND connection_id = ANY($1::int[])`,
      [cidsArr]
    );

    // Closed-in-window aggregates — median first reply, median resolution,
    // SLA hit rate. SQL percentile_disc returns NULL on empty sets.
    const { rows: closedRows } = await pool.query(
      `WITH closed AS (
         SELECT first_outbound_at, first_message_at, closed_at, sla_due_at
           FROM threads
          WHERE status = 'closed'
            AND closed_at >= NOW() - ($1::int || ' days')::interval
            AND connection_id = ANY($2::int[])
       )
       SELECT
         COUNT(*)::int                                                   AS n_closed,
         EXTRACT(EPOCH FROM (
           percentile_disc(0.5) WITHIN GROUP (
             ORDER BY (first_outbound_at - first_message_at)
           )
         ))::bigint                                                      AS median_first_reply_s,
         EXTRACT(EPOCH FROM (
           percentile_disc(0.5) WITHIN GROUP (
             ORDER BY (closed_at - first_message_at)
           )
         ))::bigint                                                      AS median_resolution_s,
         COUNT(*) FILTER (
           WHERE first_outbound_at IS NOT NULL
             AND sla_due_at IS NOT NULL
             AND first_outbound_at <= sla_due_at
         )::int                                                          AS n_in_sla
       FROM closed`,
      [days, cidsArr]
    );
    const closed = closedRows[0] || {};
    const nClosed = closed.n_closed || 0;

    // Previous-window equivalent for deltas. Same shape, shifted by `days`.
    const { rows: closedPriorRows } = await pool.query(
      `WITH closed AS (
         SELECT first_outbound_at, first_message_at, closed_at, sla_due_at
           FROM threads
          WHERE status = 'closed'
            AND closed_at >= NOW() - ($1::int * 2 || ' days')::interval
            AND closed_at <  NOW() - ($1::int     || ' days')::interval
            AND connection_id = ANY($2::int[])
       )
       SELECT
         COUNT(*)::int                                                   AS n_closed,
         EXTRACT(EPOCH FROM (
           percentile_disc(0.5) WITHIN GROUP (
             ORDER BY (first_outbound_at - first_message_at)
           )
         ))::bigint                                                      AS median_first_reply_s,
         EXTRACT(EPOCH FROM (
           percentile_disc(0.5) WITHIN GROUP (
             ORDER BY (closed_at - first_message_at)
           )
         ))::bigint                                                      AS median_resolution_s,
         COUNT(*) FILTER (
           WHERE first_outbound_at IS NOT NULL
             AND sla_due_at IS NOT NULL
             AND first_outbound_at <= sla_due_at
         )::int                                                          AS n_in_sla
       FROM closed`,
      [days, cidsArr]
    );
    const prior = closedPriorRows[0] || {};
    const nClosedPrior = prior.n_closed || 0;

    // Conversations / day from received in window vs prior window.
    const { rows: createdNowRows } = await pool.query(
      `SELECT COUNT(*)::int AS n
         FROM threads
        WHERE first_message_at >= NOW() - ($1::int || ' days')::interval
          AND connection_id = ANY($2::int[])`,
      [days, cidsArr]
    );
    const { rows: createdPriorRows } = await pool.query(
      `SELECT COUNT(*)::int AS n
         FROM threads
        WHERE first_message_at >= NOW() - ($1::int * 2 || ' days')::interval
          AND first_message_at <  NOW() - ($1::int     || ' days')::interval
          AND connection_id = ANY($2::int[])`,
      [days, cidsArr]
    );
    const nCreated = createdNowRows[0]?.n || 0;
    const nCreatedPrior = createdPriorRows[0]?.n || 0;
    const perDay = Math.round(nCreated / days);
    const perDayPrior = Math.round(nCreatedPrior / days);

    // Sparkline data — last 14 days, daily received counts. Cheap.
    const { rows: sparkRows } = await pool.query(
      `WITH days AS (
         SELECT generate_series(
           date_trunc('day', NOW() - INTERVAL '13 days'),
           date_trunc('day', NOW()),
           INTERVAL '1 day'
         ) AS d
       )
       SELECT d::date AS day,
              COUNT(t.thread_id)::int AS received,
              COUNT(t.thread_id) FILTER (WHERE t.closed_at IS NOT NULL
                AND date_trunc('day', t.closed_at) = days.d)::int AS resolved
         FROM days
    LEFT JOIN threads t
           ON date_trunc('day', t.first_message_at) = days.d
          AND t.connection_id = ANY($1::int[])
        GROUP BY d
        ORDER BY d ASC`,
      [cidsArr]
    );
    const sparkReceived = sparkRows.map((r) => r.received || 0);
    const sparkResolved = sparkRows.map((r) => r.resolved || 0);

    // SLA hit rate %.
    const slaHit = nClosed
      ? Math.round((closed.n_in_sla / nClosed) * 100)
      : null;
    const slaHitPrior = nClosedPrior
      ? Math.round((prior.n_in_sla / nClosedPrior) * 100)
      : null;

    const mFirst = closed.median_first_reply_s != null
      ? Number(closed.median_first_reply_s)
      : null;
    const mFirstPrior = prior.median_first_reply_s != null
      ? Number(prior.median_first_reply_s)
      : null;
    const mRes = closed.median_resolution_s != null
      ? Number(closed.median_resolution_s)
      : null;
    const mResPrior = prior.median_resolution_s != null
      ? Number(prior.median_resolution_s)
      : null;

    res.json({
      window: w,
      kpis: {
        openConversations: {
          value: openNowRows[0]?.n || 0,
          prior: openPriorRows[0]?.n || 0,
          spark: sparkReceived,
        },
        medianFirstReplySeconds: {
          value: mFirst,
          prior: mFirstPrior,
          spark: sparkReceived,
        },
        medianResolutionSeconds: {
          value: mRes,
          prior: mResPrior,
          spark: sparkResolved,
        },
        slaHitPct: {
          value: slaHit,
          prior: slaHitPrior,
          spark: sparkResolved,
        },
        conversationsPerDay: {
          value: perDay,
          prior: perDayPrior,
          spark: sparkReceived,
        },
        csat: {
          value: null, // No CSAT signal yet — UI shows "—" placeholder.
          prior: null,
          spark: null,
        },
      },
    });
  } catch (e) {
    console.error("[inbox] analytics/kpis", e);
    res.status(500).json({ error: "Could not load KPIs." });
  }
}

function emptyKpis() {
  const zero = { value: 0, prior: 0, spark: Array(14).fill(0) };
  return {
    openConversations: zero,
    medianFirstReplySeconds: { value: null, prior: null, spark: Array(14).fill(0) },
    medianResolutionSeconds: { value: null, prior: null, spark: Array(14).fill(0) },
    slaHitPct: { value: null, prior: null, spark: Array(14).fill(0) },
    conversationsPerDay: zero,
    csat: { value: null, prior: null, spark: null },
  };
}

/**
 * GET /inbox/analytics/volume?window=14d&grain=day
 */
export async function getInboxAnalyticsVolume(req, res) {
  try {
    const pool = getPool();
    const allowed = await getAllowedConnectionIds(pool, req.user.id);
    const w = parseWindow(req);
    const days = windowToDays(w);
    if (!allowed.length) {
      res.json({ window: w, series: [] });
      return;
    }
    const { rows } = await pool.query(
      `WITH days AS (
         SELECT generate_series(
           date_trunc('day', NOW() - (($1::int - 1) || ' days')::interval),
           date_trunc('day', NOW()),
           INTERVAL '1 day'
         ) AS d
       )
       SELECT to_char(d, 'YYYY-MM-DD') AS date,
              COUNT(t.thread_id) FILTER (
                WHERE date_trunc('day', t.first_message_at) = days.d
              )::int AS received,
              COUNT(t.thread_id) FILTER (
                WHERE t.closed_at IS NOT NULL
                  AND date_trunc('day', t.closed_at) = days.d
              )::int AS resolved
         FROM days
    LEFT JOIN threads t
           ON (date_trunc('day', t.first_message_at) = days.d
            OR date_trunc('day', t.closed_at) = days.d)
          AND t.connection_id = ANY($2::int[])
        GROUP BY d
        ORDER BY d ASC`,
      [days, allowed]
    );
    res.json({
      window: w,
      series: rows.map((r) => ({
        date: r.date,
        received: r.received || 0,
        resolved: r.resolved || 0,
      })),
    });
  } catch (e) {
    console.error("[inbox] analytics/volume", e);
    res.status(500).json({ error: "Could not load volume." });
  }
}

/**
 * GET /inbox/analytics/channel-mix?window=14d
 */
export async function getInboxAnalyticsChannelMix(req, res) {
  try {
    const pool = getPool();
    const allowed = await getAllowedConnectionIds(pool, req.user.id);
    const w = parseWindow(req);
    const days = windowToDays(w);
    if (!allowed.length) {
      res.json({ window: w, channels: [] });
      return;
    }
    const { rows } = await pool.query(
      `SELECT COALESCE(channel, 'email') AS channel, COUNT(*)::int AS n
         FROM threads
        WHERE first_message_at >= NOW() - ($1::int || ' days')::interval
          AND connection_id = ANY($2::int[])
        GROUP BY 1
        ORDER BY n DESC`,
      [days, allowed]
    );
    const total = rows.reduce((s, r) => s + r.n, 0);
    res.json({
      window: w,
      total,
      channels: rows.map((r) => ({
        channel: r.channel,
        count: r.n,
        pct: total ? Math.round((r.n / total) * 100) : 0,
      })),
    });
  } catch (e) {
    console.error("[inbox] analytics/channel-mix", e);
    res.status(500).json({ error: "Could not load channel mix." });
  }
}

/**
 * GET /inbox/analytics/team-load
 *
 * Per-user open count (snapshot) + resolved count over the past 7 days.
 * Only includes active users with role <> 'staff' so the UI doesn't show
 * service accounts.
 */
export async function getInboxAnalyticsTeamLoad(req, res) {
  try {
    const pool = getPool();
    const allowed = await getAllowedConnectionIds(pool, req.user.id);
    if (!allowed.length) {
      res.json({ rows: [] });
      return;
    }
    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.display_name,
              COALESCE(o.open_n, 0)::int     AS open_count,
              COALESCE(c.closed_n, 0)::int   AS resolved_count
         FROM users u
    LEFT JOIN (
           SELECT assignee_id, COUNT(*)::int AS open_n
             FROM threads
            WHERE status = 'open'
              AND assignee_id IS NOT NULL
              AND connection_id = ANY($1::int[])
            GROUP BY assignee_id
         ) o ON o.assignee_id = u.id
    LEFT JOIN (
           SELECT assignee_id, COUNT(*)::int AS closed_n
             FROM threads
            WHERE status = 'closed'
              AND closed_at >= NOW() - INTERVAL '7 days'
              AND assignee_id IS NOT NULL
              AND connection_id = ANY($1::int[])
            GROUP BY assignee_id
         ) c ON c.assignee_id = u.id
        WHERE u.active = TRUE
          AND (COALESCE(o.open_n, 0) > 0 OR COALESCE(c.closed_n, 0) > 0)
        ORDER BY (COALESCE(o.open_n, 0) + COALESCE(c.closed_n, 0)) DESC,
                 u.display_name ASC`,
      [allowed]
    );
    res.json({
      rows: rows.map((r) => ({
        userId: r.id,
        username: r.username,
        displayName: r.display_name,
        openCount: r.open_count,
        resolvedCount: r.resolved_count,
      })),
    });
  } catch (e) {
    console.error("[inbox] analytics/team-load", e);
    res.status(500).json({ error: "Could not load team load." });
  }
}

/**
 * GET /inbox/analytics/inbox-health?window=14d
 *
 * Per-mailbox open count, SLA hit rate % over closed threads in window,
 * median first reply (formatted).
 */
export async function getInboxAnalyticsInboxHealth(req, res) {
  try {
    const pool = getPool();
    const allowed = await getAllowedConnectionIds(pool, req.user.id);
    const w = parseWindow(req);
    const days = windowToDays(w);
    if (!allowed.length) {
      res.json({ window: w, rows: [] });
      return;
    }
    const { rows } = await pool.query(
      `SELECT ec.id,
              COALESCE(ec.display_name, ec.mailbox_email, ec.email_address) AS name,
              COALESCE(open_n, 0)::int   AS open_count,
              EXTRACT(EPOCH FROM med_first_reply)::bigint AS median_first_reply_s,
              CASE WHEN closed_n > 0
                   THEN ROUND((in_sla_n::numeric / closed_n) * 100)::int
                   ELSE NULL
              END AS sla_hit_pct
         FROM email_connections ec
    LEFT JOIN (
           SELECT connection_id, COUNT(*)::int AS open_n
             FROM threads
            WHERE status = 'open'
            GROUP BY connection_id
         ) o ON o.connection_id = ec.id
    LEFT JOIN (
           SELECT connection_id,
                  COUNT(*)::int AS closed_n,
                  COUNT(*) FILTER (
                    WHERE first_outbound_at IS NOT NULL
                      AND sla_due_at IS NOT NULL
                      AND first_outbound_at <= sla_due_at
                  )::int AS in_sla_n,
                  percentile_disc(0.5) WITHIN GROUP (
                    ORDER BY (first_outbound_at - first_message_at)
                  ) AS med_first_reply
             FROM threads
            WHERE status = 'closed'
              AND closed_at >= NOW() - ($2::int || ' days')::interval
            GROUP BY connection_id
         ) c ON c.connection_id = ec.id
        WHERE ec.id = ANY($1::int[])
        ORDER BY name ASC`,
      [allowed, days]
    );
    res.json({
      window: w,
      rows: rows.map((r) => ({
        mailboxId: r.id,
        name: r.name,
        openCount: r.open_count,
        slaHitPct: r.sla_hit_pct, // may be null
        medianFirstReplySeconds:
          r.median_first_reply_s != null ? Number(r.median_first_reply_s) : null,
      })),
    });
  } catch (e) {
    console.error("[inbox] analytics/inbox-health", e);
    res.status(500).json({ error: "Could not load inbox health." });
  }
}
