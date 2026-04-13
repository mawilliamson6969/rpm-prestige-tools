import Anthropic from "@anthropic-ai/sdk";
import { getPool } from "../lib/db.js";

const MODEL = "claude-sonnet-4-20250514";

const MARKETING_AI_SYSTEM = `You are a marketing content writer for RPM Prestige, a property management company in Houston, TX managing 217+ rental properties. A Neighborly® franchise.

Generate marketing content that is:
- Professional but approachable
- Helpful and educational (following "They Ask, You Answer" methodology)
- Focused on property management topics: rental market updates, landlord tips, tenant resources, property investment insights, Houston market news
- Includes relevant hashtags for social posts
- Appropriate length for the specified channel

Return ONLY the content text. No explanation or preamble.`;

function anthropicClient() {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    const err = new Error("ANTHROPIC_API_KEY is not set.");
    err.code = "NO_AI_KEY";
    throw err;
  }
  return new Anthropic({ apiKey: key });
}

async function claudeText(system, userMessage) {
  const client = anthropicClient();
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: userMessage }],
  });
  const block = msg.content?.[0];
  if (block?.type !== "text") return "";
  return block.text?.trim() ?? "";
}

function mapChannel(r) {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    icon: r.icon,
    color: r.color,
    isActive: r.is_active,
    createdAt: r.created_at,
  };
}

function mapCampaign(r) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    startDate: r.start_date,
    endDate: r.end_date,
    status: r.status,
    color: r.color,
    createdBy: r.created_by,
    createdAt: r.created_at,
    contentCount: r.content_count != null ? Number(r.content_count) : undefined,
  };
}

function timeToHhmm(t) {
  if (!t) return null;
  const s = String(t);
  return s.length >= 5 ? s.slice(0, 5) : s;
}

function mapContentRow(r) {
  const channel =
    r.channel_id != null
      ? {
          id: r.channel_id,
          name: r.channel_name,
          slug: r.channel_slug,
          icon: r.channel_icon,
          color: r.channel_color,
        }
      : null;
  let campaigns = [];
  if (r.campaigns_json) {
    try {
      campaigns = typeof r.campaigns_json === "string" ? JSON.parse(r.campaigns_json) : r.campaigns_json;
    } catch {
      campaigns = [];
    }
  }
  if (!Array.isArray(campaigns)) campaigns = [];
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    contentBody: r.content_body,
    channelId: r.channel_id,
    status: r.status,
    scheduledDate: r.scheduled_date,
    scheduledTime: timeToHhmm(r.scheduled_time),
    publishedAt: r.published_at,
    dueDate: r.due_date,
    assignedTo: r.assigned_to,
    assignedToName: r.assigned_display_name ?? null,
    contentType: r.content_type,
    tags: Array.isArray(r.tags) ? r.tags : [],
    attachments: Array.isArray(r.attachments) ? r.attachments : r.attachments ?? [],
    aiGenerated: r.ai_generated,
    recurring: r.recurring,
    recurringEndDate: r.recurring_end_date,
    notes: r.notes,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    channel,
    campaigns,
  };
}

const CONTENT_SELECT = `
  SELECT mc.*,
    ch.name AS channel_name, ch.slug AS channel_slug, ch.icon AS channel_icon, ch.color AS channel_color,
    u.display_name AS assigned_display_name,
    COALESCE(
      (SELECT json_agg(json_build_object('id', cp.id, 'name', cp.name, 'color', cp.color) ORDER BY cp.name)
       FROM marketing_content_campaigns m2
       JOIN marketing_campaigns cp ON cp.id = m2.campaign_id
       WHERE m2.content_id = mc.id),
      '[]'::json
    ) AS campaigns_json
  FROM marketing_content mc
  LEFT JOIN marketing_channels ch ON ch.id = mc.channel_id
  LEFT JOIN users u ON u.id = mc.assigned_to
`;

