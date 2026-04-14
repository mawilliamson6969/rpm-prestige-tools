/**
 * Express API — Nginx serves /api/* from the browser; paths here are without the /api prefix.
 */
import cron from "node-cron";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { fetchAppfolioUnitsJson } from "./lib/appfolio.js";
import { getOccupancy } from "./lib/dashboard-cache.js";
import { requireAdminRole, requireAuth, requireAuthOrQueryToken } from "./lib/auth.js";
import {
  ensureAnnouncementsSchema,
  ensureCachedDashboardSchema,
  ensureInboxSchema,
  ensureOwnerTerminationSchema,
  ensureUsersSchema,
  ensureAskAiSchema,
  ensureVideoFoldersTable,
  ensureVideosSchema,
  ensureWalkthruSchema,
  ensureWikiSchema,
} from "./lib/db.js";
import { ensureFilesSchema } from "./lib/files-db.js";
import { ensureMarketingSchema } from "./lib/marketing-db.js";
import { ensureEosSchema } from "./lib/eosSchema.js";
import { ensureAgentsSchema } from "./lib/agents-schema.js";
import { runEmailSyncOnce } from "./lib/inbox/email-sync.js";
import { runFullSync } from "./lib/sync-engine.js";
import {
  getMe,
  postChangePassword,
  postLogin,
} from "./routes/auth.js";
import {
  archiveAnnouncement,
  deleteAnnouncement,
  getAnnouncements,
  postAnnouncement,
  restoreAnnouncement,
  uploadAnnouncementFile,
  uploadAnnouncementMiddleware,
} from "./routes/announcements.js";
import { getAdminFormSubmissions, getAdminFormTypes } from "./routes/adminForms.js";
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
  deleteScorecardMetricPermanent,
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
  postScorecardAiAnalyze,
} from "./routes/eos.js";
import {
  deleteInboxConnection,
  deleteInboxConnectionPermission,
  deleteInboxTicketAiDraft,
  getInboxConnectionPermissions,
  getInboxConnections,
  getInboxStats,
  getInboxSyncStatus,
  getInboxTicket,
  getInboxTicketSla,
  getInboxTickets,
  getMicrosoftCallback,
  getMicrosoftConnect,
  postInboxAiDraftBatch,
  postInboxConnectionGrantTeam,
  postInboxConnectionPermission,
  postInboxSyncTrigger,
  postInboxTicketAiDraft,
  postInboxTicketAssign,
  postInboxTicketNote,
  postInboxTicketReply,
  postMicrosoftAuthorizeUrl,
  putInboxConnection,
  putInboxConnectionPermission,
  putInboxTicket,
} from "./routes/inbox.js";
import {
  deleteVideoById,
  deleteVideoFolder,
  deleteVideoShare,
  getVideoByIdRoute,
  getVideoByShareToken,
  getVideoComments,
  getVideoFolders,
  getVideoStream,
  getVideoStreamByShareToken,
  getVideoThumbnail,
  getVideos,
  postVideoComment,
  postVideoFolder,
  postVideoShare,
  postVideoUpload,
  putVideoById,
  putVideoFolder,
  putVideoMove,
  uploadVideoMiddleware,
} from "./routes/videos.js";
import {
  deleteWikiAttachment,
  deleteWikiCategory,
  deleteWikiPage,
  getWikiAttachment,
  getWikiCategories,
  getWikiPage,
  getWikiPages,
  getWikiSearch,
  getWikiPageVersion,
  getWikiPageVersions,
  postWikiAttachment,
  postWikiCategory,
  postWikiPage,
  postWikiRestoreVersion,
  putWikiCategory,
  putWikiPage,
  putWikiPagePin,
  putWikiPageReorder,
  wikiUploadMiddleware,
} from "./routes/wiki.js";
import {
  deleteWalkthruAdminRoom,
  deleteWalkthruPublicItemPhoto,
  deleteWalkthruReport,
  getWalkthruPublic,
  getWalkthruReportById,
  getWalkthruReportPdf,
  getWalkthruReports,
  postWalkthruAdminRoom,
  postWalkthruPublicComplete,
  postWalkthruPublicItemPhoto,
  postWalkthruPublicRoom,
  postWalkthruReport,
  postWalkthruSendLink,
  putWalkthruPublicItem,
  putWalkthruReportStatus,
  uploadWalkthruPhotoMiddleware,
} from "./routes/walkthru.js";
import {
  deleteFile,
  deleteFileShare,
  deleteFolder,
  getFileById,
  getFileDownload,
  getFilePreview,
  getFileSharedDownload,
  getFileSharedMeta,
  getFilesList,
  getFilesSearch,
  getFilesStats,
  getFolderByIdRoute,
  getFoldersTree,
  postBulkDelete,
  postBulkMove,
  postBulkTag,
  postFileAnalyze,
  postFileShare,
  postFilesUpload,
  postFolder,
  putFile,
  putFolder,
  uploadFilesMiddleware,
} from "./routes/files.js";
import {
  createMarketingCampaign,
  createMarketingChannel,
  createMarketingContent,
  deleteMarketingCampaign,
  deleteMarketingChannel,
  deleteMarketingContent,
  duplicateMarketingContent,
  getMarketingContent,
  getMarketingStats,
  listMarketingCampaigns,
  listMarketingChannels,
  listMarketingContent,
  patchMarketingContentStatus,
  postMarketingAiGenerate,
  postMarketingAiIdeas,
  updateMarketingCampaign,
  updateMarketingChannel,
  updateMarketingContent,
} from "./routes/marketing.js";
import {
  deleteAgent,
  deleteAgentTraining,
  getAgentActivity,
  getAgentDetail,
  getAgentMetrics,
  getAgentPrompts,
  getAgentPromptVersion,
  getAgentQueue,
  getAgentTraining,
  getAgentsList,
  getAgentsSummary,
  getAllQueues,
  postAgent,
  postAgentRun,
  postAgentTestPrompt,
  postAgentTraining,
  postPauseAllAgents,
  postRestoreAgentPrompt,
  putActivityFeedback,
  putAgent,
  putAgentPrompt,
  putAgentStatus,
  putQueueApprove,
  putQueueEdit,
  putQueueReject,
} from "./routes/agents.js";

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
app.put("/announcements/:id/archive", requireAuth, requireAdminRole, archiveAnnouncement);
app.put("/announcements/:id/restore", requireAuth, requireAdminRole, restoreAnnouncement);
app.delete("/announcements/:id", requireAuth, requireAdminRole, deleteAnnouncement);
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

