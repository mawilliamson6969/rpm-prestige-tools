"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../../../context/AuthContext";
import { apiUrl } from "../../../../lib/api";
import styles from "./compose.module.css";

// ─── Types ────────────────────────────────────────────────────────────────────

type MailType = "certified" | "certified_return_receipt" | "first_class" | "priority" | "postcard" | "marketing";

type Document = {
  id: number;
  title: string;
  content: string;
  folder: string;
};

const MAIL_TYPES: { value: MailType; label: string; description: string; estimatedCost: string; color: string }[] = [
  { value: "certified", label: "Certified Mail", description: "USPS tracking, signature required", estimatedCost: "~$8–10", color: "#0098D0" },
  { value: "certified_return_receipt", label: "Certified + Return Receipt", description: "Certified with green card returned to you", estimatedCost: "~$11–13", color: "#0098D0" },
  { value: "first_class", label: "First Class", description: "Standard USPS first class delivery", estimatedCost: "~$1–2", color: "#6A737B" },
  { value: "priority", label: "Priority Mail", description: "Priority delivery, 1–3 business days", estimatedCost: "~$9–12", color: "#d97706" },
  { value: "postcard", label: "Postcard", description: "Full-color postcard, no envelope", estimatedCost: "~$1–3", color: "#0d9488" },
  { value: "marketing", label: "Marketing Mail", description: "Bulk marketing, discounted USPS rates", estimatedCost: "~$0.30–0.50", color: "#7c3aed" },
];

const LETTER_CATEGORIES = [
  { value: "eviction", label: "Eviction Notice" },
  { value: "violation", label: "Lease Violation" },
  { value: "termination", label: "Owner Termination" },
  { value: "move_out", label: "Move-Out Letter" },
  { value: "deposit", label: "Security Deposit" },
  { value: "general", label: "General Notice" },
  { value: "marketing", label: "Marketing" },
  { value: "other", label: "Other" },
];

const EDITOR_TOOLBAR = `
<div class="toolbar">
  <button onclick="document.execCommand('bold')" title="Bold"><b>B</b></button>
  <button onclick="document.execCommand('italic')" title="Italic"><i>I</i></button>
  <button onclick="document.execCommand('underline')" title="Underline"><u>U</u></button>
  <button onclick="document.execCommand('insertUnorderedList')" title="Bullet list">• List</button>
  <button onclick="document.execCommand('insertOrderedList')" title="Numbered list">1. List</button>
  <select onchange="document.execCommand('formatBlock', false, this.value); this.value=''">
    <option value="">Format</option>
    <option value="p">Paragraph</option>
    <option value="h1">Heading 1</option>
    <option value="h2">Heading 2</option>
    <option value="h3">Heading 3</option>
  </select>
</div>`;

// ─── Component ────────────────────────────────────────────────────────────────

