"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../../../context/AuthContext";
import {
  agentHubFetch,
  formatMoney,
  type Agent,
  type HubPermissions,
  type Owner,
  type Property,
  type Referral,
} from "../../../../../lib/agentHub";
import AgentHubGate from "../../AgentHubGate";
import { Avatar, FieldGroup, Toast } from "../../components";
import styles from "../../agentHub.module.css";

type Step = 1 | 2 | 3 | 4 | 5;
const STORAGE_KEY = "rpm_agent_hub_referral_wizard";

type WizardState = {
  step: Step;
  agent: Pick<Agent, "id" | "full_name" | "brokerage_name" | "tier"> | null;
  owner: { id: number | null; full_name: string; email: string; phone_mobile: string; is_company: boolean; company_name: string };
  property: { id: number | null; address_1: string; city: string; state: string; zip: string; property_type: string; bedrooms: string; bathrooms: string };
  referral: {
    expected_monthly_rent: string;
    expected_management_fee_pct: string;
    expected_first_month_referral_fee: string;
    priority: string;
    notes: string;
    expected_close_date: string;
  };
};

const DEFAULT_REFERRAL_FEE_PCT = 25; // 25% of first-month rent times mgmt fee.

function emptyState(): WizardState {
  return {
    step: 1,
    agent: null,
    owner: { id: null, full_name: "", email: "", phone_mobile: "", is_company: false, company_name: "" },
    property: { id: null, address_1: "", city: "", state: "TX", zip: "", property_type: "", bedrooms: "", bathrooms: "" },
    referral: {
      expected_monthly_rent: "",
      expected_management_fee_pct: "8",
      expected_first_month_referral_fee: "",
      priority: "medium",
      notes: "",
      expected_close_date: "",
    },
  };
}

