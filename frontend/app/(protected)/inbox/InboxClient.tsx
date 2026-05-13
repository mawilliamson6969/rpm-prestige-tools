"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../../context/AuthContext";
import ErrorBoundary from "../../../components/inbox/ErrorBoundary";
import InboxTopBar from "../../../components/inbox/InboxTopBar";
import SaveViewModal from "../../../components/inbox/SaveViewModal";
import ConversationList, {
  type Density,
} from "../../../components/inbox/conversation/ConversationList";
import ConversationView from "../../../components/inbox/conversation/ConversationView";
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
import useThreadAutomations from "../../../hooks/inbox/useThreadAutomations";
import useThreadDetail from "../../../hooks/inbox/useThreadDetail";
import useThreadList from "../../../hooks/inbox/useThreadList";
import type { SavedViewFilters } from "../../../hooks/inbox/useSavedViews";
import { apiUrl } from "../../../lib/api";
import { parseApiError } from "../../../lib/apiResult";
import styles from "./inbox.module.css";

type StatusTab = "open" | "snoozed" | "closed" | "all";

const DENSITY_LS = "rpm-inbox-density";
const STATUS_TAB_LS_PREFIX = "rpm-inbox-status:";

function readDensity(): Density {
  if (typeof window === "undefined") return "cozy";
  try {
    const v = localStorage.getItem(DENSITY_LS);
    if (v === "compact" || v === "cozy" || v === "comfortable") return v;
  } catch {
    /* ignore */
  }
  return "cozy";
}

function readStatusForKey(key: string): StatusTab {
  if (typeof window === "undefined") return "open";
  try {
    const v = localStorage.getItem(STATUS_TAB_LS_PREFIX + key);
    if (v === "open" || v === "snoozed" || v === "closed" || v === "all") return v;
  } catch {
    /* ignore */
  }
  return "open";
}