export async function listMarketingChannels(req, res) {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM marketing_channels ORDER BY lower(name)`
    );
    res.json({ channels: rows.map(mapChannel) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load channels." });
  }
}

export async function createMarketingChannel(req, res) {
  try {
    const { name, slug, icon, color } = req.body ?? {};
    if (!name || !slug) {
      res.status(400).json({ error: "name and slug are required." });
      return;
    }
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO marketing_channels (name, slug, icon, color, is_active)
       VALUES ($1, $2, COALESCE($3, '📢'), COALESCE($4, '#0098D0'), true)
       RETURNING *`,
      [String(name).slice(0, 100), String(slug).slice(0, 100), icon ?? null, color ?? null]
    );
    res.status(201).json({ channel: mapChannel(rows[0]) });
  } catch (e) {
    if (e.code === "23505") {
      res.status(409).json({ error: "Slug already exists." });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Could not create channel." });
  }
}

export async function updateMarketingChannel(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id." });
      return;
    }
    const { name, slug, icon, color, isActive } = req.body ?? {};
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE marketing_channels SET
        name = COALESCE($2, name),
        slug = COALESCE($3, slug),
        icon = COALESCE($4, icon),
        color = COALESCE($5, color),
        is_active = COALESCE($6, is_active)
      WHERE id = $1
      RETURNING *`,
      [id, name ?? null, slug ?? null, icon ?? null, color ?? null, isActive ?? null]
    );
    if (!rows[0]) {
      res.status(404).json({ error: "Channel not found." });
      return;
    }
    res.json({ channel: mapChannel(rows[0]) });
  } catch (e) {
    if (e.code === "23505") {
      res.status(409).json({ error: "Slug already exists." });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Could not update channel." });
  }
}

export async function deleteMarketingChannel(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id." });
      return;
    }
    const pool = getPool();
    const { rows: ref } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM marketing_content WHERE channel_id = $1`,
      [id]
    );
    if (ref[0].c > 0) {
      await pool.query(`UPDATE marketing_channels SET is_active = false WHERE id = $1`, [id]);
      res.json({ ok: true, softDeleted: true, message: "Channel deactivated (content still references it)." });
      return;
    }
    await pool.query(`DELETE FROM marketing_channels WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete channel." });
  }
}

function parseIdsQuery(q) {
  if (q == null) return [];
  if (Array.isArray(q)) {
    return q.flatMap((x) => parseIdsQuery(x));
  }
  const s = String(q).trim();
  if (!s) return [];
  return s
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n));
}

export async function listMarketingContent(req, res) {
  try {
    const pool = getPool();
    const {
      channelId,
      channelIds,
      status,
      assignedTo,
      startDate,
      endDate,
      campaignId,
      search,
      contentType,
      includeUndated,
    } = req.query;

    const conds = [];
    const params = [];
    let i = 1;

    const cIds = parseIdsQuery(channelIds);
    if (cIds.length) {
      conds.push(`mc.channel_id = ANY($${i}::int[])`);
      params.push(cIds);
      i++;
    } else if (channelId) {
      const cid = Number(channelId);
      if (Number.isFinite(cid)) {
        conds.push(`mc.channel_id = $${i}`);
        params.push(cid);
        i++;
      }
    }

    if (status && typeof status === "string") {
      conds.push(`mc.status = $${i}`);
      params.push(status);
      i++;
    }

    if (assignedTo) {
      const aid = Number(assignedTo);
      if (Number.isFinite(aid)) {
        conds.push(`mc.assigned_to = $${i}`);
        params.push(aid);
        i++;
      }
    }

    const undated = includeUndated === "1" || includeUndated === "true";
    if (startDate && typeof startDate === "string" && endDate && typeof endDate === "string") {
      const sd = startDate.slice(0, 10);
      const ed = endDate.slice(0, 10);
      if (undated) {
        conds.push(
          `(mc.scheduled_date IS NULL OR (mc.scheduled_date >= $${i}::date AND mc.scheduled_date <= $${i + 1}::date))`
        );
        params.push(sd, ed);
        i += 2;
      } else {
        conds.push(`mc.scheduled_date >= $${i}::date AND mc.scheduled_date <= $${i + 1}::date`);
        params.push(sd, ed);
        i += 2;
      }
    } else if (startDate && typeof startDate === "string") {
      conds.push(`(mc.scheduled_date IS NULL OR mc.scheduled_date >= $${i}::date)`);
      params.push(startDate.slice(0, 10));
      i++;
    } else if (endDate && typeof endDate === "string") {
      conds.push(`(mc.scheduled_date IS NULL OR mc.scheduled_date <= $${i}::date)`);
      params.push(endDate.slice(0, 10));
      i++;
    }

    if (campaignId) {
      const camp = Number(campaignId);
      if (Number.isFinite(camp)) {
        conds.push(
          `EXISTS (SELECT 1 FROM marketing_content_campaigns mcc WHERE mcc.content_id = mc.id AND mcc.campaign_id = $${i})`
        );
        params.push(camp);
        i++;
      }
    }

    if (contentType && typeof contentType === "string") {
      conds.push(`mc.content_type = $${i}`);
      params.push(contentType);
      i++;
    }

    if (search && typeof search === "string" && search.trim()) {
      conds.push(`(mc.title ILIKE $${i} OR mc.description ILIKE $${i} OR mc.content_body ILIKE $${i})`);
      params.push(`%${search.trim().replace(/%/g, "\\%")}%`);
      i++;
    }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `${CONTENT_SELECT} ${where} ORDER BY mc.scheduled_date NULLS LAST, mc.id DESC`,
      params
    );
    res.json({ content: rows.map(mapContentRow) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load content." });
  }
}

export async function getMarketingContent(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id." });
      return;
    }
    const pool = getPool();
    const { rows } = await pool.query(`${CONTENT_SELECT} WHERE mc.id = $1`, [id]);
    if (!rows[0]) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    res.json({ item: mapContentRow(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load content." });
  }
}

async function setContentCampaigns(client, contentId, campaignIds) {
  await client.query(`DELETE FROM marketing_content_campaigns WHERE content_id = $1`, [contentId]);
  const ids = [...new Set((campaignIds ?? []).filter((n) => Number.isFinite(Number(n))).map(Number))];
  for (const cid of ids) {
    await client.query(
      `INSERT INTO marketing_content_campaigns (content_id, campaign_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [contentId, cid]
    );
  }
}

