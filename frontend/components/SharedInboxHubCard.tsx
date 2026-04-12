"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { apiUrl } from "../lib/api";
import styles from "../app/intranet-hub.module.css";

export default function SharedInboxHubCard() {
  const { token, authHeaders } = useAuth();
  const [unread, setUnread] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl("/inbox/stats"), {
        cache: "no-store",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && typeof body.unread === "number") setUnread(body.unread);
    } catch {
      setUnread(null);
    }
  }, [token, authHeaders]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <Link href="/inbox" className={`${styles.toolCard} ${styles.toolCardLive}`}>
      <div className={styles.toolCardHeader}>
        <h3 className={styles.toolCardTitle}>Shared Inbox</h3>
        <span className={`${styles.badge} ${styles.badgeLive}`}>Live</span>
        {unread != null && unread > 0 ? (
          <span
            className={styles.badge}
            style={{ background: "#b32317", color: "#fff", marginLeft: "0.35rem" }}
            aria-label={`${unread} unread`}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </div>
      <p className={styles.toolCardDesc}>
        Unified team inbox with AI-powered classification and priority scoring
      </p>
    </Link>
  );
}
