"use client";

import { useEffect, useRef } from "react";
import type { MailboxConnection } from "./types";
import type { UseNotificationCenterValue } from "./useNotificationCenter";

/**
 * Watches the live mailbox list and pushes a notification for each
 * never-before-seen `delta_last_error` so admins know the background sync
 * is unhealthy. De-duplicates on `(connectionId, last_error_at)` so the
 * notification doesn't repeat on every refetch.
 */
export default function useSyncHealthReporter(
  mailboxes: MailboxConnection[],
  notifications: UseNotificationCenterValue
) {
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const m of mailboxes) {
      const err = m.delta_last_error;
      const at = m.delta_last_error_at;
      if (!err || !at) continue;
      const key = `${m.id}:${at}`;
      if (seenRef.current.has(key)) continue;
      seenRef.current.add(key);
      const label = (m.display_name || m.mailbox_email || `Mailbox ${m.id}`).trim();
      notifications.push({
        level: "error",
        source: "Sync",
        message: `${label}: ${err}`,
      });
    }
  }, [mailboxes, notifications]);
}