export async function createMarketingContent(req, res) {
  const pool = getPool();
  const b = req.body ?? {};
  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (!title) {
    res.status(400).json({ error: "title is required." });
    return;
  }

  const tags = Array.isArray(b.tags)
    ? b.tags.map((t) => String(t).trim()).filter(Boolean)
    : typeof b.tags === "string"
      ? b.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

  const campaignIds = Array.isArray(b.campaignIds)
    ? b.campaignIds
    : b.campaignId != null
      ? [b.campaignId]
      : [];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const st = typeof b.status === "string" && b.status ? b.status : "idea";
    const schedTime =
      b.scheduledTime && String(b.scheduledTime).trim() ? String(b.scheduledTime).trim().slice(0, 8) : null;
    const { rows } = await client.query(
      `INSERT INTO marketing_content (
        title, description, content_body, channel_id, status,
        scheduled_date, scheduled_time, published_at, due_date,
        assigned_to, content_type, tags, attachments, ai_generated,
        recurring, recurring_end_date, notes, created_by, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6::date, $7::time, NULL, $8::date,
        $9, COALESCE($10, 'post'), $11::text[], COALESCE($12::jsonb, '[]'::jsonb), COALESCE($13, false),
        $14, $15::date, $16, $17, NOW()
      ) RETURNING *`,
      [
        title.slice(0, 255),
        b.description ?? null,
        b.contentBody ?? null,
        b.channelId != null ? Number(b.channelId) : null,
        st,
        b.scheduledDate ?? null,
        schedTime,
        b.dueDate ?? null,
        b.assignedTo != null ? Number(b.assignedTo) : null,
        b.contentType ?? null,
        tags,
        b.attachments != null ? JSON.stringify(b.attachments) : null,
        b.aiGenerated ?? false,
        b.recurring ?? null,
        b.recurringEndDate ?? null,
        b.notes ?? null,
        req.user.id,
      ]
    );
    const row = rows[0];
    if (st === "published") {
      await client.query(`UPDATE marketing_content SET published_at = NOW(), updated_at = NOW() WHERE id = $1`, [
        row.id,
      ]);
    }
    await setContentCampaigns(client, row.id, campaignIds);
    await client.query("COMMIT");
    const { rows: full } = await pool.query(`${CONTENT_SELECT} WHERE mc.id = $1`, [row.id]);
    res.status(201).json({ item: mapContentRow(full[0]) });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ error: "Could not create content." });
  } finally {
    client.release();
  }
}

