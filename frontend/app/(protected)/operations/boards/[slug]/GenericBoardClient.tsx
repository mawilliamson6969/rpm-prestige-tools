"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import operationsStyles from "../../operations.module.css";
import renewalsStyles from "../renewals/renewals.module.css";
import OperationsTopBar from "../../OperationsTopBar";
import BoardTable from "../renewals/components/BoardTable";
import EditBoardDrawer from "../components/EditBoardDrawer";
import { compareValues, type SortDir, type TeamUser } from "../renewals/components/types";
import { apiUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import type { Board, BoardColumn, Group, Item } from "@/types/mb";

/**
 * Generic Main Table view for any board that isn't the bespoke Renewals
 * board. Next.js route precedence means /operations/boards/renewals
 * matches the static folder first and never lands here.
 *
 * Intentionally minimal:
 *   - Flat list grouped by mb_groups (not the countdown buckets that
 *     Renewals computes from lease_end_date).
 *   - Reuses the same BoardTable + cell editors built in Phase 3.
 *   - No item drawer yet (item drawer is Phase 4 for non-Renewals boards).
 *   - The Edit board button is admin-only and opens the EditBoardDrawer.
 *
 * Item creation lives in Phase 4 — this page lists what's there but
 * doesn't yet offer "+ New item." A freshly created board lands here
 * empty; the admin uses the Edit board drawer to set up columns and
 * groups, and Phase 4 will add item-creation.
 */
export default function GenericBoardClient({ slug }: { slug: string }) {
  const { authHeaders, token, isAdmin } = useAuth();
  const [board, setBoard] = useState<Board | null>(null);
  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<number, boolean>>({});
  const [sortColumnKey, setSortColumnKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const boardsRes = await fetch(apiUrl("/mb/boards"), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!boardsRes.ok) throw new Error("Could not load boards.");
      const boardsBody = await boardsRes.json();
      const match = (boardsBody.boards || []).find(
        (b: Board) => b.slug === slug
      );
      if (!match) {
        throw new Error(`Board "${slug}" not found.`);
      }
      const [schemaRes, itemsRes] = await Promise.all([
        fetch(apiUrl(`/mb/boards/${match.id}`), {
          headers: { ...authHeaders() },
          cache: "no-store",
        }),
        fetch(apiUrl(`/mb/boards/${match.id}/items?limit=500`), {
          headers: { ...authHeaders() },
          cache: "no-store",
        }),
      ]);
      if (!schemaRes.ok) throw new Error("Could not load board schema.");
      if (!itemsRes.ok) throw new Error("Could not load board items.");
      const schema = await schemaRes.json();
      const itemsBody = await itemsRes.json();
      setBoard(schema.board);
      setColumns(schema.columns || []);
      setGroups(schema.groups || []);
      setItems(itemsBody.items || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load board.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, slug, token]);

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
          body.users.map((u: { id: number; username: string; displayName?: string; avatarUrl?: string | null; active: boolean }) => ({
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
    load();
  }, [load]);
  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const saveValue = useCallback(
    async (itemId: number, columnKey: string, next: unknown) => {
      const item = items.find((i) => i.id === itemId);
      if (!item) return;
      const prevValues = item.values ?? {};
      const newValues = { ...prevValues, [columnKey]: next };
      setItems((arr) => arr.map((i) => (i.id === itemId ? { ...i, values: newValues } : i)));
      try {
        const res = await fetch(apiUrl(`/mb/items/${itemId}`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ values: newValues }),
        });
        if (!res.ok) throw new Error("Save failed.");
        const body = await res.json();
        if (body.item) {
          setItems((arr) => arr.map((i) => (i.id === itemId ? body.item : i)));
        }
      } catch (e) {
        setItems((arr) => arr.map((i) => (i.id === itemId ? { ...i, values: prevValues } : i)));
        setErr(e instanceof Error ? e.message : "Could not save change.");
      }
    },
    [authHeaders, items],
  );

  const itemsByGroup = useMemo(() => {
    const map = new Map<number | null, Item[]>();
    for (const it of items) {
      const k = it.group_id ?? null;
      const arr = map.get(k) ?? [];
      arr.push(it);
      map.set(k, arr);
    }
    if (sortColumnKey) {
      Array.from(map.values()).forEach((arr) => {
        arr.sort((a, b) =>
          compareValues(a.values?.[sortColumnKey], b.values?.[sortColumnKey], sortDir)
        );
      });
    }
    return map;
  }, [items, sortColumnKey, sortDir]);

  const onSort = useCallback(
    (columnKey: string) => {
      if (sortColumnKey === columnKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      else {
        setSortColumnKey(columnKey);
        setSortDir("asc");
      }
    },
    [sortColumnKey],
  );

  return (
    <div className={`${operationsStyles.page} ${renewalsStyles.page}`}>
      <OperationsTopBar />
      <div className={renewalsStyles.main}>
        <div className={renewalsStyles.boardHeader}>
          <div>
            <h2 className={renewalsStyles.boardTitle}>
              {board?.icon ? `${board.icon} ` : "📋 "}
              {board?.name ?? slug}
              <span className={renewalsStyles.betaBadge}>Beta</span>
            </h2>
            {board?.description ? (
              <p className={renewalsStyles.boardDescription}>{board.description}</p>
            ) : null}
          </div>
          {isAdmin && board ? (
            <div style={{ marginLeft: "auto" }}>
              <button
                type="button"
                className={`${renewalsStyles.btn} ${renewalsStyles.btnGhost}`}
                onClick={() => setEditOpen(true)}
              >
                Edit board
              </button>
            </div>
          ) : null}
        </div>

        {err ? <div className={renewalsStyles.errorBanner}>{err}</div> : null}

        {loading ? (
          <div className={renewalsStyles.loadingState}>Loading board…</div>
        ) : !board ? (
          <div className={renewalsStyles.emptyState}>Board not found.</div>
        ) : (
          <div className={renewalsStyles.tableWrapper}>
            {groups.length === 0 ? (
              <div className={renewalsStyles.emptyState}>
                No groups yet. Open “Edit board” to add one.
              </div>
            ) : (
              groups.map((g) => {
                const groupItems = itemsByGroup.get(g.id) ?? [];
                const collapsed = collapsedGroups[g.id] ?? false;
                return (
                  <div key={g.id}>
                    <div
                      className={renewalsStyles.groupHeader}
                      onClick={() =>
                        setCollapsedGroups((s) => ({ ...s, [g.id]: !s[g.id] }))
                      }
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setCollapsedGroups((s) => ({ ...s, [g.id]: !s[g.id] }));
                        }
                      }}
                    >
                      <span
                        className={`${renewalsStyles.groupCaret} ${!collapsed ? renewalsStyles.groupCaretOpen : ""}`}
                      />
                      <span
                        className={renewalsStyles.groupColorDot}
                        style={{ background: g.color ?? "#c4c4c4" }}
                      />
                      <span className={renewalsStyles.groupLabel}>{g.name}</span>
                      <span className={renewalsStyles.groupCount}>{groupItems.length}</span>
                    </div>
                    {!collapsed ? (
                      groupItems.length === 0 ? (
                        <div
                          className={renewalsStyles.emptyState}
                          style={{ padding: "1rem", borderBottom: "1px solid rgba(27,40,86,0.12)" }}
                        >
                          No items in this group.
                        </div>
                      ) : (
                        <BoardTable
                          columns={columns}
                          items={groupItems}
                          users={users}
                          sortColumnKey={sortColumnKey}
                          sortDir={sortDir}
                          onSort={onSort}
                          onOpenItem={() => {
                            /* item drawer is Phase 4 for non-Renewals boards */
                          }}
                          onSaveValue={saveValue}
                        />
                      )
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {editOpen && board ? (
        <EditBoardDrawer
          boardId={board.id}
          onClose={() => setEditOpen(false)}
          onChanged={load}
        />
      ) : null}
    </div>
  );
}
