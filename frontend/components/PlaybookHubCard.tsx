"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { apiUrl } from "../lib/api";
import styles from "../app/intranet-hub.module.css";

export default function PlaybookHubCard() {
  const { authHeaders, token } = useAuth();
  const [total, setTotal] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl("/playbooks/categories"), {
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
    <Link href="/playbooks" className={`${styles.toolCard} ${styles.toolCardLive}`}>
      <div className={styles.toolCardHeader}>
        <h3 className={styles.toolCardTitle}>Playbooks &amp; SOPs</h3>
        <span className={`${styles.badge} ${styles.badgeLive}`}>Live</span>
      </div>
      <p className={styles.toolCardDesc}>
        Step-by-step PM process documentation for leasing, maintenance, move-ins, and more
        {total != null ? ` · ${total} ${total === 1 ? "playbook" : "playbooks"}` : ""}
      </p>
    </Link>
  );
}
