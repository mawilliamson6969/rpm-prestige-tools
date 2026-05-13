"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../../../../context/AuthContext";
import {
  agentHubFetch,
  type Agent,
  type Brokerage,
  type HubPermissions,
} from "../../../../../lib/agentHub";
import AgentHubGate from "../../AgentHubGate";
import { FieldGroup, Toast } from "../../components";
import styles from "../../agentHub.module.css";

type Tab = "manual" | "quick";

const EMPTY_FORM = {
  full_name: "",
  preferred_name: "",
  email: "",
  phone_mobile: "",
  phone_office: "",
  brokerage_id: "",
  brokerage_name: "",
  license_number: "",
  license_state: "TX",
  mls_id: "",
  niche: "",
  source: "manual",
  source_detail: "",
  notes: "",
  tier: "cold",
  preferred_channel: "",
  consent_to_email: false,
  consent_to_sms: false,
};

function NewAgentInner({ perms }: { perms: HubPermissions }) {
  const { authHeaders, token } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("quick");
  const [form, setForm] = useState(EMPTY_FORM);
  const [brokerages, setBrokerages] = useState<Brokerage[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ msg: string; variant: "ok" | "error" } | null>(null);
  const [showNewBrokerage, setShowNewBrokerage] = useState(false);
  const [newBrokerage, setNewBrokerage] = useState({ name: "", city: "", state: "TX" });

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const b = await agentHubFetch<{ brokerages: Brokerage[] }>("/agent-hub/brokerages", {
          authHeaders: authHeaders(),
        });
        setBrokerages(b.brokerages);
      } catch {
        // Non-fatal
      }
    })();
  }, [token, authHeaders]);

  async function createBrokerageInline() {
    if (!newBrokerage.name.trim()) return;
    try {
      const body = await agentHubFetch<{ brokerage: Brokerage }>("/agent-hub/brokerages", {
        method: "POST",
        authHeaders: authHeaders(),
        body: JSON.stringify(newBrokerage),
      });
      setBrokerages((prev) => [...prev, body.brokerage]);
      setForm((f) => ({ ...f, brokerage_id: String(body.brokerage.id), brokerage_name: body.brokerage.name }));
      setShowNewBrokerage(false);
      setNewBrokerage({ name: "", city: "", state: "TX" });
      setToast({ msg: `Created brokerage ${body.brokerage.name}.`, variant: "ok" });
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Could not create brokerage.", variant: "error" });
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.full_name.trim()) {
      setToast({ msg: "Full name is required.", variant: "error" });
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        full_name: form.full_name.trim(),
        preferred_name: form.preferred_name.trim() || undefined,
        email: form.email.trim() || undefined,
        phone_mobile: form.phone_mobile.trim() || undefined,
        phone_office: form.phone_office.trim() || undefined,
        license_number: form.license_number.trim() || undefined,
        license_state: form.license_state.trim() || "TX",
        mls_id: form.mls_id.trim() || undefined,
        niche: form.niche || undefined,
        source: form.source || undefined,
        source_detail: form.source_detail.trim() || undefined,
        notes: form.notes.trim() || undefined,
        tier: perms.can_change_tier ? form.tier : undefined,
        preferred_channel: form.preferred_channel || undefined,
        consent_to_email: form.consent_to_email,
        consent_to_sms: form.consent_to_sms,
      };
      if (form.brokerage_id) payload.brokerage_id = Number(form.brokerage_id);
      const body = await agentHubFetch<{ agent: Agent; duplicate_warnings?: { kind: string; matches: { id: number; full_name: string; brokerage_name: string | null }[] }[] }>(
        "/agent-hub/agents",
        {
          method: "POST",
          authHeaders: authHeaders(),
          body: JSON.stringify(payload),
        }
      );
      if (body.duplicate_warnings && body.duplicate_warnings.length) {
        const dup = body.duplicate_warnings[0];
        const first = dup.matches[0];
        const ok = confirm(
          `Possible duplicate: ${first.full_name} at ${first.brokerage_name || "—"} (${dup.kind}). Continue to the new agent's page anyway?`
        );
        if (!ok) {
          // Soft warning — already created. Send them to the duplicate.
          router.push(`/agent-hub/agents/${first.id}`);
          return;
        }
      }
      router.push(`/agent-hub/agents/${body.agent.id}`);
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Could not create agent.", variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.shell}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Add Agent</h1>
          <p className={styles.pageSubtitle}>
            <Link href="/agent-hub/agents" className={styles.muted}>← Back to agents</Link>
          </p>
        </div>
      </div>

      <div className={styles.row} style={{ marginBottom: "0.75rem", gap: "0.3rem" }}>
        <button
          className={`${styles.btn} ${tab === "quick" ? styles.btnPrimary : ""}`}
          onClick={() => setTab("quick")}
          type="button"
        >
          Quick add
        </button>
        <button
          className={`${styles.btn} ${tab === "manual" ? styles.btnPrimary : ""}`}
          onClick={() => setTab("manual")}
          type="button"
        >
          Full form
        </button>
      </div>

      <form onSubmit={submit} className={styles.card}>
        <div className={tab === "manual" ? styles.gridTwo : styles.flexCol}>
          <FieldGroup label="Full name *">
            <input
              className={styles.input}
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              autoFocus
              required
            />
          </FieldGroup>
          {tab === "manual" ? (
            <FieldGroup label="Preferred name (what they go by)">
              <input
                className={styles.input}
                value={form.preferred_name}
                onChange={(e) => setForm({ ...form, preferred_name: e.target.value })}
              />
            </FieldGroup>
          ) : null}

          <FieldGroup label="Brokerage">
            <div className={styles.row}>
              <select
                className={styles.select}
                value={form.brokerage_id}
                onChange={(e) => {
                  const id = e.target.value;
                  const b = brokerages.find((x) => String(x.id) === id);
                  setForm({ ...form, brokerage_id: id, brokerage_name: b?.name || "" });
                }}
              >
                <option value="">— None —</option>
                {brokerages.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}{b.city ? ` (${b.city})` : ""}
                  </option>
                ))}
              </select>
              <button type="button" className={styles.btnGhost} onClick={() => setShowNewBrokerage((v) => !v)}>
                {showNewBrokerage ? "Cancel" : "+ New"}
              </button>
            </div>
            {showNewBrokerage ? (
              <div style={{ marginTop: "0.5rem", padding: "0.5rem", background: "#f9fafb", borderRadius: 8 }}>
                <input
                  className={styles.input}
                  placeholder="Brokerage name"
                  value={newBrokerage.name}
                  onChange={(e) => setNewBrokerage({ ...newBrokerage, name: e.target.value })}
                  style={{ marginBottom: "0.4rem" }}
                />
                <div className={styles.row}>
                  <input
                    className={styles.input}
                    placeholder="City"
                    value={newBrokerage.city}
                    onChange={(e) => setNewBrokerage({ ...newBrokerage, city: e.target.value })}
                  />
                  <input
                    className={styles.input}
                    placeholder="State"
                    value={newBrokerage.state}
                    onChange={(e) => setNewBrokerage({ ...newBrokerage, state: e.target.value })}
                    style={{ width: 80 }}
                  />
                  <button type="button" className={styles.btnPrimary + " " + styles.btn} onClick={createBrokerageInline}>
                    Create
                  </button>
                </div>
              </div>
            ) : null}
          </FieldGroup>

          <FieldGroup label="Email">
            <input
              className={styles.input}
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </FieldGroup>

          <FieldGroup label="Mobile phone">
            <input
              className={styles.input}
              value={form.phone_mobile}
              onChange={(e) => setForm({ ...form, phone_mobile: e.target.value })}
              placeholder="+1 832 555 1234"
            />
          </FieldGroup>

          {tab === "manual" ? (
            <>
              <FieldGroup label="Office phone">
                <input
                  className={styles.input}
                  value={form.phone_office}
                  onChange={(e) => setForm({ ...form, phone_office: e.target.value })}
                />
              </FieldGroup>
              <FieldGroup label="License number">
                <input
                  className={styles.input}
                  value={form.license_number}
                  onChange={(e) => setForm({ ...form, license_number: e.target.value })}
                />
              </FieldGroup>
              <FieldGroup label="License state">
                <input
                  className={styles.input}
                  value={form.license_state}
                  onChange={(e) => setForm({ ...form, license_state: e.target.value })}
                  maxLength={2}
                />
              </FieldGroup>
              <FieldGroup label="MLS ID">
                <input
                  className={styles.input}
                  value={form.mls_id}
                  onChange={(e) => setForm({ ...form, mls_id: e.target.value })}
                />
              </FieldGroup>
              <FieldGroup label="Niche">
                <select
                  className={styles.select}
                  value={form.niche}
                  onChange={(e) => setForm({ ...form, niche: e.target.value })}
                >
                  <option value="">—</option>
                  <option value="luxury">Luxury</option>
                  <option value="first_time">First-time buyers</option>
                  <option value="investor">Investor</option>
                  <option value="leases">Leases</option>
                  <option value="relocation">Relocation</option>
                  <option value="multi">Multi</option>
                  <option value="other">Other</option>
                </select>
              </FieldGroup>
              <FieldGroup label="Preferred channel">
                <select
                  className={styles.select}
                  value={form.preferred_channel}
                  onChange={(e) => setForm({ ...form, preferred_channel: e.target.value })}
                >
                  <option value="">—</option>
                  <option value="email">Email</option>
                  <option value="text">Text</option>
                  <option value="call">Call</option>
                  <option value="mail">Mail</option>
                </select>
              </FieldGroup>
            </>
          ) : null}

          {perms.can_change_tier ? (
            <FieldGroup label="Tier">
              <select
                className={styles.select}
                value={form.tier}
                onChange={(e) => setForm({ ...form, tier: e.target.value })}
              >
                <option value="cold">Cold</option>
                <option value="prospect">Prospect</option>
                <option value="warm">Warm</option>
                <option value="partner">Partner</option>
                <option value="vip">VIP</option>
                <option value="dormant">Dormant</option>
              </select>
            </FieldGroup>
          ) : null}

          <FieldGroup label="Source">
            <select
              className={styles.select}
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
            >
              <option value="manual">Manual entry</option>
              <option value="event">Event / mixer</option>
              <option value="referral_from_agent">Referral from another agent</option>
              <option value="linkedin">LinkedIn</option>
              <option value="website_form">Website form</option>
              <option value="mls_listing">MLS listing</option>
              <option value="other">Other</option>
            </select>
          </FieldGroup>

          {tab === "manual" ? (
            <FieldGroup label="Source detail (optional)">
              <input
                className={styles.input}
                value={form.source_detail}
                onChange={(e) => setForm({ ...form, source_detail: e.target.value })}
                placeholder="HAR mixer Oct 2024"
              />
            </FieldGroup>
          ) : null}
        </div>

        {tab === "manual" ? (
          <div style={{ marginTop: "1rem" }}>
            <FieldGroup label="Notes">
              <textarea
                className={styles.textarea}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </FieldGroup>
          </div>
        ) : null}

        <div style={{ marginTop: "1rem", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={form.consent_to_email}
              onChange={(e) => setForm({ ...form, consent_to_email: e.target.checked })}
            />
            Consent to email
          </label>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={form.consent_to_sms}
              onChange={(e) => setForm({ ...form, consent_to_sms: e.target.checked })}
            />
            Consent to SMS
          </label>
        </div>

        <div style={{ marginTop: "1.25rem", display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
          <Link href="/agent-hub/agents" className={styles.btnGhost + " " + styles.btn}>Cancel</Link>
          <button type="submit" className={styles.btnPrimary + " " + styles.btn} disabled={busy}>
            {busy ? "Creating…" : tab === "quick" ? "Quick create" : "Create agent"}
          </button>
        </div>
      </form>

      {toast ? <Toast message={toast.msg} variant={toast.variant} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}

export default function AgentHubAddAgentPage() {
  return <AgentHubGate>{(perms) => <NewAgentInner perms={perms} />}</AgentHubGate>;
}
