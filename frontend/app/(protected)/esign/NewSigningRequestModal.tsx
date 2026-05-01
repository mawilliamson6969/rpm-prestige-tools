"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../context/AuthContext";
import { apiUrl } from "../../../lib/api";
import PropertyPicker, { type SelectedProperty } from "../../../components/PropertyPicker";
import styles from "./esign.module.css";

type DocusealTemplate = {
  id: number;
  name: string;
  fields?: Array<{ name?: string; type?: string; uuid?: string }>;
  schema?: Array<unknown>;
  external_id?: string | null;
  folder_name?: string | null;
};

type ProcessOption = {
  id: number;
  name: string;
  propertyName?: string | null;
};

type SignerDraft = {
  name: string;
  email: string;
  role: string;
};

export type ModalInitial = {
  processId?: number | null;
  propertyName?: string | null;
  signers?: SignerDraft[];
} | null;

type Props = {
  initial: ModalInitial;
  onClose: () => void;
  onSent: () => void;
};

const ROLE_OPTIONS = ["Owner", "Tenant", "Vendor", "Manager", "Signer"];

function emptySigner(): SignerDraft {
  return { name: "", email: "", role: "Owner" };
}

export default function NewSigningRequestModal({ initial, onClose, onSent }: Props) {
  const { authHeaders } = useAuth();

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [templates, setTemplates] = useState<DocusealTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<DocusealTemplate | null>(null);

  const [signers, setSigners] = useState<SignerDraft[]>(
    initial?.signers && initial.signers.length ? initial.signers : [emptySigner()]
  );
  const [property, setProperty] = useState<SelectedProperty | null>(
    initial?.propertyName
      ? { propertyId: null, propertyName: initial.propertyName }
      : null
  );
  const [prefill, setPrefill] = useState<Record<string, string>>({});
  const [processes, setProcesses] = useState<ProcessOption[]>([]);
  const [processId, setProcessId] = useState<number | null>(initial?.processId ?? null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setTemplatesLoading(true);
      setTemplatesError(null);
      try {
        const res = await fetch(apiUrl("/esign/templates"), {
          headers: { ...authHeaders() },
          cache: "no-store",
        });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setTemplatesError(typeof body.error === "string" ? body.error : `Request failed (${res.status})`);
          setTemplates([]);
        } else {
          setTemplates(Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : []);
        }
      } catch (e) {
        if (!cancelled) {
          setTemplatesError(e instanceof Error ? e.message : "Could not load templates");
          setTemplates([]);
        }
      } finally {
        if (!cancelled) setTemplatesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authHeaders]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl("/processes?status=active"), {
          headers: { ...authHeaders() },
          cache: "no-store",
        });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        const list: ProcessOption[] = Array.isArray(body?.processes)
          ? body.processes.map((p: { id: number; name: string; propertyName?: string | null }) => ({
              id: p.id,
              name: p.name,
              propertyName: p.propertyName ?? null,
            }))
          : [];
        setProcesses(list);
      } catch {
        setProcesses([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authHeaders]);

  const templateFieldNames = useMemo(() => {
    if (!selectedTemplate) return [] as string[];
    const fromFields = Array.isArray(selectedTemplate.fields)
      ? selectedTemplate.fields.map((f) => f.name).filter((n): n is string => !!n)
      : [];
    return Array.from(new Set(fromFields));
  }, [selectedTemplate]);

  const updateSigner = (index: number, patch: Partial<SignerDraft>) => {
    setSigners((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const addSigner = () => setSigners((prev) => [...prev, emptySigner()]);
  const removeSigner = (index: number) =>
    setSigners((prev) => prev.filter((_, i) => i !== index));

  const canAdvanceFrom1 = !!selectedTemplate;
  const canAdvanceFrom2 = signers.some((s) => s.email.trim() && s.name.trim());

  const onSubmit = useCallback(async () => {
    if (!selectedTemplate) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const cleanSigners = signers
        .map((s) => ({ ...s, email: s.email.trim(), name: s.name.trim() }))
        .filter((s) => s.email);
      const payload = {
        templateId: selectedTemplate.id,
        templateName: selectedTemplate.name,
        propertyName: property?.propertyName || null,
        processId: processId || null,
        signers: cleanSigners,
        prefillFields: prefill,
      };
      const res = await fetch(apiUrl("/esign/send"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : `Send failed (${res.status})`);
      }
      onSent();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setSubmitting(false);
    }
  }, [authHeaders, prefill, processId, property?.propertyName, selectedTemplate, signers, onSent]);

  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>
            New Signing Request <span style={{ color: "#6a737b", fontWeight: 500 }}>· Step {step} of 5</span>
          </h2>
          <button className={styles.miniBtn} type="button" onClick={onClose}>
            Close
          </button>
        </div>

        {step === 1 && (
          <div>
            <p className={styles.stepLabel}>1. Choose a template</p>
            {templatesLoading && <p>Loading templates…</p>}
            {templatesError && (
              <div className={styles.empty}>
                <h3>Could not load templates</h3>
                <p>{templatesError}</p>
                <p>
                  Set up your first template in{" "}
                  <a href="https://sign.prestigedash.com" target="_blank" rel="noreferrer">
                    Docuseal
                  </a>
                  .
                </p>
              </div>
            )}
            {!templatesLoading && !templatesError && templates.length === 0 && (
              <div className={styles.empty}>
                <h3>No templates yet</h3>
                <p>
                  Create your first template in{" "}
                  <a href="https://sign.prestigedash.com" target="_blank" rel="noreferrer">
                    Docuseal
                  </a>
                  , then come back here to send it.
                </p>
              </div>
            )}
            {templates.length > 0 && (
              <div className={styles.templateGrid}>
                {templates.map((t) => {
                  const selected = selectedTemplate?.id === t.id;
                  const fieldCount = Array.isArray(t.fields) ? t.fields.length : 0;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className={`${styles.templateCard} ${selected ? styles.templateCardSelected : ""}`}
                      onClick={() => setSelectedTemplate(t)}
                    >
                      <div className={styles.templateCardName}>{t.name}</div>
                      <div className={styles.templateCardMeta}>
                        {fieldCount} field{fieldCount === 1 ? "" : "s"}
                        {t.folder_name ? ` · ${t.folder_name}` : ""}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div>
            <p className={styles.stepLabel}>2. Add signers</p>
            {signers.map((s, i) => (
              <div key={i} className={styles.formRow}>
                <input
                  className={styles.formInput}
                  placeholder="Name"
                  value={s.name}
                  onChange={(e) => updateSigner(i, { name: e.target.value })}
                />
                <input
                  className={styles.formInput}
                  placeholder="Email"
                  type="email"
                  value={s.email}
                  onChange={(e) => updateSigner(i, { email: e.target.value })}
                />
                <select
                  className={styles.formInput}
                  value={s.role}
                  onChange={(e) => updateSigner(i, { role: e.target.value })}
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                {signers.length > 1 && (
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnGhost}`}
                    onClick={() => removeSigner(i)}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={addSigner}
              style={{ marginTop: "0.5rem" }}
            >
              + Add another signer
            </button>
          </div>
        )}

        {step === 3 && (
          <div>
            <p className={styles.stepLabel}>3. Pre-fill template fields (optional)</p>
            {!selectedTemplate ? (
              <p>Select a template first.</p>
            ) : templateFieldNames.length === 0 ? (
              <p style={{ color: "#6a737b" }}>
                Docuseal didn&apos;t expose any pre-fillable fields for this template — signers will fill in everything.
              </p>
            ) : (
              <div>
                {templateFieldNames.map((name) => (
                  <div key={name} className={styles.formRow}>
                    <label
                      style={{ flex: "0 0 200px", color: "#1b2856", fontWeight: 600, fontSize: "0.85rem" }}
                    >
                      {name}
                    </label>
                    <input
                      className={styles.formInput}
                      value={prefill[name] ?? ""}
                      onChange={(e) =>
                        setPrefill((p) => ({ ...p, [name]: e.target.value }))
                      }
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 4 && (
          <div>
            <p className={styles.stepLabel}>4. Link to a property and process (optional)</p>
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ fontWeight: 600, fontSize: "0.85rem", color: "#1b2856" }}>Property</label>
              <PropertyPicker value={property} onChange={setProperty} />
            </div>
            <div className={styles.formRow}>
              <select
                className={styles.formInput}
                value={processId ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setProcessId(v ? Number(v) : null);
                }}
              >
                <option value="">— No linked process —</option>
                {processes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.propertyName ? ` (${p.propertyName})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <p style={{ color: "#6a737b", fontSize: "0.8rem", marginTop: "0.5rem" }}>
              When this signing request is completed, the linked process&apos;s next signing step will auto-complete.
            </p>
          </div>
        )}

        {step === 5 && (
          <div>
            <p className={styles.stepLabel}>5. Review &amp; send</p>
            <div style={{ background: "#f5f5f5", padding: "0.85rem", borderRadius: "10px", marginBottom: "0.75rem" }}>
              <div style={{ fontWeight: 700, color: "#1b2856" }}>{selectedTemplate?.name}</div>
              {property?.propertyName && (
                <div style={{ fontSize: "0.85rem", color: "#6a737b" }}>{property.propertyName}</div>
              )}
              <div style={{ marginTop: "0.5rem", fontSize: "0.85rem", color: "#1b2856" }}>
                <strong>Signers:</strong>
                <ul style={{ margin: "0.25rem 0 0 1rem" }}>
                  {signers
                    .filter((s) => s.email.trim())
                    .map((s, i) => (
                      <li key={i}>
                        {s.name} &lt;{s.email}&gt; · {s.role}
                      </li>
                    ))}
                </ul>
              </div>
              {Object.keys(prefill).length > 0 && (
                <div style={{ marginTop: "0.5rem", fontSize: "0.85rem", color: "#1b2856" }}>
                  <strong>Pre-filled:</strong>
                  <ul style={{ margin: "0.25rem 0 0 1rem" }}>
                    {Object.entries(prefill)
                      .filter(([, v]) => v !== "")
                      .map(([k, v]) => (
                        <li key={k}>
                          {k}: {v}
                        </li>
                      ))}
                  </ul>
                </div>
              )}
              {processId && (
                <div style={{ marginTop: "0.5rem", fontSize: "0.85rem", color: "#0098d0" }}>
                  Linked to process #{processId}
                </div>
              )}
            </div>
            {submitError && (
              <div style={{ color: "#b32317", fontSize: "0.85rem", marginBottom: "0.5rem" }}>
                {submitError}
              </div>
            )}
          </div>
        )}

        <div className={styles.modalFooter}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            onClick={() => (step === 1 ? onClose() : setStep((s) => (s - 1) as typeof step))}
            disabled={submitting}
          >
            {step === 1 ? "Cancel" : "Back"}
          </button>
          {step < 5 ? (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => setStep((s) => (s + 1) as typeof step)}
              disabled={(step === 1 && !canAdvanceFrom1) || (step === 2 && !canAdvanceFrom2)}
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={onSubmit}
              disabled={submitting}
            >
              {submitting ? "Sending…" : "Send for Signature"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
