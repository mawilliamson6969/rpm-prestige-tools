import { getPool } from "../lib/db.js";
import { runEmailSyncOnce } from "../lib/inbox/email-sync.js";
import { sendTicketReply } from "../lib/inbox/email-send.js";
import {
  buildMicrosoftAuthorizeUrl,
  exchangeCodeForTokens,
  fetchGraphMe,
  verifyOAuthState,
} from "../lib/inbox/microsoft-auth.js";

function frontendBase() {
  return (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");
}

/** GET — redirect to Microsoft (requires Authorization: Bearer; browsers should use POST authorize-url instead). */
export async function getMicrosoftConnect(req, res) {
  try {
    const url = buildMicrosoftAuthorizeUrl(req.user.id);
    res.redirect(302, url);
  } catch (e) {
    if (e.code === "MS_NOT_CONFIGURED") {
      res.status(503).json({ error: "Microsoft OAuth is not configured." });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Could not start OAuth." });
  }
}

/** POST — returns Microsoft authorize URL for SPA redirect */
export async function postMicrosoftAuthorizeUrl(req, res) {
  try {
    const url = buildMicrosoftAuthorizeUrl(req.user.id);
    res.json({ authorizeUrl: url });
  } catch (e) {
    if (e.code === "MS_NOT_CONFIGURED") {
      res.status(503).json({ error: "Microsoft OAuth is not configured." });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Could not start OAuth." });
  }
}

/** OAuth callback from Microsoft */
export async function getMicrosoftCallback(req, res) {
  const code = req.query.code;
  const state = req.query.state;
  const err = req.query.error;
  const base = frontendBase();
  if (err) {
    res.redirect(`${base}/inbox/settings?error=${encodeURIComponent(err)}`);
    return;
  }
  if (!code || !state) {
    res.redirect(`${base}/inbox/settings?error=missing_code`);
    return;
  }
  let userId;
  try {
    userId = verifyOAuthState(state);
  } catch {
    res.redirect(`${base}/inbox/settings?error=invalid_state`);
    return;
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token || null;
    const expiresIn = Number(tokens.expires_in) || 3600;
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

    const me = await fetchGraphMe(accessToken);
    const email = String(me.mail || me.userPrincipalName || me.email || "").trim();
    if (!email) throw new Error("Could not determine mailbox email.");

    const pool = getPool();
    const up = await pool.query(
      `UPDATE email_connections SET access_token = $1, refresh_token = $2, token_expires_at = $3,
        is_active = true, updated_at = NOW()
       WHERE user_id = $4 AND lower(email_address) = lower($5)`,
      [accessToken, refreshToken, tokenExpiresAt, userId, email]
    );
    if (up.rowCount === 0) {
      await pool.query(
        `INSERT INTO email_connections (user_id, email_address, access_token, refresh_token, token_expires_at, is_active)
         VALUES ($1, $2, $3, $4, $5, true)`,
        [userId, email, accessToken, refreshToken, tokenExpiresAt]
      );
    }

    res.redirect(`${base}/inbox/settings?connected=1`);
  } catch (e) {
    console.error("[inbox] oauth callback", e);
    res.redirect(`${base}/inbox/settings?error=${encodeURIComponent(e.message || "oauth_failed")}`);
  }
}

export async function getInboxConnections(req, res) {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT ec.id, ec.user_id, ec.email_address, ec.is_active, ec.connected_at, ec.last_sync_at,
        ess.sync_status, ess.last_sync_at AS sync_last_at, ess.messages_synced, ess.error_log
       FROM email_connections ec
       LEFT JOIN email_sync_state ess ON ess.user_id = ec.user_id
       WHERE ec.user_id = $1
       ORDER BY ec.id DESC`,
      [req.user.id]
    );
    res.json({ connections: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load connections." });
  }
}

export async function deleteInboxConnection(req, res) {
  try {
    const id = Number(req.params.id);
    const pool = getPool();
    const { rowCount } = await pool.query(
      `UPDATE email_connections SET is_active = false, updated_at = NOW() WHERE id = $1 AND user_id = $2`,
      [id, req.user.id]
    );
    if (!rowCount) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not disconnect." });
  }
}

function buildTicketWhere(req) {
  const params = [];
  let n = 1;
  const parts = ["1=1"];
  const bucket = req.query.bucket || "open";

  if (req.query.status) {
    parts.push(`t.status = $${n++}`);
    params.push(req.query.status);
  }
  if (req.query.category) {
    parts.push(`t.category = $${n++}`);
    params.push(req.query.category);
  }
  if (req.query.assignedTo) {
    parts.push(`t.assigned_to = $${n++}`);
    params.push(Number(req.query.assignedTo));
  }
  if (req.query.assignedToMe === "1") {
    parts.push(`t.assigned_to = $${n++}`);
    params.push(req.user.id);
  }
  if (req.query.unassigned === "1") {
    parts.push(`t.assigned_to IS NULL`);
  }
  if (req.query.isRead === "false") {
    parts.push(`t.is_read = false`);
  }
  if (req.query.isStarred === "true") {
    parts.push(`t.is_starred = true`);
  }
  if (req.query.search) {
    const q = `%${String(req.query.search).trim()}%`;
    parts.push(
      `(t.subject ILIKE $${n} OR t.body_preview ILIKE $${n} OR t.sender_name ILIKE $${n} OR t.sender_email ILIKE $${n})`
    );
    params.push(q);
    n++;
  }
  if (req.query.startDate) {
    parts.push(`t.received_at >= $${n++}::date`);
    params.push(req.query.startDate);
  }
  if (req.query.endDate) {
    parts.push(`t.received_at < ($${n++}::date + interval '1 day')`);
    params.push(req.query.endDate);
  }

  if (!req.query.status) {
    if (bucket === "all") {
      /* no default status filter */
    } else if (bucket === "starred") {
      parts.push(`t.is_starred = true`);
    } else if (bucket === "unread") {
      parts.push(`t.is_read = false`);
      parts.push(`t.status IN ('open','in_progress','waiting')`);
    } else if (bucket === "assignedToMe") {
      parts.push(`t.assigned_to = $${n++}`);
      params.push(req.user.id);
      parts.push(`t.status IN ('open','in_progress','waiting')`);
    } else if (bucket === "unassigned") {
      parts.push(`t.assigned_to IS NULL`);
      parts.push(`t.status IN ('open','in_progress','waiting')`);
    } else {
      parts.push(`t.status IN ('open','in_progress','waiting')`);
    }
  }

  return { where: parts.join(" AND "), params };
}

export async function getInboxTickets(req, res) {
  try {
    const limit = Math.min(Number(req.query.limit) || 40, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const sort = req.query.sort || "newest";
    const { where, params } = buildTicketWhere(req);
    const pool = getPool();

    let orderBy = "t.received_at DESC NULLS LAST";
    if (sort === "oldest") orderBy = "t.received_at ASC NULLS LAST";
    if (sort === "priority") orderBy = "t.priority DESC, t.received_at DESC";
    if (sort === "updated") orderBy = "t.updated_at DESC";

    const q = `
      SELECT t.*, u.username AS assignee_username, u.display_name AS assignee_name
      FROM tickets t
      LEFT JOIN users u ON u.id = t.assigned_to
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT ${limit} OFFSET ${offset}`;
    const { rows } = await pool.query(q, params);
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM tickets t WHERE ${where}`,
      params
    );
    res.json({ tickets: rows, total: countRows[0].c, limit, offset });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load tickets." });
  }
}

export async function getInboxTicket(req, res) {
  try {
    const id = Number(req.params.id);
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT t.*, u.username AS assignee_username, u.display_name AS assignee_name
       FROM tickets t
       LEFT JOIN users u ON u.id = t.assigned_to
       WHERE t.id = $1`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    const { rows: responses } = await pool.query(
      `SELECT tr.*, u.display_name AS responded_by_name
       FROM ticket_responses tr
       LEFT JOIN users u ON u.id = tr.responded_by
       WHERE tr.ticket_id = $1 ORDER BY tr.created_at ASC`,
      [id]
    );
    res.json({ ticket: rows[0], responses });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load ticket." });
  }
}

export async function putInboxTicket(req, res) {
  try {
    const id = Number(req.params.id);
    const b = req.body || {};
    const fields = [];
    const vals = [];
    let n = 1;
    const set = (col, val) => {
      fields.push(`${col} = $${n++}`);
      vals.push(val);
    };
    if (b.status != null) set("status", String(b.status).slice(0, 20));
    if (b.priority != null) set("priority", Number(b.priority));
    if (b.category != null) set("category", String(b.category).slice(0, 50));
    if (b.assignedTo !== undefined) set("assigned_to", b.assignedTo == null ? null : Number(b.assignedTo));
    if (typeof b.isRead === "boolean") set("is_read", b.isRead);
    if (typeof b.isStarred === "boolean") set("is_starred", b.isStarred);
    if (b.status === "resolved") set("resolved_at", new Date());
    if (!fields.length) {
      res.status(400).json({ error: "Nothing to update." });
      return;
    }
    fields.push(`updated_at = NOW()`);
    vals.push(id);
    const pool = getPool();
    const { rows } = await pool.query(`UPDATE tickets SET ${fields.join(", ")} WHERE id = $${n} RETURNING *`, vals);
    if (!rows.length) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    res.json({ ticket: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update ticket." });
  }
}

export async function postInboxTicketReply(req, res) {
  try {
    const id = Number(req.params.id);
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!body) {
      res.status(400).json({ error: "body is required." });
      return;
    }
    await sendTicketReply({ ticketId: id, body, userId: req.user.id });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Could not send reply." });
  }
}

export async function postInboxTicketNote(req, res) {
  try {
    const id = Number(req.params.id);
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!body) {
      res.status(400).json({ error: "body is required." });
      return;
    }
    const pool = getPool();
    await pool.query(
      `INSERT INTO ticket_responses (ticket_id, response_type, body, responded_by, sent_via)
       VALUES ($1, 'note', $2, $3, 'internal')`,
      [id, body, req.user.id]
    );
    await pool.query(`UPDATE tickets SET updated_at = NOW() WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not add note." });
  }
}

export async function postInboxTicketAssign(req, res) {
  try {
    const id = Number(req.params.id);
    const userId = req.body?.userId != null ? Number(req.body.userId) : null;
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE tickets SET assigned_to = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [userId, id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    res.json({ ticket: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not assign." });
  }
}

export async function getInboxStats(req, res) {
  try {
    const pool = getPool();
    const uid = req.user.id;
    const open = `status IN ('open','in_progress','waiting')`;
    const { rows: openRows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM tickets WHERE ${open}`
    );
    const { rows: unreadRows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM tickets WHERE is_read = false AND ${open}`
    );
    const { rows: meRows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM tickets WHERE assigned_to = $1 AND ${open}`,
      [uid]
    );
    const { rows: unassignedRows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM tickets WHERE assigned_to IS NULL AND ${open}`
    );
    const { rows: starredRows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM tickets WHERE is_starred = true`
    );
    const { rows: catRows } = await pool.query(
      `SELECT category, COUNT(*)::int AS c FROM tickets WHERE ${open} GROUP BY category`
    );
    const { rows: asgRows } = await pool.query(
      `SELECT u.display_name AS name, u.id, COUNT(t.id)::int AS c
       FROM users u
       LEFT JOIN tickets t ON t.assigned_to = u.id AND t.status IN ('open','in_progress','waiting')
       GROUP BY u.id, u.display_name`
    );
    res.json({
      totalOpen: openRows[0].c,
      unread: unreadRows[0].c,
      assignedToMe: meRows[0].c,
      unassigned: unassignedRows[0].c,
      starred: starredRows[0].c,
      byCategory: Object.fromEntries(catRows.map((r) => [r.category, r.c])),
      byAssignee: asgRows.filter((r) => r.c > 0),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load stats." });
  }
}

export async function postInboxSyncTrigger(req, res) {
  try {
    const results = await runEmailSyncOnce();
    res.json({ ok: true, results });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || "Sync failed." });
  }
}

export async function getInboxSyncStatus(req, res) {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT ess.*, u.display_name, ec.email_address
       FROM email_sync_state ess
       JOIN users u ON u.id = ess.user_id
       LEFT JOIN email_connections ec ON ec.user_id = ess.user_id AND ec.is_active = true`
    );
    res.json({ sync: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load sync status." });
  }
}
