"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../../context/AuthContext";
import { apiUrl } from "../../../../lib/api";
import ReviewsNav from "../ReviewsNav";
import { type Automation, type ReviewTemplate } from "../utils";
import styles from "../reviews.module.css";

const TRIGGERS = [
  { value: "work_order_completed", label: "Work order completed", defaultDelay: 72 },
  { value: "lease_renewal_completed", label: "Lease renewed", defaultDelay: 168 },
  { value: "move_in_completed", label: "Move-in process completed", defaultDelay: 720 },
  { value: "owner_onboarding_completed", label: "Owner onboarding completed", defaultDelay: 336 },
  { value: "process_completed", label: "Any process completed", defaultDelay: 72 },
  { value: "scheduled", label: "Scheduled (recurring)", defaultDelay: 0 },
] as const;

export default function AutomationsClient() {
  const { authHeaders, isAdmin } = useAuth();
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [templates, setTemplates] = useState<ReviewTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Automation | null>(null);

  const load = useCallback(async () => {
    const [aRes, tRes] = await Promise.all([
      fetch(apiUrl("/reviews/automations"), { headers: { ...authHeaders() } }),
      fetch(apiUrl("/reviews/templates"), { headers: { ...authHeaders() } }),
    ]);
    const [aBody, tBody] = await Promise.all([
      aRes.json().catch(() => ({})),
      tRes.json().catch(() => ({})),
    ]);
    if (aRes.ok && Array.isArray(aBody.automations)) setAutomations(aBody.automations);
    if (tRes.ok && Array.isArray(tBody.templates)) setTemplates(tBody.templates);
    setLoading(false);
  }, [authHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (a: Automation) => {
    await fetch(apiUrl(`/reviews/automations/${a.id}/toggle`), {
      method: "PUT",
      headers: { ...authHeaders() },
    });
    load();
  };

  const onDelete = async (a: Automation) => {
    if (!window.confirm(`Delete automation "${a.name}"?`)) return;
    await fetch(apiUrl(`/reviews/automations/${a.id}`), {
      method: "DELETE",
      headers: { ...authHeaders() },
    });
    load();
  };

  const onTest = async (a: Automation) => {
    const res = await fetch(apiUrl(`/reviews/automations/${a.id}/test`), {
      method: "POST",
      headers: { ...authHeaders() },
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.ok) alert("Test sent! Check your email/phone.");
    else alert(body.error || (body.errors || []).join("; ") || "Test failed.");
  };

  return (
    <div className={styles.page}>
      <div className={styles.topRow}>
        <div>
          <h1 className={styles.title}>⚙️ Review Automations</h1>
          <p className={styles.sub}>Automatically send review requests after key events.</p>
        </div>
        {isAdmin ? (
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={() => {
              setEditing(null);
              setEditOpen(true);
            }}
          >
            + Create Automation
          </button>
        ) : null}
      </div>

      <ReviewsNav />

      {loading ? (
        <div className={styles.loading}>Loading…</div>
      ) : automations.length === 0 ? (
        <div className={styles.emptyState}>
          <h3>No automations yet</h3>
          <p>Create automation rules to send review requests after specific events.</p>
        </div>
      ) : (
        <div>
          {automations.map((a) => {
            const trigger = TRIGGERS.find((t) => t.value === a.trigger_type);
            return (
              <article key={a.id} className={styles.automationCard}>
                <div className={styles.autoInfo}>
                  <h3 className={styles.autoName}>{a.name}</h3>
                  {a.description ? <p className={styles.autoDesc}>{a.description}</p> : null}
                  <p className={styles.autoMeta}>
                    Trigger: <strong>{trigger?.label ?? a.trigger_type}</strong> · Template:{" "}
                    <strong>{a.template_name || "—"}</strong> · Delay: <strong>{a.delay_hours}h</strong> ·
                    Channel: <strong>{a.channel}</strong>
                  </p>
                  <p className={styles.autoMeta}>
                    Sent: <strong>{a.send_count}</strong> · Reviews received:{" "}
                    <strong>{a.review_count}</strong>
                  </p>
                </div>
                <div className={styles.autoActions}>
                  {isAdmin ? (
                    <>
                      <button
                        type="button"
                        className={`${styles.toggle} ${a.is_active ? styles.toggleOn : ""}`}
                        onClick={() => toggle(a)}
                        aria-label={a.is_active ? "Pause" : "Activate"}
                      >
                        <span className={styles.toggleKnob} />
                      </button>
                      <button
                        type="button"
                        className={styles.btnSecondary}
                        onClick={() => onTest(a)}
                      >
                        Test
                      </button>
                      <button
                        type="button"
                        className={styles.btnSecondary}
                        onClick={() => {
                          setEditing(a);
                          setEditOpen(true);
                        }}
                      >
                        Edit
                      </button>
                      <button type="button" className={styles.btnDanger} onClick={() => onDelete(a)}>
                        Delete
                      </button>
                    </>
                  ) : (
                    <span className={styles.recipientBadge}>
                      {a.is_active ? "Active" : "Paused"}
                    </span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {editOpen ? (
        <AutomationEditor
          automation={editing}
          templates={templates}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            load();
          }}
        />
      ) : null}
    </div>
  );
}

type EditorProps = {
  automation: Automation | null;
  templates: ReviewTemplate[];
  onClose: () => void;
  onSaved: () => void;
};

function AutomationEditor({ automation, templates, onClose, onSaved }: EditorProps) {
  const { authHeaders } = useAuth();
  const [name, setName] = useState(automation?.name ?? "");
  const [description, setDescription] = useState(automation?.description ?? "");
  const [triggerType, setTriggerType] = useState(automation?.trigger_type ?? "work_order_completed");
  const [templateId, setTemplateId] = useState<number | null>(automation?.template_id ?? null);
  const [channel, setChannel] = useState(automation?.channel ?? "email");
  const [delayHours, setDelayHours] = useState<number>(automation?.delay_hours ?? 72);
  const [recipientType, setRecipientType] = useState(automation?.recipient_type ?? "tenant");
  const [dedupeDays, setDedupeDays] = useState<number>(
    Number((automation?.conditions as Record<string, unknown>)?.dedupe_days ?? 30)
  );
  const [maxPerDay, setMaxPerDay] = useState<number>(
    Number((automation?.conditions as Record<string, unknown>)?.max_per_day ?? 50)
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSave = async () => {
    setSaving(true);
    setErr(null);
    try {
      const payload = {
        name,
        description,
        triggerType,
        triggerConfig: { delay_hours: delayHours },
        templateId,
        channel,
        delayHours,
        recipientType,
        isActive: automation?.is_active ?? true,
        conditions: { dedupe_days: dedupeDays, max_per_day: maxPerDay },
      };
      const url = automation
        ? apiUrl(`/reviews/automations/${automation.id}`)
        : apiUrl("/reviews/automations");
      const res = await fetch(url, {
        method: automation ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Save failed.");
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>
            {automation ? "Edit Automation" : "Create Automation"}
          </h2>
          <button type="button" className={styles.modalClose} onClick={onClose}>
            ×
          </button>
        </header>
        <div className={styles.modalBody}>
          <div className={styles.formRow}>
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className={styles.formRow}>
            <label>Description</label>
            <input value={description || ""} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className={styles.formRow}>
            <label>Trigger</label>
            <select
              value={triggerType}
              onChange={(e) => {
                setTriggerType(e.target.value);
                const t = TRIGGERS.find((x) => x.value === e.target.value);
                if (t) setDelayHours(t.defaultDelay);
              }}
            >
              {TRIGGERS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.formRow}>
            <label>Template</label>
            <select
              value={templateId ?? ""}
              onChange={(e) => setTemplateId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">— Select —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.channel})
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div className={styles.formRow}>
              <label>Channel</label>
              <select value={channel} onChange={(e) => setChannel(e.target.value)}>
                <option value="email">Email</option>
                <option value="sms">SMS</option>
                <option value="both">Both</option>
              </select>
            </div>
            <div className={styles.formRow}>
              <label>Delay (hours)</label>
              <input
                type="number"
                value={delayHours}
                onChange={(e) => setDelayHours(Number(e.target.value))}
                min={0}
              />
            </div>
            <div className={styles.formRow}>
              <label>Recipient type</label>
              <select
                value={recipientType}
                onChange={(e) => setRecipientType(e.target.value)}
              >
                <option value="tenant">Tenant</option>
                <option value="owner">Owner</option>
                <option value="vendor">Vendor</option>
              </select>
            </div>
            <div className={styles.formRow}>
              <label>Dedupe window (days)</label>
              <input
                type="number"
                value={dedupeDays}
                onChange={(e) => setDedupeDays(Number(e.target.value))}
                min={0}
              />
            </div>
            <div className={styles.formRow}>
              <label>Max per day</label>
              <input
                type="number"
                value={maxPerDay}
                onChange={(e) => setMaxPerDay(Number(e.target.value))}
                min={1}
              />
            </div>
          </div>
          {err ? (
            <div className={styles.insightCallout} style={{ color: "#b32317" }}>
              {err}
            </div>
          ) : null}
        </div>
        <footer className={styles.modalFooter}>
          <button type="button" className={styles.btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={onSave}
            disabled={saving || !name.trim() || !templateId}
          >
            {saving ? "Saving…" : automation ? "Save Changes" : "Create"}
          </button>
        </footer>
      </div>
    </div>
  );
}
