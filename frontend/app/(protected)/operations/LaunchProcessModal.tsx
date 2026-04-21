"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./operations.module.css";
import { apiUrl } from "../../../lib/api";
import { useAuth } from "../../../context/AuthContext";
import type { Template, TemplateStep } from "./types";

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function LaunchProcessModal({ open, onClose }: Props) {
  const { authHeaders } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateSteps, setTemplateSteps] = useState<TemplateStep[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [propertyName, setPropertyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [targetCompletion, setTargetCompletion] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setSelectedTemplate(null);
    setPropertyName("");
    setContactName("");
    setContactEmail("");
    setContactPhone("");
    setNotes("");
    setTargetCompletion("");
    setErr(null);
    (async () => {
      try {
        const res = await fetch(apiUrl("/processes/templates"), {
          headers: { ...authHeaders() },
          cache: "no-store",
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(body.templates)) {
          setTemplates(body.templates);
        }
      } catch {
        /* ignore */
      }
    })();
  }, [open, authHeaders]);

  useEffect(() => {
    if (!selectedTemplate) {
      setTemplateSteps([]);
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          apiUrl(`/processes/templates/${selectedTemplate.id}/steps`),
          { headers: { ...authHeaders() }, cache: "no-store" }
        );
        const body = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(body.steps)) {
          setTemplateSteps(body.steps);
        }
      } catch {
        /* ignore */
      }
    })();
    const targetDays = selectedTemplate.estimatedDays || 14;
    const d = new Date();
    d.setDate(d.getDate() + targetDays);
    setTargetCompletion(d.toISOString().slice(0, 10));
  }, [selectedTemplate, authHeaders]);

  if (!open) return null;

  const pickTemplate = (t: Template) => {
    setSelectedTemplate(t);
    setStep(2);
  };

  const launch = async () => {
    if (!selectedTemplate) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(apiUrl("/processes"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          templateId: selectedTemplate.id,
          propertyName: propertyName.trim() || undefined,
          contactName: contactName.trim() || undefined,
          contactEmail: contactEmail.trim() || undefined,
          contactPhone: contactPhone.trim() || undefined,
          notes: notes.trim() || undefined,
          targetCompletion: targetCompletion || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Could not launch process.");
      onClose();
      router.push(`/operations/processes/${body.process.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not launch process.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={`${styles.modal} ${styles.modalWide}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>Launch Process</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className={styles.form}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
            <span className={`${styles.launchDot} ${step >= 1 ? styles.launchDotActive : ""}`}>1</span>
            <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#1b2856" }}>Template</span>
            <span style={{ color: "#d1d5db" }}>→</span>
            <span className={`${styles.launchDot} ${step >= 2 ? styles.launchDotActive : ""}`}>2</span>
            <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#1b2856" }}>Details</span>
            <span style={{ color: "#d1d5db" }}>→</span>
            <span className={`${styles.launchDot} ${step >= 3 ? styles.launchDotActive : ""}`}>3</span>
            <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#1b2856" }}>Review</span>
          </div>
          {err ? <div className={styles.errorBanner}>{err}</div> : null}

          {step === 1 ? (
            templates.length === 0 ? (
              <div className={styles.emptyState}>
                <h3>No templates yet</h3>
                <p>Create a template before launching a process.</p>
              </div>
            ) : (
              <div className={styles.templateGrid}>
                {templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={styles.templateCard}
                    style={{ borderLeftColor: t.color }}
                    onClick={() => pickTemplate(t)}
                  >
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      <span className={styles.templateIcon}>{t.icon}</span>
                      <h3 className={styles.templateName}>{t.name}</h3>
                    </div>
                    {t.description ? <p className={styles.templateDesc}>{t.description}</p> : null}
                    <div className={styles.templateFoot}>
                      <span>{t.category ?? ""}</span>
                      <span>
                        {t.stepCount ?? 0} steps · {t.estimatedDays}d
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )
          ) : null}

          {step === 2 && selectedTemplate ? (
            <>
              <div className={styles.field}>
                <label>Property (optional)</label>
                <input
                  value={propertyName}
                  onChange={(e) => setPropertyName(e.target.value)}
                  placeholder="e.g. 4017 Briar Hollow"
                />
              </div>
              <div className={styles.fieldRow}>
                <div className={styles.field}>
                  <label>Contact name</label>
                  <input value={contactName} onChange={(e) => setContactName(e.target.value)} />
                </div>
                <div className={styles.field}>
                  <label>Target completion</label>
                  <input
                    type="date"
                    value={targetCompletion}
                    onChange={(e) => setTargetCompletion(e.target.value)}
                  />
                </div>
              </div>
              <div className={styles.fieldRow}>
                <div className={styles.field}>
                  <label>Contact email</label>
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                  />
                </div>
                <div className={styles.field}>
                  <label>Contact phone</label>
                  <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
                </div>
              </div>
              <div className={styles.field}>
                <label>Notes</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              <div className={styles.formActions}>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnGhost}`}
                  onClick={() => setStep(1)}
                >
                  ← Back
                </button>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={() => setStep(3)}
                >
                  Review →
                </button>
              </div>
            </>
          ) : null}

          {step === 3 && selectedTemplate ? (
            <>
              <div className={styles.sidebarCard}>
                <h3>{selectedTemplate.icon} {selectedTemplate.name}</h3>
                <div className={styles.sidebarRow}>
                  <span className={styles.sidebarLabel}>Property</span>
                  <span className={styles.sidebarValue}>{propertyName || "—"}</span>
                </div>
                <div className={styles.sidebarRow}>
                  <span className={styles.sidebarLabel}>Contact</span>
                  <span className={styles.sidebarValue}>{contactName || "—"}</span>
                </div>
                <div className={styles.sidebarRow}>
                  <span className={styles.sidebarLabel}>Target</span>
                  <span className={styles.sidebarValue}>{targetCompletion || "—"}</span>
                </div>
              </div>
              {templateSteps.length === 0 ? (
                <p className={styles.hint}>This template has no steps yet. Launching it will create an empty process.</p>
              ) : (
                <div>
                  <p className={styles.hint}>Steps to be created:</p>
                  <ol style={{ paddingLeft: "1.25rem", color: "#1b2856", fontSize: "0.88rem" }}>
                    {templateSteps.map((s) => (
                      <li key={s.id} style={{ marginBottom: "0.25rem" }}>
                        <strong>{s.name}</strong>{" "}
                        <span style={{ color: "#6a737b", fontWeight: 400 }}>
                          · day {s.dueDaysOffset}
                          {s.assignedRole ? ` · ${s.assignedRole}` : ""}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              <div className={styles.formActions}>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnGhost}`}
                  onClick={() => setStep(2)}
                >
                  ← Back
                </button>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={launch}
                  disabled={saving}
                >
                  {saving ? "Launching…" : "Launch Process"}
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
