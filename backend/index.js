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
  ensurePlaybookSchema,
  ensureMaintenanceDashboardSchema,
} from "./lib/db.js";
import { ensureFilesSchema } from "./lib/files-db.js";
import { ensureMarketingSchema } from "./lib/marketing-db.js";
import { ensureEosSchema, ensureIndividualScorecardSchema, ensurePortfolioSnapshotsSchema } from "./lib/eosSchema.js";
import { ensureOperationsSchema } from "./lib/operationsSchema.js";
import { getExecutiveDashboardV2, takePortfolioSnapshot } from "./routes/executive-dashboard.js";
import { getMaintenanceDashboardV2, getTechnicianConfig, putTechnicianConfig } from "./routes/maintenance-dashboard.js";
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
  getIndividualScorecards,
  getIndividualScorecard,
  postIndividualScorecard,
  putIndividualScorecard,
  deleteIndividualScorecard,
  postDuplicateScorecard,
  getTemplates,
  getIndividualScorecardMetrics,
  postIndividualScorecardMetric,
  putIndividualScorecardMetric,
  deleteIndividualScorecardMetric,
  deleteIndividualScorecardMetricPermanent,
  putIndividualScorecardEntry,
  getIndividualScorecardReport,
  postIndividualScorecardAiAnalyze,
} from "./routes/individual-scorecards.js";
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
  deletePlaybookAttachment,
  deletePlaybookCategory,
  deletePlaybookPage,
  getPlaybookAttachment,
  getPlaybookCategories,
  getPlaybookPage,
  getPlaybookPages,
  getPlaybookSearch,
  getPlaybookPageVersion,
  getPlaybookPageVersions,
  postPlaybookAttachment,
  postPlaybookCategory,
  postPlaybookPage,
  postPlaybookRestoreVersion,
  putPlaybookCategory,
  putPlaybookPage,
  putPlaybookPagePin,
  putPlaybookPageReorder,
  playbookUploadMiddleware,
} from "./routes/playbooks.js";
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
  deleteTemplate,
  deleteTemplateStep,
  getTemplate,
  getTemplateSteps,
  getTemplates as getProcessTemplates,
  postTemplate,
  postTemplateDuplicate,
  postTemplateStep,
  postTemplateStepTestAutomation,
  putTemplate,
  putTemplateStep,
  putTemplateStepsReorder,
} from "./routes/processTemplates.js";
import {
  deleteProcess,
  getProcess,
  getProcesses,
  getProcessesDashboard,
  getProcessStepActivity,
  postProcess,
  postProcessStepAutomationRetry,
  postProcessStepComment,
  putProcess,
  putProcessStatus,
  putProcessStep,
  putProcessStepComplete,
  putProcessStepSkip,
} from "./routes/processes.js";
import { processDelayedAutoCompletes } from "./lib/process-automation.js";
import {
  getPropertyContextById,
  getPropertyContextByName,
  getPropertySearch,
} from "./routes/property-context.js";
import {
  deleteTemplateCondition,
  deleteTemplateStage,
  getProcessConditionLog,
  getTemplateConditions,
  getTemplateStages,
  postTemplateCondition,
  postTemplateStage,
  putTemplateCondition,
  putTemplateStage,
  putTemplateStagesReorder,
  putTemplateStepMoveToStage,
} from "./routes/processStages.js";
import {
  deleteTaskDependency,
  getSubtasks,
  getTaskDependencies,
  postTaskDependency,
} from "./routes/taskDependencies.js";
import { runTimeBasedConditions } from "./lib/condition-engine.js";
import {
  customFieldUploadMiddleware,
  deleteFieldDefinition,
  deleteFieldValue,
  getFieldDefinitions,
  getFieldValues,
  postFieldDefinition,
  postFieldUpload,
  putFieldDefinition,
  putFieldDefinitionsReorder,
  putFieldValue,
  putFieldValuesBulk,
} from "./routes/customFields.js";
import {
  deleteTask,
  getMyTasks,
  getTask,
  getTasks,
  getTasksDashboard,
  postTask,
  postTaskComment,
  putTask,
  putTaskComplete,
} from "./routes/tasks.js";
import {
  deleteProject,
  deleteProjectMember,
  deleteProjectMilestone,
  deleteProjectNote,
  getProject,
  getProjectMembers,
  getProjectMilestones,
  getProjectNotes,
  getProjects,
  getProjectsDashboard,
  postProject,
  postProjectMember,
  postProjectMilestone,
  postProjectNote,
  putProject,
  putProjectMilestone,
  putProjectMilestoneComplete,
  putProjectMilestonesReorder,
  putProjectNote,
  putProjectNotePin,
  putProjectStatus,
} from "./routes/projects.js";
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
app.get("/dashboard/executive-v2", requireAuth, getExecutiveDashboardV2);
app.get("/dashboard/maintenance-v2", requireAuth, getMaintenanceDashboardV2);
app.get("/admin/technician-config", requireAuth, getTechnicianConfig);
app.put("/admin/technician-config/:id", requireAuth, requireAdminRole, putTechnicianConfig);
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

