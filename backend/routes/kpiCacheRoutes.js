import {
  getCrm,
  getExecutive,
  getFinance,
  getLeasing,
  getMaintenance,
  getPortfolio,
} from "../lib/dashboard-cache.js";
import {
  getLatestSyncLog,
  getSyncHistory,
  isSyncRunning,
  startSyncInBackground,
} from "../lib/sync-engine.js";

export async function postSyncRun(req, res) {
  try {
    const { syncId } = await startSyncInBackground("manual");
    res.json({ message: "Sync started", syncId });
  } catch (e) {
    if (e.code === "SYNC_IN_PROGRESS") {
      res.status(409).json({ error: e.message || "Sync already in progress." });
      return;
    }
    console.error(e);
    res.status(500).json({ error: e?.message || "Could not start sync." });
  }
}

export async function getSyncStatus(req, res) {
  try {
    const latest = await getLatestSyncLog();
    res.json({ latest, syncInProgress: isSyncRunning() });
  } catch (e) {
    if (e?.message === "DATABASE_URL is not set") {
      res.status(503).json({ error: "Database not configured.", latest: null });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Could not load sync status." });
  }
}

export async function getSyncHistoryRoute(req, res) {
  try {
    const rows = await getSyncHistory(20);
    res.json({ history: rows });
  } catch (e) {
    if (e?.message === "DATABASE_URL is not set") {
      res.status(503).json({ error: "Database not configured.", history: [] });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Could not load sync history." });
  }
}

function dbErr(res, e) {
  if (e?.message === "DATABASE_URL is not set") {
    res.status(503).json({ error: "Database not configured." });
    return true;
  }
  return false;
}

export async function getDashboardExecutive(req, res) {
  try {
    const data = await getExecutive(req);
    res.json(data);
  } catch (e) {
    if (dbErr(res, e)) return;
    console.error(e);
    res.status(500).json({ error: e?.message || "Could not load executive dashboard." });
  }
}

export async function getDashboardLeasing(req, res) {
  try {
    const data = await getLeasing(req);
    res.json(data);
  } catch (e) {
    if (dbErr(res, e)) return;
    console.error(e);
    res.status(500).json({ error: e?.message || "Could not load leasing dashboard." });
  }
}

export async function getDashboardMaintenance(req, res) {
  try {
    const data = await getMaintenance(req);
    res.json(data);
  } catch (e) {
    if (dbErr(res, e)) return;
    console.error(e);
    res.status(500).json({ error: e?.message || "Could not load maintenance dashboard." });
  }
}

export async function getDashboardFinance(req, res) {
  try {
    const data = await getFinance(req);
    res.json(data);
  } catch (e) {
    if (dbErr(res, e)) return;
    console.error(e);
    res.status(500).json({ error: e?.message || "Could not load finance dashboard." });
  }
}

export async function getDashboardPortfolio(req, res) {
  try {
    const data = await getPortfolio(req);
    res.json(data);
  } catch (e) {
    if (dbErr(res, e)) return;
    console.error(e);
    res.status(500).json({ error: e?.message || "Could not load portfolio dashboard." });
  }
}

export async function getDashboardCrm(req, res) {
  try {
    const data = await getCrm(req);
    res.json(data);
  } catch (e) {
    if (dbErr(res, e)) return;
    console.error(e);
    res.status(500).json({ error: e?.message || "Could not load CRM dashboard." });
  }
}
