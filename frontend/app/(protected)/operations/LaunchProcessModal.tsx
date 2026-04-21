"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./operations.module.css";
import CustomFieldEditor from "./CustomFieldEditor";
import PropertyPicker, { type SelectedProperty } from "../../../components/PropertyPicker";
import { apiUrl } from "../../../lib/api";
import { useAuth } from "../../../context/AuthContext";
import type { CustomFieldDefinition, Template, TemplateStep } from "./types";

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
  const [launchFields, setLaunchFields] = useState<CustomFieldDefinition[]>([]);
  const [launchValues, setLaunchValues] = useState<Record<number, unknown>>({});
  const [property, setProperty] = useState<SelectedProperty | null>(null);
  const [propertySummary, setPropertySummary] = useState<{
    address?: string | null;
    type?: string | null;
    tenant?: string | null;
    status?: string | null;
    health?: number | null;
  } | null>(null);
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
    setProperty(null);
    setPropertySummary(null);
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
      setLaunchFields([]);
      setLaunchValues({});
      return;
    }
    (async () => {
      try {
        const [stepsRes, fieldsRes] = await Promise.all([
          fetch(apiUrl(`/processes/templates/${selectedTemplate.id}/steps`), {
            headers: { ...authHeaders() },
            cache: "no-store",
          }),
          fetch(
            apiUrl(
              `/custom-fields/definitions?entityType=process_template&entityId=${selectedTemplate.id}`
            ),
            { headers: { ...authHeaders() }, cache: "no-store" }
          ),
        ]);
        const stepsBody = await stepsRes.json().catch(() => ({}));
        if (stepsRes.ok && Array.isArray(stepsBody.steps)) {
          setTemplateSteps(stepsBody.steps);
        }
        const fieldsBody = await fieldsRes.json().catch(() => ({}));
        if (fieldsRes.ok && Array.isArray(fieldsBody.definitions)) {
          const forLaunch = (fieldsBody.definitions as CustomFieldDefinition[]).filter(
            (d) => d.fieldConfig?.fillAtLaunch === true
          );
          setLaunchFields(forLaunch);
          setLaunchValues({});
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
          propertyName: property?.propertyName.trim() || undefined,
          propertyId: property?.propertyId ?? undefined,
          contactName: contactName.trim() || undefined,
          contactEmail: contactEmail.trim() || undefined,
          contactPhone: contactPhone.trim() || undefined,
          notes: notes.trim() || undefined,
          targetCompletion: targetCompletion || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Could not launch process.");
      const newId = body.process.id;
      const pendingValues = Object.entries(launchValues)
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .map(([fid, v]) => ({ fieldDefinitionId: Number(fid), value: v }));
      if (pendingValues.length) {
        await fetch(apiUrl("/custom-fields/values/bulk"), {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            entityType: "process",
            entityId: newId,
            values: pendingValues,
          }),
        }).catch(() => {});
      }
      onClose();
      router.push(`/operations/processes/${newId}`);
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
                <PropertyPicker
                  value={property}
                  onChange={(p) => {
                    setProperty(p);
                    setPropertySummary(null);
                    if (!p || (!p.propertyId && !p.propertyName)) return;
                    (async () => {
                      try {
                        const url = p.propertyId
                          ? apiUrl(`/property-context/${p.propertyId}`)
                          : apiUrl(`/property-context/by-name/${encodeURIComponent(p.propertyName)}`);
                        const res = await fetch(url, {
                          headers: { ...authHeaders() },
                          cache: "no-store",
                        });
                        if (!res.ok) return;
                        const body = await res.json();
                        if (body.owner?.owner_name && !contactName.trim()) {
                          setContactName(body.owner.owner_name);
                        }
                        if (body.owner?.owner_email && !contactEmail.trim()) {
                          setContactEmail(body.owner.owner_email);
                        }
                        if (body.owner?.owner_phone && !contactPhone.trim()) {
                          setContactPhone(body.owner.owner_phone);
                        }
                        setPropertySummary({
                          address: body.property?.property_address,
                          type: body.property?.property_type,
                          tenant: body.occupancy?.tenant_name ?? null,
                          status: body.occupancy?.status ?? null,
                          health: body.healthScore?.score ?? null,
                        });
                      } catch {
                        /* ignore */
                      }
                    })();
                  }}
                />
                {propertySummary ? (
                  <div
                    style={{
                      marginTop: "0.4rem",
                      padding: "0.5rem 0.65rem",
                      background: "rgba(0,152,208,0.06)",
                      borderLeft: "3px solid #0098d0",
                      borderRadius: 6,
                      fontSize: "0.8rem",
                      color: "#1b2856",
                    }}
                  >
                    {propertySummary.address ? (
                      <div>{propertySummary.address}</div>
                    ) : null}
                    <div style={{ color: "#6a737b" }}>
                      {propertySummary.type || "—"}
                      {propertySummary.tenant ? ` · Tenant: ${propertySummary.tenant}` : ""}
                      {propertySummary.status ? ` · ${propertySummary.status}` : ""}
                      {propertySummary.health !== null
                        ? ` · Health ${propertySummary.health}`
                        : ""}
                    </div>
                  </div>
                ) : null}
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
                  <span className={styles.sidebarValue}>{property?.propertyName || "—"}</span>
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
              {launchFields.length ? (
                <div className={styles.sidebarCard}>
                  <h3>Fill in now</h3>
                  {launchFields.map((d) => (
                    <div key={d.id} className={styles.cfField} style={{ marginBottom: "0.5rem" }}>
                      <label className={styles.cfLabel}>
                        {d.fieldLabel}
                        {d.isRequired ? <span className={styles.cfRequired}>*</span> : null}
                      </label>
                      <CustomFieldEditor
                        definition={d}
                        value={launchValues[d.id] ?? null}
                        onChange={(v) => setLaunchValues((prev) => ({ ...prev, [d.id]: v }))}
                      />
                      {d.helpText ? <div className={styles.cfHelp}>{d.helpText}</div> : null}
                    </div>
                  ))}
                </div>
              ) : null}
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