/** Individual scorecards */
app.get("/eos/individual-scorecards/templates", requireAuth, getTemplates);
app.get("/eos/individual-scorecards", requireAuth, getIndividualScorecards);
app.post("/eos/individual-scorecards", requireAuth, requireAdminRole, postIndividualScorecard);
app.get("/eos/individual-scorecards/:id/report", requireAuth, getIndividualScorecardReport);
app.get("/eos/individual-scorecards/:id/metrics", requireAuth, getIndividualScorecardMetrics);
app.post("/eos/individual-scorecards/:id/metrics", requireAuth, requireAdminRole, postIndividualScorecardMetric);
app.post("/eos/individual-scorecards/:id/duplicate", requireAuth, requireAdminRole, postDuplicateScorecard);
app.post("/eos/individual-scorecards/:id/ai-analyze", requireAuth, postIndividualScorecardAiAnalyze);
app.get("/eos/individual-scorecards/:id", requireAuth, getIndividualScorecard);
app.put("/eos/individual-scorecards/:id", requireAuth, requireAdminRole, putIndividualScorecard);
app.delete("/eos/individual-scorecards/:id", requireAuth, requireAdminRole, deleteIndividualScorecard);
app.put("/eos/individual-scorecard-metrics/:metricId", requireAuth, requireAdminRole, putIndividualScorecardMetric);
app.delete("/eos/individual-scorecard-metrics/:metricId/permanent", requireAuth, requireAdminRole, deleteIndividualScorecardMetricPermanent);
app.delete("/eos/individual-scorecard-metrics/:metricId", requireAuth, requireAdminRole, deleteIndividualScorecardMetric);
app.put("/eos/individual-scorecard-entries", requireAuth, putIndividualScorecardEntry);

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

/** Playbooks / SOPs */
app.get("/playbooks/categories", requireAuth, getPlaybookCategories);
app.post("/playbooks/categories", requireAuth, requireAdminRole, postPlaybookCategory);
app.put("/playbooks/categories/:id", requireAuth, requireAdminRole, putPlaybookCategory);
app.delete("/playbooks/categories/:id", requireAuth, requireAdminRole, deletePlaybookCategory);
app.get("/playbooks/search", requireAuth, getPlaybookSearch);
app.get("/playbooks/pages/:id/versions/:versionId", requireAuth, getPlaybookPageVersion);
app.post("/playbooks/pages/:id/versions/:versionId/restore", requireAuth, postPlaybookRestoreVersion);
app.get("/playbooks/pages/:id/versions", requireAuth, getPlaybookPageVersions);
app.post("/playbooks/pages/:id/attachments", requireAuth, playbookUploadMiddleware, postPlaybookAttachment);
app.put("/playbooks/pages/:id/pin", requireAuth, requireAdminRole, putPlaybookPagePin);
app.put("/playbooks/pages/:id/reorder", requireAuth, requireAdminRole, putPlaybookPageReorder);
app.get("/playbooks/pages/:id", requireAuth, getPlaybookPage);
app.put("/playbooks/pages/:id", requireAuth, putPlaybookPage);
app.delete("/playbooks/pages/:id", requireAuth, deletePlaybookPage);
app.get("/playbooks/pages", requireAuth, getPlaybookPages);
app.post("/playbooks/pages", requireAuth, postPlaybookPage);
app.get("/playbooks/attachments/:id", requireAuth, getPlaybookAttachment);
app.delete("/playbooks/attachments/:id", requireAuth, deletePlaybookAttachment);

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

/** Operations Hub: process templates, active processes, standalone tasks */
app.get("/processes/templates", requireAuth, getProcessTemplates);
app.post("/processes/templates", requireAuth, requireAdminRole, postTemplate);
app.get("/processes/templates/:id/steps", requireAuth, getTemplateSteps);
app.post("/processes/templates/:id/steps", requireAuth, requireAdminRole, postTemplateStep);
app.put("/processes/templates/:id/steps/reorder", requireAuth, requireAdminRole, putTemplateStepsReorder);
app.post("/processes/templates/:id/duplicate", requireAuth, requireAdminRole, postTemplateDuplicate);
app.get("/processes/templates/:id", requireAuth, getTemplate);
app.put("/processes/templates/:id", requireAuth, requireAdminRole, putTemplate);
app.delete("/processes/templates/:id", requireAuth, requireAdminRole, deleteTemplate);
app.put("/processes/template-steps/:stepId", requireAuth, requireAdminRole, putTemplateStep);
app.delete("/processes/template-steps/:stepId", requireAuth, requireAdminRole, deleteTemplateStep);
app.post(
  "/processes/template-steps/:stepId/test-automation",
  requireAuth,
  requireAdminRole,
  postTemplateStepTestAutomation
);

