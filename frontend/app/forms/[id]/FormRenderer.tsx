"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import SignatureCanvas from "react-signature-canvas";
import styles from "./form-renderer.module.css";
import type { ConditionalLogic, FormField, FormPage, FormSummary } from "../../(protected)/forms/types";

function publicApiUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";
  if (base) return `${base}${path}`;
  if (process.env.NODE_ENV === "development") return `http://localhost:4000${path}`;
  return `/api${path}`;
}

type FormData = Record<string, unknown>;

function evaluateCondition(
  condition: { fieldKey: string; operator: string; value: string },
  values: FormData
): boolean {
  const actual = values[condition.fieldKey];
  const strActual = actual == null ? "" : String(actual);
  const strValue = condition.value ?? "";
  switch (condition.operator) {
    case "equals": return strActual === strValue;
    case "not_equals": return strActual !== strValue;
    case "contains": return strActual.toLowerCase().includes(strValue.toLowerCase());
    case "not_contains": return !strActual.toLowerCase().includes(strValue.toLowerCase());
    case "starts_with": return strActual.toLowerCase().startsWith(strValue.toLowerCase());
    case "ends_with": return strActual.toLowerCase().endsWith(strValue.toLowerCase());
    case "greater_than": return Number(actual) > Number(condition.value);
    case "less_than": return Number(actual) < Number(condition.value);
    case "is_empty": return actual == null || actual === "" || (Array.isArray(actual) && !actual.length);
    case "is_not_empty": return !(actual == null || actual === "" || (Array.isArray(actual) && !actual.length));
    default: return false;
  }
}

function evaluateLogic(
  logic: ConditionalLogic | null | undefined,
  values: FormData
): { visible: boolean; requiredOverride: boolean | null } {
  if (!logic || !logic.enabled || !logic.conditions?.length) {
    return { visible: true, requiredOverride: null };
  }
  const results = logic.conditions.map((c) => evaluateCondition(c, values));
  const matched = logic.logic === "any" ? results.some(Boolean) : results.every(Boolean);
  if (logic.action === "show") return { visible: matched, requiredOverride: null };
  if (logic.action === "hide") return { visible: !matched, requiredOverride: null };
  if (logic.action === "require") return { visible: true, requiredOverride: matched };
  if (logic.action === "unrequire") return { visible: true, requiredOverride: !matched };
  return { visible: true, requiredOverride: null };
}

function getSessionId(): string {
  if (typeof window === "undefined") return "";
  try {
    let sid = sessionStorage.getItem("form_session");
    if (!sid) {
      sid = (typeof crypto !== "undefined" && "randomUUID" in crypto)
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now();
      sessionStorage.setItem("form_session", sid);
    }
    return sid;
  } catch {
    return "";
  }
}

function trackEvent(slug: string, eventType: string, eventData: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  const sessionId = getSessionId();
  const body = JSON.stringify({ eventType, eventData, sessionId });
  const url = publicApiUrl(`/forms/public/${slug}/analytics`);
  try {
    if ("sendBeacon" in navigator) {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon(url, blob);
      return;
    }
  } catch {/* fall through */}
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true })
    .catch(() => {/* ignore */});
}

