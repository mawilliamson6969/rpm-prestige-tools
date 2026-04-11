"use client";

import { Fragment, useMemo, useState } from "react";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import styles from "./dashboard.module.css";

const NAVY = "#1b2856";
const BLUE = "#0098d0";
const RED = "#b32317";
const GREY = "#6a737b";
const GOLD = "#c5960c";
const GREEN = "#2d8b4e";

const PIE_COLORS = [BLUE, NAVY, GOLD, "#d97706"];

type Summary = {
  totalProperties: number;
  totalUnits: number;
  byType: Record<string, number>;
  totalOwners: number;
  avgManagementFee: number;
  insuranceExpiringNext90Days?: number;
  insuranceExpiredCount?: number;
  warrantyExpiringNext90Days?: number;
  warrantyExpiredCount?: number;
  propertiesOnNotice?: number;
};

type ExpandDetails = {
  propertyAddressFull?: string;
  sqft?: string;
  yearBuilt?: string;
  managementFeeType?: string;
  managementFlatFee?: string;
  managementEndDate?: string;
  leaseFeePercent?: string;
  leaseFeeType?: string;
  leaseFlatFee?: string;
  renewalFeePercent?: string;
  renewalFeeType?: string;
  renewalFlatFee?: string;
  lateFeeType?: string;
  lateFeeBaseAmount?: string;
  lateFeeGracePeriod?: string;
  portfolio?: string;
  visibility?: string;
  openWorkOrdersList?: {
    workOrderNumber: string;
    status: string;
    priority: string;
    issue: string;
    vendor: string;
    createdAt: string;
  }[];
  delinquentTenants?: { name: string; unit: string; amount: number }[];
};

type PropertyRow = {
  propertyId: string | number;
  propertyName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  propertyType: string;
  units: number;
  sqft?: string;
  yearBuilt?: string;
  marketRent?: string;
  managementFeePercent?: string;
  managementStartDate?: string;
  maintenanceLimit?: string;
  reserve?: string;
  owners?: string;
  insuranceExpiration?: string;
  homeWarrantyExpiration?: string;
  insuranceExpiryFlag?: string;
  warrantyExpiryFlag?: string;
  occupancy: string;
  openWorkOrders: number;
  delinquency: number;
  expandDetails?: ExpandDetails;
};

type OwnerRow = {
  ownerId: string | number;
  name: string;
  email: string;
  phone: string;
  propertiesOwned: string;
  propertyCount: number;
  lastPaymentDate: string;
  tags: string;
  ownershipLines?: { propertyName: string; ownershipPercent: string }[];
};

type PortfolioPayload = {
  summary?: Summary;
  properties?: PropertyRow[];
  owners?: OwnerRow[];
};

function fmtMoney(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    n
  );
}

function typeAbbr(t: string) {
  const u = t.toLowerCase();
  if (u.includes("single")) return "SFR";
  if (u.includes("multi")) return "MF";
  return t.slice(0, 3).toUpperCase();
}

function occBadge(occ: string) {
  const o = occ.toLowerCase();
  if (o === "vacant") return { label: "Vacant", bg: "rgba(179,35,23,0.15)", color: RED };
  if (o === "notice") return { label: "Notice", bg: "rgba(197,150,12,0.2)", color: GOLD };
  return { label: "Current", bg: "rgba(45,139,78,0.15)", color: GREEN };
}

function expiryTone(flag?: string) {
  if (flag === "expired") return RED;
  if (flag === "expiring90") return GOLD;
  return GREY;
}

type PropSort =
  | "propertyName"
  | "address"
  | "propertyType"
  | "units"
  | "occupancy"
  | "marketRent"
  | "managementFeePercent"
  | "openWorkOrders"
  | "delinquency"
  | "owners";

type OwnerSort = "name" | "propertyCount" | "lastPaymentDate" | "email";

