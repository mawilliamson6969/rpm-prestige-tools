"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../context/AuthContext";
import { agentHubFetch, type HubPermissions, type Property } from "../../../../lib/agentHub";
import AgentHubGate from "../AgentHubGate";
import styles from "../agentHub.module.css";

function PropertiesInner({ perms }: { perms: HubPermissions }) {
  const { authHeaders, token } = useAuth();
  const [list, setList] = useState<Property[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: "", zip: "", property_type: "", search: "" });
  const [page, setPage] = useState(1);
  const perPage = 50;
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancel = false;
    setLoading(true);
    (async () => {
      try {
        const sp = new URLSearchParams();
        if (filters.status) sp.set("status", filters.status);
        if (filters.zip) sp.set("zip", filters.zip);
        if (filters.property_type) sp.set("property_type", filters.property_type);
        if (filters.search) sp.set("search", filters.search);
        sp.set("page", String(page));
        sp.set("per_page", String(perPage));
        const body = await agentHubFetch<{ properties: Property[]; total: number }>(`/agent-hub/properties?${sp}`, {
          authHeaders: authHeaders(),
        });
        if (cancel) return;
        setList(body.properties);
        setTotal(body.total);
        setErr(null);
      } catch (e) {
        if (cancel) return;
        setErr(e instanceof Error ? e.message : "Could not load.");
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
          <h1 className={styles.pageTitle}>Properties</h1>
          <p className={styles.pageSubtitle}>{total} propert{total === 1 ? "y" : "ies"}</p>
        </div>
      </div>

      <div className={styles.filterBar}>
        <input
          className={styles.input}
          placeholder="Search address / city"
          value={filters.search}
          onChange={(e) => { setPage(1); setFilters({ ...filters, search: e.target.value }); }}
        />
        <select
          className={styles.select}
          value={filters.status}
          onChange={(e) => { setPage(1); setFilters({ ...filters, status: e.target.value }); }}
        >
          <option value="">All statuses</option>
          <option value="prospect">Prospect</option>
          <option value="under_management">Under management</option>
          <option value="lost">Lost</option>
          <option value="inactive">Inactive</option>
        </select>
        <select
          className={styles.select}
          value={filters.property_type}
          onChange={(e) => { setPage(1); setFilters({ ...filters, property_type: e.target.value }); }}
        >
          <option value="">All types</option>
          <option value="single_family">Single family</option>
          <option value="condo">Condo</option>
          <option value="townhome">Townhome</option>
          <option value="duplex">Duplex</option>
          <option value="multi_family">Multi-family</option>
          <option value="other">Other</option>
        </select>
        <input
          className={styles.input}
          placeholder="Zip"
          value={filters.zip}
          onChange={(e) => { setPage(1); setFilters({ ...filters, zip: e.target.value }); }}
        />
      </div>

      {err ? <div className={styles.error}>{err}</div> : null}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Address</th>
              <th>Owner</th>
              <th>Type</th>
              <th>Beds/Baths</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && list.length === 0 ? (
              <tr><td colSpan={5} className={styles.muted}>Loading…</td></tr>
            ) : list.length === 0 ? (
              <tr><td colSpan={5} className={styles.empty}>No properties.</td></tr>
            ) : (
              list.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/agent-hub/properties/${p.id}`} className={styles.linkCell}>
                      {p.address_1}, {p.city}
                    </Link>
                  </td>
                  <td>
                    {p.owner_id ? (
                      <Link href={`/agent-hub/owners/${p.owner_id}`} className={styles.linkCell}>
                        {p.owner_name}
                      </Link>
                    ) : <span className={styles.muted}>—</span>}
                  </td>
                  <td>{p.property_type || <span className={styles.muted}>—</span>}</td>
                  <td>{p.bedrooms ?? "—"} / {p.bathrooms ?? "—"}</td>
                  <td>{p.status}</td>
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
    </div>
  );
}

export default function PropertiesListPage() {
  return <AgentHubGate>{(perms) => <PropertiesInner perms={perms} />}</AgentHubGate>;
}
