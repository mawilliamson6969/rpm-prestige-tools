"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../../../context/AuthContext";
import {
  agentHubFetch,
  daysSince,
  daysSinceColor,
  formatMoney,
  nextStages,
  PIPELINE_STAGES,
  STAGE_LABELS,
  STAGE_META,
  TIER_META,
  type HubPermissions,
  type PipelineStats,
  type Referral,
  type Stage,
} from "../../../../lib/agentHub";
import AgentHubGate from "../AgentHubGate";
import { Avatar, Toast } from "../components";
import styles from "../agentHub.module.css";

const COLUMN_STAGES: Stage[] = PIPELINE_STAGES; // 7 columns
const TERMINAL: Stage[] = ["lost", "declined"];

function PipelineInner({ perms }: { perms: HubPermissions }) {
  const { authHeaders, token } = useAuth();
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<{ agent_id: string; priority: string; zip: string }>({
    agent_id: "",
    priority: "",
    zip: "",
  });
  const [showTerminal, setShowTerminal] = useState(false);
  const [drop, setDrop] = useState<null | { referral: Referral; toStage: Stage; notes: string }>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ msg: string; variant: "ok" | "error" } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  async function load() {
    try {
      const headers = authHeaders();
      const sp = new URLSearchParams();
      if (filter.agent_id) sp.set("agent_id", filter.agent_id);
      if (filter.priority) sp.set("priority", filter.priority);
      if (filter.zip) sp.set("zip", filter.zip);
      sp.set("per_page", "300");
      const [refs, ps] = await Promise.all([
        agentHubFetch<{ referrals: Referral[] }>(`/agent-hub/referrals?${sp.toString()}`, { authHeaders: headers }),
        agentHubFetch<PipelineStats>("/agent-hub/pipeline/stats", { authHeaders: headers }),
      ]);
      setReferrals(refs.referrals);
      setStats(ps);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load pipeline.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, filter]);

  const byStage = useMemo(() => {
    const m: Record<Stage, Referral[]> = {} as Record<Stage, Referral[]>;
    for (const s of [...COLUMN_STAGES, ...TERMINAL]) m[s] = [];
    for (const r of referrals) {
      if (m[r.stage]) m[r.stage].push(r);
    }
    return m;
  }, [referrals]);

  function handleDragStart(e: React.DragEvent, ref: Referral) {
    e.dataTransfer.setData("text/plain", String(ref.id));
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function handleDrop(e: React.DragEvent, toStage: Stage) {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData("text/plain"));
    const ref = referrals.find((r) => r.id === id);
    if (!ref || ref.stage === toStage) return;
    if (toStage === "lost" || toStage === "declined") {
      setToast({ msg: `Use Mark ${toStage} on the referral detail page (reason required).`, variant: "error" });
      return;
    }
    if (!nextStages(ref.stage).includes(toStage)) {
      setToast({ msg: `Can't move from ${STAGE_LABELS[ref.stage]} → ${STAGE_LABELS[toStage]}.`, variant: "error" });
      return;
    }
    setDrop({ referral: ref, toStage, notes: "" });
  }

  async function confirmDrop() {
    if (!drop) return;
    setBusy(true);
    try {
      await agentHubFetch(`/agent-hub/referrals/${drop.referral.id}/advance-stage`, {
        method: "POST",
        authHeaders: authHeaders(),
        body: JSON.stringify({ to_stage: drop.toStage, notes: drop.notes || undefined }),
      });
      setToast({ msg: `Advanced to ${STAGE_LABELS[drop.toStage]}.`, variant: "ok" });
      setDrop(null);
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Advance failed.", variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className={styles.shell}><div className={styles.muted}>Loading…</div></div>;

  return (
    <div className={styles.shell}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Pipeline</h1>
          <p className={styles.pageSubtitle}>
            {stats ? (
              <>
                {stats.total_in_pipeline} active · expected fees {formatMoney(stats.total_expected_first_month_fees)} ·
                expected MRR {formatMoney(stats.total_expected_mrr)} ·
                conversion {stats.conversion_rate_qtr}% (this quarter)
              </>
            ) : null}
          </p>
        </div>
        <div className={styles.row}>
          <Link href="/agent-hub/referrals/new" className={`${styles.btn} ${styles.btnPrimary}`}>
            + New Referral
          </Link>
        </div>
      </div>

      <div className={styles.filterBar}>
        <input
          className={styles.input}
          placeholder="Agent ID"
          value={filter.agent_id}
          onChange={(e) => setFilter({ ...filter, agent_id: e.target.value })}
        />
        <select
          className={styles.select}
          value={filter.priority}
          onChange={(e) => setFilter({ ...filter, priority: e.target.value })}
        >
          <option value="">All priorities</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <input
          className={styles.input}
          placeholder="Zip"
          value={filter.zip}
          onChange={(e) => setFilter({ ...filter, zip: e.target.value })}
        />
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={showTerminal}
            onChange={(e) => setShowTerminal(e.target.checked)}
          />
          Show Lost / Declined
        </label>
      </div>

      {err ? <div className={styles.error}>{err}</div> : null}

      <div style={{ display: "flex", gap: "0.6rem", overflowX: "auto", paddingBottom: "1rem" }}>
        {COLUMN_STAGES.map((s) => (
          <Column
            key={s}
            stage={s}
            referrals={byStage[s] || []}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          />
        ))}
        {showTerminal
          ? TERMINAL.map((s) => (
              <Column
                key={s}
                stage={s}
                referrals={byStage[s] || []}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                terminal
              />
            ))
          : null}
      </div>

      {drop ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
          onClick={() => !busy && setDrop(null)}
        >
          <div
            className={styles.card}
            style={{ width: 480, maxWidth: "92vw" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.cardTitle}>
              Advance to {STAGE_LABELS[drop.toStage]}?
            </div>
            <div style={{ marginBottom: "0.8rem", fontSize: "0.9rem" }}>
              <strong>{drop.referral.agent_name}</strong> → {drop.referral.owner_name}
              {drop.referral.property_address ? ` · ${drop.referral.property_address}` : ""}
            </div>
            <textarea
              className={styles.textarea}
              placeholder="Notes (optional)"
              value={drop.notes}
              onChange={(e) => setDrop({ ...drop, notes: e.target.value })}
            />
            {drop.toStage === "tenant_placed" ? (
              <div className={styles.placeholderBox} style={{ marginTop: "0.6rem", textAlign: "left" }}>
                A thank-you task will be created for Mike.
              </div>
            ) : null}
            {drop.toStage === "active_management" ? (
              <div className={styles.placeholderBox} style={{ marginTop: "0.6rem", textAlign: "left" }}>
                This will mark the property under-management and convert the owner.
              </div>
            ) : null}
            <div style={{ marginTop: "0.8rem", display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
              <button className={styles.btn} onClick={() => setDrop(null)} disabled={busy}>Cancel</button>
              <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={confirmDrop} disabled={busy}>
                {busy ? "Advancing…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? <Toast message={toast.msg} variant={toast.variant} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}

function Column({
  stage,
  referrals,
  onDragStart,
  onDragOver,
  onDrop,
  terminal,
}: {
  stage: Stage;
  referrals: Referral[];
  onDragStart: (e: React.DragEvent, ref: Referral) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, stage: Stage) => void;
  terminal?: boolean;
}) {
  const meta = STAGE_META[stage];
  return (
    <div
      style={{
        flex: terminal ? "0 0 200px" : "0 0 280px",
        background: "#f9fafb",
        borderRadius: 12,
        padding: "0.6rem",
        border: "1px solid rgba(27,40,86,0.08)",
        minHeight: 400,
      }}
      onDragOver={onDragOver}
      onDrop={(e) => onDrop(e, stage)}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "0.4rem 0.2rem",
          marginBottom: "0.4rem",
          borderBottom: `2px solid ${meta.fg}`,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: "0.85rem", color: meta.fg }}>
          {STAGE_LABELS[stage]}
        </span>
        <span style={{ fontSize: "0.78rem", color: "#6a737b" }}>{referrals.length}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        {referrals.map((r) => (
          <ReferralCard key={r.id} referral={r} onDragStart={onDragStart} />
        ))}
      </div>
    </div>
  );
}

function ReferralCard({
  referral,
  onDragStart,
}: {
  referral: Referral;
  onDragStart: (e: React.DragEvent, ref: Referral) => void;
}) {
  const days = daysSince(referral.stage_changed_at);
  return (
    <Link
      href={`/agent-hub/pipeline/${referral.id}`}
      draggable
      onDragStart={(e) => onDragStart(e, referral)}
      style={{
        display: "block",
        background: "#fff",
        borderRadius: 10,
        padding: "0.6rem",
        border: "1px solid rgba(27,40,86,0.12)",
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        textDecoration: "none",
        color: "inherit",
        cursor: "grab",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.3rem" }}>
        <Avatar agent={{ full_name: referral.agent_name || "?", photo_url: referral.agent_photo_url }} size={24} />
        <span style={{ fontSize: "0.78rem", fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {referral.agent_name}
        </span>
        {referral.agent_tier ? (
          <span style={{
            fontSize: "0.6rem",
            padding: "0.05rem 0.3rem",
            borderRadius: 9999,
            background: TIER_META[referral.agent_tier].bg,
            color: TIER_META[referral.agent_tier].fg,
          }}>
            {TIER_META[referral.agent_tier].label}
          </span>
        ) : null}
      </div>
      <div style={{ fontSize: "0.85rem", fontWeight: 500, marginBottom: "0.15rem" }}>
        {referral.owner_name}
      </div>
      {referral.property_address ? (
        <div style={{ fontSize: "0.75rem", color: "#6a737b", marginBottom: "0.3rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {referral.property_address}
        </div>
      ) : null}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.75rem" }}>
        <span style={{ color: "#1b2856", fontWeight: 500 }}>
          {formatMoney(referral.expected_monthly_rent)}
        </span>
        <span style={{ color: daysSinceColor(days), fontWeight: 600 }}>
          {days}d
        </span>
      </div>
      {referral.internal_priority === "urgent" || referral.internal_priority === "high" ? (
        <div
          style={{
            marginTop: "0.3rem",
            display: "inline-block",
            padding: "0.05rem 0.35rem",
            borderRadius: 4,
            background: referral.internal_priority === "urgent" ? "#fee2e2" : "#fef3c7",
            color: referral.internal_priority === "urgent" ? "#991b1b" : "#854d0e",
            fontSize: "0.65rem",
            fontWeight: 600,
            textTransform: "uppercase",
          }}
        >
          {referral.internal_priority}
        </div>
      ) : null}
    </Link>
  );
}

export default function PipelinePage() {
  return <AgentHubGate>{(perms) => <PipelineInner perms={perms} />}</AgentHubGate>;
}
