"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./customization.module.css";
import ColorPalette, { PALETTE, isPaletteColor } from "./ColorPalette";
import ColumnTypePicker from "./ColumnTypePicker";
import ConfirmDialog from "./ConfirmDialog";
import StatusOptionsEditor from "./StatusOptionsEditor";
import AggregationTab from "./AggregationTab";
import { useReorder } from "./useReorder";
import { apiUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import type {
  Board,
  BoardColumn,
  Group,
  StatusOption,
  UserCreatableColumnType,
} from "@/types/mb";

type Tab = "columns" | "groups" | "settings" | "aggregation";

type BoardSchema = {
  board: Board;
  columns: BoardColumn[];
  groups: Group[];
};

function readOnlyConfig(c: BoardColumn): boolean {
  const cfg = c.config as { readOnly?: boolean } | undefined;
  return cfg?.readOnly === true;
}

function statusOptions(c: BoardColumn): StatusOption[] {
  const cfg = c.config as { options?: StatusOption[] } | undefined;
  return Array.isArray(cfg?.options) ? cfg!.options! : [];
}

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

export default function EditBoardDrawer({
  boardId,
  onClose,
  onChanged,
}: {
  boardId: number;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { authHeaders } = useAuth();
  const [tab, setTab] = useState<Tab>("columns");
  const [schema, setSchema] = useState<BoardSchema | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(
        apiUrl(`/mb/boards/${boardId}?include_archived_columns=true`),
        { headers: { ...authHeaders() }, cache: "no-store" }
      );
      if (!res.ok) throw new Error(await describeFailure(res));
      const body = await res.json();
      setSchema({ board: body.board, columns: body.columns || [], groups: body.groups || [] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load board.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, boardId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const reportChange = useCallback(() => {
    onChanged?.();
  }, [onChanged]);

  const api = useMemo(() => {
    async function send<TResp = unknown>(
      method: "POST" | "PATCH" | "DELETE",
      path: string,
      body?: unknown,
    ): Promise<TResp> {
      setBusy(true);
      setErr(null);
      try {
        const init: RequestInit = {
          method,
          headers: {
            ...authHeaders(),
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        };
        const res = await fetch(apiUrl(path), init);
        if (!res.ok) throw new Error(await describeFailure(res));
        if (res.status === 204) return undefined as TResp;
        return (await res.json()) as TResp;
      } finally {
        setBusy(false);
      }
    }
    return { send };
  }, [authHeaders]);

  const refresh = useCallback(async () => {
    await load();
    reportChange();
  }, [load, reportChange]);

  return (
    <>
      <div className={styles.drawerBackdrop} onClick={onClose} />
      <aside className={styles.drawer} role="dialog" aria-label="Edit board">
        <div className={styles.drawerHeader}>
          <h2 className={styles.drawerTitle}>
            {schema ? `Edit "${schema.board.name}"` : "Edit board"}
          </h2>
          <button
            type="button"
            className={styles.drawerClose}
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className={styles.tabs} role="tablist">
          <button
            role="tab"
            aria-selected={tab === "columns"}
            className={`${styles.tab} ${tab === "columns" ? styles.tabActive : ""}`}
            onClick={() => setTab("columns")}
          >
            Columns
          </button>
          <button
            role="tab"
            aria-selected={tab === "groups"}
            className={`${styles.tab} ${tab === "groups" ? styles.tabActive : ""}`}
            onClick={() => setTab("groups")}
          >
            Groups
          </button>
          <button
            role="tab"
            aria-selected={tab === "settings"}
            className={`${styles.tab} ${tab === "settings" ? styles.tabActive : ""}`}
            onClick={() => setTab("settings")}
          >
            Settings
          </button>
          <button
            role="tab"
            aria-selected={tab === "aggregation"}
            className={`${styles.tab} ${tab === "aggregation" ? styles.tabActive : ""}`}
            onClick={() => setTab("aggregation")}
          >
            Aggregation
          </button>
        </div>

        <div className={styles.drawerBody}>
          {err ? <div className={styles.errorBanner}>{err}</div> : null}
          {loading || !schema ? (
            <div className={styles.rowMeta}>Loading…</div>
          ) : (
            <>
              {tab === "columns" ? (
                <ColumnsTab
                  schema={schema}
                  busy={busy}
                  setErr={setErr}
                  api={api}
                  refresh={refresh}
                />
              ) : null}
              {tab === "groups" ? (
                <GroupsTab
                  schema={schema}
                  busy={busy}
                  setErr={setErr}
                  api={api}
                  refresh={refresh}
                />
              ) : null}
              {tab === "settings" ? (
                <SettingsTab
                  schema={schema}
                  busy={busy}
                  setErr={setErr}
                  api={api}
                  refresh={refresh}
                  onClose={onClose}
                />
              ) : null}
              {tab === "aggregation" ? (
                <AggregationTab
                  boardId={schema.board.id}
                  columns={schema.columns}
                  onError={setErr}
                />
              ) : null}
            </>
          )}
        </div>
      </aside>
    </>
  );
}

// ============================================================
// Tab: Columns
// ============================================================

interface TabProps {
  schema: BoardSchema;
  busy: boolean;
  setErr: (msg: string | null) => void;
  api: { send: <T = unknown>(m: "POST" | "PATCH" | "DELETE", p: string, b?: unknown) => Promise<T> };
  refresh: () => Promise<void>;
}

function ColumnsTab({ schema, busy, setErr, api, refresh }: TabProps) {
  const active = useMemo(
    () => schema.columns.filter((c) => c.archived_at == null),
    [schema.columns]
  );
  const archived = useMemo(
    () => schema.columns.filter((c) => c.archived_at != null),
    [schema.columns]
  );

  const reorder = useReorder<BoardColumn>(active, async (orderedIds) => {
    try {
      await api.send("POST", `/mb/boards/${schema.board.id}/columns/reorder`, {
        order: orderedIds,
      });
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not reorder columns.");
    }
  });

  const [showAdd, setShowAdd] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState<BoardColumn | null>(null);

  async function rename(c: BoardColumn, name: string) {
    if (!name.trim() || name === c.name) return;
    try {
      await api.send("PATCH", `/mb/columns/${c.id}`, { name: name.trim() });
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not rename column.");
    }
  }

  async function restoreColumn(c: BoardColumn) {
    try {
      await api.send("PATCH", `/mb/columns/${c.id}`, { archived: false });
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not restore column.");
    }
  }

  async function doArchive(c: BoardColumn) {
    try {
      await api.send("DELETE", `/mb/columns/${c.id}`);
      setArchiveConfirm(null);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not archive column.");
    }
  }

  return (
    <div>
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Active columns</h3>
        {active.length === 0 ? (
          <div className={styles.rowMeta}>No active columns.</div>
        ) : null}
        {active.map((c, idx) => (
          <ColumnRow
            key={c.id}
            column={c}
            position={idx}
            count={active.length}
            disabled={busy}
            dragging={reorder.draggingId === c.id}
            dropTarget={reorder.dropTargetId === c.id}
            onDragStart={() => reorder.startDrag(c.id)}
            onDragEnter={() => reorder.enterTarget(c.id)}
            onDragEnd={reorder.endDrag}
            onMoveUp={() => reorder.moveBy(c.id, -1)}
            onMoveDown={() => reorder.moveBy(c.id, +1)}
            onRename={(name) => rename(c, name)}
            onArchive={() => setArchiveConfirm(c)}
            api={api}
            refresh={refresh}
            setErr={setErr}
          />
        ))}

        {showAdd ? (
          <AddColumnForm
            boardId={schema.board.id}
            existingColumnNames={active.map((c) => c.name)}
            onCancel={() => setShowAdd(false)}
            onCreated={async () => {
              setShowAdd(false);
              await refresh();
            }}
            api={api}
            setErr={setErr}
          />
        ) : (
          <button
            type="button"
            className={styles.btnGhost}
            onClick={() => setShowAdd(true)}
            disabled={busy}
          >
            + Add column
          </button>
        )}
      </div>

      {archived.length > 0 ? (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Archived columns</h3>
          {archived.map((c) => (
            <div key={c.id} className={`${styles.row} ${styles.rowArchived}`}>
              <span className={styles.rowName}>{c.name}</span>
              <span className={styles.rowMeta}>{c.column_type}</span>
              <div className={styles.rowActions}>
                <button
                  type="button"
                  className={styles.iconBtn}
                  onClick={() => restoreColumn(c)}
                  disabled={busy}
                >
                  Restore
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {archiveConfirm ? (
        <ConfirmDialog
          title="Archive column?"
          body={`"${archiveConfirm.name}" will be hidden from the board. Existing values are preserved and the column can be restored from this drawer.`}
          confirmLabel="Archive"
          destructive
          busy={busy}
          onConfirm={() => doArchive(archiveConfirm)}
          onCancel={() => setArchiveConfirm(null)}
        />
      ) : null}
    </div>
  );
}

function ColumnRow({
  column,
  position,
  count,
  disabled,
  dragging,
  dropTarget,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onMoveUp,
  onMoveDown,
  onRename,
  onArchive,
  api,
  refresh,
  setErr,
}: {
  column: BoardColumn;
  position: number;
  count: number;
  disabled: boolean;
  dragging: boolean;
  dropTarget: boolean;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDragEnd: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRename: (next: string) => void;
  onArchive: () => void;
  api: TabProps["api"];
  refresh: () => Promise<void>;
  setErr: (m: string | null) => void;
}) {
  const [draftName, setDraftName] = useState(column.name);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const readOnly = readOnlyConfig(column);
  const isOptioned = column.column_type === "status" || column.column_type === "dropdown";

  return (
    <>
      <div
        className={`${styles.row} ${dragging ? styles.rowDragging : ""} ${dropTarget ? styles.rowDropTarget : ""}`}
        draggable={!disabled && !readOnly}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          // Firefox requires non-empty data to start a drag.
          e.dataTransfer.setData("text/plain", String(column.id));
          onDragStart();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          onDragEnter();
        }}
        onDrop={(e) => {
          e.preventDefault();
          onDragEnd();
        }}
        onDragEnd={onDragEnd}
      >
        <span
          className={styles.dragHandle}
          aria-label="Drag to reorder"
          title="Drag to reorder"
        >
          ⋮⋮
        </span>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={onMoveUp}
          disabled={disabled || position === 0}
          aria-label="Move up"
          title="Move up"
        >
          ↑
        </button>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={onMoveDown}
          disabled={disabled || position === count - 1}
          aria-label="Move down"
          title="Move down"
        >
          ↓
        </button>
        <input
          type="text"
          className={styles.rowEditableName}
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={() => onRename(draftName.trim())}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
            if (e.key === "Escape") setDraftName(column.name);
          }}
          disabled={disabled || readOnly}
        />
        <span className={styles.rowMeta}>
          {column.column_type}
          {readOnly ? " · read-only" : ""}
        </span>
        <div className={styles.rowActions}>
          {isOptioned ? (
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => setOptionsOpen((v) => !v)}
              disabled={disabled}
            >
              Options
            </button>
          ) : null}
          {!readOnly ? (
            <button
              type="button"
              className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
              onClick={onArchive}
              disabled={disabled}
              aria-label="Archive column"
            >
              Archive
            </button>
          ) : null}
        </div>
      </div>

      {optionsOpen && isOptioned ? (
        <div className={styles.expandable}>
          <ColumnOptionsPanel
            column={column}
            disabled={disabled}
            api={api}
            refresh={refresh}
            setErr={setErr}
          />
        </div>
      ) : null}
    </>
  );
}

function ColumnOptionsPanel({
  column,
  disabled,
  api,
  refresh,
  setErr,
}: {
  column: BoardColumn;
  disabled: boolean;
  api: TabProps["api"];
  refresh: () => Promise<void>;
  setErr: (m: string | null) => void;
}) {
  const options = statusOptions(column);
  const [localOptions, setLocalOptions] = useState<StatusOption[]>(options);
  const [pendingDelete, setPendingDelete] = useState<{
    option: StatusOption;
    busy: boolean;
    error: string | null;
  } | null>(null);

  // Keep local in sync if parent refreshes.
  useEffect(() => {
    setLocalOptions(statusOptions(column));
  }, [column]);

  async function persistAdded(label: string, color: string) {
    try {
      await api.send("POST", `/mb/columns/${column.id}/options`, { label, color });
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add option.");
    }
  }

  async function persistRename(o: StatusOption, label: string, color: string) {
    if (!o.value) return; // Should never happen for existing options.
    try {
      await api.send("PATCH", `/mb/columns/${column.id}/options/${o.value}`, {
        label,
        color,
      });
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not update option.");
    }
  }

  async function doDelete(o: StatusOption) {
    if (!o.value) return;
    setPendingDelete((p) => (p ? { ...p, busy: true, error: null } : p));
    try {
      await api.send("DELETE", `/mb/columns/${column.id}/options/${o.value}`);
      setPendingDelete(null);
      await refresh();
    } catch (e) {
      setPendingDelete((p) =>
        p ? { ...p, busy: false, error: e instanceof Error ? e.message : "Could not delete option." } : p
      );
    }
  }

  // Wrap StatusOptionsEditor: when an existing option's label/color
  // changes we diff against the original and PATCH; for new options
  // (no value) we POST on the synthesized "add" path.
  function handleChange(next: StatusOption[]) {
    const original = statusOptions(column);
    // Detect a brand-new entry (value === "") appended by the editor.
    const justAdded = next.find((o) => !o.value);
    if (justAdded && next.length > original.length) {
      persistAdded(justAdded.label.trim(), justAdded.color || PALETTE[0].value);
      return;
    }
    // Detect a label/color change to an existing option.
    for (let i = 0; i < next.length; i++) {
      const o = next[i];
      if (!o.value) continue;
      const orig = original.find((x) => x.value === o.value);
      if (!orig) continue;
      if (orig.label !== o.label.trim() || orig.color !== o.color) {
        persistRename(o, o.label.trim(), o.color || PALETTE[0].value);
        return;
      }
    }
    // Pure local edit (e.g., typing mid-rename). Just mirror.
    setLocalOptions(next);
  }

  return (
    <div>
      <StatusOptionsEditor
        options={localOptions}
        onChange={handleChange}
        onDeleteRequest={(o) => setPendingDelete({ option: o, busy: false, error: null })}
        disabled={disabled}
      />
      {pendingDelete ? (
        <ConfirmDialog
          title={pendingDelete.error ? "Cannot delete option" : "Delete option?"}
          body={
            pendingDelete.error
              ? pendingDelete.error
              : `"${pendingDelete.option.label}" will be removed. This is blocked if any item currently uses it.`
          }
          confirmLabel={pendingDelete.error ? "OK" : "Delete"}
          cancelLabel={pendingDelete.error ? "Close" : "Cancel"}
          destructive={!pendingDelete.error}
          busy={pendingDelete.busy}
          onConfirm={() => {
            if (pendingDelete.error) {
              setPendingDelete(null);
            } else {
              doDelete(pendingDelete.option);
            }
          }}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </div>
  );
}

function AddColumnForm({
  boardId,
  existingColumnNames,
  onCancel,
  onCreated,
  api,
  setErr,
}: {
  boardId: number;
  existingColumnNames: string[];
  onCancel: () => void;
  onCreated: () => Promise<void>;
  api: TabProps["api"];
  setErr: (m: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<UserCreatableColumnType | null>(null);
  const [options, setOptions] = useState<StatusOption[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const trimmed = name.trim();
  const dup = trimmed
    ? existingColumnNames.some((n) => n.toLowerCase() === trimmed.toLowerCase())
    : false;
  const canSubmit = !!trimmed && !!type && !dup && !submitting;
  const needsOptions = type === "status" || type === "dropdown";

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setErr(null);
    try {
      const optionsPayload = needsOptions
        ? options
            .filter((o) => o.label.trim())
            .map((o) => ({
              label: o.label.trim(),
              color: isPaletteColor(o.color) ? o.color : PALETTE[0].value,
            }))
        : undefined;
      await api.send("POST", `/mb/boards/${boardId}/columns`, {
        name: trimmed,
        column_type: type,
        options: optionsPayload,
      });
      await onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create column.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.expandable}>
      <div className={styles.section}>
        <label className={styles.sectionTitle}>Column name</label>
        <input
          className={styles.input}
          value={name}
          autoFocus
          placeholder="e.g., Priority"
          onChange={(e) => setName(e.target.value)}
        />
        {dup ? (
          <div className={styles.errorBanner} style={{ marginTop: "0.5rem" }}>
            A column with that name already exists on this board.
          </div>
        ) : null}
      </div>
      <div className={styles.section}>
        <label className={styles.sectionTitle}>Type (cannot be changed later)</label>
        <ColumnTypePicker value={type} onChange={setType} disabled={submitting} />
      </div>
      {needsOptions ? (
        <div className={styles.section}>
          <label className={styles.sectionTitle}>Options</label>
          <StatusOptionsEditor
            options={options}
            onChange={setOptions}
            disabled={submitting}
          />
        </div>
      ) : null}
      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
        <button type="button" className={styles.btnGhost} onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={submit}
          disabled={!canSubmit}
        >
          {submitting ? "Adding…" : "Add column"}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Tab: Groups
// ============================================================

function GroupsTab({ schema, busy, setErr, api, refresh }: TabProps) {
  const reorder = useReorder<Group>(schema.groups, async (orderedIds) => {
    try {
      await api.send("POST", `/mb/boards/${schema.board.id}/groups/reorder`, {
        order: orderedIds,
      });
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not reorder groups.");
    }
  });

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>(PALETTE[5].value); // blue
  const [deleteRequest, setDeleteRequest] = useState<{
    group: Group;
    busy: boolean;
    error: string | null;
  } | null>(null);

  async function rename(g: Group, name: string) {
    if (!name.trim() || name === g.name) return;
    try {
      await api.send("PATCH", `/mb/groups/${g.id}`, { name: name.trim() });
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not rename group.");
    }
  }

  async function recolor(g: Group, color: string) {
    try {
      await api.send("PATCH", `/mb/groups/${g.id}`, { color });
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not change group color.");
    }
  }

  async function addGroup() {
    const n = newName.trim();
    if (!n) return;
    try {
      await api.send("POST", `/mb/boards/${schema.board.id}/groups`, {
        name: n,
        color: newColor,
      });
      setShowAdd(false);
      setNewName("");
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create group.");
    }
  }

  async function doDelete(g: Group) {
    setDeleteRequest((d) => (d ? { ...d, busy: true, error: null } : d));
    try {
      await api.send("DELETE", `/mb/groups/${g.id}`);
      setDeleteRequest(null);
      await refresh();
    } catch (e) {
      setDeleteRequest((d) =>
        d
          ? { ...d, busy: false, error: e instanceof Error ? e.message : "Could not delete group." }
          : d
      );
    }
  }

  return (
    <div>
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Groups</h3>
        {schema.groups.length === 0 ? (
          <div className={styles.rowMeta}>No groups yet.</div>
        ) : null}
        {schema.groups.map((g, idx) => (
          <GroupRow
            key={g.id}
            group={g}
            position={idx}
            count={schema.groups.length}
            disabled={busy}
            dragging={reorder.draggingId === g.id}
            dropTarget={reorder.dropTargetId === g.id}
            onDragStart={() => reorder.startDrag(g.id)}
            onDragEnter={() => reorder.enterTarget(g.id)}
            onDragEnd={reorder.endDrag}
            onMoveUp={() => reorder.moveBy(g.id, -1)}
            onMoveDown={() => reorder.moveBy(g.id, +1)}
            onRename={(name) => rename(g, name)}
            onRecolor={(c) => recolor(g, c)}
            onDelete={() => setDeleteRequest({ group: g, busy: false, error: null })}
          />
        ))}

        {showAdd ? (
          <div className={styles.expandable}>
            <label className={styles.sectionTitle}>Group name</label>
            <input
              className={styles.input}
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g., Backlog"
            />
            <label className={styles.sectionTitle} style={{ marginTop: "0.5rem", display: "block" }}>
              Color
            </label>
            <ColorPalette value={newColor} onChange={setNewColor} />
            <div
              style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "0.5rem" }}
            >
              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => {
                  setShowAdd(false);
                  setNewName("");
                }}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={addGroup}
                disabled={busy || !newName.trim()}
              >
                Add group
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className={styles.btnGhost}
            onClick={() => setShowAdd(true)}
            disabled={busy}
          >
            + Add group
          </button>
        )}
      </div>

      {deleteRequest ? (
        <ConfirmDialog
          title={deleteRequest.error ? "Cannot delete group" : "Delete group?"}
          body={
            deleteRequest.error
              ? deleteRequest.error
              : `Delete "${deleteRequest.group.name}"? This cannot be undone.`
          }
          confirmLabel={deleteRequest.error ? "OK" : "Delete"}
          cancelLabel={deleteRequest.error ? "Close" : "Cancel"}
          destructive={!deleteRequest.error}
          busy={deleteRequest.busy}
          onConfirm={() => {
            if (deleteRequest.error) setDeleteRequest(null);
            else doDelete(deleteRequest.group);
          }}
          onCancel={() => setDeleteRequest(null)}
        />
      ) : null}
    </div>
  );
}

function GroupRow({
  group,
  position,
  count,
  disabled,
  dragging,
  dropTarget,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onMoveUp,
  onMoveDown,
  onRename,
  onRecolor,
  onDelete,
}: {
  group: Group;
  position: number;
  count: number;
  disabled: boolean;
  dragging: boolean;
  dropTarget: boolean;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDragEnd: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRename: (next: string) => void;
  onRecolor: (color: string) => void;
  onDelete: () => void;
}) {
  const [draftName, setDraftName] = useState(group.name);
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <>
      <div
        className={`${styles.row} ${dragging ? styles.rowDragging : ""} ${dropTarget ? styles.rowDropTarget : ""}`}
        draggable={!disabled}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", String(group.id));
          onDragStart();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          onDragEnter();
        }}
        onDrop={(e) => {
          e.preventDefault();
          onDragEnd();
        }}
        onDragEnd={onDragEnd}
      >
        <span className={styles.dragHandle} aria-label="Drag to reorder">
          ⋮⋮
        </span>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={onMoveUp}
          disabled={disabled || position === 0}
          aria-label="Move up"
        >
          ↑
        </button>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={onMoveDown}
          disabled={disabled || position === count - 1}
          aria-label="Move down"
        >
          ↓
        </button>
        <button
          type="button"
          className={styles.colorDotBtn}
          style={{ background: group.color ?? PALETTE[10].value }}
          aria-label="Change color"
          onClick={() => setPickerOpen((v) => !v)}
          disabled={disabled}
        />
        <input
          type="text"
          className={styles.rowEditableName}
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={() => onRename(draftName.trim())}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
            if (e.key === "Escape") setDraftName(group.name);
          }}
          disabled={disabled}
        />
        <div className={styles.rowActions}>
          <button
            type="button"
            className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
            onClick={onDelete}
            disabled={disabled}
            aria-label="Delete group"
          >
            Delete
          </button>
        </div>
      </div>
      {pickerOpen ? (
        <div className={styles.expandable}>
          <ColorPalette
            value={group.color}
            onChange={(c) => {
              onRecolor(c);
              setPickerOpen(false);
            }}
          />
        </div>
      ) : null}
    </>
  );
}

// ============================================================
// Tab: Settings
// ============================================================

function SettingsTab({
  schema,
  busy,
  setErr,
  api,
  refresh,
  onClose,
}: TabProps & { onClose: () => void }) {
  const { board } = schema;
  const [draftName, setDraftName] = useState(board.name);
  const [archiveConfirm, setArchiveConfirm] = useState(false);

  async function saveName() {
    const next = draftName.trim();
    if (!next || next === board.name) return;
    try {
      await api.send("PATCH", `/mb/boards/${board.id}`, { name: next });
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not rename board.");
    }
  }

  async function doArchive() {
    try {
      await api.send("PATCH", `/mb/boards/${board.id}`, { archived: true });
      setArchiveConfirm(false);
      // Board is archived — close the drawer; the parent should redirect away.
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not archive board.");
    }
  }

  return (
    <div>
      {board.is_system ? (
        <div className={styles.lockedNote}>
          This is a system board. Its name and archive state are locked.
          You can still add columns and groups.
        </div>
      ) : null}

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Board name</h3>
        <input
          type="text"
          className={styles.input}
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
          }}
          disabled={busy || board.is_system}
        />
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Archive board</h3>
        <p className={styles.rowMeta} style={{ marginBottom: "0.5rem" }}>
          Archiving hides this board from the boards picker but preserves all data.
          Restore from the Manage Boards page.
        </p>
        <button
          type="button"
          className={styles.btnDanger}
          onClick={() => setArchiveConfirm(true)}
          disabled={busy || board.is_system}
        >
          Archive this board
        </button>
      </div>

      {archiveConfirm ? (
        <ConfirmDialog
          title="Archive board?"
          body={`"${board.name}" and its data will be hidden from the boards picker. You can restore it later from Manage Boards.`}
          confirmLabel="Archive"
          destructive
          busy={busy}
          onConfirm={doArchive}
          onCancel={() => setArchiveConfirm(false)}
        />
      ) : null}
    </div>
  );
}
