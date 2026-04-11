/**
 * Express API — Nginx serves /api/* from the browser; paths here are without the /api prefix.
 */
import cron from "node-cron";
import express from "express";
import {
  fetchAppfolioUnitsJson,
  getUnitsForResponse,
  summarizeOccupancy,
} from "./lib/appfolio.js";
import {
  ensureAnnouncementsSchema,
  ensureCachedDashboardSchema,
  ensureOwnerTerminationSchema,
} from "./lib/db.js";
import { runFullSync } from "./lib/sync-engine.js";
import {
  exportOwnerTerminationsCsv,
  listOwnerTerminations,
  patchOwnerTermination,
  postOwnerTermination,
} from "./routes/ownerTermination.js";
import { getAnnouncements, postAnnouncement } from "./routes/announcements.js";
import {
  getDashboardExecutive,
  getDashboardFinance,
  getDashboardLeasing,
  getDashboardMaintenance,
  getDashboardPortfolio,
  getSyncHistoryRoute,
  getSyncStatus,
  postSyncRun,
} from "./routes/kpiCacheRoutes.js";

const app = express();
const port = Number(process.env.PORT) || 4000;

app.use(express.json({ limit: "12mb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Api-Secret");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

function sendAppfolioError(res, err) {
  if (err.code === "APPFOLIO_CONFIG") {
    return res.status(503).json({
      error: err.message,
      code: err.code,
    });
  }
  if (err.code === "APPFOLIO_NETWORK" || err.code === "APPFOLIO_PARSE") {
    return res.status(502).json({
      error: err.message,
      code: err.code,
    });
  }
  if (err.code === "APPFOLIO_HTTP") {
    return res.status(502).json({
      error: err.message,
      code: err.code,
      status: err.status,
    });
  }
  console.error(err);
  return res.status(500).json({
    error: "Unexpected server error.",
    code: "INTERNAL",
  });
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "rpm-prestige-api" });
});

app.get("/", (_req, res) => {
  res.json({ message: "RPM Prestige API — use /health for a quick check." });
});

app.get("/appfolio/units", async (_req, res) => {
  try {
    const json = await fetchAppfolioUnitsJson();
    res.json(json);
  } catch (err) {
    sendAppfolioError(res, err);
  }
});

app.get("/announcements", getAnnouncements);
app.post("/announcements", postAnnouncement);

app.get("/dashboard/occupancy", async (_req, res) => {
  try {
    const units = await getUnitsForResponse();
    const summary = summarizeOccupancy(units);
    res.json({
      ...summary,
      refreshedAt: new Date().toISOString(),
    });
  } catch (err) {
    sendAppfolioError(res, err);
  }
});

app.post("/sync/run", postSyncRun);
app.get("/sync/status", getSyncStatus);
app.get("/sync/history", getSyncHistoryRoute);

app.get("/dashboard/executive", getDashboardExecutive);
app.get("/dashboard/leasing", getDashboardLeasing);
app.get("/dashboard/maintenance", getDashboardMaintenance);
app.get("/dashboard/finance", getDashboardFinance);
app.get("/dashboard/portfolio", getDashboardPortfolio);

app.post("/forms/owner-termination", postOwnerTermination);
app.get("/forms/owner-termination/export.csv", exportOwnerTerminationsCsv);
app.get("/forms/owner-termination", listOwnerTerminations);
app.patch("/forms/owner-termination/:id", patchOwnerTermination);

async function start() {
  if (process.env.DATABASE_URL) {
    try {
      await ensureOwnerTerminationSchema();
      console.log("Database schema OK (owner_termination_requests).");
      await ensureAnnouncementsSchema();
      console.log("Database schema OK (announcements).");
      await ensureCachedDashboardSchema();
      console.log("Database schema OK (cached dashboard / sync_log).");
    } catch (e) {
      console.error("Could not ensure database schema:", e.message);
    }
  } else {
    console.warn("DATABASE_URL not set — owner termination routes may fail.");
  }

  app.listen(port, "0.0.0.0", () => {
    console.log(`API listening on ${port}`);
  });

  if (process.env.DATABASE_URL) {
    cron.schedule("0 */4 * * *", () => {
      runFullSync("cron").catch((e) => console.error("[sync cron]", e.message || e));
    });
    console.log("Scheduled AppFolio cache sync: 0 */4 * * * (every 4 hours).");

    setTimeout(() => {
      runFullSync("startup").catch((e) => console.error("[sync startup]", e.message || e));
    }, 30_000);
  }
}

start();
