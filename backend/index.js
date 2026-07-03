/**
 * Express API — Nginx serves /api/* from the browser; paths here are without the /api prefix.
 */
import cron from "node-cron";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { fetchAppfolioUnitsJson } from "./lib/appfolio.js";
import { getOccupancy } from "./lib/dashboard-cache.js";
import { requireAdminRole, requireAuth, requireAuthOrQueryToken, requirePermission } from "./lib/auth.js";
import {
  ensureAnnouncementsSchema,
  ensureCachedDashboardSchema,
  ensureInboxSchema,
  ensureOwnerTerminationSchema,
  ensureUsersSchema,
  ensureAskAiSchema,
  ensureAiFailoverLogSchema,
  ensureAiTemplatesSchema,
  ensureVideoFoldersTable,
  ensureVideosSchema,
  ensureWalkthruSchema,
  ensureWikiSchema,
  ensurePlaybookSchema,
  ensureMaintenanceDashboardSchema,
  ensureDocumentsSchema,
  ensureAutomationsSchema,
} from "./lib/db.js";
import { ensureFilesSchema } from "./lib/files-db.js";
import { ensureAgentHubSchema } from "./lib/agentHubSchema.js";
import { ensureContactsSchema, ensureProcessContactsSchema } from "./lib/contactsSchema.js";
import {
  listProcessContacts,
  addProcessContact,
  removeProcessContact,
} from "./routes/processContacts.js";
import {
  listContacts,
  createContact,
  getContact,
  updateContact,
  archiveContact,
  mergeContacts,
  resyncContacts,
} from "./routes/contacts.js";
import { ensureMbUnifiedSchema } from "./lib/mbSchema.js";
import { ensureAfMirrorSchema } from "./lib/af-mirror-schema.js";
import { ensureMaintSchema } from "./lib/maint-schema.js";
import { ensureAppfolioSyncScheduled } from "./services/appfolio-db-scheduler.js";
import { receiveAppfolioDbWebhook } from "./routes/appfolio-db-webhook.js";
import { ensureAppfolioWebhookProcessing } from "./services/appfolio-webhook-processor.js";
// Phase 7 (Unification): the System B route files for boards / items /
// subitems / customization / dashboards / Phase 1 subitem templates
// are dormant — the tables they read are gone. The Phase 4 updates
// feed (mbItemDetail.js) survives and is rekeyed below to operate on
// processes. AppFolio webhook receiver (mbWebhooks.js) survives.
import { receiveAppfolioWebhook as receiveMbAppfolioWebhook } from "./routes/mbWebhooks.js";
import { receiveOpenPhoneWebhook, receiveMsGraphWebhook } from "./routes/webhooks.js";
import {
  listAutomations as listConnectAutomations,
  getAutomation as getConnectAutomation,
  createAutomation as createConnectAutomation,
  updateAutomation as updateConnectAutomation,
  deleteAutomation as deleteConnectAutomation,
  listRuns as listConnectAutomationRuns,
  getRun as getConnectAutomationRun,
  retryRunNow as retryConnectRunNow,
  testAutomation as testConnectAutomation,
  getAutomationMeta as getConnectAutomationMeta,
} from "./routes/automations.js";
import {
  listItemUpdates as listMbDetailUpdates,
  createItemUpdate as createMbDetailUpdate,
  createReply as createMbReply,
  updateOwnComment as updateMbOwnComment,
  deleteOwnComment as deleteMbOwnComment,
  addReaction as addMbReaction,
  removeReaction as removeMbReaction,
  createAttachment as createMbAttachment,
  deleteAttachment as deleteMbAttachment,
  downloadAttachment as downloadMbAttachment,
  uploadMbAttachmentMiddleware,
  markMentionsSeen as markMbMentionsSeen,
  listUnseenMentions as listMbUnseenMentions,
} from "./routes/mbItemDetail.js";
import {
  ensureAgentHubPhase2Schema,
  refreshAgentLifetimeValue,
} from "./lib/agentHubPhase2Schema.js";
import { ensureAgentHubPhase3Schema } from "./lib/agentHubPhase3Schema.js";
import { ensureAgentHubPhase4Schema } from "./lib/agentHubPhase4Schema.js";
import {
  evaluateTriggers as agentHubEvaluateTriggers,
  executeActions as agentHubExecuteActions,
  reapApprovalWindow as agentHubReapApprovalWindow,
  detectReplies as agentHubDetectReplies,
} from "./lib/agentHub/engine.js";
import {
  recomputeAllEngagementScores as agentHubRecomputeScores,
  refreshAllPredictiveFlags as agentHubRefreshFlags,
  refreshCohorts as agentHubRefreshCohorts,
  archiveAndPruneScoreHistory as agentHubArchiveScores,
} from "./lib/agentHub/intelligence/jobs.js";
import { ensureMarketingSchema } from "./lib/marketing-db.js";
import { ensureEosSchema, ensureIndividualScorecardSchema, ensurePortfolioSnapshotsSchema } from "./lib/eosSchema.js";
import { ensureOperationsSchema } from "./lib/operationsSchema.js";
import { ensureLayoutPreferencesSchema } from "./lib/layout-prefs-schema.js";
import {
  getLayoutPrefs,
  putLayoutPrefs,
  resetLayoutPrefs,
} from "./routes/userPreferences.js";
import { getWidgetData } from "./routes/widgetData.js";
import { ensureFormsSchema } from "./lib/formsSchema.js";
import { ensureFormsPhase3Schema } from "./lib/forms-phase3-schema.js";
import { ensureFormsPhase4Schema } from "./lib/forms-phase4-schema.js";
import { ensureFormTemplates } from "./lib/form-templates-seed.js";
import {
  checkFormAccess,
  deleteDocTemplate,
  deleteSubmissionNote,
  deleteSubmissionTag,
  getDistributionHistory,
  getDistributionOpen,
  getDocTemplates,
  getDocumentDownload,
  getEmbedJs,
  getFormExport,
  getFormsBadge,
  getGeneratedDocuments,
  getMyApprovals,
  getSubmissionApprovals,
  getSubmissionNotes,
  getSubmissionTags,
  getVersionById,
  getVersions,
  postDistribute,
  postDistributeBulk,
  postDocTemplate,
  postFormImport,
  postGenerateDocument,
  postRestoreVersion,
  postSubmissionNote,
  postSubmissionTag,
  putApproveSubmission,
  putAssignSubmission,
  putDocTemplate,
  putFormPublishWithVersion,
  putRejectSubmission,
  putSubmissionPriority,
  putSubmissionStar,
} from "./routes/forms-phase4.js";
import {
  getAutomationLog,
  getAutomationMeta,
  getFormAnalyticsV2,
  getFormCategories,
  getFormTemplates,
  getSubmissionPdf,
  getSubmissionsExport,
  postAutomationTest,
  postFormFromTemplate,
  postPublicAnalytics,
  postReRunAutomations,
  postSubmissionsExportPdf,
} from "./routes/forms-phase3.js";
import {
  deleteForm,
  deleteFormAutomation,
  deleteFormField,
  deleteFormPage,
  deleteFormSubmission,
  formsUploadMiddleware,
  getForm,
  getFormAnalytics,
  getFormAutomations,
  getFormFields,
  getFormPages,
  getForms,
  getFormSubmission,
  getFormSubmissions,
  getFormSubmissionsExport,
  getPublicForm,
  getPublicFormPrefill,
  postForm,
  postFormFavorite,
  postFormAutomation,
  postFormDuplicate,
  postFormField,
  postFormPage,
  postPublicFormSubmit,
  postPublicFormUpload,
  putForm,
  putFormAutomation,
  putFormField,
  putFormFieldMove,
  putFormFieldsReorder,
  putFormPage,
  putFormPagesReorder,
  putFormPublish,
  putFormSubmission,
  putFormUnpublish,
} from "./routes/forms.js";
import { getExecutiveDashboardV2, takePortfolioSnapshot } from "./routes/executive-dashboard.js";
import { getMaintenanceDashboardV2, getTechnicianConfig, putTechnicianConfig } from "./routes/maintenance-dashboard.js";
import { ensureAgentsSchema } from "./lib/agents-schema.js";
import { runEmailSyncOnce } from "./lib/inbox/email-delta-sync.js";
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
  getMyProfile,
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
  deleteTemplate as deleteAiTemplate,
  getTemplates as getAiTemplates,
  getTools as getAiTools,
  postGenerate as postAiGenerate,
  postTemplate as postAiTemplate,
  putTemplate as putAiTemplate,
} from "./routes/aiAssistant.js";
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
  putScorecardMetricsReorder,
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
  putIndividualScorecardMetricsReorder,
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
  postInboxConnectionSync,
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
  getInboxThread,
  getInboxThreadStats,
  getInboxThreads,
  patchInboxThread,
  postInboxThreadMarkRead,
  postInboxThreadReply,
  postInboxThreadSnooze,
  postInboxThreadSync,
  postInboxThreadTags,
} from "./routes/inboxThreads.js";
import {
  getInboxAnalyticsChannelMix,
  getInboxAnalyticsInboxHealth,
  getInboxAnalyticsKpis,
  getInboxAnalyticsTeamLoad,
  getInboxAnalyticsVolume,
} from "./routes/inboxAnalytics.js";
import {
  deleteInboxView,
  getInboxViewThreads,
  getInboxViews,
  patchInboxView,
  postInboxView,
} from "./routes/inboxViews.js";
import {
  deleteInboxSlaPolicy,
  getInboxSlaPolicies,
  patchInboxSlaPolicy,
  postInboxSlaPolicy,
} from "./routes/inboxSlaPolicies.js";
import {
  deleteInboxAutomationRule,
  getInboxAutomationAccuracy,
  getInboxAutomationLog,
  getInboxAutomationRules,
  getInboxAutomationStats,
  getInboxThreadAutomations,
  patchInboxAutomationRule,
  postInboxAutomationExecute,
  postInboxAutomationFeedback,
  postInboxAutomationRevert,
  postInboxAutomationRule,
} from "./routes/inboxAutomations.js";
import {
  deleteInboxThreadNote,
  getInboxThreadContext,
  postInboxThreadAiSuggestions,
  postInboxThreadNote,
} from "./routes/inboxContext.js";
import { postInboxThreadsBulk } from "./routes/inboxBulk.js";
import {
  deleteInboxCannedResponse,
  deleteInboxTagDefinition,
  getInboxCannedResponses,
  getInboxTagDefinitions,
  patchInboxCannedResponse,
  patchInboxTagDefinition,
  postInboxCannedResponse,
  postInboxCannedResponseUsed,
  postInboxTagDefinition,
} from "./routes/inboxSettings.js";
import {
  getInboxAttachmentDownload,
  getInboxAttachmentPreview,
  inboxAttachmentUpload,
  postInboxThreadFetchAttachments,
  postInboxThreadReplyWithAttachments,
} from "./routes/inboxAttachments.js";
import {
  requireAgentHubAccess,
} from "./lib/agentHub/permissions.js";
import {
  createAgentHubBrokerage,
  deleteAgentHubBrokerage,
  getAgentHubBrokerage,
  listAgentHubBrokerages,
  updateAgentHubBrokerage,
} from "./routes/agentHubBrokerages.js";
import {
  createAgentHubAgent,
  deleteAgentHubAgent,
  getAgentHubAgent,
  listAgentHubAgents,
  mergeAgentHubAgents,
  updateAgentHubAgent,
} from "./routes/agentHubAgents.js";
import {
  getAgentHubPersonalDetails,
  upsertAgentHubPersonalDetails,
} from "./routes/agentHubPersonalDetails.js";
import {
  createAgentHubActivity,
  deleteAgentHubActivity,
  downloadAgentHubAttachment,
  listAgentHubActivities,
  updateAgentHubActivity,
  uploadActivityAttachmentMiddleware,
} from "./routes/agentHubActivities.js";
import {
  addAgentHubTag,
  deleteGlobalTag,
  listGlobalTags,
  removeAgentHubTag,
  renameGlobalTag,
} from "./routes/agentHubTags.js";
import {
  createAgentHubRelationship,
  deleteAgentHubRelationship,
  listAgentHubRelationships,
} from "./routes/agentHubRelationships.js";
import { searchAgentHub } from "./routes/agentHubSearch.js";
import {
  getAgentHubDashboard,
  getAgentHubNeedsAttention,
  getAgentHubRecentActivity,
  getAgentHubUpcomingTouchpoints,
} from "./routes/agentHubDashboard.js";
import {
  bulkChangeTier,
  bulkMarkDnc,
  bulkTagAgents,
  exportAgentsCsv,
} from "./routes/agentHubBulk.js";
import {
  getMyHubPermissions,
  listAgentHubPermissions,
  revokeAgentHubAccess,
  upsertAgentHubPermissions,
} from "./routes/agentHubPermissions.js";
import {
  createOwner,
  deleteOwner,
  getOwner,
  listOwners,
  updateOwner,
} from "./routes/agentHubOwners.js";
import {
  createProperty,
  deleteProperty,
  getProperty,
  listProperties,
  updateProperty,
} from "./routes/agentHubProperties.js";
import {
  advanceReferralStage,
  createReferral,
  getReferral,
  getReferralStageHistory,
  listReferrals,
  markReferralDeclined,
  markReferralLost,
  restoreReferral,
  updateReferral,
} from "./routes/agentHubReferrals.js";
import {
  deletePayment,
  listPayments,
  recordPayment,
  updatePayment,
} from "./routes/agentHubReferralPayments.js";
import {
  addRevenue,
  bulkImportRevenue,
  deleteRevenue,
  listRevenue,
  updateRevenue,
} from "./routes/agentHubRevenue.js";
import {
  createTask as createAgentHubTask,
  deleteTask as deleteAgentHubTask,
  getTask as getAgentHubTask,
  listTasks as listAgentHubTasks,
  updateTask as updateAgentHubTask,
} from "./routes/agentHubTasks.js";
import {
  getAgentLifetimeValue,
  leaderboard as agentHubLeaderboard,
  refreshLifetimeValue,
} from "./routes/agentHubLifetimeValue.js";
import {
  exportFinancialsCsv,
  getFinancialsByMonth,
  getFinancialsSummary,
  getPipelineFunnel,
  getPipelineStats,
} from "./routes/agentHubFinancials.js";
import {
  createAutomation as createAgentHubAutomation,
  deleteAutomation as deleteAgentHubAutomation,
  getAutomation as getAgentHubAutomation,
  listAutomations as listAgentHubAutomations,
  simulateAutomationRoute as simulateAgentHubAutomation,
  triggerAutomationManual as triggerAgentHubAutomationManual,
  updateAutomation as updateAgentHubAutomation,
} from "./routes/agentHubAutomations.js";
import {
  approveRun,
  bulkApprove,
  bulkCancel,
  cancelRun,
  getApprovalQueue,
  getRun,
  listRuns,
} from "./routes/agentHubAutomationRuns.js";
import {
  createTemplate as createAgentHubTemplate,
  deleteTemplate as deleteAgentHubTemplate,
  getTemplate as getAgentHubTemplate,
  listTemplates as listAgentHubTemplates,
  previewTemplate as previewAgentHubTemplate,
  testSendTemplate as testSendAgentHubTemplate,
  updateTemplate as updateAgentHubTemplate,
} from "./routes/agentHubTemplates.js";
import {
  getSendLogEntry,
  listAgentSendLog,
  listReplies,
  listSendLog,
  markReplyHandled,
} from "./routes/agentHubSendLog.js";
import {
  cancelPostcard,
  exportPostcardQueueCsv,
  getPostcard,
  listPostcardQueue,
  markPostcardMailed,
} from "./routes/agentHubPostcardQueue.js";
import {
  adHocEmail,
  adHocPostcard,
  adHocSms,
} from "./routes/agentHubAdHoc.js";
import {
  completeLaunchChecklist,
  getConfig as getAgentHubSystemConfig,
  publicUnsubscribe as publicAgentHubUnsubscribe,
  toggleKillSwitch,
  updateConfig as updateAgentHubSystemConfig,
} from "./routes/agentHubSystemConfig.js";
import {
  dismissFlag,
  getAgentScore,
  getCalculationLog,
  getFlag,
  getFunnel,
  getHealth,
  getPredictions,
  leaderboard as agentHubLeaderboardIntel,
  listFlags,
  listScores,
  recalculateFlags,
  recalculateScores,
  trendReferralVelocity,
  trendScoreDistribution,
  trendTierMovement,
} from "./routes/agentHubIntelligence.js";
import {
  compareCohorts,
  createCohort,
  deleteCohort,
  getCohort,
  listCohorts,
} from "./routes/agentHubCohorts.js";
import {
  bulkImportMarket,
  createMarket,
  deleteMarket,
  getLatestForZip,
  listMarket,
  updateMarket,
} from "./routes/agentHubMarket.js";
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
  deleteDocument,
  getDocumentById,
  getDocuments,
  postDocument,
  postDocumentAiAssist,
  postDocumentDuplicate,
  putDocument,
} from "./routes/documents.js";
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
  getProcessesBoard,
  getProcessesDashboard,
  getProcessStepActivity,
  postProcess,
  postProcessStepAutomationRetry,
  postProcessStepComment,
  putProcess,
  putProcessBoardPosition,
  putProcessPin,
  putProcessStage,
  putProcessStatus,
  putProcessStep,
  putProcessStepComplete,
  putProcessStepSkip,
} from "./routes/processes.js";
import {
  getJobs,
  getJob,
  postJob,
  putJob,
  deleteJob,
  getProperties as getMaintProperties,
  getPropertyUnits as getMaintPropertyUnits,
} from "./routes/maintenanceJobs.js";
import {
  listSubcontractors,
  getSubcontractor,
  createSubcontractor,
  updateSubcontractor,
  deleteSubcontractor,
  addRating,
} from "./routes/maintenanceSubcontractors.js";
import { runCoiExpiryCheck } from "./lib/maint-coi-alerts.js";
import {
  listTechs,
  getTech,
  createTech,
  updateTech,
  deleteTech,
  listAssignments,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  getJobLabor,
} from "./routes/maintenanceTechs.js";
import {
  listQuotes,
  getQuote,
  createQuote,
  updateQuote,
  deleteQuote,
  addLine,
  updateLine,
  deleteLine,
  sendQuoteForSignature,
  approveQuote,
  declineQuote,
  getBillDraft,
} from "./routes/maintenanceQuotes.js";
import { processDelayedAutoCompletes } from "./lib/process-automation.js";
import { runAutopilotCheck } from "./lib/autopilot-engine.js";
import { executeScheduledSteps } from "./lib/scheduled-step-executor.js";
import { executeAutoStageChanges } from "./lib/auto-stage-dispatcher.js";
import { runAIAnalysis } from "./lib/ai-suggestions-engine.js";
import { sendDailyDigest } from "./lib/ai-daily-digest.js";
import {
  deleteAutopilotRule,
  getAutopilotRuleLog,
  getAutopilotRules,
  getAutopilotSummary,
  postAutopilotRule,
  postAutopilotRuleRunNow,
  postAutopilotRuleTest,
  putAutopilotRule,
  putAutopilotRuleEnabled,
} from "./routes/autopilot.js";
import {
  getAnalyticsBottlenecks,
  getAnalyticsByType,
  getAnalyticsHeatmap,
  getAnalyticsKpis,
  getAnalyticsTrends,
  getAnalyticsWorkload,
} from "./routes/processAnalytics.js";
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
  deleteProcessesBulk,
  deleteTaskTemplate,
  deleteTaskTemplateItem,
  getMyTasksAll,
  getTaskTemplate,
  getTaskTemplates,
  postLoadTaskTemplate,
  postTaskTemplate,
  postTaskTemplateItem,
  purgeExpiredRecycleBin,
  putProcessArchive,
  putProcessBulkArchive,
  putProcessBulkAssign,
  putProcessBulkStage,
  putProcessRestore,
  putProcessSoftDelete,
  putProcessUnarchive,
  putTaskTemplate,
  putTaskTemplateItem,
} from "./routes/processBoardExtras.js";
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
  deleteEmailTemplate,
  deleteProcessAttachment,
  deleteProcessTypeRole,
  deleteTextTemplate,
  getEmailTemplates,
  getProcessActivity,
  getProcessAttachments,
  getProcessAvailableRecipients,
  getProcessCommunications,
  getProcessCustomFieldSummary,
  getProcessRoleAssignments,
  getProcessStageHistory,
  getProcessSuggestions,
  getProcessTypeRoles,
  getTextTemplates,
  postEmailTemplate,
  postProcessActivityNote,
  postProcessAttachment,
  postProcessCommunication,
  postProcessSendEmail,
  postProcessSendText,
  postProcessTemplatePreview,
  postProcessTypeRole,
  postSuggestionsAnalyzeNow,
  postEmailTemplatePreviewSample,
  postTextTemplatePreviewSample,
  postTextTemplate,
  getPendingSuggestionsFeed,
  getSuggestionsStats,
  getSuggestionCountsByProcess,
  processAttachmentMiddleware,
  putEmailTemplate,
  putProcessActivityPin,
  putProcessRoleAssignments,
  putProcessSuggestionAccept,
  putProcessSuggestionDismiss,
  putProcessTypeRole,
  putProcessTypeRolesReorder,
  putTextTemplate,
} from "./routes/processSettings.js";
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
import { ensureReviewsSchema } from "./lib/reviews-schema.js";
import {
  deleteAutomation,
  deleteGoogleBusinessConnection,
  deleteReviewReply,
  deleteTemplate as deleteReviewTemplate,
  getAnalytics as getReviewsAnalytics,
  getAutomationById,
  getAutomations,
  getGoogleAccounts,
  getGoogleBusinessCallback,
  getGoogleBusinessConnect,
  getGoogleLocationsForAccount,
  getLeaderboard,
  getPublicOptOut,
  getPublicPixel,
  getPublicTrack,
  getRequestById,
  getRequests,
  getReviewById,
  getReviewStats,
  getReviews,
  getReviewsSetup,
  getTemplate as getReviewTemplate,
  getTemplates as getReviewTemplates,
  postAutomation,
  postAutomationTest as postReviewAutomationTest,
  postGoogleAutoDiscover,
  postGoogleBusinessAuthorizeUrl,
  postReviewAiSuggest,
  postReviewReply,
  postReviewSync,
  postSendBulk,
  postSendFromAppfolio,
  postSendRequest,
  postTemplate as postReviewTemplate,
  postTemplateDuplicate as postReviewTemplateDuplicate,
  processPendingRequests,
  processScheduledAutomations,
  putAutomation,
  putAutomationToggle,
  putGoogleSelection,
  putReviewFlag,
  putReviewNotes,
  putReviewRead,
  putReviewTags,
  putReviewUrl,
  putTemplate as putReviewTemplate,
  recalculateAllLeaderboards,
} from "./routes/reviews.js";
import { syncGoogleReviews } from "./lib/google-reviews-sync.js";
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
import { ensureMailersSchema } from "./lib/mailers-schema.js";
import {
  BACKEND_VERSION as ROUTES_MAILERS_VERSION,
  deleteMailer,
  deleteMailerPdfUpload,
  getMailerAccountBalance,
  getMailerById,
  getMailerHealth,
  getMailerSignature,
  getMailerStats,
  getMailerSuggestions,
  getMailerTracking,
  getMailerVolumeByWeek,
  getMailers,
  getLetterStreamWebhook,
  mailerPdfUploadMiddleware,
  postLetterStreamWebhook,
  postMailer,
  postMailerCancel,
  postMailerConfirmSend,
  postMailerNote,
  postMailerPdfUpload,
  postMailerQuote,
  postMailerResend,
  postMailerSend,
  putMailer,
} from "./routes/mailers.js";
import { ensureEsignSchema } from "./lib/esign-schema.js";
import {
  deleteRequest as deleteEsignRequest,
  getRequestDownload as getEsignRequestDownload,
  getRequestStatus as getEsignRequestStatus,
  getRequests as getEsignRequests,
  getTemplate as getEsignTemplate,
  getTemplates as getEsignTemplates,
  postRequestResend as postEsignRequestResend,
  postSend as postEsignSend,
  postWebhook as postEsignWebhook,
} from "./routes/esign.js";

