"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import EosNavDropdown from "../../../components/EosNavDropdown";
import AgentsNavLink from "../../../components/AgentsNavLink";
import InboxNavLink from "../../../components/InboxNavLink";
import UserMenu from "../../../components/UserMenu";
import { useAuth } from "../../../context/AuthContext";
import { apiUrl } from "../../../lib/api";
import styles from "./dashboard.module.css";
import { getDateRange, PRESET_OPTIONS, type DatePresetId } from "./dateRange";
import ExecutivePanel from "./ExecutivePanel";
import FinancePanel from "./FinancePanel";
import LeasingPanel from "./LeasingPanel";
import MaintenancePanel from "./MaintenancePanel";
import PortfolioPanel from "./PortfolioPanel";
import CrmPanel from "./CrmPanel";

type TabId = "executive" | "leasing" | "maintenance" | "finance" | "portfolio" | "crm";

function buildQuery(params: {
  propertyIds: string[];
  startDate: string;
  endDate: string;
}) {
  const q = new URLSearchParams();
  if (params.propertyIds.length) q.set("propertyIds", params.propertyIds.join(","));
  q.set("startDate", params.startDate);
  q.set("endDate", params.endDate);
  const s = q.toString();
  return s ? `?${s}` : "";
}

type SyncLatest = {
  completed_at?: string | null;
  started_at?: string | null;
  status?: string;
};

