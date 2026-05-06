"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../../context/AuthContext";
import {
  agentHubFetch,
  formatMoney,
  formatPct,
  nextStages,
  relativeTime,
  STAGE_LABELS,
  STAGE_META,
  TIER_META,
  type HubPermissions,
  type Payment,
  type Referral,
  type Revenue,
  type Stage,
  type StageHistoryEntry,
  type Task,
} from "../../../../../lib/agentHub";
import AgentHubGate from "../../AgentHubGate";
import { Avatar, FieldGroup, Toast } from "../../components";
import styles from "../../agentHub.module.css";

type DetailPayload = {
  referral: Referral;
  stage_history: StageHistoryEntry[];
  payments: Payment[];
  revenue: Revenue[];
  tasks: Task[];
};

function ReferralDetailInner({ perms }: { perms: HubPermissions }) {
  const params = useParams();
  const router = useRouter();
  const id = Number(params?.id);
  const { authHeaders, token } = useAuth();
  const [data, setData] = useState<DetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [advance, setAdvance] = useState<{ to_stage: Stage; notes: string } | null>(null);
  const [terminal, setTerminal] = useState<{ kind: "lost" | "declined"; reason: string } | null>(null);
  const [restore, setRestore] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showRevenue, setShowRevenue] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ msg: string; variant: "ok" | "error" } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  async function load() {
    try {
      const body = await agentHubFetch<DetailPayload>(`/agent-hub/referrals/${id}`, { authHeaders: authHeaders() });
      setData(body);
      setNotes(body.referral.notes || "");
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load referral.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (token && id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id]);

  if (loading) return <div className={styles.shell}><div className={styles.muted}>Loading…</div></div>;
  if (err) return <div className={styles.shell}><div className={styles.error}>{err}</div></div>;
  if (!data) return null;
  const r = data.referral;
  const meta = STAGE_META[r.stage];
  const allowedNext = nextStages(r.stage).filter((s) => s !== "lost" && s !== "declined");
  const isTerminal = r.stage === "lost" || r.stage === "declined";
  const isManager = perms.role === "owner" || perms.role === "manager";

  async function doAdvance() {
    if (!advance) return;
    setBusy(true);
    try {
      await agentHubFetch(`/agent-hub/referrals/${id}/advance-stage`, {
        method: "POST",
        authHeaders: authHeaders(),
        body: JSON.stringify({ to_stage: advance.to_stage, notes: advance.notes || undefined }),
      });
      setAdvance(null);
      setToast({ msg: `Advanced to ${STAGE_LABELS[advance.to_stage]}.`, variant: "ok" });
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Advance failed.", variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function doMarkTerminal() {
    if (!terminal || !terminal.reason.trim()) return;
    setBusy(true);
    try {
      await agentHubFetch(`/agent-hub/referrals/${id}/mark-${terminal.kind}`, {
        method: "POST",
        authHeaders: authHeaders(),
        body: JSON.stringify({ reason: terminal.reason.trim() }),
      });
      setTerminal(null);
      setToast({ msg: `Marked ${terminal.kind}.`, variant: "ok" });
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Action failed.", variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function doRestore() {
    setBusy(true);
    try {
      await agentHubFetch(`/agent-hub/referrals/${id}/restore`, {
        method: "POST",
        authHeaders: authHeaders(),
        body: JSON.stringify({}),
      });
      setRestore(false);
      setToast({ msg: "Restored to lead_received.", variant: "ok" });
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Restore failed.", variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function saveNotes() {
    setBusy(true);
    try {
      await agentHubFetch(`/agent-hub/referrals/${id}`, {
        method: "PATCH",
        authHeaders: authHeaders(),
        body: JSON.stringify({ notes }),
      });
      setEditingNotes(false);
      setToast({ msg: "Saved.", variant: "ok" });
      load();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Save failed.", variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.shell}>
      <Link href="/agent-hub/pipeline" className={styles.muted} style={{ fontSize: "0.85rem", display: "inline-block", marginBottom: "0.5rem" }}>
        ← Pipeline
      </Link>

      <div className={styles.headerStrip}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.3rem", flexWrap: "wrap" }}>
            <span
              style={{
                padding: "0.2rem 0.5rem",
                borderRadius: 9999,
                background: meta.bg,
                color: meta.fg,
                fontSize: "0.75rem",
                fontWeight: 600,
              }}
            >
              {STAGE_LABELS[r.stage]}
            </span>
            {r.lost_reason ? <span className={styles.muted}>· {r.lost_reason}</span> : null}
            {r.declined_reason ? <span className={styles.muted}>· {r.declined_reason}</span> : null}
          </div>
          <h1 className={styles.pageTitle} style={{ fontSize: "1.2rem" }}>
            {r.agent_name} → {r.owner_name}
            {r.property_address ? ` · ${r.property_address}` : ""}
          </h1>
        </div>
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
          {!isTerminal && r.stage !== "active_management" ? (
            <>
              {allowedNext.map((s) => (
                <button
                  key={s}
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={() => setAdvance({ to_stage: s, notes: "" })}
                >
                  → {STAGE_LABELS[s]}
                </button>
              ))}
              <button className={`${styles.btn} ${styles.btnDanger}`} onClick={() => setTerminal({ kind: "lost", reason: "" })}>
                Mark Lost
              </button>
              <button className={styles.btn} onClick={() => setTerminal({ kind: "declined", reason: "" })}>
                Mark Declined
              </button>
            </>
          ) : null}
          {isTerminal && isManager ? (
            <button className={styles.btn} onClick={() => setRestore(true)}>
              Restore
            </button>
          ) : null}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", alignItems: "start" }}>
        {/* LEFT */}
        <div className={styles.flexCol}>
          <div className={styles.card}>
            <div className={styles.cardTitle}>Referring Agent</div>
            <Link
              href={`/agent-hub/agents/${r.agent_id}`}
              style={{ display: "flex", alignItems: "center", gap: "0.6rem", textDecoration: "none", color: "inherit" }}
            >
              <Avatar agent={{ full_name: r.agent_name || "?", photo_url: r.agent_photo_url }} size={48} />
              <div>
                <div style={{ fontWeight: 500 }}>{r.agent_name}</div>
                <div className={styles.muted} style={{ fontSize: "0.85rem" }}>
                  {r.agent_brokerage_name || "—"}
                  {r.agent_tier ? ` · ${TIER_META[r.agent_tier].label}` : ""}
                </div>
              </div>
            </Link>
          </div>

          <div className={styles.card}>
            <div className={styles.cardTitle}>Owner</div>
            <Link href={`/agent-hub/owners/${r.owner_id}`} className={styles.linkCell}>
              {r.owner_name}
            </Link>
          </div>

          {r.property_id ? (
            <div className={styles.card}>
              <div className={styles.cardTitle}>Property</div>
              <Link href={`/agent-hub/properties/${r.property_id}`} className={styles.linkCell}>
                {r.property_address}, {r.property_city}
              </Link>
            </div>
          ) : (
            <div className={styles.card}>
              <div className={styles.cardTitle}>Property</div>
              <div className={styles.muted}>No property linked yet.</div>
            </div>
          )}

          <div className={styles.card}>
            <div className={styles.cardTitle}>Financials</div>
            <Row label="Expected rent" value={formatMoney(r.expected_monthly_rent)} />
            <Row label="Expected mgmt fee" value={formatPct(r.expected_management_fee_pct)} />
            <Row label="Expected first-month fee" value={formatMoney(r.expected_first_month_referral_fee)} />
            <Row label="Actual rent" value={formatMoney(r.actual_monthly_rent)} />
            <Row label="Actual mgmt fee" value={formatPct(r.actual_management_fee_pct)} />
            <Row label="Total paid to agent" value={formatMoney(r.actual_referral_fee_paid)} />
            <Row label="Priority" value={r.internal_priority} />
            <Row label="Expected close" value={r.expected_close_date} />
          </div>

          <div className={styles.card}>
            <div className={styles.cardTitle}>
              Notes
              <button className={styles.btnGhost} onClick={() => setEditingNotes((v) => !v)}>
                {editingNotes ? "Cancel" : "Edit"}
              </button>
            </div>
            {editingNotes ? (
              <>
                <textarea className={styles.textarea} rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} />
                <div style={{ marginTop: "0.4rem", display: "flex", justifyContent: "flex-end" }}>
                  <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={saveNotes} disabled={busy}>
                    Save
                  </button>
                </div>
              </>
            ) : (
              <div className={styles.muted} style={{ whiteSpace: "pre-wrap", fontSize: "0.9rem" }}>
                {r.notes || "—"}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT */}
        <div className={styles.flexCol}>
          <div className={styles.card}>
            <div className={styles.cardTitle}>Stage History</div>
            {data.stage_history.length === 0 ? (
              <div className={styles.muted}>No transitions yet.</div>
            ) : (
              data.stage_history.map((h) => (
                <div key={h.id} style={{ borderBottom: "1px solid #f3f4f6", padding: "0.4rem 0", fontSize: "0.85rem" }}>
                  <div>
                    {h.from_stage ? STAGE_LABELS[h.from_stage] : "—"} → <strong>{STAGE_LABELS[h.to_stage]}</strong>
                  </div>
                  <div className={styles.muted} style={{ fontSize: "0.78rem" }}>
                    {relativeTime(h.changed_at)}
                    {h.changed_by_name ? ` by ${h.changed_by_name}` : ""}
                    {h.notes ? ` · ${h.notes}` : ""}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className={styles.card}>
            <div className={styles.cardTitle}>
              Payments
              {isManager && !isTerminal ? (
                <button className={styles.btnGhost} onClick={() => setShowPayment((v) => !v)}>
                  {showPayment ? "Cancel" : "+ Record"}
                </button>
              ) : null}
            </div>
            {showPayment ? (
              <PaymentForm referralId={id} onDone={() => { setShowPayment(false); load(); }} authHeaders={authHeaders} setToast={setToast} />
            ) : null}
            {data.payments.length === 0 ? (
              <div className={styles.muted}>No payments recorded.</div>
            ) : (
              data.payments.map((p) => (
                <div key={p.id} style={{ borderBottom: "1px solid #f3f4f6", padding: "0.4rem 0", fontSize: "0.85rem", display: "flex", justifyContent: "space-between" }}>
                  <div>
                    <strong>{formatMoney(p.amount)}</strong> via {p.payment_method}
                    {p.check_number ? ` #${p.check_number}` : ""}
                  </div>
                  <div className={styles.muted} style={{ fontSize: "0.78rem" }}>{p.payment_date}</div>
                </div>
              ))
            )}
          </div>

          <div className={styles.card}>
            <div className={styles.cardTitle}>
              Revenue (monthly)
              {isManager && r.stage === "active_management" ? (
                <button className={styles.btnGhost} onClick={() => setShowRevenue((v) => !v)}>
                  {showRevenue ? "Cancel" : "+ Add month"}
                </button>
              ) : null}
            </div>
            {showRevenue ? (
              <RevenueForm referralId={id} onDone={() => { setShowRevenue(false); load(); }} authHeaders={authHeaders} setToast={setToast} />
            ) : null}
            {data.revenue.length === 0 ? (
              <div className={styles.muted}>No revenue logged yet.</div>
            ) : (
              data.revenue.slice(0, 6).map((rv) => (
                <div key={rv.id} style={{ borderBottom: "1px solid #f3f4f6", padding: "0.4rem 0", fontSize: "0.85rem", display: "flex", justifyContent: "space-between" }}>
                  <div>{rv.month?.slice(0, 7)}</div>
                  <div>
                    Rent {formatMoney(rv.rent_collected)} · Fee {formatMoney(rv.management_fee_earned)}
                  </div>
                </div>
              ))
            )}
            {data.revenue.length > 6 ? (
              <div className={styles.muted} style={{ marginTop: "0.4rem", fontSize: "0.78rem" }}>
                +{data.revenue.length - 6} more
              </div>
            ) : null}
          </div>

          {data.tasks.length > 0 ? (
            <div className={styles.card}>
              <div className={styles.cardTitle}>Related Tasks</div>
              {data.tasks.map((t) => (
                <Link
                  key={t.id}
                  href={`/agent-hub/tasks?related_referral_id=${id}`}
                  style={{ display: "block", padding: "0.4rem 0", borderBottom: "1px solid #f3f4f6", textDecoration: "none", color: "inherit" }}
                >
                  <div style={{ fontWeight: 500, fontSize: "0.85rem" }}>{t.title}</div>
                  <div className={styles.muted} style={{ fontSize: "0.78rem" }}>
                    {t.status}{t.due_date ? ` · due ${t.due_date}` : ""}
                    {t.assigned_to_name ? ` · ${t.assigned_to_name}` : ""}
                  </div>
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {advance ? (
        <Modal onClose={() => !busy && setAdvance(null)}>
          <div className={styles.cardTitle}>Advance to {STAGE_LABELS[advance.to_stage]}?</div>
          <textarea
            className={styles.textarea}
            placeholder="Notes (optional)"
            value={advance.notes}
            onChange={(e) => setAdvance({ ...advance, notes: e.target.value })}
          />
          <div style={{ marginTop: "0.6rem", display: "flex", justifyContent: "flex-end", gap: "0.4rem" }}>
            <button className={styles.btn} onClick={() => setAdvance(null)} disabled={busy}>Cancel</button>
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={doAdvance} disabled={busy}>
              {busy ? "Advancing…" : "Confirm"}
            </button>
          </div>
        </Modal>
      ) : null}

      {terminal ? (
        <Modal onClose={() => !busy && setTerminal(null)}>
          <div className={styles.cardTitle}>Mark referral {terminal.kind}</div>
          <FieldGroup label="Reason (required)">
            <textarea
              className={styles.textarea}
              value={terminal.reason}
              onChange={(e) => setTerminal({ ...terminal, reason: e.target.value })}
              autoFocus
            />
          </FieldGroup>
          <div style={{ marginTop: "0.6rem", display: "flex", justifyContent: "flex-end", gap: "0.4rem" }}>
            <button className={styles.btn} onClick={() => setTerminal(null)} disabled={busy}>Cancel</button>
            <button
              className={`${styles.btn} ${styles.btnDanger}`}
              onClick={doMarkTerminal}
              disabled={busy || !terminal.reason.trim()}
            >
              Mark {terminal.kind}
            </button>
          </div>
        </Modal>
      ) : null}

      {restore ? (
        <Modal onClose={() => !busy && setRestore(false)}>
          <div className={styles.cardTitle}>Restore referral?</div>
          <p className={styles.muted}>Reopens the referral at lead_received.</p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.4rem" }}>
            <button className={styles.btn} onClick={() => setRestore(false)} disabled={busy}>Cancel</button>
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={doRestore} disabled={busy}>
              Restore
            </button>
          </div>
        </Modal>
      ) : null}

      {toast ? <Toast message={toast.msg} variant={toast.variant} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: "0.5rem", fontSize: "0.85rem", padding: "0.15rem 0" }}>
      <span style={{ minWidth: 130, color: "#6a737b", textTransform: "uppercase", fontSize: "0.72rem", letterSpacing: "0.04em" }}>{label}</span>
      <span style={{ flex: 1 }}>{value || <span className={styles.muted}>—</span>}</span>
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
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
      onClick={onClose}
    >
      <div
        className={styles.card}
        style={{ width: 480, maxWidth: "92vw" }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function PaymentForm({
  referralId,
  onDone,
  authHeaders,
  setToast,
}: {
  referralId: number;
  onDone: () => void;
  authHeaders: () => Record<string, string>;
  setToast: (t: { msg: string; variant: "ok" | "error" }) => void;
}) {
  const [form, setForm] = useState({
    amount: "",
    payment_date: new Date().toISOString().slice(0, 10),
    payment_method: "check" as const,
    check_number: "",
    paid_to_name: "",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await agentHubFetch(`/agent-hub/referrals/${referralId}/payments`, {
        method: "POST",
        authHeaders: authHeaders(),
        body: JSON.stringify({
          amount: form.amount,
          payment_date: form.payment_date,
          payment_method: form.payment_method,
          check_number: form.check_number || undefined,
          paid_to_name: form.paid_to_name,
          notes: form.notes || undefined,
        }),
      });
      setToast({ msg: "Payment recorded.", variant: "ok" });
      onDone();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Failed.", variant: "error" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} style={{ background: "#f9fafb", padding: "0.6rem", borderRadius: 8, marginBottom: "0.6rem" }}>
      <div className={styles.gridTwo}>
        <FieldGroup label="Amount *">
          <input className={styles.input} type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
        </FieldGroup>
        <FieldGroup label="Date *">
          <input className={styles.input} type="date" value={form.payment_date} onChange={(e) => setForm({ ...form, payment_date: e.target.value })} required />
        </FieldGroup>
        <FieldGroup label="Method *">
          <select className={styles.select} value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value as any })}>
            <option value="check">Check</option>
            <option value="ach">ACH</option>
            <option value="wire">Wire</option>
            <option value="zelle">Zelle</option>
            <option value="other">Other</option>
          </select>
        </FieldGroup>
        <FieldGroup label="Check #">
          <input className={styles.input} value={form.check_number} onChange={(e) => setForm({ ...form, check_number: e.target.value })} />
        </FieldGroup>
        <FieldGroup label="Paid to *">
          <input className={styles.input} value={form.paid_to_name} onChange={(e) => setForm({ ...form, paid_to_name: e.target.value })} required />
        </FieldGroup>
      </div>
      <FieldGroup label="Notes">
        <input className={styles.input} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </FieldGroup>
      <div style={{ marginTop: "0.4rem", display: "flex", justifyContent: "flex-end" }}>
        <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy}>
          {busy ? "Saving…" : "Record"}
        </button>
      </div>
    </form>
  );
}

function RevenueForm({
  referralId,
  onDone,
  authHeaders,
  setToast,
}: {
  referralId: number;
  onDone: () => void;
  authHeaders: () => Record<string, string>;
  setToast: (t: { msg: string; variant: "ok" | "error" }) => void;
}) {
  const today = new Date();
  const monthDefault = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
  const [form, setForm] = useState({
    month: monthDefault,
    rent_collected: "",
    management_fee_earned: "",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await agentHubFetch(`/agent-hub/referrals/${referralId}/revenue`, {
        method: "POST",
        authHeaders: authHeaders(),
        body: JSON.stringify({
          month: form.month,
          rent_collected: form.rent_collected,
          management_fee_earned: form.management_fee_earned,
          notes: form.notes || undefined,
        }),
      });
      setToast({ msg: "Revenue logged.", variant: "ok" });
      onDone();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : "Failed.", variant: "error" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} style={{ background: "#f9fafb", padding: "0.6rem", borderRadius: 8, marginBottom: "0.6rem" }}>
      <div className={styles.gridTwo}>
        <FieldGroup label="Month (YYYY-MM-01)">
          <input className={styles.input} type="date" value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })} required />
        </FieldGroup>
        <FieldGroup label="Rent collected">
          <input className={styles.input} type="number" step="0.01" min="0" value={form.rent_collected} onChange={(e) => setForm({ ...form, rent_collected: e.target.value })} required />
        </FieldGroup>
      </div>
      <FieldGroup label="Mgmt fee earned">
        <input className={styles.input} type="number" step="0.01" min="0" value={form.management_fee_earned} onChange={(e) => setForm({ ...form, management_fee_earned: e.target.value })} required />
      </FieldGroup>
      <FieldGroup label="Notes">
        <input className={styles.input} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </FieldGroup>
      <div style={{ marginTop: "0.4rem", display: "flex", justifyContent: "flex-end" }}>
        <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy}>
          {busy ? "Saving…" : "Add"}
        </button>
      </div>
    </form>
  );
}

export default function ReferralDetailPage() {
  return <AgentHubGate>{(perms) => <ReferralDetailInner perms={perms} />}</AgentHubGate>;
}