export async function updateMarketingContent(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  const pool = getPool();
  const b = req.body ?? {};

  const { rows: cur } = await pool.query(`SELECT * FROM marketing_content WHERE id = $1`, [id]);
  if (!cur[0]) {
    res.status(404).json({ error: "Not found." });
    return;
  }

  const tags =
    b.tags !== undefined
      ? Array.isArray(b.tags)
        ? b.tags.map((t) => String(t).trim()).filter(Boolean)
        : typeof b.tags === "string"
          ? b.tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : cur[0].tags
      : cur[0].tags;

  const sets = [];
  const vals = [];
  let i = 1;

  if (b.title !== undefined) {
    sets.push(`title = $${i++}`);
    vals.push(String(b.title).slice(0, 255));
  }
  if (b.description !== undefined) {
    sets.push(`description = $${i++}`);
    vals.push(b.description);
  }
  if (b.contentBody !== undefined) {
    sets.push(`content_body = $${i++}`);
    vals.push(b.contentBody);
  }
  if (b.channelId !== undefined) {
    sets.push(`channel_id = $${i++}`);
    vals.push(b.channelId != null ? Number(b.channelId) : null);
  }
  if (b.status !== undefined) {
    sets.push(`status = $${i++}`);
    vals.push(b.status);
    let pub = cur[0].published_at;
    if (b.status === "published" && !pub) pub = new Date();
    sets.push(`published_at = $${i++}`);
    vals.push(pub);
  }
  if (b.scheduledDate !== undefined) {
    sets.push(`scheduled_date = $${i++}::date`);
    vals.push(b.scheduledDate || null);
  }
  if (b.scheduledTime !== undefined) {
    const t = b.scheduledTime && String(b.scheduledTime).trim() ? String(b.scheduledTime).trim().slice(0, 8) : null;
    sets.push(`scheduled_time = $${i++}::time`);
    vals.push(t);
  }
  if (b.dueDate !== undefined) {
    sets.push(`due_date = $${i++}::date`);
    vals.push(b.dueDate || null);
  }
  if (b.assignedTo !== undefined) {
    sets.push(`assigned_to = $${i++}`);
    vals.push(b.assignedTo != null ? Number(b.assignedTo) : null);
  }
  if (b.contentType !== undefined) {
    sets.push(`content_type = $${i++}`);
    vals.push(b.contentType);
  }
  if (b.tags !== undefined) {
    sets.push(`tags = $${i++}::text[]`);
    vals.push(tags);
  }
  if (b.attachments !== undefined) {
    sets.push(`attachments = $${i++}::jsonb`);
    vals.push(JSON.stringify(b.attachments ?? []));
  }
  if (b.aiGenerated !== undefined) {
    sets.push(`ai_generated = $${i++}`);
    vals.push(b.aiGenerated);
  }
  if (b.recurring !== undefined) {
    sets.push(`recurring = $${i++}`);
    vals.push(b.recurring);
  }
  if (b.recurringEndDate !== undefined) {
    sets.push(`recurring_end_date = $${i++}::date`);
    vals.push(b.recurringEndDate || null);
  }
  if (b.notes !== undefined) {
    sets.push(`notes = $${i++}`);
    vals.push(b.notes);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (sets.length) {
      vals.push(id);
      await client.query(
        `UPDATE marketing_content SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $${i}`,
        vals
      );
    } else if (b.campaignIds !== undefined || b.campaignId !== undefined) {
      await client.query(`UPDATE marketing_content SET updated_at = NOW() WHERE id = $1`, [id]);
    }
    if (b.campaignIds !== undefined || b.campaignId !== undefined) {
      const campaignIds = Array.isArray(b.campaignIds)
        ? b.campaignIds
        : b.campaignId != null
          ? [b.campaignId]
          : [];
      await setContentCampaigns(client, id, campaignIds);
    }
    await client.query("COMMIT");
    const { rows: full } = await pool.query(`${CONTENT_SELECT} WHERE mc.id = $1`, [id]);
    res.json({ item: mapContentRow(full[0]) });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ error: "Could not update content." });
  } finally {
    client.release();
  }
}

