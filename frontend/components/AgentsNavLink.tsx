"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { apiUrl } from "../lib/api";
import styles from "./AgentsNavLink.module.css";

export default function AgentsNavLink() {
  const { token, authHeaders } = useAuth();
  const [queued, setQueued] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl("/agents/metrics/summary"), {
        cache: "no-store",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && typeof body.queuedForReview === "number") {
        setQueued(body.queuedForReview);
      }
    } catch {
      setQueued(null);
    }
  }, [token, authHeaders]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const q = queued ?? 0;

  return (
    <div className={styles.wrap}>
      <Link href="/agents" className={styles.link}>
        Agents
        {queued != null && q > 0 ? (
          <span className={`${styles.badge} ${styles.badgeUrgent}`} aria-label={`${q} queued for review`}>
            {q > 99 ? "99+" : q}
          </span>
        ) : null}
      </Link>
      {q > 0 ? (
        <Link href="/agents/queue" className={styles.bell} aria-label="Open agent review queue" title="Queued reviews">
          🔔
        </Link>
      ) : null}
    </div>
  );
}
