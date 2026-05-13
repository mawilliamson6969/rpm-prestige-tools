"use client";

import styles from "../renewals.module.css";
import type { BoardColumn } from "@/types/mb";
import { statusOptionsFor } from "./types";

export default function BoardToolbar({
  columns,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  totalCount,
  visibleCount,
  onClearFilters,
}: {
  columns: BoardColumn[];
  search: string;
  onSearchChange: (v: string) => void;
  statusFilter: string;
  onStatusFilterChange: (v: string) => void;
  totalCount: number;
  visibleCount: number;
  onClearFilters: () => void;
}) {
  const statusCol = columns.find((c) => c.key === "status");
  const statusOptions = statusCol ? statusOptionsFor(statusCol) : [];

  const dirty = search.trim() !== "" || statusFilter !== "all";

  return (
    <div className={styles.toolbar}>
      <input
        type="search"
        className={styles.searchInput}
        placeholder="Search tenant or property…"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
      />
      <span className={styles.toolbarLabel}>Status</span>
      <select
        className={styles.select}
        value={statusFilter}
        onChange={(e) => onStatusFilterChange(e.target.value)}
      >
        <option value="all">All</option>
        {statusOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {dirty ? (
        <button
          type="button"
          className={styles.btnGhost}
          onClick={onClearFilters}
        >
          Clear filters
        </button>
      ) : null}

      <div className={styles.toolbarRight}>
        <span className={styles.toolbarLabel}>
          {visibleCount === totalCount
            ? `${totalCount} renewal${totalCount === 1 ? "" : "s"}`
            : `${visibleCount} of ${totalCount} renewals`}
        </span>
      </div>
    </div>
  );
}