export async function patchMarketingContentStatus(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id." });
      return;
    }
    const status = req.body?.status;
    if (!status || typeof status !== "string") {
      res.status(400).json({ error: "status is required." });
      return;
    }
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE marketing_content SET
        status = $2,
        published_at = CASE WHEN $2 = 'published' AND published_at IS NULL THEN NOW() ELSE published_at END,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
      [id, status]
    );
    if (!rows[0]) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    const { rows: full } = await pool.query(`${CONTENT_SELECT} WHERE mc.id = $1`, [id]);
    res.json({ item: mapContentRow(full[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update status." });
  }
}

export async function deleteMarketingContent(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id." });
      return;
    }
    const pool = getPool();
    const { rowCount } = await pool.query(`DELETE FROM marketing_content WHERE id = $1`, [id]);
    if (!rowCount) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete content." });
  }
}

export async function duplicateMarketingContent(req, res) {
  const pool = getPool();
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: src } = await client.query(`SELECT * FROM marketing_content WHERE id = $1`, [id]);
    if (!src[0]) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Not found." });
      return;
    }
    const s = src[0];
    const { rows: ins } = await client.query(
      `INSERT INTO marketing_content (
        title, description, content_body, channel_id, status,
        scheduled_date, scheduled_time, published_at, due_date,
        assigned_to, content_type, tags, attachments, ai_generated,
        recurring, recurring_end_date, notes, created_by, updated_at
      ) VALUES (
        $1, $2, $3, $4, 'draft',
        $5, $6, NULL, $7::date,
        $8, $9, $10::text[], $11::jsonb, false,
        $12, $13::date, $14, $15, NOW()
      ) RETURNING id`,
      [
        `${String(s.title).slice(0, 240)} (Copy)`,
        s.description,
        s.content_body,
        s.channel_id,
        s.scheduled_date,
        s.scheduled_time,
        s.due_date,
        s.assigned_to,
        s.content_type,
        s.tags,
        JSON.stringify(Array.isArray(s.attachments) ? s.attachments : []),
        s.recurring,
        s.recurring_end_date,
        s.notes,
        req.user.id,
      ]
    );
    const newId = ins[0].id;
    const { rows: links } = await client.query(
      `SELECT campaign_id FROM marketing_content_campaigns WHERE content_id = $1`,
      [id]
    );
    for (const r of links) {
      await client.query(
        `INSERT INTO marketing_content_campaigns (content_id, campaign_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [newId, r.campaign_id]
      );
    }
    await client.query("COMMIT");
    const { rows: full } = await pool.query(`${CONTENT_SELECT} WHERE mc.id = $1`, [newId]);
    res.status(201).json({ item: mapContentRow(full[0]) });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ error: "Could not duplicate content." });
  } finally {
    client.release();
  }
}

export async function listMarketingCampaigns(req, res) {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT c.*,
        (SELECT COUNT(*)::int FROM marketing_content_campaigns m WHERE m.campaign_id = c.id) AS content_count
       FROM marketing_campaigns c
       ORDER BY c.start_date NULLS LAST, c.id DESC`
    );
    res.json({ campaigns: rows.map(mapCampaign) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load campaigns." });
  }
}

export async function createMarketingCampaign(req, res) {
  try {
    const b = req.body ?? {};
    if (!b.name || typeof b.name !== "string") {
      res.status(400).json({ error: "name is required." });
      return;
    }
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO marketing_campaigns (name, description, start_date, end_date, status, color, created_by)
       VALUES ($1, $2, $3::date, $4::date, COALESCE($5, 'planning'), COALESCE($6, '#0098D0'), $7)
       RETURNING *`,
      [
        String(b.name).slice(0, 255),
        b.description ?? null,
        b.startDate ?? null,
        b.endDate ?? null,
        b.status ?? null,
        b.color ?? null,
        req.user.id,
      ]
    );
    res.status(201).json({ campaign: mapCampaign({ ...rows[0], content_count: 0 }) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not create campaign." });
  }
}

export async function updateMarketingCampaign(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id." });
      return;
    }
    const b = req.body ?? {};
    const pool = getPool();
    const { rows } = await pool.query(
      `UPDATE marketing_campaigns SET
        name = COALESCE($2, name),
        description = COALESCE($3, description),
        start_date = COALESCE($4::date, start_date),
        end_date = COALESCE($5::date, end_date),
        status = COALESCE($6, status),
        color = COALESCE($7, color)
      WHERE id = $1
      RETURNING *`,
      [
        id,
        b.name !== undefined ? String(b.name).slice(0, 255) : null,
        b.description !== undefined ? b.description : null,
        b.startDate !== undefined ? b.startDate : null,
        b.endDate !== undefined ? b.endDate : null,
        b.status !== undefined ? b.status : null,
        b.color !== undefined ? b.color : null,
      ]
    );
    if (!rows[0]) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    const { rows: cnt } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM marketing_content_campaigns WHERE campaign_id = $1`,
      [id]
    );
    res.json({ campaign: mapCampaign({ ...rows[0], content_count: cnt[0].c }) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update campaign." });
  }
}

export async function deleteMarketingCampaign(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id." });
      return;
    }
    const pool = getPool();
    const { rowCount } = await pool.query(`DELETE FROM marketing_campaigns WHERE id = $1`, [id]);
    if (!rowCount) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete campaign." });
  }
}