export default function PortfolioPanel(props: {
  portfolio: PortfolioPayload | null;
  loading: boolean;
  error: string | null;
}) {
  const { portfolio, loading, error } = props;
  const [propSearch, setPropSearch] = useState("");
  const [propSort, setPropSort] = useState<PropSort>("propertyName");
  const [propDir, setPropDir] = useState<"asc" | "desc">("asc");
  const [expandedProp, setExpandedProp] = useState<string | null>(null);

  const [ownerSearch, setOwnerSearch] = useState("");
  const [ownerSort, setOwnerSort] = useState<OwnerSort>("name");
  const [ownerDir, setOwnerDir] = useState<"asc" | "desc">("asc");
  const [expandedOwner, setExpandedOwner] = useState<string | number | null>(null);

  const summary = portfolio?.summary;
  const rawProps = portfolio?.properties ?? [];
  const rawOwners = portfolio?.owners ?? [];

  const pieData = useMemo(() => {
    const b = summary?.byType ?? {};
    return Object.entries(b)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name, value }));
  }, [summary?.byType]);

  const sfr = summary?.byType?.["Single-Family"] ?? summary?.byType?.["Single-family"] ?? 0;
  const mfr = summary?.byType?.["Multi-Family"] ?? summary?.byType?.["Multi-family"] ?? 0;

  const filteredSortedProps = useMemo(() => {
    const q = propSearch.trim().toLowerCase();
    let rows = q
      ? rawProps.filter((p) => {
          const hay = `${p.propertyName} ${p.address} ${p.city} ${p.owners ?? ""}`.toLowerCase();
          return hay.includes(q);
        })
      : [...rawProps];

    const dir = propDir === "asc" ? 1 : -1;
    const num = (s: string | undefined) => parseFloat(String(s ?? "").replace(/[$,]/g, "")) || 0;
    rows.sort((a, b) => {
      switch (propSort) {
        case "propertyName":
          return dir * a.propertyName.localeCompare(b.propertyName, undefined, { sensitivity: "base" });
        case "address":
          return dir * `${a.city} ${a.state}`.localeCompare(`${b.city} ${b.state}`, undefined, {
            sensitivity: "base",
          });
        case "propertyType":
          return dir * a.propertyType.localeCompare(b.propertyType);
        case "units":
          return dir * (a.units - b.units);
        case "occupancy":
          return dir * a.occupancy.localeCompare(b.occupancy);
        case "marketRent":
          return dir * (num(a.marketRent) - num(b.marketRent));
        case "managementFeePercent":
          return dir * (num(a.managementFeePercent) - num(b.managementFeePercent));
        case "openWorkOrders":
          return dir * (a.openWorkOrders - b.openWorkOrders);
        case "delinquency":
          return dir * (a.delinquency - b.delinquency);
        case "owners":
          return dir * (a.owners ?? "").localeCompare(b.owners ?? "", undefined, { sensitivity: "base" });
        default:
          return 0;
      }
    });
    return rows;
  }, [rawProps, propSearch, propSort, propDir]);

  const filteredSortedOwners = useMemo(() => {
    const q = ownerSearch.trim().toLowerCase();
    let rows = q
      ? rawOwners.filter((o) => {
          const hay = `${o.name} ${o.email}`.toLowerCase();
          return hay.includes(q);
        })
      : [...rawOwners];

    const dir = ownerDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      switch (ownerSort) {
        case "name":
          return dir * a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        case "email":
          return dir * a.email.localeCompare(b.email, undefined, { sensitivity: "base" });
        case "propertyCount":
          return dir * (a.propertyCount - b.propertyCount);
        case "lastPaymentDate":
          return dir * a.lastPaymentDate.localeCompare(b.lastPaymentDate);
        default:
          return 0;
      }
    });
    return rows;
  }, [rawOwners, ownerSearch, ownerSort, ownerDir]);

  const togglePropSort = (k: PropSort) => {
    if (propSort === k) setPropDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setPropSort(k);
      setPropDir("asc");
    }
  };

  const toggleOwnerSort = (k: OwnerSort) => {
    if (ownerSort === k) setOwnerDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setOwnerSort(k);
      setOwnerDir("asc");
    }
  };

  if (loading && !portfolio) {
    return (
      <>
        <div className={styles.skeletonGrid} style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className={styles.skeleton} style={{ minHeight: 100 }} />
          ))}
        </div>
        <div className={styles.chartRow}>
          <div className={styles.skeleton} style={{ minHeight: 260 }} />
          <div className={styles.skeleton} style={{ minHeight: 260 }} />
        </div>
      </>
    );
  }

  if (error) {
    return (
      <div className={styles.alert} role="alert">
        <strong>Could not load portfolio.</strong> {error}
      </div>
    );
  }

  if (!portfolio || !summary) {
    return (
      <p style={{ color: GREY }}>No portfolio data yet. Sync cached properties and rent roll from Refresh Data.</p>
    );
  }

  return (
    <>
      <p style={{ fontSize: "0.85rem", color: GREY, marginTop: 0, marginBottom: "1rem" }}>
        Property and owner directory from cached AppFolio data, cross-referenced with rent roll, work orders, and
        delinquency by property name.
      </p>

      <div className={styles.grid4}>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Total properties</div>
          <div className={styles.kpiValue} style={{ color: NAVY }}>
            {summary.totalProperties}
          </div>
          <div className={styles.kpiSub}>
            {sfr} SFR · {mfr} Multi-Family
          </div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Total units</div>
          <div className={styles.kpiValue} style={{ color: NAVY }}>
            {summary.totalUnits}
          </div>
          <div className={styles.kpiSub}>From rent roll (filtered)</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Total owners</div>
          <div className={styles.kpiValue} style={{ color: NAVY }}>
            {summary.totalOwners}
          </div>
          <div className={styles.kpiSub}>Cached owners (filtered)</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiLabel}>Avg management fee</div>
          <div className={styles.kpiValue} style={{ color: BLUE }}>
            {summary.avgManagementFee.toFixed(1)}%
          </div>
          <div className={styles.kpiSub}>Mean of management_fee_percent</div>
        </div>
      </div>

      <div className={styles.chartRow}>
        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>Property type mix</h3>
          {pieData.length === 0 ? (
            <div className={styles.chartPlaceholder}>No property type data.</div>
          ) : (
            <div style={{ width: "100%", height: 260 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={48}
                    outerRadius={82}
                    paddingAngle={2}
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>Quick stats</h3>
          <div style={{ display: "grid", gap: "0.75rem", fontSize: "0.9rem", color: GREY }}>
            <div className={styles.kpiCard} style={{ boxShadow: "none", padding: "0.75rem" }}>
              <strong style={{ color: NAVY }}>Insurance — next 90 days</strong>
              <div style={{ fontSize: "1.35rem", fontWeight: 800, color: GOLD }}>
                {summary.insuranceExpiringNext90Days ?? 0}
              </div>
              <span style={{ fontSize: "0.8rem" }}>Expired (needs renewal): {summary.insuranceExpiredCount ?? 0}</span>
            </div>
            <div className={styles.kpiCard} style={{ boxShadow: "none", padding: "0.75rem" }}>
              <strong style={{ color: NAVY }}>Home warranty — next 90 days</strong>
              <div style={{ fontSize: "1.35rem", fontWeight: 800, color: GOLD }}>
                {summary.warrantyExpiringNext90Days ?? 0}
              </div>
              <span style={{ fontSize: "0.8rem" }}>Expired: {summary.warrantyExpiredCount ?? 0}</span>
            </div>
            <div className={styles.kpiCard} style={{ boxShadow: "none", padding: "0.75rem" }}>
              <strong style={{ color: NAVY }}>Properties on notice</strong>
              <div style={{ fontSize: "1.35rem", fontWeight: 800, color: GOLD }}>
                {summary.propertiesOnNotice ?? 0}
              </div>
              <span style={{ fontSize: "0.8rem" }}>At least one unit Notice-Unrented</span>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.tableCard} style={{ marginBottom: "1.25rem" }}>
        <h3 className={styles.chartTitle}>Property directory</h3>
        <div className={styles.tableSearch}>
          <input
            type="search"
            placeholder="Search property, address, owner…"
            value={propSearch}
            onChange={(e) => setPropSearch(e.target.value)}
            aria-label="Search properties"
          />
        </div>
        <div className={`${styles.tableWrap} ${styles.maintTableDesktop}`}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th onClick={() => togglePropSort("propertyName")}>Property</th>
                <th onClick={() => togglePropSort("address")}>City / State</th>
                <th onClick={() => togglePropSort("propertyType")}>Type</th>
                <th onClick={() => togglePropSort("units")}>Units</th>
                <th onClick={() => togglePropSort("occupancy")}>Occupancy</th>
                <th onClick={() => togglePropSort("marketRent")}>Market rent</th>
                <th onClick={() => togglePropSort("managementFeePercent")}>Mgmt %</th>
                <th onClick={() => togglePropSort("openWorkOrders")}>Open WOs</th>
                <th onClick={() => togglePropSort("delinquency")}>Delinquency</th>
                <th onClick={() => togglePropSort("owners")}>Owner</th>
              </tr>
            </thead>
            <tbody>
              {filteredSortedProps.map((p) => {
                const key = String(p.propertyId);
                const open = expandedProp === key;
                const ob = occBadge(p.occupancy);
                return (
                  <Fragment key={key}>
                    <tr className={open ? styles.maintRowOpen : undefined}>
                      <td>
                        <button
                          type="button"
                          className={styles.rowBtn}
                          onClick={() => setExpandedProp((e) => (e === key ? null : key))}
                        >
                          {p.propertyName}
                        </button>
                      </td>
                      <td>
                        {p.city}, {p.state}
                      </td>
                      <td>{typeAbbr(p.propertyType)}</td>
                      <td>{p.units}</td>
                      <td>
                        <span className={styles.statusBadge} style={{ background: ob.bg, color: ob.color }}>
                          {ob.label}
                        </span>
                      </td>
                      <td>{p.marketRent ? `$${p.marketRent}` : "—"}</td>
                      <td>{p.managementFeePercent ? `${p.managementFeePercent}%` : "—"}</td>
                      <td>{p.openWorkOrders}</td>
                      <td style={{ color: p.delinquency > 0 ? RED : GREY, fontWeight: p.delinquency > 0 ? 700 : 400 }}>
                        {fmtMoney(p.delinquency)}
                      </td>
                      <td>{p.owners ?? "—"}</td>
                    </tr>
                    {open && p.expandDetails ? (
                      <tr className={styles.expandRow}>
                        <td colSpan={10}>
                          <div className={styles.portfolioExpand}>
                            <div className={styles.portfolioExpandGrid}>
                              <div>
                                <h4 className={styles.portfolioExpandTitle}>Location &amp; asset</h4>
                                <p>
                                  <strong>Address:</strong> {p.expandDetails.propertyAddressFull ?? p.address}
                                </p>
                                <p>
                                  <strong>Sqft / Year:</strong> {p.expandDetails.sqft ?? p.sqft ?? "—"} ·{" "}
                                  {p.expandDetails.yearBuilt ?? p.yearBuilt ?? "—"}
                                </p>
                              </div>
                              <div>
                                <h4 className={styles.portfolioExpandTitle}>Management &amp; fees</h4>
                                <p>
                                  <strong>Fee:</strong> {p.managementFeePercent ?? "—"}% (
                                  {p.expandDetails.managementFeeType ?? "—"})
                                  {p.expandDetails.managementFlatFee
                                    ? ` · Flat ${p.expandDetails.managementFlatFee}`
                                    : ""}
                                </p>
                                <p>
                                  <strong>Start:</strong> {p.managementStartDate ?? "—"}
                                  {p.expandDetails.managementEndDate
                                    ? ` · End ${p.expandDetails.managementEndDate}`
                                    : ""}
                                </p>
                                <p>
                                  <strong>Maintenance limit / Reserve:</strong> {p.maintenanceLimit ?? "—"} /{" "}
                                  {p.reserve ?? "—"}
                                </p>
                              </div>
                              <div>
                                <h4 className={styles.portfolioExpandTitle}>Leasing &amp; late fees</h4>
                                <p>
                                  Lease: {p.expandDetails.leaseFeePercent ?? "—"}% ({p.expandDetails.leaseFeeType ?? "—"}
                                  )
                                  {p.expandDetails.leaseFlatFee ? ` · ${p.expandDetails.leaseFlatFee}` : ""}
                                </p>
                                <p>
                                  Renewal: {p.expandDetails.renewalFeePercent ?? "—"}% (
                                  {p.expandDetails.renewalFeeType ?? "—"})
                                </p>
                                <p>
                                  Late: {p.expandDetails.lateFeeType ?? "—"} · Base {p.expandDetails.lateFeeBaseAmount ?? "—"}{" "}
                                  · Grace {p.expandDetails.lateFeeGracePeriod ?? "—"}
                                </p>
                              </div>
                              <div>
                                <h4 className={styles.portfolioExpandTitle}>Insurance &amp; warranty</h4>
                                <p style={{ color: expiryTone(p.insuranceExpiryFlag) }}>
                                  <strong>Insurance:</strong> {p.insuranceExpiration || "—"}
                                  {p.insuranceExpiryFlag === "expired"
                                    ? " (expired)"
                                    : p.insuranceExpiryFlag === "expiring90"
                                      ? " (≤90 days)"
                                      : ""}
                                </p>
                                <p style={{ color: expiryTone(p.warrantyExpiryFlag) }}>
                                  <strong>Warranty:</strong> {p.homeWarrantyExpiration || "—"}
                                  {p.warrantyExpiryFlag === "expired"
                                    ? " (expired)"
                                    : p.warrantyExpiryFlag === "expiring90"
                                      ? " (≤90 days)"
                                      : ""}
                                </p>
                              </div>
                            </div>
                            <h4 className={styles.portfolioExpandTitle}>Open work orders</h4>
                            {(p.expandDetails.openWorkOrdersList ?? []).length === 0 ? (
                              <p style={{ color: GREY }}>None.</p>
                            ) : (
                              <ul className={styles.portfolioWoList}>
                                {(p.expandDetails.openWorkOrdersList ?? []).map((w) => (
                                  <li key={`${w.workOrderNumber}-${w.createdAt}`}>
                                    <strong>{w.workOrderNumber}</strong> · {w.status} · {w.issue} · {w.vendor} ·{" "}
                                    {w.createdAt}
                                  </li>
                                ))}
                              </ul>
                            )}
                            <h4 className={styles.portfolioExpandTitle}>Delinquent tenants</h4>
                            {(p.expandDetails.delinquentTenants ?? []).length === 0 ? (
                              <p style={{ color: GREY }}>None.</p>
                            ) : (
                              <ul className={styles.portfolioWoList}>
                                {(p.expandDetails.delinquentTenants ?? []).map((t, i) => (
                                  <li key={`${t.name}-${i}`}>
                                    {t.name} · Unit {t.unit} · {fmtMoney(t.amount)}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className={styles.maintCardOnly}>
          {filteredSortedProps.map((p) => {
            const key = String(p.propertyId);
            const ob = occBadge(p.occupancy);
            const open = expandedProp === key;
            return (
              <div key={key} className={styles.maintMobileCard}>
                <strong>{p.propertyName}</strong>
                <div>
                  {p.city}, {p.state} · {typeAbbr(p.propertyType)} · {p.units} units
                </div>
                <span className={styles.statusBadge} style={{ background: ob.bg, color: ob.color }}>
                  {ob.label}
                </span>
                <div>
                  Mkt {p.marketRent ? `$${p.marketRent}` : "—"} · Mgmt {p.managementFeePercent ?? "—"}% · WOs{" "}
                  {p.openWorkOrders}
                </div>
                <div style={{ color: p.delinquency > 0 ? RED : GREY }}>Delinq {fmtMoney(p.delinquency)}</div>
                <button
                  type="button"
                  className={styles.rowBtn}
                  onClick={() => setExpandedProp((e) => (e === key ? null : key))}
                >
                  {open ? "Hide details" : "Details"}
                </button>
                {open && p.expandDetails ? (
                  <div className={styles.maintExpand}>
                    <p>
                      <strong>Owner:</strong> {p.owners ?? "—"}
                    </p>
                    <p style={{ color: expiryTone(p.insuranceExpiryFlag) }}>
                      Insurance {p.insuranceExpiration || "—"} · Warranty {p.homeWarrantyExpiration || "—"}
                    </p>
                    <p>
                      <strong>Open WOs:</strong> {(p.expandDetails.openWorkOrdersList ?? []).length} ·{" "}
                      <strong>Delinq tenants:</strong> {(p.expandDetails.delinquentTenants ?? []).length}
                    </p>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <details className={styles.portfolioOwnerDetails}>
        <summary className={styles.portfolioOwnerSummary}>Owner directory</summary>
        <div className={styles.tableSearch} style={{ marginTop: "0.75rem" }}>
          <input
            type="search"
            placeholder="Search owner name or email…"
            value={ownerSearch}
            onChange={(e) => setOwnerSearch(e.target.value)}
            aria-label="Search owners"
          />
        </div>
        <div className={`${styles.tableWrap} ${styles.maintTableDesktop}`}>
          <table className={`${styles.table} ${styles.maintVendorTable}`}>
            <thead>
              <tr>
                <th onClick={() => toggleOwnerSort("name")}>Name</th>
                <th onClick={() => toggleOwnerSort("email")}>Email</th>
                <th>Phone</th>
                <th onClick={() => toggleOwnerSort("propertyCount")}>Properties</th>
                <th onClick={() => toggleOwnerSort("lastPaymentDate")}>Last payment</th>
              </tr>
            </thead>
            <tbody>
              {filteredSortedOwners.map((o) => {
                const oid = o.ownerId;
                const open = expandedOwner === oid;
                return (
                  <Fragment key={String(oid)}>
                    <tr className={open ? styles.maintRowOpen : undefined}>
                      <td>
                        <button
                          type="button"
                          className={styles.rowBtn}
                          onClick={() => setExpandedOwner((e) => (e === oid ? null : oid))}
                        >
                          {o.name}
                        </button>
                      </td>
                      <td>{o.email || "—"}</td>
                      <td>{o.phone || "—"}</td>
                      <td>{o.propertyCount}</td>
                      <td>{o.lastPaymentDate || "—"}</td>
                    </tr>
                    {open ? (
                      <tr className={styles.expandRow}>
                        <td colSpan={5}>
                          <div className={styles.portfolioExpand}>
                            <p style={{ fontSize: "0.85rem", color: GREY }}>{o.propertiesOwned}</p>
                            {o.tags ? (
                              <p>
                                <strong>Tags:</strong> {o.tags}
                              </p>
                            ) : null}
                            {(o.ownershipLines ?? []).length > 0 ? (
                              <ul className={styles.portfolioWoList}>
                                {(o.ownershipLines ?? []).map((l) => (
                                  <li key={l.propertyName}>
                                    {l.propertyName} ({l.ownershipPercent})
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className={styles.maintCardOnly}>
          {filteredSortedOwners.map((o) => (
            <div key={String(o.ownerId)} className={styles.maintMobileCard}>
              <strong>{o.name}</strong>
              <div>{o.email}</div>
              <div>
                {o.phone} · {o.propertyCount} props · Last {o.lastPaymentDate || "—"}
              </div>
            </div>
          ))}
        </div>
      </details>
    </>
  );
}
