"use client";

import { type ReactNode } from "react";
import Link from "next/link";
import { TIER_META, type Agent, type Tier, relativeTime } from "../../../lib/agentHub";
import styles from "./agentHub.module.css";

export function TierBadge({ tier }: { tier: Tier }) {
  const meta = TIER_META[tier];
  return (
    <span className={styles.tierBadge} style={{ background: meta.bg, color: meta.fg }}>
      {meta.label}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  const cls = status === "dnc" ? styles.dnc : status === "active" ? styles.active : "";
  return <span className={`${styles.statusPill} ${cls}`}>{status}</span>;
}

export function Avatar({ agent, size = 48 }: { agent: { full_name: string; photo_url?: string | null }; size?: number }) {
  if (agent.photo_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={agent.photo_url}
        alt={agent.full_name}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
      />
    );
  }
  const parts = agent.full_name.split(/\s+/).filter(Boolean);
  const initials = (parts[0]?.[0] || "?") + (parts[1]?.[0] || "");
  return (
    <div
      className={`${styles.avatar}${size <= 36 ? ` ${styles.avatarSm}` : ""}`}
      style={size !== 48 && size > 36 ? { width: size, height: size, fontSize: size * 0.4 } : undefined}
      aria-hidden
    >
      {initials.toUpperCase()}
    </div>
  );
}

export function StatCard({
  label,
  value,
  href,
  highlight,
}: {
  label: string;
  value: number | string;
  href?: string;
  highlight?: boolean;
}) {
  const inner = (
    <>
      <div className={styles.statValue} style={highlight ? { color: "#b91c1c" } : undefined}>
        {value}
      </div>
      <div className={styles.statLabel}>{label}</div>
    </>
  );
  if (href) {
    return (
      <Link href={href} className={styles.statCard} style={{ display: "block", textDecoration: "none", color: "inherit" }}>
        {inner}
      </Link>
    );
  }
  return <div className={styles.statCard}>{inner}</div>;
}

export function Toast({
  message,
  variant = "ok",
  onDismiss,
}: {
  message: string;
  variant?: "ok" | "error";
  onDismiss?: () => void;
}) {
  return (
    <div
      className={`${styles.toast}${variant === "error" ? ` ${styles.toastError}` : ""}`}
      onClick={onDismiss}
      role="status"
    >
      {message}
    </div>
  );
}

export function AgentRowSummary({ agent, lastInteraction }: { agent: Pick<Agent, "id" | "full_name" | "tier" | "brokerage_name" | "photo_url">; lastInteraction?: string | null }) {
  return (
    <Link href={`/agent-hub/agents/${agent.id}`} className={styles.row} style={{ textDecoration: "none", color: "inherit", padding: "0.4rem 0" }}>
      <Avatar agent={{ full_name: agent.full_name, photo_url: agent.photo_url }} size={36} />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 500, color: "#1b2856" }}>{agent.full_name}</div>
        <div className={styles.muted} style={{ fontSize: "0.78rem" }}>
          {agent.brokerage_name || "—"}
          {lastInteraction ? ` · ${relativeTime(lastInteraction)}` : null}
        </div>
      </div>
      <TierBadge tier={agent.tier} />
    </Link>
  );
}

export function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className={styles.label}>{label}</label>
      {children}
    </div>
  );
}
