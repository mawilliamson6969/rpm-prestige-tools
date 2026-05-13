"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../../../context/AuthContext";
import { agentHubFetch, formatMoney, type HubPermissions, type MarketEntry } from "../../../../lib/agentHub";
import AgentHubGate from "../AgentHubGate";
import { FieldGroup, Toast } from "../components";
import styles from "../agentHub.module.css";

function MarketInner({ perms }: { perms: HubPermissions }) {
  const { authHeaders, token } = useAuth();
  const [entries, setEntries] = useState<MarketEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ zip: "" });
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ msg: string; variant: "ok" | "error" } | null>(null);
  const [newRow, setNewRow] = useState({
    zip: "",
    month: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-01`,
    avg_lease_price: "",
    median_lease_price: "",
    total_active_listings: "",
    total_leased: "",
    avg_days_on_market: "",
    inventory_level: "",
    notable_events: "",
  });
  const [csvText, setCsvText] = useState("");

  const isManager = perms.role === "owner" || perms.role === "manager";

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  async function load() {
    try {
      const sp = new URLSearchParams();
      if (filter.zip) sp.set("zip", filter.zip);
      const body = await agentHubFetch<{ entries: MarketEntry[] }>(`/agent-hub/intelligence/market?${sp}`, { authHeaders: authHeaders() });
      setEntries(body.entries);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (token) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, filter]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!newRow.zip || !newRow.month) return;
    setBusy(true);
    try {
      await agentHubFetch("/agent-hub/intelligence/market", {
        method: "POST",
        authHeaders: authHeaders(),
        body: JSON.stringify({ ...newRow, data_source: "manual" }),
      });
      setNewRow({ ...newRow, avg_lease_price: "", median_lease_price: "", total_active_listings: "", total_leased: "", avg_days_on_market: "", notable_events: "" });
      setCreating(false);
      setToast({ msg: "Saved.", variant: "ok" });
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Failed.", variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function bulkImport() {
    if (!csvText.trim()) return;
    setBusy(true);
    try {
      const body = await agentHubFetch<{ imported: number; updated: number; errors: { row: number; error: string }[] }>(
        "/agent-hub/intelligence/market/bulk-import",
        { method: "POST", authHeaders: authHeaders(), body: JSON.stringify({ csv: csvText }) }
      );
      setToast({ msg: `Imported ${body.imported}, updated ${body.updated}, ${body.errors.length} errors.`, variant: body.errors.length ? "error" : "ok" });
      setCsvText("");
      setImporting(false);
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Import failed.", variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function deleteEntry(id: number) {
    if (!confirm("Delete this entry?")) return;
    try {
      await agentHubFetch(`/agent-hub/intelligence/market/${id}`, { method: "DELETE", authHeaders: authHeaders() });
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Delete failed.", variant: "error" });
    }
  }

  return (
    <div className={styles.shell}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Market Data</h1>
          <p className={styles.pageSubtitle}>{entries.length} entr{entries.length === 1 ? "y" : "ies"} (manual entry only — Phase 5 will add MLS sync)</p>
        </div>
        {isManager ? (
          <div className={styles.row}>
            <button className={styles.btn} onClick={() => setImporting((v) => !v)}>{importing ? "Cancel" : "Bulk Import"}</button>
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => setCreating((v) => !v)}>{creating ? "Cancel" : "+ Add Entry"}</button>
          </div>
        ) : null}
      </div>

      {creating ? (
        <form className={styles.card} onSubmit={create} style={{ marginBottom: "1rem" }}>
          <div className={styles.gridTwo}>
            <FieldGroup label="Zip *"><input className={styles.input} value={newRow.zip} onChange={(e) => setNewRow({ ...newRow, zip: e.target.value })} required /></FieldGroup>
            <FieldGroup label="Month (1st of) *"><input type="date" className={styles.input} value={newRow.month} onChange={(e) => setNewRow({ ...newRow, month: e.target.value })} required /></FieldGroup>
            <FieldGroup label="Avg lease price"><input type="number" step="0.01" className={styles.input} value={newRow.avg_lease_price} onChange={(e) => setNewRow({ ...newRow, avg_lease_price: e.target.value })} /></FieldGroup>
            <FieldGroup label="Median lease price"><input type="number" step="0.01" className={styles.input} value={newRow.median_lease_price} onChange={(e) => setNewRow({ ...newRow, median_lease_price: e.target.value })} /></FieldGroup>
            <FieldGroup label="Active listings"><input type="number" className={styles.input} value={newRow.total_active_listings} onChange={(e) => setNewRow({ ...newRow, total_active_listings: e.target.value })} /></FieldGroup>
            <FieldGroup label="Total leased"><input type="number" className={styles.input} value={newRow.total_leased} onChange={(e) => setNewRow({ ...newRow, total_leased: e.target.value })} /></FieldGroup>
            <FieldGroup label="Avg days on market"><input type="number" step="0.1" className={styles.input} value={newRow.avg_days_on_market} onChange={(e) => setNewRow({ ...newRow, avg_days_on_market: e.target.value })} /></FieldGroup>
            <FieldGroup label="Inventory level">
              <select className={styles.select} value={newRow.inventory_level} onChange={(e) => setNewRow({ ...newRow, inventory_level: e.target.value })}>
                <option value="">—</option>
                <option value="low">Low</option>
                <option value="balanced">Balanced</option>
                <option value="high">High</option>
              </select>
            </FieldGroup>
          </div>
          <FieldGroup label="Notable events">
            <textarea className={styles.textarea} value={newRow.notable_events} onChange={(e) => setNewRow({ ...newRow, notable_events: e.target.value })} />
          </FieldGroup>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
          </div>
        </form>
      ) : null}

      {importing ? (
        <div className={styles.card} style={{ marginBottom: "1rem" }}>
          <div className={styles.cardTitle}>Bulk import CSV</div>
          <p className={styles.muted} style={{ fontSize: "0.85rem" }}>
            Required columns: <code>zip,month</code> (month = YYYY-MM-01). Optional: <code>avg_lease_price, median_lease_price, total_active_listings, total_leased, avg_days_on_market, inventory_level, notable_events, data_source, source_notes</code>.
          </p>
          <textarea className={styles.textarea} rows={8} value={csvText} onChange={(e) => setCsvText(e.target.value)} placeholder="zip,month,avg_lease_price&#10;77007,2026-04-01,2400" />
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={bulkImport} disabled={busy || !csvText.trim()}>{busy ? "Importing…" : "Import"}</button>
          </div>
        </div>
      ) : null}

      <div className={styles.filterBar}>
        <input className={styles.input} placeholder="Filter by zip" value={filter.zip} onChange={(e) => setFilter({ zip: e.target.value })} />
      </div>

      {loading ? <div className={styles.muted}>Loading…</div> : null}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Zip</th>
              <th>Month</th>
              <th>Avg lease</th>
              <th>Median</th>
              <th>Active</th>
              <th>Leased</th>
              <th>Avg DOM</th>
              <th>Inventory</th>
              <th>Source</th>
              {isManager ? <th></th> : null}
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && !loading ? (
              <tr><td colSpan={isManager ? 10 : 9} className={styles.empty}>No data.</td></tr>
            ) : (
              entries.map((e) => (
                <tr key={e.id}>
                  <td>{e.zip}</td>
                  <td>{e.month?.slice(0, 7)}</td>
                  <td>{formatMoney(e.avg_lease_price)}</td>
                  <td>{formatMoney(e.median_lease_price)}</td>
                  <td>{e.total_active_listings ?? "—"}</td>
                  <td>{e.total_leased ?? "—"}</td>
                  <td>{e.avg_days_on_market ?? "—"}</td>
                  <td>{e.inventory_level ?? "—"}</td>
                  <td>{e.data_source}</td>
                  {isManager ? (
                    <td>
                      <button className={styles.btnDanger + " " + styles.btn} onClick={() => deleteEntry(e.id)}>×</button>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {toast ? <Toast message={toast.msg} variant={toast.variant} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}

export default function MarketPage() {
  return <AgentHubGate>{(perms) => <MarketInner perms={perms} />}</AgentHubGate>;
}