app.put("/processes/steps/:stepId/complete", requireAuth, putProcessStepComplete);
app.put("/processes/steps/:stepId/skip", requireAuth, putProcessStepSkip);
app.post(
  "/processes/steps/:stepId/retry-automation",
  requireAuth,
  requireAdminRole,
  postProcessStepAutomationRetry
);
app.get("/processes/steps/:stepId/activity", requireAuth, getProcessStepActivity);
app.post("/processes/steps/:stepId/comments", requireAuth, postProcessStepComment);
app.put("/processes/steps/:stepId", requireAuth, putProcessStep);

app.get("/processes/dashboard", requireAuth, getProcessesDashboard);
app.get("/processes", requireAuth, getProcesses);
app.post("/processes", requireAuth, postProcess);

/** Template stages */
app.get("/processes/templates/:id/stages", requireAuth, getTemplateStages);
app.post("/processes/templates/:id/stages", requireAuth, requireAdminRole, postTemplateStage);
app.put("/processes/templates/:id/stages/reorder", requireAuth, requireAdminRole, putTemplateStagesReorder);
app.put("/processes/template-stages/:stageId", requireAuth, requireAdminRole, putTemplateStage);
app.delete("/processes/template-stages/:stageId", requireAuth, requireAdminRole, deleteTemplateStage);
app.put(
  "/processes/template-steps/:stepId/move-to-stage",
  requireAuth,
  requireAdminRole,
  putTemplateStepMoveToStage
);

/** Template conditions */
app.get("/processes/templates/:id/conditions", requireAuth, getTemplateConditions);
app.post("/processes/templates/:id/conditions", requireAuth, requireAdminRole, postTemplateCondition);
app.put("/processes/conditions/:conditionId", requireAuth, requireAdminRole, putTemplateCondition);
app.delete("/processes/conditions/:conditionId", requireAuth, requireAdminRole, deleteTemplateCondition);
app.get("/processes/:id/condition-log", requireAuth, getProcessConditionLog);

app.get("/processes/:id", requireAuth, getProcess);
app.put("/processes/:id/status", requireAuth, putProcessStatus);
app.put("/processes/:id", requireAuth, putProcess);
app.delete("/processes/:id", requireAuth, requireAdminRole, deleteProcess);

app.get("/tasks/dashboard", requireAuth, getTasksDashboard);
app.get("/tasks/my", requireAuth, getMyTasks);
app.get("/tasks", requireAuth, getTasks);
app.post("/tasks", requireAuth, postTask);
app.get("/tasks/:id", requireAuth, getTask);
app.put("/tasks/:id/complete", requireAuth, putTaskComplete);
app.put("/tasks/:id", requireAuth, putTask);
app.delete("/tasks/:id", requireAuth, deleteTask);
app.post("/tasks/:id/comments", requireAuth, postTaskComment);
app.get("/tasks/:id/dependencies", requireAuth, getTaskDependencies);
app.post("/tasks/:id/dependencies", requireAuth, postTaskDependency);
app.delete("/tasks/:id/dependencies/:dependencyId", requireAuth, deleteTaskDependency);
app.get("/tasks/:id/subtasks", requireAuth, getSubtasks);

/** Projects — container for milestones, tasks, notes, members */
app.get("/projects/dashboard", requireAuth, getProjectsDashboard);
app.get("/projects", requireAuth, getProjects);
app.post("/projects", requireAuth, postProject);
app.get("/projects/:id/milestones", requireAuth, getProjectMilestones);
app.post("/projects/:id/milestones", requireAuth, postProjectMilestone);
app.put("/projects/:id/milestones/reorder", requireAuth, putProjectMilestonesReorder);
app.get("/projects/:id/members", requireAuth, getProjectMembers);
app.post("/projects/:id/members", requireAuth, postProjectMember);
app.delete("/projects/:id/members/:userId", requireAuth, deleteProjectMember);
app.get("/projects/:id/notes", requireAuth, getProjectNotes);
app.post("/projects/:id/notes", requireAuth, postProjectNote);
app.get(
  "/projects/:id/tasks",
  requireAuth,
  (req, _res, next) => {
    req.query.projectId = req.params.id;
    next();
  },
  getTasks
);
app.post(
  "/projects/:id/tasks",
  requireAuth,
  (req, _res, next) => {
    req.body = req.body || {};
    req.body.projectId = req.params.id;
    next();
  },
  postTask
);
app.put("/projects/:id/status", requireAuth, putProjectStatus);
app.get("/projects/:id", requireAuth, getProject);
app.put("/projects/:id", requireAuth, putProject);
app.delete("/projects/:id", requireAuth, deleteProject);
app.put("/projects/milestones/:milestoneId/complete", requireAuth, putProjectMilestoneComplete);
app.put("/projects/milestones/:milestoneId", requireAuth, putProjectMilestone);
app.delete("/projects/milestones/:milestoneId", requireAuth, deleteProjectMilestone);
app.put("/projects/notes/:noteId/pin", requireAuth, putProjectNotePin);
app.put("/projects/notes/:noteId", requireAuth, putProjectNote);
app.delete("/projects/notes/:noteId", requireAuth, deleteProjectNote);