function WizardInner({ perms }: { perms: HubPermissions }) {
  const { authHeaders, token } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Restore from localStorage; OR seed agent_id from query string (when arriving from agent detail).
  const [state, setState] = useState<WizardState>(() => {
    if (typeof window === "undefined") return emptyState();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return { ...emptyState(), ...parsed };
      }
    } catch {
      // ignore
    }
    return emptyState();
  });

  // Persist on every state change (so navigating away and back keeps progress).
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // ignore
    }
  }, [state]);

  const queryAgentId = searchParams?.get("agent_id");
  useEffect(() => {
    if (!token || !queryAgentId || state.agent?.id) return;
    (async () => {
      try {
        const body = await agentHubFetch<{ agent: Agent }>(`/agent-hub/agents/${queryAgentId}`, {
          authHeaders: authHeaders(),
        });
        setState((s) => ({
          ...s,
          agent: {
            id: body.agent.id,
            full_name: body.agent.full_name,
            brokerage_name: body.agent.brokerage_name,
            tier: body.agent.tier,
          },
          step: 2,
        }));
      } catch {
        // non-fatal
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, queryAgentId]);

  // Auto-calculate expected_first_month_referral_fee when rent + mgmt% change
  useEffect(() => {
    const rent = Number(state.referral.expected_monthly_rent);
    const mgmt = Number(state.referral.expected_management_fee_pct);
    if (Number.isFinite(rent) && rent > 0 && Number.isFinite(mgmt) && mgmt > 0) {
      const fee = (rent * (mgmt / 100) * (DEFAULT_REFERRAL_FEE_PCT / 100));
      setState((s) => ({
        ...s,
        referral: { ...s.referral, expected_first_month_referral_fee: fee.toFixed(2) },
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.referral.expected_monthly_rent, state.referral.expected_management_fee_pct]);

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ msg: string; variant: "ok" | "error" } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  function clearWizard() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  async function submit() {
    if (!state.agent?.id) return;
    setBusy(true);
    try {
      // Step 1: ensure owner exists. Persist the id back into wizard state
      // IMMEDIATELY after creation so a retry after a later-step failure
      // doesn't create a second owner. Same for property below.
      let ownerId = state.owner.id;
      if (!ownerId) {
        const ownerBody = await agentHubFetch<{ owner: Owner }>("/agent-hub/owners", {
          method: "POST",
          authHeaders: authHeaders(),
          body: JSON.stringify({
            full_name: state.owner.full_name,
            email: state.owner.email || undefined,
            phone_mobile: state.owner.phone_mobile || undefined,
            is_company: state.owner.is_company,
            company_name: state.owner.is_company ? state.owner.company_name : undefined,
            source_agent_id: state.agent.id,
          }),
        });
        ownerId = ownerBody.owner.id;
        setState((s) => ({ ...s, owner: { ...s.owner, id: ownerId } }));
      }

      // Step 2: ensure property exists if specified.
      let propertyId = state.property.id;
      if (!propertyId && state.property.address_1.trim()) {
        const propBody = await agentHubFetch<{ property: Property }>("/agent-hub/properties", {
          method: "POST",
          authHeaders: authHeaders(),
          body: JSON.stringify({
            owner_id: ownerId,
            address_1: state.property.address_1,
            city: state.property.city,
            state: state.property.state,
            zip: state.property.zip,
            property_type: state.property.property_type || undefined,
            bedrooms: state.property.bedrooms || undefined,
            bathrooms: state.property.bathrooms || undefined,
          }),
        });
        propertyId = propBody.property.id;
        setState((s) => ({ ...s, property: { ...s.property, id: propertyId } }));
      }

      // Step 3: create referral.
      const refBody = await agentHubFetch<{ referral: Referral }>("/agent-hub/referrals", {
        method: "POST",
        authHeaders: authHeaders(),
        body: JSON.stringify({
          agent_id: state.agent.id,
          owner_id: ownerId,
          property_id: propertyId || undefined,
          expected_monthly_rent: state.referral.expected_monthly_rent || undefined,
          expected_management_fee_pct: state.referral.expected_management_fee_pct || undefined,
          expected_first_month_referral_fee: state.referral.expected_first_month_referral_fee || undefined,
          internal_priority: state.referral.priority,
          notes: state.referral.notes || undefined,
          expected_close_date: state.referral.expected_close_date || undefined,
        }),
      });
      clearWizard();
      router.push(`/agent-hub/pipeline/${refBody.referral.id}`);
    } catch (e) {
      // Owner / property creation that succeeded is now persisted in state;
      // a retry will skip those steps. The user sees a useful error and
      // doesn't accidentally create duplicates.
      setToast({ msg: e instanceof Error ? e.message : "Failed.", variant: "error" });
      setBusy(false);
    }
  }

  function setStep(step: Step) {
    setState((s) => ({ ...s, step }));
  }

  return (
    <div className={styles.shell}>
      <Link href="/agent-hub/pipeline" className={styles.muted} style={{ fontSize: "0.85rem", display: "inline-block", marginBottom: "0.5rem" }}>
        ← Pipeline
      </Link>

      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>New Referral</h1>
          <p className={styles.pageSubtitle}>
            Step {state.step} of 5
            {state.step > 1 ? (
              <button
                className={styles.btnGhost}
                style={{ marginLeft: "0.5rem", fontSize: "0.8rem" }}
                onClick={() => { clearWizard(); setState(emptyState()); }}
              >
                Start over
              </button>
            ) : null}
          </p>
        </div>
      </div>

      <div className={styles.card}>
        {state.step === 1 ? (
          <Step1 state={state} setState={setState} authHeaders={authHeaders} setToast={setToast} />
        ) : state.step === 2 ? (
          <Step2 state={state} setState={setState} authHeaders={authHeaders} setToast={setToast} />
        ) : state.step === 3 ? (
          <Step3 state={state} setState={setState} authHeaders={authHeaders} setToast={setToast} />
        ) : state.step === 4 ? (
          <Step4 state={state} setState={setState} />
        ) : (
          <Step5 state={state} />
        )}
        <div style={{ marginTop: "1rem", display: "flex", justifyContent: "space-between" }}>
          {state.step > 1 ? (
            <button className={styles.btn} onClick={() => setStep((state.step - 1) as Step)}>← Back</button>
          ) : <span />}
          {state.step < 5 ? (
            <button
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => setStep((state.step + 1) as Step)}
              disabled={
                (state.step === 1 && !state.agent?.id) ||
                (state.step === 2 && !state.owner.id && !state.owner.full_name.trim()) ||
                (state.step === 4 && !state.referral.expected_monthly_rent)
              }
            >
              Next →
            </button>
          ) : (
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={submit} disabled={busy}>
              {busy ? "Creating…" : "Create referral"}
            </button>
          )}
        </div>
      </div>

      {toast ? <Toast message={toast.msg} variant={toast.variant} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}

function Step1({ state, setState, authHeaders, setToast }: any) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (search.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const body = await agentHubFetch<{ agents: Agent[] }>(`/agent-hub/agents?search=${encodeURIComponent(search.trim())}&per_page=10`, {
          authHeaders: authHeaders(),
        });
        setResults(body.agents);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [search, authHeaders]);

  return (
    <div>
      <h2 style={{ fontSize: "1rem", margin: "0 0 0.5rem" }}>Step 1 · Select referring agent</h2>
      {state.agent ? (
        <div className={styles.row} style={{ background: "#f9fafb", padding: "0.6rem", borderRadius: 8 }}>
          <Avatar agent={{ full_name: state.agent.full_name, photo_url: null }} size={36} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500 }}>{state.agent.full_name}</div>
            <div className={styles.muted} style={{ fontSize: "0.78rem" }}>{state.agent.brokerage_name || "—"}</div>
          </div>
          <button className={styles.btnGhost} onClick={() => setState((s: WizardState) => ({ ...s, agent: null }))}>Change</button>
        </div>
      ) : (
        <>
          <input
            className={styles.input}
            placeholder="Search agents…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <div style={{ marginTop: "0.5rem", maxHeight: 240, overflowY: "auto" }}>
            {loading ? <div className={styles.muted}>Searching…</div> : null}
            {results.map((a) => (
              <button
                key={a.id}
                onClick={() => setState((s: WizardState) => ({ ...s, agent: { id: a.id, full_name: a.full_name, brokerage_name: a.brokerage_name, tier: a.tier } }))}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "0.5rem", border: "none", background: "transparent", borderBottom: "1px solid #f3f4f6", cursor: "pointer" }}
              >
                <strong>{a.full_name}</strong>{" "}
                <span className={styles.muted}>· {a.brokerage_name || "—"} · {a.tier}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Step2({ state, setState, authHeaders, setToast }: any) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Owner[]>([]);

  useEffect(() => {
    if (search.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const body = await agentHubFetch<{ owners: Owner[] }>(`/agent-hub/owners?search=${encodeURIComponent(search.trim())}&per_page=10`, {
          authHeaders: authHeaders(),
        });
        setResults(body.owners);
      } catch {
        // ignore
      }
    }, 200);
    return () => clearTimeout(t);
  }, [search, authHeaders]);

  return (
    <div>
      <h2 style={{ fontSize: "1rem", margin: "0 0 0.5rem" }}>Step 2 · Select or create owner</h2>
      {state.owner.id ? (
        <div style={{ background: "#f9fafb", padding: "0.6rem", borderRadius: 8 }}>
          <strong>{state.owner.full_name}</strong>{" "}
          <button
            className={styles.btnGhost}
            onClick={() => setState((s: WizardState) => ({ ...s, owner: { id: null, full_name: "", email: "", phone_mobile: "", is_company: false, company_name: "" } }))}
          >
            Change
          </button>
        </div>
      ) : (
        <>
          <input
            className={styles.input}
            placeholder="Search existing owners…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {results.length > 0 ? (
            <div style={{ marginTop: "0.5rem", maxHeight: 200, overflowY: "auto", marginBottom: "0.6rem" }}>
              {results.map((o) => (
                <button
                  key={o.id}
                  onClick={() => {
                    if (state.agent?.id && o.source_agent_id && o.source_agent_id !== state.agent.id) {
                      setToast({ msg: `This owner was already sourced by another agent. Continuing — they'll get the credit.`, variant: "error" });
                    }
                    setState((s: WizardState) => ({
                      ...s,
                      owner: { id: o.id, full_name: o.full_name, email: o.email || "", phone_mobile: o.phone_mobile || "", is_company: o.is_company, company_name: o.company_name || "" },
                    }));
                  }}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "0.5rem", border: "none", background: "transparent", borderBottom: "1px solid #f3f4f6", cursor: "pointer" }}
                >
                  <strong>{o.full_name}</strong>{" "}
                  <span className={styles.muted}>· {o.email || "—"} · {o.active_referral_count || 0} active referrals</span>
                </button>
              ))}
            </div>
          ) : null}
          <h3 style={{ marginTop: "1rem", fontSize: "0.9rem" }}>Or create a new owner</h3>
          <div className={styles.gridTwo}>
            <FieldGroup label="Full name">
              <input className={styles.input} value={state.owner.full_name} onChange={(e) => setState((s: WizardState) => ({ ...s, owner: { ...s.owner, full_name: e.target.value } }))} />
            </FieldGroup>
            <FieldGroup label="Email">
              <input className={styles.input} type="email" value={state.owner.email} onChange={(e) => setState((s: WizardState) => ({ ...s, owner: { ...s.owner, email: e.target.value } }))} />
            </FieldGroup>
            <FieldGroup label="Phone">
              <input className={styles.input} value={state.owner.phone_mobile} onChange={(e) => setState((s: WizardState) => ({ ...s, owner: { ...s.owner, phone_mobile: e.target.value } }))} />
            </FieldGroup>
          </div>
          <label className={styles.checkboxLabel} style={{ marginTop: "0.4rem" }}>
            <input type="checkbox" checked={state.owner.is_company} onChange={(e) => setState((s: WizardState) => ({ ...s, owner: { ...s.owner, is_company: e.target.checked } }))} />
            Is a company
          </label>
          {state.owner.is_company ? (
            <FieldGroup label="Company name">
              <input className={styles.input} value={state.owner.company_name} onChange={(e) => setState((s: WizardState) => ({ ...s, owner: { ...s.owner, company_name: e.target.value } }))} />
            </FieldGroup>
          ) : null}
        </>
      )}
    </div>
  );
}

function Step3({ state, setState, authHeaders }: any) {
  const ownerId = state.owner.id;
  const [existing, setExisting] = useState<Property[]>([]);
  useEffect(() => {
    if (!ownerId) return;
    (async () => {
      try {
        const body = await agentHubFetch<{ properties: Property[] }>(`/agent-hub/properties?owner_id=${ownerId}`, {
          authHeaders: authHeaders(),
        });
        setExisting(body.properties);
      } catch {
        // ignore
      }
    })();
  }, [ownerId, authHeaders]);

  return (
    <div>
      <h2 style={{ fontSize: "1rem", margin: "0 0 0.5rem" }}>Step 3 · Property (optional)</h2>
      {state.property.id ? (
        <div style={{ background: "#f9fafb", padding: "0.6rem", borderRadius: 8 }}>
          <strong>{state.property.address_1}, {state.property.city}</strong>{" "}
          <button className={styles.btnGhost} onClick={() => setState((s: WizardState) => ({ ...s, property: { id: null, address_1: "", city: "", state: "TX", zip: "", property_type: "", bedrooms: "", bathrooms: "" } }))}>
            Change
          </button>
        </div>
      ) : (
        <>
          {existing.length > 0 ? (
            <div style={{ marginBottom: "0.6rem" }}>
              <h3 style={{ fontSize: "0.85rem" }}>Owner's existing properties</h3>
              {existing.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setState((s: WizardState) => ({ ...s, property: { id: p.id, address_1: p.address_1, city: p.city, state: p.state, zip: p.zip, property_type: p.property_type || "", bedrooms: p.bedrooms?.toString() || "", bathrooms: p.bathrooms?.toString() || "" } }))}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "0.5rem", border: "none", background: "transparent", borderBottom: "1px solid #f3f4f6", cursor: "pointer" }}
                >
                  {p.address_1}, {p.city} <span className={styles.muted}>· {p.status}</span>
                </button>
              ))}
            </div>
          ) : null}
          <h3 style={{ fontSize: "0.85rem" }}>Or create new (optional — can skip)</h3>
          <FieldGroup label="Address line 1">
            <input className={styles.input} value={state.property.address_1} onChange={(e) => setState((s: WizardState) => ({ ...s, property: { ...s.property, address_1: e.target.value } }))} />
          </FieldGroup>
          <div className={styles.gridTwo}>
            <FieldGroup label="City">
              <input className={styles.input} value={state.property.city} onChange={(e) => setState((s: WizardState) => ({ ...s, property: { ...s.property, city: e.target.value } }))} />
            </FieldGroup>
            <FieldGroup label="State">
              <input className={styles.input} value={state.property.state} onChange={(e) => setState((s: WizardState) => ({ ...s, property: { ...s.property, state: e.target.value } }))} />
            </FieldGroup>
            <FieldGroup label="Zip">
              <input className={styles.input} value={state.property.zip} onChange={(e) => setState((s: WizardState) => ({ ...s, property: { ...s.property, zip: e.target.value } }))} />
            </FieldGroup>
            <FieldGroup label="Type">
              <select className={styles.select} value={state.property.property_type} onChange={(e) => setState((s: WizardState) => ({ ...s, property: { ...s.property, property_type: e.target.value } }))}>
                <option value="">—</option>
                <option value="single_family">Single family</option>
                <option value="condo">Condo</option>
                <option value="townhome">Townhome</option>
                <option value="duplex">Duplex</option>
                <option value="multi_family">Multi-family</option>
                <option value="other">Other</option>
              </select>
            </FieldGroup>
            <FieldGroup label="Bedrooms">
              <input className={styles.input} type="number" min="0" step="0.5" value={state.property.bedrooms} onChange={(e) => setState((s: WizardState) => ({ ...s, property: { ...s.property, bedrooms: e.target.value } }))} />
            </FieldGroup>
            <FieldGroup label="Bathrooms">
              <input className={styles.input} type="number" min="0" step="0.5" value={state.property.bathrooms} onChange={(e) => setState((s: WizardState) => ({ ...s, property: { ...s.property, bathrooms: e.target.value } }))} />
            </FieldGroup>
          </div>
        </>
      )}
    </div>
  );
}

