"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { apiUrl } from "../lib/api";
import styles from "../app/intranet-hub.module.css";

export default function VideoMessagesHubCard() {
  const { token, authHeaders } = useAuth();
  const [recentCount, setRecentCount] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const res = await fetch(apiUrl(`/videos?limit=100&offset=0&sort=newest`), {
        cache: "no-store",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(body.videos)) {
        const count = body.videos.filter(
          (row: { createdAt?: string }) => row.createdAt && new Date(row.createdAt).toISOString() >= weekAgo
        ).length;
        setRecentCount(count);
      }
    } catch {
      setRecentCount(null);
    }
  }, [authHeaders, token]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <Link href="/videos" className={`${styles.toolCard} ${styles.toolCardLive}`}>
      <div className={styles.toolCardHeader}>
        <h3 className={styles.toolCardTitle}>Video Messages</h3>
        <span className={`${styles.badge} ${styles.badgeLive}`}>Live</span>
      </div>
      <p className={styles.toolCardDesc}>Record and share screen recordings with auto-transcription</p>
      {recentCount != null ? (
        <p className={styles.kpiHint} style={{ marginTop: "0.35rem", marginBottom: 0 }}>
          {recentCount} recent videos
        </p>
      ) : null}
    </Link>
  );
}