export default function DashboardClient() {
  const { authHeaders, isAdmin } = useAuth();
  const [tab, setTab] = useState<TabId>("executive");
  const [preset, setPreset] = useState<DatePresetId>("ytd");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>([]);

  const [syncLatest, setSyncLatest] = useState<SyncLatest | null>(null);
  const [syncInProgress, setSyncInProgress] = useState(false);
  const [adminBusy, setAdminBusy] = useState(false);

  const [executive, setExecutive] = useState<Record<string, unknown> | null>(null);
  const [finance, setFinance] = useState<Record<string, unknown> | null>(null);
  const [leasing, setLeasing] = useState<Record<string, unknown> | null>(null);
  const [maintenance, setMaintenance] = useState<Record<string, unknown> | null>(null);
  const [portfolio, setPortfolio] = useState<Record<string, unknown> | null>(null);
  const [crm, setCrm] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(
    () => getDateRange(preset, customStart || undefined, customEnd || undefined),
    [preset, customStart, customEnd]
  );

  const propertyOptions = useMemo(() => {
    const p = portfolio as {
      propertyDirectory?: Record<string, unknown>[];
      properties?: { propertyName: string }[];
    } | null;
    if (!p) return [] as { id: string; label: string }[];
    const out: { id: string; label: string }[] = [];
    const seen = new Set<string>();
    for (const row of p.propertyDirectory ?? []) {
      const id = String(
        row.property_id ?? row.PropertyId ?? row.propertyId ?? row.id ?? ""
      ).trim();
      const label = String(
        row.property_name ?? row.PropertyName ?? row.name ?? row.Name ?? id ?? "Property"
      ).trim();
      const key = id || label;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ id: id || label, label: label || id });
    }
    for (const row of p.properties ?? []) {
      const key = row.propertyName;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ id: key, label: key });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }, [portfolio]);

  const loadSyncStatus = useCallback(async () => {
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
  }, [authHeaders]);

  const loadExecutiveData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const q = buildQuery({
      propertyIds: selectedPropertyIds,
      startDate: range.start,
      endDate: range.end,
    });
    const h = authHeaders();
    try {
      const [rEx, rFi, rLe, rMa, rPo, rCr] = await Promise.all([
        fetch(apiUrl(`/dashboard/executive${q}`), { cache: "no-store", headers: { ...h } }),
        fetch(apiUrl(`/dashboard/finance${q}`), { cache: "no-store", headers: { ...h } }),
        fetch(apiUrl(`/dashboard/leasing${q}`), { cache: "no-store", headers: { ...h } }),
        fetch(apiUrl(`/dashboard/maintenance${q}`), { cache: "no-store", headers: { ...h } }),
        fetch(apiUrl(`/dashboard/portfolio${q}`), { cache: "no-store", headers: { ...h } }),
        fetch(apiUrl(`/dashboard/crm${q}`), { cache: "no-store", headers: { ...h } }),
      ]);
      const [jEx, jFi, jLe, jMa, jPo, jCr] = await Promise.all([
        rEx.json().catch(() => ({})),
        rFi.json().catch(() => ({})),
        rLe.json().catch(() => ({})),
        rMa.json().catch(() => ({})),
        rPo.json().catch(() => ({})),
        rCr.json().catch(() => ({})),
      ]);
      if (!rEx.ok) throw new Error(typeof jEx.error === "string" ? jEx.error : `Executive ${rEx.status}`);
      if (!rFi.ok) throw new Error(typeof jFi.error === "string" ? jFi.error : `Finance ${rFi.status}`);
      if (!rLe.ok) throw new Error(typeof jLe.error === "string" ? jLe.error : `Leasing ${rLe.status}`);
      if (!rMa.ok) throw new Error(typeof jMa.error === "string" ? jMa.error : `Maintenance ${rMa.status}`);
      if (!rPo.ok) throw new Error(typeof jPo.error === "string" ? jPo.error : `Portfolio ${rPo.status}`);
      setExecutive(jEx);
      setFinance(jFi);
      setLeasing(jLe);
      setMaintenance(jMa);
      setPortfolio(jPo);
      if (rCr.ok) {
        setCrm(jCr);
      } else {
        setCrm(null);
        console.warn("CRM dashboard:", typeof jCr.error === "string" ? jCr.error : rCr.status);
      }
    } catch (e) {
      setExecutive(null);
      setFinance(null);
      setLeasing(null);
      setMaintenance(null);
      setPortfolio(null);
      setCrm(null);
      setError(e instanceof Error ? e.message : "Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  }, [range.start, range.end, range.label, selectedPropertyIds, authHeaders]);

  useEffect(() => {
    loadSyncStatus();
    const id = setInterval(loadSyncStatus, 60_000);
    return () => clearInterval(id);
  }, [loadSyncStatus]);

  useEffect(() => {
    loadExecutiveData();
  }, [loadExecutiveData]);

  const tabTitle = useMemo(() => {
    const m: Record<TabId, string> = {
      executive: "Executive",
      leasing: "Leasing",
      maintenance: "Maintenance",
      finance: "Finance",
      portfolio: "Portfolio",
      crm: "CRM",
    };
    return m[tab];
  }, [tab]);

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

  const onRefreshCache = async () => {
    if (typeof window === "undefined" || !isAdmin) return;
    setAdminBusy(true);
    try {
      const res = await fetch(apiUrl("/sync/run"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: "{}",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : `HTTP ${res.status}`);
      }
      await loadSyncStatus();
      await loadExecutiveData();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Sync request failed.");
    } finally {
      setAdminBusy(false);
    }
  };

  const toggleProperty = (id: string) => {
    setSelectedPropertyIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const clearFilters = () => {
    setPreset("ytd");
    setCustomStart("");
    setCustomEnd("");
    setSelectedPropertyIds([]);
  };

  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  chips.push({
    key: "dates",
    label: `${range.label}: ${range.start} → ${range.end}`,
    onRemove: () => {
      setPreset("ytd");
      setCustomStart("");
      setCustomEnd("");
    },
  });
  for (const id of selectedPropertyIds) {
    const opt = propertyOptions.find((o) => o.id === id);
    chips.push({
      key: `p-${id}`,
      label: opt?.label ?? id,
      onRemove: () => setSelectedPropertyIds((p) => p.filter((x) => x !== id)),
    });
  }

  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <div className={styles.titleBlock}>
          <Link href="/" className={styles.backLink}>
            ← Team Hub
          </Link>
          <EosNavDropdown variant="light" />
          <h1>RPM Prestige — {tabTitle} Dashboard</h1>
        </div>
        <div className={styles.topBarRight}>
          <div className={styles.syncMeta}>
            <div>
              Last synced: <strong>{lastSyncedText}</strong>
              {syncInProgress ? " (sync running…)" : ""}
            </div>
            <div className={styles.muted}>Cached AppFolio data · Houston (CT)</div>
            {isAdmin ? (
              <button
                type="button"
                className={styles.refreshBtn}
                onClick={onRefreshCache}
                disabled={adminBusy}
              >
                {adminBusy ? "Starting…" : "Refresh Data"}
              </button>
            ) : null}
          </div>
          <Link href="/wiki" className={styles.headerWikiLink}>
            Wiki
          </Link>
          <Link href="/files" className={styles.headerWikiLink}>
            Files
          </Link>
          <AgentsNavLink />
          <InboxNavLink />
          <UserMenu />
        </div>
      </header>

      <nav className={styles.tabs} aria-label="Dashboard sections">
        {(
          [
            ["executive", "Executive"],
            ["leasing", "Leasing"],
            ["maintenance", "Maintenance"],
            ["finance", "Finance"],
            ["portfolio", "Portfolio"],
            ["crm", "CRM"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`${styles.tab} ${tab === id ? styles.tabActive : ""}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className={styles.filterBar}>
        <div className={styles.filterGroup}>
          <label htmlFor="preset">Date range</label>
          <select
            id="preset"
            className={styles.select}
            value={preset}
            onChange={(e) => setPreset(e.target.value as DatePresetId)}
          >
            {PRESET_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {preset === "custom" && (
          <>
            <div className={styles.filterGroup}>
              <label htmlFor="cstart">Start</label>
              <input
                id="cstart"
                type="date"
                className={styles.dateInput}
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
              />
            </div>
            <div className={styles.filterGroup}>
              <label htmlFor="cend">End</label>
              <input
                id="cend"
                type="date"
                className={styles.dateInput}
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
              />
            </div>
          </>
        )}
        <div className={styles.filterGroup}>
          <label htmlFor="props">Properties</label>
          <select
            id="props"
            multiple
            className={`${styles.select} ${styles.propertySelect}`}
            value={selectedPropertyIds}
            onChange={(e) => {
              const opts = Array.from(e.target.selectedOptions).map((o) => o.value);
              setSelectedPropertyIds(opts);
            }}
            aria-label="Filter by properties"
          >
            {propertyOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className={styles.clearBtn} onClick={clearFilters}>
          Clear Filters
        </button>
      </div>

      <div className={styles.chips}>
        {chips.map((c) => (
          <span key={c.key} className={styles.chip}>
            {c.label}
            <button type="button" aria-label="Remove filter" onClick={c.onRemove}>
              ×
            </button>
          </span>
        ))}
      </div>

      <main className={styles.main}>
        {tab === "leasing" && (
          <div className={styles.tabPanel}>
            <LeasingPanel leasing={leasing as never} loading={loading} error={error} />
          </div>
        )}
        {tab === "executive" && (
          <div className={styles.tabPanel}>
            <ExecutivePanel
              executive={executive as never}
              finance={finance as never}
              maintenance={maintenance as never}
              portfolio={portfolio as never}
              loading={loading}
              error={error}
              dateLabel={range.label}
              rangeStart={range.start}
              rangeEnd={range.end}
            />
          </div>
        )}
        {tab === "maintenance" && (
          <div className={styles.tabPanel}>
            <MaintenancePanel
              maintenance={maintenance as never}
              executive={executive as never}
              loading={loading}
              error={error}
            />
          </div>
        )}
        {tab === "finance" && (
          <div className={styles.tabPanel}>
            <FinancePanel finance={finance as never} loading={loading} error={error} />
          </div>
        )}
        {tab === "portfolio" && (
          <div className={styles.tabPanel}>
            <PortfolioPanel portfolio={portfolio as never} loading={loading} error={error} />
          </div>
        )}
        {tab === "crm" && (
          <div className={styles.tabPanel}>
            <CrmPanel crm={crm as never} loading={loading} error={error} />
          </div>
        )}
      </main>
    </div>
  );
}
