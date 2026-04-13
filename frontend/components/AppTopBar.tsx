"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { buildBreadcrumbs } from "../lib/breadcrumbs";
import { useAuth } from "../context/AuthContext";
import { apiUrl } from "../lib/api";
import { useNarrowScreen } from "../hooks/useNarrowScreen";
import styles from "./app-top-bar.module.css";

type SyncLatest = {
  completed_at?: string | null;
  started_at?: string | null;
  status?: string;
};

function BreadcrumbTrail() {
  const pathname = usePathname() || "/";
  const searchParams = useSearchParams();
  const crumbs = useMemo(() => buildBreadcrumbs(pathname, searchParams), [pathname, searchParams]);

  return (
    <nav className={styles.crumbs} aria-label="Breadcrumb">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={`${c.label}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
            {i > 0 ? (
              <span className={styles.sep} aria-hidden>
                /
              </span>
            ) : null}
            {last || !c.href ? (
              <span className={last ? styles.crumbCurrent : undefined}>{c.label}</span>
            ) : (
              <Link href={c.href} className={styles.crumbLink}>
                {c.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

export default function AppTopBar({ onMenuClick }: { onMenuClick: () => void }) {
  const narrow = useNarrowScreen();
  const { authHeaders, token } = useAuth();
  const [now, setNow] = useState(() => new Date());
  const [syncLatest, setSyncLatest] = useState<SyncLatest | null>(null);
  const [syncInProgress, setSyncInProgress] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const loadSyncStatus = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl("/sync/status"), {
        cache: "no-store",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return;
      setSyncLatest(body.latest ?? null);
      setSyncInProgress(!!body.syncInProgress);
    } catch {
      /* ignore */
    }
  }, [authHeaders, token]);

  useEffect(() => {
    loadSyncStatus();
    const id = setInterval(loadSyncStatus, 60_000);
    return () => clearInterval(id);
  }, [loadSyncStatus]);

  const lastSyncedText = useMemo(() => {
    const t = syncLatest?.completed_at ?? syncLatest?.started_at;
    if (!t) return "Not synced yet";
    try {
      return new Date(t).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
    } catch {
      return String(t);
    }
  }, [syncLatest]);

  const clockStr = now.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <header className={styles.bar}>
      <div className={styles.left}>
        {narrow ? (
          <button type="button" className={styles.menuBtn} aria-label="Open navigation menu" onClick={onMenuClick}>
            ☰
          </button>
        ) : null}
        <Suspense
          fallback={
            <div className={styles.crumbs} style={{ opacity: 0.5 }}>
              …
            </div>
          }
        >
          <BreadcrumbTrail />
        </Suspense>
      </div>
      <div className={styles.right}>
        <div className={styles.clock}>
          <span className={styles.clockLabel}>Houston (CT)</span>
          <span>{clockStr}</span>
        </div>
        <div className={styles.sync}>
          Last synced: <strong>{lastSyncedText}</strong>
          {syncInProgress ? " · sync running…" : ""}
        </div>
      </div>
    </header>
  );
}
