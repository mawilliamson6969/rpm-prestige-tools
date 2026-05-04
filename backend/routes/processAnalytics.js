import { getPool } from "../lib/db.js";

/**
 * Phase 5: analytics endpoints over the data accumulated since Phase 1
 * (process_stage_history, process_activity_log, processes, process_steps,
 * process_role_assignments). All endpoints accept ?templateId, ?from, ?to,
 * ?userId for filtering. Best-effort: returns zero/empty rows rather than
 * throwing when there's nothing to chart yet.
 */

/* ---------- shared filter parsing ---------- */

function parseFilters(req) {
  const templateId = Number.parseInt(req.query.templateId ?? req.query.template_id, 10);
  const userId = Number.parseInt(req.query.userId ?? req.query.user_id, 10);
  const from = typeof req.query.from === "string" ? req.query.from.slice(0, 10) : null;
  const to = typeof req.query.to === "string" ? req.query.to.slice(0, 10) : null;
  return {
    templateId: Number.isFinite(templateId) ? templateId : null,
    userId: Number.isFinite(userId) ? userId : null,
    from: from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : null,
    to: to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : null,
  };
}

/**
 * Build SQL fragment + params for `processes p` filtering. Returns
 * { whereSQL, params, n } where n is the next param index.
 */
function processesWhere(f, baseSQL = "p.deleted_at IS NULL AND p.archived_at IS NULL") {
  const wheres = [baseSQL];
  const params = [];
  let n = 1;
  if (f.templateId != null) {
    wheres.push(`p.template_id = $${n++}`);
    params.push(f.templateId);
  }
  if (f.from) {
    wheres.push(`p.created_at >= $${n++}::timestamp`);
    params.push(f.from);
  }
  if (f.to) {
    wheres.push(`p.created_at < ($${n++}::timestamp + INTERVAL '1 day')`);
    params.push(f.to);
  }
  if (f.userId != null) {
    wheres.push(
      `EXISTS (SELECT 1 FROM process_steps s WHERE s.process_id = p.id AND s.assigned_user_id = $${n++})`
    );
    params.push(f.userId);
  }
  return { whereSQL: wheres.join(" AND "), params, n };
}

