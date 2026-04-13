/**
 * Express API — Nginx serves /api/* from the browser; paths here are without the /api prefix.
 */
import cron from "node-cron";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { fetchAppfolioUnitsJson } from "./lib/appfolio.js";
import { getOccupancy } from "./lib/dashboard-cache.js";
import { requireAdminRole, requireAuth } from "./lib/auth.js";
import {
  ensureAnnouncementsSchema,
  ensureCachedDashboardSchema,
  ensureInboxSchema,
  ensureOwnerTerminationSchema,
  ensureUsersSchema,
  ensureAskAiSchema,
  ensureVideosSchema,
} from "./lib/db.js";
import { ensureEosSchema } from "./lib/eosSchema.js";
import { runEmailSyncOnce } from "./lib/inbox/email-sync.js";
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
  getDashboardCrm,
  getDashboardExecutive,
  getDashboardFinance,
  getDashboardLeasing,
  getDashboardMaintenance,
  getDashboardPortfolio,
  getSyncHistoryRoute,
  getSyncStatus,
  postSyncRun,
} from "./routes/kpiCacheRoutes.js";
import {
  createUser,
  deleteUser,
  listUsers,
  updateUser,
} from "./routes/users.js";
import {
  deleteAdminSignature,
  deleteInboxSignature,
  getAdminSignatures,
  getInboxSignatures,
  postAdminSignature,
  postInboxSignature,
  putAdminSignature,
  putAdminSignatureDefault,
  putInboxSignature,
  putInboxSignatureDefault,
} from "./routes/emailSignatures.js";
import { getAskHistory, postAsk } from "./routes/ask.js";
import {
  deleteL10Issue,
  deleteL10Todo,
  deleteRock,
  deleteRockMilestone,
  deleteScorecardEntry,
  deleteScorecardMetric,
  getEosTeamUsers,
  getL10Issues,
  getL10Meeting,
  getL10Meetings,
  getL10Todos,
  getRockUpdates,
  getRocks,
  getScorecardEntries,
  getScorecardMetrics,
  getScorecardReport,
  postL10Issue,
  postL10IssuesReorder,
  postL10Meeting,
  postL10Todo,
  postRock,
  postRockMilestone,
  postRockUpdate,
  postScorecardEntry,
  postScorecardMetric,
  putL10Issue,
  putL10Meeting,
  putL10MeetingRatings,
  putL10Todo,
  putRock,
  putRockMilestone,
  putScorecardEntry,
  putScorecardMetric,
} from "./routes/eos.js";
import {
  deleteInboxConnection,
  getInboxConnections,
  getInboxStats,
  getInboxSyncStatus,
  getInboxTicket,
  getInboxTickets,
  getMicrosoftCallback,
  getMicrosoftConnect,
  postInboxSyncTrigger,
  postInboxTicketAssign,
  postInboxTicketNote,
  postInboxTicketReply,
  postMicrosoftAuthorizeUrl,
  putInboxTicket,
} from "./routes/inbox.js";
import {
  deleteVideoById,
  deleteVideoShare,
  getVideoByIdRoute,
  getVideoByShareToken,
  getVideoComments,
  getVideoStream,
  getVideoStreamByShareToken,
  getVideoThumbnail,
  getVideos,
  postVideoComment,
  postVideoShare,
  postVideoUpload,
  putVideoById,
  uploadVideoMiddleware,
} from "./routes/videos.js";

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

app.get("/auth/microsoft/callback", getMicrosoftCallback);
app.get("/auth/microsoft/connect", requireAuth, getMicrosoftConnect);

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

