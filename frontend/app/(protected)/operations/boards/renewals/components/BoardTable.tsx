"use client";

import styles from "../renewals.module.css";
import type { BoardColumn, BoardProgressEntry, Item } from "@/types/mb";
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
import MentionBadge from "../../components/MentionBadge";
import AggregatedStatusBadge from "../../components/AggregatedStatusBadge";
import ProgressBar from "../../components/ProgressBar";

interface BoardTableProps {
  columns: BoardColumn[];
  items: Item[];
  users: TeamUser[];
  sortColumnKey: string | null;
  sortDir: SortDir;
  onSort: (columnKey: string) => void;
  onOpenItem: (id: number) => void;
  onSaveValue: (itemId: number, columnKey: string, next: unknown) => Promise<void>;
  /** Phase 4: map of item id -> unseen @mention count, rendered as a badge next to the title. */
  mentionCountByItem?: Record<number, number>;
  /** Phase 6: when true, render an extra "Progress" column after the regular columns. */
  showProgressColumn?: boolean;
  /** Phase 6: per-item progress entry map. */
  progressByItem?: Record<number, BoardProgressEntry>;
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
  mentionCountByItem,
  showProgressColumn,
  progressByItem,
}: BoardTableProps) {
  if (items.length === 0) return null;

  return (
    <table className={styles.table}>
      <colgroup>
        <col style={{ width: 32 }} />
        {columns.map((c) => (
          <col key={c.id} style={{ width: c.width || 150 }} />
        ))}
        {showProgressColumn ? <col style={{ width: 140 }} /> : null}
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
          {showProgressColumn ? <th>Progress</th> : null}
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
                  mentionCount={mentionCountByItem?.[item.id] ?? 0}
                />
              </td>
            ))}
            {showProgressColumn ? (
              <td>
                <ProgressBar entry={progressByItem?.[item.id]} />
              </td>
            ) : null}
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
  mentionCount,
}: {
  column: BoardColumn;
  item: Item;
  users: TeamUser[];
  onOpenItem: (id: number) => void;
  onSave: (next: unknown) => Promise<void>;
  mentionCount: number;
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
        <MentionBadge count={mentionCount} />
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
      // Phase 6: if this item has an aggregated_status set, render a
      // read-only "Auto" badge instead of the editable status cell.
      if (typeof item.aggregated_status === "string" && item.aggregated_status) {
        return (
          <AggregatedStatusBadge
            column={column}
            value={typeof raw === "string" ? raw : null}
          />
        );
      }
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
