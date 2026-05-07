"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../context/AuthContext";
import { agentHubFetch, type HubPermissions, type SystemConfig } from "../../../../lib/agentHub";
import AgentHubGate from "../AgentHubGate";
import { FieldGroup, Toast } from "../components";
import styles from "../agentHub.module.css";

function SystemConfigInner({ perms }: { perms: HubPermissions }) {
  const { authHeaders, token } = useAuth();
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [draft, setDraft] = useState<Partial<SystemConfig>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [killReason, setKillReason] = useState("");
  const [toast, setToast] = useState<{ msg: string; variant: "ok" | "error" } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  async function load() {
    try {
      const body = await agentHubFetch<{ config: SystemConfig }>("/agent-hub/system-config", { authHeaders: authHeaders() });
      setConfig(body.config);
      setDraft(body.config);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (token) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function save() {
    setBusy(true);
    try {
      const body = await agentHubFetch<{ config: SystemConfig }>("/agent-hub/system-config", {
        method: "PATCH",
        authHeaders: authHeaders(),
        body: JSON.stringify({
          default_sender_email: draft.default_sender_email,
          default_sender_name: draft.default_sender_name,
          physical_address: draft.physical_address,
          referral_fee_offer_text: draft.referral_fee_offer_text,
          referral_fee_landing_url: draft.referral_fee_landing_url,
          rate_limit_emails_per_hour: draft.rate_limit_emails_per_hour,
          rate_limit_emails_per_day: draft.rate_limit_emails_per_day,
          rate_limit_sms_per_hour: draft.rate_limit_sms_per_hour,
          rate_limit_sms_per_day: draft.rate_limit_sms_per_day,
        }),
      });
      setConfig(body.config);
      setDraft(body.config);
      setToast({ msg: "Saved.", variant: "ok" });
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Save failed.", variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function toggleKill(engaged: boolean) {
    if (engaged && !killReason.trim()) {
      setToast({ msg: "Provide a reason before engaging.", variant: "error" });
      return;
    }
    if (engaged && !confirm("Engage kill switch? All sends will pause until released.")) return;
    setBusy(true);
    try {
      const body = await agentHubFetch<{ config: SystemConfig }>("/agent-hub/system-config/kill-switch", {
        method: "POST",
        authHeaders: authHeaders(),
        body: JSON.stringify({ engaged, reason: killReason || undefined }),
      });
      setConfig(body.config);
      setDraft(body.config);
      setKillReason("");
      setToast({ msg: engaged ? "Kill switch ENGAGED." : "Kill switch released.", variant: "ok" });
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Failed.", variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function completeChecklist() {
    if (!confirm("Mark launch checklist complete? Automations can be enabled after this.")) return;
    setBusy(true);
    try {
      const body = await agentHubFetch<{ config: SystemConfig }>("/agent-hub/system-config/complete-launch-checklist", {
        method: "POST",
        authHeaders: authHeaders(),
      });
      setConfig(body.config);
      setDraft(body.config);
      setToast({ msg: "Launch checklist complete.", variant: "ok" });
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Failed.", variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className={styles.shell}><div className={styles.muted}>Loading…</div></div>;
  if (!config) return null;

  const isOwner = perms.role === "owner";
  const isManager = isOwner || perms.role === "manager";

  if (!isManager) {
    return (
      <div className={styles.shell}>
        <div className={styles.card}>
          <h2 className={styles.pageTitle}>Forbidden</h2>
          <p className={styles.muted}>Owner or manager role required.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>System Config</h1>
          <p className={styles.pageSubtitle}>Sender, rate limits, kill switch, launch checklist.</p>
        </div>
      </div>

      <div className={styles.card} style={{ marginBottom: "1rem", background: config.kill_switch_enabled ? "#fee2e2" : "#fff" }}>
        <div className={styles.cardTitle}>
          🔴 Kill switch {config.kill_switch_enabled ? "(ENGAGED)" : "(OFF)"}
        </div>
        {config.kill_switch_enabled ? (
          <div style={{ marginBottom: "0.6rem" }}>
            <strong>Reason:</strong> {config.kill_switch_reason || "(not specified)"}
          </div>
        ) : null}
        {isOwner ? (
          <>
            {!config.kill_switch_enabled ? (
              <FieldGroup label="Reason (required to engage)">
                <input className={styles.input} value={killReason} onChange={(e) => setKillReason(e.target.value)} placeholder="Why are we pausing?" />
              </FieldGroup>
            ) : null}
            <button
              className={`${styles.btn} ${config.kill_switch_enabled ? styles.btnPrimary : styles.btnDanger}`}
              onClick={() => toggleKill(!config.kill_switch_enabled)}
              disabled={busy}
            >
              {config.kill_switch_enabled ? "Release kill switch" : "Engage kill switch"}
            </button>
          </>
        ) : (
          <div className={styles.muted}>Owner only.</div>
        )}
      </div>

      <div className={styles.card} style={{ marginBottom: "1rem", background: config.launch_checklist_complete ? "#d1fae5" : "#fef3c7" }}>
        <div className={styles.cardTitle}>
          {config.launch_checklist_complete ? "✅" : "⏳"} Launch Checklist
        </div>
        <p style={{ fontSize: "0.9rem" }}>
          Until this is complete, the engine refuses to flip any automation to enabled=true.
        </p>
        {!config.launch_checklist_complete ? (
          <ul style={{ fontSize: "0.85rem" }}>
            <li>Sender email + name + physical_address configured: {config.default_sender_email && config.physical_address ? "✓" : "❌"}</li>
            <li>Referral fee offer text set: {config.referral_fee_offer_text ? "✓" : "❌"}</li>
            <li>At least one template previewed</li>
            <li>At least one test send completed</li>
            <li>Kill switch tested (engage / release)</li>
            <li>Reply detector tested</li>
            <li>Unsubscribe flow tested</li>
            <li>Approval queue reviewed</li>
            <li>Each starter automation simulated</li>
            <li>DNC suppression verified</li>
          </ul>
        ) : (
          <div className={styles.muted} style={{ fontSize: "0.85rem" }}>
            Completed at: {config.launch_checklist_completed_at}
          </div>
        )}
        {isOwner && !config.launch_checklist_complete ? (
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={completeChecklist} disabled={busy}>
            Mark complete
          </button>
        ) : null}
      </div>

      <div className={styles.card}>
        <div className={styles.cardTitle}>Sender + content config</div>
        <div className={styles.gridTwo}>
          <FieldGroup label="Default sender email">
            <input className={styles.input} value={draft.default_sender_email || ""} onChange={(e) => setDraft({ ...draft, default_sender_email: e.target.value })} />
          </FieldGroup>
          <FieldGroup label="Default sender name">
            <input className={styles.input} value={draft.default_sender_name || ""} onChange={(e) => setDraft({ ...draft, default_sender_name: e.target.value })} />
          </FieldGroup>
        </div>
        <FieldGroup label="Physical address (CAN-SPAM footer)">
          <textarea className={styles.textarea} rows={3} value={draft.physical_address || ""} onChange={(e) => setDraft({ ...draft, physical_address: e.target.value })} />
        </FieldGroup>
        <FieldGroup label="Referral fee offer text (used in templates)">
          <input className={styles.input} value={draft.referral_fee_offer_text || ""} onChange={(e) => setDraft({ ...draft, referral_fee_offer_text: e.target.value })} placeholder='e.g. "25% of first month management fee"' />
        </FieldGroup>
        <FieldGroup label="Referral fee landing page URL">
          <input className={styles.input} value={draft.referral_fee_landing_url || ""} onChange={(e) => setDraft({ ...draft, referral_fee_landing_url: e.target.value })} />
        </FieldGroup>

        <div className={styles.cardTitle} style={{ marginTop: "1rem" }}>Rate limits</div>
        <div className={styles.gridTwo}>
          <FieldGroup label="Emails per hour">
            <input type="number" className={styles.input} value={draft.rate_limit_emails_per_hour ?? 0} onChange={(e) => setDraft({ ...draft, rate_limit_emails_per_hour: Number(e.target.value) })} />
          </FieldGroup>
          <FieldGroup label="Emails per day">
            <input type="number" className={styles.input} value={draft.rate_limit_emails_per_day ?? 0} onChange={(e) => setDraft({ ...draft, rate_limit_emails_per_day: Number(e.target.value) })} />
          </FieldGroup>
          <FieldGroup label="SMS per hour">
            <input type="number" className={styles.input} value={draft.rate_limit_sms_per_hour ?? 0} onChange={(e) => setDraft({ ...draft, rate_limit_sms_per_hour: Number(e.target.value) })} />
          </FieldGroup>
          <FieldGroup label="SMS per day">
            <input type="number" className={styles.input} value={draft.rate_limit_sms_per_day ?? 0} onChange={(e) => setDraft({ ...draft, rate_limit_sms_per_day: Number(e.target.value) })} />
          </FieldGroup>
        </div>

        <div style={{ marginTop: "0.8rem", display: "flex", justifyContent: "flex-end" }}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {toast ? <Toast message={toast.msg} variant={toast.variant} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}

export default function SystemConfigPage() {
  return <AgentHubGate>{(perms) => <SystemConfigInner perms={perms} />}</AgentHubGate>;
}