function Step4({ state, setState }: any) {
  return (
    <div>
      <h2 style={{ fontSize: "1rem", margin: "0 0 0.5rem" }}>Step 4 · Referral details</h2>
      <div className={styles.gridTwo}>
        <FieldGroup label="Expected monthly rent *">
          <input className={styles.input} type="number" step="0.01" min="0" value={state.referral.expected_monthly_rent} onChange={(e) => setState((s: WizardState) => ({ ...s, referral: { ...s.referral, expected_monthly_rent: e.target.value } }))} />
        </FieldGroup>
        <FieldGroup label="Expected mgmt fee %">
          <input className={styles.input} type="number" step="0.1" min="0" max="100" value={state.referral.expected_management_fee_pct} onChange={(e) => setState((s: WizardState) => ({ ...s, referral: { ...s.referral, expected_management_fee_pct: e.target.value } }))} />
        </FieldGroup>
        <FieldGroup label="Expected first-month referral fee">
          <input className={styles.input} type="number" step="0.01" min="0" value={state.referral.expected_first_month_referral_fee} onChange={(e) => setState((s: WizardState) => ({ ...s, referral: { ...s.referral, expected_first_month_referral_fee: e.target.value } }))} />
        </FieldGroup>
        <FieldGroup label="Priority">
          <select className={styles.select} value={state.referral.priority} onChange={(e) => setState((s: WizardState) => ({ ...s, referral: { ...s.referral, priority: e.target.value } }))}>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </FieldGroup>
        <FieldGroup label="Expected close date">
          <input className={styles.input} type="date" value={state.referral.expected_close_date} onChange={(e) => setState((s: WizardState) => ({ ...s, referral: { ...s.referral, expected_close_date: e.target.value } }))} />
        </FieldGroup>
      </div>
      <FieldGroup label="Notes">
        <textarea className={styles.textarea} value={state.referral.notes} onChange={(e) => setState((s: WizardState) => ({ ...s, referral: { ...s.referral, notes: e.target.value } }))} />
      </FieldGroup>
    </div>
  );
}