app.get("/dashboard/occupancy", requireAuth, async (req, res) => {
  try {
    const summary = await getOccupancy(req);
    res.json({
      ...summary,
      refreshedAt: new Date().toISOString(),
    });
  } catch (err) {
    if (err?.message === "DATABASE_URL is not set") {
      res.status(503).json({ error: "Database not configured." });
      return;
    }
    console.error(err);
    res.status(500).json({ error: err?.message || "Could not load occupancy." });
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
app.get("/dashboard/crm", requireAuth, getDashboardCrm);

app.post("/forms/owner-termination", postOwnerTermination);
app.get("/forms/owner-termination/export.csv", requireAuth, requireAdminRole, exportOwnerTerminationsCsv);
app.get("/forms/owner-termination", requireAuth, requireAdminRole, listOwnerTerminations);
app.patch("/forms/owner-termination/:id", requireAuth, requireAdminRole, patchOwnerTermination);

/** EOS — Entrepreneurial Operating System */
app.get("/eos/team-users", requireAuth, getEosTeamUsers);
app.get("/eos/scorecard/metrics", requireAuth, getScorecardMetrics);
app.post("/eos/scorecard/metrics", requireAuth, requireAdminRole, postScorecardMetric);
app.put("/eos/scorecard/metrics/:id", requireAuth, requireAdminRole, putScorecardMetric);
app.delete("/eos/scorecard/metrics/:id", requireAuth, requireAdminRole, deleteScorecardMetric);
app.get("/eos/scorecard/entries", requireAuth, getScorecardEntries);
app.post("/eos/scorecard/entries", requireAuth, postScorecardEntry);
app.put("/eos/scorecard/entries/:id", requireAuth, putScorecardEntry);
app.delete("/eos/scorecard/entries/:id", requireAuth, requireAdminRole, deleteScorecardEntry);
app.get("/eos/scorecard/report", requireAuth, getScorecardReport);

app.get("/eos/rocks", requireAuth, getRocks);
app.post("/eos/rocks", requireAuth, requireAdminRole, postRock);
app.put("/eos/rocks/:id", requireAuth, putRock);
app.delete("/eos/rocks/:id", requireAuth, requireAdminRole, deleteRock);
app.post("/eos/rocks/:id/milestones", requireAuth, postRockMilestone);
app.put("/eos/rocks/:id/milestones/:milestoneId", requireAuth, putRockMilestone);
app.delete("/eos/rocks/:id/milestones/:milestoneId", requireAuth, deleteRockMilestone);
app.post("/eos/rocks/:id/updates", requireAuth, postRockUpdate);
app.get("/eos/rocks/:id/updates", requireAuth, getRockUpdates);

app.get("/eos/l10/meetings", requireAuth, getL10Meetings);
app.post("/eos/l10/meetings", requireAuth, postL10Meeting);
app.get("/eos/l10/meetings/:id", requireAuth, getL10Meeting);
app.put("/eos/l10/meetings/:id/ratings", requireAuth, putL10MeetingRatings);
app.put("/eos/l10/meetings/:id", requireAuth, putL10Meeting);
app.get("/eos/l10/todos", requireAuth, getL10Todos);
app.post("/eos/l10/todos", requireAuth, postL10Todo);
app.put("/eos/l10/todos/:id", requireAuth, putL10Todo);
app.delete("/eos/l10/todos/:id", requireAuth, deleteL10Todo);
app.post("/eos/l10/issues/reorder", requireAuth, postL10IssuesReorder);
app.get("/eos/l10/issues", requireAuth, getL10Issues);
app.post("/eos/l10/issues", requireAuth, postL10Issue);
app.put("/eos/l10/issues/:id", requireAuth, putL10Issue);
app.delete("/eos/l10/issues/:id", requireAuth, deleteL10Issue);

app.post("/ask", requireAuth, postAsk);
app.get("/ask/history", requireAuth, getAskHistory);

app.post("/inbox/microsoft/authorize-url", requireAuth, postMicrosoftAuthorizeUrl);
app.get("/inbox/connections", requireAuth, getInboxConnections);
app.delete("/inbox/connections/:id", requireAuth, deleteInboxConnection);
app.get("/inbox/tickets", requireAuth, getInboxTickets);
app.get("/inbox/tickets/:id", requireAuth, getInboxTicket);
app.put("/inbox/tickets/:id", requireAuth, putInboxTicket);
app.post("/inbox/tickets/:id/reply", requireAuth, postInboxTicketReply);
app.post("/inbox/tickets/:id/note", requireAuth, postInboxTicketNote);
app.post("/inbox/tickets/:id/assign", requireAuth, postInboxTicketAssign);
app.get("/inbox/stats", requireAuth, getInboxStats);
app.post("/inbox/sync/trigger", requireAuth, requireAdminRole, postInboxSyncTrigger);
app.get("/inbox/sync/status", requireAuth, getInboxSyncStatus);

app.get("/inbox/signatures", requireAuth, getInboxSignatures);
app.post("/inbox/signatures", requireAuth, postInboxSignature);
app.put("/inbox/signatures/:id/default", requireAuth, putInboxSignatureDefault);
app.put("/inbox/signatures/:id", requireAuth, putInboxSignature);
app.delete("/inbox/signatures/:id", requireAuth, deleteInboxSignature);

app.get("/admin/signatures", requireAuth, requireAdminRole, getAdminSignatures);
app.post("/admin/signatures", requireAuth, requireAdminRole, postAdminSignature);
app.put("/admin/signatures/:id/default", requireAuth, requireAdminRole, putAdminSignatureDefault);
app.put("/admin/signatures/:id", requireAuth, requireAdminRole, putAdminSignature);
app.delete("/admin/signatures/:id", requireAuth, requireAdminRole, deleteAdminSignature);

app.post("/videos/upload", requireAuth, uploadVideoMiddleware, postVideoUpload);
app.get("/videos", requireAuth, getVideos);
app.get("/videos/:id", requireAuth, getVideoByIdRoute);
app.put("/videos/:id", requireAuth, putVideoById);
app.delete("/videos/:id", requireAuth, deleteVideoById);
app.post("/videos/:id/share", requireAuth, postVideoShare);
app.delete("/videos/:id/share", requireAuth, deleteVideoShare);
app.get("/videos/:id/stream", requireAuth, getVideoStream);
app.get("/videos/:id/thumbnail", requireAuth, getVideoThumbnail);
app.post("/videos/:id/comments", requireAuth, postVideoComment);
app.get("/videos/:id/comments", requireAuth, getVideoComments);
app.get("/videos/shared/:shareToken", getVideoByShareToken);
app.get("/videos/shared/:shareToken/stream", getVideoStreamByShareToken);

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
      await ensureEosSchema();
      console.log("Database schema OK (EOS).");
      await ensureAskAiSchema();
      console.log("Database schema OK (ask_ai_history).");
      await ensureInboxSchema();
      console.log("Database schema OK (inbox / tickets).");
      await ensureVideosSchema();
      console.log("Database schema OK (videos).");
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

    cron.schedule("*/2 * * * *", () => {
      runEmailSyncOnce().catch((e) => console.error("[inbox sync cron]", e.message || e));
    });
    console.log("Scheduled inbox email sync: */2 * * * * (every 2 minutes).");
  }
}

start();
