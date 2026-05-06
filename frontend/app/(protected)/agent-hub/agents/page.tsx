"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../../context/AuthContext";
import { apiUrl } from "../../../../lib/api";
import {
  agentHubFetch,
  agentListQuery,
  relativeTime,
  type Agent,
  type Brokerage,
  type HubPermissions,
  type Tier,
} from "../../../../lib/agentHub";
import AgentHubGate from "../AgentHubGate";
import { Avatar, StatusPill, TierBadge, Toast } from "../components";
import styles from "../agentHub.module.css";

type Filters = {
  tier: string;
  status: string;
  brokerage_id: string;
  niche: string;
  target_zip: string;
  tag: string;
  search: string;
  sort: string;
};

const DEFAULTS: Filters = {
  tier: "",
  status: "",
  brokerage_id: "",
  niche: "",
  target_zip: "",
  tag: "",
  search: "",
  sort: "last_interaction",
};

function ListInner({ perms }: { perms: HubPermissions }) {
  const { token, authHeaders } = useAuth();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage] = useState(50);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(() => {
    if (typeof window === "undefined") return DEFAULTS;
    const sp = new URLSearchParams(window.location.search);
    return {
      tier: sp.get("tier") || "",
      status: sp.get("status") || "",
      brokerage_id: sp.get("brokerage_id") || "",
      niche: sp.get("niche") || "",
      target_zip: sp.get("target_zip") || "",
      tag: sp.get("tag") || "",
      search: sp.get("search") || "",
      sort: sp.get("sort") || "last_interaction",
    };
  });
  const [brokerages, setBrokerages] = useState<Brokerage[]>([]);
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [toast, setToast] = useState<{ msg: string; variant: "ok" | "error" } | null>(null);

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Load filter options once
  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const [b, t] = await Promise.all([
          agentHubFetch<{ brokerages: Brokerage[] }>("/agent-hub/brokerages", { authHeaders: authHeaders() }),
          agentHubFetch<{ tags: { tag: string; count: number }[] }>("/agent-hub/tags", { authHeaders: authHeaders() }),
        ]);
        setBrokerages(b.brokerages);
        setTags(t.tags);
      } catch {
        // Non-fatal — filter dropdowns are optional.
      }
    })();
  }, [token, authHeaders]);

  // Load agents whenever filters/page change
  useEffect(() => {
    if (!token) return;
    let cancel = false;
    setLoading(true);
    (async () => {
      try {
        const qs = agentListQuery({ ...filters, page, per_page: perPage });
        const body = await agentHubFetch<{ agents: Agent[]; total: number }>(`/agent-hub/agents${qs}`, {
          authHeaders: authHeaders(),
        });
        if (cancel) return;
        setAgents(body.agents);
        setTotal(body.total);
        setErr(null);
      } catch (e) {
        if (cancel) return;
        setErr(e instanceof Error ? e.message : "Could not load agents.");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [token, authHeaders, filters, page, perPage]);

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = agents.length > 0 && agents.every((a) => selected.has(a.id));
  const toggleSelectAll = () => {
    if (allSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        agents.forEach((a) => next.delete(a.id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        agents.forEach((a) => next.add(a.id));
        return next;
      });
    }
  };

  const isManager = perms.role === "owner" || perms.role === "manager";

  async function bulkTier(tier: Tier) {
    if (!selected.size) return;
    if (!confirm(`Set tier "${tier}" on ${selected.size} agent(s)?`)) return;
    setBulkBusy(true);
    try {
      const body = await agentHubFetch<{ updated: number }>(`/agent-hub/agents/bulk-tier`, {
        method: "POST",
        authHeaders: authHeaders(),
        body: JSON.stringify({ agent_ids: Array.from(selected), tier }),
      });
      setToast({ msg: `Updated ${body.updated} agent(s).`, variant: "ok" });
      setSelected(new Set());
      // Reload
      setFilters((f) => ({ ...f }));
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Bulk update failed.", variant: "error" });
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkTag(tag: string) {
    if (!selected.size || !tag.trim()) return;
    setBulkBusy(true);
    try {
      const body = await agentHubFetch<{ tagged: number }>(`/agent-hub/agents/bulk-tag`, {
        method: "POST",
        authHeaders: authHeaders(),
        body: JSON.stringify({ agent_ids: Array.from(selected), tag: tag.trim() }),
      });
      setToast({ msg: `Tagged ${body.tagged} agent(s).`, variant: "ok" });
      setSelected(new Set());
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Bulk tag failed.", variant: "error" });
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkDnc() {
    if (!selected.size) return;
    if (!confirm(`Mark ${selected.size} agent(s) as Do Not Contact? This is reversible but affects all future outreach.`)) return;
    setBulkBusy(true);
    try {
      const body = await agentHubFetch<{ marked: number }>(`/agent-hub/agents/bulk-dnc`, {
        method: "POST",
        authHeaders: authHeaders(),
        body: JSON.stringify({ agent_ids: Array.from(selected) }),
      });
      setToast({ msg: `Marked ${body.marked} as DNC.`, variant: "ok" });
      setSelected(new Set());
      setFilters((f) => ({ ...f }));
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Bulk DNC failed.", variant: "error" });
    } finally {
      setBulkBusy(false);
    }
  }

  function exportCsv() {
    if (!perms.can_export) {
      setToast({ msg: "You don't have export permission.", variant: "error" });
      return;
    }
    fetch(apiUrl(`/agent-hub/agents/export.csv${agentListQuery(filters)}`), {
      headers: authHeaders(),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Export failed (${res.status})`);
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `agent-hub-${Date.now()}.csv`;
        a.click();
      })
      .catch((e) => setToast({ msg: e instanceof Error ? e.message : "Export failed.", variant: "error" }));
  }

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div className={styles.shell}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Agents</h1>
          <p className={styles.pageSubtitle}>
            {loading ? "Loading…" : `${total} agent${total === 1 ? "" : "s"}`}
            {selected.size > 0 ? ` · ${selected.size} selected` : ""}
          </p>
        </div>
        <div className={styles.row}>
          {perms.can_export ? (
            <button onClick={exportCsv} className={styles.btn}>⬇ Export CSV</button>
          ) : null}
          <Link href="/agent-hub/agents/new" className={`${styles.btn} ${styles.btnPrimary}`}>+ Add Agent</Link>
        </div>
      </div>

      <div className={styles.filterBar}>
        <input
          className={styles.input}
          placeholder="Search name / brokerage / email"
          value={filters.search}
          onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, search: e.target.value })); }}
        />
        <select
          className={styles.select}
          value={filters.tier}
          onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, tier: e.target.value })); }}
        >
          <option value="">All tiers</option>
          <option value="vip">VIP</option>
          <option value="partner">Partner</option>
          <option value="warm">Warm</option>
          <option value="prospect">Prospect</option>
          <option value="cold">Cold</option>
          <option value="dormant">Dormant</option>
        </select>
        <select
          className={styles.select}
          value={filters.status}
          onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, status: e.target.value })); }}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="dnc">DNC</option>
          <option value="skipped">Skipped</option>
          <option value="converted">Converted</option>
        </select>
        <select
          className={styles.select}
          value={filters.brokerage_id}
          onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, brokerage_id: e.target.value })); }}
        >
          <option value="">All brokerages</option>
          {brokerages.map((b) => (
            <option key={b.id} value={b.id}>{b.name}{b.city ? ` (${b.city})` : ""}</option>
          ))}
        </select>
        <select
          className={styles.select}
          value={filters.niche}
          onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, niche: e.target.value })); }}
        >
          <option value="">All niches</option>
          <option value="luxury">Luxury</option>
          <option value="first_time">First-time</option>
          <option value="investor">Investor</option>
          <option value="leases">Leases</option>
          <option value="relocation">Relocation</option>
          <option value="multi">Multi</option>
          <option value="other">Other</option>
        </select>
        <input
          className={styles.input}
          placeholder="Target zip"
          value={filters.target_zip}
          onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, target_zip: e.target.value })); }}
        />
        <select
          className={styles.select}
          value={filters.tag}
          onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, tag: e.target.value })); }}
        >
          <option value="">All tags</option>
          {tags.map((t) => <option key={t.tag} value={t.tag}>{t.tag} ({t.count})</option>)}
        </select>
        <select
          className={styles.select}
          value={filters.sort}
          onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value }))}
        >
          <option value="last_interaction">Last interaction</option>
          <option value="name">Name</option>
          <option value="tier">Tier</option>
          <option value="brokerage">Brokerage</option>
          <option value="created_at">Newest first</option>
        </select>
      </div>

      {selected.size > 0 && isManager ? (
        <div className={styles.card} style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.85rem", color: "#6a737b" }}>{selected.size} selected:</span>
          {perms.can_change_tier ? (
            <select
              className={styles.select}
              style={{ width: "auto" }}
              disabled={bulkBusy}
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) {
                  bulkTier(e.target.value as Tier);
                  e.target.value = "";
                }
              }}
            >
              <option value="" disabled>Set tier…</option>
              <option value="vip">VIP</option>
              <option value="partner">Partner</option>
              <option value="warm">Warm</option>
              <option value="prospect">Prospect</option>
              <option value="cold">Cold</option>
              <option value="dormant">Dormant</option>
            </select>
          ) : null}
          <BulkTagInput onSubmit={bulkTag} disabled={bulkBusy} />
          {perms.can_mark_dnc ? (
            <button className={`${styles.btn} ${styles.btnDanger}`} onClick={bulkDnc} disabled={bulkBusy}>
              Mark DNC
            </button>
          ) : null}
          <button className={styles.btnGhost} onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      ) : null}

      {err ? <div className={styles.error}>{err}</div> : null}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              {isManager ? (
                <th style={{ width: 30 }}>
                  <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
                </th>
              ) : null}
              <th>Name</th>
              <th>Brokerage</th>
              <th>Tier</th>
              <th>Status</th>
              <th>Tags</th>
              <th>Last Interaction</th>
            </tr>
          </thead>
          <tbody>
            {agents.length === 0 ? (
              <tr><td colSpan={isManager ? 7 : 6} className={styles.empty}>No agents match these filters.</td></tr>
            ) : (
              agents.map((a) => (
                <tr key={a.id}>
                  {isManager ? (
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(a.id)}
                        onChange={() => toggleSelect(a.id)}
                      />
                    </td>
                  ) : null}
                  <td>
                    <Link href={`/agent-hub/agents/${a.id}`} className={styles.row} style={{ textDecoration: "none", color: "inherit" }}>
                      <Avatar agent={a} size={32} />
                      <span className={styles.linkCell} style={{ marginLeft: "0.4rem" }}>{a.full_name}</span>
                    </Link>
                  </td>
                  <td>{a.brokerage_name || <span className={styles.muted}>—</span>}</td>
                  <td><TierBadge tier={a.tier} /></td>
                  <td><StatusPill status={a.status} /></td>
                  <td>
                    {(a.tags || []).slice(0, 3).map((t) => (
                      <span key={t} className={styles.tagChip}>{t}</span>
                    ))}
                    {(a.tags || []).length > 3 ? <span className={styles.muted}>+{(a.tags || []).length - 3}</span> : null}
                  </td>
                  <td>{relativeTime(a.last_interaction_date)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <div className={styles.row} style={{ justifyContent: "center", marginTop: "1rem" }}>
          <button className={styles.btn} disabled={page === 1} onClick={() => setPage(page - 1)}>← Prev</button>
          <span className={styles.muted} style={{ fontSize: "0.85rem" }}>
            Page {page} of {totalPages}
          </span>
          <button className={styles.btn} disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next →</button>
        </div>
      ) : null}

      {toast ? <Toast message={toast.msg} variant={toast.variant} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}

function BulkTagInput({ onSubmit, disabled }: { onSubmit: (tag: string) => void; disabled: boolean }) {
  const [v, setV] = useState("");
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onSubmit(v.trim()); setV(""); } }}
      style={{ display: "inline-flex", gap: "0.3rem" }}
    >
      <input
        className={styles.input}
        style={{ width: 160 }}
        placeholder="Tag..."
        value={v}
        onChange={(e) => setV(e.target.value)}
        disabled={disabled}
      />
      <button type="submit" className={styles.btn} disabled={disabled || !v.trim()}>Add tag</button>
    </form>
  );
}

export default function AgentHubAgentsListPage() {
  return <AgentHubGate>{(perms) => <ListInner perms={perms} />}</AgentHubGate>;
}
