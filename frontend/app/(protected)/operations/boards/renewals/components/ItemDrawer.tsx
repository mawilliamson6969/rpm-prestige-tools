"use client";

import Link from "next/link";
import { useEffect } from "react";
import styles from "../renewals.module.css";
import type { BoardColumn, Item } from "@/types/mb";
import {
  DateCell,
  LongTextCell,
  NumberCell,
  PersonCell,
  ScoreCell,
  StatusCell,
  TextCell,
} from "./CellEditors";
import { bucketForItem, daysUntilLeaseEnd, type TeamUser } from "./types";

export default function ItemDrawer({
  item,
  columns,
  users,
  onClose,
  onSaveValue,
}: {
  item: Item;
  columns: BoardColumn[];
  users: TeamUser[];
  onClose: () => void;
  onSaveValue: (itemId: number, columnKey: string, next: unknown) => Promise<void>;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const bucket = bucketForItem(item);
  const days = daysUntilLeaseEnd(item);
  const tenant =
    (typeof item.values?.tenant_name === "string" && item.values.tenant_name) ||
    item.title;
  const property =
    typeof item.values?.property === "string" ? item.values.property : "";

  return (
    <>
      <div className={styles.drawerBackdrop} onClick={onClose} />
      <aside className={styles.drawer} role="dialog" aria-label="Renewal details">
        <div className={styles.drawerHeader}>
          <div>
            <h2 className={styles.drawerTitle}>{tenant}</h2>
            <p className={styles.drawerSubtitle}>
              {property}
              {property ? " · " : ""}
              <span style={{ color: bucket.color, fontWeight: 700 }}>
                {bucket.label}
              </span>
              {days != null ? (
                <>
                  {" "}
                  ({days < 0 ? `${Math.abs(days)} days ago` : `${days} days out`})
                </>
              ) : null}
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <Link
              href={`/operations/boards/renewals/items/${item.id}`}
              className={styles.drawerClose}
              aria-label="Expand to full view"
              title="Expand to full view"
              style={{ fontSize: "1.1rem", textDecoration: "none" }}
            >
              ⤢
            </Link>
            <button
              type="button"
              className={styles.drawerClose}
              onClick={onClose}
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        <div className={styles.drawerBody}>
          {columns.map((c) => {
            const raw = item.values?.[c.key];
            return (
              <div key={c.id} className={styles.drawerField}>
                <label className={styles.drawerLabel}>{c.name}</label>
                <DrawerFieldEditor
                  column={c}
                  raw={raw}
                  users={users}
                  onSave={(v) => onSaveValue(item.id, c.key, v)}
                />
              </div>
            );
          })}
        </div>
      </aside>
    </>
  );
}

function DrawerFieldEditor({
  column,
  raw,
  users,
  onSave,
}: {
  column: BoardColumn;
  raw: unknown;
  users: TeamUser[];
  onSave: (v: unknown) => Promise<void>;
}) {
  switch (column.column_type) {
    case "text":
      return (
        <TextCell
          column={column}
          value={typeof raw === "string" ? raw : null}
          onSave={(v) => onSave(v)}
        />
      );
    case "longtext":
      return (
        <LongTextCell
          column={column}
          value={typeof raw === "string" ? raw : null}
          onSave={(v) => onSave(v)}
          expanded
        />
      );
    case "number":
      return (
        <NumberCell
          column={column}
          value={typeof raw === "number" ? raw : null}
          onSave={(v) => onSave(v)}
        />
      );
    case "score":
      return (
        <ScoreCell
          column={column}
          value={typeof raw === "number" ? raw : null}
          onSave={(v) => onSave(v)}
        />
      );
    case "date":
      return (
        <DateCell
          column={column}
          value={typeof raw === "string" ? raw : null}
          onSave={(v) => onSave(v)}
        />
      );
    case "status":
      return (
        <StatusCell
          column={column}
          value={typeof raw === "string" ? raw : null}
          onSave={(v) => onSave(v)}
        />
      );
    case "person":
      return (
        <PersonCell
          column={column}
          value={typeof raw === "number" ? raw : null}
          users={users}
          onSave={(v) => onSave(v)}
        />
      );
    default:
      return (
        <div className={styles.drawerValue}>
          {raw == null
            ? "—"
            : typeof raw === "string" || typeof raw === "number"
              ? String(raw)
              : JSON.stringify(raw)}
        </div>
      );
  }
}