app.get("/admin/forms/submissions", requireAuth, requireAdminRole, getAdminFormSubmissions);
app.get("/admin/forms/types", requireAuth, requireAdminRole, getAdminFormTypes);

/** EOS — Entrepreneurial Operating System */
app.get("/eos/team-users", requireAuth, getEosTeamUsers);
app.get("/eos/scorecard/metrics", requireAuth, getScorecardMetrics);
app.post("/eos/scorecard/metrics", requireAuth, requireAdminRole, postScorecardMetric);
app.put("/eos/scorecard/metrics/:id", requireAuth, requireAdminRole, putScorecardMetric);
app.delete(
  "/eos/scorecard/metrics/:id/permanent",
  requireAuth,
  requireAdminRole,
  deleteScorecardMetricPermanent
);
app.delete("/eos/scorecard/metrics/:id", requireAuth, requireAdminRole, deleteScorecardMetric);
app.get("/eos/scorecard/entries", requireAuth, getScorecardEntries);
app.post("/eos/scorecard/entries", requireAuth, postScorecardEntry);
app.put("/eos/scorecard/entries/:id", requireAuth, putScorecardEntry);
app.delete("/eos/scorecard/entries/:id", requireAuth, requireAdminRole, deleteScorecardEntry);
app.get("/eos/scorecard/report", requireAuth, getScorecardReport);
app.post("/eos/scorecard/ai-analyze", requireAuth, postScorecardAiAnalyze);

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
app.put("/inbox/connections/:id", requireAuth, putInboxConnection);
app.delete("/inbox/connections/:id", requireAuth, deleteInboxConnection);
app.get("/inbox/connections/:id/permissions", requireAuth, getInboxConnectionPermissions);
app.post("/inbox/connections/:id/permissions/grant-team", requireAuth, postInboxConnectionGrantTeam);
app.post("/inbox/connections/:id/permissions", requireAuth, postInboxConnectionPermission);
app.put("/inbox/connections/:id/permissions/:userId", requireAuth, putInboxConnectionPermission);
app.delete("/inbox/connections/:id/permissions/:userId", requireAuth, deleteInboxConnectionPermission);
app.get("/inbox/tickets", requireAuth, getInboxTickets);
app.get("/inbox/tickets/:id", requireAuth, getInboxTicket);
app.put("/inbox/tickets/:id", requireAuth, putInboxTicket);
app.post("/inbox/tickets/:id/reply", requireAuth, postInboxTicketReply);
app.post("/inbox/tickets/:id/note", requireAuth, postInboxTicketNote);
app.post("/inbox/tickets/:id/assign", requireAuth, postInboxTicketAssign);
app.post("/inbox/tickets/:id/ai-draft", requireAuth, postInboxTicketAiDraft);
app.delete("/inbox/tickets/:id/ai-draft", requireAuth, deleteInboxTicketAiDraft);
app.get("/inbox/tickets/:id/sla", requireAuth, getInboxTicketSla);
app.post("/inbox/ai-draft/batch", requireAuth, requireAdminRole, postInboxAiDraftBatch);
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
app.get("/videos/folders", requireAuth, getVideoFolders);
app.post("/videos/folders", requireAuth, postVideoFolder);
app.put("/videos/folders/:id", requireAuth, putVideoFolder);
app.delete("/videos/folders/:id", requireAuth, deleteVideoFolder);
app.get("/videos", requireAuth, getVideos);
app.put("/videos/:id/move", requireAuth, putVideoMove);
app.get("/videos/:id", requireAuth, getVideoByIdRoute);
app.put("/videos/:id", requireAuth, putVideoById);
app.delete("/videos/:id", requireAuth, deleteVideoById);
app.post("/videos/:id/share", requireAuth, postVideoShare);
app.delete("/videos/:id/share", requireAuth, deleteVideoShare);
app.get("/videos/:id/stream", requireAuthOrQueryToken, getVideoStream);
app.get("/videos/:id/thumbnail", requireAuthOrQueryToken, getVideoThumbnail);
app.post("/videos/:id/comments", requireAuth, postVideoComment);
app.get("/videos/:id/comments", requireAuth, getVideoComments);
app.get("/videos/shared/:shareToken", getVideoByShareToken);
app.get("/videos/shared/:shareToken/stream", getVideoStreamByShareToken);

