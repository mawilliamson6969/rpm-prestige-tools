"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { apiUrl } from "../lib/api";
import styles from "../app/intranet-hub.module.css";

type Summary = {
  active?: number;
  actionsToday?: number;
  queuedForReview?: number;
};

export default function AgentsHubCard() {
  const { token, authHeaders } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl("/agents/metrics/summary"), {
        cache: "no-store",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setSummary(body);
    } catch {
      setSummary(null);
    }
  }, [token, authHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  const active = summary?.active ?? 0;
  const actions = summary?.actionsToday ?? 0;
  const queued = summary?.queuedForReview ?? 0;

  const desc =
    summary == null
      ? "Manage automated leasing, maintenance, accounting, and reporting agents."
      : `${active} agent${active === 1 ? "" : "s"} active · ${actions} actions today · ${queued} queued for review`;

  return (
    <Link href="/agents" className={`${styles.toolCard} ${styles.toolCardLive}`}>
      <div className={styles.toolCardHeader}>
        <h3 className={styles.toolCardTitle}>AI Agents</h3>
        <span className={`${styles.badge} ${styles.badgeLive}`}>Live</span>
      </div>
      <p className={styles.toolCardDesc} style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
        <span aria-hidden style={{ fontSize: "1.35rem" }}>
          🤖
        </span>
        <span>{desc}</span>
      </p>
    </Link>
  );
}