export default function FormRenderer({ slug }: { slug: string }) {
  const searchParams = useSearchParams();
  const token = searchParams?.get("token") || "";
  const isEmbed = searchParams?.get("embed") === "true";

  const [form, setForm] = useState<FormSummary | null>(null);
  const [pages, setPages] = useState<FormPage[]>([]);
  const [fields, setFields] = useState<FormField[]>([]);
  const [values, setValues] = useState<FormData>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [currentPageIdx, setCurrentPageIdx] = useState(0);
  const hasStartedRef = useRef(false);
  const submittedRef = useRef(false);
  const currentPageIdRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (token) params.set("token", token);
      searchParams?.forEach((v, k) => { if (k !== "embed") params.set(k, v); });
      const res = await fetch(publicApiUrl(`/forms/public/${slug}?${params.toString()}`));
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Could not load form.");
      }
      const body = await res.json();
      setForm(body.form);
      setPages(body.pages || []);
      setFields(body.fields || []);
      // Seed defaults
      const init: FormData = {};
      for (const f of body.fields as FormField[]) {
        if (f.defaultValue != null) init[f.fieldKey] = f.defaultValue;
      }
      // Fetch prefill
      const prefillRes = await fetch(publicApiUrl(`/forms/public/${slug}/prefill?${params.toString()}`));
      if (prefillRes.ok) {
        const p = await prefillRes.json();
        Object.assign(init, p.prefill || {});
      }
      setValues(init);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "Could not load form.");
    } finally {
      setLoading(false);
    }
  }, [slug, token, searchParams]);

  useEffect(() => { load(); }, [load]);

  // Analytics: form_view (once after load)
  useEffect(() => {
    if (!form) return;
    trackEvent(slug, "form_view", { referrer: typeof document !== "undefined" ? document.referrer : "" });
  }, [form, slug]);

  // Analytics: form_abandon on unload if started but not submitted
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onUnload = () => {
      if (hasStartedRef.current && !submittedRef.current) {
        trackEvent(slug, "form_abandon", { lastPageId: currentPageIdRef.current });
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [slug]);

  const trackStartOnce = () => {
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;
    trackEvent(slug, "form_start");
  };

  const setValue = (key: string, v: unknown) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const visibleFields = useMemo(() => {
    return fields.filter((f) => {
      const { visible } = evaluateLogic(f.conditionalLogic, values);
      return visible;
    });
  }, [fields, values]);

  const visiblePages = useMemo(() => {
    // Evaluate page-level visibility (simple pass-through if none)
    return pages;
  }, [pages]);

  const currentPage = visiblePages[currentPageIdx] ?? null;
  const isMultiStep = pages.length > 1;

  const currentPageFields = useMemo(() => {
    if (!currentPage) return visibleFields;
    return visibleFields.filter((f) => f.pageId === currentPage.id);
  }, [visibleFields, currentPage]);

  const validatePage = (pageFields: FormField[]): boolean => {
    const newErrors: Record<string, string> = {};
    for (const f of pageFields) {
      if (["heading", "paragraph", "divider", "spacer"].includes(f.fieldType)) continue;
      const { requiredOverride } = evaluateLogic(f.conditionalLogic, values);
      const isRequired = requiredOverride !== null ? requiredOverride : f.isRequired;
      const val = values[f.fieldKey];
      const isEmpty = val == null || val === "" || (Array.isArray(val) && !val.length);
      if (isRequired && isEmpty) {
        newErrors[f.fieldKey] = (f.validation?.errorMessage as string) || `${f.label} is required.`;
        continue;
      }
      if (!isEmpty && f.fieldType === "email" && typeof val === "string") {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
          newErrors[f.fieldKey] = "Please enter a valid email.";
        }
      }
    }
    setErrors((prev) => ({ ...prev, ...newErrors }));
    // Track field errors
    for (const fieldKey of Object.keys(newErrors)) {
      trackEvent(slug, "field_error", { fieldKey });
    }
    return Object.keys(newErrors).length === 0;
  };

  const nextPage = () => {
    if (!validatePage(currentPageFields)) return;
    const currentPageId = currentPage?.id ?? null;
    setCurrentPageIdx((i) => {
      const next = Math.min(i + 1, visiblePages.length - 1);
      const nextPageObj = visiblePages[next];
      trackEvent(slug, "page_view", { pageId: nextPageObj?.id ?? null, pageIndex: next });
      // Mark the outgoing page as completed (not dropped) — no event needed
      return next;
    });
    currentPageIdRef.current = currentPageId;
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const prevPage = () => {
    setCurrentPageIdx((i) => Math.max(i - 1, 0));
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  useEffect(() => {
    currentPageIdRef.current = currentPage?.id ?? null;
  }, [currentPage]);

  // Fire page_view for the initial page once loaded
  useEffect(() => {
    if (!form || !currentPage) return;
    trackEvent(slug, "page_view", { pageId: currentPage.id, pageIndex: currentPageIdx });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form?.id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitErr(null);
    // Validate all visible fields across all pages
    if (!validatePage(visibleFields)) return;
    if (!form) return;
    setSubmitting(true);
    try {
      // Filter out hidden-by-logic values
      const payload: FormData = {};
      for (const f of visibleFields) {
        if (f.fieldKey in values) payload[f.fieldKey] = values[f.fieldKey];
      }
      const params = new URLSearchParams();
      if (token) params.set("token", token);
      const res = await fetch(publicApiUrl(`/forms/public/${slug}/submit?${params.toString()}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: payload }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body.details && Array.isArray(body.details)) {
          throw new Error(body.details.join(" "));
        }
        throw new Error(body.error || "Submit failed.");
      }
      if (body.successRedirectUrl) {
        window.location.href = body.successRedirectUrl;
        return;
      }
      submittedRef.current = true;
      trackEvent(slug, "form_submit", { submissionId: body.submissionId });
      setSuccessMsg(body.successMessage || "Thank you!");
      setSubmitted(true);
    } catch (ex) {
      setSubmitErr(ex instanceof Error ? ex.message : "Submit failed.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className={styles.page}><div className={styles.loading}>Loading form…</div></div>;
  }
  if (loadErr) {
    return (
      <div className={styles.page}>
        <div className={styles.container}>
          <div className={styles.formCard}>
            <h1 className={styles.title}>Form unavailable</h1>
            <p className={styles.description}>{loadErr}</p>
          </div>
        </div>
      </div>
    );
  }
  if (submitted) {
    return (
      <div className={styles.page}>
        {!isEmbed && form ? (
          <div className={styles.header}>
            <div className={styles.headerInner}>
              <div className={styles.brand}>Real Property Management Prestige</div>
            </div>
          </div>
        ) : null}
        <div className={styles.container}>
          <div className={styles.successBox}>
            <div className={styles.successIcon}>✓</div>
            <h1 className={styles.successTitle}>Submitted</h1>
            <p className={styles.successMessage}>{successMsg}</p>
          </div>
        </div>
      </div>
    );
  }
  if (!form) return null;

  return (
    <div className={styles.page}>
      {!isEmbed ? (
        <div className={styles.header}>
          <div className={styles.headerInner}>
            <div className={styles.brand}>Real Property Management Prestige</div>
          </div>
        </div>
      ) : null}
      <div className={styles.container}>
        <form className={styles.formCard} onSubmit={submit} onFocusCapture={trackStartOnce} noValidate>
          <h1 className={styles.title}>{form.name}</h1>
          {form.description ? <p className={styles.description}>{form.description}</p> : null}

          {isMultiStep ? (
            <div className={styles.progressBar}>
              <div className={styles.progressTrack}>
                <div
                  className={styles.progressFill}
                  style={{ width: `${((currentPageIdx + 1) / visiblePages.length) * 100}%` }}
                />
              </div>
              <div className={styles.progressText}>
                Step {currentPageIdx + 1} of {visiblePages.length}
              </div>
            </div>
          ) : null}

          {currentPage ? (
            <>
              {currentPage.title ? <h2 className={styles.pageTitle}>{currentPage.title}</h2> : null}
              {currentPage.description ? <p className={styles.pageDesc}>{currentPage.description}</p> : null}
            </>
          ) : null}

          {submitErr ? <div className={styles.errorBanner}>{submitErr}</div> : null}

          <div className={styles.fieldsWrap}>
            {currentPageFields.map((f) => (
              <FieldRenderer
                key={f.id}
                field={f}
                value={values[f.fieldKey]}
                error={errors[f.fieldKey]}
                setValue={(v) => setValue(f.fieldKey, v)}
              />
            ))}
          </div>

          <div className={styles.actions}>
            {isMultiStep && currentPageIdx > 0 ? (
              <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={prevPage}>
                Previous
              </button>
            ) : null}
            {isMultiStep && currentPageIdx < visiblePages.length - 1 ? (
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={nextPage}>
                Next
              </button>
            ) : (
              <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={submitting}>
                {submitting ? "Submitting…" : (form.submitButtonText || "Submit")}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

function FieldRenderer({
  field, value, error, setValue,
}: {
  field: FormField;
  value: unknown;
  error?: string;
  setValue: (v: unknown) => void;
}) {
  const cfg = (field.fieldConfig || {}) as Record<string, unknown>;
  if (field.isHidden) return null;

  const width = field.layout?.width || "full";
  const widthClass = width === "half" ? styles.fieldHalf : width === "third" ? styles.fieldThird : "";

  const isLayoutType = ["heading", "paragraph", "divider", "spacer"].includes(field.fieldType);

  return (
    <div className={`${styles.field} ${widthClass}`}>
      {!isLayoutType ? (
        <>
          <label className={styles.label}>
            {field.label}
            {field.isRequired ? <span className={styles.required}> *</span> : null}
          </label>
          {field.description ? <p className={styles.description2}>{field.description}</p> : null}
        </>
      ) : null}
      <FieldControl field={field} value={value} setValue={setValue} error={error} />
      {field.helpText && !isLayoutType ? <div className={styles.helpText}>{field.helpText}</div> : null}
      {error ? <div className={styles.errorMsg}>{error}</div> : null}
    </div>
  );
}

function FieldControl({
  field, value, setValue, error,
}: {
  field: FormField;
  value: unknown;
  setValue: (v: unknown) => void;
  error?: string;
}) {
  const cfg = (field.fieldConfig || {}) as Record<string, unknown>;
  const errClass = error ? styles.inputError : "";

  switch (field.fieldType) {
    case "text":
      return <input type="text" className={`${styles.input} ${errClass}`} value={(value as string) || ""} onChange={(e) => setValue(e.target.value)} placeholder={field.placeholder || ""} />;
    case "textarea":
      return <textarea className={`${styles.textarea} ${errClass}`} value={(value as string) || ""} onChange={(e) => setValue(e.target.value)} placeholder={field.placeholder || ""} />;
    case "email":
      return <input type="email" className={`${styles.input} ${errClass}`} value={(value as string) || ""} onChange={(e) => setValue(e.target.value)} placeholder={field.placeholder || ""} />;
    case "phone":
      return <input type="tel" className={`${styles.input} ${errClass}`} value={(value as string) || ""} onChange={(e) => setValue(e.target.value)} placeholder={field.placeholder || "(555) 555-5555"} />;
    case "number":
      return <input type="number" className={`${styles.input} ${errClass}`} value={(value as string) || ""} onChange={(e) => setValue(e.target.value)} placeholder={field.placeholder || ""} />;
    case "currency":
      return <input type="number" step="0.01" className={`${styles.input} ${errClass}`} value={(value as string) || ""} onChange={(e) => setValue(e.target.value)} placeholder="0.00" />;
    case "date":
      return <input type="date" className={`${styles.input} ${errClass}`} value={(value as string) || ""} onChange={(e) => setValue(e.target.value)} />;
    case "time":
      return <input type="time" className={`${styles.input} ${errClass}`} value={(value as string) || ""} onChange={(e) => setValue(e.target.value)} />;
    case "datetime":
      return <input type="datetime-local" className={`${styles.input} ${errClass}`} value={(value as string) || ""} onChange={(e) => setValue(e.target.value)} />;
    case "dropdown": {
      const options = (cfg.options as string[]) || [];
      return (
        <select className={`${styles.select} ${errClass}`} value={(value as string) || ""} onChange={(e) => setValue(e.target.value)}>
          <option value="">Choose…</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    case "radio": {
      const options = (cfg.options as string[]) || [];
      const layout = cfg.layout === "horizontal" ? styles.radioGroupH : "";
      return (
        <div className={`${styles.radioGroup} ${layout}`}>
          {options.map((o) => (
            <label key={o} className={styles.radioItem}>
              <input type="radio" name={field.fieldKey} value={o} checked={value === o} onChange={() => setValue(o)} />
              {o}
            </label>
          ))}
        </div>
      );
    }
    case "checkbox":
    case "multiselect": {
      const options = (cfg.options as string[]) || [];
      const selected = Array.isArray(value) ? (value as string[]) : [];
      const layout = cfg.layout === "horizontal" ? styles.checkboxGroupH : "";
      return (
        <div className={`${styles.checkboxGroup} ${layout}`}>
          {options.map((o) => (
            <label key={o} className={styles.checkboxItem}>
              <input
                type="checkbox"
                checked={selected.includes(o)}
                onChange={(e) => {
                  if (e.target.checked) setValue([...selected, o]);
                  else setValue(selected.filter((s) => s !== o));
                }}
              />
              {o}
            </label>
          ))}
        </div>
      );
    }
    case "yesno": {
      const t = (cfg.trueLabel as string) || "Yes";
      const f = (cfg.falseLabel as string) || "No";
      return (
        <div className={styles.yesnoGroup}>
          <button type="button" className={`${styles.yesnoBtn} ${value === t ? styles.yesnoBtnActive : ""}`} onClick={() => setValue(t)}>{t}</button>
          <button type="button" className={`${styles.yesnoBtn} ${value === f ? styles.yesnoBtnActive : ""}`} onClick={() => setValue(f)}>{f}</button>
        </div>
      );
    }
    case "address": {
      const v = (value as Record<string, string>) || {};
      const set = (k: string, val: string) => setValue({ ...v, [k]: val });
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <input type="text" className={styles.input} placeholder="Street Address" value={v.street || ""} onChange={(e) => set("street", e.target.value)} />
          {(cfg.showStreet2 !== false) ? (
            <input type="text" className={styles.input} placeholder="Street Address 2" value={v.street2 || ""} onChange={(e) => set("street2", e.target.value)} />
          ) : null}
          <div className={styles.addressGrid}>
            <input type="text" className={styles.input} placeholder="City" value={v.city || ""} onChange={(e) => set("city", e.target.value)} />
            <input type="text" className={styles.input} placeholder="State" value={v.state || ""} onChange={(e) => set("state", e.target.value)} />
          </div>
          <input type="text" className={styles.input} placeholder="ZIP Code" value={v.zip || ""} onChange={(e) => set("zip", e.target.value)} />
        </div>
      );
    }
    case "fullname": {
      const v = (value as Record<string, string>) || {};
      const set = (k: string, val: string) => setValue({ ...v, [k]: val });
      return (
        <div className={styles.nameGrid}>
          <input type="text" className={styles.input} placeholder="First" value={v.first || ""} onChange={(e) => set("first", e.target.value)} />
          {cfg.showMiddle ? (
            <input type="text" className={styles.input} placeholder="Middle" value={v.middle || ""} onChange={(e) => set("middle", e.target.value)} />
          ) : null}
          <input type="text" className={styles.input} placeholder="Last" value={v.last || ""} onChange={(e) => set("last", e.target.value)} />
        </div>
      );
    }
    case "rating": {
      const max = (cfg.max as number) || 5;
      const current = Number(value) || 0;
      return (
        <div className={styles.ratingRow}>
          {Array.from({ length: max }).map((_, i) => (
            <button
              key={i}
              type="button"
              className={`${styles.ratingBtn} ${i < current ? styles.ratingBtnActive : ""}`}
              onClick={() => setValue(i + 1)}
              aria-label={`${i + 1} star${i > 0 ? "s" : ""}`}
            >★</button>
          ))}
        </div>
      );
    }
    case "scale": {
      const min = (cfg.min as number) || 1;
      const max = (cfg.max as number) || 10;
      const current = Number(value);
      return (
        <div>
          <div className={styles.scaleRow}>
            {Array.from({ length: max - min + 1 }, (_, i) => min + i).map((n) => (
              <button
                key={n}
                type="button"
                className={`${styles.scaleBtn} ${current === n ? styles.scaleBtnActive : ""}`}
                onClick={() => setValue(n)}
              >{n}</button>
            ))}
          </div>
          <div className={styles.scaleLabels}>
            <span>{(cfg.minLabel as string) || ""}</span>
            <span>{(cfg.maxLabel as string) || ""}</span>
          </div>
        </div>
      );
    }
    case "signature":
      return <SignatureField value={value as string} setValue={setValue} />;
    case "file":
    case "image":
      return <FileField field={field} value={value} setValue={setValue} />;
    case "heading": {
      const level = (cfg.level as string) || "h2";
      const Tag = (level as keyof JSX.IntrinsicElements);
      return <Tag style={{ margin: "0.5rem 0", color: "#1b2856", textAlign: (cfg.align as "left" | "center" | "right") || "left" }}>{field.label}</Tag>;
    }
    case "paragraph":
      return <p style={{ margin: "0.5rem 0", color: "#1b2856", lineHeight: 1.55, textAlign: (cfg.align as "left" | "center" | "right") || "left" }}>{(cfg.content as string) || field.label}</p>;
    case "divider":
      return <hr style={{ border: "none", borderTop: "1px solid #e5e7eb", margin: "0.5rem 0" }} />;
    case "spacer":
      return <div style={{ height: (cfg.height as number) || 24 }} />;
    case "hidden":
      return null;
    default:
      return <input type="text" className={styles.input} value={(value as string) || ""} onChange={(e) => setValue(e.target.value)} />;
  }
}

function SignatureField({ value, setValue }: { value: string; setValue: (v: unknown) => void }) {
  const ref = useRef<SignatureCanvas>(null);
  const [hasSig, setHasSig] = useState(!!value);
  return (
    <div>
      <SignatureCanvas
        ref={ref}
        penColor="#1b2856"
        canvasProps={{ className: styles.sigCanvas }}
        onEnd={() => {
          const dataUrl = ref.current?.toDataURL("image/png") || "";
          setHasSig(true);
          setValue(dataUrl);
        }}
      />
      <div>
        <button
          type="button"
          className={styles.sigClearBtn}
          onClick={() => { ref.current?.clear(); setHasSig(false); setValue(""); }}
        >Clear</button>
      </div>
    </div>
  );
}

function FileField({
  field, value, setValue,
}: {
  field: FormField;
  value: unknown;
  setValue: (v: unknown) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const fileList = Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];

  const slug = typeof window !== "undefined" ? window.location.pathname.split("/").pop() : "";

  const upload = async (files: FileList) => {
    setUploading(true);
    const results: Array<Record<string, unknown>> = [...fileList];
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append("file", file);
      try {
        const res = await fetch(publicApiUrl(`/forms/public/${slug}/upload`), { method: "POST", body: fd });
        if (res.ok) {
          const body = await res.json();
          results.push(body);
        }
      } catch {/* ignore */}
    }
    setValue(results);
    setUploading(false);
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        multiple={field.fieldType !== "image"}
        accept={(field.fieldConfig?.acceptTypes as string) || undefined}
        style={{ display: "none" }}
        onChange={(e) => e.target.files && upload(e.target.files)}
      />
      <div className={styles.fileUpload} onClick={() => inputRef.current?.click()}>
        {uploading ? "Uploading…" : fileList.length ? `${fileList.length} file(s) uploaded — click to add more` : "Click to upload files"}
      </div>
      {fileList.length ? (
        <ul style={{ margin: "0.5rem 0 0", padding: 0, listStyle: "none", fontSize: "0.85rem", color: "#1b2856" }}>
          {fileList.map((f, i) => (
            <li key={i} style={{ padding: "0.25rem 0" }}>📎 {String((f as Record<string, unknown>).originalName || "file")}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
