"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../../context/AuthContext";
import DetailPanelContainer from "../../../components/inbox/DetailPanelContainer";
import ErrorBoundary from "../../../components/inbox/ErrorBoundary";
import FilterBar from "../../../components/inbox/FilterBar";
import FilterDrawer from "../../../components/inbox/FilterDrawer";
import InboxList from "../../../components/inbox/InboxList";
import InboxTopBar from "../../../components/inbox/InboxTopBar";
import SaveViewModal from "../../../components/inbox/SaveViewModal";
import { useInboxShell } from "../../../components/inbox/shell/InboxShellContext";
import useAIDraft from "../../../hooks/inbox/useAIDraft";
import useBatchAIDraft from "../../../hooks/inbox/useBatchAIDraft";
import useCompose from "../../../hooks/inbox/useCompose";
import useInboxActions from "../../../hooks/inbox/useInboxActions";
import useResponsiveLayout from "../../../hooks/inbox/useResponsiveLayout";
import { useNotificationCenter } from "../../../hooks/inbox/useNotificationCenter";
import { useToast } from "../../../hooks/inbox/useToast";
import useSLA from "../../../hooks/inbox/useSLA";
import useSyncHealthReporter from "../../../hooks/inbox/useSyncHealthReporter";
import useTeamUsers from "../../../hooks/inbox/useTeamUsers";
import useThreadDetail from "../../../hooks/inbox/useThreadDetail";
import useThreadList from "../../../hooks/inbox/useThreadList";
import type { SavedViewFilters } from "../../../hooks/inbox/useSavedViews";
import styles from "./inbox.module.css";

export default function InboxClient() {
  // The /inbox layout already supplies ToastProvider, NotificationProvider,
  // and InboxShellProvider. This component just orchestrates the inbox
  // content pane.
  return <InboxOrchestrator />;
}

function InboxOrchestrator() {
  const { authHeaders, isAdmin } = useAuth();
  const toast = useToast();
  const notifications = useNotificationCenter();
  const layout = useResponsiveLayout();
  const { mailboxes, stats, savedViews, section, setMobileDrawerOpen } = useInboxShell();

  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [selectedViewId, setSelectedViewId] = useState<number | null>(null);
  const [saveViewOpen, setSaveViewOpen] = useState(false);

  const teamUsers = useTeamUsers();
  useSyncHealthReporter(mailboxes.mailboxes, notifications);

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

  // ── Section → list filter wiring ────────────────────────────────────
  // The shell sidebar drives the `section` value. We translate that into
  // the legacy bucket/status/sort filters that useThreadList already knows
  // how to apply. `applyPreset` short-circuits filter-change events so the
  // selected saved view isn't cleared.
  const lastSectionKeyRef = useRef<string>("");
  useEffect(() => {
    const key = JSON.stringify(section);
    if (lastSectionKeyRef.current === key) return;
    lastSectionKeyRef.current = key;
    switch (section.kind) {
      case "personal":
        if (section.bucket === "open") list.applyPreset("open");
        else if (section.bucket === "assignedToMe") list.applyPreset("assignedToMe");
        // mentions/drafts: disabled in sidebar; ignored if dispatched.
        setSelectedViewId(null);
        break;
      case "mailbox":
        list.applyPreset("open");
        setSelectedViewId(null);
        break;
      case "builtin":
        if (section.key === "all-open") list.applyPreset("open");
        else if (section.key === "starred") list.applyPreset("starred");
        else if (section.key === "snoozed") {
          list.setBucket("all");
          list.setNarrowStatus("snoozed");
          list.setCategory(null);
          list.setTeamUserId(null);
        } else if (section.key === "sla-at-risk") {
          // No dedicated SLA filter on the API yet; the closest visual
          // approximation is "oldest open threads bubble up." Sorted by
          // oldest so threads near their deadline appear first.
          list.applyPreset("open");
          list.setSort("oldest");
        }
        setSelectedViewId(null);
        break;
      case "view":
        setSelectedViewId(section.viewId);
        break;
    }
    // Intentionally only re-run when `section` identity changes — the
    // list mutators are stable refs from useThreadList.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  // ── Save-view modal trigger from sidebar (+ button on VIEWS header) ──
  useEffect(() => {
    const onOpen = () => setSaveViewOpen(true);
    window.addEventListener("inbox:open-save-view", onOpen);
    return () => window.removeEventListener("inbox:open-save-view", onOpen);
  }, []);

  // ── Save-view helpers (unchanged from pre-D0) ────────────────────────
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

  // ── Inbox content layout (single-pane shell + list + detail) ─────────
  const layoutClass = [
    styles.layout,
    styles.layoutNoSidebar,
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
        onOpenMenu={() => setMobileDrawerOpen(true)}
      />

      <div className={layoutClass}>
        <div className={styles.listPanel}>
          <ErrorBoundary label="ticket list">
            <FilterBar
              search={list.filters.search}
              setSearch={list.setSearch}
              sort={list.filters.sort}
              setSort={list.setSort}
            />
            <FilterDrawer
              filters={list.filters}
              teamUsers={teamUsers}
              setBucket={list.setBucket}
              setCategory={list.setCategory}
              setNarrowStatus={list.setNarrowStatus}
              setTeamUserId={list.setTeamUserId}
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