/** Custom fields — definitions live on templates/projects/steps, values live on instances */
app.get("/custom-fields/definitions", requireAuth, getFieldDefinitions);
app.post("/custom-fields/definitions", requireAuth, requireAdminRole, postFieldDefinition);
app.put("/custom-fields/definitions/reorder", requireAuth, requireAdminRole, putFieldDefinitionsReorder);
app.put("/custom-fields/definitions/:id", requireAuth, requireAdminRole, putFieldDefinition);
app.delete("/custom-fields/definitions/:id", requireAuth, requireAdminRole, deleteFieldDefinition);
app.get("/custom-fields/values", requireAuth, getFieldValues);
app.put("/custom-fields/values/bulk", requireAuth, putFieldValuesBulk);
app.put("/custom-fields/values", requireAuth, putFieldValue);
app.delete("/custom-fields/values/:id", requireAuth, deleteFieldValue);
app.post("/custom-fields/upload", requireAuth, customFieldUploadMiddleware, postFieldUpload);

/** Property context — aggregates cached AppFolio/Boom/LeadSimple/RentEngine data */
app.get("/property-context/search", requireAuth, getPropertySearch);
app.get("/property-context/by-name/:propertyName", requireAuth, getPropertyContextByName);
app.get("/property-context/:propertyId", requireAuth, getPropertyContextById);

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
      await ensurePortfolioSnapshotsSchema();
      console.log("Database schema OK (portfolio_snapshots).");
      await ensureIndividualScorecardSchema();
      console.log("Database schema OK (individual scorecards).");
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
      await ensurePlaybookSchema();
      console.log("Database schema OK (playbooks).");
      await ensureMaintenanceDashboardSchema();
      console.log("Database schema OK (maintenance dashboard).");
      await ensureFilesSchema();
      console.log("Database schema OK (files / file_folders).");
      await ensureWalkthruSchema();
      console.log("Database schema OK (walkthru reports).");
      await ensureMarketingSchema();
      console.log("Database schema OK (marketing).");
      await ensureAgentsSchema();
      console.log("Database schema OK (agents).");
      await ensureOperationsSchema();
      console.log("Database schema OK (operations / tasks).");
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
      runFullSync("cron", { includeDaily: false }).catch((e) => console.error("[sync cron]", e.message || e));
    });
    console.log("Scheduled AppFolio cache sync: 0 */4 * * * (every 4 hours).");

    cron.schedule("0 2 * * *", () => {
      runFullSync("daily", { includeDaily: true }).catch((e) => console.error("[sync daily]", e.message || e));
    });
    console.log("Scheduled daily full sync (incl. all WOs): 0 2 * * * (2 AM).");

    setTimeout(() => {
      runFullSync("startup").catch((e) => console.error("[sync startup]", e.message || e));
    }, 30_000);

    cron.schedule("*/2 * * * *", () => {
      runEmailSyncOnce().catch((e) => console.error("[inbox sync cron]", e.message || e));
    });
    console.log("Scheduled inbox email sync: */2 * * * * (every 2 minutes).");

    cron.schedule("0 6 * * *", () => {
      takePortfolioSnapshot().catch((e) => console.error("[portfolio snapshot cron]", e.message || e));
    });
    console.log("Scheduled portfolio snapshot: 0 6 * * * (daily at 6 AM).");

    cron.schedule("0 * * * *", () => {
      processDelayedAutoCompletes().catch((e) =>
        console.error("[automation delay cron]", e.message || e)
      );
    });
    console.log("Scheduled process automation delay check: 0 * * * * (hourly).");

    cron.schedule("15 * * * *", () => {
      runTimeBasedConditions().catch((e) =>
        console.error("[condition time cron]", e.message || e)
      );
    });
    console.log("Scheduled time-based condition check: 15 * * * * (hourly, offset).");

    // Take initial snapshot on startup if none exists today
    takePortfolioSnapshot().catch((e) => console.error("[portfolio snapshot startup]", e.message || e));
  }
}

start();
