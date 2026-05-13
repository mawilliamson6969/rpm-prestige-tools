"use client";

import { useEffect, useRef, useState } from "react";
import styles from "../renewals.module.css";
import type { BoardColumn } from "@/types/mb";
import {
  colorForScore,
  isReadOnly,
  scoreThresholds,
  statusOptionsFor,
  type TeamUser,
} from "./types";

interface BaseProps<T> {
  column: BoardColumn;
  value: T;
  onSave: (next: T) => Promise<void> | void;
  /** Optional inline render override (used by drawer for richer layout). */
  expanded?: boolean;
}

function placeholder() {
  return <span className={styles.placeholder}>Click to set</span>;
}

// ============================================================
// Text
// ============================================================

export function TextCell({
  column,
  value,
  onSave,
  expanded,
}: BaseProps<string | null>) {
  const readOnly = isReadOnly(column);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  if (readOnly) {
    return (
      <div className={`${styles.cell} ${styles.cellReadOnly}`}>
        {value ? value : <span className={styles.placeholder}>—</span>}
      </div>
    );
  }
  if (!editing) {
    return (
      <div
        className={`${styles.cell} ${styles.cellEditable}`}
        onClick={() => setEditing(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setEditing(true);
          }
        }}
      >
        {value ? value : placeholder()}
      </div>
    );
  }
  return (
    <div className={styles.cell}>
      <input
        autoFocus
        className={styles.inlineInput}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={async () => {
          setEditing(false);
          if ((draft || null) !== (value ?? null)) {
            await onSave(draft.trim() === "" ? null : draft);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setDraft(value ?? "");
            setEditing(false);
          } else if (e.key === "Enter") {
            e.currentTarget.blur();
          }
        }}
      />
      {expanded ? null : null}
    </div>
  );
}

// ============================================================
// Long text / Notes
// ============================================================

