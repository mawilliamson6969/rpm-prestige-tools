"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../context/AuthContext";
import {
  agentHubFetch,
  type HubPermissions,
  type Owner,
} from "../../../../lib/agentHub";
import AgentHubGate from "../AgentHubGate";
import { Toast } from "../components";
import styles from "../agentHub.module.css";

function OwnersInner({ perms }: { perms: HubPermissions }) {
  const { authHeaders, token } = useAuth();
  const [owners, setOwners] = useState<Owner[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filters, setFilters] = useState({ status: "", search: "", has_active_referrals: false });
  const [page, setPage] = useState(1);
  const perPage = 50;
  const [toast, setToast] = useState<{ msg: string; variant: "ok" | "error" } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!token) return;
    let cancel = false;
    setLoading(true);
    (async () => {
      try {
        const sp = new URLSearchParams();
        if (filters.status) sp.set("status", filters.status);
        if (filters.search) sp.set("search", filters.search);
        if (filters.has_active_referrals) sp.set("has_active_referrals", "true");
        sp.set("page", String(page));
        sp.set("per_page", String(perPage));
        const body = await agentHubFetch<{ owners: Owner[]; total: number }>(`/agent-hub/owners?${sp.toString()}`, {
          authHeaders: authHeaders(),
        });
        if (cancel) return;
        setOwners(body.owners);
        setTotal(body.total);
        setErr(null);
      } catch (e) {
        if (cancel) return;
        setErr(e instanceof Error ? e.message : "Could not load owners.");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [token, authHeaders, filters, page]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div className={styles.shell}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Owners</h1>
          <p className={styles.pageSubtitle}>{total} owner{total === 1 ? "" : "s"}</p>
        </div>
        <Link href="/agent-hub/owners/new" className={`${styles.btn} ${styles.btnPrimary}`}>
          + Add Owner
        </Link>
      </div>

      <div className={styles.filterBar}>
        <input
          className={styles.input}
          placeholder="Search name / email / company"
          value={filters.search}
          onChange={(e) => { setPage(1); setFilters({ ...filters, search: e.target.value }); }}
        />
        <select
          className={styles.select}
          value={filters.status}
          onChange={(e) => { setPage(1); setFilters({ ...filters, status: e.target.value }); }}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="lost">Lost</option>
          <option value="converted">Converted</option>
          <option value="dormant">Dormant</option>
        </select>
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={filters.has_active_referrals}
            onChange={(e) => { setPage(1); setFilters({ ...filters, has_active_referrals: e.target.checked }); }}
          />
          Has active referrals
        </label>
      </div>

      {err ? <div className={styles.error}>{err}</div> : null}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Source agent</th>
              <th>Properties</th>
              <th>Active referrals</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && owners.length === 0 ? (
              <tr><td colSpan={7} className={styles.muted}>Loading…</td></tr>
            ) : owners.length === 0 ? (
              <tr><td colSpan={7} className={styles.empty}>No owners yet.</td></tr>
            ) : (
              owners.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link href={`/agent-hub/owners/${o.id}`} className={styles.linkCell}>
                      {o.full_name}{o.is_company ? ` (${o.company_name})` : ""}
                    </Link>
                  </td>
                  <td>{o.email || <span className={styles.muted}>—</span>}</td>
                  <td>{o.phone_mobile || o.phone_office || <span className={styles.muted}>—</span>}</td>
                  <td>
                    {o.source_agent_id ? (
                      <Link href={`/agent-hub/agents/${o.source_agent_id}`} className={styles.linkCell}>
                        {o.source_agent_name || "Agent"}
                      </Link>
                    ) : <span className={styles.muted}>—</span>}
                  </td>
                  <td>{o.property_count ?? 0}</td>
                  <td>{o.active_referral_count ?? 0}</td>
                  <td>{o.status}</td>
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

export default function OwnersListPage() {
  return <AgentHubGate>{(perms) => <OwnersInner perms={perms} />}</AgentHubGate>;
}
