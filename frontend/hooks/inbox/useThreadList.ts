"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { apiUrl } from "../../lib/api";
import { parseApiError } from "../../lib/apiResult";
import type { ListSort, ThreadRow } from "./types";

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
  threads: ThreadRow[];
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
  applyPreset: (bucket: string) => void;

  refetch: () => Promise<void>;
  loadMore: () => Promise<void>;
  /** Patch a single thread in the list (used by detail/star/AI-draft mutations). */
  patchThread: (threadId: string, patch: Partial<ThreadRow>) => void;
  /** Patch multiple threads at once (used by batch AI-draft). */
  patchThreads: (threadIds: string[], patch: Partial<ThreadRow>) => void;
};

export type UseThreadListOptions = {
  connectionId: number | null;
  /** When set, the list fetches via /inbox/views/:id/threads and ignores
   *  bucket/category/etc. filter state. The orchestrator clears this when
   *  the user touches any filter control. */
  viewId?: number | null;
  /** Fires whenever the user changes a filter (bucket, category, status,
   *  assignee, search, sort). Used to clear an active saved view. */
  onUserFilterChange?: () => void;
};

export default function useThreadList(opts: UseThreadListOptions): UseThreadList {
  const { connectionId, viewId = null, onUserFilterChange } = opts;
  const onUserFilterChangeRef = useRef(onUserFilterChange);
  onUserFilterChangeRef.current = onUserFilterChange;
  const wrap = <T,>(setter: (v: T) => void) => (v: T) => {
    onUserFilterChangeRef.current?.();
    setter(v);
  };
  const { authHeaders } = useAuth();

  const [bucket, setBucket] = useState<string>("open");
  const [category, setCategory] = useState<string | null>(null);
  const [narrowStatus, setNarrowStatus] = useState<string | null>(null);
  const [teamUserId, setTeamUserId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sort, setSort] = useState<ListSort>("newest");

  const [threads, setThreads] = useState<ThreadRow[]>([]);
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
        const p = new URLSearchParams(viewId != null ? "" : queryString);
        p.set("offset", String(startOffset));
        if (viewId == null) p.set("limit", String(PAGE_LIMIT));
        else p.set("limit", String(PAGE_LIMIT));
        const url =
          viewId != null
            ? `/inbox/views/${viewId}/threads?${p.toString()}`
            : `/inbox/threads?${p.toString()}`;
        const res = await fetch(apiUrl(url), {
          cache: "no-store",
          headers: { ...authHeaders() },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(parseApiError(body, res.status));
          if (!append) setThreads([]);
          return;
        }
        const rows = (body.threads as ThreadRow[]) || [];
        setTotal(body.total ?? 0);
        setOffset(startOffset + rows.length);
        setThreads((prev) => (append ? [...prev, ...rows] : rows));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load threads.");
        if (!append) setThreads([]);
      } finally {
        setLoading(false);
      }
    },
    [authHeaders, queryString, viewId]
  );

  useEffect(() => {
    setOffset(0);
    void loadList(0, false);
  }, [queryString, viewId, loadList]);

  const refetch = useCallback(() => loadList(0, false), [loadList]);
  const loadMore = useCallback(() => loadList(offset, true), [loadList, offset]);

  const patchThread = useCallback((threadId: string, patch: Partial<ThreadRow>) => {
    setThreads((prev) => prev.map((t) => (t.thread_id === threadId ? { ...t, ...patch } : t)));
  }, []);

  const patchThreads = useCallback((ids: string[], patch: Partial<ThreadRow>) => {
    const set = new Set(ids);
    setThreads((prev) => prev.map((t) => (set.has(t.thread_id) ? { ...t, ...patch } : t)));
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
    setBucket: wrap(setBucket),
    setCategory: wrap(setCategory),
    setNarrowStatus: wrap(setNarrowStatus),
    setTeamUserId: wrap(setTeamUserId),
    setSearch: wrap(setSearch),
    setSort: wrap(setSort),
    applyPreset: wrap(applyPreset),
    refetch,
    loadMore,
    patchThread,
    patchThreads,
  };
}
