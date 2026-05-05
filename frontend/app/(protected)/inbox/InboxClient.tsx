"use client";

import { useState } from "react";
import { useAuth } from "../../../context/AuthContext";
import DetailPanelContainer from "../../../components/inbox/DetailPanelContainer";
import ErrorBoundary from "../../../components/inbox/ErrorBoundary";
import FilterBar from "../../../components/inbox/FilterBar";
import InboxList from "../../../components/inbox/InboxList";
import InboxTopBar from "../../../components/inbox/InboxTopBar";
import MailboxSidebar from "../../../components/inbox/MailboxSidebar";
import ToastContainer from "../../../components/inbox/ToastContainer";
import useAIDraft from "../../../hooks/inbox/useAIDraft";
import useBatchAIDraft from "../../../hooks/inbox/useBatchAIDraft";
import useCompose from "../../../hooks/inbox/useCompose";
import useInboxActions from "../../../hooks/inbox/useInboxActions";
import useMailboxes from "../../../hooks/inbox/useMailboxes";
import useResponsiveLayout from "../../../hooks/inbox/useResponsiveLayout";
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
  const { authHeaders, isAdmin } = useAuth();
  const toast = useToast();
  const notifications = useNotificationCenter();
  const layout = useResponsiveLayout();

  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);

  const stats = useStats();
  const teamUsers = useTeamUsers();
  const mailboxes = useMailboxes();
  useSyncHealthReporter(mailboxes.mailboxes, notifications);
  const list = useThreadList(mailboxes.currentMailbox);
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
