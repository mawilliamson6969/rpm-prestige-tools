"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import operationsStyles from "../../../../operations.module.css";
import renewalsStyles from "../../../renewals/renewals.module.css";
import detailStyles from "./components/detail.module.css";
import OperationsTopBar from "../../../../OperationsTopBar";
import {
  DateCell,
  LongTextCell,
  NumberCell,
  PersonCell,
  ScoreCell,
  StatusCell,
  TextCell,
} from "../../../renewals/components/CellEditors";
import type { TeamUser } from "../../../renewals/components/types";
import { TenantContextPanel, PropertyContextPanel } from "./components/ContextPanels";
import RelatedItemsPanel from "./components/RelatedItemsPanel";
import UpdateComposer from "./components/UpdateComposer";
import SubitemsSection from "../../../components/subitems/SubitemsSection";
import UpdateEntry from "./components/UpdateEntry";
import type { MentionableUser } from "./components/MentionDropdown";
import { apiUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import type {
  BoardColumn,
  Group,
  Item,
  ItemContext,
  ItemUpdate,
  ReactionEmoji,
  RelatedItemRef,
} from "@/types/mb";

const POLL_INTERVAL_MS = 30_000;

interface BoardSchema {
  board: { id: number; name: string; slug: string };
  columns: BoardColumn[];
  groups: Group[];
}

export default function ItemDetailClient({
  boardSlug,
  itemId,
}: {
  boardSlug: string;
  itemId: number;
}) {
  const { authHeaders, token, user, isAdmin } = useAuth();
  const [item, setItem] = useState<Item | null>(null);
  const [schema, setSchema] = useState<BoardSchema | null>(null);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [context, setContext] = useState<ItemContext | null>(null);
  const [related, setRelated] = useState<RelatedItemRef[]>([]);
  const [updates, setUpdates] = useState<ItemUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [composerErr, setComposerErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const mentionUsers: MentionableUser[] = useMemo(
    () => users.map((u) => ({ id: u.id, username: u.username, displayName: u.displayName })),
    [users]
  );

  // -------- Loaders --------

  const loadItem = useCallback(async () => {
    if (!token) return;
    const res = await fetch(apiUrl(`/mb/items/${itemId}`), {
      headers: { ...authHeaders() },
      cache: "no-store",
    });
    if (!res.ok) throw new Error("Could not load item.");
    const body = await res.json();
    setItem(body.item);
  }, [authHeaders, itemId, token]);

  const loadSchema = useCallback(
    async (boardId: number) => {
      const res = await fetch(apiUrl(`/mb/boards/${boardId}`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Could not load board.");
      const body = await res.json();
      setSchema({
        board: body.board,
        columns: body.columns || [],
        groups: body.groups || [],
      });
    },
    [authHeaders]
  );

  const loadUsers = useCallback(async () => {
    if (!token) return;
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
          avatarUrl: u.avatarUrl ?? null,
          active: u.active,
        }))
      );
    }
  }, [authHeaders, token]);

  const loadContext = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl(`/mb/items/${itemId}/context`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!res.ok) return;
      setContext(await res.json());
    } catch {
      /* ignore */
    }
  }, [authHeaders, itemId, token]);

  const loadRelated = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl(`/mb/items/${itemId}/related`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = await res.json();
      setRelated(body.items || []);
    } catch {
      /* ignore */
    }
  }, [authHeaders, itemId, token]);

  const loadUpdates = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl(`/mb/items/${itemId}/updates`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = await res.json();
      setUpdates(body.updates || []);
    } catch {
      /* ignore */
    }
  }, [authHeaders, itemId, token]);

  // Initial load: fetch item, then schema for its board, then updates +
  // context + related + users in parallel.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        await loadItem();
        if (cancelled) return;
        // We have to read item.board_id from the response — refetch in-flight.
        const res = await fetch(apiUrl(`/mb/items/${itemId}`), {
          headers: { ...authHeaders() },
          cache: "no-store",
        });
        if (!res.ok) throw new Error("Could not load item.");
        const itemBody = await res.json();
        if (cancelled) return;
        setItem(itemBody.item);
        await loadSchema(itemBody.item.board_id);
        await Promise.all([loadUpdates(), loadContext(), loadRelated(), loadUsers()]);
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : "Could not load item.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    authHeaders,
    itemId,
    loadContext,
    loadItem,
    loadRelated,
    loadSchema,
    loadUpdates,
    loadUsers,
  ]);

  // Mark mentions seen as soon as the page is visible. Backend dedups
  // on its own; we fire once on load and once again whenever the tab
  // refocuses (in case new mentions came in while looking at the page).
  const markSeen = useCallback(async () => {
    if (!token) return;
    try {
      await fetch(apiUrl(`/mb/items/${itemId}/mark-mentions-seen`), {
        method: "POST",
        headers: { ...authHeaders() },
      });
    } catch {
      /* non-fatal */
    }
  }, [authHeaders, itemId, token]);

  useEffect(() => {
    markSeen();
  }, [markSeen]);

  // Polling + focus refresh.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!token) return;
    pollRef.current = setInterval(() => {
      loadUpdates();
    }, POLL_INTERVAL_MS);
    const onFocus = () => {
      loadUpdates();
      markSeen();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadUpdates, markSeen, token]);

  // -------- Column value save (same path as the drawer / table) --------

  const saveValue = useCallback(
    async (columnKey: string, next: unknown) => {
      if (!item) return;
      const prevValues = item.values ?? {};
      const newValues: Record<string, unknown> = { ...prevValues, [columnKey]: next };
      setItem((it) => (it ? { ...it, values: newValues } : it));
      try {
        const res = await fetch(apiUrl(`/mb/items/${item.id}`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ values: newValues }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Save failed.");
        }
        const body = await res.json();
        if (body.item) setItem(body.item);
        // Column-value change generates a system entry — refresh the feed
        // so it appears without waiting for the next 30s poll.
        loadUpdates();
      } catch (e) {
        setItem((it) => (it ? { ...it, values: prevValues } : it));
        setErr(e instanceof Error ? e.message : "Could not save change.");
      }
    },
    [authHeaders, item, loadUpdates]
  );

  // -------- Comment / reply / edit / delete --------

  async function uploadAttachmentsFor(updateId: number, files: File[]) {
    for (const f of files) {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch(apiUrl(`/mb/updates/${updateId}/attachments`), {
        method: "POST",
        headers: { ...authHeaders() }, // multipart: do not set Content-Type
        body: fd,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Attachment upload failed for ${f.name}.`);
      }
    }
  }

  const postComment = useCallback(
    async ({ bodyHtml, files }: { bodyHtml: string; text: string; files: File[] }): Promise<boolean> => {
      if (!item) return false;
      setSubmitting(true);
      setComposerErr(null);
      try {
        const res = await fetch(apiUrl(`/mb/items/${item.id}/updates`), {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ body_html: bodyHtml }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Could not post comment.");
        }
        const body = await res.json();
        if (files.length > 0 && body.update?.id) {
          await uploadAttachmentsFor(body.update.id, files);
        }
        await loadUpdates();
        return true;
      } catch (e) {
        setComposerErr(e instanceof Error ? e.message : "Could not post comment.");
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [authHeaders, item, loadUpdates] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const postReply = useCallback(
    async (
      parentId: number,
      data: { bodyHtml: string; text: string; files: File[] }
    ): Promise<boolean> => {
      try {
        const res = await fetch(apiUrl(`/mb/updates/${parentId}/replies`), {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ body_html: data.bodyHtml }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Could not post reply.");
        }
        const body = await res.json();
        if (data.files.length > 0 && body.update?.id) {
          await uploadAttachmentsFor(body.update.id, data.files);
        }
        await loadUpdates();
        return true;
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not post reply.");
        return false;
      }
    },
    [authHeaders, loadUpdates] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const editComment = useCallback(
    async (id: number, data: { bodyHtml: string }): Promise<boolean> => {
      try {
        const res = await fetch(apiUrl(`/mb/updates/${id}`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ body_html: data.bodyHtml }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Could not edit comment.");
        }
        await loadUpdates();
        return true;
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not edit comment.");
        return false;
      }
    },
    [authHeaders, loadUpdates]
  );

  const deleteComment = useCallback(
    async (id: number) => {
      if (!window.confirm("Delete this comment? This cannot be undone.")) return;
      try {
        const res = await fetch(apiUrl(`/mb/updates/${id}`), {
          method: "DELETE",
          headers: { ...authHeaders() },
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Could not delete comment.");
        }
        await loadUpdates();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not delete comment.");
      }
    },
    [authHeaders, loadUpdates]
  );

  // -------- Reactions (optimistic) --------

  const toggleReaction = useCallback(
    async (updateId: number, emoji: ReactionEmoji, mine: boolean) => {
      // Optimistic local mutation.
      setUpdates((arr) =>
        arr.map((u) => {
          if (u.id !== updateId) return u;
          const reactions = [...(u.reactions ?? [])];
          const idx = reactions.findIndex((r) => r.emoji === emoji);
          if (mine) {
            if (idx >= 0) {
              const next = {
                ...reactions[idx],
                count: Math.max(0, reactions[idx].count - 1),
                users: reactions[idx].users.filter((x) => x.user_id !== user?.id),
              };
              if (next.count <= 0) reactions.splice(idx, 1);
              else reactions[idx] = next;
            }
          } else {
            if (idx >= 0) {
              reactions[idx] = {
                ...reactions[idx],
                count: reactions[idx].count + 1,
                users: [
                  ...reactions[idx].users,
                  { user_id: user!.id, display_name: user!.displayName },
                ],
              };
            } else {
              reactions.push({
                emoji,
                count: 1,
                users: [{ user_id: user!.id, display_name: user!.displayName }],
              });
            }
          }
          return { ...u, reactions };
        })
      );

      try {
        const res = await fetch(apiUrl(`/mb/updates/${updateId}/reactions`), {
          method: mine ? "DELETE" : "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ emoji }),
        });
        if (!res.ok) throw new Error("Reaction failed.");
      } catch {
        // Roll back by reloading.
        await loadUpdates();
      }
    },
    [authHeaders, loadUpdates, user]
  );

  // -------- Render helpers --------

  const { topLevel, repliesByParent } = useMemo(() => {
    const top: ItemUpdate[] = [];
    const byParent = new Map<number, ItemUpdate[]>();
    for (const u of updates) {
      if (u.parent_update_id == null) top.push(u);
      else {
        const arr = byParent.get(u.parent_update_id) ?? [];
        arr.push(u);
        byParent.set(u.parent_update_id, arr);
      }
    }
    // Top-level: created_at DESC (newest first). Replies: ASC under their parent.
    top.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
    for (const arr of Array.from(byParent.values())) {
      arr.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
    }
    return { topLevel: top, repliesByParent: byParent };
  }, [updates]);

  return (
    <div className={`${operationsStyles.page} ${detailStyles.page}`}>
      <OperationsTopBar />
      <div className={detailStyles.main}>
        <div className={detailStyles.headerBar}>
          <Link
            href={`/operations/boards/${boardSlug}#item-${itemId}`}
            className={detailStyles.backLink}
          >
            ← Back to board
          </Link>
          {schema ? (
            <>
              <span className={detailStyles.crumb}>/</span>
              <Link href={`/operations/boards/${boardSlug}`} className={detailStyles.backLink}>
                {schema.board.name}
              </Link>
            </>
          ) : null}
        </div>

        {err ? <div className={detailStyles.errBanner}>{err}</div> : null}

        {loading || !item || !schema ? (
          <div className={detailStyles.loadingState}>Loading item…</div>
        ) : (
          <>
            <h1 className={detailStyles.title}>
              {(item.values?.tenant_name as string | undefined) || item.title}
            </h1>
            <p className={detailStyles.subtitle}>
              {(item.values?.property as string | undefined) || schema.board.name}
            </p>

            <div className={detailStyles.grid}>
              <div className={detailStyles.card}>
                <h3 className={detailStyles.cardTitle}>Details</h3>
                <div className={detailStyles.valuesGrid}>
                  {schema.columns.map((c) => (
                    <div key={c.id} className={detailStyles.valueRow}>
                      <label className={detailStyles.valueLabel}>{c.name}</label>
                      <ColumnValueField
                        column={c}
                        item={item}
                        users={users}
                        onSave={(v) => saveValue(c.key, v)}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <TenantContextPanel context={context} />
                <div style={{ marginTop: "1rem" }}>
                  <PropertyContextPanel context={context} />
                </div>
                <div style={{ marginTop: "1rem" }}>
                  <RelatedItemsPanel items={related} />
                </div>
              </div>
            </div>

            {/* Phase 5: subitems section, between column values and the updates feed. */}
            <SubitemsSection
              parentItem={item}
              columns={schema.columns}
              users={users}
            />

            <div className={detailStyles.feedCard}>
              <h3 className={detailStyles.feedTitle}>Updates</h3>
              <UpdateComposer
                users={mentionUsers}
                submitting={submitting}
                errorText={composerErr}
                onSubmit={postComment}
              />
              {topLevel.length === 0 ? (
                <div className={detailStyles.emptyState}>
                  No updates yet. Be the first to post a comment.
                </div>
              ) : (
                topLevel.map((u) => (
                  <UpdateEntry
                    key={u.id}
                    update={u}
                    replies={repliesByParent.get(u.id) ?? []}
                    currentUserId={user?.id ?? null}
                    isAdmin={isAdmin}
                    users={mentionUsers}
                    onReply={postReply}
                    onEdit={editComment}
                    onDelete={deleteComment}
                    onReact={toggleReaction}
                  />
                ))
              )}
            </div>

            {/* Anchor for "Back to board" hash. The board page can use
                location.hash to scroll the relevant row into view. */}
            <span id={`item-${item.id}`} />
          </>
        )}
      </div>
    </div>
  );
}

function ColumnValueField({
  column,
  item,
  users,
  onSave,
}: {
  column: BoardColumn;
  item: Item;
  users: TeamUser[];
  onSave: (v: unknown) => Promise<void>;
}) {
  const raw = item.values?.[column.key];
  switch (column.column_type) {
    case "text":
      return (
        <TextCell column={column} value={typeof raw === "string" ? raw : null} onSave={(v) => onSave(v)} />
      );
    case "longtext":
      return (
        <LongTextCell column={column} value={typeof raw === "string" ? raw : null} onSave={(v) => onSave(v)} expanded />
      );
    case "number":
      return (
        <NumberCell column={column} value={typeof raw === "number" ? raw : null} onSave={(v) => onSave(v)} />
      );
    case "score":
      return (
        <ScoreCell column={column} value={typeof raw === "number" ? raw : null} onSave={(v) => onSave(v)} />
      );
    case "date":
      return (
        <DateCell column={column} value={typeof raw === "string" ? raw : null} onSave={(v) => onSave(v)} />
      );
    case "status":
    case "dropdown":
      return (
        <StatusCell column={column} value={typeof raw === "string" ? raw : null} onSave={(v) => onSave(v)} />
      );
    case "person":
      return (
        <PersonCell column={column} value={typeof raw === "number" ? raw : null} users={users} onSave={(v) => onSave(v)} />
      );
    default:
      return (
        <div style={{ padding: "0.5rem", color: "#6a737b" }}>
          {raw == null
            ? "—"
            : typeof raw === "string" || typeof raw === "number"
              ? String(raw)
              : JSON.stringify(raw)}
        </div>
      );
  }
}
