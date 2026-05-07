"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "../../../../../context/AuthContext";
import { agentHubFetch, type Cohort, type HubPermissions } from "../../../../../lib/agentHub";
import AgentHubGate from "../../AgentHubGate";
import { FieldGroup, Toast } from "../../components";
import styles from "../../agentHub.module.css";

function NewCohortInner({ perms }: { perms: HubPermissions }) {
  const router = useRouter();
  const { authHeaders } = useAuth();
  const [form, setForm] = useState({
    name: "",
    description: "",
    added_after: "",
    added_before: "",
    tiers: [] as string[],
    target_zips: "",
    tags: "",
  });
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ msg: string; variant: "ok" | "error" } | null>(null);

  const isManager = perms.role === "owner" || perms.role === "manager";

  if (!isManager) {
    return <div className={styles.shell}><div className={styles.muted}>Manager+ only.</div></div>;
  }

  function toggleTier(t: string) {
    setForm((f) => ({
      ...f,
      tiers: f.tiers.includes(t) ? f.tiers.filter((x) => x !== t) : [...f.tiers, t],
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      const definition: Record<string, unknown> = {};
      if (form.added_after) definition.added_after = form.added_after;
      if (form.added_before) definition.added_before = form.added_before;
      if (form.tiers.length) definition.tiers = form.tiers;
      const zips = form.target_zips.split(",").map((z) => z.trim()).filter(Boolean);
      if (zips.length) definition.target_zips = zips;
      const tags = form.tags.split(",").map((t) => t.trim()).filter(Boolean);
      if (tags.length) definition.tags = tags;

      const body = await agentHubFetch<{ cohort: Cohort }>("/agent-hub/intelligence/cohorts", {
        method: "POST",
        authHeaders: authHeaders(),
        body: JSON.stringify({ name: form.name, description: form.description || undefined, definition }),
      });
      router.push(`/agent-hub/cohorts/${body.cohort.id}`);
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Failed.", variant: "error" });
      setBusy(false);
    }
  }

  return (
    <div className={styles.shell}>
      <Link href="/agent-hub/cohorts" className={styles.muted} style={{ fontSize: "0.85rem", display: "inline-block", marginBottom: "0.5rem" }}>
        ← Cohorts
      </Link>
      <h1 className={styles.pageTitle}>New Cohort</h1>

      <form onSubmit={submit} className={styles.card} style={{ marginTop: "1rem" }}>
        <FieldGroup label="Name *">
          <input className={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
        </FieldGroup>
        <FieldGroup label="Description">
          <textarea className={styles.textarea} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </FieldGroup>

        <h3 style={{ marginTop: "1rem", fontSize: "0.95rem" }}>Definition</h3>
        <p className={styles.muted} style={{ fontSize: "0.8rem" }}>
          Combined with AND. Leave blank to skip a filter.
        </p>
        <div className={styles.gridTwo}>
          <FieldGroup label="Added on or after">
            <input type="date" className={styles.input} value={form.added_after} onChange={(e) => setForm({ ...form, added_after: e.target.value })} />
          </FieldGroup>
          <FieldGroup label="Added before">
            <input type="date" className={styles.input} value={form.added_before} onChange={(e) => setForm({ ...form, added_before: e.target.value })} />
          </FieldGroup>
        </div>
        <FieldGroup label="Tiers (any of)">
          <div className={styles.row} style={{ flexWrap: "wrap", gap: "0.3rem" }}>
            {["cold", "prospect", "warm", "partner", "vip", "dormant"].map((t) => (
              <label key={t} className={styles.checkboxLabel}>
                <input type="checkbox" checked={form.tiers.includes(t)} onChange={() => toggleTier(t)} />
                {t}
              </label>
            ))}
          </div>
        </FieldGroup>
        <FieldGroup label="Target zips (comma-separated)">
          <input className={styles.input} value={form.target_zips} onChange={(e) => setForm({ ...form, target_zips: e.target.value })} placeholder="77007, 77019" />
        </FieldGroup>
        <FieldGroup label="Tags (comma-separated)">
          <input className={styles.input} value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="Heights specialist, HAR mixer" />
        </FieldGroup>

        <div style={{ marginTop: "0.8rem", display: "flex", justifyContent: "flex-end", gap: "0.4rem" }}>
          <Link href="/agent-hub/cohorts" className={`${styles.btn} ${styles.btnGhost}`}>Cancel</Link>
          <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </form>

      {toast ? <Toast message={toast.msg} variant={toast.variant} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}

export default function NewCohortPage() {
  return <AgentHubGate>{(perms) => <NewCohortInner perms={perms} />}</AgentHubGate>;
}
