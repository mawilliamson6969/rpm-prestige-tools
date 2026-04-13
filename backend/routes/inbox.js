import { getPool } from "../lib/db.js";
import { runEmailSyncOnce } from "../lib/inbox/email-sync.js";
import { sendTicketReply } from "../lib/inbox/email-send.js";
import {
  assertInboxAdminOnConnection,
  getAllowedConnectionIds,
  getUserPermissionOnConnection,
  permissionAtLeast,
} from "../lib/inbox/inbox-permissions.js";
import {
  buildMicrosoftAuthorizeUrl,
  exchangeCodeForTokens,
  fetchGraphMe,
  verifyOAuthState,
} from "../lib/inbox/microsoft-auth.js";
import { runAiDraftForTicket } from "../lib/inbox/ai-draft-reply.js";

function frontendBase() {
  return (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");
}

function oauthOptsFromRequest(req) {
  const q = req.query || {};
  const type = String(q.type || "personal").toLowerCase() === "shared" ? "shared" : "personal";
  const mailbox = typeof q.mailbox === "string" ? q.mailbox.trim() : "";
  const displayName = typeof q.displayName === "string" ? q.displayName.trim() : "";
  return {
    flow: type === "shared" ? "shared" : "personal",
    sharedMailbox: type === "shared" ? mailbox : null,
    displayName: displayName || null,
  };
}

/** GET — redirect to Microsoft (requires Authorization: Bearer; browsers should use POST authorize-url instead). */
export async function getMicrosoftConnect(req, res) {
  try {
    const o = oauthOptsFromRequest(req);
    if (o.flow === "shared" && !o.sharedMailbox) {
      res.status(400).json({ error: "Shared mailbox email is required (query: mailbox=)." });
      return;
    }
    const url = buildMicrosoftAuthorizeUrl(req.user.id, o);
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
    const b = req.body || {};
    const flow = String(b.flow || "personal").toLowerCase() === "shared" ? "shared" : "personal";
    const sharedMailbox = typeof b.mailbox === "string" ? b.mailbox.trim() : "";
    const displayName = typeof b.displayName === "string" ? b.displayName.trim() : "";
    if (flow === "shared" && !sharedMailbox) {
      res.status(400).json({ error: "mailbox is required for shared mailbox flow." });
      return;
    }
    const url = buildMicrosoftAuthorizeUrl(req.user.id, {
      flow,
      sharedMailbox: flow === "shared" ? sharedMailbox : null,
      displayName: displayName || null,
    });
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
  let oauthCtx;
  try {
    oauthCtx = verifyOAuthState(state);
  } catch {
    res.redirect(`${base}/inbox/settings?error=invalid_state`);
    return;
  }
  const userId = oauthCtx.userId;

  try {
    const tokens = await exchangeCodeForTokens(code);
    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token || null;
    const expiresIn = Number(tokens.expires_in) || 3600;
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

    const me = await fetchGraphMe(accessToken);
    const personalEmail = String(me.mail || me.userPrincipalName || me.email || "").trim();
    if (!personalEmail) throw new Error("Could not determine your Microsoft sign-in email.");

    const pool = getPool();
    const flow = oauthCtx.flow === "shared" ? "shared" : "personal";
    let mailboxType = "personal";
    let mailboxEmail = personalEmail.toLowerCase();
    let emailAddress = personalEmail;
    let displayName =
      oauthCtx.displayName ||
      (me.displayName ? String(me.displayName).trim().slice(0, 255) : null) ||
      personalEmail;

    if (flow === "shared") {
      const shared = (oauthCtx.sharedMailbox || "").trim().toLowerCase();
      if (!shared || !shared.includes("@")) throw new Error("Invalid shared mailbox address.");
      mailboxType = "shared";
      mailboxEmail = shared;
      emailAddress = personalEmail;
      displayName = oauthCtx.displayName || shared;
    }

    const up = await pool.query(
      `UPDATE email_connections SET
        email_address = $1,
        access_token = $2, refresh_token = $3, token_expires_at = $4,
        mailbox_type = $5, mailbox_email = $6, display_name = $7,
        is_active = true, updated_at = NOW()
       WHERE user_id = $8 AND lower(mailbox_email) = lower($6)`,
      [
        emailAddress,
        accessToken,
        refreshToken,
        tokenExpiresAt,
        mailboxType,
        mailboxEmail,
        displayName.slice(0, 255),
        userId,
      ]
    );
    let connectionId;
    if (up.rowCount === 0) {
      const ins = await pool.query(
        `INSERT INTO email_connections (
          user_id, email_address, access_token, refresh_token, token_expires_at, is_active,
          mailbox_type, mailbox_email, display_name
        ) VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8)
        RETURNING id`,
        [
          userId,
          emailAddress,
          accessToken,
          refreshToken,
          tokenExpiresAt,
          mailboxType,
          mailboxEmail,
          displayName.slice(0, 255),
        ]
      );
      connectionId = ins.rows[0].id;
    } else {
      const { rows } = await pool.query(`SELECT id FROM email_connections WHERE user_id = $1 AND lower(mailbox_email) = lower($2)`, [
        userId,
        mailboxEmail,
      ]);
      connectionId = rows[0]?.id;
    }

    if (connectionId) {
      await pool.query(
        `INSERT INTO inbox_permissions (connection_id, user_id, permission, granted_by)
         VALUES ($1, $2, 'admin', $2)
         ON CONFLICT (connection_id, user_id) DO UPDATE SET permission = 'admin'`,
        [connectionId, userId]
      );
      await pool.query(
        `INSERT INTO inbox_permissions (connection_id, user_id, permission, granted_by)
         SELECT $1, u.id, 'admin', $2 FROM users u WHERE lower(u.username) = 'mike'
         ON CONFLICT (connection_id, user_id) DO NOTHING`,
        [connectionId, userId]
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
      `SELECT ec.id, ec.user_id, ec.email_address, ec.mailbox_type, ec.mailbox_email, ec.display_name,
        ec.is_active, ec.connected_at, ec.last_sync_at,
        ess.sync_status, ess.last_sync_at AS sync_last_at, ess.messages_synced, ess.error_log,
        ip.permission AS my_permission,
        (SELECT COUNT(*)::int FROM tickets t
         WHERE t.connection_id = ec.id AND t.is_read = false
           AND t.status IN ('open','in_progress','waiting')) AS unread_count
       FROM email_connections ec
       INNER JOIN inbox_permissions ip ON ip.connection_id = ec.id AND ip.user_id = $1
       LEFT JOIN email_sync_state ess ON ess.user_id = ec.user_id
       WHERE ec.is_active = true
       ORDER BY lower(COALESCE(ec.display_name, ec.mailbox_email, ec.email_address)), ec.id`,
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
      `UPDATE email_connections SET is_active = false, updated_at = NOW()
       WHERE id = $1
         AND (
           user_id = $2
           OR EXISTS (
             SELECT 1 FROM inbox_permissions ip
             WHERE ip.connection_id = $1 AND ip.user_id = $2 AND ip.permission = 'admin'
           )
         )`,
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

function buildTicketWhere(req, allowedConnectionIds) {
  const params = [];
  let n = 1;
  const parts = ["1=1"];
  const bucket = req.query.bucket || "open";

  if (allowedConnectionIds.length) {
    parts.push(`(t.connection_id IS NULL OR t.connection_id = ANY($${n}::int[]))`);
    params.push(allowedConnectionIds);
    n++;
  } else {
    parts.push("FALSE");
  }

  const cidRaw = req.query.connectionId;
  if (cidRaw != null && cidRaw !== "") {
    const cid = Number(cidRaw);
    if (Number.isFinite(cid) && allowedConnectionIds.includes(cid)) {
      parts.push(`t.connection_id = $${n++}`);
      params.push(cid);
    }
  }

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
    const pool = getPool();
    const allowedConnectionIds = await getAllowedConnectionIds(pool, req.user.id);
    if (!allowedConnectionIds.length) {
      res.json({ tickets: [], total: 0, limit, offset });
      return;
    }
    const { where, params } = buildTicketWhere(req, allowedConnectionIds);

    let orderBy = "t.received_at DESC NULLS LAST";
    if (sort === "oldest") orderBy = "t.received_at ASC NULLS LAST";
    if (sort === "priority") orderBy = "t.priority DESC, t.received_at DESC";
    if (sort === "updated") orderBy = "t.updated_at DESC";

    const q = `
      SELECT t.*, u.username AS assignee_username, u.display_name AS assignee_name,
        (tad.id IS NOT NULL) AS has_ai_draft_ready,
        ec.display_name AS mailbox_display_name,
        ec.mailbox_email AS mailbox_email,
        ec.mailbox_type AS mailbox_type
      FROM tickets t
      LEFT JOIN users u ON u.id = t.assigned_to
      LEFT JOIN email_connections ec ON ec.id = t.connection_id
      LEFT JOIN ticket_ai_drafts tad ON tad.ticket_id = t.id AND tad.used_at IS NULL
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT ${limit} OFFSET ${offset}`;
    const { rows } = await pool.query(q, params);
    const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int AS c FROM tickets t WHERE ${where}`, params);
    res.json({ tickets: rows, total: countRows[0].c, limit, offset });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load tickets." });
  }
}

async function userCanViewTicket(pool, userId, ticket) {
  const allowed = await getAllowedConnectionIds(pool, userId);
  if (ticket.connection_id) return allowed.includes(Number(ticket.connection_id));
  if (!ticket.source_user_id) return false;
  const { rows } = await pool.query(
    `SELECT 1 FROM email_connections ec
     INNER JOIN inbox_permissions ip ON ip.connection_id = ec.id AND ip.user_id = $1
     WHERE ec.user_id = $2 AND ec.is_active = true
     LIMIT 1`,
    [userId, ticket.source_user_id]
  );
  return rows.length > 0;
}

export async function getInboxTicket(req, res) {
  try {
    const id = Number(req.params.id);
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT t.*, u.username AS assignee_username, u.display_name AS assignee_name,
        ec.display_name AS mailbox_display_name,
        ec.mailbox_email AS mailbox_email,
        ec.mailbox_type AS mailbox_type
       FROM tickets t
       LEFT JOIN users u ON u.id = t.assigned_to
       LEFT JOIN email_connections ec ON ec.id = t.connection_id
       WHERE t.id = $1`,
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    const ticket = rows[0];
    if (!(await userCanViewTicket(pool, req.user.id, ticket))) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    let inboxPermission = null;
    let replyFromEmail = null;
    if (ticket.connection_id) {
      inboxPermission = await getUserPermissionOnConnection(pool, req.user.id, ticket.connection_id);
      replyFromEmail = ticket.mailbox_email || ticket.email_address || null;
    } else if (ticket.source_user_id) {
      const { rows: cr } = await pool.query(
        `SELECT ec.id, ec.mailbox_email, ec.mailbox_type FROM email_connections ec
         WHERE ec.user_id = $1 AND ec.is_active = true ORDER BY ec.id DESC LIMIT 1`,
        [ticket.source_user_id]
      );
      if (cr[0]) {
        inboxPermission = await getUserPermissionOnConnection(pool, req.user.id, cr[0].id);
        replyFromEmail = cr[0].mailbox_email || null;
      }
    }
    const { rows: responses } = await pool.query(
      `SELECT tr.*, u.display_name AS responded_by_name
       FROM ticket_responses tr
       LEFT JOIN users u ON u.id = tr.responded_by
       WHERE tr.ticket_id = $1 ORDER BY tr.created_at ASC`,
      [id]
    );
    const { rows: draftRows } = await pool.query(
      `SELECT draft_text, context_used, created_at
       FROM ticket_ai_drafts WHERE ticket_id = $1 AND used_at IS NULL`,
      [id]
    );
    const ai_draft = draftRows[0]
      ? {
          draft_text: draftRows[0].draft_text,
          context_used: draftRows[0].context_used,
          created_at: draftRows[0].created_at,
        }
      : null;
    res.json({
      ticket: {
        ...ticket,
        inbox_permission: inboxPermission,
        reply_from_email: replyFromEmail,
      },
      responses,
      ai_draft,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load ticket." });
  }
}

export async function putInboxTicket(req, res) {
  try {
    const id = Number(req.params.id);
    const pool = getPool();
    const { rows: existingRows } = await pool.query(`SELECT * FROM tickets WHERE id = $1`, [id]);
    if (!existingRows.length) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    const existing = existingRows[0];
    if (!(await userCanViewTicket(pool, req.user.id, existing))) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    let connId = existing.connection_id ? Number(existing.connection_id) : null;
    if (!connId && existing.source_user_id) {
      const { rows: cr } = await pool.query(
        `SELECT id FROM email_connections WHERE user_id = $1 AND is_active = true ORDER BY id DESC LIMIT 1`,
        [existing.source_user_id]
      );
      connId = cr[0]?.id ?? null;
    }
    const perm = connId ? await getUserPermissionOnConnection(pool, req.user.id, connId) : null;

    const b = req.body || {};
    const fields = [];
    const vals = [];
    let n = 1;
    const set = (col, val) => {
      fields.push(`${col} = $${n++}`);
      vals.push(val);
    };
    const wantsMeta =
      b.status != null || b.priority != null || b.category != null || b.assignedTo !== undefined;
    if (wantsMeta && !permissionAtLeast(perm, "reply")) {
      res.status(403).json({ error: "Reply permission or higher is required to change this ticket." });
      return;
    }
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
    const { rows: tr } = await pool.query(`SELECT * FROM tickets WHERE id = $1`, [id]);
    if (!tr.length) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    if (!(await userCanViewTicket(pool, req.user.id, tr[0]))) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    let connId = tr[0].connection_id ? Number(tr[0].connection_id) : null;
    if (!connId && tr[0].source_user_id) {
      const { rows: cr } = await pool.query(
        `SELECT id FROM email_connections WHERE user_id = $1 AND is_active = true ORDER BY id DESC LIMIT 1`,
        [tr[0].source_user_id]
      );
      connId = cr[0]?.id ?? null;
    }
    const perm = connId ? await getUserPermissionOnConnection(pool, req.user.id, connId) : null;
    if (!permissionAtLeast(perm, "reply")) {
      res.status(403).json({ error: "Reply permission or higher is required to assign." });
      return;
    }
    const { rows } = await pool.query(
      `UPDATE tickets SET assigned_to = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [userId, id]
    );
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
    const allowed = await getAllowedConnectionIds(pool, uid);
    if (!allowed.length) {
      res.json({
        totalOpen: 0,
        unread: 0,
        assignedToMe: 0,
        unassigned: 0,
        starred: 0,
        byCategory: {},
        byAssignee: [],
      });
      return;
    }
    const connFilter1 = `(t.connection_id IS NULL OR t.connection_id = ANY($1::int[]))`;
    const open = `t.status IN ('open','in_progress','waiting')`;
    const { rows: openRows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM tickets t WHERE ${open} AND ${connFilter1}`,
      [allowed]
    );
    const { rows: unreadRows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM tickets t WHERE is_read = false AND ${open} AND ${connFilter1}`,
      [allowed]
    );
    const connFilter2 = `(t.connection_id IS NULL OR t.connection_id = ANY($2::int[]))`;
    const { rows: meRows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM tickets t WHERE assigned_to = $1 AND ${open} AND ${connFilter2}`,
      [uid, allowed]
    );
    const { rows: unassignedRows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM tickets t WHERE assigned_to IS NULL AND ${open} AND ${connFilter1}`,
      [allowed]
    );
    const { rows: starredRows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM tickets t WHERE is_starred = true AND ${connFilter1}`,
      [allowed]
    );
    const { rows: catRows } = await pool.query(
      `SELECT t.category, COUNT(*)::int AS c FROM tickets t WHERE ${open} AND ${connFilter1} GROUP BY t.category`,
      [allowed]
    );
    const { rows: asgRows } = await pool.query(
      `SELECT u.display_name AS name, u.id, COUNT(t.id)::int AS c
       FROM users u
       LEFT JOIN tickets t ON t.assigned_to = u.id AND t.status IN ('open','in_progress','waiting')
         AND (t.connection_id IS NULL OR t.connection_id = ANY($1::int[]))
       GROUP BY u.id, u.display_name`,
      [allowed]
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

export async function postInboxTicketAiDraft(req, res) {
  try {
    const id = Number(req.params.id);
    const { draft, contextUsed } = await runAiDraftForTicket(id, req.user.id);
    res.json({ draft, contextUsed });
  } catch (e) {
    if (e.code === "NOT_FOUND") {
      res.status(404).json({ error: "Not found." });
      return;
    }
    if (e.code === "NO_AI_KEY") {
      res.status(503).json({ error: e.message });
      return;
    }
    console.error(e);
    res.status(500).json({ error: e.message || "Could not generate draft." });
  }
}

export async function getInboxTicketSla(req, res) {
  try {
    const id = Number(req.params.id);
    const pool = getPool();
    const { rows } = await pool.query(`SELECT * FROM tickets WHERE id = $1`, [id]);
    if (!rows.length) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    if (!(await userCanViewTicket(pool, req.user.id, rows[0]))) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    const receivedAt = rows[0].received_at ? new Date(rows[0].received_at) : null;
    const ticketId = rows[0].id;
    const { rows: fr } = await pool.query(
      `SELECT MIN(created_at) AS first_at FROM ticket_responses WHERE ticket_id = $1 AND response_type = 'reply'`,
      [ticketId]
    );
    const firstReplyAt = fr[0]?.first_at ? new Date(fr[0].first_at) : null;
    const now = Date.now();
    const hoursOpen = receivedAt ? (now - receivedAt.getTime()) / (1000 * 60 * 60) : null;
    let hoursToFirstResponse = null;
    if (receivedAt && firstReplyAt) {
      hoursToFirstResponse = (firstReplyAt.getTime() - receivedAt.getTime()) / (1000 * 60 * 60);
    }
    const slaTarget = 24;
    const isOverdue = Boolean(receivedAt && !firstReplyAt && hoursOpen != null && hoursOpen > slaTarget);
    res.json({
      hoursOpen: hoursOpen != null ? Math.round(hoursOpen * 10) / 10 : null,
      hoursToFirstResponse: hoursToFirstResponse != null ? Math.round(hoursToFirstResponse * 10) / 10 : null,
      isOverdue,
      slaTarget,
      receivedAt: receivedAt ? receivedAt.toISOString() : null,
      firstResponseAt: firstReplyAt ? firstReplyAt.toISOString() : null,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load SLA." });
  }
}

export async function postInboxAiDraftBatch(req, res) {
  try {
    const raw = req.body?.ticketIds;
    if (!Array.isArray(raw)) {
      res.status(400).json({ error: "ticketIds array is required." });
      return;
    }
    const ticketIds = [...new Set(raw.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))].slice(0, 10);
    if (!ticketIds.length) {
      res.status(400).json({ error: "No valid ticket ids." });
      return;
    }
    const results = [];
    for (const ticketId of ticketIds) {
      try {
        const { draft, contextUsed } = await runAiDraftForTicket(ticketId, req.user.id);
        results.push({ ticketId, draft, contextUsed });
      } catch (e) {
        results.push({
          ticketId,
          error: e.code === "NOT_FOUND" ? "Not found." : e.message || "Draft failed",
        });
      }
    }
    res.json({ results });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Batch draft failed." });
  }
}

export async function deleteInboxTicketAiDraft(req, res) {
  try {
    const id = Number(req.params.id);
    const pool = getPool();
    const { rowCount } = await pool.query(`DELETE FROM ticket_ai_drafts WHERE ticket_id = $1 AND used_at IS NULL`, [id]);
    if (!rowCount) {
      res.status(404).json({ error: "No active draft." });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not dismiss draft." });
  }
}

function normalizeInboxPermission(p) {
  if (p === "read" || p === "reply" || p === "admin") return p;
  return null;
}

export async function putInboxConnection(req, res) {
  try {
    const id = Number(req.params.id);
    const pool = getPool();
    await assertInboxAdminOnConnection(pool, req.user.id, id);
    const rawName = typeof req.body?.displayName === "string" ? req.body.displayName.trim().slice(0, 255) : "";
    const displayName = rawName.length ? rawName : null;
    const { rows } = await pool.query(
      `UPDATE email_connections SET display_name = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [displayName, id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    res.json({ connection: rows[0] });
  } catch (e) {
    if (e.code === "FORBIDDEN") {
      res.status(403).json({ error: e.message });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Could not update connection." });
  }
}

export async function getInboxConnectionPermissions(req, res) {
  try {
    const id = Number(req.params.id);
    const pool = getPool();
    await assertInboxAdminOnConnection(pool, req.user.id, id);
    const { rows } = await pool.query(
      `SELECT ip.id, ip.user_id, ip.permission, ip.created_at,
        u.username, u.display_name, u.email
       FROM inbox_permissions ip
       JOIN users u ON u.id = ip.user_id
       WHERE ip.connection_id = $1
       ORDER BY lower(u.display_name)`,
      [id]
    );
    res.json({ permissions: rows });
  } catch (e) {
    if (e.code === "FORBIDDEN") {
      res.status(403).json({ error: e.message });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Could not load permissions." });
  }
}

export async function postInboxConnectionPermission(req, res) {
  try {
    const id = Number(req.params.id);
    const pool = getPool();
    await assertInboxAdminOnConnection(pool, req.user.id, id);
    const userId = Number(req.body?.userId);
    const permission = normalizeInboxPermission(req.body?.permission);
    if (!Number.isFinite(userId) || userId <= 0 || !permission) {
      res.status(400).json({ error: "userId and permission (read|reply|admin) are required." });
      return;
    }
    const { rows } = await pool.query(
      `INSERT INTO inbox_permissions (connection_id, user_id, permission, granted_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (connection_id, user_id) DO UPDATE SET permission = EXCLUDED.permission, granted_by = EXCLUDED.granted_by
       RETURNING *`,
      [id, userId, permission, req.user.id]
    );
    res.json({ permission: rows[0] });
  } catch (e) {
    if (e.code === "FORBIDDEN") {
      res.status(403).json({ error: e.message });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Could not save permission." });
  }
}

export async function putInboxConnectionPermission(req, res) {
  try {
    const id = Number(req.params.id);
    const targetUserId = Number(req.params.userId);
    const pool = getPool();
    await assertInboxAdminOnConnection(pool, req.user.id, id);
    const permission = normalizeInboxPermission(req.body?.permission);
    if (!Number.isFinite(targetUserId) || targetUserId <= 0 || !permission) {
      res.status(400).json({ error: "permission (read|reply|admin) is required." });
      return;
    }
    const { rows } = await pool.query(
      `UPDATE inbox_permissions SET permission = $1, granted_by = $2
       WHERE connection_id = $3 AND user_id = $4
       RETURNING *`,
      [permission, req.user.id, id, targetUserId]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    res.json({ permission: rows[0] });
  } catch (e) {
    if (e.code === "FORBIDDEN") {
      res.status(403).json({ error: e.message });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Could not update permission." });
  }
}

export async function deleteInboxConnectionPermission(req, res) {
  try {
    const id = Number(req.params.id);
    const targetUserId = Number(req.params.userId);
    const pool = getPool();
    await assertInboxAdminOnConnection(pool, req.user.id, id);
    const { rowCount } = await pool.query(
      `DELETE FROM inbox_permissions WHERE connection_id = $1 AND user_id = $2`,
      [id, targetUserId]
    );
    if (!rowCount) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    if (e.code === "FORBIDDEN") {
      res.status(403).json({ error: e.message });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Could not remove permission." });
  }
}

export async function postInboxConnectionGrantTeam(req, res) {
  try {
    const id = Number(req.params.id);
    const pool = getPool();
    await assertInboxAdminOnConnection(pool, req.user.id, id);
    const permission = normalizeInboxPermission(req.body?.permission) || "read";
    await pool.query(
      `INSERT INTO inbox_permissions (connection_id, user_id, permission, granted_by)
       SELECT $1::int, u.id, $2::varchar, $3::int
       FROM users u
       WHERE lower(u.username) = ANY(ARRAY['mike','lori','leslie','amanda','amelia']::text[])
       ON CONFLICT (connection_id, user_id) DO NOTHING`,
      [id, permission, req.user.id]
    );
    res.json({ ok: true });
  } catch (e) {
    if (e.code === "FORBIDDEN") {
      res.status(403).json({ error: e.message });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Could not grant team access." });
  }
}