export default function InboxClient() {
  // The /inbox layout supplies the Toast / Notification / InboxShell
  // providers. This component just orchestrates the inbox content pane.
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

  // Density preference — persisted, applied to the list.
  const [density, setDensityState] = useState<Density>("cozy");
  useEffect(() => {
    setDensityState(readDensity());
  }, []);
  const setDensity = useCallback((next: Density) => {
    setDensityState(next);
    try {
      localStorage.setItem(DENSITY_LS, next);
    } catch {
      /* ignore */
    }
  }, []);

  const teamUsers = useTeamUsers();
  useSyncHealthReporter(mailboxes.mailboxes, notifications);

  const list = useThreadList({
    connectionId: mailboxes.currentMailbox,
    viewId: selectedViewId,
    onUserFilterChange: () => setSelectedViewId(null),
  });
  const batch = useBatchAIDraft();

  // Status tab — D0-aligned (Open/Snoozed/Closed/All). Persisted per mailbox
  // so each shared inbox remembers its own tab. The mailbox key falls back
  // to "__all__" for the all-mailboxes view and to the section key for
  // personal / builtin / saved-view sections.
  const statusKey = useMemo(() => {
    if (section.kind === "mailbox") return `mb:${section.connectionId}`;
    if (section.kind === "view") return `view:${section.viewId}`;
    if (section.kind === "builtin") return `builtin:${section.key}`;
    return `personal:${section.kind === "personal" ? section.bucket : "open"}`;
  }, [section]);
  const [statusTab, setStatusTab] = useState<StatusTab>("open");
  useEffect(() => {
    setStatusTab(readStatusForKey(statusKey));
  }, [statusKey]);
  const onStatusChange = useCallback(
    (next: StatusTab) => {
      setStatusTab(next);
      try {
        localStorage.setItem(STATUS_TAB_LS_PREFIX + statusKey, next);
      } catch {
        /* ignore */
      }
      // Update the list filter to match. The bucket stays bound to the
      // sidebar's section (Inbox / Assigned / Builtin); the status tab
      // narrows it further.
      list.setNarrowStatus(next === "all" || next === "open" ? null : next);
      // The "Open" tab maps to status=open exactly (excludes snoozed). The
      // legacy bucket=open used `<> closed`, so we also need to push status
      // into the API call. We do that by setting narrowStatus=null and
      // letting the trigger include all open threads — for explicit Open we
      // override narrowStatus.
      if (next === "open") list.setNarrowStatus("open");
      if (next === "closed") list.setNarrowStatus("closed");
    },
    [list, statusKey]
  );
  // Re-apply the persisted status when the active key changes (mailbox
  // switch, view select, etc.).
  useEffect(() => {
    const persisted = readStatusForKey(statusKey);
    if (persisted === "open") list.setNarrowStatus("open");
    else if (persisted === "all") list.setNarrowStatus(null);
    else list.setNarrowStatus(persisted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusKey]);

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
  // Phase 4: pending suggested actions + recent auto firings on this thread.
  const automations = useThreadAutomations(selectedThreadId);

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
  const lastSectionKeyRef = useRef<string>("");
  useEffect(() => {
    const key = JSON.stringify(section);
    if (lastSectionKeyRef.current === key) return;
    lastSectionKeyRef.current = key;
    switch (section.kind) {
      case "personal":
        if (section.bucket === "open") list.applyPreset("open");
        else if (section.bucket === "assignedToMe") list.applyPreset("assignedToMe");
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
          // Phase 3: real filter — open, not paused, due within 2h or
          // already breached. Highest-priority first to bubble emergency
          // threads up.
          list.applyPreset("open");
          list.setSlaAtRisk(true);
          list.setSort("priority");
        }
        setSelectedViewId(null);
        break;
      case "view":
        setSelectedViewId(section.viewId);
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  // ── Save-view modal trigger from sidebar (+ button on VIEWS header) ──
  useEffect(() => {
    const onOpen = () => setSaveViewOpen(true);
    window.addEventListener("inbox:open-save-view", onOpen);
    return () => window.removeEventListener("inbox:open-save-view", onOpen);
  }, []);

  // ── Save-view helpers ──────────────────────────────────────────────
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
    async ({
      name,
      icon,
      is_shared,
    }: {
      name: string;
      icon?: string | null;
      is_shared?: boolean;
    }) => {
      const filters = captureCurrentFilters();
      const sort =
        list.filters.sort && list.filters.sort !== "newest" ? { sort: list.filters.sort } : null;
      const r = await savedViews.create({ name, icon: icon ?? null, filters, sort, is_shared });
      if (!r.ok) throw new Error(r.error);
      toast.push({ variant: "success", message: `Saved "${name}"` });
      setSelectedViewId(r.data.id);
    },
    [captureCurrentFilters, list.filters.sort, savedViews, toast]
  );

  // ── New Phase-1 actions: snooze + tag operations ──────────────────
  const callApi = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const res = await fetch(apiUrl(path), {
        ...init,
        headers: {
          ...authHeaders(),
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers || {}),
        },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = parseApiError(body, res.status);
        throw new Error(err);
      }
      return body;
    },
    [authHeaders]
  );

  const onSnooze = useCallback(
    async (untilIso: string | null) => {
      if (!selectedThreadId) return;
      try {
        const body = await callApi(`/inbox/threads/${selectedThreadId}/snooze`, {
          method: "POST",
          body: JSON.stringify(untilIso ? { until: untilIso } : {}),
        });
        if (body?.thread) {
          list.patchThread(selectedThreadId, body.thread);
          await detail.refetch();
        }
        toast.push({
          variant: "success",
          message: untilIso ? `Snoozed until ${new Date(untilIso).toLocaleString()}` : "Snoozed",
        });
      } catch (e) {
        toast.push({
          variant: "error",
          message: `Couldn't snooze — ${e instanceof Error ? e.message : "unknown error"}`,
        });
      }
    },
    [selectedThreadId, callApi, list, detail, toast]
  );

  const onTagOp = useCallback(
    async (op: { add?: string[]; remove?: string[] }) => {
      if (!selectedThreadId) return;
      try {
        const body = await callApi(`/inbox/threads/${selectedThreadId}/tags`, {
          method: "POST",
          body: JSON.stringify(op),
        });
        if (body?.thread) {
          list.patchThread(selectedThreadId, body.thread);
          await detail.refetch();
        }
      } catch (e) {
        toast.push({
          variant: "error",
          message: `Couldn't update tags — ${e instanceof Error ? e.message : "unknown error"}`,
        });
      }
    },
    [selectedThreadId, callApi, list, detail, toast]
  );

  // ── Title + mailbox label for the list/view ─────────────────────────
  const { listTitle, mailboxLabel } = useMemo(() => {
    if (section.kind === "mailbox") {
      const m = mailboxes.mailboxes.find((x) => x.id === section.connectionId);
      const name = (m?.display_name || m?.mailbox_email || m?.email_address || "Mailbox").trim();
      return { listTitle: name, mailboxLabel: name };
    }
    if (section.kind === "view") {
      const v = savedViews.views.find((x) => x.id === section.viewId);
      return { listTitle: v?.name ?? "View", mailboxLabel: null };
    }
    if (section.kind === "builtin") {
      const map: Record<typeof section.key, string> = {
        "all-open": "All open",
        "sla-at-risk": "SLA at risk",
        snoozed: "Snoozed",
        starred: "Starred",
      };
      return { listTitle: map[section.key], mailboxLabel: null };
    }
    // personal
    if (section.bucket === "assignedToMe") return { listTitle: "Assigned to me", mailboxLabel: null };
    return { listTitle: "Inbox", mailboxLabel: null };
  }, [section, mailboxes.mailboxes, savedViews.views]);

  // ── Inbox content layout ────────────────────────────────────────────
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
        <ErrorBoundary label="conversation list">
          <ConversationList
            title={listTitle}
            list={list}
            status={statusTab}
            onStatusChange={onStatusChange}
            selectedThreadId={selectedThreadId}
            onSelect={actions.openThread}
            onToggleStar={(e, t) => {
              e.stopPropagation();
              void actions.toggleStar(t);
            }}
            density={density}
            onDensityChange={setDensity}
          />
        </ErrorBoundary>

        <SaveViewModal
          open={saveViewOpen}
          isAdmin={isAdmin}
          defaultName=""
          initialFilters={captureCurrentFilters()}
          onClose={() => setSaveViewOpen(false)}
          onSave={handleSaveView}
        />

        <ErrorBoundary label="conversation view">
          <ConversationView
            detail={detail}
            teamUsers={teamUsers}
            slaView={slaView}
            canMetaMailbox={canMetaMailbox}
            canReplyMailbox={canMetaMailbox}
            compose={compose}
            aiDraft={aiDraft}
            mailboxLabel={mailboxLabel}
            onCloseMobile={() => layout.setDetailOpen(false)}
            onToggleStar={(t) => void actions.toggleStar(t)}
            onUpdate={(patch) => void actions.update(patch)}
            onRunAiDraft={() => void actions.runAiDraft()}
            onDismissAiDraft={() => void actions.dismissAiDraft()}
            onSend={() => void actions.send()}
            onSnooze={onSnooze}
            onTagOp={onTagOp}
            onStatusChange={(next) => void actions.update({ status: next })}
            presence={null}
            automations={automations}
            onPatchThreadRefresh={async () => {
              await detail.refetch();
              await stats.refetch();
            }}
          />
        </ErrorBoundary>
      </div>
    </div>
  );
}