export async function postMarketingAiGenerate(req, res) {
  try {
    const { prompt, channelId, contentType } = req.body ?? {};
    if (!prompt || typeof prompt !== "string") {
      res.status(400).json({ error: "prompt is required." });
      return;
    }
    const pool = getPool();
    let channelHint = "";
    if (channelId != null) {
      const { rows } = await pool.query(`SELECT name, slug FROM marketing_channels WHERE id = $1`, [
        Number(channelId),
      ]);
      if (rows[0]) {
        channelHint = `Channel: ${rows[0].name} (${rows[0].slug}).`;
      }
    }
    const ct = contentType && typeof contentType === "string" ? contentType : "post";
    const userMsg = `${channelHint}
Content type: ${ct}.
Topic / instructions:
${prompt.trim()}

After writing the main content, on the last line only, output a line exactly in this form (single line):
TITLE: <short catchy title for this piece>`;

    const raw = await claudeText(MARKETING_AI_SYSTEM, userMsg);
    let generatedContent = raw;
    let suggestedTitle = "";
    const titleMatch = raw.match(/\nTITLE:\s*(.+)$/i);
    if (titleMatch) {
      suggestedTitle = titleMatch[1].trim();
      generatedContent = raw.slice(0, titleMatch.index).trim();
    }
    res.json({ generatedContent, suggestedTitle });
  } catch (e) {
    if (e.code === "NO_AI_KEY") {
      res.status(503).json({ error: e.message });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "AI generation failed." });
  }
}