const app = express();
const port = Number(process.env.PORT) || 4000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// `verify` stashes the raw bytes so Prestige Connect webhook routes can
// HMAC-verify signatures. Cheap (one Buffer ref per request) and the
// rest of the app ignores req.rawBody.
app.use(
  express.json({
    limit: "12mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

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

// Any authenticated user can read the team list (drives assignee pickers).
app.get("/users", requireAuth, listUsers);
app.get("/users/me", requireAuth, getMyProfile);
// Mutations stay admin-gated.
app.post("/users", requireAuth, requireAdminRole, createUser);
app.put("/users/:id", requireAuth, requireAdminRole, updateUser);
app.patch("/users/:id", requireAuth, requireAdminRole, updateUser);
app.delete("/users/:id", requireAuth, requireAdminRole, deleteUser);

app.get("/user-preferences/layout", requireAuth, getLayoutPrefs);
app.put("/user-preferences/layout", requireAuth, putLayoutPrefs);
app.put("/user-preferences/layout/reset", requireAuth, resetLayoutPrefs);

app.get("/widgets/data/:widgetId", requireAuth, getWidgetData);

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
app.put("/eos/scorecard/metrics/reorder", requireAuth, requireAdminRole, putScorecardMetricsReorder);
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
app.put("/eos/individual-scorecards/:id/metrics/reorder", requireAuth, requireAdminRole, putIndividualScorecardMetricsReorder);
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

/** AI Assistant — tool config, streaming generate, templates CRUD. */
app.get("/ai-assistant/tools", requireAuth, getAiTools);
app.post("/ai-assistant/generate", requireAuth, postAiGenerate);
app.get("/ai-assistant/templates", requireAuth, getAiTemplates);
app.post("/ai-assistant/templates", requireAuth, postAiTemplate);
app.put("/ai-assistant/templates/:id", requireAuth, putAiTemplate);
app.delete("/ai-assistant/templates/:id", requireAuth, deleteAiTemplate);

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

// Phase 1 thread-first inbox API. Mutations go here; the old /inbox/tickets
// endpoints stay for back-compat (admin tooling, batch AI drafts).
app.get("/inbox/threads", requireAuth, getInboxThreads);
app.get("/inbox/thread-stats", requireAuth, getInboxThreadStats);
app.get("/inbox/threads/:thread_id", requireAuth, getInboxThread);
app.patch("/inbox/threads/:thread_id", requireAuth, patchInboxThread);
app.post("/inbox/threads/:thread_id/messages", requireAuth, postInboxThreadReply);
app.post("/inbox/threads/:thread_id/read", requireAuth, postInboxThreadMarkRead);
app.post("/inbox/threads/:thread_id/sync", requireAuth, postInboxThreadSync);
app.post("/inbox/threads/:thread_id/snooze", requireAuth, postInboxThreadSnooze);
app.post("/inbox/threads/:thread_id/tags", requireAuth, postInboxThreadTags);

// Phase A inbox analytics — gated on reports.view (csm/admin/owner).
app.get(
  "/inbox/analytics/kpis",
  requireAuth,
  requirePermission("reports.view"),
  getInboxAnalyticsKpis
);
app.get(
  "/inbox/analytics/volume",
  requireAuth,
  requirePermission("reports.view"),
  getInboxAnalyticsVolume
);
app.get(
  "/inbox/analytics/channel-mix",
  requireAuth,
  requirePermission("reports.view"),
  getInboxAnalyticsChannelMix
);
app.get(
  "/inbox/analytics/team-load",
  requireAuth,
  requirePermission("reports.view"),
  getInboxAnalyticsTeamLoad
);
app.get(
  "/inbox/analytics/inbox-health",
  requireAuth,
  requirePermission("reports.view"),
  getInboxAnalyticsInboxHealth
);

// Phase 2 saved views.
app.get("/inbox/views", requireAuth, getInboxViews);
app.post("/inbox/views", requireAuth, postInboxView);
app.patch("/inbox/views/:id", requireAuth, patchInboxView);
app.delete("/inbox/views/:id", requireAuth, deleteInboxView);
app.get("/inbox/views/:id/threads", requireAuth, getInboxViewThreads);

// Phase 3 SLA policies — admin-only.
app.get("/inbox/sla-policies", requireAuth, getInboxSlaPolicies);
app.post("/inbox/sla-policies", requireAuth, requireAdminRole, postInboxSlaPolicy);
app.patch("/inbox/sla-policies/:id", requireAuth, requireAdminRole, patchInboxSlaPolicy);
app.delete("/inbox/sla-policies/:id", requireAuth, requireAdminRole, deleteInboxSlaPolicy);

// Phase 4 workflow automations.
app.get("/inbox/automation-rules", requireAuth, getInboxAutomationRules);
app.post("/inbox/automation-rules", requireAuth, requireAdminRole, postInboxAutomationRule);
app.patch("/inbox/automation-rules/:id", requireAuth, requireAdminRole, patchInboxAutomationRule);
app.delete("/inbox/automation-rules/:id", requireAuth, requireAdminRole, deleteInboxAutomationRule);
app.get("/inbox/automation-log", requireAuth, getInboxAutomationLog);
app.get("/inbox/automation-accuracy", requireAuth, getInboxAutomationAccuracy);
app.post("/inbox/automation-log/:id/feedback", requireAuth, postInboxAutomationFeedback);
app.post("/inbox/automation-log/:id/execute", requireAuth, postInboxAutomationExecute);
app.post("/inbox/automation-log/:id/revert", requireAuth, requireAdminRole, postInboxAutomationRevert);
// Phase 4 (D0-aligned) additions.
app.get("/inbox/automation-stats", requireAuth, getInboxAutomationStats);
app.get("/inbox/threads/:thread_id/automations", requireAuth, getInboxThreadAutomations);

// Phase 6 — context panel + AI suggestions.
app.get("/inbox/threads/:thread_id/context", requireAuth, getInboxThreadContext);
app.post("/inbox/threads/:thread_id/notes", requireAuth, postInboxThreadNote);
app.delete("/inbox/threads/notes/:note_id", requireAuth, deleteInboxThreadNote);
app.post(
  "/inbox/threads/:thread_id/ai-suggestions",
  requireAuth,
  postInboxThreadAiSuggestions
);

// Phase 7 — bulk triage on threads.
app.post("/inbox/threads/bulk", requireAuth, postInboxThreadsBulk);

// Phase 8 — settings: tag definitions + canned responses.
app.get("/inbox/tag-definitions", requireAuth, getInboxTagDefinitions);
app.post("/inbox/tag-definitions", requireAuth, postInboxTagDefinition);
app.patch("/inbox/tag-definitions/:id", requireAuth, patchInboxTagDefinition);
app.delete("/inbox/tag-definitions/:id", requireAuth, deleteInboxTagDefinition);
app.get("/inbox/canned-responses", requireAuth, getInboxCannedResponses);
app.post("/inbox/canned-responses", requireAuth, postInboxCannedResponse);
app.patch("/inbox/canned-responses/:id", requireAuth, patchInboxCannedResponse);
app.delete("/inbox/canned-responses/:id", requireAuth, deleteInboxCannedResponse);
app.post("/inbox/canned-responses/:id/used", requireAuth, postInboxCannedResponseUsed);

// Phase 5 attachments. Download + preview accept ?token= so plain
// <a download> + <img src> work without bespoke client fetch logic.
app.get("/inbox/attachments/:id/download", requireAuthOrQueryToken, getInboxAttachmentDownload);
app.get("/inbox/attachments/:id/preview", requireAuthOrQueryToken, getInboxAttachmentPreview);
app.post(
  "/inbox/threads/:thread_id/messages-with-attachments",
  requireAuth,
  inboxAttachmentUpload,
  postInboxThreadReplyWithAttachments
);
app.post(
  "/inbox/threads/:thread_id/fetch-attachments",
  requireAuth,
  postInboxThreadFetchAttachments
);

/* ============================================================
 * Agent Hub (Phase 1): real estate referral CRM.
 * All routes require requireAuth + requireAgentHubAccess.
 * Per-route permission flags enforced inside handlers via assertPermission().
 * ============================================================ */

// "me" — used by frontend to know what to show. Must be reachable by anyone
// with global auth so the UI can render a "no access" state.
app.get("/agent-hub/permissions/me", requireAuth, async (req, res, next) => {
  try {
    // Run requireAgentHubAccess in a soft mode: don't 403 if no row, just
    // pass null perms through.
    const { getPool } = await import("./lib/db.js");
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM agent_hub_user_permissions WHERE user_id = $1`,
      [req.user.id]
    );
    if (rows.length) {
      req.agentHubPerms = rows[0];
    } else if (req.user.role === "owner" || req.user.role === "admin") {
      req.agentHubPerms = {
        user_id: req.user.id,
        role: "owner",
        can_view_personal_details: true,
        can_change_tier: true,
        can_mark_dnc: true,
        can_export: true,
        can_merge: true,
        synthetic: true,
      };
    } else {
      req.agentHubPerms = null;
    }
    next();
  } catch (e) {
    console.error("[agent-hub] perms/me", e);
    res.status(500).json({ error: "Could not load permissions." });
  }
}, getMyHubPermissions);

// Brokerages
app.get("/agent-hub/brokerages", requireAuth, requireAgentHubAccess, listAgentHubBrokerages);
app.get("/agent-hub/brokerages/:id", requireAuth, requireAgentHubAccess, getAgentHubBrokerage);
app.post("/agent-hub/brokerages", requireAuth, requireAgentHubAccess, createAgentHubBrokerage);
app.patch("/agent-hub/brokerages/:id", requireAuth, requireAgentHubAccess, updateAgentHubBrokerage);
app.delete("/agent-hub/brokerages/:id", requireAuth, requireAgentHubAccess, deleteAgentHubBrokerage);

// Agents
app.get("/agent-hub/agents", requireAuth, requireAgentHubAccess, listAgentHubAgents);
app.get("/agent-hub/agents/:id", requireAuth, requireAgentHubAccess, getAgentHubAgent);
app.post("/agent-hub/agents", requireAuth, requireAgentHubAccess, createAgentHubAgent);
app.patch("/agent-hub/agents/:id", requireAuth, requireAgentHubAccess, updateAgentHubAgent);
app.delete("/agent-hub/agents/:id", requireAuth, requireAgentHubAccess, deleteAgentHubAgent);
app.post("/agent-hub/agents/:id/merge/:other_id", requireAuth, requireAgentHubAccess, mergeAgentHubAgents);

// Personal details (gated)
app.get("/agent-hub/agents/:id/personal", requireAuth, requireAgentHubAccess, getAgentHubPersonalDetails);
app.put("/agent-hub/agents/:id/personal", requireAuth, requireAgentHubAccess, upsertAgentHubPersonalDetails);

// Activities
app.get("/agent-hub/agents/:id/activities", requireAuth, requireAgentHubAccess, listAgentHubActivities);
app.post(
  "/agent-hub/agents/:id/activities",
  requireAuth,
  requireAgentHubAccess,
  uploadActivityAttachmentMiddleware,
  createAgentHubActivity
);
app.patch("/agent-hub/activities/:id", requireAuth, requireAgentHubAccess, updateAgentHubActivity);
app.delete("/agent-hub/activities/:id", requireAuth, requireAgentHubAccess, deleteAgentHubActivity);
app.get("/agent-hub/attachments/:id/download", requireAuth, requireAgentHubAccess, downloadAgentHubAttachment);

// Tags
app.get("/agent-hub/tags", requireAuth, requireAgentHubAccess, listGlobalTags);
app.post("/agent-hub/agents/:id/tags", requireAuth, requireAgentHubAccess, addAgentHubTag);
app.delete("/agent-hub/agents/:id/tags/:tag", requireAuth, requireAgentHubAccess, removeAgentHubTag);
app.post("/agent-hub/tags/rename", requireAuth, requireAgentHubAccess, renameGlobalTag);
app.delete("/agent-hub/tags/:tag", requireAuth, requireAgentHubAccess, deleteGlobalTag);

// Relationships
app.get("/agent-hub/agents/:id/relationships", requireAuth, requireAgentHubAccess, listAgentHubRelationships);
app.post("/agent-hub/agents/:id/relationships", requireAuth, requireAgentHubAccess, createAgentHubRelationship);
app.delete("/agent-hub/relationships/:id", requireAuth, requireAgentHubAccess, deleteAgentHubRelationship);

// Search
app.get("/agent-hub/search", requireAuth, requireAgentHubAccess, searchAgentHub);

// Dashboard
app.get("/agent-hub/dashboard", requireAuth, requireAgentHubAccess, getAgentHubDashboard);
app.get("/agent-hub/dashboard/recent-activity", requireAuth, requireAgentHubAccess, getAgentHubRecentActivity);
app.get("/agent-hub/dashboard/upcoming-touchpoints", requireAuth, requireAgentHubAccess, getAgentHubUpcomingTouchpoints);
app.get("/agent-hub/dashboard/needs-attention", requireAuth, requireAgentHubAccess, getAgentHubNeedsAttention);

// Bulk + export
app.post("/agent-hub/agents/bulk-tag", requireAuth, requireAgentHubAccess, bulkTagAgents);
app.post("/agent-hub/agents/bulk-tier", requireAuth, requireAgentHubAccess, bulkChangeTier);
app.post("/agent-hub/agents/bulk-dnc", requireAuth, requireAgentHubAccess, bulkMarkDnc);
app.get("/agent-hub/agents/export.csv", requireAuth, requireAgentHubAccess, exportAgentsCsv);

// Permission settings
app.get("/agent-hub/permissions", requireAuth, requireAgentHubAccess, listAgentHubPermissions);
app.put("/agent-hub/permissions/:user_id", requireAuth, requireAgentHubAccess, upsertAgentHubPermissions);
app.delete("/agent-hub/permissions/:user_id", requireAuth, requireAgentHubAccess, revokeAgentHubAccess);

/* ============================================================
 * Agent Hub Phase 2: referral pipeline, owners, properties,
 * payments, revenue tracking, tasks, LTV, financials.
 * ============================================================ */

// Owners
app.get("/agent-hub/owners", requireAuth, requireAgentHubAccess, listOwners);
app.get("/agent-hub/owners/:id", requireAuth, requireAgentHubAccess, getOwner);
app.post("/agent-hub/owners", requireAuth, requireAgentHubAccess, createOwner);
app.patch("/agent-hub/owners/:id", requireAuth, requireAgentHubAccess, updateOwner);
app.delete("/agent-hub/owners/:id", requireAuth, requireAgentHubAccess, deleteOwner);

// Properties
app.get("/agent-hub/properties", requireAuth, requireAgentHubAccess, listProperties);
app.get("/agent-hub/properties/:id", requireAuth, requireAgentHubAccess, getProperty);
app.post("/agent-hub/properties", requireAuth, requireAgentHubAccess, createProperty);
app.patch("/agent-hub/properties/:id", requireAuth, requireAgentHubAccess, updateProperty);
app.delete("/agent-hub/properties/:id", requireAuth, requireAgentHubAccess, deleteProperty);

// Referrals
app.get("/agent-hub/referrals", requireAuth, requireAgentHubAccess, listReferrals);
app.get("/agent-hub/referrals/:id", requireAuth, requireAgentHubAccess, getReferral);
app.post("/agent-hub/referrals", requireAuth, requireAgentHubAccess, createReferral);
app.patch("/agent-hub/referrals/:id", requireAuth, requireAgentHubAccess, updateReferral);
app.post("/agent-hub/referrals/:id/advance-stage", requireAuth, requireAgentHubAccess, advanceReferralStage);
app.post("/agent-hub/referrals/:id/mark-lost", requireAuth, requireAgentHubAccess, markReferralLost);
app.post("/agent-hub/referrals/:id/mark-declined", requireAuth, requireAgentHubAccess, markReferralDeclined);
app.post("/agent-hub/referrals/:id/restore", requireAuth, requireAgentHubAccess, restoreReferral);
app.get("/agent-hub/referrals/:id/stage-history", requireAuth, requireAgentHubAccess, getReferralStageHistory);

// Payments
app.get("/agent-hub/referrals/:id/payments", requireAuth, requireAgentHubAccess, listPayments);
app.post("/agent-hub/referrals/:id/payments", requireAuth, requireAgentHubAccess, recordPayment);
app.patch("/agent-hub/payments/:id", requireAuth, requireAgentHubAccess, updatePayment);
app.delete("/agent-hub/payments/:id", requireAuth, requireAgentHubAccess, deletePayment);

// Revenue tracking
app.get("/agent-hub/referrals/:id/revenue", requireAuth, requireAgentHubAccess, listRevenue);
app.post("/agent-hub/referrals/:id/revenue", requireAuth, requireAgentHubAccess, addRevenue);
app.patch("/agent-hub/revenue/:id", requireAuth, requireAgentHubAccess, updateRevenue);
app.delete("/agent-hub/revenue/:id", requireAuth, requireAgentHubAccess, deleteRevenue);
app.post("/agent-hub/revenue/bulk-import", requireAuth, requireAgentHubAccess, bulkImportRevenue);

// Tasks (Agent Hub specific — different table from operations.tasks)
app.get("/agent-hub/tasks", requireAuth, requireAgentHubAccess, listAgentHubTasks);
app.get("/agent-hub/tasks/:id", requireAuth, requireAgentHubAccess, getAgentHubTask);
app.post("/agent-hub/tasks", requireAuth, requireAgentHubAccess, createAgentHubTask);
app.patch("/agent-hub/tasks/:id", requireAuth, requireAgentHubAccess, updateAgentHubTask);
app.delete("/agent-hub/tasks/:id", requireAuth, requireAgentHubAccess, deleteAgentHubTask);

// Lifetime value
app.get("/agent-hub/agents/:id/lifetime-value", requireAuth, requireAgentHubAccess, getAgentLifetimeValue);
app.post("/agent-hub/lifetime-value/refresh", requireAuth, requireAgentHubAccess, refreshLifetimeValue);
app.get("/agent-hub/financials/leaderboard", requireAuth, requireAgentHubAccess, agentHubLeaderboard);

// Pipeline + financials aggregations
app.get("/agent-hub/pipeline/stats", requireAuth, requireAgentHubAccess, getPipelineStats);
app.get("/agent-hub/pipeline/funnel", requireAuth, requireAgentHubAccess, getPipelineFunnel);
app.get("/agent-hub/financials/summary", requireAuth, requireAgentHubAccess, getFinancialsSummary);
app.get("/agent-hub/financials/by-month", requireAuth, requireAgentHubAccess, getFinancialsByMonth);
app.get("/agent-hub/financials/export.csv", requireAuth, requireAgentHubAccess, exportFinancialsCsv);

/* ============================================================
 * Agent Hub Phase 3: automation engine + compliance + sends.
 * ============================================================ */

// Public unsubscribe handler — NO auth (token is the credential).
app.get("/agent-hub/unsubscribe", publicAgentHubUnsubscribe);

// Automations (Agent Hub specific — separate from reviews automations)
app.get("/agent-hub/automations", requireAuth, requireAgentHubAccess, listAgentHubAutomations);
app.get("/agent-hub/automations/:id", requireAuth, requireAgentHubAccess, getAgentHubAutomation);
app.post("/agent-hub/automations", requireAuth, requireAgentHubAccess, createAgentHubAutomation);
app.patch("/agent-hub/automations/:id", requireAuth, requireAgentHubAccess, updateAgentHubAutomation);
app.delete("/agent-hub/automations/:id", requireAuth, requireAgentHubAccess, deleteAgentHubAutomation);
app.post("/agent-hub/automations/:id/simulate", requireAuth, requireAgentHubAccess, simulateAgentHubAutomation);
app.post("/agent-hub/automations/:id/trigger-manual", requireAuth, requireAgentHubAccess, triggerAgentHubAutomationManual);

// Automation runs
app.get("/agent-hub/automation-runs", requireAuth, requireAgentHubAccess, listRuns);
app.get("/agent-hub/automation-runs/:id", requireAuth, requireAgentHubAccess, getRun);
app.post("/agent-hub/automation-runs/:id/approve", requireAuth, requireAgentHubAccess, approveRun);
app.post("/agent-hub/automation-runs/:id/cancel", requireAuth, requireAgentHubAccess, cancelRun);

// Approval queue
app.get("/agent-hub/approval-queue", requireAuth, requireAgentHubAccess, getApprovalQueue);
app.post("/agent-hub/approval-queue/bulk-approve", requireAuth, requireAgentHubAccess, bulkApprove);
app.post("/agent-hub/approval-queue/bulk-cancel", requireAuth, requireAgentHubAccess, bulkCancel);

// Templates (Agent Hub specific)
app.get("/agent-hub/templates", requireAuth, requireAgentHubAccess, listAgentHubTemplates);
app.get("/agent-hub/templates/:id", requireAuth, requireAgentHubAccess, getAgentHubTemplate);
app.post("/agent-hub/templates", requireAuth, requireAgentHubAccess, createAgentHubTemplate);
app.patch("/agent-hub/templates/:id", requireAuth, requireAgentHubAccess, updateAgentHubTemplate);
app.delete("/agent-hub/templates/:id", requireAuth, requireAgentHubAccess, deleteAgentHubTemplate);
app.post("/agent-hub/templates/:id/preview", requireAuth, requireAgentHubAccess, previewAgentHubTemplate);
app.post("/agent-hub/templates/:id/test-send", requireAuth, requireAgentHubAccess, testSendAgentHubTemplate);

// Send log + replies
app.get("/agent-hub/send-log", requireAuth, requireAgentHubAccess, listSendLog);
app.get("/agent-hub/send-log/:id", requireAuth, requireAgentHubAccess, getSendLogEntry);
app.get("/agent-hub/agents/:id/send-log", requireAuth, requireAgentHubAccess, listAgentSendLog);
app.get("/agent-hub/replies", requireAuth, requireAgentHubAccess, listReplies);
app.post("/agent-hub/replies/:id/handled", requireAuth, requireAgentHubAccess, markReplyHandled);

// Postcard queue
app.get("/agent-hub/postcard-queue", requireAuth, requireAgentHubAccess, listPostcardQueue);
app.get("/agent-hub/postcard-queue/:id", requireAuth, requireAgentHubAccess, getPostcard);
app.post("/agent-hub/postcard-queue/:id/mark-mailed", requireAuth, requireAgentHubAccess, markPostcardMailed);
app.post("/agent-hub/postcard-queue/:id/cancel", requireAuth, requireAgentHubAccess, cancelPostcard);
app.get("/agent-hub/postcard-queue/export.csv", requireAuth, requireAgentHubAccess, exportPostcardQueueCsv);

// Ad-hoc sends from agent detail page
app.post("/agent-hub/agents/:id/send-email", requireAuth, requireAgentHubAccess, adHocEmail);
app.post("/agent-hub/agents/:id/send-sms", requireAuth, requireAgentHubAccess, adHocSms);
app.post("/agent-hub/agents/:id/queue-postcard", requireAuth, requireAgentHubAccess, adHocPostcard);

// System config + kill switch + launch checklist
app.get("/agent-hub/system-config", requireAuth, requireAgentHubAccess, getAgentHubSystemConfig);
app.patch("/agent-hub/system-config", requireAuth, requireAgentHubAccess, updateAgentHubSystemConfig);
app.post("/agent-hub/system-config/kill-switch", requireAuth, requireAgentHubAccess, toggleKillSwitch);
app.post("/agent-hub/system-config/complete-launch-checklist", requireAuth, requireAgentHubAccess, completeLaunchChecklist);

/* ============================================================
 * Agent Hub Phase 4: intelligence layer.
 * ============================================================ */

// Engagement scores
app.get("/agent-hub/intelligence/scores", requireAuth, requireAgentHubAccess, listScores);
app.get("/agent-hub/intelligence/scores/calculation-log", requireAuth, requireAgentHubAccess, getCalculationLog);
app.get("/agent-hub/intelligence/scores/:agent_id", requireAuth, requireAgentHubAccess, getAgentScore);
app.post("/agent-hub/intelligence/scores/recalculate", requireAuth, requireAgentHubAccess, recalculateScores);

// Predictive flags
app.get("/agent-hub/intelligence/flags", requireAuth, requireAgentHubAccess, listFlags);
app.get("/agent-hub/intelligence/flags/:id", requireAuth, requireAgentHubAccess, getFlag);
app.post("/agent-hub/intelligence/flags/:id/dismiss", requireAuth, requireAgentHubAccess, dismissFlag);
app.post("/agent-hub/intelligence/flags/recalculate", requireAuth, requireAgentHubAccess, recalculateFlags);

// Leaderboard, health, funnel, predictions, trends
app.get("/agent-hub/intelligence/leaderboard", requireAuth, requireAgentHubAccess, agentHubLeaderboardIntel);
app.get("/agent-hub/intelligence/health", requireAuth, requireAgentHubAccess, getHealth);
app.get("/agent-hub/intelligence/funnel", requireAuth, requireAgentHubAccess, getFunnel);
app.get("/agent-hub/intelligence/predictions", requireAuth, requireAgentHubAccess, getPredictions);
app.get("/agent-hub/intelligence/trends/score-distribution", requireAuth, requireAgentHubAccess, trendScoreDistribution);
app.get("/agent-hub/intelligence/trends/tier-movement", requireAuth, requireAgentHubAccess, trendTierMovement);
app.get("/agent-hub/intelligence/trends/referral-velocity", requireAuth, requireAgentHubAccess, trendReferralVelocity);

// Cohorts
app.get("/agent-hub/intelligence/cohorts", requireAuth, requireAgentHubAccess, listCohorts);
app.get("/agent-hub/intelligence/cohorts/compare", requireAuth, requireAgentHubAccess, compareCohorts);
app.get("/agent-hub/intelligence/cohorts/:id", requireAuth, requireAgentHubAccess, getCohort);
app.post("/agent-hub/intelligence/cohorts", requireAuth, requireAgentHubAccess, createCohort);
app.delete("/agent-hub/intelligence/cohorts/:id", requireAuth, requireAgentHubAccess, deleteCohort);

// Market intelligence
app.get("/agent-hub/intelligence/market", requireAuth, requireAgentHubAccess, listMarket);
app.get("/agent-hub/intelligence/market/zips/:zip/latest", requireAuth, requireAgentHubAccess, getLatestForZip);
app.post("/agent-hub/intelligence/market", requireAuth, requireAgentHubAccess, createMarket);
app.post("/agent-hub/intelligence/market/bulk-import", requireAuth, requireAgentHubAccess, bulkImportMarket);
app.patch("/agent-hub/intelligence/market/:id", requireAuth, requireAgentHubAccess, updateMarket);
app.delete("/agent-hub/intelligence/market/:id", requireAuth, requireAgentHubAccess, deleteMarket);
app.post("/inbox/sync/trigger", requireAuth, requireAdminRole, postInboxSyncTrigger);
app.post("/inbox/connections/:id/sync", requireAuth, postInboxConnectionSync);
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

/** Mailers — physical mail via LetterStream */
// Webhook is PUBLIC (LetterStream calls it server-to-server, key in body) and uses form parsing.
// GET handles LetterStream's test/health ping; POST handles the actual scan pushes.
app.get("/mailers/webhook/letterstream", getLetterStreamWebhook);
app.post(
  "/mailers/webhook/letterstream",
  express.urlencoded({ extended: true, limit: "4mb" }),
  express.json({ limit: "4mb" }),
  postLetterStreamWebhook
);

// Public version probe — proves which build of routes/mailers.js was loaded.
// The dockerfileEnv comes from the Docker image env var (set during build).
// The routesMailersVersion comes from the actual JS file loaded at runtime.
// If they differ, Docker is serving a cached COPY layer with stale source.
app.get("/mailers/_version", (_req, res) => {
  res.json({
    backendVersion: process.env.BACKEND_BUILD || "(BACKEND_BUILD env not set)",
    routesMailersVersion: ROUTES_MAILERS_VERSION || "(not exported)",
    nodeEnv: process.env.NODE_ENV || null,
    timestamp: new Date().toISOString(),
  });
});
app.get("/mailers/health", requireAuth, getMailerHealth);
app.get("/mailers/stats", requireAuth, getMailerStats);
app.get("/mailers/volume", requireAuth, getMailerVolumeByWeek);
app.get("/mailers/suggestions", requireAuth, getMailerSuggestions);
app.get("/mailers/account-balance", requireAuth, getMailerAccountBalance);
app.get("/mailers", requireAuth, getMailers);
app.post("/mailers", requireAuth, postMailer);
app.get("/mailers/:id", requireAuth, getMailerById);
app.put("/mailers/:id", requireAuth, putMailer);
app.delete("/mailers/:id", requireAuth, deleteMailer);
// Two-step send flow: /quote returns price + authcode, /confirm-send releases the job.
app.post("/mailers/:id/quote", requireAuth, postMailerQuote);
app.post("/mailers/:id/confirm-send", requireAuth, postMailerConfirmSend);
// Legacy alias (deprecated): /send → behaves as /quote, frontend should follow up with /confirm-send.
app.post("/mailers/:id/send", requireAuth, postMailerSend);
app.post("/mailers/:id/cancel", requireAuth, postMailerCancel);
app.post("/mailers/:id/resend", requireAuth, postMailerResend);
app.post("/mailers/:id/note", requireAuth, postMailerNote);
app.get("/mailers/:id/tracking", requireAuth, getMailerTracking);
app.get("/mailers/:id/signature", requireAuth, getMailerSignature);
// PDF upload (multipart) — attaches a ready-made PDF that bypasses Puppeteer.
app.post("/mailers/:id/upload-pdf", requireAuth, mailerPdfUploadMiddleware, postMailerPdfUpload);
app.delete("/mailers/:id/upload-pdf", requireAuth, deleteMailerPdfUpload);

/** Documents — standalone rich-text docs (notes, SOPs, owner letters, wikis) */
app.post("/documents/ai-assist", requireAuth, postDocumentAiAssist);
app.get("/documents", requireAuth, getDocuments);
app.post("/documents", requireAuth, postDocument);
app.get("/documents/:id", requireAuth, getDocumentById);
app.put("/documents/:id", requireAuth, putDocument);
app.delete("/documents/:id", requireAuth, deleteDocument);
app.post("/documents/:id/duplicate", requireAuth, postDocumentDuplicate);

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
app.get("/processes/board", requireAuth, getProcessesBoard);
app.get("/processes", requireAuth, getProcesses);
app.post("/processes", requireAuth, postProcess);

/** Maintenance Management System — job/ticket CRUD (Phase 1) */
app.get("/maintenance/properties", requireAuth, getMaintProperties);
app.get("/maintenance/properties/:propertyId/units", requireAuth, getMaintPropertyUnits);
app.get("/maintenance/jobs", requireAuth, getJobs);
app.post("/maintenance/jobs", requireAuth, postJob);
app.get("/maintenance/jobs/:id", requireAuth, getJob);
app.put("/maintenance/jobs/:id", requireAuth, putJob);
app.delete("/maintenance/jobs/:id", requireAuth, requirePermission("maintenance.delete"), deleteJob);

/** Maintenance Management System — subcontractor DB (Phase 2) */
app.get("/maintenance/subcontractors", requireAuth, listSubcontractors);
app.post("/maintenance/subcontractors", requireAuth, createSubcontractor);
app.get("/maintenance/subcontractors/:id", requireAuth, getSubcontractor);
app.put("/maintenance/subcontractors/:id", requireAuth, updateSubcontractor);
app.delete("/maintenance/subcontractors/:id", requireAuth, requirePermission("maintenance.delete"), deleteSubcontractor);
app.post("/maintenance/subcontractors/:id/ratings", requireAuth, addRating);

/** Maintenance Management System — techs + scheduling (Phase 3) */
app.get("/maintenance/techs", requireAuth, listTechs);
app.post("/maintenance/techs", requireAuth, createTech);
app.get("/maintenance/techs/:id", requireAuth, getTech);
app.put("/maintenance/techs/:id", requireAuth, updateTech);
app.delete("/maintenance/techs/:id", requireAuth, requirePermission("maintenance.delete"), deleteTech);
app.get("/maintenance/assignments", requireAuth, listAssignments);
app.post("/maintenance/assignments", requireAuth, createAssignment);
app.put("/maintenance/assignments/:id", requireAuth, updateAssignment);
app.delete("/maintenance/assignments/:id", requireAuth, deleteAssignment);
app.get("/maintenance/jobs/:id/labor", requireAuth, getJobLabor);

/** Maintenance Management System — quotes + PrestigeSign (Phase 4) */
app.get("/maintenance/quotes", requireAuth, listQuotes);
app.post("/maintenance/quotes", requireAuth, createQuote);
app.get("/maintenance/quotes/:id", requireAuth, getQuote);
app.put("/maintenance/quotes/:id", requireAuth, updateQuote);
app.delete("/maintenance/quotes/:id", requireAuth, requirePermission("maintenance.delete"), deleteQuote);
app.post("/maintenance/quotes/:id/lines", requireAuth, addLine);
app.put("/maintenance/quotes/:id/lines/:lineId", requireAuth, updateLine);
app.delete("/maintenance/quotes/:id/lines/:lineId", requireAuth, deleteLine);
app.post("/maintenance/quotes/:id/send-esign", requireAuth, sendQuoteForSignature);
app.post("/maintenance/quotes/:id/approve", requireAuth, approveQuote);
app.post("/maintenance/quotes/:id/decline", requireAuth, declineQuote);
app.get("/maintenance/quotes/:id/bill-draft", requireAuth, getBillDraft);

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
app.put("/processes/:id/stage", requireAuth, putProcessStage);
app.put("/processes/:id/board-position", requireAuth, putProcessBoardPosition);
app.put("/processes/:id/pin", requireAuth, putProcessPin);
app.put("/processes/:id", requireAuth, putProcess);
app.delete("/processes/:id", requireAuth, requireAdminRole, deleteProcess);

/** Archive + recycle bin */
app.put("/processes/:id/archive", requireAuth, putProcessArchive);
app.put("/processes/:id/unarchive", requireAuth, putProcessUnarchive);
app.put("/processes/:id/soft-delete", requireAuth, putProcessSoftDelete);
app.put("/processes/:id/restore", requireAuth, putProcessRestore);

/** Bulk actions */
app.put("/processes/bulk/stage", requireAuth, putProcessBulkStage);
app.put("/processes/bulk/assign", requireAuth, putProcessBulkAssign);
app.put("/processes/bulk/archive", requireAuth, putProcessBulkArchive);
app.delete("/processes/bulk", requireAuth, requireAdminRole, deleteProcessesBulk);

/** Task templates */
app.get("/task-templates", requireAuth, getTaskTemplates);
app.post("/task-templates", requireAuth, requireAdminRole, postTaskTemplate);
app.get("/task-templates/:id", requireAuth, getTaskTemplate);
app.put("/task-templates/:id", requireAuth, requireAdminRole, putTaskTemplate);
app.delete("/task-templates/:id", requireAuth, requireAdminRole, deleteTaskTemplate);
app.post("/task-templates/:id/items", requireAuth, requireAdminRole, postTaskTemplateItem);
app.put("/task-template-items/:itemId", requireAuth, requireAdminRole, putTaskTemplateItem);
app.delete("/task-template-items/:itemId", requireAuth, requireAdminRole, deleteTaskTemplateItem);
app.post(
  "/processes/:processId/load-template/:taskTemplateId",
  requireAuth,
  postLoadTaskTemplate
);

/** Cross-board My Tasks (all assigned process steps) */
app.get("/tasks/my-all", requireAuth, getMyTasksAll);

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

/** Process Settings — roles, role assignments, email/text templates, activity, comms, files */
app.get("/processes/templates/:id/roles", requireAuth, getProcessTypeRoles);
app.post("/processes/templates/:id/roles", requireAuth, requireAdminRole, postProcessTypeRole);
app.put("/processes/templates/:id/roles/reorder", requireAuth, requireAdminRole, putProcessTypeRolesReorder);
app.put("/processes/process-type-roles/:roleId", requireAuth, requireAdminRole, putProcessTypeRole);
app.delete("/processes/process-type-roles/:roleId", requireAuth, requireAdminRole, deleteProcessTypeRole);

app.get("/processes/:processId/role-assignments", requireAuth, getProcessRoleAssignments);
app.put("/processes/:processId/role-assignments", requireAuth, putProcessRoleAssignments);

app.get("/processes/templates/:id/email-templates", requireAuth, getEmailTemplates);
app.post("/processes/templates/:id/email-templates", requireAuth, requireAdminRole, postEmailTemplate);
app.put("/processes/email-templates/:id", requireAuth, requireAdminRole, putEmailTemplate);
app.delete("/processes/email-templates/:id", requireAuth, requireAdminRole, deleteEmailTemplate);
app.post(
  "/processes/email-templates/:id/preview-sample",
  requireAuth,
  postEmailTemplatePreviewSample
);

app.get("/processes/templates/:id/text-templates", requireAuth, getTextTemplates);
app.post("/processes/templates/:id/text-templates", requireAuth, requireAdminRole, postTextTemplate);
app.put("/processes/text-templates/:id", requireAuth, requireAdminRole, putTextTemplate);
app.delete("/processes/text-templates/:id", requireAuth, requireAdminRole, deleteTextTemplate);
app.post(
  "/processes/text-templates/:id/preview-sample",
  requireAuth,
  postTextTemplatePreviewSample
);

app.get("/processes/:processId/activity", requireAuth, getProcessActivity);
app.post("/processes/:processId/activity", requireAuth, postProcessActivityNote);
app.put("/processes/process-activity/:id/pin", requireAuth, putProcessActivityPin);

app.get("/processes/:processId/stage-history", requireAuth, getProcessStageHistory);
app.get("/processes/:processId/custom-field-summary", requireAuth, getProcessCustomFieldSummary);

app.get("/processes/:processId/communications", requireAuth, getProcessCommunications);
app.post("/processes/:processId/communications", requireAuth, postProcessCommunication);

app.get("/processes/:processId/attachments", requireAuth, getProcessAttachments);
app.post(
  "/processes/:processId/attachments",
  requireAuth,
  processAttachmentMiddleware,
  postProcessAttachment
);
app.delete("/processes/process-attachments/:id", requireAuth, deleteProcessAttachment);

app.get("/processes/:processId/suggestions", requireAuth, getProcessSuggestions);
app.put("/processes/process-suggestions/:id/accept", requireAuth, putProcessSuggestionAccept);
app.put("/processes/process-suggestions/:id/dismiss", requireAuth, putProcessSuggestionDismiss);

/** AI Suggestions feed + stats + manual analysis (Phase 6) */
app.get("/process-suggestions/pending", requireAuth, getPendingSuggestionsFeed);
app.get("/process-suggestions/stats", requireAuth, getSuggestionsStats);
app.get("/process-suggestions/counts", requireAuth, getSuggestionCountsByProcess);
app.post(
  "/process-suggestions/analyze-now",
  requireAuth,
  requireAdminRole,
  postSuggestionsAnalyzeNow
);

app.get("/processes/:processId/available-recipients", requireAuth, getProcessAvailableRecipients);
app.post("/processes/:processId/send-email", requireAuth, postProcessSendEmail);
app.post("/processes/:processId/send-text", requireAuth, postProcessSendText);
app.post("/processes/:processId/send-template-preview", requireAuth, postProcessTemplatePreview);

/** Autopilot rules (Phase 4) — auto-start processes on schedule with conditions */
app.get("/autopilot/summary", requireAuth, getAutopilotSummary);
app.get("/processes/templates/:templateId/autopilot-rules", requireAuth, getAutopilotRules);
app.post(
  "/processes/templates/:templateId/autopilot-rules",
  requireAuth,
  requireAdminRole,
  postAutopilotRule
);
app.put("/autopilot-rules/:id", requireAuth, requireAdminRole, putAutopilotRule);
app.delete("/autopilot-rules/:id", requireAuth, requireAdminRole, deleteAutopilotRule);
app.put("/autopilot-rules/:id/enable", requireAuth, requireAdminRole, putAutopilotRuleEnabled(true));
app.put("/autopilot-rules/:id/disable", requireAuth, requireAdminRole, putAutopilotRuleEnabled(false));
app.post("/autopilot-rules/:id/test", requireAuth, postAutopilotRuleTest);
app.post("/autopilot-rules/:id/run-now", requireAuth, requireAdminRole, postAutopilotRuleRunNow);
app.get("/autopilot-rules/:id/log", requireAuth, getAutopilotRuleLog);

/** Process analytics (Phase 5) */
app.get("/process-analytics/kpis", requireAuth, getAnalyticsKpis);
app.get("/process-analytics/bottlenecks", requireAuth, getAnalyticsBottlenecks);
app.get("/process-analytics/workload", requireAuth, getAnalyticsWorkload);
app.get("/process-analytics/trends", requireAuth, getAnalyticsTrends);
app.get("/process-analytics/by-type", requireAuth, getAnalyticsByType);
app.get("/process-analytics/activity-heatmap", requireAuth, getAnalyticsHeatmap);

/** Property context — aggregates cached AppFolio/Boom/LeadSimple/RentEngine data */
app.get("/property-context/search", requireAuth, getPropertySearch);
app.get("/property-context/by-name/:propertyName", requireAuth, getPropertyContextByName);
app.get("/property-context/:propertyId", requireAuth, getPropertyContextById);

/** Form Builder — public form render + submit (no auth), admin CRUD (JWT). Public routes first. */
// Phase 4: embed bundle + open-tracking pixel (public, no auth)
app.get("/forms/embed.js", getEmbedJs);
app.get("/forms/distribution/:token/open", getDistributionOpen);

app.get("/forms/public/:slug", checkFormAccess, getPublicForm);
app.get("/forms/public/:slug/prefill", getPublicFormPrefill);
app.post("/forms/public/:slug/submit", checkFormAccess, postPublicFormSubmit);
app.post("/forms/public/:slug/upload", formsUploadMiddleware, postPublicFormUpload);
app.post("/forms/public/:slug/analytics", postPublicAnalytics);

/** Phase 3: templates, categories, metadata — registered before /forms/:id catch-all. */
app.get("/forms/templates", requireAuth, getFormTemplates);
app.post("/forms/from-template", requireAuth, postFormFromTemplate);
app.get("/forms/categories", requireAuth, getFormCategories);
app.get("/forms/automation-meta", requireAuth, getAutomationMeta);
app.post("/forms/automations/:automationId/test", requireAuth, postAutomationTest);
app.post("/forms/submissions/:submissionId/rerun-automations", requireAuth, postReRunAutomations);
app.get("/forms/submissions/:submissionId/pdf", requireAuth, getSubmissionPdf);

/** Phase 4: must register before /forms/:id catch-all. */
app.get("/forms/badge", requireAuth, getFormsBadge);
app.get("/forms/approvals/my", requireAuth, getMyApprovals);
app.post("/forms/import", requireAuth, postFormImport);

// Submission-scoped: notes, tags, assign, priority, star, approvals, docs
app.post("/forms/submissions/:submissionId/notes", requireAuth, postSubmissionNote);
app.get("/forms/submissions/:submissionId/notes", requireAuth, getSubmissionNotes);
app.delete("/forms/submission-notes/:noteId", requireAuth, deleteSubmissionNote);
app.put("/forms/submissions/:submissionId/assign", requireAuth, putAssignSubmission);
app.put("/forms/submissions/:submissionId/priority", requireAuth, putSubmissionPriority);
app.put("/forms/submissions/:submissionId/star", requireAuth, putSubmissionStar);
app.post("/forms/submissions/:submissionId/tags", requireAuth, postSubmissionTag);
app.get("/forms/submissions/:submissionId/tags", requireAuth, getSubmissionTags);
app.delete("/forms/submissions/:submissionId/tags/:tag", requireAuth, deleteSubmissionTag);
app.put("/forms/submissions/:submissionId/approve", requireAuth, putApproveSubmission);
app.put("/forms/submissions/:submissionId/reject", requireAuth, putRejectSubmission);
app.get("/forms/submissions/:submissionId/approvals", requireAuth, getSubmissionApprovals);
app.post("/forms/submissions/:submissionId/generate-document/:templateId", requireAuth, postGenerateDocument);
app.get("/forms/submissions/:submissionId/documents", requireAuth, getGeneratedDocuments);
app.get("/forms/documents/:documentId/download", requireAuth, getDocumentDownload);

// Doc template routes
app.put("/forms/document-templates/:templateId", requireAuth, putDocTemplate);
app.delete("/forms/document-templates/:templateId", requireAuth, deleteDocTemplate);

app.get("/forms", requireAuth, getForms);
app.post("/forms", requireAuth, postForm);

app.get("/forms/submissions/:submissionId", requireAuth, getFormSubmission);
app.put("/forms/submissions/:submissionId", requireAuth, putFormSubmission);
app.delete("/forms/submissions/:submissionId", requireAuth, deleteFormSubmission);

app.put("/forms/fields/:fieldId/move", requireAuth, putFormFieldMove);
app.put("/forms/fields/:fieldId", requireAuth, putFormField);
app.delete("/forms/fields/:fieldId", requireAuth, deleteFormField);

app.put("/forms/pages/:pageId", requireAuth, putFormPage);
app.delete("/forms/pages/:pageId", requireAuth, deleteFormPage);

app.put("/forms/automations/:automationId", requireAuth, putFormAutomation);
app.delete("/forms/automations/:automationId", requireAuth, deleteFormAutomation);

app.get("/forms/:id/fields", requireAuth, getFormFields);
app.post("/forms/:id/fields", requireAuth, postFormField);
app.put("/forms/:id/fields/reorder", requireAuth, putFormFieldsReorder);

app.get("/forms/:id/pages", requireAuth, getFormPages);
app.post("/forms/:id/pages", requireAuth, postFormPage);
app.put("/forms/:id/pages/reorder", requireAuth, putFormPagesReorder);

app.get("/forms/:id/automations", requireAuth, getFormAutomations);
app.post("/forms/:id/automations", requireAuth, postFormAutomation);

app.get("/forms/:id/submissions", requireAuth, getFormSubmissions);
// Phase 3 exports: CSV + Excel via ?format=
app.get("/forms/:id/submissions/export", requireAuth, getSubmissionsExport);
app.post("/forms/:id/submissions/export-pdf", requireAuth, postSubmissionsExportPdf);

// Phase 3 analytics (supersedes basic Phase 2 summary at the same path)
app.get("/forms/:id/analytics", requireAuth, getFormAnalyticsV2);
app.get("/forms/:id/automation-log", requireAuth, getAutomationLog);

app.put("/forms/:id/publish", requireAuth, putFormPublishWithVersion);
app.put("/forms/:id/unpublish", requireAuth, putFormUnpublish);
app.post("/forms/:id/duplicate", requireAuth, postFormDuplicate);
app.post("/forms/:id/favorite", requireAuth, postFormFavorite);

// Phase 4: form-scoped
app.get("/forms/:id/versions", requireAuth, getVersions);
app.get("/forms/:id/versions/:versionId", requireAuth, getVersionById);
app.post("/forms/:id/versions/restore/:versionId", requireAuth, postRestoreVersion);

app.post("/forms/:id/distribute", requireAuth, postDistribute);
app.post("/forms/:id/distribute/bulk", requireAuth, postDistributeBulk);
app.get("/forms/:id/distributions", requireAuth, getDistributionHistory);

app.get("/forms/:id/document-templates", requireAuth, getDocTemplates);
app.post("/forms/:id/document-templates", requireAuth, postDocTemplate);

app.get("/forms/:id/export", requireAuth, getFormExport);

app.get("/forms/:id", requireAuth, getForm);
app.put("/forms/:id", requireAuth, putForm);
app.delete("/forms/:id", requireAuth, deleteForm);

/** Google Review Manager — public tracking + opt-out + pixel (no auth) */
app.get("/reviews/track/:token", getPublicTrack);
app.get("/reviews/optout/:token", getPublicOptOut);
app.get("/reviews/pixel/:token.png", getPublicPixel);
app.get("/reviews/pixel/:token", getPublicPixel);

/** Google Business OAuth (callback is public with signed state) */
app.get("/auth/google-business", requireAuth, getGoogleBusinessConnect);
app.get("/auth/google-business/callback", getGoogleBusinessCallback);
app.post("/reviews/google/authorize-url", requireAuth, postGoogleBusinessAuthorizeUrl);
app.delete("/reviews/google/connection", requireAuth, requireAdminRole, deleteGoogleBusinessConnection);
app.get("/reviews/google/accounts", requireAuth, getGoogleAccounts);
app.get("/reviews/google/accounts/:accountId/locations", requireAuth, getGoogleLocationsForAccount);
app.put("/reviews/google/selection", requireAuth, requireAdminRole, putGoogleSelection);
app.post("/reviews/google/auto-discover", requireAuth, requireAdminRole, postGoogleAutoDiscover);

/** Reviews setup + stats + sync */
app.get("/reviews/setup", requireAuth, getReviewsSetup);
app.put("/reviews/setup/url", requireAuth, requireAdminRole, putReviewUrl);
app.get("/reviews/stats", requireAuth, getReviewStats);
app.post("/reviews/sync", requireAuth, postReviewSync);

/** Reviews CRUD (inbox) */
app.get("/reviews", requireAuth, getReviews);
app.get("/reviews/analytics", requireAuth, getReviewsAnalytics);
app.get("/reviews/leaderboard", requireAuth, getLeaderboard);

/** Templates */
app.get("/reviews/templates", requireAuth, getReviewTemplates);
app.post("/reviews/templates", requireAuth, postReviewTemplate);
app.get("/reviews/templates/:id", requireAuth, getReviewTemplate);
app.put("/reviews/templates/:id", requireAuth, putReviewTemplate);
app.delete("/reviews/templates/:id", requireAuth, deleteReviewTemplate);
app.post("/reviews/templates/:id/duplicate", requireAuth, postReviewTemplateDuplicate);

/** Requests */
app.get("/reviews/requests", requireAuth, getRequests);
app.post("/reviews/requests/send", requireAuth, postSendRequest);
app.post("/reviews/requests/send-bulk", requireAuth, postSendBulk);
app.post("/reviews/requests/send-from-appfolio", requireAuth, postSendFromAppfolio);
app.get("/reviews/requests/:id", requireAuth, getRequestById);

/** Automations */
app.get("/reviews/automations", requireAuth, getAutomations);
app.post("/reviews/automations", requireAuth, requireAdminRole, postAutomation);
app.get("/reviews/automations/:id", requireAuth, getAutomationById);
app.put("/reviews/automations/:id", requireAuth, requireAdminRole, putAutomation);
app.delete("/reviews/automations/:id", requireAuth, requireAdminRole, deleteAutomation);
app.put("/reviews/automations/:id/toggle", requireAuth, requireAdminRole, putAutomationToggle);
app.post("/reviews/automations/:id/test", requireAuth, postReviewAutomationTest);

/** Individual review actions (registered after static routes above) */
app.get("/reviews/:id", requireAuth, getReviewById);
app.put("/reviews/:id/read", requireAuth, putReviewRead);
app.put("/reviews/:id/flag", requireAuth, putReviewFlag);
app.put("/reviews/:id/tags", requireAuth, putReviewTags);
app.put("/reviews/:id/notes", requireAuth, putReviewNotes);
app.post("/reviews/:id/reply", requireAuth, postReviewReply);
app.delete("/reviews/:id/reply", requireAuth, deleteReviewReply);
app.post("/reviews/:id/ai-suggest", requireAuth, postReviewAiSuggest);

/** E-signatures (Docuseal). Webhook is public so Docuseal can call it server-to-server. */
app.post("/esign/webhook", postEsignWebhook);
app.get("/esign/templates", requireAuth, getEsignTemplates);
app.get("/esign/templates/:id", requireAuth, getEsignTemplate);
app.post("/esign/send", requireAuth, postEsignSend);
app.get("/esign/requests", requireAuth, getEsignRequests);
app.get("/esign/requests/:id/status", requireAuth, getEsignRequestStatus);
app.get("/esign/requests/:id/download", requireAuth, getEsignRequestDownload);
app.post("/esign/requests/:id/resend", requireAuth, postEsignRequestResend);
app.delete("/esign/requests/:id", requireAuth, deleteEsignRequest);

// Phase 7 (Unification): the System B board/item/subitem/template/
// dashboard routes are gone — their tables were dropped in migration
// 035. Boards are now views of processes (see processes.js). The
// surviving mb_* endpoints are the Phase 4 updates feed (rekeyed to
// process_id) and the AppFolio webhook receiver.

// Updates feed — comments/replies/reactions/attachments/mentions.
// Routes are unchanged at the URL level; the handlers in mbItemDetail.js
// now accept process_id where they previously took item_id.
app.get("/mb/items/:id/updates", requireAuth, listMbDetailUpdates);
app.post("/mb/items/:id/updates", requireAuth, createMbDetailUpdate);
app.post("/mb/updates/:id/replies", requireAuth, createMbReply);
app.patch("/mb/updates/:id", requireAuth, updateMbOwnComment);
app.delete("/mb/updates/:id", requireAuth, deleteMbOwnComment);
app.post("/mb/updates/:id/reactions", requireAuth, addMbReaction);
app.delete("/mb/updates/:id/reactions", requireAuth, removeMbReaction);
app.post(
  "/mb/updates/:id/attachments",
  requireAuth,
  uploadMbAttachmentMiddleware,
  createMbAttachment
);
app.delete("/mb/attachments/:id", requireAuth, deleteMbAttachment);
app.get("/mb/attachments/:id/download", requireAuthOrQueryToken, downloadMbAttachment);
app.post("/mb/items/:id/mark-mentions-seen", requireAuth, markMbMentionsSeen);
app.get("/mb/mentions/unseen", requireAuth, listMbUnseenMentions);

/** AppFolio webhook receiver (public — AppFolio server-to-server). JWS verification is Phase 2. */
app.post("/webhooks/appfolio", receiveMbAppfolioWebhook);

/** AppFolio Database API webhooks (Phase 3.5 doorbell — public, token in path).
 *  404s unless APPFOLIO_WEBHOOK_TOKEN is set and matches. */
app.post("/webhooks/appfolio-db/:token", receiveAppfolioDbWebhook);

/**
 * Prestige Connect webhook receivers (OpenPhone + Microsoft Graph).
 * AppFolio uses receiveMbAppfolioWebhook above, which now also mirrors
 * onto the new `events` table.
 */
app.post("/webhooks/openphone", receiveOpenPhoneWebhook);
app.post("/webhooks/ms-graph", receiveMsGraphWebhook);

// Prestige Connect — Automations CRUD + run history.
app.get("/automations/meta", requireAuth, getConnectAutomationMeta);
app.get("/automations", requireAuth, listConnectAutomations);
app.post("/automations", requireAuth, createConnectAutomation);
app.get("/automations/:id", requireAuth, getConnectAutomation);
app.put("/automations/:id", requireAuth, updateConnectAutomation);
app.delete("/automations/:id", requireAuth, deleteConnectAutomation);
app.get("/automations/:id/runs", requireAuth, listConnectAutomationRuns);
app.get("/automations/:id/runs/:runId", requireAuth, getConnectAutomationRun);
app.post("/automations/:id/runs/:runId/retry", requireAuth, retryConnectRunNow);
app.post("/automations/:id/test", requireAuth, testConnectAutomation);

/** Contacts hub (PR 1). Merge + resync are admin-gated; the rest is team-wide. */
app.get("/contacts", requireAuth, listContacts);
/** Process People panel (Contacts PR 2). */
app.get("/processes/:id/contacts", requireAuth, listProcessContacts);
app.post("/processes/:id/contacts", requireAuth, addProcessContact);
app.delete("/processes/:id/contacts/:rowId", requireAuth, removeProcessContact);
app.post("/contacts", requireAuth, createContact);
app.post("/contacts/resync", requireAuth, requireAdminRole, resyncContacts);
app.get("/contacts/:id", requireAuth, getContact);
app.patch("/contacts/:id", requireAuth, updateContact);
app.delete("/contacts/:id", requireAuth, archiveContact);
app.post("/contacts/:id/merge", requireAuth, requireAdminRole, mergeContacts);

async function start() {
  if (process.env.DATABASE_URL) {
    // Each schema applier is wrapped in its own try/catch so a single
    // failure does not skip every downstream applier. Prior behavior used
    // a single try/catch and silently lost ~10 schemas downstream of the
    // first failure (the symptom was missing mb_* and agent_hub_phase{3,4}
    // tables even though Phase 1 had been merged — see PR fix landing
    // alongside Phase 3).
    const steps = [
      ["owner_termination_requests", ensureOwnerTerminationSchema],
      ["announcements", ensureAnnouncementsSchema],
      ["cached dashboard / sync_log", ensureCachedDashboardSchema],
      ["users", ensureUsersSchema],
      ["EOS", ensureEosSchema],
      ["portfolio_snapshots", ensurePortfolioSnapshotsSchema],
      ["individual scorecards", ensureIndividualScorecardSchema],
      ["ask_ai_history", ensureAskAiSchema],
      ["ai_failover_log", ensureAiFailoverLogSchema],
      ["ai_templates", ensureAiTemplatesSchema],
      ["inbox / tickets", ensureInboxSchema],
      // Video library: folder table must exist before videos.folder_id migration.
      ["video_folders", ensureVideoFoldersTable],
      ["videos", ensureVideosSchema],
      ["wiki", ensureWikiSchema],
      ["playbooks", ensurePlaybookSchema],
      ["maintenance dashboard", ensureMaintenanceDashboardSchema],
      ["files / file_folders", ensureFilesSchema],
      ["walkthru reports", ensureWalkthruSchema],
      ["marketing", ensureMarketingSchema],
      ["agents", ensureAgentsSchema],
      ["operations / tasks", ensureOperationsSchema],
      ["forms", ensureFormsSchema],
      ["forms phase 3", ensureFormsPhase3Schema],
      ["forms phase 4", ensureFormsPhase4Schema],
      ["form starter templates", ensureFormTemplates],
      ["user_layout_preferences", ensureLayoutPreferencesSchema],
      ["reviews + templates + automations + leaderboard", ensureReviewsSchema],
      ["esign_requests", ensureEsignSchema],
      ["documents", ensureDocumentsSchema],
      ["mailers + mailer_events", ensureMailersSchema],
      ["agent_hub_*", ensureAgentHubSchema],
      ["agent_hub_* phase 2", ensureAgentHubPhase2Schema],
      ["agent_hub_* phase 3", ensureAgentHubPhase3Schema],
      ["agent_hub_* phase 4", ensureAgentHubPhase4Schema],
      // Phase 7 (Unification): one applier that creates surviving
      // mb_* tables (updates feed + AppFolio logs) and runs the
      // 035_unification migration. The older per-phase appliers are
      // gone — Phase 7's migration drops their tables.
      ["mb_* unification (Phase 7)", ensureMbUnifiedSchema],
      // Prestige Connect Phase 1: event bus + automations engine.
      ["automations / events", ensureAutomationsSchema],
      // Contacts hub (PR 1): stable identity layer over the AppFolio cache.
      ["contacts + contact_identities", ensureContactsSchema],
      // Contacts hub (PR 2): process links + per-template roles.
      ["process_contacts + contact_roles", ensureProcessContactsSchema],
      // AppFolio Database API mirror tables in the dedicated `appfolio`
      // schema (properties, units, tenants, leases, sync_state).
      // Backfill is manual: scripts/backfill-appfolio-db.js.
      ["appfolio.* mirror tables", ensureAfMirrorSchema],
      // Maintenance Management System (Phase 1). Runs AFTER the appfolio
      // mirror: maint_jobs / maint_projects carry TEXT FKs into appfolio.*.
      ["maint_* (maintenance management)", ensureMaintSchema],
    ];
    let failures = 0;
    for (const [label, fn] of steps) {
      try {
        await fn();
        console.log(`Database schema OK (${label}).`);
      } catch (e) {
        failures += 1;
        const msg = e && e.message ? e.message : String(e);
        console.error(`Database schema FAILED (${label}): ${msg}`);
      }
    }
    if (failures > 0) {
      console.error(
        `Database schema: ${failures} of ${steps.length} applier(s) failed — see lines above.`
      );
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

    // AppFolio Database API mirror (appfolio.* tables): hourly delta +
    // nightly full pass with missing-sweep. Self-disables (with a log
    // line) when APPFOLIO_SYNC_ENABLED=false or DB-API creds are absent.
    ensureAppfolioSyncScheduled();

    // Phase 3.5: webhook doorbell processor (15s tick). Self-disables
    // when APPFOLIO_WEBHOOK_TOKEN is unset.
    ensureAppfolioWebhookProcessing();

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

    // Phase 2 Agent Hub: refresh agent_hub_agent_lifetime_value materialized
    // view every night at 2:15 AM. We also refresh on-demand inside the
    // payment / revenue / advance-to-active_management handlers, so the
    // nightly run is mostly a safety net for edits that bypass those paths
    // (e.g. direct DB tweaks).
    cron.schedule("15 2 * * *", () => {
      refreshAgentLifetimeValue().catch((e) =>
        console.error("[agent-hub LTV cron]", e.message || e)
      );
    });
    console.log("Scheduled Agent Hub LTV refresh: 15 2 * * * (daily at 2:15 AM).");

    // Phase 3 Agent Hub engine workers.
    // Trigger evaluator: scans time-based automations every 15 minutes
    // and creates pending_approval (or approved) runs for eligible agents.
    cron.schedule("*/15 * * * *", () => {
      agentHubEvaluateTriggers().catch((e) =>
        console.error("[agent-hub engine evaluate]", e.message || e)
      );
    });
    console.log("Scheduled Agent Hub trigger evaluator: */15 * * * * (every 15 min).");

    // Action executor: drains the action queue every 5 minutes. Locks
    // batches with FOR UPDATE SKIP LOCKED so concurrent crons can't double-send.
    cron.schedule("*/5 * * * *", () => {
      agentHubExecuteActions().catch((e) =>
        console.error("[agent-hub engine execute]", e.message || e)
      );
    });
    console.log("Scheduled Agent Hub action executor: */5 * * * * (every 5 min).");

    // Approval window reaper: cancels pending_approval runs whose
    // approval_required_until has passed.
    cron.schedule("0 * * * *", () => {
      agentHubReapApprovalWindow().catch((e) =>
        console.error("[agent-hub engine reap]", e.message || e)
      );
    });
    console.log("Scheduled Agent Hub approval reaper: 0 * * * * (hourly).");

    // Reply detector: polls Microsoft Graph for replies and pauses
    // automations on reply.
    cron.schedule("*/15 * * * *", () => {
      agentHubDetectReplies().catch((e) =>
        console.error("[agent-hub engine reply-detect]", e.message || e)
      );
    });
    console.log("Scheduled Agent Hub reply detector: */15 * * * * (every 15 min).");

    // Phase 4 intelligence layer:
    //   3:00 AM — engagement scores (full recompute)
    //   3:30 AM — predictive flags
    //   4:00 AM — cohort metrics + maintain quarterly cohorts
    //   5:00 AM — score history archival + log retention
    cron.schedule("0 3 * * *", () => {
      agentHubRecomputeScores().catch((e) =>
        console.error("[agent-hub intel scores]", e.message || e)
      );
    });
    console.log("Scheduled Agent Hub engagement scoring: 0 3 * * * (daily at 3 AM).");

    cron.schedule("30 3 * * *", () => {
      agentHubRefreshFlags().catch((e) =>
        console.error("[agent-hub intel flags]", e.message || e)
      );
    });
    console.log("Scheduled Agent Hub predictive flags: 30 3 * * * (daily at 3:30 AM).");

    cron.schedule("0 4 * * *", () => {
      agentHubRefreshCohorts().catch((e) =>
        console.error("[agent-hub intel cohorts]", e.message || e)
      );
    });
    console.log("Scheduled Agent Hub cohort refresh: 0 4 * * * (daily at 4 AM).");

    cron.schedule("0 5 * * *", () => {
      agentHubArchiveScores().catch((e) =>
        console.error("[agent-hub intel archive]", e.message || e)
      );
    });
    console.log("Scheduled Agent Hub score archival: 0 5 * * * (daily at 5 AM).");

    cron.schedule("0 * * * *", () => {
      processDelayedAutoCompletes().catch((e) =>
        console.error("[automation delay cron]", e.message || e)
      );
    });
    console.log("Scheduled process automation delay check: 0 * * * * (hourly).");

    // Maintenance Phase 2: daily COI-expiry scan → SMS digest to
    // MAINT_ALERT_PHONE (skips gracefully if unset) + Connect events.
    cron.schedule("0 7 * * *", () => {
      runCoiExpiryCheck().catch((e) =>
        console.error("[coi-alert cron]", e.message || e)
      );
    });
    console.log("Scheduled subcontractor COI expiry check: 0 7 * * * (daily at 7 AM).");

    // Phase 4: autopilot rule firing every minute and scheduled email/SMS
    // sends every 5 minutes.
    cron.schedule("* * * * *", () => {
      runAutopilotCheck().catch((e) =>
        console.error("[autopilot cron]", e.message || e)
      );
    });
    console.log("Scheduled autopilot check: * * * * * (every minute).");

    cron.schedule("*/5 * * * *", () => {
      executeScheduledSteps().catch((e) =>
        console.error("[scheduled-steps cron]", e.message || e)
      );
    });
    console.log("Scheduled step executor: */5 * * * * (every 5 minutes).");

    // Phase 7.4.1: auto stage-change step dispatcher (every 5 minutes).
    cron.schedule("*/5 * * * *", () => {
      executeAutoStageChanges().catch((e) =>
        console.error("[auto-stage cron]", e.message || e)
      );
    });
    console.log("Scheduled auto stage-change dispatcher: */5 * * * * (every 5 minutes).");

    // Phase 6: AI suggestions every 15 minutes (cost-aware skip when no recent activity).
    cron.schedule("*/15 * * * *", () => {
      runAIAnalysis().catch((e) =>
        console.error("[ai-suggestions cron]", e.message || e)
      );
    });
    console.log("Scheduled AI suggestions analysis: */15 * * * * (every 15 minutes).");

    // Phase 6: AI daily digest at 6:30 AM Central.
    cron.schedule(
      "30 6 * * *",
      () => {
        sendDailyDigest().catch((e) =>
          console.error("[ai-digest cron]", e.message || e)
        );
      },
      { timezone: "America/Chicago" }
    );
    console.log("Scheduled AI daily digest: 30 6 * * * America/Chicago.");

    cron.schedule("15 * * * *", () => {
      runTimeBasedConditions().catch((e) =>
        console.error("[condition time cron]", e.message || e)
      );
    });
    console.log("Scheduled time-based condition check: 15 * * * * (hourly, offset).");

    cron.schedule("30 3 * * *", () => {
      purgeExpiredRecycleBin().catch((e) =>
        console.error("[recycle-bin cron]", e.message || e)
      );
    });
    console.log("Scheduled recycle-bin purge: 30 3 * * * (daily 3:30 AM).");

    // Mailer tracking is now pushed by LetterStream's webhook every ~4 hours
    // (POST /api/mailers/webhook/letterstream). No cron poll needed; on-demand
    // refresh is available via GET /api/mailers/:id/tracking.

    cron.schedule("*/30 * * * *", () => {
      syncGoogleReviews({ trigger: "cron" }).catch((e) =>
        console.error("[reviews sync cron]", e.message || e)
      );
    });
    console.log("Scheduled Google reviews sync: */30 * * * * (every 30 min).");

    cron.schedule("30 * * * *", () => {
      processPendingRequests().catch((e) =>
        console.error("[reviews pending cron]", e.message || e)
      );
    });
    console.log("Scheduled pending review request dispatch: 30 * * * * (hourly).");

    cron.schedule("0 9 * * *", () => {
      processScheduledAutomations().catch((e) =>
        console.error("[reviews scheduled automations]", e.message || e)
      );
    });
    console.log("Scheduled recurring review automations: 0 9 * * * (daily 9am).");

    cron.schedule("5 0 * * *", () => {
      recalculateAllLeaderboards().catch((e) =>
        console.error("[reviews leaderboard cron]", e.message || e)
      );
    });
    console.log("Scheduled review leaderboard recalc: 5 0 * * * (daily midnight).");

    // Take initial snapshot on startup if none exists today
    takePortfolioSnapshot().catch((e) => console.error("[portfolio snapshot startup]", e.message || e));
  }
}

start();