/** Company Wiki / SOP library */
app.get("/wiki/categories", requireAuth, getWikiCategories);
app.post("/wiki/categories", requireAuth, requireAdminRole, postWikiCategory);
app.put("/wiki/categories/:id", requireAuth, requireAdminRole, putWikiCategory);
app.delete("/wiki/categories/:id", requireAuth, requireAdminRole, deleteWikiCategory);
app.get("/wiki/search", requireAuth, getWikiSearch);
app.get("/wiki/pages/:id/versions/:versionId", requireAuth, getWikiPageVersion);
app.post("/wiki/pages/:id/versions/:versionId/restore", requireAuth, postWikiRestoreVersion);
app.get("/wiki/pages/:id/versions", requireAuth, getWikiPageVersions);
app.post("/wiki/pages/:id/attachments", requireAuth, wikiUploadMiddleware, postWikiAttachment);
app.put("/wiki/pages/:id/pin", requireAuth, requireAdminRole, putWikiPagePin);
app.put("/wiki/pages/:id/reorder", requireAuth, requireAdminRole, putWikiPageReorder);
app.get("/wiki/pages/:id", requireAuth, getWikiPage);
app.put("/wiki/pages/:id", requireAuth, putWikiPage);
app.delete("/wiki/pages/:id", requireAuth, deleteWikiPage);
app.get("/wiki/pages", requireAuth, getWikiPages);
app.post("/wiki/pages", requireAuth, postWikiPage);
app.get("/wiki/attachments/:id", requireAuth, getWikiAttachment);
app.delete("/wiki/attachments/:id", requireAuth, deleteWikiAttachment);

