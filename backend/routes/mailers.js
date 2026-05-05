import { getPool } from "../lib/db.js";
import { sendLetter, pollTrackingStatus } from "../services/letterstream.js";

function rowToMailer(row) {
  if (!row) return null;
  return {
    id: row.id,
    documentId: row.document_id,
    letterTitle: row.letter_title,
    letterHtml: row.letter_html,
    mailType: row.mail_type,
    recipientName: row.recipient_name,
    recipientAddress: row.recipient_address,
    recipientCity: row.recipient_city,
    recipientState: row.recipient_state,
    recipientZip: row.recipient_zip,
    propertyAddress: row.property_address,
    ownerName: row.owner_name,
    tenantName: row.tenant_name,
    letterCategory: row.letter_category,
    notes: row.notes,
    senderName: row.sender_name,
    senderAddress: row.sender_address,
    senderCity: row.sender_city,
    senderState: row.sender_state,
    senderZip: row.sender_zip,
    provider: row.provider,
    providerJobId: row.provider_job_id,
    providerTrackingNumber: row.provider_tracking_number,
    providerExpectedDelivery: row.provider_expected_delivery,
    costCents: row.cost_cents,
    triggeredBy: row.triggered_by,
    triggeredFrom: row.triggered_from,
    sentBy: row.sent_by,
    status: row.status,
    sentAt: row.sent_at,
    deliveredAt: row.delivered_at,
    lastStatusCheck: row.last_status_check,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getMailers(req, res) {
  try {
    const pool = getPool();
    const {
      status, mail_type, letter_category, property_address,
      owner_name, tenant_name, from, to, search,
      page = "1", limit = "50",
    } = req.query;

    const where = [];
    const params = [];

    if (status) {
      params.push(status);
      where.push(`m.status = $${params.length}::mail_status`);
    }
    if (mail_type) {
      params.push(mail_type);
      where.push(`m.mail_type = $${params.length}::mail_type`);
    }
    if (letter_category) {
      params.push(letter_category);
      where.push(`m.letter_category = $${params.length}`);
    }
    if (property_address) {
      params.push(`%${property_address}%`);
      where.push(`m.property_address ILIKE $${params.length}`);
    }
    if (owner_name) {
      params.push(`%${owner_name}%`);
      where.push(`m.owner_name ILIKE $${params.length}`);
    }
    if (tenant_name) {
      params.push(`%${tenant_name}%`);
      where.push(`m.tenant_name ILIKE $${params.length}`);
    }
    if (from) {
      params.push(from);
      where.push(`m.created_at >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      where.push(`m.created_at <= $${params.length}`);
    }
    if (search) {
      params.push(`%${search.trim()}%`);
      const idx = params.length;
      where.push(
        `(m.letter_title ILIKE $${idx} OR m.recipient_name ILIKE $${idx} OR ` +
        `m.property_address ILIKE $${idx} OR m.owner_name ILIKE $${idx} OR m.tenant_name ILIKE $${idx})`
      );
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    params.push(limitNum);
    params.push(offset);

    const sql = `
      SELECT m.*
      FROM mailers m
      ${whereSql}
      ORDER BY m.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;

    const countSql = `SELECT COUNT(*) FROM mailers m ${whereSql}`;
    const countParams = params.slice(0, -2);

    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query(sql, params),
      pool.query(countSql, countParams),
    ]);

    res.json({
      mailers: rows.map(rowToMailer),
      total: parseInt(countRows[0].count, 10),
      page: pageNum,
      limit: limitNum,
    });
  } catch (e) {
    console.error("[mailers] list", e);
    res.status(500).json({ error: "Could not load mailers." });
  }
}

export async function getMailerById(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid id." });
  }
  try {
    const pool = getPool();
    const [{ rows }, { rows: events }] = await Promise.all([
      pool.query(`SELECT * FROM mailers WHERE id = $1`, [id]),
      pool.query(
        `SELECT * FROM mailer_events WHERE mailer_id = $1 ORDER BY event_time ASC`,
        [id]
      ),
    ]);
    if (!rows.length) return res.status(404).json({ error: "Not found." });
    res.json({ mailer: rowToMailer(rows[0]), events });
  } catch (e) {
    console.error("[mailers] get", e);
    res.status(500).json({ error: "Could not load mailer." });
  }
}

export async function postMailer(req, res) {
  try {
    const pool = getPool();
    const b = req.body ?? {};
    const user = req.user?.displayName || req.user?.username || "System";

    const required = ["letter_title", "letter_html", "recipient_name", "recipient_address", "recipient_zip"];
    for (const f of required) {
      if (!b[f] || !String(b[f]).trim()) {
        return res.status(400).json({ error: `${f} is required.` });
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO mailers (
        document_id, letter_title, letter_html, mail_type,
        recipient_name, recipient_address, recipient_city, recipient_state, recipient_zip,
        property_address, owner_name, tenant_name, letter_category, notes,
        sender_name, sender_address, sender_city, sender_state, sender_zip,
        triggered_by, triggered_from, sent_by, status
      ) VALUES (
        $1, $2, $3, $4::mail_type,
        $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19,
        $20, $21, $22, 'draft'
      ) RETURNING *`,
      [
        b.document_id || null,
        b.letter_title.trim(),
        b.letter_html,
        b.mail_type || "certified",
        b.recipient_name.trim(),
        b.recipient_address.trim(),
        b.recipient_city?.trim() || "Houston",
        b.recipient_state?.trim() || "TX",
        b.recipient_zip.trim(),
        b.property_address?.trim() || null,
        b.owner_name?.trim() || null,
        b.tenant_name?.trim() || null,
        b.letter_category?.trim() || null,
        b.notes?.trim() || null,
        b.sender_name?.trim() || "Real Property Management Prestige",
        b.sender_address?.trim() || "4811 Hwy 6 N, Suite B",
        b.sender_city?.trim() || "Houston",
        b.sender_state?.trim() || "TX",
        b.sender_zip?.trim() || "77084",
        b.triggered_by || "manual",
        b.triggered_from || null,
        user,
      ]
    );

    const mailer = rows[0];
    await pool.query(
      `INSERT INTO mailer_events (mailer_id, event_type, event_detail, created_by)
       VALUES ($1, 'created', 'Mailer draft created', $2)`,
      [mailer.id, user]
    );

    res.status(201).json({ mailer: rowToMailer(mailer) });
  } catch (e) {
    console.error("[mailers] create", e);
    res.status(500).json({ error: "Could not create mailer." });
  }
}

export async function putMailer(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid id." });
  }
  try {
    const pool = getPool();

    // Only allow editing drafts
    const { rows: existing } = await pool.query(`SELECT status FROM mailers WHERE id = $1`, [id]);
    if (!existing.length) return res.status(404).json({ error: "Not found." });
    if (existing[0].status !== "draft") {
      return res.status(409).json({ error: "Only draft mailers can be edited." });
    }

    const b = req.body ?? {};
    const sets = [];
    const params = [];

    const fields = [
      ["letter_title", "text"],
      ["letter_html", "text"],
      ["mail_type", "mail_type"],
      ["recipient_name", "text"],
      ["recipient_address", "text"],
      ["recipient_city", "text"],
      ["recipient_state", "text"],
      ["recipient_zip", "text"],
      ["property_address", "text"],
      ["owner_name", "text"],
      ["tenant_name", "text"],
      ["letter_category", "text"],
      ["notes", "text"],
      ["sender_name", "text"],
      ["sender_address", "text"],
      ["sender_city", "text"],
      ["sender_state", "text"],
      ["sender_zip", "text"],
    ];

    for (const [col, cast] of fields) {
      if (b[col] !== undefined) {
        params.push(b[col]);
        sets.push(`${col} = $${params.length}${cast !== "text" ? `::${cast}` : ""}`);
      }
    }

    if (!sets.length) return res.status(400).json({ error: "No updatable fields supplied." });

    params.push(id);
    const { rows } = await pool.query(
      `UPDATE mailers SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params
    );
    res.json({ mailer: rowToMailer(rows[0]) });
  } catch (e) {
    console.error("[mailers] update", e);
    res.status(500).json({ error: "Could not update mailer." });
  }
}

export async function deleteMailer(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid id." });
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(`SELECT status FROM mailers WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Not found." });
    if (rows[0].status !== "draft") {
      return res.status(409).json({ error: "Only draft mailers can be deleted." });
    }
    await pool.query(`DELETE FROM mailers WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error("[mailers] delete", e);
    res.status(500).json({ error: "Could not delete mailer." });
  }
}

export async function postMailerSend(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid id." });
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(`SELECT * FROM mailers WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Not found." });
    const mailer = rows[0];
    if (!["draft", "queued"].includes(mailer.status)) {
      return res.status(409).json({ error: `Cannot send a mailer with status '${mailer.status}'.` });
    }

    if (!process.env.LETTERSTREAM_API_KEY) {
      return res.status(503).json({ error: "LetterStream API key not configured.", code: "LS_NOT_CONFIGURED" });
    }

    const updated = await sendLetter(mailer);
    res.json({ mailer: rowToMailer(updated) });
  } catch (e) {
    console.error("[mailers] send", e);
    // Mark as failed
    const pool = getPool();
    await pool.query(
      `UPDATE mailers SET status = 'failed' WHERE id = $1`,
      [Number(req.params.id)]
    ).catch(() => {});
    await pool.query(
      `INSERT INTO mailer_events (mailer_id, event_type, event_detail, created_by)
       VALUES ($1, 'failed', $2, 'system')`,
      [Number(req.params.id), e.message || "Send failed"]
    ).catch(() => {});
    res.status(502).json({ error: e.message || "Failed to send mailer." });
  }
}

export async function postMailerCancel(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid id." });
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(`SELECT status FROM mailers WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Not found." });
    if (!["draft", "queued"].includes(rows[0].status)) {
      return res.status(409).json({ error: "Only draft or queued mailers can be cancelled." });
    }
    const { rows: updated } = await pool.query(
      `UPDATE mailers SET status = 'cancelled' WHERE id = $1 RETURNING *`,
      [id]
    );
    const user = req.user?.displayName || req.user?.username || "System";
    await pool.query(
      `INSERT INTO mailer_events (mailer_id, event_type, event_detail, created_by)
       VALUES ($1, 'cancelled', 'Mailer cancelled', $2)`,
      [id, user]
    );
    res.json({ mailer: rowToMailer(updated[0]) });
  } catch (e) {
    console.error("[mailers] cancel", e);
    res.status(500).json({ error: "Could not cancel mailer." });
  }
}

export async function postMailerResend(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid id." });
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query(`SELECT * FROM mailers WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Not found." });
    const src = rows[0];
    const user = req.user?.displayName || req.user?.username || "System";

    // Duplicate as a new draft
    const { rows: newRows } = await pool.query(
      `INSERT INTO mailers (
        document_id, letter_title, letter_html, mail_type,
        recipient_name, recipient_address, recipient_city, recipient_state, recipient_zip,
        property_address, owner_name, tenant_name, letter_category, notes,
        sender_name, sender_address, sender_city, sender_state, sender_zip,
        triggered_by, triggered_from, sent_by, status
      ) SELECT
        document_id, letter_title || ' (Resend)', letter_html, mail_type,
        recipient_name, recipient_address, recipient_city, recipient_state, recipient_zip,
        property_address, owner_name, tenant_name, letter_category, notes,
        sender_name, sender_address, sender_city, sender_state, sender_zip,
        'manual', $1, $2, 'draft'
      FROM mailers WHERE id = $3
      RETURNING *`,
      [`resend of #${id}`, user, id]
    );

    const newMailer = newRows[0];
    await pool.query(
      `INSERT INTO mailer_events (mailer_id, event_type, event_detail, created_by)
       VALUES ($1, 'created', $2, $3)`,
      [newMailer.id, `Resend of mailer #${id}`, user]
    );

    res.status(201).json({ mailer: rowToMailer(newMailer) });
  } catch (e) {
    console.error("[mailers] resend", e);
    res.status(500).json({ error: "Could not resend mailer." });
  }
}

export async function postMailerNote(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid id." });
  }
  const note = String(req.body?.note || "").trim();
  if (!note) return res.status(400).json({ error: "Note text is required." });

  try {
    const pool = getPool();
    const { rows: existing } = await pool.query(`SELECT id FROM mailers WHERE id = $1`, [id]);
    if (!existing.length) return res.status(404).json({ error: "Not found." });

    const user = req.user?.displayName || req.user?.username || "System";
    const { rows } = await pool.query(
      `INSERT INTO mailer_events (mailer_id, event_type, event_detail, created_by)
       VALUES ($1, 'note_added', $2, $3) RETURNING *`,
      [id, note, user]
    );
    res.status(201).json({ event: rows[0] });
  } catch (e) {
    console.error("[mailers] note", e);
    res.status(500).json({ error: "Could not add note." });
  }
}

