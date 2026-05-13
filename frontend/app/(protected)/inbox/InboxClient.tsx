"use client";

import { useCallback, useState } from "react";
import { useAuth } from "../../../context/AuthContext";
import DetailPanelContainer from "../../../components/inbox/DetailPanelContainer";
import ErrorBoundary from "../../../components/inbox/ErrorBoundary";
import FilterBar from "../../../components/inbox/FilterBar";
import InboxList from "../../../components/inbox/InboxList";
import InboxTopBar from "../../../components/inbox/InboxTopBar";
import MailboxSidebar from "../../../components/inbox/MailboxSidebar";
import SaveViewModal from "../../../components/inbox/SaveViewModal";
import ToastContainer from "../../../components/inbox/ToastContainer";
import ViewsSection from "../../../components/inbox/ViewsSection";
import useAIDraft from "../../../hooks/inbox/useAIDraft";
import useBatchAIDraft from "../../../hooks/inbox/useBatchAIDraft";
import useCompose from "../../../hooks/inbox/useCompose";
import useInboxActions from "../../../hooks/inbox/useInboxActions";
import useMailboxes from "../../../hooks/inbox/useMailboxes";
import useResponsiveLayout from "../../../hooks/inbox/useResponsiveLayout";
import useSavedViews, {
  type SavedView,
  type SavedViewFilters,
} from "../../../hooks/inbox/useSavedViews";
import useSLA from "../../../hooks/inbox/useSLA";
import useStats from "../../../hooks/inbox/useStats";
import useSyncHealthReporter from "../../../hooks/inbox/useSyncHealthReporter";
import useTeamUsers from "../../../hooks/inbox/useTeamUsers";
import useThreadDetail from "../../../hooks/inbox/useThreadDetail";
import useThreadList from "../../../hooks/inbox/useThreadList";
import {
  NotificationProvider,
  useNotificationCenter,
} from "../../../hooks/inbox/useNotificationCenter";
import { ToastProvider, useToast } from "../../../hooks/inbox/useToast";
import styles from "./inbox.module.css";

export default function InboxClient() {
  return (
    <ToastProvider>
      <NotificationProvider>
        <InboxOrchestrator />
        <ToastContainer />
      </NotificationProvider>
    </ToastProvider>
  );
}

