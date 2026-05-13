"use client";

import styles from "../../app/(protected)/inbox/inbox.module.css";
import type { ListSort } from "../../hooks/inbox/types";

type Props = {
  search: string;
  setSearch: (s: string) => void;
  sort: ListSort;
  setSort: (s: ListSort) => void;
};

export default function FilterBar({ search, setSearch, sort, setSort }: Props) {
  return (
    <div className={styles.listToolbar}>
      <input
        className={styles.search}
        placeholder="Search tickets…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search tickets"
      />
      <select
        className={styles.sortSel}
        value={sort}
        onChange={(e) => setSort(e.target.value as ListSort)}
        aria-label="Sort"
      >
        <option value="newest">Newest</option>
        <option value="oldest">Oldest</option>
        <option value="priority">Highest priority</option>
        <option value="updated">Recently updated</option>
      </select>
    </div>
  );
}
