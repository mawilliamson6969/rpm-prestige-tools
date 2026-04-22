"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../../context/AuthContext";
import { apiUrl } from "../../../../lib/api";
import ReviewsNav from "../ReviewsNav";
import { type ReviewTemplate } from "../utils";
import styles from "../reviews.module.css";

type TeamUser = { id: number; displayName: string; username: string };

type Recipient = {
  name: string;
  email: string;
  phone: string;
  propertyName?: string;
  propertyId?: number;
  recipientType?: string;
};

const STEPS = ["Template", "Recipients", "Channel", "Team", "Review"] as const;

export default function SendRequestClient() {
  const { authHeaders, user } = useAuth();
  const [templates, setTemplates] = useState<ReviewTemplate[]>([]);
  const [teamUsers, setTeamUsers] = useState<TeamUser[]>([]);
  const [step, setStep] = useState<number>(0);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [mode, setMode] = useState<"individual" | "bulk" | "appfolio">("individual");
  const [individuals, setIndividuals] = useState<Recipient[]>([
    { name: "", email: "", phone: "", propertyName: "", recipientType: "tenant" },
  ]);
  const [bulkCsv, setBulkCsv] = useState("");
  const [appfolioSource, setAppfolioSource] = useState<string>("current_tenants");
  const [appfolioList, setAppfolioList] = useState<Recipient[]>([]);
  const [appfolioSelected, setAppfolioSelected] = useState<Set<number>>(new Set());
  const [appfolioLoading, setAppfolioLoading] = useState(false);
  const [dedupeExcluded, setDedupeExcluded] = useState<number>(0);
  const [channel, setChannel] = useState<string>("email");
  const [teamMemberId, setTeamMemberId] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: number; failed: number; skipped: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [tRes, uRes] = await Promise.all([
      fetch(apiUrl("/reviews/templates"), { headers: { ...authHeaders() } }),
      fetch(apiUrl("/eos/team-users"), { headers: { ...authHeaders() } }),
    ]);
    const [tBody, uBody] = await Promise.all([
      tRes.json().catch(() => ({})),
      uRes.json().catch(() => ({})),
    ]);
    if (tRes.ok && Array.isArray(tBody.templates)) setTemplates(tBody.templates);
    if (uRes.ok && Array.isArray(uBody.users)) setTeamUsers(uBody.users);
  }, [authHeaders]);

  useEffect(() => {
    load();
    if (user?.id) setTeamMemberId(user.id);
  }, [load, user]);

  const template = templates.find((t) => t.id === templateId) || null;

  useEffect(() => {
    if (template) setChannel(template.channel);
  }, [templateId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadAppfolio = useCallback(async () => {
    if (!templateId) return;
    setAppfolioLoading(true);
    try {
      const res = await fetch(apiUrl("/reviews/requests/send-from-appfolio"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ templateId, source: appfolioSource, preview: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(body.recipients)) {
        setAppfolioList(body.recipients);
        setAppfolioSelected(new Set(body.recipients.map((_: Recipient, i: number) => i)));
        setDedupeExcluded(body.dedupeExcluded || 0);
      }
    } finally {
      setAppfolioLoading(false);
    }
  }, [templateId, appfolioSource, authHeaders]);

  useEffect(() => {
    if (step === 1 && mode === "appfolio" && templateId) loadAppfolio();
  }, [step, mode, templateId, appfolioSource, loadAppfolio]);

  const parseCsv = (): Recipient[] => {
    const lines = bulkCsv
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    return lines
      .map((ln) => {
        const parts = ln.split(/,|\t/).map((p) => p.trim());
        return {
          name: parts[0] || "",
          email: parts[1] || "",
          phone: parts[2] || "",
          recipientType: "tenant",
        };
      })
      .filter((r) => r.name);
  };

  const finalRecipients = (): Recipient[] => {
    if (mode === "individual") return individuals.filter((r) => r.name.trim());
    if (mode === "bulk") return parseCsv();
    return appfolioList.filter((_, i) => appfolioSelected.has(i));
  };

  const canAdvance = () => {
    if (step === 0) return !!templateId;
    if (step === 1) return finalRecipients().length > 0;
    if (step === 2) return !!channel;
    if (step === 3) return !!teamMemberId;
    return true;
  };

  const onSend = async () => {
    if (!templateId) return;
    setSending(true);
    setErr(null);
    try {
      const recipients = finalRecipients();
      const payload = { templateId, channel, recipients, teamMemberId };
      const res = await fetch(apiUrl("/reviews/requests/send-bulk"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Send failed.");
      setResult({ sent: body.sent || 0, failed: body.failed || 0, skipped: body.skipped || 0 });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setSending(false);
    }
  };

  if (result) {
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>✉️ Send Review Request</h1>
        <ReviewsNav />
        <div className={styles.emptyState}>
          <h3>Done!</h3>
          <p>
            Sent: <strong>{result.sent}</strong> · Failed: <strong>{result.failed}</strong> ·
            Skipped (dedupe): <strong>{result.skipped}</strong>
          </p>
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", marginTop: "0.75rem" }}>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={() => {
                setResult(null);
                setStep(0);
                setIndividuals([{ name: "", email: "", phone: "", propertyName: "", recipientType: "tenant" }]);
                setBulkCsv("");
              }}
            >
              Send Another
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.topRow}>
        <div>
          <h1 className={styles.title}>✉️ Send Review Request</h1>
          <p className={styles.sub}>Pick a template, choose recipients, and send.</p>
        </div>
      </div>
      <ReviewsNav />

      <div className={styles.stepPills}>
        {STEPS.map((s, i) => (
          <button
            key={s}
            type="button"
            className={`${styles.stepPill} ${i === step ? styles.stepPillActive : ""}`}
            onClick={() => (i <= step ? setStep(i) : null)}
          >
            {i + 1}. {s}
          </button>
        ))}
      </div>

      {step === 0 ? (
        <div className={styles.grid2}>
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              className={styles.templateCard}
              onClick={() => setTemplateId(t.id)}
              style={{
                textAlign: "left",
                cursor: "pointer",
                borderColor: templateId === t.id ? "#0098D0" : undefined,
                boxShadow: templateId === t.id ? "0 0 0 2px rgba(0,152,208,0.35)" : undefined,
              }}
            >
              <div className={styles.templateCardHead}>
                <h3 className={styles.templateName}>{t.name}</h3>
                <span className={`${styles.channelBadge} ${channelClass(t.channel)}`}>
                  {t.channel}
                </span>
              </div>
              <p className={styles.templatePreview}>{t.body}</p>
              <div className={styles.templateStats}>
                <span>
                  <strong>{t.send_count}</strong> sent
                </span>
                <span>
                  <strong>{t.review_count}</strong> reviews
                </span>
                <span>
                  <strong>{t.conversion_rate ?? 0}%</strong> conversion
                </span>
              </div>
            </button>
          ))}
        </div>
      ) : null}

      {step === 1 ? (
        <div className={styles.card}>
          <div style={{ display: "flex", gap: "0.35rem", marginBottom: "1rem", flexWrap: "wrap" }}>
            {(["individual", "bulk", "appfolio"] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={`${styles.stepPill} ${mode === m ? styles.stepPillActive : ""}`}
                onClick={() => setMode(m)}
              >
                {m === "individual" ? "Individual" : m === "bulk" ? "Bulk (CSV)" : "From AppFolio"}
              </button>
            ))}
          </div>

          {mode === "individual" ? (
            <div>
              {individuals.map((r, i) => (
                <div
                  key={i}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr 1fr auto",
                    gap: "0.5rem",
                    marginBottom: "0.65rem",
                  }}
                >
                  <input
                    placeholder="Name"
                    value={r.name}
                    onChange={(e) => {
                      const next = [...individuals];
                      next[i] = { ...next[i], name: e.target.value };
                      setIndividuals(next);
                    }}
                    style={inputStyle}
                  />
                  <input
                    placeholder="Email"
                    value={r.email}
                    onChange={(e) => {
                      const next = [...individuals];
                      next[i] = { ...next[i], email: e.target.value };
                      setIndividuals(next);
                    }}
                    style={inputStyle}
                  />
                  <input
                    placeholder="Phone"
                    value={r.phone}
                    onChange={(e) => {
                      const next = [...individuals];
                      next[i] = { ...next[i], phone: e.target.value };
                      setIndividuals(next);
                    }}
                    style={inputStyle}
                  />
                  <input
                    placeholder="Property"
                    value={r.propertyName}
                    onChange={(e) => {
                      const next = [...individuals];
                      next[i] = { ...next[i], propertyName: e.target.value };
                      setIndividuals(next);
                    }}
                    style={inputStyle}
                  />
                  <button
                    type="button"
                    className={styles.btnDanger}
                    onClick={() => setIndividuals(individuals.filter((_, j) => j !== i))}
                    disabled={individuals.length === 1}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() =>
                  setIndividuals([
                    ...individuals,
                    { name: "", email: "", phone: "", propertyName: "", recipientType: "tenant" },
                  ])
                }
              >
                + Add another
              </button>
            </div>
          ) : null}

          {mode === "bulk" ? (
            <div className={styles.formRow}>
              <label htmlFor="csv">Paste CSV: Name, Email, Phone (one per line)</label>
              <textarea
                id="csv"
                value={bulkCsv}
                onChange={(e) => setBulkCsv(e.target.value)}
                placeholder={"Jane Smith, jane@example.com, 713-555-0001\nJohn Doe, john@example.com, 713-555-0002"}
              />
              <p className={styles.formRowHint}>
                Parsed: <strong>{parseCsv().length}</strong> recipients
              </p>
            </div>
          ) : null}

          {mode === "appfolio" ? (
            <div>
              <div className={styles.formRow}>
                <label htmlFor="src">Source</label>
                <select
                  id="src"
                  value={appfolioSource}
                  onChange={(e) => setAppfolioSource(e.target.value)}
                >
                  <option value="current_tenants">Current Tenants</option>
                  <option value="owners">All Owners</option>
                  <option value="recently_completed_wo">Recently Completed Work Orders (30 days)</option>
                  <option value="lease_renewals">Recent Lease Renewals</option>
                </select>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.65rem", flexWrap: "wrap" }}>
                <span className={styles.recipientCount}>
                  {appfolioSelected.size} of {appfolioList.length} selected
                </span>
                {dedupeExcluded > 0 ? (
                  <span className={styles.recipientCount} style={{ background: "rgba(245,158,11,0.15)" }}>
                    {dedupeExcluded} excluded (requested in last 30 days)
                  </span>
                ) : null}
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() =>
                    setAppfolioSelected(new Set(appfolioList.map((_, i) => i)))
                  }
                >
                  Select all
                </button>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => setAppfolioSelected(new Set())}
                >
                  Deselect all
                </button>
              </div>
              {appfolioLoading ? (
                <div className={styles.loading}>Loading from AppFolio…</div>
              ) : (
                <div className={styles.recipientList}>
                  {appfolioList.map((r, i) => (
                    <label key={i} className={styles.recipientRow}>
                      <input
                        type="checkbox"
                        checked={appfolioSelected.has(i)}
                        onChange={(e) => {
                          const next = new Set(appfolioSelected);
                          if (e.target.checked) next.add(i);
                          else next.delete(i);
                          setAppfolioSelected(next);
                        }}
                      />
                      <span className={styles.recipientName}>{r.name}</span>
                      <span>{r.email || "—"}</span>
                      <span>{r.propertyName || ""}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 2 ? (
        <div className={styles.card}>
          <div className={styles.formRow}>
            <label>Channel</label>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {(["email", "sms", "both"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`${styles.stepPill} ${channel === c ? styles.stepPillActive : ""}`}
                  onClick={() => setChannel(c)}
                >
                  {c === "email" ? "📧 Email" : c === "sms" ? "💬 SMS" : "📧+💬 Both"}
                </button>
              ))}
            </div>
          </div>
          {template ? (
            <div className={styles.formRow}>
              <label>Message preview</label>
              {template.subject && channel !== "sms" ? (
                <div
                  className={styles.previewBox}
                  style={{
                    marginBottom: "0.5rem",
                    fontWeight: 700,
                    color: "#1b2856",
                  }}
                >
                  {template.subject}
                </div>
              ) : null}
              <div className={styles.previewBox}>{template.body}</div>
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 3 ? (
        <div className={styles.card}>
          <div className={styles.formRow}>
            <label htmlFor="tm">Who should get credit for these reviews?</label>
            <select
              id="tm"
              value={teamMemberId ?? ""}
              onChange={(e) => setTeamMemberId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">— Select team member —</option>
              {teamUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName || u.username}
                </option>
              ))}
            </select>
            <p className={styles.formRowHint}>
              This links reviews received to the team member on the leaderboard.
            </p>
          </div>
        </div>
      ) : null}

      {step === 4 ? (
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>Ready to send?</h3>
          <ul style={{ padding: "0 0 0 1.25rem", margin: 0, lineHeight: 1.8, fontSize: "0.92rem" }}>
            <li>
              Template: <strong>{template?.name}</strong>
            </li>
            <li>
              Recipients: <strong>{finalRecipients().length}</strong>
            </li>
            <li>
              Channel: <strong>{channel}</strong>
            </li>
            <li>
              Credited to:{" "}
              <strong>{teamUsers.find((u) => u.id === teamMemberId)?.displayName || "—"}</strong>
            </li>
          </ul>
          {err ? (
            <p style={{ color: "#b32317", fontWeight: 600, marginTop: "0.75rem" }}>{err}</p>
          ) : null}
        </div>
      ) : null}

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1rem" }}>
        <button
          type="button"
          className={styles.btnSecondary}
          onClick={() => setStep(Math.max(0, step - 1))}
          disabled={step === 0}
        >
          ← Back
        </button>
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={() => setStep(step + 1)}
            disabled={!canAdvance()}
          >
            Next →
          </button>
        ) : (
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={onSend}
            disabled={sending}
          >
            {sending ? "Sending…" : `Send to ${finalRecipients().length} recipient(s)`}
          </button>
        )}
      </div>
    </div>
  );
}

function channelClass(channel: string) {
  if (channel === "email") return styles.channelEmail;
  if (channel === "sms") return styles.channelSms;
  return styles.channelBoth;
}

const inputStyle: React.CSSProperties = {
  borderRadius: 8,
  border: "1px solid rgba(27,40,86,0.15)",
  padding: "0.5rem 0.65rem",
  fontSize: "0.88rem",
  fontFamily: "inherit",
};