export function LongTextCell({
  column,
  value,
  onSave,
  expanded,
}: BaseProps<string | null>) {
  const readOnly = isReadOnly(column);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  if (readOnly) {
    return (
      <div className={`${styles.cell} ${styles.cellReadOnly}`}>
        {value || <span className={styles.placeholder}>—</span>}
      </div>
    );
  }

  if (!editing && !expanded) {
    return (
      <div
        className={`${styles.cell} ${styles.cellEditable}`}
        onClick={() => setEditing(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setEditing(true);
          }
        }}
        title={value ?? undefined}
      >
        {value ? value : placeholder()}
      </div>
    );
  }
  return (
    <div className={styles.cell}>
      <textarea
        autoFocus
        className={styles.inlineTextarea}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={async () => {
          setEditing(false);
          if ((draft || null) !== (value ?? null)) {
            await onSave(draft.trim() === "" ? null : draft);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setDraft(value ?? "");
            setEditing(false);
          } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}

// ============================================================
// Number / Score
// ============================================================

export function NumberCell({
  column,
  value,
  onSave,
}: BaseProps<number | null>) {
  const readOnly = isReadOnly(column);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(value == null ? "" : String(value));

  useEffect(() => {
    setDraft(value == null ? "" : String(value));
  }, [value]);

  if (readOnly) {
    return (
      <div className={`${styles.cell} ${styles.cellReadOnly}`}>
        {value == null ? <span className={styles.placeholder}>—</span> : value}
      </div>
    );
  }

  if (!editing) {
    return (
      <div
        className={`${styles.cell} ${styles.cellEditable}`}
        onClick={() => setEditing(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setEditing(true);
          }
        }}
      >
        {value == null ? placeholder() : value}
      </div>
    );
  }
  return (
    <div className={styles.cell}>
      <input
        autoFocus
        type="number"
        className={styles.inlineInput}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={async () => {
          setEditing(false);
          const parsed = draft.trim() === "" ? null : Number(draft);
          if (parsed != null && Number.isNaN(parsed)) return;
          if (parsed !== (value ?? null)) {
            await onSave(parsed);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setDraft(value == null ? "" : String(value));
            setEditing(false);
          } else if (e.key === "Enter") {
            e.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}

export function ScoreCell({
  column,
  value,
  onSave,
}: BaseProps<number | null>) {
  const readOnly = isReadOnly(column);
  const thresholds = scoreThresholds(column);
  const color = colorForScore(value, thresholds);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(value == null ? "" : String(value));
  const cfg = column.config as { min?: number; max?: number } | undefined;
  const min = typeof cfg?.min === "number" ? cfg.min : 0;
  const max = typeof cfg?.max === "number" ? cfg.max : 100;

  useEffect(() => {
    setDraft(value == null ? "" : String(value));
  }, [value]);

  if (readOnly) {
    return (
      <div className={`${styles.cell} ${styles.cellReadOnly}`}>
        <span className={styles.scoreCellInner}>
          <span className={styles.scoreDot} style={{ background: color }} />
          <span className={styles.scoreVal}>
            {value == null ? "—" : value}
          </span>
        </span>
      </div>
    );
  }

  if (!editing) {
    return (
      <div
        className={`${styles.cell} ${styles.cellEditable}`}
        onClick={() => setEditing(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setEditing(true);
          }
        }}
      >
        <span className={styles.scoreCellInner}>
          <span className={styles.scoreDot} style={{ background: color }} />
          <span className={styles.scoreVal}>
            {value == null ? placeholder() : value}
          </span>
        </span>
      </div>
    );
  }
  return (
    <div className={styles.cell}>
      <input
        autoFocus
        type="number"
        min={min}
        max={max}
        className={styles.inlineInput}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={async () => {
          setEditing(false);
          const parsed = draft.trim() === "" ? null : Number(draft);
          if (parsed != null && (Number.isNaN(parsed) || parsed < min || parsed > max)) {
            setDraft(value == null ? "" : String(value));
            return;
          }
          if (parsed !== (value ?? null)) {
            await onSave(parsed);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setDraft(value == null ? "" : String(value));
            setEditing(false);
          } else if (e.key === "Enter") {
            e.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}

// ============================================================
// Date
// ============================================================

export function DateCell({ column, value, onSave }: BaseProps<string | null>) {
  const readOnly = isReadOnly(column);
  const [editing, setEditing] = useState(false);

  function fmt(v: string | null): string {
    if (!v) return "";
    const d = new Date(`${v}T00:00:00`);
    if (Number.isNaN(d.getTime())) return v;
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  if (readOnly) {
    return (
      <div className={`${styles.cell} ${styles.cellReadOnly}`}>
        {value ? fmt(value) : <span className={styles.placeholder}>—</span>}
      </div>
    );
  }

  if (!editing) {
    return (
      <div
        className={`${styles.cell} ${styles.cellEditable}`}
        onClick={() => setEditing(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setEditing(true);
          }
        }}
      >
        {value ? fmt(value) : placeholder()}
      </div>
    );
  }
  return (
    <div className={styles.cell}>
      <input
        autoFocus
        type="date"
        className={styles.inlineInput}
        defaultValue={value ?? ""}
        onBlur={async (e) => {
          setEditing(false);
          const next = e.target.value || null;
          if (next !== (value ?? null)) {
            await onSave(next);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setEditing(false);
          } else if (e.key === "Enter") {
            e.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}

// ============================================================
// Status
// ============================================================

export function StatusCell({
  column,
  value,
  onSave,
}: BaseProps<string | null>) {
  const options = statusOptionsFor(column);
  const [open, setOpen] = useState(false);
  const cellRef = useRef<HTMLDivElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  const current = options.find((o) => o.value === value);
  const color = current?.color ?? "#6a737b";
  const label = current?.label ?? "Set status";

  useEffect(() => {
    if (!open) return;
    function onDoc(ev: MouseEvent) {
      if (popRef.current?.contains(ev.target as Node)) return;
      if (cellRef.current?.contains(ev.target as Node)) return;
      setOpen(false);
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      ref={cellRef}
      className={`${styles.cell} ${styles.cellEditable}`}
      onClick={() => setOpen((v) => !v)}
      role="button"
      tabIndex={0}
      style={{ position: "relative" }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setOpen((v) => !v);
        }
      }}
    >
      {current ? (
        <span className={styles.statusChip} style={{ background: color }}>
          {label}
        </span>
      ) : (
        placeholder()
      )}
      {open ? (
        <div
          ref={popRef}
          className={styles.popover}
          style={{ top: "100%", left: 0, marginTop: 4 }}
          onClick={(e) => e.stopPropagation()}
        >
          {options.map((o) => (
            <button
              type="button"
              key={o.value}
              className={`${styles.popoverOption} ${
                o.value === value ? styles.popoverOptionActive : ""
              }`}
              onClick={async () => {
                setOpen(false);
                if (o.value !== value) await onSave(o.value);
              }}
            >
              <span
                className={styles.popoverDot}
                style={{ background: o.color ?? "#6a737b" }}
              />
              {o.label}
            </button>
          ))}
          {value ? (
            <>
              <div className={styles.popoverSep} />
              <button
                type="button"
                className={styles.popoverOption}
                onClick={async () => {
                  setOpen(false);
                  await onSave(null);
                }}
              >
                Clear
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ============================================================
// Person
// ============================================================

export function PersonCell({
  value,
  onSave,
  users,
}: BaseProps<number | null> & { users: TeamUser[] }) {
  const [open, setOpen] = useState(false);
  const cellRef = useRef<HTMLDivElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  const current = users.find((u) => u.id === value);

  useEffect(() => {
    if (!open) return;
    function onDoc(ev: MouseEvent) {
      if (popRef.current?.contains(ev.target as Node)) return;
      if (cellRef.current?.contains(ev.target as Node)) return;
      setOpen(false);
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      ref={cellRef}
      className={`${styles.cell} ${styles.cellEditable}`}
      style={{ position: "relative" }}
      role="button"
      tabIndex={0}
      onClick={() => setOpen((v) => !v)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setOpen((v) => !v);
        }
      }}
    >
      {current ? (
        <span style={{ fontWeight: 600 }}>{current.displayName}</span>
      ) : (
        placeholder()
      )}
      {open ? (
        <div
          ref={popRef}
          className={styles.popover}
          style={{ top: "100%", left: 0, marginTop: 4 }}
          onClick={(e) => e.stopPropagation()}
        >
          {users.length === 0 ? (
            <div style={{ padding: "0.5rem", color: "#6a737b", fontSize: "0.8rem" }}>
              No team members available
            </div>
          ) : (
            users.map((u) => (
              <button
                type="button"
                key={u.id}
                className={`${styles.popoverOption} ${
                  u.id === value ? styles.popoverOptionActive : ""
                }`}
                onClick={async () => {
                  setOpen(false);
                  if (u.id !== value) await onSave(u.id);
                }}
              >
                <span
                  className={styles.popoverDot}
                  style={{ background: "#0098d0" }}
                />
                {u.displayName}
              </button>
            ))
          )}
          {value != null ? (
            <>
              <div className={styles.popoverSep} />
              <button
                type="button"
                className={styles.popoverOption}
                onClick={async () => {
                  setOpen(false);
                  await onSave(null);
                }}
              >
                Unassign
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
