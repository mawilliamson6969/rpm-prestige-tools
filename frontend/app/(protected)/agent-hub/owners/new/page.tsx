"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "../../../../../context/AuthContext";
import { agentHubFetch, type HubPermissions, type Owner } from "../../../../../lib/agentHub";
import AgentHubGate from "../../AgentHubGate";
import { FieldGroup, Toast } from "../../components";
import styles from "../../agentHub.module.css";

function NewOwnerInner({ perms }: { perms: HubPermissions }) {
  const router = useRouter();
  const { authHeaders } = useAuth();
  const [form, setForm] = useState({
    full_name: "",
    first_name: "",
    last_name: "",
    email: "",
    phone_mobile: "",
    phone_office: "",
    is_company: false,
    company_name: "",
    mailing_address_1: "",
    mailing_address_2: "",
    city: "",
    state: "TX",
    zip: "",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ msg: string; variant: "ok" | "error" } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.full_name.trim()) {
      setToast({ msg: "full_name is required.", variant: "error" });
      return;
    }
    setBusy(true);
    try {
      const body = await agentHubFetch<{ owner: Owner }>("/agent-hub/owners", {
        method: "POST",
        authHeaders: authHeaders(),
        body: JSON.stringify(form),
      });
      router.push(`/agent-hub/owners/${body.owner.id}`);
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Failed.", variant: "error" });
      setBusy(false);
    }
  }

  return (
    <div className={styles.shell}>
      <Link href="/agent-hub/owners" className={styles.muted} style={{ fontSize: "0.85rem", display: "inline-block", marginBottom: "0.5rem" }}>
        ← Owners
      </Link>
      <h1 className={styles.pageTitle}>Add Owner</h1>

      <form onSubmit={submit} className={styles.card} style={{ marginTop: "1rem" }}>
        <div className={styles.gridTwo}>
          <FieldGroup label="Full name *">
            <input className={styles.input} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required autoFocus />
          </FieldGroup>
          <FieldGroup label="Email">
            <input className={styles.input} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </FieldGroup>
          <FieldGroup label="Mobile">
            <input className={styles.input} value={form.phone_mobile} onChange={(e) => setForm({ ...form, phone_mobile: e.target.value })} />
          </FieldGroup>
          <FieldGroup label="Office phone">
            <input className={styles.input} value={form.phone_office} onChange={(e) => setForm({ ...form, phone_office: e.target.value })} />
          </FieldGroup>
        </div>
        <label className={styles.checkboxLabel} style={{ marginTop: "0.5rem" }}>
          <input
            type="checkbox"
            checked={form.is_company}
            onChange={(e) => setForm({ ...form, is_company: e.target.checked })}
          />
          This is a company / LLC
        </label>
        {form.is_company ? (
          <FieldGroup label="Company name">
            <input className={styles.input} value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} />
          </FieldGroup>
        ) : null}

        <h3 style={{ marginTop: "1rem", fontSize: "0.95rem" }}>Mailing address</h3>
        <FieldGroup label="Address line 1">
          <input className={styles.input} value={form.mailing_address_1} onChange={(e) => setForm({ ...form, mailing_address_1: e.target.value })} />
        </FieldGroup>
        <FieldGroup label="Address line 2">
          <input className={styles.input} value={form.mailing_address_2} onChange={(e) => setForm({ ...form, mailing_address_2: e.target.value })} />
        </FieldGroup>
        <div className={styles.gridTwo}>
          <FieldGroup label="City">
            <input className={styles.input} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </FieldGroup>
          <FieldGroup label="State">
            <input className={styles.input} value={form.state} maxLength={2} onChange={(e) => setForm({ ...form, state: e.target.value })} />
          </FieldGroup>
        </div>
        <FieldGroup label="Zip">
          <input className={styles.input} value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} />
        </FieldGroup>
        <FieldGroup label="Notes">
          <textarea className={styles.textarea} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </FieldGroup>
        <div style={{ marginTop: "0.6rem", display: "flex", justifyContent: "flex-end", gap: "0.4rem" }}>
          <Link href="/agent-hub/owners" className={`${styles.btn} ${styles.btnGhost}`}>Cancel</Link>
          <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </form>

      {toast ? <Toast message={toast.msg} variant={toast.variant} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}

export default function NewOwnerPage() {
  return <AgentHubGate>{(perms) => <NewOwnerInner perms={perms} />}</AgentHubGate>;
}