function Step5({ state }: any) {
  return (
    <div>
      <h2 style={{ fontSize: "1rem", margin: "0 0 0.5rem" }}>Step 5 · Review</h2>
      <div className={styles.flexCol} style={{ gap: "0.6rem", fontSize: "0.9rem" }}>
        <div className={styles.placeholderBox} style={{ textAlign: "left" }}>
          <strong>Referring agent:</strong> {state.agent?.full_name || "—"}
        </div>
        <div className={styles.placeholderBox} style={{ textAlign: "left" }}>
          <strong>Owner:</strong> {state.owner.full_name || "—"}
          {state.owner.id == null ? " (will be created)" : ""}
        </div>
        <div className={styles.placeholderBox} style={{ textAlign: "left" }}>
          <strong>Property:</strong>{" "}
          {state.property.id != null
            ? `${state.property.address_1}, ${state.property.city}`
            : state.property.address_1
              ? `${state.property.address_1}, ${state.property.city} (will be created)`
              : "Skipped — link later"}
        </div>
        <div className={styles.placeholderBox} style={{ textAlign: "left" }}>
          <strong>Expected rent:</strong> {formatMoney(Number(state.referral.expected_monthly_rent))}
          {" · "}
          <strong>Mgmt fee:</strong> {state.referral.expected_management_fee_pct}%
          {" · "}
          <strong>Referral fee:</strong> {formatMoney(Number(state.referral.expected_first_month_referral_fee))}
        </div>
      </div>
    </div>
  );
}

export default function ReferralWizardPage() {
  return <AgentHubGate>{(perms) => <WizardInner perms={perms} />}</AgentHubGate>;
}