/** Company file manager (JWT; public share routes below) */
app.post("/files/upload", requireAuth, uploadFilesMiddleware.array("files"), postFilesUpload);
app.get("/files/stats", requireAuth, getFilesStats);
app.get("/files/folders", requireAuth, getFoldersTree);
app.get("/files/folders/:id", requireAuth, getFolderByIdRoute);
app.post("/files/folders", requireAuth, postFolder);
app.put("/files/folders/:id", requireAuth, putFolder);
app.delete("/files/folders/:id", requireAuth, deleteFolder);
app.get("/files/search", requireAuth, getFilesSearch);
app.post("/files/bulk/move", requireAuth, postBulkMove);
app.post("/files/bulk/delete", requireAuth, requireAdminRole, postBulkDelete);
app.post("/files/bulk/tag", requireAuth, postBulkTag);
app.get("/files/shared/:shareToken", getFileSharedMeta);
app.get("/files/shared/:shareToken/download", getFileSharedDownload);
app.get("/files", requireAuth, getFilesList);
app.get("/files/:id", requireAuth, getFileById);
app.get("/files/:id/download", requireAuthOrQueryToken, getFileDownload);
app.get("/files/:id/preview", requireAuthOrQueryToken, getFilePreview);
app.put("/files/:id", requireAuth, putFile);
app.delete("/files/:id", requireAuth, deleteFile);
app.post("/files/:id/share", requireAuth, postFileShare);
app.delete("/files/:id/share", requireAuth, deleteFileShare);
app.post("/files/:id/analyze", requireAuth, postFileAnalyze);

/** Tenant walk-thru reports */
app.post("/walkthru/reports", requireAuth, requireAdminRole, postWalkthruReport);
app.get("/walkthru/reports", requireAuth, getWalkthruReports);
app.get("/walkthru/reports/:id", requireAuth, getWalkthruReportById);
app.put("/walkthru/reports/:id/status", requireAuth, requireAdminRole, putWalkthruReportStatus);
app.delete("/walkthru/reports/:id", requireAuth, requireAdminRole, deleteWalkthruReport);
app.post("/walkthru/reports/:id/send-link", requireAuth, requireAdminRole, postWalkthruSendLink);
app.get("/walkthru/reports/:id/pdf", requireAuth, getWalkthruReportPdf);
app.post("/walkthru/reports/:id/rooms", requireAuth, requireAdminRole, postWalkthruAdminRoom);
app.delete("/walkthru/reports/:id/rooms/:roomId", requireAuth, requireAdminRole, deleteWalkthruAdminRoom);

app.get("/walkthru/public/:token", getWalkthruPublic);
app.put("/walkthru/public/:token/items/:itemId", putWalkthruPublicItem);
app.post(
  "/walkthru/public/:token/items/:itemId/photo",
  uploadWalkthruPhotoMiddleware,
  postWalkthruPublicItemPhoto
);
app.delete("/walkthru/public/:token/items/:itemId/photo/:photoIndex", deleteWalkthruPublicItemPhoto);
app.post("/walkthru/public/:token/rooms", postWalkthruPublicRoom);
app.post("/walkthru/public/:token/complete", postWalkthruPublicComplete);

