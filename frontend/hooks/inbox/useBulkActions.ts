"use client";

// Bulk-action plumbing for the conversation list. Owns the selection
// set + the bulk-mode toggle; exposes a single `runBulk` that POSTs
// to /inbox/threads/bulk and patches affected rows in the list cache
// optimistically.

import { useCallback, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { apiUrl } from "../../lib/api";
import { parseApiError } from "../../lib/apiResult";
import type { ThreadRow } from "./types";
import type { UseThreadList } from "./useThreadList";

export type BulkOp =
  | { op: "assign"; assignee_id: number | null }
  | { op: "set_status"; status: "open" | "snoozed" | "closed" }
  | { op: "snooze"; until: string | null }
  | { op: "reopen" }
  | { op: "close" }
  | { op: "add_tags"; tags: string[] }
  | { op: "remove_tags"; tags: string[] }
  | { op: "mark_read" }
  | { op: "mark_unread" };

export type UseBulkActions = {
  bulkMode: boolean;
  selected: Set<string>;
  selectedCount: number;
  /** Turn bulk mode on/off. Off also clears selection. */
  setBulkMode: (on: boolean) => void;
  toggleSelected: (threadId: string) => void;
  selectAll: (rows: ThreadRow[]) => void;
  clear: () => void;
  isSelected: (threadId: string) => boolean;
  /** POST /inbox/threads/bulk with optimistic patch into the list. */
  runBulk: (op: BulkOp) => Promise<{ ok: boolean; updated?: number; error?: string }>;
  busy: boolean;
};

function optimisticPatch(op: BulkOp): Partial<ThreadRow> {
  switch (op.op) {
    case "assign":
      return { assignee_id: op.assignee_id, assignee_name: null };
    case "set_status":
      return { status: op.status as ThreadRow["status"] };
    case "snooze":
      return { status: "snoozed" as ThreadRow["status"] };
    case "reopen":
      return { status: "open" as ThreadRow["status"] };
    case "close":
      return { status: "closed" as ThreadRow["status"] };
    case "mark_read":
      return { unread_count: 0 };
    case "mark_unread":
      return { unread_count: 1 };
    default:
      return {};
  }
}

export default function useBulkActions(list: UseThreadList): UseBulkActions {
  const { authHeaders } = useAuth();
  const [bulkMode, setBulkModeState] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const setBulkMode = useCallback((on: boolean) => {
    setBulkModeState(on);
    if (!on) setSelected(new Set());
  }, []);

  const toggleSelected = useCallback((threadId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  }, []);

  const selectAll = useCallback((rows: ThreadRow[]) => {
    setSelected(new Set(rows.map((r) => r.thread_id)));
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  const runBulk = useCallback<UseBulkActions["runBulk"]>(
    async (opSpec) => {
      const ids = Array.from(selected);
      if (!ids.length) return { ok: false, error: "Nothing selected." };
      setBusy(true);

      // Optimistic: patch the list rows for ops that map cleanly.
      const patch = optimisticPatch(opSpec);
      if (Object.keys(patch).length) list.patchThreads(ids, patch);

      try {
        const res = await fetch(apiUrl("/inbox/threads/bulk"), {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ thread_ids: ids, ...opSpec }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          // Server rejected — refetch to undo the optimistic patch.
          void list.refetch();
          return { ok: false, error: parseApiError(body, res.status) };
        }
        // On status mutations the list might drop rows out of view
        // (e.g. closing a thread when the active tab is Open). Refetch
        // to settle.
        if (
          opSpec.op === "set_status" ||
          opSpec.op === "close" ||
          opSpec.op === "reopen" ||
          opSpec.op === "snooze" ||
          opSpec.op === "assign"
        ) {
          void list.refetch();
        }
        return { ok: true, updated: Number(body.updated) || ids.length };
      } catch (e) {
        void list.refetch();
        return { ok: false, error: e instanceof Error ? e.message : "Bulk failed." };
      } finally {
        setBusy(false);
      }
    },
    [authHeaders, list, selected]
  );

  return useMemo(
    () => ({
      bulkMode,
      selected,
      selectedCount: selected.size,
      setBulkMode,
      toggleSelected,
      selectAll,
      clear,
      isSelected,
      runBulk,
      busy,
    }),
    [bulkMode, selected, setBulkMode, toggleSelected, selectAll, clear, isSelected, runBulk, busy]
  );
}
