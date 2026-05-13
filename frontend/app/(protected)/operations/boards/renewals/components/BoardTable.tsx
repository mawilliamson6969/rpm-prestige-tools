"use client";

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
import type { SortDir, TeamUser } from "./types";

interface BoardTableProps {
  columns: BoardColumn[];
  items: Item[];
  users: TeamUser[];
  sortColumnKey: string | null;
  sortDir: SortDir;
  onSort: (columnKey: string) => void;
  onOpenItem: (id: number) => void;
  onSaveValue: (itemId: number, columnKey: string, next: unknown) => Promise<void>;
}

export default function BoardTable({
  columns,
  items,
  users,
  sortColumnKey,
  sortDir,
  onSort,
  onOpenItem,
  onSaveValue,
}: BoardTableProps) {
  if (items.length === 0) return null;

  return (
    <table className={styles.table}>
      <colgroup>
        <col style={{ width: 32 }} />
        {columns.map((c) => (
          <col key={c.id} style={{ width: c.width || 150 }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          <th aria-label="row indicator" />
          {columns.map((c) => {
            const active = sortColumnKey === c.key;
            return (
              <th
                key={c.id}
                className={styles.thSortable}
                onClick={() => onSort(c.key)}
                title={`Sort by ${c.name}`}
              >
                {c.name}
                {active ? (
                  <span className={styles.thSortArrow}>
                    {sortDir === "asc" ? "▲" : "▼"}
                  </span>
                ) : null}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id} className={styles.row}>
            <td aria-hidden="true" />
            {columns.map((c) => (
              <td key={c.id}>
                <CellDispatcher
                  column={c}
                  item={item}
                  users={users}
                  onOpenItem={onOpenItem}
                  onSave={(next) => onSaveValue(item.id, c.key, next)}
                />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CellDispatcher({
  column,
  item,
  users,
  onOpenItem,
  onSave,
}: {
  column: BoardColumn;
  item: Item;
  users: TeamUser[];
  onOpenItem: (id: number) => void;
  onSave: (next: unknown) => Promise<void>;
}) {
  const raw = item.values?.[column.key];
  const isTenantName = column.key === "tenant_name";

  if (isTenantName) {
    const label =
      (typeof raw === "string" && raw) || item.title || `Item #${item.id}`;
    return (
      <div className={`${styles.cell} ${styles.titleCell}`}>
        <button
          type="button"
          className={styles.titleLink}
          onClick={() => onOpenItem(item.id)}
        >
          {label}
        </button>
      </div>
    );
  }

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
        <div className={styles.cell}>
          {raw == null
            ? null
            : typeof raw === "string" || typeof raw === "number"
              ? String(raw)
              : JSON.stringify(raw)}
        </div>
      );
  }
}
