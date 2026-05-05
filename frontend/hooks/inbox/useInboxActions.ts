"use client";

import { useCallback } from "react";
import { apiUrl } from "../../lib/api";
import { networkErrorMessage, parseApiError } from "../../lib/apiResult";
import type { ThreadRow } from "./types";
import type { UseAIDraft } from "./useAIDraft";
import type { UseBatchAIDraft } from "./useBatchAIDraft";
import type { UseCompose } from "./useCompose";
import type { UseMailboxes } from "./useMailboxes";
import type { UseNotificationCenterValue } from "./useNotificationCenter";
import type { ResponsiveLayout } from "./useResponsiveLayout";
import type { UseStats } from "./useStats";
import type { UseThreadDetail } from "./useThreadDetail";
import type { UseThreadList } from "./useThreadList";
import type { UseToastValue } from "./useToast";

export type UseInboxActionsArgs = {
  selectedThreadId: string | null;
  setSelectedThreadId: (id: string | null) => void;
  authHeaders: () => Record<string, string>;
  toast: UseToastValue;
  notifications: UseNotificationCenterValue;
  detail: UseThreadDetail;
  compose: UseCompose;
  aiDraft: UseAIDraft;
  batch: UseBatchAIDraft;
  list: UseThreadList;
  stats: UseStats;
  mailboxes: UseMailboxes;
  layout: ResponsiveLayout;
  setSyncBusy: (b: boolean) => void;
};

export type InboxActions = {
  openThread: (threadId: string) => void;
  toggleStar: (thread: ThreadRow) => Promise<void>;
  update: (patch: Record<string, unknown>) => Promise<void>;
  sync: () => Promise<void>;
  runAiDraft: () => Promise<void>;
  dismissAiDraft: () => Promise<void>;
  send: () => Promise<void>;
  draftAllUnread: () => Promise<void>;
};

export default function useInboxActions({
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
}: UseInboxActionsArgs): InboxActions {
  const openThread = useCallback(
    (threadId: string) => {
      setSelectedThreadId(threadId);
      layout.showDetailIfMobile();
      // Optimistically clear the unread badge in the list.
      list.patchThread(threadId, { unread_count: 0 });
      void detail.markAsRead(threadId).then((r) => {
        if (!r.ok) {
          toast.push({ variant: "error", message: `Couldn't mark read — ${r.error}` });
        } else {
          void stats.refetch();
        }
      });
    },
    [detail, layout, list, setSelectedThreadId, stats, toast]
  );

  const toggleStar = useCallback(
    async (thread: ThreadRow) => {
      const r = await detail.toggleStar(thread);
      if (!r.ok) toast.push({ variant: "error", message: `Couldn't star this thread — ${r.error}` });
    },
    [detail, toast]
  );

  const update = useCallback(
    async (patch: Record<string, unknown>) => {
      const r = await detail.updateThread(patch);
      if (!r.ok) {
        toast.push({ variant: "error", message: `Couldn't update thread — ${r.error}` });
        return;
      }
      // Mirror the patched fields into the list row so the UI stays consistent.
      if (selectedThreadId) list.patchThread(selectedThreadId, r.data);
      void stats.refetch();
    },
    [detail, list, selectedThreadId, stats, toast]
  );

  const sync = useCallback(async () => {
    setSyncBusy(true);
    try {
      const res = await fetch(apiUrl("/inbox/sync/trigger"), {
        method: "POST",
        headers: { ...authHeaders() },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        notifications.push({
          level: "error",
          source: "Sync",
          message: `Sync failed — ${parseApiError(body, res.status)}`,
        });
        return;
      }
      await Promise.all([stats.refetch(), mailboxes.refetch(), list.refetch()]);
    } catch (e) {
      notifications.push({
        level: "error",
        source: "Sync",
        message: `Sync failed — ${networkErrorMessage(e)}`,
      });
    } finally {
      setSyncBusy(false);
    }
  }, [authHeaders, list, mailboxes, notifications, setSyncBusy, stats]);

  const runAiDraft = useCallback(async () => {
    const seed = detail.seedTicketId;
    if (seed == null) {
      toast.push({ variant: "error", message: "No message to draft a reply to." });
      return;
    }
    const r = await aiDraft.generate(seed);
    if (!r.ok) {
      toast.push({ variant: "error", message: `AI draft failed — ${r.error}` });
      return;
    }
    compose.setBody(r.data.draftText);
    compose.setMode("reply");
    compose.setExpanded(true);
    aiDraft.showBanner(r.data.contextUsed);
    if (selectedThreadId) list.patchThread(selectedThreadId, { has_ai_draft_ready: true });
    detail.patchThread({ has_ai_draft_ready: true });
  }, [aiDraft, compose, detail, list, selectedThreadId, toast]);

  const dismissAiDraft = useCallback(async () => {
    const seed = detail.seedTicketId;
    if (seed == null) return;
    const r = await aiDraft.dismiss(seed);
    if (!r.ok) {
      toast.push({ variant: "error", message: `Couldn't dismiss draft — ${r.error}` });
      return;
    }
    compose.setBody("");
    if (selectedThreadId) list.patchThread(selectedThreadId, { has_ai_draft_ready: false });
    detail.patchThread({ has_ai_draft_ready: false });
  }, [aiDraft, compose, detail, list, selectedThreadId, toast]);

  const send = useCallback(async () => {
    if (selectedThreadId == null) return;
    const attempt = async (): Promise<void> => {
      const wasReply = compose.mode === "reply";
      const r = await compose.send();
      if (!r.ok) {
        toast.push({
          variant: "error",
          message: `Couldn't send — ${r.error}`,
          retry: () => void attempt(),
        });
        return;
      }
      if (wasReply) aiDraft.hideBanner();
      void detail.refetch();
      void list.refetch();
      void stats.refetch();
    };
    await attempt();
  }, [aiDraft, compose, detail, list, selectedThreadId, stats, toast]);

  const draftAllUnread = useCallback(async () => {
    const eligibleThreadIds = list.threads
      .filter((t) => batch.selectEligible([t]).length > 0)
      .map((t) => t.thread_id);
    const seedIds = batch.selectEligible(list.threads);
    if (!seedIds.length) return;
    const r = await batch.run(seedIds);
    if (!r.ok) {
      notifications.push({
        level: "error",
        source: "AI draft",
        message: `Batch draft failed — ${r.error}`,
      });
      return;
    }
    // Map touched ticket ids back to threads via seed_ticket_id.
    const touchedTicketIds = new Set(r.data.touched);
    const touchedThreadIds = list.threads
      .filter((t) => t.seed_ticket_id != null && touchedTicketIds.has(t.seed_ticket_id))
      .map((t) => t.thread_id);
    if (touchedThreadIds.length) {
      list.patchThreads(touchedThreadIds, { has_ai_draft_ready: true });
    } else if (eligibleThreadIds.length) {
      // Fallback if the API didn't return per-ticket results.
      list.patchThreads(eligibleThreadIds, { has_ai_draft_ready: true });
    }
    if (r.data.ok > 0) {
      notifications.push({
        level: "info",
        source: "AI draft",
        message: `${r.data.ok} drafts ready for review.`,
      });
    }
  }, [batch, list, notifications]);

  return { openThread, toggleStar, update, sync, runAiDraft, dismissAiDraft, send, draftAllUnread };
}
