"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { apiUrl } from "../../lib/api";
import { parseApiError } from "../../lib/apiResult";
import type { ListSort, TicketRow } from "./types";

const PAGE_LIMIT = 40;
const SEARCH_DEBOUNCE_MS = 300;

export type ThreadListFilters = {
  bucket: string;
  category: string | null;
  /** When set, uses bucket=all and this status; bucket is ignored. */
  narrowStatus: string | null;
  teamUserId: number | null;
  search: string;
  sort: ListSort;
};

export type UseThreadList = {
  threads: TicketRow[];
  total: number;
  offset: number;
  loading: boolean;
  error: string | null;

  filters: ThreadListFilters;
  setBucket: (b: string) => void;
  setCategory: (c: string | null) => void;
  setNarrowStatus: (s: string | null) => void;
  setTeamUserId: (id: number | null) => void;
  setSearch: (s: string) => void;
  setSort: (s: ListSort) => void;
  /** Reset bucket + clear category/narrowStatus/teamUserId in one call. */
  applyPreset: (bucket: string) => void;

  refetch: () => Promise<void>;
  loadMore: () => Promise<void>;
  /** Patch a single ticket in the list (used by detail/star/AI-draft mutations). */
  patchTicket: (id: number, patch: Partial<TicketRow>) => void;
  /** Patch multiple tickets at once (used by batch AI-draft). */
  patchTickets: (ids: number[], patch: Partial<TicketRow>) => void;
};

export default function useThreadList(connectionId: number | null): UseThreadList {
  const { authHeaders } = useAuth();

  const [bucket, setBucket] = useState<string>("open");
  const [category, setCategory] = useState<string | null>(null);
  const [narrowStatus, setNarrowStatus] = useState<string | null>(null);
  const [teamUserId, setTeamUserId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sort, setSort] = useState<ListSort>("newest");

  const [threads, setThreads] = useState<TicketRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (narrowStatus) {
      p.set("bucket", "all");
      p.set("status", narrowStatus);
    } else {
      p.set("bucket", bucket);
    }
    if (category) p.set("category", category);
    if (teamUserId != null) p.set("assignedTo", String(teamUserId));
    if (debouncedSearch.trim()) p.set("search", debouncedSearch.trim());
    if (sort === "oldest") p.set("sort", "oldest");
    else if (sort === "priority") p.set("sort", "priority");
    else if (sort === "updated") p.set("sort", "updated");
    else p.set("sort", "newest");
    if (connectionId != null) p.set("connectionId", String(connectionId));
    p.set("limit", String(PAGE_LIMIT));
    return p.toString();
  }, [bucket, category, narrowStatus, teamUserId, debouncedSearch, sort, connectionId]);

  const loadList = useCallback(
    async (startOffset: number, append: boolean) => {
      setLoading(true);
      try {
        const p = new URLSearchParams(queryString);
        p.set("offset", String(startOffset));
        const res = await fetch(apiUrl(`/inbox/tickets?${p.toString()}`), {
          cache: "no-store",
          headers: { ...authHeaders() },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(parseApiError(body, res.status));
          if (!append) setThreads([]);
          return;
        }
        const rows = (body.tickets as TicketRow[]) || [];
        setTotal(body.total ?? 0);
        setOffset(startOffset + rows.length);
        setThreads((prev) => (append ? [...prev, ...rows] : rows));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load tickets.");
        if (!append) setThreads([]);
      } finally {
        setLoading(false);
      }
    },
    [authHeaders, queryString]
  );

  useEffect(() => {
    setOffset(0);
    void loadList(0, false);
  }, [queryString, loadList]);

  const refetch = useCallback(() => loadList(0, false), [loadList]);
  const loadMore = useCallback(() => loadList(offset, true), [loadList, offset]);

  const patchTicket = useCallback((id: number, patch: Partial<TicketRow>) => {
    setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const patchTickets = useCallback((ids: number[], patch: Partial<TicketRow>) => {
    const set = new Set(ids);
    setThreads((prev) => prev.map((t) => (set.has(t.id) ? { ...t, ...patch } : t)));
  }, []);

  const applyPreset = useCallback((b: string) => {
    setBucket(b);
    setCategory(null);
    setNarrowStatus(null);
    setTeamUserId(null);
  }, []);

  const filters = useMemo<ThreadListFilters>(
    () => ({ bucket, category, narrowStatus, teamUserId, search, sort }),
    [bucket, category, narrowStatus, teamUserId, search, sort]
  );

  return {
    threads,
    total,
    offset,
    loading,
    error,
    filters,
    setBucket,
    setCategory,
    setNarrowStatus,
    setTeamUserId,
    setSearch,
    setSort,
    applyPreset,
    refetch,
    loadMore,
    patchTicket,
    patchTickets,
  };
}