export async function getMailerStats(req, res) {
  try {
    const pool = getPool();
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const [{ rows: totals }, { rows: byType }, { rows: byCategory }, { rows: recent }] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status NOT IN ('draft','cancelled')) AS total_sent,
          COUNT(*) FILTER (WHERE status = 'delivered') AS delivered,
          COUNT(*) FILTER (WHERE status IN ('sent','in_transit','out_for_delivery')) AS in_transit,
          COUNT(*) FILTER (WHERE status IN ('failed','returned','attempted')) AS failed_returned,
          SUM(cost_cents) FILTER (WHERE sent_at >= $1 AND status NOT IN ('draft','cancelled')) AS cost_this_month,
          SUM(cost_cents) FILTER (WHERE status NOT IN ('draft','cancelled')) AS cost_all_time
        FROM mailers
      `, [startOfMonth]),

      pool.query(`
        SELECT mail_type, COUNT(*) AS count, SUM(cost_cents) AS total_cost
        FROM mailers
        WHERE status NOT IN ('draft', 'cancelled')
        GROUP BY mail_type
      `),

      pool.query(`
        SELECT letter_category, COUNT(*) AS count
        FROM mailers
        WHERE status NOT IN ('draft', 'cancelled') AND letter_category IS NOT NULL
        GROUP BY letter_category
      `),

      pool.query(`
        SELECT me.*, m.letter_title, m.recipient_name
        FROM mailer_events me
        JOIN mailers m ON m.id = me.mailer_id
        ORDER BY me.event_time DESC
        LIMIT 10
      `),
    ]);

    const t = totals[0];
    res.json({
      totalSent: parseInt(t.total_sent, 10) || 0,
      delivered: parseInt(t.delivered, 10) || 0,
      inTransit: parseInt(t.in_transit, 10) || 0,
      failedReturned: parseInt(t.failed_returned, 10) || 0,
      totalCostThisMonth: parseInt(t.cost_this_month, 10) || 0,
      totalCostAllTime: parseInt(t.cost_all_time, 10) || 0,
      breakdownByType: byType,
      breakdownByCategory: byCategory,
      recentActivity: recent,
    });
  } catch (e) {
    console.error("[mailers] stats", e);
    res.status(500).json({ error: "Could not load stats." });
  }
}

export async function getMailerSuggestions(req, res) {
  const field = req.query.field;
  const q = String(req.query.q || "").trim();
  if (!field || !q) return res.json({ suggestions: [] });

  const allowed = ["property_address", "owner_name", "tenant_name"];
  if (!allowed.includes(field)) return res.status(400).json({ error: "Invalid field." });

  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT DISTINCT ${field} AS value FROM mailers
       WHERE ${field} ILIKE $1 AND ${field} IS NOT NULL
       ORDER BY value
       LIMIT 10`,
      [`%${q}%`]
    );
    res.json({ suggestions: rows.map((r) => r.value) });
  } catch (e) {
    console.error("[mailers] suggestions", e);
    res.status(500).json({ error: "Could not load suggestions." });
  }
}

export async function getMailerVolumeByWeek(req, res) {
  try {
    const pool = getPool();
    const { rows } = await pool.query(`
      SELECT
        DATE_TRUNC('week', sent_at) AS week,
        mail_type,
        COUNT(*) AS count
      FROM mailers
      WHERE sent_at >= NOW() - INTERVAL '8 weeks'
        AND status NOT IN ('draft', 'cancelled')
      GROUP BY week, mail_type
      ORDER BY week, mail_type
    `);
    res.json({ volume: rows });
  } catch (e) {
    console.error("[mailers] volume", e);
    res.status(500).json({ error: "Could not load volume." });
  }
}
