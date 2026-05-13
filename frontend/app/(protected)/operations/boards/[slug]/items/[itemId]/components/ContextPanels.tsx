"use client";

import styles from "./detail.module.css";
import type { ItemContext } from "@/types/mb";

function syncedAgo(iso: string | null | undefined): string {
  if (!iso) return "Never synced";
  const d = new Date(iso);
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (min < 1) return "Synced just now";
  if (min < 60) return `Last synced ${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `Last synced ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Last synced ${days}d ago`;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === "") return null;
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={styles.fieldValue}>{value}</span>
    </div>
  );
}

export function TenantContextPanel({ context }: { context: ItemContext | null }) {
  if (!context) {
    return (
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>Tenant</h3>
        <div className={styles.notLinked}>Loading…</div>
      </div>
    );
  }
  const t = context.tenant;
  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>
        Tenant
        <span className={styles.cardSubtle}>{syncedAgo(t.synced_at)}</span>
      </h3>
      {!t.linked ? (
        <>
          <div className={styles.notLinked}>
            Not yet linked to AppFolio. Showing the tenant text saved on this item:
          </div>
          <div style={{ marginTop: "0.5rem" }}>
            <Field label="Tenant" value={t.name} />
          </div>
        </>
      ) : (
        <>
          <Field label="Name" value={t.name} />
          <Field label="Phone" value={t.phone} />
          <Field label="Email" value={t.email} />
          <Field
            label="Lease term"
            value={
              t.lease_from || t.lease_to
                ? `${t.lease_from ?? "?"} — ${t.lease_to ?? "?"}`
                : null
            }
          />
          <Field label="Rent" value={t.rent != null ? `$${t.rent}` : null} />
          <Field
            label="Balance"
            value={
              t.balance != null && t.balance !== "0" && t.balance !== 0
                ? `$${t.balance}`
                : null
            }
          />
        </>
      )}
    </div>
  );
}

export function PropertyContextPanel({ context }: { context: ItemContext | null }) {
  if (!context) {
    return (
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>Property</h3>
        <div className={styles.notLinked}>Loading…</div>
      </div>
    );
  }
  const p = context.property;
  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>
        Property
        <span className={styles.cardSubtle}>{syncedAgo(p.synced_at)}</span>
      </h3>
      {!p.linked ? (
        <>
          <div className={styles.notLinked}>
            Not yet linked to AppFolio. Showing the property text saved on this item:
          </div>
          <div style={{ marginTop: "0.5rem" }}>
            <Field label="Property" value={p.address} />
          </div>
        </>
      ) : (
        <>
          <Field
            label="Address"
            value={
              p.address
                ? `${p.address}${p.city ? `, ${p.city}` : ""}${p.state ? `, ${p.state}` : ""}`
                : null
            }
          />
          <Field label="Type" value={p.property_type} />
          <Field label="Owner" value={p.owner_name} />
          <Field label="Owner phone" value={p.owner_phone} />
          <Field label="Owner email" value={p.owner_email} />
          <Field label="Total units" value={p.unit_count} />
          <Field
            label="Occupancy"
            value={
              p.occupied_count != null && p.unit_count != null
                ? `${p.occupied_count} / ${p.unit_count}`
                : null
            }
          />
        </>
      )}
    </div>
  );
}
