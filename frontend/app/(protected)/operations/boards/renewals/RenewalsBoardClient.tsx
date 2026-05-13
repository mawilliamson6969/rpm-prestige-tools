"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import operationsStyles from "../../operations.module.css";
import styles from "./renewals.module.css";
import OperationsTopBar from "../../OperationsTopBar";
import BoardTable from "./components/BoardTable";
import BoardToolbar from "./components/BoardToolbar";
import GroupHeader from "./components/GroupHeader";
import ItemDrawer from "./components/ItemDrawer";
import {
  COUNTDOWN_BUCKETS,
  bucketForItem,
  compareValues,
  type CountdownBucketKey,
  type RenewalsBoardData,
  type SortDir,
  type TeamUser,
} from "./components/types";
import { apiUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import type { BoardColumn, Group, Item } from "@/types/mb";

const BOARD_SLUG = "renewals";

/**
 * Pull a human-readable failure detail out of a non-2xx Response. The
 * backend mb/* routes return JSON like {error: "..."}; if parsing fails
 * we fall back to status + first 200 chars of the body so the user can
 * still tell whether they hit Nginx, the API, or a CORS preflight.
 */
async function describeFailure(res: Response): Promise<string> {
  const status = `${res.status} ${res.statusText || ""}`.trim();
  let text = "";
  try {
    text = await res.text();
  } catch {
    return status;
  }
  if (!text) return status;
  try {
    const body = JSON.parse(text);
    if (typeof body?.error === "string") return `${status}: ${body.error}`;
    return `${status}: ${text.slice(0, 200)}`;
  } catch {
    return `${status}: ${text.slice(0, 200)}`;
  }
}

export default function RenewalsBoardClient() {
  const { authHeaders, token } = useAuth();
  const [data, setData] = useState<RenewalsBoardData | null>(null);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortColumnKey, setSortColumnKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [collapsed, setCollapsed] = useState<Record<CountdownBucketKey, boolean>>({
    overdue: false,
    "0_30": false,
    "31_60": false,
    "61_90": false,
    "91_plus": false,
  });
  const [drawerItemId, setDrawerItemId] = useState<number | null>(null);

  // ----- load -----

  const loadBoard = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const boardsRes = await fetch(apiUrl("/mb/boards"), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!boardsRes.ok) {
        const detail = await describeFailure(boardsRes);
        throw new Error(`GET /mb/boards failed — ${detail}`);
      }
      const boardsBody = await boardsRes.json();
      const boards: Array<{ id: number; name: string; slug: string }> =
        boardsBody.boards || [];
      const board = boards.find((b) => b.slug === BOARD_SLUG);
      if (!board) {
        throw new Error(
          "Renewals board has not been seeded. Backend must run migration 030_mb_renewals_seed.sql (it runs at startup via ensureMbRenewalsSeed)."
        );
      }

      const [schemaRes, itemsRes] = await Promise.all([
        fetch(apiUrl(`/mb/boards/${board.id}`), {
          headers: { ...authHeaders() },
          cache: "no-store",
        }),
        fetch(apiUrl(`/mb/boards/${board.id}/items?limit=500`), {
          headers: { ...authHeaders() },
          cache: "no-store",
        }),
      ]);
      if (!schemaRes.ok) {
        const detail = await describeFailure(schemaRes);
        throw new Error(`GET /mb/boards/${board.id} failed — ${detail}`);
      }
      if (!itemsRes.ok) {
        const detail = await describeFailure(itemsRes);
        throw new Error(`GET /mb/boards/${board.id}/items failed — ${detail}`);
      }
      const schemaBody = await schemaRes.json();
      const itemsBody = await itemsRes.json();
      const columns: BoardColumn[] = schemaBody.columns || [];
      const groups: Group[] = schemaBody.groups || [];
      const items: Item[] = itemsBody.items || [];

      setData({ board, columns, groups, items });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load renewals board.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token]);

  const loadUsers = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl("/users"), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = await res.json();
      if (Array.isArray(body.users)) {
        setUsers(
          body.users.map((u: TeamUser & { displayName?: string }) => ({
            id: u.id,
            username: u.username,
            displayName: u.displayName || u.username,
            avatarUrl: u.avatarUrl,
            active: u.active,
          })),
        );
      }
    } catch {
      /* ignore */
    }
  }, [authHeaders, token]);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);
  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  // ----- value mutations -----

  const saveValue = useCallback(
    async (itemId: number, columnKey: string, next: unknown) => {
      if (!data) return;
      const item = data.items.find((i) => i.id === itemId);
      if (!item) return;

      const prevValues = item.values ?? {};
      const newValues: Record<string, unknown> = { ...prevValues, [columnKey]: next };

      // Optimistic update.
      setData((d) =>
        d
          ? {
              ...d,
              items: d.items.map((i) =>
                i.id === itemId ? { ...i, values: newValues } : i,
              ),
            }
          : d,
      );

      try {
        const res = await fetch(apiUrl(`/mb/items/${itemId}`), {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders(),
          },
          body: JSON.stringify({ values: newValues }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            typeof body.error === "string" ? body.error : "Could not save change.",
          );
        }
        const body = await res.json();
        if (body.item) {
          setData((d) =>
            d
              ? {
                  ...d,
                  items: d.items.map((i) => (i.id === itemId ? body.item : i)),
                }
              : d,
          );
        }
      } catch (e) {
        // Revert.
        setData((d) =>
          d
            ? {
                ...d,
                items: d.items.map((i) =>
                  i.id === itemId ? { ...i, values: prevValues } : i,
                ),
              }
            : d,
        );
        setErr(e instanceof Error ? e.message : "Could not save change.");
      }
    },
    [authHeaders, data],
  );

  // ----- filter + sort -----

  const filteredItems = useMemo(() => {
    if (!data) return [] as Item[];
    const q = search.trim().toLowerCase();
    return data.items.filter((it) => {
      if (statusFilter !== "all") {
        if (it.values?.status !== statusFilter) return false;
      }
      if (q) {
        const tenant =
          typeof it.values?.tenant_name === "string" ? it.values.tenant_name : "";
        const property =
          typeof it.values?.property === "string" ? it.values.property : "";
        if (
          !tenant.toLowerCase().includes(q) &&
          !property.toLowerCase().includes(q) &&
          !it.title.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [data, search, statusFilter]);

  const sortedItems = useMemo(() => {
    if (!sortColumnKey) return filteredItems;
    return [...filteredItems].sort((a, b) =>
      compareValues(a.values?.[sortColumnKey], b.values?.[sortColumnKey], sortDir),
    );
  }, [filteredItems, sortColumnKey, sortDir]);

  const itemsByBucket = useMemo(() => {
    const out: Record<CountdownBucketKey, Item[]> = {
      overdue: [],
      "0_30": [],
      "31_60": [],
      "61_90": [],
      "91_plus": [],
    };
    for (const it of sortedItems) {
      const b = bucketForItem(it);
      out[b.key].push(it);
    }
    return out;
  }, [sortedItems]);

  // ----- handlers -----

  const onSort = useCallback(
    (columnKey: string) => {
      if (sortColumnKey === columnKey) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortColumnKey(columnKey);
        setSortDir("asc");
      }
    },
    [sortColumnKey],
  );

  const onClearFilters = useCallback(() => {
    setSearch("");
    setStatusFilter("all");
  }, []);

  const drawerItem = useMemo(() => {
    if (drawerItemId == null || !data) return null;
    return data.items.find((i) => i.id === drawerItemId) ?? null;
  }, [drawerItemId, data]);

  // ----- render -----

  return (
    <div className={`${operationsStyles.page} ${styles.page}`}>
      <OperationsTopBar />
      <div className={styles.main}>
        <div className={styles.boardHeader}>
          <div>
            <h2 className={styles.boardTitle}>
              📅 Renewals
              <span className={styles.betaBadge}>Beta</span>
            </h2>
            <p className={styles.boardDescription}>
              Lease renewal pipeline. Items group automatically by lease-end countdown.
            </p>
          </div>
        </div>

        {err ? <div className={styles.errorBanner}>{err}</div> : null}

        {loading ? (
          <div className={styles.loadingState}>Loading renewals…</div>
        ) : !data ? (
          <div className={styles.emptyState}>No data.</div>
        ) : (
          <>
            <BoardToolbar
              columns={data.columns}
              search={search}
              onSearchChange={setSearch}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              totalCount={data.items.length}
              visibleCount={sortedItems.length}
              onClearFilters={onClearFilters}
            />

            <div className={styles.tableWrapper}>
              {COUNTDOWN_BUCKETS.map((bucket) => {
                const itemsInBucket = itemsByBucket[bucket.key];
                if (itemsInBucket.length === 0 && bucket.key !== "0_30") {
                  // Always show 0-30 even when empty so users notice the bucket exists.
                  return null;
                }
                const isCollapsed = collapsed[bucket.key];
                return (
                  <div key={bucket.key}>
                    <GroupHeader
                      bucket={bucket}
                      count={itemsInBucket.length}
                      collapsed={isCollapsed}
                      onToggle={() =>
                        setCollapsed((c) => ({ ...c, [bucket.key]: !c[bucket.key] }))
                      }
                    />
                    {!isCollapsed ? (
                      <BoardTable
                        columns={data.columns}
                        items={itemsInBucket}
                        users={users}
                        sortColumnKey={sortColumnKey}
                        sortDir={sortDir}
                        onSort={onSort}
                        onOpenItem={setDrawerItemId}
                        onSaveValue={saveValue}
                      />
                    ) : null}
                  </div>
                );
              })}

              {sortedItems.length === 0 ? (
                <div className={styles.emptyState}>
                  No renewals match your filters.
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>

      {drawerItem ? (
        <ItemDrawer
          item={drawerItem}
          columns={data?.columns ?? []}
          users={users}
          onClose={() => setDrawerItemId(null)}
          onSaveValue={saveValue}
        />
      ) : null}
    </div>
  );
}
