"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./property-context.module.css";
import { apiUrl } from "../lib/api";
import { useAuth } from "../context/AuthContext";

export type PropertyContext = {
  property: {
    property_name: string;
    property_id: number | null;
    property_address: string | null;
    property_city?: string | null;
    property_state?: string | null;
    property_zip?: string | null;
    property_type: string | null;
    management_fee_percent: number | null;
  };
  alerts: Array<{ severity: "bad" | "warning"; message: string }>;
  occupancy: {
    status: string | null;
    tenant_name: string | null;
    tenant_email: string | null;
    tenant_phone: string | null;
    rent: number;
    market_rent: number;
    lease_from: string | null;
    lease_to: string | null;
    move_in: string | null;
    past_due: number;
    deposit: number;
    additional_tenants: string | null;
    unit: string | null;
  } | null;
  owner: { owner_name: string; owner_email: string | null; owner_phone: string | null } | null;
  lease: {
    lease_expires: string | null;
    lease_expires_month: string | null;
    status: string | null;
    notice_given_date: string | null;
    expires_in_days: number | null;
  } | null;
  delinquency: {
    amount_receivable: number;
    aging: { current: number; thirty: number; sixty: number; ninety: number };
    last_payment: string | null;
    in_collections: boolean;
    tenant_email: string | null;
    tenant_phone: string | null;
  } | null;
  workOrders: {
    open_count: number;
    orders: Array<{
      work_order_number: string | null;
      status: string | null;
      priority: string | null;
      vendor: string | null;
      work_order_issue: string | null;
      job_description: string | null;
      created_at: string | null;
      days_open: number | null;
    }>;
  };
  workOrderHistory: {
    total_ytd: number;
    completed_ytd: number;
    avg_days_to_complete: number | null;
    total_spend_ytd: number;
  } | null;
  leadsimple: {
    active_deals: Array<{
      pipeline_name: string | null;
      stage: string | null;
      deal_name: string | null;
      created_at: string | null;
    }>;
    open_tasks_count: number;
  };
  rentengine: {
    active_leads_count: number;
    recent_leads: Array<{
      name: string | null;
      email: string | null;
      phone: string | null;
      status: string | null;
      source: string | null;
      created_at: string | null;
    }>;
  };
  boom: {
    pending_applications_count: number;
    applications: Array<{ applicant_name: string | null; status: string | null; created_at: string | null }>;
  };
  healthScore: {
    score: number;
    factors: {
      occupancy: "good" | "warning" | "bad";
      delinquency: "good" | "warning" | "bad";
      workOrders: "good" | "warning" | "bad";
      leaseStatus: "good" | "warning" | "bad";
    };
  };
  lastSyncedAt: string | null;
};

type FetchKey = { propertyId?: number | null; propertyName?: string | null };

function formatMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function formatDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(s);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function healthColor(score: number): string {
  if (score >= 75) return "#10b981";
  if (score >= 50) return "#f59e0b";
  return "#ef4444";
}

function minutesAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.round(h / 24)} days ago`;
}

function occupancyChip(status: string | null): string {
  switch (status) {
    case "Current":
      return styles.chipCurrent;
    case "Vacant-Unrented":
      return styles.chipVacant;
    case "Notice-Unrented":
      return styles.chipNotice;
    default:
      return styles.chipNeutral;
  }
}

function leaseChip(status: string | null): string {
  switch (status) {
    case "Renewed":
      return styles.chipRenewed;
    case "Eligible":
    case "Expiring":
      return styles.chipExpiring;
    default:
      return styles.chipNeutral;
  }
}

export type PropertyContextPanelProps = FetchKey & {
  onClose?: () => void;
  embedded?: boolean;
};

export default function PropertyContextPanel({
  propertyId,
  propertyName,
  onClose,
  embedded,
}: PropertyContextPanelProps) {
  const { authHeaders, token } = useAuth();
  const [data, setData] = useState<PropertyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      let url: string;
      if (propertyId != null && Number.isFinite(propertyId)) {
        url = apiUrl(`/property-context/${propertyId}`);
      } else if (propertyName) {
        url = apiUrl(`/property-context/by-name/${encodeURIComponent(propertyName)}`);
      } else {
        setErr("No property specified.");
        setLoading(false);
        return;
      }
      const res = await fetch(url, { headers: { ...authHeaders() }, cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Could not load.");
      }
      setData(body);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load property context.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token, propertyId, propertyName]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => load(), 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [load]);

  // Auto-expand sections with alerts, collapse the rest.
  useEffect(() => {
    if (!data) return;
    const c = new Set<string>();
    if (!data.delinquency || data.delinquency.amount_receivable === 0) c.add("financial");
    if (!data.workOrders.open_count) c.add("workOrders");
    if (!data.lease || !data.lease.expires_in_days || data.lease.expires_in_days > 60) c.add("lease");
    if (data.occupancy?.status === "Current") c.add("leasing");
    setCollapsed(c);
  }, [data]);

  const toggle = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const body = loading ? (
    <div className={styles.loading}>Loading property context…</div>
  ) : err ? (
    <div className={styles.errorState}>{err}</div>
  ) : !data ? (
    <div className={styles.errorState}>No data.</div>
  ) : (
    <PanelContent data={data} collapsed={collapsed} toggle={toggle} />
  );

  if (embedded) {
    return <div className={styles.panel}>{body}</div>;
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalPanel} onClick={(e) => e.stopPropagation()}>
        <div style={{ position: "relative" }}>
          {onClose ? (
            <button
              type="button"
              className={styles.modalCloseBtn}
              onClick={onClose}
              aria-label="Close"
            >
              ×
            </button>
          ) : null}
          <div className={styles.panel} style={{ margin: 0, borderRadius: 10 }}>
            {body}
          </div>
        </div>
      </div>
    </div>
  );
}

function PanelContent({
  data,
  collapsed,
  toggle,
}: {
  data: PropertyContext;
  collapsed: Set<string>;
  toggle: (k: string) => void;
}) {
  const p = data.property;
  const addr = [p.property_address, p.property_city, p.property_state, p.property_zip]
    .filter(Boolean)
    .join(", ");
  const healthCircle = useMemo(() => {
    const score = data.healthScore.score;
    const r = 22;
    const circ = 2 * Math.PI * r;
    const offset = circ - (circ * score) / 100;
    return { r, circ, offset, color: healthColor(score) };
  }, [data.healthScore.score]);

  return (
    <>
      <div className={styles.panelHeader}>
        <div className={styles.panelHeaderText}>
          <h3 className={styles.panelHeaderName}>{p.property_name}</h3>
          {addr ? <p className={styles.panelHeaderAddr}>{addr}</p> : null}
          {p.property_type ? (
            <span className={styles.panelHeaderBadge}>
              {p.property_type === "Single-Family" ? "SFR" : "MF"}
            </span>
          ) : null}
        </div>
        <div className={styles.healthCircle} style={{ color: healthCircle.color }}>
          <svg viewBox="0 0 54 54">
            <circle className={styles.healthCircleBg} cx="27" cy="27" r={healthCircle.r} />
            <circle
              className={styles.healthCircleFg}
              cx="27"
              cy="27"
              r={healthCircle.r}
              strokeDasharray={healthCircle.circ}
              strokeDashoffset={healthCircle.offset}
            />
          </svg>
          <div className={styles.healthScoreText}>{data.healthScore.score}</div>
        </div>
      </div>

      {data.alerts.length ? (
        <div>
          {data.alerts.map((a, i) => (
            <div
              key={i}
              className={`${styles.alertBanner} ${
                a.severity === "bad" ? styles.alertBad : styles.alertWarning
              }`}
            >
              {a.severity === "bad" ? "🔴" : "🟡"} {a.message}
            </div>
          ))}
        </div>
      ) : null}

      <Section
        title="Occupancy"
        open={!collapsed.has("occupancy")}
        onToggle={() => toggle("occupancy")}
      >
        {data.occupancy ? (
          <>
            <div className={styles.kvRow}>
              <span className={styles.kvLabel}>Status</span>
              <span>
                <span
                  className={`${styles.statusChip} ${occupancyChip(data.occupancy.status)}`}
                >
                  {data.occupancy.status || "Unknown"}
                </span>
              </span>
            </div>
            {data.occupancy.tenant_name ? (
              <div className={styles.kvRow}>
                <span className={styles.kvLabel}>Tenant</span>
                <span className={styles.kvValue}>{data.occupancy.tenant_name}</span>
              </div>
            ) : null}
            {data.occupancy.tenant_phone ? (
              <div className={styles.kvRow}>
                <span className={styles.kvLabel}>Phone</span>
                <a className={styles.link} href={`tel:${data.occupancy.tenant_phone}`}>
                  {data.occupancy.tenant_phone}
                </a>
              </div>
            ) : null}
            {data.occupancy.tenant_email ? (
              <div className={styles.kvRow}>
                <span className={styles.kvLabel}>Email</span>
                <a className={styles.link} href={`mailto:${data.occupancy.tenant_email}`}>
                  {data.occupancy.tenant_email}
                </a>
              </div>
            ) : null}
            <div className={styles.kvRow}>
              <span className={styles.kvLabel}>Rent</span>
              <span className={styles.kvValue}>{formatMoney(data.occupancy.rent)}/mo</span>
            </div>
            {data.occupancy.market_rent > 0 ? (
              <div className={styles.kvRow}>
                <span className={styles.kvLabel}>Market</span>
                <span className={styles.kvValue}>{formatMoney(data.occupancy.market_rent)}/mo</span>
              </div>
            ) : null}
            {data.occupancy.lease_from || data.occupancy.lease_to ? (
              <div className={styles.kvRow}>
                <span className={styles.kvLabel}>Lease</span>
                <span className={styles.kvValue}>
                  {formatDate(data.occupancy.lease_from)} → {formatDate(data.occupancy.lease_to)}
                </span>
              </div>
            ) : null}
            {data.occupancy.move_in ? (
              <div className={styles.kvRow}>
                <span className={styles.kvLabel}>Move-in</span>
                <span className={styles.kvValue}>{formatDate(data.occupancy.move_in)}</span>
              </div>
            ) : null}
          </>
        ) : (
          <div className={styles.kvLabel}>No rent roll data.</div>
        )}
      </Section>

      <Section title="Owner" open={!collapsed.has("owner")} onToggle={() => toggle("owner")}>
        {data.owner ? (
          <>
            <div className={styles.kvRow}>
              <span className={styles.kvLabel}>Name</span>
              <span className={styles.kvValue}>{data.owner.owner_name}</span>
            </div>
            {data.owner.owner_phone ? (
              <div className={styles.kvRow}>
                <span className={styles.kvLabel}>Phone</span>
                <a className={styles.link} href={`tel:${data.owner.owner_phone}`}>
                  {data.owner.owner_phone}
                </a>
              </div>
            ) : null}
            {data.owner.owner_email ? (
              <div className={styles.kvRow}>
                <span className={styles.kvLabel}>Email</span>
                <a className={styles.link} href={`mailto:${data.owner.owner_email}`}>
                  {data.owner.owner_email}
                </a>
              </div>
            ) : null}
            {p.management_fee_percent !== null ? (
              <div className={styles.kvRow}>
                <span className={styles.kvLabel}>Mgmt fee</span>
                <span className={styles.kvValue}>{p.management_fee_percent}%</span>
              </div>
            ) : null}
          </>
        ) : (
          <div className={styles.kvLabel}>No owner data.</div>
        )}
      </Section>

      <Section
        title="Financial"
        open={!collapsed.has("financial")}
        onToggle={() => toggle("financial")}
      >
        {data.delinquency ? (
          <>
            <div className={styles.kvRow}>
              <span className={styles.kvLabel}>Past due</span>
              <span
                className={styles.kvValue}
                style={{
                  color: data.delinquency.amount_receivable > 0 ? "#b32317" : "#10b981",
                }}
              >
                {formatMoney(data.delinquency.amount_receivable)}
              </span>
            </div>
            {data.delinquency.amount_receivable > 0 ? (
              <div className={styles.kvRow}>
                <span className={styles.kvLabel}>Aging</span>
                <span className={styles.kvValue} style={{ fontSize: "0.78rem" }}>
                  0-30: {formatMoney(data.delinquency.aging.current)} · 30-60:{" "}
                  {formatMoney(data.delinquency.aging.thirty)} · 60-90:{" "}
                  {formatMoney(data.delinquency.aging.sixty)} · 90+:{" "}
                  {formatMoney(data.delinquency.aging.ninety)}
                </span>
              </div>
            ) : null}
            {data.delinquency.last_payment ? (
              <div className={styles.kvRow}>
                <span className={styles.kvLabel}>Last payment</span>
                <span className={styles.kvValue}>
                  {formatDate(data.delinquency.last_payment)}
                </span>
              </div>
            ) : null}
            {data.delinquency.in_collections ? (
              <div className={styles.kvRow}>
                <span className={styles.kvLabel}>In collections</span>
                <span className={styles.kvValue} style={{ color: "#b32317" }}>
                  Yes
                </span>
              </div>
            ) : null}
          </>
        ) : (
          <div className={styles.kvLabel}>No delinquency — current</div>
        )}
        {data.occupancy && data.occupancy.deposit > 0 ? (
          <div className={styles.kvRow}>
            <span className={styles.kvLabel}>Deposit</span>
            <span className={styles.kvValue}>{formatMoney(data.occupancy.deposit)}</span>
          </div>
        ) : null}
      </Section>

      <Section
        title="Lease Status"
        open={!collapsed.has("lease")}
        onToggle={() => toggle("lease")}
      >
        {data.lease ? (
          <>
            <div className={styles.kvRow}>
              <span className={styles.kvLabel}>Expires</span>
              <span className={styles.kvValue}>
                {data.lease.lease_expires_month ||
                  formatDate(data.lease.lease_expires)}
              </span>
            </div>
            <div className={styles.kvRow}>
              <span className={styles.kvLabel}>Status</span>
              <span>
                <span className={`${styles.statusChip} ${leaseChip(data.lease.status)}`}>
                  {data.lease.status || "—"}
                </span>
              </span>
            </div>
            {data.lease.expires_in_days !== null ? (
              <div className={styles.kvRow}>
                <span className={styles.kvLabel}>Days remaining</span>
                <span
                  className={styles.kvValue}
                  style={{
                    color:
                      data.lease.expires_in_days < 0
                        ? "#b32317"
                        : data.lease.expires_in_days < 45
                        ? "#92400e"
                        : "#1b2856",
                  }}
                >
                  {data.lease.expires_in_days < 0
                    ? `${Math.abs(data.lease.expires_in_days)} days past`
                    : `${data.lease.expires_in_days} days`}
                </span>
              </div>
            ) : null}
            {data.lease.notice_given_date ? (
              <div className={styles.kvRow}>
                <span className={styles.kvLabel}>Notice given</span>
                <span className={styles.kvValue}>
                  {formatDate(data.lease.notice_given_date)}
                </span>
              </div>
            ) : null}
          </>
        ) : (
          <div className={styles.kvLabel}>No lease data.</div>
        )}
      </Section>

      <Section
        title="Work Orders"
        open={!collapsed.has("workOrders")}
        onToggle={() => toggle("workOrders")}
      >
        <div className={styles.kvRow}>
          <span className={styles.kvLabel}>Open</span>
          <span
            className={styles.kvValue}
            style={{ color: data.workOrders.open_count > 0 ? "#b32317" : "#10b981" }}
          >
            {data.workOrders.open_count}
          </span>
        </div>
        {data.workOrders.orders.length ? (
          <div className={styles.woList}>
            {data.workOrders.orders.slice(0, 5).map((w, i) => (
              <div
                key={i}
                className={`${styles.woItem} ${
                  w.priority === "Urgent" ? styles.woItemUrgent : ""
                }`}
              >
                <div>
                  <strong>#{w.work_order_number || "—"}</strong> · {w.work_order_issue || "—"}
                </div>
                <div className={styles.woItemMeta}>
                  {w.status} · {w.vendor || "unassigned"}
                  {w.days_open !== null ? ` · ${w.days_open}d open` : ""}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {data.workOrderHistory ? (
          <>
            <div className={styles.kvRow}>
              <span className={styles.kvLabel}>YTD completed</span>
              <span className={styles.kvValue}>
                {data.workOrderHistory.completed_ytd} / {data.workOrderHistory.total_ytd}
              </span>
            </div>
            {data.workOrderHistory.avg_days_to_complete !== null ? (
              <div className={styles.kvRow}>
                <span className={styles.kvLabel}>Avg days</span>
                <span className={styles.kvValue}>
                  {data.workOrderHistory.avg_days_to_complete}
                </span>
              </div>
            ) : null}
            {data.workOrderHistory.total_spend_ytd > 0 ? (
              <div className={styles.kvRow}>
                <span className={styles.kvLabel}>Spend YTD</span>
                <span className={styles.kvValue}>
                  {formatMoney(data.workOrderHistory.total_spend_ytd)}
                </span>
              </div>
            ) : null}
          </>
        ) : null}
        <a className={styles.link} href="/dashboard?tab=maintenance">
          View in Maintenance Dashboard →
        </a>
      </Section>

      {data.occupancy?.status !== "Current" ||
      data.leadsimple.active_deals.length ||
      data.rentengine.active_leads_count > 0 ||
      data.boom.pending_applications_count > 0 ? (
        <Section
          title="Leasing Pipeline"
          open={!collapsed.has("leasing")}
          onToggle={() => toggle("leasing")}
        >
          <div className={styles.kvRow}>
            <span className={styles.kvLabel}>RentEngine leads</span>
            <span className={styles.kvValue}>{data.rentengine.active_leads_count}</span>
          </div>
          <div className={styles.kvRow}>
            <span className={styles.kvLabel}>Boom applications</span>
            <span className={styles.kvValue}>
              {data.boom.pending_applications_count}
            </span>
          </div>
          <div className={styles.kvRow}>
            <span className={styles.kvLabel}>LeadSimple deals</span>
            <span className={styles.kvValue}>{data.leadsimple.active_deals.length}</span>
          </div>
          {data.leadsimple.active_deals.length
            ? data.leadsimple.active_deals.slice(0, 3).map((d, i) => (
                <div key={i} className={styles.woItem}>
                  <strong>{d.deal_name || "Deal"}</strong>
                  <div className={styles.woItemMeta}>
                    {d.pipeline_name}
                    {d.stage ? ` · ${d.stage}` : ""}
                  </div>
                </div>
              ))
            : null}
          <a className={styles.link} href="/dashboard?tab=leasing">
            View in Leasing Dashboard →
          </a>
        </Section>
      ) : null}

      <div className={styles.footer}>Last updated: {minutesAgo(data.lastSyncedAt)}</div>
    </>
  );
}

function Section({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader} onClick={onToggle}>
        <h4>{title}</h4>
        <span>{open ? "▾" : "▸"}</span>
      </div>
      {open ? <div className={styles.sectionBody}>{children}</div> : null}
    </div>
  );
}

export function PropertyContextCompact({
  propertyId,
  propertyName,
  onExpand,
}: {
  propertyId?: number | null;
  propertyName?: string | null;
  onExpand?: () => void;
}) {
  const { authHeaders, token } = useAuth();
  const [data, setData] = useState<PropertyContext | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      let url: string;
      if (propertyId != null && Number.isFinite(propertyId)) {
        url = apiUrl(`/property-context/${propertyId}`);
      } else if (propertyName) {
        url = apiUrl(`/property-context/by-name/${encodeURIComponent(propertyName)}`);
      } else return;
      const res = await fetch(url, { headers: { ...authHeaders() }, cache: "no-store" });
      if (!res.ok) return;
      setData(await res.json());
    } catch {
      /* ignore */
    }
  }, [authHeaders, token, propertyId, propertyName]);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) return null;
  const tenant = data.occupancy?.tenant_name;
  const status = data.occupancy?.status;
  const delinq = data.delinquency?.amount_receivable ?? 0;
  const openWOs = data.workOrders.open_count;
  return (
    <div className={styles.compact}>
      <strong>{data.property.property_name}</strong>
      {tenant ? (
        <>
          <span className={styles.compactSep}>|</span>
          <span>Tenant: {tenant}</span>
        </>
      ) : null}
      {status ? (
        <>
          <span className={styles.compactSep}>|</span>
          <span className={`${styles.statusChip} ${occupancyChip(status)}`}>{status}</span>
        </>
      ) : null}
      <>
        <span className={styles.compactSep}>|</span>
        <span style={{ color: delinq > 0 ? "#b32317" : "inherit" }}>
          Delinq: {formatMoney(delinq)}
        </span>
      </>
      <>
        <span className={styles.compactSep}>|</span>
        <span style={{ color: openWOs > 0 ? "#b45309" : "inherit" }}>Open WOs: {openWOs}</span>
      </>
      {onExpand ? (
        <button type="button" className={styles.compactLink} onClick={onExpand}>
          Details →
        </button>
      ) : null}
    </div>
  );
}
