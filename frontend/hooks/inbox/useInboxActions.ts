"use client";

import { useCallback } from "react";
import { apiUrl } from "../../lib/api";
import { networkErrorMessage, parseApiError } from "../../lib/apiResult";
import type { TicketRow } from "./types";
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
  selectedId: number | null;
  setSelectedId: (id: number | null) => void;
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
  openTicket: (id: number) => void;
  toggleStar: (ticket: TicketRow) => Promise<void>;
  update: (patch: Record<string, unknown>) => Promise<void>;
  sync: () => Promise<void>;
  runAiDraft: () => Promise<void>;
  dismissAiDraft: () => Promise<void>;
  send: () => Promise<void>;
  draftAllUnread: () => Promise<void>;
};

export default function useInboxActions({
  selectedId,
  setSelectedId,
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
  const openTicket = useCallback(
    (id: number) => {
      setSelectedId(id);
      layout.showDetailIfMobile();
      void detail.markAsRead(id).then((r) => {
        if (!r.ok) toast.push({ variant: "error", message: `Couldn't mark read — ${r.error}` });
      });
    },
    [detail, layout, setSelectedId, toast]
  );

  const toggleStar = useCallback(
    async (ticket: TicketRow) => {
      const r = await detail.toggleStar(ticket);
      if (!r.ok) toast.push({ variant: "error", message: `Couldn't star this thread — ${r.error}` });
    },
    [detail, toast]
  );

  const update = useCallback(
    async (patch: Record<string, unknown>) => {
      const r = await detail.updateThread(patch);
      if (!r.ok) toast.push({ variant: "error", message: `Couldn't update thread — ${r.error}` });
    },
    [detail, toast]
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
    if (selectedId == null) return;
    const r = await aiDraft.generate(selectedId);
    if (!r.ok) {
      toast.push({ variant: "error", message: `AI draft failed — ${r.error}` });
      return;
    }
    compose.setBody(r.data.draftText);
    compose.setMode("reply");
    compose.setExpanded(true);
    aiDraft.showBanner(r.data.contextUsed);
    list.patchTicket(selectedId, { has_ai_draft_ready: true });
    detail.patchThread({ has_ai_draft_ready: true });
  }, [aiDraft, compose, detail, list, selectedId, toast]);

  const dismissAiDraft = useCallback(async () => {
    if (selectedId == null) return;
    const r = await aiDraft.dismiss(selectedId);
    if (!r.ok) {
      toast.push({ variant: "error", message: `Couldn't dismiss draft — ${r.error}` });
      return;
    }
    compose.setBody("");
    list.patchTicket(selectedId, { has_ai_draft_ready: false });
    detail.patchThread({ has_ai_draft_ready: false });
  }, [aiDraft, compose, detail, list, selectedId, toast]);

  const send = useCallback(async () => {
    if (selectedId == null) return;
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
  }, [aiDraft, compose, detail, list, selectedId, stats, toast]);

  const draftAllUnread = useCallback(async () => {
    const ids = batch.selectEligible(list.threads);
    if (!ids.length) return;
    const r = await batch.run(ids);
    if (!r.ok) {
      notifications.push({
        level: "error",
        source: "AI draft",
        message: `Batch draft failed — ${r.error}`,
      });
      return;
    }
    list.patchTickets(r.data.touched, { has_ai_draft_ready: true });
    if (r.data.ok > 0) {
      notifications.push({
        level: "info",
        source: "AI draft",
        message: `${r.data.ok} drafts ready for review.`,
      });
    }
  }, [batch, list, notifications]);

  return { openTicket, toggleStar, update, sync, runAiDraft, dismissAiDraft, send, draftAllUnread };
}
