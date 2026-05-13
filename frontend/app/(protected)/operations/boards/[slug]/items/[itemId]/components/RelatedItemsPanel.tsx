"use client";

import Link from "next/link";
import styles from "./detail.module.css";
import type { RelatedItemRef } from "@/types/mb";

export default function RelatedItemsPanel({ items }: { items: RelatedItemRef[] }) {
  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>Related items</h3>
      {items.length === 0 ? (
        <div className={styles.notLinked}>
          No related items found (same tenant or property).
        </div>
      ) : (
        items.map((it) => (
          <Link
            key={it.id}
            href={`/operations/boards/${it.board_slug}/items/${it.id}`}
            className={styles.relatedItem}
          >
            <div className={styles.relatedHead}>
              <span>{it.board_name}</span>
              {it.status ? <span>· {it.status}</span> : null}
            </div>
            <p className={styles.relatedTitle}>{it.title}</p>
          </Link>
        ))
      )}
    </div>
  );
}
