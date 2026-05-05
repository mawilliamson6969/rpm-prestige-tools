"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { apiUrl } from "../../lib/api";
import { parseApiError } from "../../lib/apiResult";
import type { MailboxConnection } from "./types";

export type UseMailboxes = {
  mailboxes: MailboxConnection[];
  /** `null` means "All mailboxes". */
  currentMailbox: number | null;
  switchTo: (id: number | null) => void;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
};

export default function useMailboxes(): UseMailboxes {
  const { authHeaders } = useAuth();
  const [mailboxes, setMailboxes] = useState<MailboxConnection[]>([]);
  const [currentMailbox, setCurrentMailbox] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/inbox/connections"), {
        cache: "no-store",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(parseApiError(body, res.status));
        return;
      }
      if (Array.isArray(body.connections)) {
        setMailboxes(body.connections as MailboxConnection[]);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load mailboxes.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return {
    mailboxes,
    currentMailbox,
    switchTo: setCurrentMailbox,
    loading,
    error,
    refetch,
  };
}