function median(nums) {
  if (!nums.length) return 0;
  const sorted = nums.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function round1(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  return Math.round(Number(n) * 10) / 10;
}

/* ---------- 1. KPI summary ---------- */

export async function getAnalyticsKpis(req, res) {
  const f = parseFilters(req);
  const pool = getPool();
  try {
    const { whereSQL, params } = processesWhere(f);

    // Active + overdue (live counts ignore the date filter, since "active right now"
    // doesn't depend on a window — but template/user filters still apply).
    const liveWhere = processesWhere({ ...f, from: null, to: null });
    const { rows: liveRows } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE p.status = 'active')::int AS active_count,
         COUNT(*) FILTER (WHERE p.status = 'active' AND p.target_completion < CURRENT_DATE)::int AS overdue_count
       FROM processes p
       WHERE ${liveWhere.whereSQL}`,
      liveWhere.params
    );

    // Completed this month / last month (still respect template/user filter).
    const baseWhere = processesWhere({ ...f, from: null, to: null });
    const { rows: monthRows } = await pool.query(
      `SELECT
         COUNT(*) FILTER (
           WHERE p.status = 'completed'
             AND p.completed_at >= DATE_TRUNC('month', NOW())
         )::int AS this_month,
         COUNT(*) FILTER (
           WHERE p.status = 'completed'
             AND p.completed_at >= DATE_TRUNC('month', NOW() - INTERVAL '1 month')
             AND p.completed_at < DATE_TRUNC('month', NOW())
         )::int AS last_month,
         ROUND(AVG(EXTRACT(EPOCH FROM (p.completed_at - p.started_at)) / 86400.0)
           FILTER (WHERE p.status = 'completed'), 1) AS avg_days,
         ROUND(AVG(EXTRACT(EPOCH FROM (p.completed_at - p.started_at)) / 86400.0)
           FILTER (
             WHERE p.status = 'completed'
               AND p.completed_at >= DATE_TRUNC('month', NOW() - INTERVAL '1 month')
               AND p.completed_at < DATE_TRUNC('month', NOW())
           ), 1) AS avg_days_last_month,
         COUNT(*) FILTER (
           WHERE p.status = 'completed'
             AND p.target_completion IS NOT NULL
             AND p.completed_at::date <= p.target_completion
         )::int AS on_time,
         COUNT(*) FILTER (
           WHERE p.status = 'completed'
             AND p.target_completion IS NOT NULL
         )::int AS completed_with_target
       FROM processes p
       WHERE ${baseWhere.whereSQL}`,
      baseWhere.params
    );

    // Created in window (uses date filter).
    const { rows: createdRows } = await pool.query(
      `SELECT COUNT(*)::int AS total_created FROM processes p WHERE ${whereSQL}`,
      params
    );

    // Autopilot-created in window (process_activity_log actor_type='automation').
    const apWhere = ["l.action_type = 'process_created'", "l.actor_type = 'automation'"];
    const apParams = [];
    let n = 1;
    if (f.templateId != null) {
      apWhere.push(`p.template_id = $${n++}`);
      apParams.push(f.templateId);
    }
    if (f.from) {
      apWhere.push(`l.created_at >= $${n++}::timestamp`);
      apParams.push(f.from);
    }
    if (f.to) {
      apWhere.push(`l.created_at < ($${n++}::timestamp + INTERVAL '1 day')`);
      apParams.push(f.to);
    }
    const { rows: apRows } = await pool.query(
      `SELECT COUNT(*)::int AS autopilot_created
       FROM process_activity_log l
       JOIN processes p ON p.id = l.process_id
       WHERE ${apWhere.join(" AND ")}`,
      apParams
    );

    const live = liveRows[0] || {};
    const month = monthRows[0] || {};
    const thisMonth = month.this_month ?? 0;
    const lastMonth = month.last_month ?? 0;
    const avgDays = month.avg_days != null ? Number(month.avg_days) : null;
    const avgDaysLast = month.avg_days_last_month != null ? Number(month.avg_days_last_month) : null;
    const onTime = month.on_time ?? 0;
    const target = month.completed_with_target ?? 0;
    const onTimeRate = target > 0 ? Math.round((onTime / target) * 1000) / 10 : null;

    let completionTrend = "flat";
    if (lastMonth > 0) {
      if (thisMonth > lastMonth * 1.05) completionTrend = "up";
      else if (thisMonth < lastMonth * 0.95) completionTrend = "down";
    } else if (thisMonth > 0) {
      completionTrend = "up";
    }

    res.json({
      activeProcesses: live.active_count ?? 0,
      overdueProcesses: live.overdue_count ?? 0,
      completedThisMonth: thisMonth,
      completedLastMonth: lastMonth,
      completionTrend,
      avgCompletionDays: avgDays,
      avgCompletionDaysLastMonth: avgDaysLast,
      onTimeRate,
      totalProcessesCreated: createdRows[0]?.total_created ?? 0,
      autopilotCreated: apRows[0]?.autopilot_created ?? 0,
    });
  } catch (e) {
    console.error("[analytics:kpis]", e.message);
    res.status(500).json({ error: "Could not load KPIs." });
  }
}

/* ---------- 2. Stage bottleneck ---------- */

export async function getAnalyticsBottlenecks(req, res) {
  const f = parseFilters(req);
  const pool = getPool();
  try {
    if (f.templateId == null) {
      // Bottlenecks need a chosen template. Without one, return all stages
      // across all templates — but that's noisy. Require template.
      res.json({ stages: [], worstBottleneck: null });
      return;
    }
    const params = [f.templateId];
    let n = 2;
    const dateClauses = [];
    if (f.from) {
      dateClauses.push(`sh.entered_at >= $${n++}::timestamp`);
      params.push(f.from);
    }
    if (f.to) {
      dateClauses.push(`sh.entered_at < ($${n++}::timestamp + INTERVAL '1 day')`);
      params.push(f.to);
    }
    const dateSQL = dateClauses.length ? ` AND ${dateClauses.join(" AND ")}` : "";

    // Per-row durations so we can compute median in JS.
    const { rows: rawRows } = await pool.query(
      `SELECT s.id AS stage_id, s.name AS stage_name, s.color AS stage_color,
              s.stage_order,
              EXTRACT(EPOCH FROM (COALESCE(sh.exited_at, NOW()) - sh.entered_at)) / 86400.0 AS duration_days
       FROM process_template_stages s
       LEFT JOIN process_stage_history sh
         ON sh.stage_id = s.id ${dateSQL}
       WHERE s.template_id = $1
       ORDER BY s.stage_order ASC, s.id ASC`,
      params
    );

    // Active counts per stage (only on this template).
    const { rows: activeRows } = await pool.query(
      `SELECT current_stage_id AS stage_id, COUNT(*)::int AS active
       FROM processes
       WHERE template_id = $1 AND status = 'active'
         AND current_stage_id IS NOT NULL
         AND archived_at IS NULL AND deleted_at IS NULL
       GROUP BY current_stage_id`,
      [f.templateId]
    );
    const activeByStage = new Map(activeRows.map((r) => [r.stage_id, r.active]));

    const groups = new Map();
    for (const r of rawRows) {
      if (!groups.has(r.stage_id)) {
        groups.set(r.stage_id, {
          stageId: r.stage_id,
          stageName: r.stage_name,
          stageColor: r.stage_color,
          stageOrder: r.stage_order,
          durations: [],
        });
      }
      if (r.duration_days !== null && r.duration_days !== undefined) {
        groups.get(r.stage_id).durations.push(Number(r.duration_days));
      }
    }

    let worstId = null;
    let worstAvg = -1;
    const stages = Array.from(groups.values()).map((g) => {
      const avg = g.durations.length
        ? g.durations.reduce((a, b) => a + b, 0) / g.durations.length
        : 0;
      if (avg > worstAvg) {
        worstAvg = avg;
        worstId = g.stageId;
      }
      return {
        stageId: g.stageId,
        stageName: g.stageName,
        stageColor: g.stageColor,
        avgDays: round1(avg),
        medianDays: round1(median(g.durations)),
        maxDays: round1(g.durations.length ? Math.max(...g.durations) : 0),
        minDays: round1(g.durations.length ? Math.min(...g.durations) : 0),
        activeProcesses: activeByStage.get(g.stageId) ?? 0,
        totalPasses: g.durations.length,
      };
    });
    for (const s of stages) s.isBottleneck = s.stageId === worstId && s.totalPasses > 0;

    let worstBottleneck = null;
    const sortedByAvg = stages.filter((s) => s.totalPasses > 0).sort((a, b) => b.avgDays - a.avgDays);
    if (sortedByAvg.length) {
      const w = sortedByAvg[0];
      const second = sortedByAvg[1];
      const ratio = second && second.avgDays > 0 ? w.avgDays / second.avgDays : 1;
      worstBottleneck = {
        stageName: w.stageName,
        avgDays: w.avgDays,
        suggestion:
          ratio >= 2
            ? `${w.stageName} averages ${w.avgDays} days — ${ratio.toFixed(1)}× longer than the next-slowest stage. Consider automation or extra follow-ups here.`
            : `${w.stageName} is the longest stage at ${w.avgDays} days on average.`,
      };
    }

    res.json({ stages, worstBottleneck });
  } catch (e) {
    console.error("[analytics:bottlenecks]", e.message);
    res.status(500).json({ error: "Could not load bottlenecks." });
  }
}

/* ---------- 3. Team workload ---------- */

function capacityFor(activeTasks, overdueTasks) {
  const score = activeTasks * 5 + overdueTasks * 15;
  if (score >= 80) return { capacity: "over", capacityScore: Math.min(100, score) };
  if (score >= 50) return { capacity: "high", capacityScore: score };
  if (score >= 20) return { capacity: "normal", capacityScore: score };
  return { capacity: "low", capacityScore: score };
}

export async function getAnalyticsWorkload(req, res) {
  const f = parseFilters(req);
  const pool = getPool();
  try {
    const params = [];
    let n = 1;
    const tplJoin = f.templateId != null ? `AND p.template_id = $${n++}` : "";
    if (f.templateId != null) params.push(f.templateId);

    const { rows } = await pool.query(
      `SELECT u.id AS user_id, u.display_name AS user_name, u.role AS user_role,
              COUNT(s.id) FILTER (
                WHERE s.assigned_user_id = u.id
                  AND s.status NOT IN ('completed','skipped')
                  AND p.status = 'active'
                  AND p.archived_at IS NULL AND p.deleted_at IS NULL
              )::int AS active_tasks,
              COUNT(s.id) FILTER (
                WHERE s.assigned_user_id = u.id
                  AND s.status NOT IN ('completed','skipped')
                  AND p.status = 'active'
                  AND s.due_date < CURRENT_DATE
                  AND p.archived_at IS NULL AND p.deleted_at IS NULL
              )::int AS overdue_tasks,
              COUNT(DISTINCT p.id) FILTER (
                WHERE p.status = 'active'
                  AND p.archived_at IS NULL AND p.deleted_at IS NULL
              )::int AS active_processes,
              COUNT(s.id) FILTER (
                WHERE s.completed_by = u.id
                  AND s.status = 'completed'
                  AND s.completed_at >= NOW() - INTERVAL '7 days'
              )::int AS completed_this_week,
              ROUND(AVG(EXTRACT(EPOCH FROM (s.completed_at - s.created_at)) / 86400.0)
                FILTER (
                  WHERE s.completed_by = u.id AND s.status = 'completed'
                    AND s.completed_at >= NOW() - INTERVAL '30 days'
                ), 1) AS avg_completion_days
       FROM users u
       LEFT JOIN process_steps s ON s.assigned_user_id = u.id OR s.completed_by = u.id
       LEFT JOIN processes p ON p.id = s.process_id ${tplJoin}
       GROUP BY u.id, u.display_name, u.role
       HAVING COALESCE(SUM(CASE WHEN s.id IS NOT NULL THEN 1 ELSE 0 END), 0) > 0
       ORDER BY active_tasks DESC, u.display_name ASC`,
      params
    );

    const team = rows.map((r) => {
      const cap = capacityFor(r.active_tasks ?? 0, r.overdue_tasks ?? 0);
      return {
        userId: r.user_id,
        userName: r.user_name,
        userRole: r.user_role,
        activeTasks: r.active_tasks ?? 0,
        overdueTasks: r.overdue_tasks ?? 0,
        activeProcesses: r.active_processes ?? 0,
        completedThisWeek: r.completed_this_week ?? 0,
        avgCompletionDays: r.avg_completion_days != null ? Number(r.avg_completion_days) : null,
        ...cap,
      };
    });

    let suggestion = null;
    let rebalanceNeeded = false;
    const overloaded = team.find((t) => t.capacity === "over");
    const available = team.find((t) => t.capacity === "low" || t.capacity === "normal");
    if (overloaded && available) {
      rebalanceNeeded = true;
      suggestion = `${overloaded.userName} has ${overloaded.activeTasks} active tasks${
        overloaded.overdueTasks ? ` (${overloaded.overdueTasks} overdue)` : ""
      }. ${available.userName} has capacity with only ${
        available.activeTasks
      } active. Consider rebalancing.`;
    }

    res.json({ team, rebalanceNeeded, suggestion });
  } catch (e) {
    console.error("[analytics:workload]", e.message);
    res.status(500).json({ error: "Could not load workload." });
  }
}

/* ---------- 4. Trends ---------- */

export async function getAnalyticsTrends(req, res) {
  const f = parseFilters(req);
  const pool = getPool();
  try {
    const wheres = ["p.deleted_at IS NULL", "p.archived_at IS NULL"];
    const params = [];
    let n = 1;
    if (f.templateId != null) {
      wheres.push(`p.template_id = $${n++}`);
      params.push(f.templateId);
    }
    const { rows: completed } = await pool.query(
      `SELECT TO_CHAR(p.completed_at, 'YYYY-MM') AS month,
              TO_CHAR(p.completed_at, 'Mon') AS label,
              COUNT(*)::int AS completed,
              ROUND(AVG(EXTRACT(EPOCH FROM (p.completed_at - p.started_at)) / 86400.0), 1)
                AS avg_days
       FROM processes p
       WHERE ${wheres.join(" AND ")}
         AND p.status = 'completed'
         AND p.completed_at >= NOW() - INTERVAL '6 months'
       GROUP BY 1, 2
       ORDER BY 1`,
      params
    );
    const { rows: created } = await pool.query(
      `SELECT TO_CHAR(p.started_at, 'YYYY-MM') AS month,
              COUNT(*)::int AS created
       FROM processes p
       WHERE ${wheres.join(" AND ")}
         AND p.started_at >= NOW() - INTERVAL '6 months'
       GROUP BY 1
       ORDER BY 1`,
      params
    );
    const createdByMonth = new Map(created.map((r) => [r.month, r.created]));
    const months = completed.map((r) => ({
      month: r.month,
      label: r.label,
      completed: r.completed,
      avgDays: r.avg_days != null ? Number(r.avg_days) : null,
      created: createdByMonth.get(r.month) ?? 0,
    }));

    let improving = false;
    let improvementPct = 0;
    if (months.length >= 2) {
      const first = months[0].avgDays;
      const last = months[months.length - 1].avgDays;
      if (first && last && first > 0) {
        const delta = (first - last) / first;
        improvementPct = Math.round(delta * 100);
        improving = delta > 0.05;
      }
    }
    res.json({ months, improving, improvementPct });
  } catch (e) {
    console.error("[analytics:trends]", e.message);
    res.status(500).json({ error: "Could not load trends." });
  }
}

/* ---------- 5. By process type ---------- */

export async function getAnalyticsByType(req, res) {
  const f = parseFilters(req);
  const pool = getPool();
  try {
    const params = [];
    let n = 1;
    const dateClauses = [];
    if (f.from) {
      dateClauses.push(`p.started_at >= $${n++}::timestamp`);
      params.push(f.from);
    }
    if (f.to) {
      dateClauses.push(`p.started_at < ($${n++}::timestamp + INTERVAL '1 day')`);
      params.push(f.to);
    }
    const dateSQL = dateClauses.length ? ` AND ${dateClauses.join(" AND ")}` : "";

    const { rows: typeRows } = await pool.query(
      `SELECT t.id AS template_id, t.name AS template_name, t.icon, t.color,
              COUNT(p.id) FILTER (WHERE p.status = 'active')::int AS active_count,
              COUNT(p.id) FILTER (WHERE p.status = 'completed')::int AS completed_count,
              ROUND(AVG(EXTRACT(EPOCH FROM (p.completed_at - p.started_at)) / 86400.0)
                FILTER (WHERE p.status = 'completed'), 1) AS avg_days,
              ROUND(100.0 * COUNT(p.id) FILTER (
                WHERE p.status = 'completed'
                  AND p.target_completion IS NOT NULL
                  AND p.completed_at::date <= p.target_completion
              ) / NULLIF(COUNT(p.id) FILTER (
                WHERE p.status = 'completed' AND p.target_completion IS NOT NULL
              ), 0), 1) AS on_time_rate
       FROM process_templates t
       LEFT JOIN processes p ON p.template_id = t.id
         AND p.archived_at IS NULL AND p.deleted_at IS NULL ${dateSQL}
       WHERE t.is_active = TRUE
       GROUP BY t.id, t.name, t.icon, t.color
       ORDER BY active_count DESC, t.name ASC`,
      params
    );

    // Worst stage per template — fetched in one query.
    const { rows: bottleneckRows } = await pool.query(
      `WITH stage_avgs AS (
         SELECT s.template_id, s.id AS stage_id, s.name AS stage_name,
                AVG(EXTRACT(EPOCH FROM (COALESCE(sh.exited_at, NOW()) - sh.entered_at)) / 86400.0)
                  AS avg_days
         FROM process_template_stages s
         LEFT JOIN process_stage_history sh ON sh.stage_id = s.id
         GROUP BY s.template_id, s.id, s.name
       )
       SELECT DISTINCT ON (template_id) template_id, stage_name, ROUND(avg_days::numeric, 1) AS avg_days
       FROM stage_avgs
       WHERE avg_days IS NOT NULL
       ORDER BY template_id, avg_days DESC`
    );
    const bottleneckByTemplate = new Map(
      bottleneckRows.map((r) => [r.template_id, { stage: r.stage_name, days: Number(r.avg_days) }])
    );

    const types = typeRows.map((r) => ({
      templateId: r.template_id,
      templateName: r.template_name,
      icon: r.icon,
      color: r.color,
      activeCount: r.active_count ?? 0,
      completedCount: r.completed_count ?? 0,
      avgCompletionDays: r.avg_days != null ? Number(r.avg_days) : null,
      onTimeRate: r.on_time_rate != null ? Number(r.on_time_rate) : null,
      bottleneckStage: bottleneckByTemplate.get(r.template_id)?.stage ?? null,
      bottleneckAvgDays: bottleneckByTemplate.get(r.template_id)?.days ?? null,
    }));

    res.json({ types });
  } catch (e) {
    console.error("[analytics:by-type]", e.message);
    res.status(500).json({ error: "Could not load by-type breakdown." });
  }
}

/* ---------- 6. Activity heatmap ---------- */

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export async function getAnalyticsHeatmap(_req, res) {
  const pool = getPool();
  try {
    const { rows } = await pool.query(
      `SELECT
         EXTRACT(DOW FROM (created_at AT TIME ZONE 'America/Chicago'))::int AS day,
         EXTRACT(HOUR FROM (created_at AT TIME ZONE 'America/Chicago'))::int AS hour,
         COUNT(*)::int AS count
       FROM process_activity_log
       WHERE created_at >= NOW() - INTERVAL '30 days'
       GROUP BY 1, 2
       ORDER BY 1, 2`
    );
    let peak = null;
    let quiet = null;
    for (const r of rows) {
      if (!peak || r.count > peak.count) peak = r;
      if (!quiet || r.count < quiet.count) quiet = r;
    }
    res.json({
      heatmap: rows.map((r) => ({
        day: r.day,
        dayName: DAY_NAMES[r.day] || "?",
        hour: r.hour,
        count: r.count,
      })),
      peakTime: peak
        ? {
            day: DAY_NAMES[peak.day],
            hour: `${peak.hour}:00`,
            avgActions: peak.count,
          }
        : null,
      quietTime: quiet
        ? {
            day: DAY_NAMES[quiet.day],
            hour: `${quiet.hour}:00`,
            avgActions: quiet.count,
          }
        : null,
    });
  } catch (e) {
    console.error("[analytics:heatmap]", e.message);
    res.status(500).json({ error: "Could not load heatmap." });
  }
}
