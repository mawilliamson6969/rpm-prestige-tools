"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import operationsStyles from "../../operations.module.css";
import renewalsStyles from "../renewals/renewals.module.css";
import customizationStyles from "../components/customization.module.css";
import OperationsTopBar from "../../OperationsTopBar";
import ConfirmDialog from "../components/ConfirmDialog";
import { apiUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import type { Board } from "@/types/mb";
import { useRouter } from "next/navigation";

async function describeFailure(res: Response): Promise<string> {
  const status = `${res.status} ${res.statusText || ""}`.trim();
  try {
    const text = await res.text();
    if (!text) return status;
    try {
      const body = JSON.parse(text);
      if (typeof body?.error === "string") return body.error;
      return `${status}: ${text.slice(0, 200)}`;
    } catch {
      return `${status}: ${text.slice(0, 200)}`;
    }
  } catch {
    return status;
  }
}

export default function ManageBoardsClient() {
  const { authHeaders, token, isAdmin, loading: authLoading } = useAuth();
  const router = useRouter();
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState<Board | null>(null);

  // Non-admins shouldn't reach this page. Redirect them.
  useEffect(() => {
    if (authLoading) return;
    if (!isAdmin) router.replace("/operations/boards/renewals");
  }, [authLoading, isAdmin, router]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(apiUrl("/mb/boards?include_archived=true"), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await describeFailure(res));
      const body = await res.json();
      setBoards(body.boards || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load boards.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token]);

  useEffect(() => {
    load();
  }, [load]);

  const active = useMemo(() => boards.filter((b) => b.archived_at == null), [boards]);
  const archived = useMemo(
    () => boards.filter((b) => b.archived_at != null),
    [boards]
  );

  async function create() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(apiUrl("/mb/boards"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(await describeFailure(res));
      const body = await res.json();
      const created: Board = body.board;
      setCreating(false);
      setNewName("");
      await load();
      // Jump straight to the new board so the admin can start customizing.
      router.push(`/operations/boards/${created.slug}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create board.");
    } finally {
      setBusy(false);
    }
  }

  async function archive(b: Board) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(apiUrl(`/mb/boards/${b.id}`), {
        method: "DELETE",
        headers: { ...authHeaders() },
      });
      if (!res.ok) throw new Error(await describeFailure(res));
      setArchiveConfirm(null);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not archive board.");
    } finally {
      setBusy(false);
    }
  }

  async function restore(b: Board) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(apiUrl(`/mb/boards/${b.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ archived: false }),
      });
      if (!res.ok) throw new Error(await describeFailure(res));
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not restore board.");
    } finally {
      setBusy(false);
    }
  }

  // Rename uses an inline prompt for simplicity (Phase 3.5 scope). For
  // anything more elaborate we can graduate to a dedicated rename modal.
  async function rename(b: Board) {
    if (b.is_system) {
      setErr("System boards cannot be renamed.");
      return;
    }
    const next = window.prompt(`Rename "${b.name}" to:`, b.name);
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === b.name) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(apiUrl(`/mb/boards/${b.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error(await describeFailure(res));
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not rename board.");
    } finally {
      setBusy(false);
    }
  }

  if (authLoading || !isAdmin) {
    return (
      <div className={operationsStyles.page}>
        <OperationsTopBar />
        <div className={operationsStyles.main}>
          <div className={renewalsStyles.loadingState}>Checking permissions…</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${operationsStyles.page} ${renewalsStyles.page}`}>
      <OperationsTopBar />
      <div className={renewalsStyles.main}>
        <div className={renewalsStyles.boardHeader}>
          <div>
            <h2 className={renewalsStyles.boardTitle}>
              Manage Boards
              <span className={renewalsStyles.betaBadge}>Beta</span>
            </h2>
            <p className={renewalsStyles.boardDescription}>
              Create, rename, archive, and restore your Monday-style boards.
            </p>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
            {creating ? null : (
              <button
                type="button"
                className={`${renewalsStyles.btn} ${renewalsStyles.btnPrimary}`}
                onClick={() => setCreating(true)}
                disabled={busy}
              >
                + New board
              </button>
            )}
          </div>
        </div>

        {err ? <div className={renewalsStyles.errorBanner}>{err}</div> : null}

        {creating ? (
          <div className={customizationStyles.expandable} style={{ marginBottom: "1rem" }}>
            <label className={customizationStyles.sectionTitle}>Board name</label>
            <div className={customizationStyles.addRow}>
              <input
                autoFocus
                type="text"
                className={customizationStyles.input}
                value={newName}
                placeholder="e.g., Maintenance"
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    create();
                  }
                  if (e.key === "Escape") {
                    setCreating(false);
                    setNewName("");
                  }
                }}
                disabled={busy}
              />
              <button
                type="button"
                className={customizationStyles.btnGhost}
                onClick={() => {
                  setCreating(false);
                  setNewName("");
                }}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className={customizationStyles.btnPrimary}
                onClick={create}
                disabled={busy || !newName.trim()}
              >
                {busy ? "Creating…" : "Create board"}
              </button>
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className={renewalsStyles.loadingState}>Loading boards…</div>
        ) : (
          <>
            <h3 className={customizationStyles.sectionTitle}>Active boards</h3>
            {active.length === 0 ? (
              <div className={renewalsStyles.emptyState}>
                No boards yet. Click “New board” to create one.
              </div>
            ) : (
              active.map((b) => (
                <BoardCard
                  key={b.id}
                  board={b}
                  busy={busy}
                  onRename={() => rename(b)}
                  onArchive={() => setArchiveConfirm(b)}
                />
              ))
            )}

            {archived.length > 0 ? (
              <div style={{ marginTop: "1.5rem" }}>
                <h3 className={customizationStyles.sectionTitle}>Archived boards</h3>
                {archived.map((b) => (
                  <div
                    key={b.id}
                    className={`${customizationStyles.boardCard} ${customizationStyles.boardCardArchived}`}
                  >
                    <span className={customizationStyles.boardIcon}>{b.icon || "📋"}</span>
                    <div className={customizationStyles.boardCardMain}>
                      <h4 className={customizationStyles.boardCardName}>
                        {b.name}
                        <span className={customizationStyles.archivedBadge}>Archived</span>
                      </h4>
                      {b.description ? (
                        <p className={customizationStyles.boardCardDescription}>
                          {b.description}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className={customizationStyles.btnGhost}
                      onClick={() => restore(b)}
                      disabled={busy}
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>

      {archiveConfirm ? (
        <ConfirmDialog
          title="Archive board?"
          body={`"${archiveConfirm.name}" will be hidden from the boards picker. You can restore it from this page later.`}
          confirmLabel="Archive"
          destructive
          busy={busy}
          onConfirm={() => archive(archiveConfirm)}
          onCancel={() => setArchiveConfirm(null)}
        />
      ) : null}
    </div>
  );
}

function BoardCard({
  board,
  busy,
  onRename,
  onArchive,
}: {
  board: Board;
  busy: boolean;
  onRename: () => void;
  onArchive: () => void;
}) {
  // Linking: Renewals lives at /operations/boards/renewals. Future boards
  // will live at /operations/boards/[slug] — until that page is built in
  // a later phase, only Renewals is clickable.
  const isRenewals = board.slug === "renewals";
  const href = isRenewals ? "/operations/boards/renewals" : null;
  const inner = (
    <>
      <span className={customizationStyles.boardIcon}>{board.icon || "📋"}</span>
      <div className={customizationStyles.boardCardMain}>
        <h4 className={customizationStyles.boardCardName}>
          {board.name}
          {board.is_system ? (
            <span className={customizationStyles.systemBadge}>System</span>
          ) : null}
        </h4>
        {board.description ? (
          <p className={customizationStyles.boardCardDescription}>{board.description}</p>
        ) : null}
      </div>
    </>
  );

  return (
    <div className={customizationStyles.boardCard}>
      {href ? (
        <Link
          href={href}
          style={{ display: "contents", textDecoration: "none", color: "inherit" }}
        >
          {inner}
        </Link>
      ) : (
        <div style={{ display: "contents" }}>{inner}</div>
      )}
      <div className={customizationStyles.rowActions}>
        <button
          type="button"
          className={customizationStyles.iconBtn}
          onClick={onRename}
          disabled={busy || board.is_system}
          title={board.is_system ? "System boards cannot be renamed" : "Rename board"}
        >
          Rename
        </button>
        <button
          type="button"
          className={`${customizationStyles.iconBtn} ${customizationStyles.iconBtnDanger}`}
          onClick={onArchive}
          disabled={busy || board.is_system}
          title={board.is_system ? "System boards cannot be archived" : "Archive board"}
        >
          Archive
        </button>
      </div>
    </div>
  );
}