export async function postMarketingAiIdeas(req, res) {
  try {
    const { timeframe, channels } = req.body ?? {};
    const tf = timeframe === "month" ? "month" : "week";
    const chIds = Array.isArray(channels) ? channels.map((x) => Number(x)).filter((n) => Number.isFinite(n)) : [];
    const pool = getPool();
    let channelLines = "";
    if (chIds.length) {
      const { rows } = await pool.query(
        `SELECT id, name, slug FROM marketing_channels WHERE id = ANY($1::int[]) AND is_active = true`,
        [chIds]
      );
      channelLines = rows.map((r) => `- id ${r.id}: ${r.name} (${r.slug})`).join("\n");
    } else {
      const { rows } = await pool.query(`SELECT id, name, slug FROM marketing_channels WHERE is_active = true`);
      channelLines = rows.map((r) => `- id ${r.id}: ${r.name} (${r.slug})`).join("\n");
    }

    const jsonInstruction = `You are planning marketing for RPM Prestige (Houston property management, Neighborly franchise).
Generate between 5 and 10 distinct content ideas for the next calendar ${tf}.
Use only these channels (channelId must be one of these ids):
${channelLines || "(no channels — use channelId null)"}

Return ONLY a JSON array (no markdown fence), each object:
{"title":"string","description":"string","channelId":number|null,"contentType":"post|article|email|video|story|ad|flyer|event|guide|other","suggestedDate":"YYYY-MM-DD"}

Spread suggestedDate across the ${tf}. Property management / Houston rental focus.`;

    const raw = await claudeText(
      "You output valid JSON only. No prose before or after the JSON array.",
      jsonInstruction
    );
    let ideas;
    try {
      const cleaned = raw.replace(/^[\s`]*json\s*/i, "").replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ""));
      ideas = JSON.parse(cleaned.trim());
    } catch {
      res.status(502).json({ error: "Could not parse AI response.", raw: raw.slice(0, 500) });
      return;
    }
    if (!Array.isArray(ideas)) {
      res.status(502).json({ error: "AI did not return an array." });
      return;
    }
    const normalized = ideas
      .filter((x) => x && typeof x.title === "string")
      .map((x) => ({
        title: String(x.title).slice(0, 255),
        description: typeof x.description === "string" ? x.description : "",
        channelId: x.channelId != null && Number.isFinite(Number(x.channelId)) ? Number(x.channelId) : null,
        contentType: typeof x.contentType === "string" ? x.contentType : "post",
        suggestedDate: typeof x.suggestedDate === "string" ? x.suggestedDate.slice(0, 10) : null,
      }))
      .slice(0, 12);
    res.json({ ideas: normalized });
  } catch (e) {
    if (e.code === "NO_AI_KEY") {
      res.status(503).json({ error: e.message });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "AI ideas failed." });
  }
}

export async function getMarketingStats(req, res) {
  try {
    const pool = getPool();
    const byStatus = await pool.query(
      `SELECT status, COUNT(*)::int AS c FROM marketing_content GROUP BY status`
    );
    const byChannel = await pool.query(
      `SELECT ch.id, ch.name, ch.slug, ch.color, COUNT(mc.id)::int AS c
       FROM marketing_channels ch
       LEFT JOIN marketing_content mc ON mc.channel_id = ch.id
       GROUP BY ch.id
       ORDER BY ch.name`
    );
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const publishedMonth = await pool.query(
      `SELECT COUNT(*)::int AS c FROM marketing_content
       WHERE published_at >= $1 AND published_at < $2`,
      [monthStart, nextMonth]
    );
    const scheduledUpcoming = await pool.query(
      `SELECT COUNT(*)::int AS c FROM marketing_content
       WHERE status = 'scheduled' AND scheduled_date IS NOT NULL AND scheduled_date >= CURRENT_DATE`
    );
    const draftCount = await pool.query(
      `SELECT COUNT(*)::int AS c FROM marketing_content WHERE status = 'draft'`
    );
    const overdue = await pool.query(
      `SELECT COUNT(*)::int AS c FROM marketing_content
       WHERE due_date IS NOT NULL
         AND due_date < CURRENT_DATE
         AND status NOT IN ('published', 'archived')`
    );
    res.json({
      byStatus: Object.fromEntries(byStatus.rows.map((r) => [r.status, r.c])),
      byChannel: byChannel.rows.map((r) => ({
        channelId: r.id,
        name: r.name,
        slug: r.slug,
        color: r.color,
        count: r.c,
      })),
      publishedThisMonth: publishedMonth.rows[0].c,
      scheduledUpcoming: scheduledUpcoming.rows[0].c,
      draftCount: draftCount.rows[0].c,
      overdueCount: overdue.rows[0].c,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load stats." });
  }
}