/** Marketing content calendar */
app.get("/marketing/stats", requireAuth, getMarketingStats);
app.get("/marketing/channels", requireAuth, listMarketingChannels);
app.post("/marketing/channels", requireAuth, requireAdminRole, createMarketingChannel);
app.put("/marketing/channels/:id", requireAuth, updateMarketingChannel);
app.delete("/marketing/channels/:id", requireAuth, requireAdminRole, deleteMarketingChannel);
app.get("/marketing/campaigns", requireAuth, listMarketingCampaigns);
app.post("/marketing/campaigns", requireAuth, createMarketingCampaign);
app.put("/marketing/campaigns/:id", requireAuth, updateMarketingCampaign);
app.delete("/marketing/campaigns/:id", requireAuth, deleteMarketingCampaign);
app.post("/marketing/content/ai-generate", requireAuth, postMarketingAiGenerate);
app.post("/marketing/content/ai-ideas", requireAuth, postMarketingAiIdeas);
app.get("/marketing/content", requireAuth, listMarketingContent);
app.post("/marketing/content", requireAuth, createMarketingContent);
app.get("/marketing/content/:id", requireAuth, getMarketingContent);
app.put("/marketing/content/:id/status", requireAuth, patchMarketingContentStatus);
app.put("/marketing/content/:id", requireAuth, updateMarketingContent);
app.delete("/marketing/content/:id", requireAuth, deleteMarketingContent);
app.post("/marketing/content/:id/duplicate", requireAuth, duplicateMarketingContent);

/** AI Agent Control Center */
app.get("/agents/metrics/summary", requireAuth, getAgentsSummary);
app.get("/agents/queue/all", requireAuth, getAllQueues);
app.put("/agents/activity/:activityId/feedback", requireAuth, putActivityFeedback);
app.put("/agents/queue/:queueId/approve", requireAuth, requireAdminRole, putQueueApprove);
app.put("/agents/queue/:queueId/reject", requireAuth, requireAdminRole, putQueueReject);
app.put("/agents/queue/:queueId/edit", requireAuth, requireAdminRole, putQueueEdit);
app.post("/agents/emergency/pause-all", requireAuth, requireAdminRole, postPauseAllAgents);

app.get("/agents", requireAuth, getAgentsList);
app.post("/agents", requireAuth, requireAdminRole, postAgent);

app.get("/agents/:id/prompts/:version", requireAuth, getAgentPromptVersion);
app.post("/agents/:id/prompts/:version/restore", requireAuth, requireAdminRole, postRestoreAgentPrompt);
app.get("/agents/:id/prompts", requireAuth, getAgentPrompts);
app.put("/agents/:id/prompts", requireAuth, requireAdminRole, putAgentPrompt);
app.post("/agents/:id/test-prompt", requireAuth, postAgentTestPrompt);

app.get("/agents/:id/activity", requireAuth, getAgentActivity);
app.get("/agents/:id/training", requireAuth, getAgentTraining);
app.post("/agents/:id/training", requireAuth, requireAdminRole, postAgentTraining);
app.delete("/agents/:id/training/:exampleId", requireAuth, requireAdminRole, deleteAgentTraining);
app.get("/agents/:id/queue", requireAuth, getAgentQueue);
app.get("/agents/:id/metrics", requireAuth, getAgentMetrics);

app.put("/agents/:id/status", requireAuth, requireAdminRole, putAgentStatus);
app.post("/agents/:id/run", requireAuth, requireAdminRole, postAgentRun);
app.put("/agents/:id", requireAuth, requireAdminRole, putAgent);
app.delete("/agents/:id", requireAuth, requireAdminRole, deleteAgent);
app.get("/agents/:id", requireAuth, getAgentDetail);

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
      /** Video library: ensure folder table exists before videos.folder_id migration (see ensureVideosSchema). */
      await ensureVideoFoldersTable();
      console.log("Database schema OK (video_folders).");
      await ensureVideosSchema();
      console.log("Database schema OK (videos).");
      await ensureWikiSchema();
      console.log("Database schema OK (wiki).");
      await ensureFilesSchema();
      console.log("Database schema OK (files / file_folders).");
      await ensureWalkthruSchema();
      console.log("Database schema OK (walkthru reports).");
      await ensureMarketingSchema();
      console.log("Database schema OK (marketing).");
      await ensureAgentsSchema();
      console.log("Database schema OK (agents).");
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
