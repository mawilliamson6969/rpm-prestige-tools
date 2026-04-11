/**
 * Express API — Nginx serves /api/* from the browser; paths here are without the /api prefix.
 */
import cron from "node-cron";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import {
  fetchAppfolioUnitsJson,
  getUnitsForResponse,
  summarizeOccupancy,
} from "./lib/appfolio.js";
import { requireAdminRole, requireAuth } from "./lib/auth.js";
import {
  ensureAnnouncementsSchema,
  ensureCachedDashboardSchema,
  ensureOwnerTerminationSchema,
  ensureUsersSchema,
} from "./lib/db.js";
import { runFullSync } from "./lib/sync-engine.js";
import {
  getMe,
  postChangePassword,
  postLogin,
} from "./routes/auth.js";
import {
  getAnnouncements,
  postAnnouncement,
  uploadAnnouncementFile,
  uploadAnnouncementMiddleware,
} from "./routes/announcements.js";
import {
  exportOwnerTerminationsCsv,
  listOwnerTerminations,
  patchOwnerTermination,
  postOwnerTermination,
} from "./routes/ownerTermination.js";
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
import { createUser, deleteUser, listUsers, updateUser } from "./routes/users.js";

const app = express();
const port = Number(process.env.PORT) || 4000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use(express.json({ limit: "12mb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
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

app.post("/auth/login", postLogin);
app.get("/auth/me", requireAuth, getMe);
app.post("/auth/change-password", requireAuth, postChangePassword);

app.get("/users", requireAuth, requireAdminRole, listUsers);
app.post("/users", requireAuth, requireAdminRole, createUser);
app.put("/users/:id", requireAuth, requireAdminRole, updateUser);
app.delete("/users/:id", requireAuth, requireAdminRole, deleteUser);

app.get("/announcements", requireAuth, getAnnouncements);
app.post(
  "/announcements/upload",
  requireAuth,
  requireAdminRole,
  uploadAnnouncementMiddleware,
  uploadAnnouncementFile
);
app.post("/announcements", requireAuth, requireAdminRole, postAnnouncement);

app.get("/appfolio/units", requireAuth, async (_req, res) => {
  try {
    const json = await fetchAppfolioUnitsJson();
    res.json(json);
  } catch (err) {
    sendAppfolioError(res, err);
  }
});

app.get("/dashboard/occupancy", requireAuth, async (_req, res) => {
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

app.post("/sync/run", requireAuth, requireAdminRole, postSyncRun);
app.get("/sync/status", requireAuth, getSyncStatus);
app.get("/sync/history", requireAuth, getSyncHistoryRoute);

app.get("/dashboard/executive", requireAuth, getDashboardExecutive);
app.get("/dashboard/leasing", requireAuth, getDashboardLeasing);
app.get("/dashboard/maintenance", requireAuth, getDashboardMaintenance);
app.get("/dashboard/finance", requireAuth, getDashboardFinance);
app.get("/dashboard/portfolio", requireAuth, getDashboardPortfolio);

app.post("/forms/owner-termination", postOwnerTermination);
app.get("/forms/owner-termination/export.csv", requireAuth, requireAdminRole, exportOwnerTerminationsCsv);
app.get("/forms/owner-termination", requireAuth, requireAdminRole, listOwnerTerminations);
app.patch("/forms/owner-termination/:id", requireAuth, requireAdminRole, patchOwnerTermination);

async function start() {
  if (process.env.DATABASE_URL) {
    try {
      await ensureOwnerTerminationSchema();
      console.log("Database schema OK (owner_termination_requests).");
      await ensureAnnouncementsSchema();
      console.log("Database schema OK (announcements).");
      await ensureCachedDashboardSchema();
      console.log("Database schema OK (cached dashboard / sync_log).");
      await ensureUsersSchema();
      console.log("Database schema OK (users).");
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