export default function ComposeMailerClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { authHeaders, user } = useAuth();

  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Step 1 — template / mail type
  const [mailType, setMailType] = useState<MailType>("certified");
  const [documents, setDocuments] = useState<Document[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);

  // Step 2 — compose
  const [letterTitle, setLetterTitle] = useState("");
  const [letterHtml, setLetterHtml] = useState("<p>Dear [Name],</p><p></p><p>Sincerely,<br>Real Property Management Prestige</p>");
  const editorRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Step 3 — recipient
  const [recipientName, setRecipientName] = useState("");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [recipientCity, setRecipientCity] = useState("Houston");
  const [recipientState, setRecipientState] = useState("TX");
  const [recipientZip, setRecipientZip] = useState("");
  const [propertyAddress, setPropertyAddress] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [letterCategory, setLetterCategory] = useState("");
  const [notes, setNotes] = useState("");

  // Autocomplete suggestions
  const [suggestions, setSuggestions] = useState<{ field: string; values: string[] } | null>(null);

  // ── On mount: check if coming from documents page ──────────────────────────
  useEffect(() => {
    const docId = searchParams?.get("document_id");
    if (!docId) return;

    fetch(apiUrl(`/documents/${docId}`), { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        if (d.document) {
          setLetterTitle(d.document.title);
          setLetterHtml(d.document.content || "");
          setStep(2);
        }
      })
      .catch(() => {});
  }, [searchParams, authHeaders]);

  // ── Load documents for step 1 chooser ─────────────────────────────────────
  useEffect(() => {
    if (step !== 1) return;
    setDocsLoading(true);
    fetch(apiUrl("/documents"), { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setDocuments(d.documents || []))
      .catch(() => setDocuments([]))
      .finally(() => setDocsLoading(false));
  }, [step, authHeaders]);

  // ── Editor: sync contenteditable → letterHtml ─────────────────────────────
  const syncHtml = useCallback(() => {
    if (editorRef.current) {
      setLetterHtml(editorRef.current.innerHTML);
    }
  }, []);

  // ── Update letterhead preview iframe ──────────────────────────────────────
  useEffect(() => {
    if (!iframeRef.current) return;
    const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const preview = `<!DOCTYPE html><html><head><style>
      body{font-family:Arial,sans-serif;font-size:11pt;margin:32px;color:#222}
      .lh{border-bottom:3px solid #1B2856;padding-bottom:10px;margin-bottom:20px;display:flex;justify-content:space-between}
      .brand{font-size:15pt;font-weight:bold;color:#1B2856}
      .addr{font-size:9pt;color:#6A737B;margin-top:3px}
      .date{font-size:10pt;color:#6A737B}
      .recip{margin-bottom:20px;line-height:1.6}
      .body p{margin-bottom:8px}
      .footer{margin-top:32px;padding-top:10px;border-top:1px solid #ddd;font-size:8pt;color:#9ca3af;text-align:center}
    </style></head><body>
    <div class="lh"><div><div class="brand">Real Property Management Prestige</div><div class="addr">4811 Hwy 6 N, Suite B<br>Houston, TX 77084</div></div><div class="date">${date}</div></div>
    <div class="recip">${recipientName || "[Recipient Name]"}<br>${recipientAddress || "[Address]"}<br>${recipientCity}, ${recipientState} ${recipientZip || "[ZIP]"}</div>
    <div class="body">${letterHtml}</div>
    <div class="footer">Real Property Management Prestige | Houston, TX | (281) 984-7463</div>
    </body></html>`;
    const doc = iframeRef.current.contentDocument;
    if (doc) {
      doc.open();
      doc.write(preview);
      doc.close();
    }
  }, [letterHtml, recipientName, recipientAddress, recipientCity, recipientState, recipientZip]);

  // ── Autocomplete ───────────────────────────────────────────────────────────
  async function fetchSuggestions(field: string, q: string) {
    if (!q.trim()) { setSuggestions(null); return; }
    const r = await fetch(apiUrl(`/mailers/suggestions?field=${field}&q=${encodeURIComponent(q)}`), {
      headers: authHeaders(),
    });
    const d = await r.json();
    setSuggestions({ field, values: d.suggestions || [] });
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function handleSave(sendNow: boolean) {
    setError("");
    if (!letterTitle.trim()) { setError("Letter title is required."); return; }
    if (!recipientName.trim()) { setError("Recipient name is required."); return; }
    if (!recipientAddress.trim()) { setError("Recipient address is required."); return; }
    if (!recipientZip.trim()) { setError("Recipient ZIP is required."); return; }

    setSubmitting(true);
    try {
      // 1. Create mailer
      const createResp = await fetch(apiUrl("/mailers"), {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          letter_title: letterTitle.trim(),
          letter_html: letterHtml,
          mail_type: mailType,
          recipient_name: recipientName.trim(),
          recipient_address: recipientAddress.trim(),
          recipient_city: recipientCity.trim() || "Houston",
          recipient_state: recipientState.trim() || "TX",
          recipient_zip: recipientZip.trim(),
          property_address: propertyAddress.trim() || undefined,
          owner_name: ownerName.trim() || undefined,
          tenant_name: tenantName.trim() || undefined,
          letter_category: letterCategory || undefined,
          notes: notes.trim() || undefined,
          sent_by: user?.displayName || user?.username || "Mike",
        }),
      });
      const createData = await createResp.json();
      if (!createResp.ok) {
        setError(createData.error || "Failed to create mailer.");
        return;
      }

      const mailer = createData.mailer;

      // 2. Optionally send
      if (sendNow) {
        const sendResp = await fetch(apiUrl(`/mailers/${mailer.id}/send`), {
          method: "POST",
          headers: authHeaders(),
        });
        const sendData = await sendResp.json();
        if (!sendResp.ok) {
          // Saved as draft, but send failed
          setError(`Saved as draft, but send failed: ${sendData.error}`);
          router.push("/mailers");
          return;
        }
      }

      router.push("/mailers");
    } catch (e) {
      setError("An unexpected error occurred.");
    } finally {
      setSubmitting(false);
    }
  }

  function loadDocument(doc: Document) {
    setLetterTitle(doc.title);
    setLetterHtml(doc.content || "");
    setStep(2);
  }

  // ── Step renders ───────────────────────────────────────────────────────────

  function renderStep1() {
    return (
      <div className={styles.stepContent}>
        <h2 className={styles.stepTitle}>Choose Mail Type & Template</h2>
        <p className={styles.stepDesc}>Pick a mail type and optionally start from an existing document.</p>

        <h3 className={styles.subHeading}>Mail Type</h3>
        <div className={styles.mailTypeGrid}>
          {MAIL_TYPES.map((mt) => (
            <button
              key={mt.value}
              className={`${styles.mailTypeCard} ${mailType === mt.value ? styles.mailTypeCardActive : ""}`}
              style={{ borderColor: mailType === mt.value ? mt.color : undefined }}
              onClick={() => setMailType(mt.value)}
            >
              <span className={styles.mailTypeDot} style={{ background: mt.color }} />
              <div>
                <div className={styles.mailTypeLabel}>{mt.label}</div>
                <div className={styles.mailTypeDesc}>{mt.description}</div>
                <div className={styles.mailTypeCost}>{mt.estimatedCost}</div>
              </div>
            </button>
          ))}
        </div>

        <h3 className={styles.subHeading}>Start from Document (optional)</h3>
        {docsLoading ? (
          <p className={styles.loading}>Loading documents…</p>
        ) : (
          <div className={styles.docGrid}>
            <button
              className={styles.docCard}
              onClick={() => { setLetterTitle(""); setLetterHtml("<p>Dear [Name],</p><p></p><p>Sincerely,<br>Real Property Management Prestige</p>"); setStep(2); }}
            >
              <div className={styles.docCardIcon}>📄</div>
              <div className={styles.docCardTitle}>Blank Letter</div>
            </button>
            {documents.slice(0, 11).map((doc) => (
              <button key={doc.id} className={styles.docCard} onClick={() => loadDocument(doc)}>
                <div className={styles.docCardIcon}>📝</div>
                <div className={styles.docCardTitle}>{doc.title}</div>
                <div className={styles.docCardFolder}>{doc.folder}</div>
              </button>
            ))}
          </div>
        )}

        <div className={styles.stepFooter}>
          <Link href="/mailers" className={styles.btnSecondary}>Cancel</Link>
          <button className={styles.btnPrimary} onClick={() => setStep(2)}>
            Next: Compose →
          </button>
        </div>
      </div>
    );
  }

  function renderStep2() {
    return (
      <div className={styles.composeLayout}>
        <div className={styles.composeLeft}>
          <h2 className={styles.stepTitle}>Compose Letter</h2>
          <div className={styles.formField}>
            <label className={styles.label}>Letter Title</label>
            <input
              className={styles.input}
              value={letterTitle}
              onChange={(e) => setLetterTitle(e.target.value)}
              placeholder="e.g. Lease Violation Notice — 123 Main St"
            />
          </div>

          <div className={styles.formField}>
            <label className={styles.label}>Letter Body</label>
            <div className={styles.editorToolbar}>
              <button onMouseDown={(e) => { e.preventDefault(); document.execCommand("bold"); editorRef.current?.focus(); }} title="Bold"><b>B</b></button>
              <button onMouseDown={(e) => { e.preventDefault(); document.execCommand("italic"); editorRef.current?.focus(); }} title="Italic"><i>I</i></button>
              <button onMouseDown={(e) => { e.preventDefault(); document.execCommand("underline"); editorRef.current?.focus(); }} title="Underline"><u>U</u></button>
              <button onMouseDown={(e) => { e.preventDefault(); document.execCommand("insertUnorderedList"); editorRef.current?.focus(); }} title="Bullet list">• List</button>
              <button onMouseDown={(e) => { e.preventDefault(); document.execCommand("insertOrderedList"); editorRef.current?.focus(); }} title="Numbered">1. List</button>
            </div>
            <div
              ref={editorRef}
              className={styles.editor}
              contentEditable
              suppressContentEditableWarning
              onInput={syncHtml}
              dangerouslySetInnerHTML={{ __html: letterHtml }}
            />
          </div>

          <div className={styles.stepFooter}>
            <button className={styles.btnSecondary} onClick={() => setStep(1)}>← Back</button>
            <button className={styles.btnPrimary} onClick={() => { syncHtml(); setStep(3); }}>
              Next: Recipient →
            </button>
          </div>
        </div>

        <div className={styles.composeRight}>
          <h3 className={styles.previewLabel}>Live Preview</h3>
          <div className={styles.previewWrap}>
            <iframe ref={iframeRef} className={styles.previewFrame} title="Letter preview" />
          </div>
        </div>
      </div>
    );
  }

  function renderStep3() {
    return (
      <div className={styles.stepContent}>
        <h2 className={styles.stepTitle}>Recipient Details</h2>
        <div className={styles.formGrid}>
          <div className={styles.formField} style={{ gridColumn: "1 / -1" }}>
            <label className={styles.label}>Recipient Name *</label>
            <input className={styles.input} value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="John Smith" />
          </div>
          <div className={styles.formField} style={{ gridColumn: "1 / -1" }}>
            <label className={styles.label}>Street Address *</label>
            <input className={styles.input} value={recipientAddress} onChange={(e) => setRecipientAddress(e.target.value)} placeholder="123 Main St" />
          </div>
          <div className={styles.formField}>
            <label className={styles.label}>City</label>
            <input className={styles.input} value={recipientCity} onChange={(e) => setRecipientCity(e.target.value)} />
          </div>
          <div className={styles.formField}>
            <label className={styles.label}>State</label>
            <input className={styles.input} value={recipientState} onChange={(e) => setRecipientState(e.target.value)} maxLength={2} />
          </div>
          <div className={styles.formField}>
            <label className={styles.label}>ZIP *</label>
            <input className={styles.input} value={recipientZip} onChange={(e) => setRecipientZip(e.target.value)} placeholder="77001" />
          </div>
        </div>

        <h3 className={styles.subHeading}>Property & People</h3>
        <div className={styles.formGrid}>
          <div className={styles.formField} style={{ position: "relative" }}>
            <label className={styles.label}>Property Address</label>
            <input
              className={styles.input}
              value={propertyAddress}
              onChange={(e) => { setPropertyAddress(e.target.value); fetchSuggestions("property_address", e.target.value); }}
              onBlur={() => setTimeout(() => setSuggestions(null), 150)}
              placeholder="123 Main St, Houston TX"
            />
            {suggestions?.field === "property_address" && suggestions.values.length > 0 && (
              <div className={styles.suggestions}>
                {suggestions.values.map((v) => (
                  <button key={v} className={styles.suggestionItem} onMouseDown={() => { setPropertyAddress(v); setSuggestions(null); }}>
                    {v}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className={styles.formField} style={{ position: "relative" }}>
            <label className={styles.label}>Owner Name</label>
            <input
              className={styles.input}
              value={ownerName}
              onChange={(e) => { setOwnerName(e.target.value); fetchSuggestions("owner_name", e.target.value); }}
              onBlur={() => setTimeout(() => setSuggestions(null), 150)}
              placeholder="Jane Owner"
            />
            {suggestions?.field === "owner_name" && suggestions.values.length > 0 && (
              <div className={styles.suggestions}>
                {suggestions.values.map((v) => (
                  <button key={v} className={styles.suggestionItem} onMouseDown={() => { setOwnerName(v); setSuggestions(null); }}>
                    {v}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className={styles.formField} style={{ position: "relative" }}>
            <label className={styles.label}>Tenant Name</label>
            <input
              className={styles.input}
              value={tenantName}
              onChange={(e) => { setTenantName(e.target.value); fetchSuggestions("tenant_name", e.target.value); }}
              onBlur={() => setTimeout(() => setSuggestions(null), 150)}
              placeholder="Bob Tenant"
            />
            {suggestions?.field === "tenant_name" && suggestions.values.length > 0 && (
              <div className={styles.suggestions}>
                {suggestions.values.map((v) => (
                  <button key={v} className={styles.suggestionItem} onMouseDown={() => { setTenantName(v); setSuggestions(null); }}>
                    {v}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className={styles.formField}>
            <label className={styles.label}>Letter Category</label>
            <select className={styles.select} value={letterCategory} onChange={(e) => setLetterCategory(e.target.value)}>
              <option value="">— Select —</option>
              {LETTER_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div className={styles.formField} style={{ gridColumn: "1 / -1" }}>
            <label className={styles.label}>Notes (optional)</label>
            <textarea className={styles.textarea} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Internal notes about this mailer…" />
          </div>
        </div>

        <div className={styles.stepFooter}>
          <button className={styles.btnSecondary} onClick={() => setStep(2)}>← Back</button>
          <button className={styles.btnPrimary} onClick={() => setStep(4)}>Review →</button>
        </div>
      </div>
    );
  }

  function renderStep4() {
    const mt = MAIL_TYPES.find((m) => m.value === mailType);
    return (
      <div className={styles.reviewLayout}>
        <div className={styles.reviewLeft}>
          <h2 className={styles.stepTitle}>Review & Send</h2>

          <div className={styles.reviewBlock}>
            <h3 className={styles.reviewLabel}>Letter</h3>
            <dl className={styles.reviewDl}>
              <dt>Title</dt><dd>{letterTitle}</dd>
              <dt>Mail Type</dt><dd>{mt?.label} <span style={{ color: "#6A737B" }}>({mt?.estimatedCost})</span></dd>
            </dl>
          </div>

          <div className={styles.reviewBlock}>
            <h3 className={styles.reviewLabel}>Recipient</h3>
            <dl className={styles.reviewDl}>
              <dt>Name</dt><dd>{recipientName}</dd>
              <dt>Address</dt><dd>{recipientAddress}</dd>
              <dt>City/State/ZIP</dt><dd>{recipientCity}, {recipientState} {recipientZip}</dd>
              {propertyAddress && <><dt>Property</dt><dd>{propertyAddress}</dd></>}
              {ownerName && <><dt>Owner</dt><dd>{ownerName}</dd></>}
              {tenantName && <><dt>Tenant</dt><dd>{tenantName}</dd></>}
              {letterCategory && <><dt>Category</dt><dd>{LETTER_CATEGORIES.find((c) => c.value === letterCategory)?.label}</dd></>}
            </dl>
          </div>

          <div className={styles.costEstimate}>
            Estimated cost: <strong>{mt?.estimatedCost}</strong> (final cost confirmed after sending)
          </div>

          {error && <div className={styles.errorBox}>{error}</div>}

          <div className={styles.stepFooter}>
            <button className={styles.btnSecondary} onClick={() => setStep(3)}>← Back</button>
            <button className={styles.btnSecondary} onClick={() => handleSave(false)} disabled={submitting}>
              {submitting ? "Saving…" : "Save as Draft"}
            </button>
            <button className={styles.btnPrimary} onClick={() => handleSave(true)} disabled={submitting}>
              {submitting ? "Sending…" : "Send Now"}
            </button>
          </div>
        </div>

        <div className={styles.reviewRight}>
          <h3 className={styles.previewLabel}>Letter Preview</h3>
          <div className={styles.previewWrap}>
            <iframe ref={iframeRef} className={styles.previewFrame} title="Letter preview" />
          </div>
        </div>
      </div>
    );
  }

  // ── Progress indicator ────────────────────────────────────────────────────

  const STEPS = ["Mail Type", "Compose", "Recipient", "Review"];

  return (
    <div className={styles.shell}>
      <div className={styles.composeHeader}>
        <Link href="/mailers" className={styles.backLink}>← Back to Mailers</Link>
        <div className={styles.progressRow}>
          {STEPS.map((s, i) => (
            <div key={s} className={styles.progressStep}>
              <div
                className={`${styles.progressDot} ${step > i + 1 ? styles.progressDotDone : step === i + 1 ? styles.progressDotActive : ""}`}
              >
                {step > i + 1 ? "✓" : i + 1}
              </div>
              <span className={`${styles.progressLabel} ${step === i + 1 ? styles.progressLabelActive : ""}`}>{s}</span>
              {i < STEPS.length - 1 && <div className={`${styles.progressLine} ${step > i + 1 ? styles.progressLineDone : ""}`} />}
            </div>
          ))}
        </div>
      </div>

      <div className={styles.composeBody}>
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
        {step === 4 && renderStep4()}
      </div>
    </div>
  );
}
