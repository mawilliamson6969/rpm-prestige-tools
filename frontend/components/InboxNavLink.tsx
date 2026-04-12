"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { apiUrl } from "../lib/api";
import styles from "./InboxNavLink.module.css";

export default function InboxNavLink() {
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
      if (res.ok && typeof body.unread === "number") {
        setUnread(body.unread);
      }
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
    <Link href="/inbox" className={styles.link}>
      Inbox
      {unread != null && unread > 0 ? (
        <span className={styles.badge} aria-label={`${unread} unread`}>
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
