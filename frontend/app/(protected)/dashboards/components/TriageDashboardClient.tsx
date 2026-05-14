"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./dashboards.module.css";
import { apiUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import type { TriageItem, TriageReason, TriageResponse } from "@/types/mb";

const POLL_MS = 60_000;

export default function TriageDashboardClient({
  scope = "all",
  boardSlug,
}: {
  scope?: "all" | "board";
  boardSlug?: string;
}) {
  const { authHeaders, token } = useAuth();
  const [data, setData] = useState<TriageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const scopeParam = scope === "board" && boardSlug ? `board:${boardSlug}` : "all";

  const load = useCallback(async () => {
    if (!token) return;
    setErr(null);
    try {
      const res = await fetch(
        apiUrl(`/mb/dashboards/triage?scope=${encodeURIComponent(scopeParam)}&limit=100`),
        { headers: { ...authHeaders() }, cache: "no-store" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Triage fetch failed (${res.status}).`);
      }
      const body: TriageResponse = await res.json();
      setData(body);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load triage.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, scopeParam, token]);

  useEffect(() => {
    load();
    intervalRef.current = setInterval(load, POLL_MS);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  return (
    <div className={styles.main}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>🔥 Triage</h1>
          <p className={styles.subtitle}>
            {scope === "board"
              ? "Items on this board that need attention right now."
              : "Items across all boards that need attention right now."}
          </p>
        </div>
        <div className={styles.scopePill}>
          {data ? (
            <span>
              {data.items.length} of {data.total_qualified} qualified
            </span>
          ) : null}
          {loading ? <span>· refreshing…</span> : null}
        </div>
      </div>

      {err ? <div className={styles.errBanner}>{err}</div> : null}

      {loading && !data ? (
        <div className={styles.emptyState}>Loading…</div>
      ) : data && data.items.length === 0 ? (
        <div className={styles.emptyState}>Nothing on fire. 🎉</div>
      ) : data ? (
        <>
          <div className={styles.cardList}>
            {data.items.map((it) => (
              <TriageCard key={it.id} item={it} />
            ))}
          </div>
          {data.overflow > 0 ? (
            <div className={styles.overflowNote}>
              {data.overflow} more items meet triage criteria — refine board-level filters.
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function TriageCard({ item }: { item: TriageItem }) {
  const status = typeof item.values?.status === "string" ? item.values.status : null;
  const statusLabel = item.reasons.find((r) => r.kind === "negative_status")?.label;
  const tenant =
    typeof item.values?.tenant_name === "string" ? item.values.tenant_name : null;
  const property =
    typeof item.values?.property === "string" ? item.values.property : null;

  const scoreClass =
    item.capped_score > 70
      ? ""
      : item.capped_score >= 40
        ? styles.scoreBadgeMid
        : styles.scoreBadgeLow;

  return (
    <Link
      href={`/operations/boards/${item.board_slug}/items/${item.id}`}
      className={styles.card}
    >
      <span className={`${styles.scoreBadge} ${scoreClass}`}>
        {item.capped_score}
      </span>
      <div className={styles.cardMain}>
        <div className={styles.cardHeadRow}>
          <span className={styles.cardBoardLabel}>{item.board_name}</span>
          {status ? (
            <>
              <span>·</span>
              <span>{statusLabel || status}</span>
            </>
          ) : null}
          {tenant ? (
            <>
              <span>·</span>
              <span>{tenant}</span>
            </>
          ) : null}
        </div>
        <h3 className={styles.cardTitle}>{property || item.title}</h3>
        <div className={styles.cardReasons}>
          {item.reasons.slice(0, 4).map((r, i) => (
            <ReasonChip key={i} reason={r} />
          ))}
          {item.reasons.length > 4 ? (
            <span className={styles.reasonChip}>
              +{item.reasons.length - 4} more
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

function ReasonChip({ reason }: { reason: TriageReason }) {
  let cls = styles.reasonChip;
  if (reason.kind === "negative_status" || reason.kind === "past_due") {
    cls = `${styles.reasonChip} ${styles.reasonChipUrgent}`;
  } else if (reason.kind === "due_soon" || reason.kind === "low_renewal_score") {
    cls = `${styles.reasonChip} ${styles.reasonChipWarn}`;
  } else if (reason.kind === "mention") {
    cls = `${styles.reasonChip} ${styles.reasonChipMention}`;
  }
  return <span className={cls}>{reason.label}</span>;
}
