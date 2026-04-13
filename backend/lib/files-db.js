import { getPool } from "./db.js";

function slugify(name) {
  const s = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return s.slice(0, 200) || null;
}

function vendorDisplayName(appfolioData) {
  if (!appfolioData || typeof appfolioData !== "object") return null;
  const o = appfolioData;
  const candidates = [
    o.name,
    o.company_name,
    o.vendor_name,
    o.vendor,
    o.Name,
    o.CompanyName,
    o.VendorName,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

async function insertFolder(client, row) {
  const {
    name,
    parent_folder_id = null,
    folder_type = "custom",
    linked_property_name = null,
    linked_owner_name = null,
    linked_vendor_name = null,
    icon = "📁",
    is_system = false,
    created_by = null,
  } = row;
  const slug = slugify(name);
  const { rows } = await client.query(
    `INSERT INTO file_folders (
       name, slug, parent_folder_id, folder_type,
       linked_property_name, linked_owner_name, linked_vendor_name,
       icon, created_by, is_system
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      name,
      slug,
      parent_folder_id,
      folder_type,
      linked_property_name,
      linked_owner_name,
      linked_vendor_name,
      icon,
      created_by,
      is_system,
    ]
  );
  return rows[0].id;
}

/**
 * Creates file_folders and files tables; seeds folder tree from AppFolio cache when file_folders is empty.
 */
export async function ensureFilesSchema() {
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS file_folders (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(255),
      parent_folder_id INTEGER REFERENCES file_folders(id) ON DELETE RESTRICT,
      folder_type VARCHAR(20) DEFAULT 'custom',
      linked_property_name VARCHAR(255),
      linked_owner_name VARCHAR(255),
      linked_vendor_name VARCHAR(255),
      icon VARCHAR(10) DEFAULT '📁',
      created_by INTEGER REFERENCES users(id),
      is_system BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS files (
      id SERIAL PRIMARY KEY,
      folder_id INTEGER REFERENCES file_folders(id) ON DELETE RESTRICT,
      original_filename VARCHAR(255) NOT NULL,
      stored_filename VARCHAR(255) NOT NULL,
      file_size_bytes BIGINT,
      mime_type VARCHAR(100),
      file_type VARCHAR(20) DEFAULT 'other',
      description TEXT,
      tags TEXT[] DEFAULT ARRAY[]::TEXT[],
      ai_summary TEXT,
      ai_analysis_status VARCHAR(20) DEFAULT 'none',
      uploaded_by INTEGER REFERENCES users(id),
      visibility VARCHAR(20) DEFAULT 'private',
      share_token VARCHAR(64),
      download_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await p.query(`CREATE INDEX IF NOT EXISTS files_folder_id_idx ON files (folder_id)`);
  await p.query(`CREATE INDEX IF NOT EXISTS files_uploaded_by_idx ON files (uploaded_by)`);
  await p.query(`CREATE INDEX IF NOT EXISTS files_share_token_idx ON files (share_token) WHERE share_token IS NOT NULL`);
  await p.query(`CREATE INDEX IF NOT EXISTS file_folders_parent_idx ON file_folders (parent_folder_id)`);

  const { rows: cnt } = await p.query(`SELECT COUNT(*)::int AS c FROM file_folders`);
  if (cnt[0].c > 0) return;

  const client = await p.connect();
  try {
    await client.query("BEGIN");

    const propsRootId = await insertFolder(client, {
      name: "Properties",
      folder_type: "root",
      icon: "🏠",
      is_system: true,
    });
    const ownersRootId = await insertFolder(client, {
      name: "Owners",
      folder_type: "root",
      icon: "👤",
      is_system: true,
    });
    const vendorsRootId = await insertFolder(client, {
      name: "Vendors",
      folder_type: "root",
      icon: "🔧",
      is_system: true,
    });
    const companyRootId = await insertFolder(client, {
      name: "Company",
      folder_type: "root",
      icon: "🏢",
      is_system: true,
    });
    await insertFolder(client, {
      name: "Uncategorized",
      folder_type: "root",
      icon: "📂",
      is_system: true,
    });

    const propSubTemplates = [
      "Lease Agreements",
      "Inspection Photos",
      "Insurance",
      "Maintenance Records",
      "Correspondence",
    ];
    const ownerSubTemplates = ["PMAs", "Financial Reports", "Correspondence"];
    const companySubs = ["HR", "Training", "Templates", "Marketing", "Legal", "Insurance"];

    const { rows: propRows } = await client.query(`
      SELECT DISTINCT TRIM(appfolio_data->>'property_name') AS property_name
      FROM cached_properties
      WHERE COALESCE(TRIM(appfolio_data->>'property_name'), '') <> ''
      ORDER BY 1
    `);
    for (const pr of propRows) {
      const pname = pr.property_name;
      const pid = await insertFolder(client, {
        name: pname,
        parent_folder_id: propsRootId,
        folder_type: "property",
        linked_property_name: pname,
        icon: "🏠",
        is_system: true,
      });
      for (const sub of propSubTemplates) {
        await insertFolder(client, {
          name: sub,
          parent_folder_id: pid,
          folder_type: "department",
          icon: "📁",
          is_system: true,
        });
      }
    }

    const { rows: ownerRows } = await client.query(`
      SELECT DISTINCT TRIM(appfolio_data->>'name') AS owner_name
      FROM cached_owners
      WHERE COALESCE(TRIM(appfolio_data->>'name'), '') <> ''
      ORDER BY 1
    `);
    for (const orow of ownerRows) {
      const oname = orow.owner_name;
      const oid = await insertFolder(client, {
        name: oname,
        parent_folder_id: ownersRootId,
        folder_type: "owner",
        linked_owner_name: oname,
        icon: "👤",
        is_system: true,
      });
      for (const sub of ownerSubTemplates) {
        await insertFolder(client, {
          name: sub,
          parent_folder_id: oid,
          folder_type: "department",
          icon: "📁",
          is_system: true,
        });
      }
    }

    const { rows: vendorRows } = await client.query(`SELECT appfolio_data FROM cached_vendors`);
    const seenVendors = new Set();
    for (const vr of vendorRows) {
      const vname = vendorDisplayName(vr.appfolio_data);
      if (!vname || seenVendors.has(vname)) continue;
      seenVendors.add(vname);
      await insertFolder(client, {
        name: vname,
        parent_folder_id: vendorsRootId,
        folder_type: "vendor",
        linked_vendor_name: vname,
        icon: "🔧",
        is_system: true,
      });
    }

    for (const sub of companySubs) {
      await insertFolder(client, {
        name: sub,
        parent_folder_id: companyRootId,
        folder_type: "department",
        icon: "📁",
        is_system: true,
      });
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[files] seed folders failed:", e.message || e);
    throw e;
  } finally {
    client.release();
  }
}
