"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { apiUrl } from "../lib/api";
import styles from "../app/intranet-hub.module.css";

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function FileManagerHubCard() {
  const { authHeaders, token } = useAuth();
  const [fileCount, setFileCount] = useState<number | null>(null);
  const [totalBytes, setTotalBytes] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl("/files/stats"), {
        cache: "no-store",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setFileCount(typeof body.fileCount === "number" ? body.fileCount : null);
        setTotalBytes(typeof body.totalBytes === "number" ? body.totalBytes : null);
      }
    } catch {
      setFileCount(null);
      setTotalBytes(null);
    }
  }, [authHeaders, token]);

  useEffect(() => {
    load();
  }, [load]);

  const suffix =
    fileCount != null && totalBytes != null
      ? ` · ${fileCount} ${fileCount === 1 ? "file" : "files"} · ${fmtBytes(totalBytes)} stored`
      : "";

  return (
    <Link href="/files" className={`${styles.toolCard} ${styles.toolCardLive}`}>
      <div className={styles.toolCardHeader}>
        <h3 className={styles.toolCardTitle}>
          <span aria-hidden style={{ marginRight: "0.35rem" }}>
            📁
          </span>
          File Manager
        </h3>
        <span className={`${styles.badge} ${styles.badgeLive}`}>Live</span>
      </div>
      <p className={styles.toolCardDesc}>
        Company document storage organized by property, owner, and department
        {suffix}
      </p>
    </Link>
  );
}
