"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { apiUrl } from "../lib/api";
import styles from "../app/intranet-hub.module.css";

export default function WikiHubCard() {
  const { authHeaders, token } = useAuth();
  const [total, setTotal] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl("/wiki/categories"), {
        cache: "no-store",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && typeof body.totalPages === "number") setTotal(body.totalPages);
    } catch {
      setTotal(null);
    }
  }, [authHeaders, token]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Link href="/wiki" className={`${styles.toolCard} ${styles.toolCardLive}`}>
      <div className={styles.toolCardHeader}>
        <h3 className={styles.toolCardTitle}>
          <span aria-hidden style={{ marginRight: "0.35rem" }}>
            📚
          </span>
          Company Wiki
        </h3>
        <span className={`${styles.badge} ${styles.badgeLive}`}>Live</span>
      </div>
      <p className={styles.toolCardDesc}>
        SOPs, playbooks, and company documentation organized by department
        {total != null ? ` · ${total} ${total === 1 ? "page" : "pages"}` : ""}
      </p>
    </Link>
  );
}