function InboxOrchestrator() {
  const { authHeaders, isAdmin, user } = useAuth();
  const toast = useToast();
  const notifications = useNotificationCenter();
  const layout = useResponsiveLayout();

  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [selectedViewId, setSelectedViewId] = useState<number | null>(null);
  const [saveViewOpen, setSaveViewOpen] = useState(false);

  const stats = useStats();
  const teamUsers = useTeamUsers();
  const mailboxes = useMailboxes();
  useSyncHealthReporter(mailboxes.mailboxes, notifications);
  const savedViews = useSavedViews();
  const list = useThreadList({
    connectionId: mailboxes.currentMailbox,
    viewId: selectedViewId,
    onUserFilterChange: () => setSelectedViewId(null),
  });
  const batch = useBatchAIDraft();

  const detail = useThreadDetail({
    selectedThreadId,
    onThreadChanged: (threadId, patch) => {
      list.patchThread(threadId, patch);
      void stats.refetch();
    },
    onAiDraftSeed: (ad) => {
      compose.setBody(ad.draft_text);
      compose.setMode("reply");
      compose.setExpanded(true);
      aiDraft.showBanner(ad.context_used);
    },
  });

  // useAIDraft is keyed on the seed ticket id (Graph-side reply target). When
  // the active thread changes, the seed changes and the banner resets.
  const aiDraft = useAIDraft({ ticketId: detail.seedTicketId });

  const readOnlyMailbox = detail.thread?.my_permission === "read";
  const compose = useCompose({
    threadId: selectedThreadId,
    seedTicketId: detail.seedTicketId,
    readOnly: readOnlyMailbox,
  });
  const slaView = useSLA(detail.thread);

  const canMetaMailbox =
    !!detail.thread &&
    (detail.thread.my_permission === "reply" ||
      detail.thread.my_permission === "admin" ||
      detail.thread.my_permission == null);

  const actions = useInboxActions({
    selectedThreadId,
    setSelectedThreadId,
    authHeaders,
    toast,
    notifications,
    detail,
    compose,
    aiDraft,
    batch,
    list,
    stats,
    mailboxes,
    layout,
    setSyncBusy,
  });

  const eligibleBatchCount = batch.selectEligible(list.threads).length;

  const applyView = useCallback((view: SavedView) => {
    setSelectedViewId(view.id);
    layout.setSidebarOpen(false);
  }, [layout]);

  const captureCurrentFilters = useCallback((): SavedViewFilters => {
    const f = list.filters;
    const out: SavedViewFilters = {};
    if (f.bucket && f.bucket !== "open") out.bucket = f.bucket;
    if (f.narrowStatus) out.status = f.narrowStatus;
    if (f.category) out.category = f.category;
    if (f.teamUserId != null) out.assignedTo = f.teamUserId;
    if (f.search) out.search = f.search;
    if (mailboxes.currentMailbox != null) out.connectionId = mailboxes.currentMailbox;
    return out;
  }, [list.filters, mailboxes.currentMailbox]);

  const handleSaveView = useCallback(
    async ({ name, icon, is_shared }: { name: string; icon?: string | null; is_shared?: boolean }) => {
      const filters = captureCurrentFilters();
      const sort = list.filters.sort && list.filters.sort !== "newest" ? { sort: list.filters.sort } : null;
      const r = await savedViews.create({ name, icon: icon ?? null, filters, sort, is_shared });
      if (!r.ok) throw new Error(r.error);
      toast.push({ variant: "success", message: `Saved "${name}"` });
      setSelectedViewId(r.data.id);
    },
    [captureCurrentFilters, list.filters.sort, savedViews, toast]
  );

  const handleDeleteView = useCallback(
    async (view: SavedView) => {
      const r = await savedViews.remove(view.id);
      if (!r.ok) {
        toast.push({ variant: "error", message: `Couldn't delete view — ${r.error}` });
        return;
      }
      if (selectedViewId === view.id) setSelectedViewId(null);
      toast.push({ variant: "success", message: `Deleted "${view.name}"` });
    },
    [savedViews, selectedViewId, toast]
  );

  const layoutClass = [
    styles.layout,
    layout.isMobile && layout.sidebarOpen ? styles.sidebarOpen : "",
    layout.detailOpen ? styles.showDetailMobile : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={styles.page}>
      <InboxTopBar
        stats={stats}
        isAdmin={isAdmin}
        syncBusy={syncBusy}
        onSync={() => void actions.sync()}
        batchBusy={batch.busy}
        batchProgress={batch.progress}
        batchSummary={batch.summary}
        batchEligibleCount={eligibleBatchCount}
        onDraftAllUnread={() => void actions.draftAllUnread()}
      />

      {layout.isMobile && layout.sidebarOpen ? (
        <button
          type="button"
          className={styles.overlaySidebar}
          aria-label="Close menu"
          onClick={() => layout.setSidebarOpen(false)}
        />
      ) : null}

      <div className={layoutClass}>
        <ErrorBoundary label="sidebar">
          <MailboxSidebar
            mailboxes={mailboxes}
            stats={stats}
            teamUsers={teamUsers}
            filters={list.filters}
            applyPreset={list.applyPreset}
            setBucket={list.setBucket}
            setCategory={list.setCategory}
            setNarrowStatus={list.setNarrowStatus}
            setTeamUserId={list.setTeamUserId}
            onItemClick={() => layout.setSidebarOpen(false)}
            onToggleMenu={() => layout.setSidebarOpen(!layout.sidebarOpen)}
            viewsSlot={
              <ViewsSection
                views={savedViews.views}
                loading={savedViews.loading}
                selectedViewId={selectedViewId}
                isAdmin={isAdmin}
                currentUserId={user?.id ?? null}
                onApply={applyView}
                onSaveCurrent={() => setSaveViewOpen(true)}
                onDelete={handleDeleteView}
              />
            }
          />
        </ErrorBoundary>

        <div className={styles.listPanel}>
          <ErrorBoundary label="ticket list">
            <FilterBar
              search={list.filters.search}
              setSearch={list.setSearch}
              sort={list.filters.sort}
              setSort={list.setSort}
            />
            <InboxList
              list={list}
              selectedThreadId={selectedThreadId}
              onSelect={actions.openThread}
              onToggleStar={(e, t) => {
                e.stopPropagation();
                void actions.toggleStar(t);
              }}
            />
          </ErrorBoundary>
        </div>

        <SaveViewModal
          open={saveViewOpen}
          isAdmin={isAdmin}
          defaultName=""
          initialFilters={captureCurrentFilters()}
          onClose={() => setSaveViewOpen(false)}
          onSave={handleSaveView}
        />

        <DetailPanelContainer
          selectedThreadId={selectedThreadId}
          detail={detail}
          teamUsers={teamUsers}
          slaView={slaView}
          canMetaMailbox={canMetaMailbox}
          canReplyMailbox={canMetaMailbox}
          compose={compose}
          aiDraft={aiDraft}
          onCloseMobile={() => layout.setDetailOpen(false)}
          onToggleStar={(t) => void actions.toggleStar(t)}
          onUpdate={(patch) => void actions.update(patch)}
          onRunAiDraft={() => void actions.runAiDraft()}
          onDismissAiDraft={() => void actions.dismissAiDraft()}
          onSend={() => void actions.send()}
        />
      </div>
    </div>
  );
}
