import { getPool } from "../lib/db.js";

function mapRow(r) {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    signatureHtml: r.signature_html,
    isDefault: r.is_default,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function parseId(param) {
  const n = Number(param);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

async function ensureDefaultAfterDelete(pool, userId) {
  const { rows } = await pool.query(
    `SELECT id FROM email_signatures WHERE user_id = $1 AND is_default = true LIMIT 1`,
    [userId]
  );
  if (rows.length) return;
  const { rows: first } = await pool.query(
    `SELECT id FROM email_signatures WHERE user_id = $1 ORDER BY id ASC LIMIT 1`,
    [userId]
  );
  if (!first.length) return;
  await pool.query(`UPDATE email_signatures SET is_default = true, updated_at = NOW() WHERE id = $1`, [
    first[0].id,
  ]);
}

export async function getInboxSignatures(req, res) {
  let pool;
  try {
    pool = getPool();
  } catch {
    res.status(503).json({ error: "Database is not configured." });
    return;
  }
  try {
    const { rows } = await pool.query(
      `SELECT id, user_id, name, signature_html, is_default, created_at, updated_at
       FROM email_signatures
       WHERE user_id = $1
       ORDER BY is_default DESC, lower(name) ASC`,
      [req.user.id]
    );
    res.json({ signatures: rows.map(mapRow) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load signatures." });
  }
}

export async function postInboxSignature(req, res) {
  let pool;
  try {
    pool = getPool();
  } catch {
    res.status(503).json({ error: "Database is not configured." });
    return;
  }
  try {
    const sig = await createSignature(pool, req.user.id, req.body ?? {});
    res.status(201).json({ signature: sig });
  } catch (e) {
    if (e.status === 400) {
      res.status(400).json({ error: e.message });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Could not create signature." });
  }
}

export async function putInboxSignature(req, res) {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  let pool;
  try {
    pool = getPool();
  } catch {
    res.status(503).json({ error: "Database is not configured." });
    return;
  }
  try {
    const sig = await updateSignature(pool, req.user.id, id, req.body ?? {}, false);
    res.json({ signature: sig });
  } catch (e) {
    if (e.status === 400 || e.status === 404) {
      res.status(e.status).json({ error: e.message });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Could not update signature." });
  }
}

export async function deleteInboxSignature(req, res) {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  let pool;
  try {
    pool = getPool();
  } catch {
    res.status(503).json({ error: "Database is not configured." });
    return;
  }
  try {
    const { rows } = await pool.query(
      `DELETE FROM email_signatures WHERE id = $1 AND user_id = $2 RETURNING user_id, is_default`,
      [id, req.user.id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Signature not found." });
      return;
    }
    const uid = rows[0].user_id;
    await ensureDefaultAfterDelete(pool, uid);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete signature." });
  }
}

export async function putInboxSignatureDefault(req, res) {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  let pool;
  try {
    pool = getPool();
  } catch {
    res.status(503).json({ error: "Database is not configured." });
    return;
  }
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: found } = await client.query(
        `SELECT user_id FROM email_signatures WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [id, req.user.id]
      );
      if (!found.length) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Signature not found." });
        return;
      }
      const uid = found[0].user_id;
      await client.query(`UPDATE email_signatures SET is_default = false, updated_at = NOW() WHERE user_id = $1`, [
        uid,
      ]);
      await client.query(`UPDATE email_signatures SET is_default = true, updated_at = NOW() WHERE id = $1`, [id]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    const { rows } = await pool.query(
      `SELECT id, user_id, name, signature_html, is_default, created_at, updated_at FROM email_signatures WHERE id = $1`,
      [id]
    );
    res.json({ signature: mapRow(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not set default signature." });
  }
}

async function createSignature(pool, userId, body) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const signatureHtml = typeof body.signatureHtml === "string" ? body.signatureHtml : null;
  const isDefault = body.isDefault === true;
  if (!name || name.length > 100) {
    const err = new Error("name is required (max 100 characters).");
    err.status = 400;
    throw err;
  }
  if (signatureHtml === null) {
    const err = new Error("signatureHtml is required.");
    err.status = 400;
    throw err;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (isDefault) {
      await client.query(`UPDATE email_signatures SET is_default = false, updated_at = NOW() WHERE user_id = $1`, [
        userId,
      ]);
    }
    const { rows } = await client.query(
      `INSERT INTO email_signatures (user_id, name, signature_html, is_default, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id, user_id, name, signature_html, is_default, created_at, updated_at`,
      [userId, name, signatureHtml, isDefault]
    );
    const { rows: hasAnyDefault } = await client.query(
      `SELECT 1 FROM email_signatures WHERE user_id = $1 AND is_default = true LIMIT 1`,
      [userId]
    );
    const newId = rows[0].id;
    if (!hasAnyDefault.length) {
      await client.query(`UPDATE email_signatures SET is_default = true, updated_at = NOW() WHERE id = $1`, [newId]);
    }
    await client.query("COMMIT");
    const { rows: out } = await pool.query(
      `SELECT id, user_id, name, signature_html, is_default, created_at, updated_at FROM email_signatures WHERE id = $1`,
      [newId]
    );
    return mapRow(out[0]);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function updateSignature(pool, requesterId, id, body, adminMode) {
  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  const signatureHtml = Object.prototype.hasOwnProperty.call(body ?? {}, "signatureHtml")
    ? typeof body.signatureHtml === "string"
      ? body.signatureHtml
      : null
    : undefined;
  const isDefault = Object.prototype.hasOwnProperty.call(body ?? {}, "isDefault") ? body.isDefault === true : undefined;

  if (name !== undefined && (!name || name.length > 100)) {
    const err = new Error("name must be a non-empty string (max 100 characters).");
    err.status = 400;
    throw err;
  }
  if (signatureHtml === null) {
    const err = new Error("signatureHtml must be a string.");
    err.status = 400;
    throw err;
  }
  if (name === undefined && signatureHtml === undefined && isDefault === undefined) {
    const err = new Error("Provide at least one of: name, signatureHtml, isDefault.");
    err.status = 400;
    throw err;
  }

  let q = `SELECT id, user_id FROM email_signatures WHERE id = $1`;
  const params = [id];
  if (!adminMode) {
    q += ` AND user_id = $2`;
    params.push(requesterId);
  }
  const { rows: found } = await pool.query(q, params);
  if (!found.length) {
    const err = new Error("Signature not found.");
    err.status = 404;
    throw err;
  }
  const ownerId = found[0].user_id;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (isDefault === true) {
      await client.query(`UPDATE email_signatures SET is_default = false, updated_at = NOW() WHERE user_id = $1`, [
        ownerId,
      ]);
    }
    const sets = [];
    const vals = [];
    let i = 1;
    if (name !== undefined) {
      sets.push(`name = $${i++}`);
      vals.push(name);
    }
    if (signatureHtml !== undefined) {
      sets.push(`signature_html = $${i++}`);
      vals.push(signatureHtml);
    }
    if (isDefault !== undefined) {
      sets.push(`is_default = $${i++}`);
      vals.push(isDefault);
    }
    sets.push("updated_at = NOW()");
    const idPh = i++;
    const userPh = i;
    vals.push(id, ownerId);
    await client.query(
      `UPDATE email_signatures SET ${sets.join(", ")} WHERE id = $${idPh} AND user_id = $${userPh}`,
      vals
    );
    if (isDefault === false) {
      const { rows: stillHas } = await client.query(
        `SELECT 1 FROM email_signatures WHERE user_id = $1 AND is_default = true LIMIT 1`,
        [ownerId]
      );
      if (!stillHas.length) {
        await client.query(`UPDATE email_signatures SET is_default = true, updated_at = NOW() WHERE id = $1`, [id]);
      }
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  const { rows } = await pool.query(
    `SELECT id, user_id, name, signature_html, is_default, created_at, updated_at FROM email_signatures WHERE id = $1`,
    [id]
  );
  return mapRow(rows[0]);
}

export async function getAdminSignatures(req, res) {
  const raw = req.query.userId;
  const userId = raw != null && raw !== "" ? Number(raw) : NaN;
  if (!Number.isInteger(userId) || userId < 1) {
    res.status(400).json({ error: "userId query parameter is required (positive integer)." });
    return;
  }
  let pool;
  try {
    pool = getPool();
  } catch {
    res.status(503).json({ error: "Database is not configured." });
    return;
  }
  try {
    const { rows: u } = await pool.query(`SELECT id FROM users WHERE id = $1`, [userId]);
    if (!u.length) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    const { rows } = await pool.query(
      `SELECT id, user_id, name, signature_html, is_default, created_at, updated_at
       FROM email_signatures
       WHERE user_id = $1
       ORDER BY is_default DESC, lower(name) ASC`,
      [userId]
    );
    res.json({ signatures: rows.map(mapRow) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load signatures." });
  }
}

export async function postAdminSignature(req, res) {
  const userId = typeof req.body?.userId === "number" ? req.body.userId : Number(req.body?.userId);
  if (!Number.isInteger(userId) || userId < 1) {
    res.status(400).json({ error: "userId is required (positive integer)." });
    return;
  }
  let pool;
  try {
    pool = getPool();
  } catch {
    res.status(503).json({ error: "Database is not configured." });
    return;
  }
  try {
    const { rows: u } = await pool.query(`SELECT id FROM users WHERE id = $1`, [userId]);
    if (!u.length) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    const sig = await createSignature(pool, userId, req.body ?? {});
    res.status(201).json({ signature: sig });
  } catch (e) {
    if (e.status === 400) {
      res.status(400).json({ error: e.message });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Could not create signature." });
  }
}

export async function putAdminSignature(req, res) {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  let pool;
  try {
    pool = getPool();
  } catch {
    res.status(503).json({ error: "Database is not configured." });
    return;
  }
  try {
    const sig = await updateSignature(pool, req.user.id, id, req.body ?? {}, true);
    res.json({ signature: sig });
  } catch (e) {
    if (e.status === 400 || e.status === 404) {
      res.status(e.status).json({ error: e.message });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Could not update signature." });
  }
}

export async function deleteAdminSignature(req, res) {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  let pool;
  try {
    pool = getPool();
  } catch {
    res.status(503).json({ error: "Database is not configured." });
    return;
  }
  try {
    const { rows } = await pool.query(`DELETE FROM email_signatures WHERE id = $1 RETURNING user_id`, [id]);
    if (!rows.length) {
      res.status(404).json({ error: "Signature not found." });
      return;
    }
    await ensureDefaultAfterDelete(pool, rows[0].user_id);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not delete signature." });
  }
}

export async function putAdminSignatureDefault(req, res) {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid id." });
    return;
  }
  let pool;
  try {
    pool = getPool();
  } catch {
    res.status(503).json({ error: "Database is not configured." });
    return;
  }
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: found } = await client.query(
        `SELECT user_id FROM email_signatures WHERE id = $1 FOR UPDATE`,
        [id]
      );
      if (!found.length) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Signature not found." });
        return;
      }
      const uid = found[0].user_id;
      await client.query(`UPDATE email_signatures SET is_default = false, updated_at = NOW() WHERE user_id = $1`, [
        uid,
      ]);
      await client.query(`UPDATE email_signatures SET is_default = true, updated_at = NOW() WHERE id = $1`, [id]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    const { rows } = await pool.query(
      `SELECT id, user_id, name, signature_html, is_default, created_at, updated_at FROM email_signatures WHERE id = $1`,
      [id]
    );
    res.json({ signature: mapRow(rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not set default signature." });
  }
}
