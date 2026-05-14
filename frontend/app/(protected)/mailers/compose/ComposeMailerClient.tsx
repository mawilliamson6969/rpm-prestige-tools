"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../../../context/AuthContext";
import { apiUrl } from "../../../../lib/api";
import styles from "./compose.module.css";

// ─── Types ────────────────────────────────────────────────────────────────────

type MailType = "certified" | "certified_return_receipt" | "first_class" | "priority" | "postcard" | "marketing";
type SourceMode = "write" | "upload" | "document";

type DocumentRecord = {
  id: number;
  title: string;
  content: string;
  folder: string;
};

type Letterhead = {
  showLetterhead: boolean;
  showFooter: boolean;
  primaryColor: string;
  logoUrl: string;
  footerText: string;
  senderName: string;
  senderAddress: string;
  senderCity: string;
  senderState: string;
  senderZip: string;
};

const MAIL_TYPES: { value: MailType; label: string; description: string; estimatedCost: string; color: string }[] = [
  { value: "certified", label: "Certified Mail", description: "USPS tracking + delivery confirmation", estimatedCost: "~$8–10", color: "#0098D0" },
  { value: "certified_return_receipt", label: "Certified + Return Receipt", description: "Certified with signature returned to you", estimatedCost: "~$11–13", color: "#0098D0" },
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

const STEPS = ["Content", "Letterhead", "Recipient", "Review"] as const;
type StepName = (typeof STEPS)[number];

const DEFAULT_LETTERHEAD: Letterhead = {
  showLetterhead: true,
  showFooter: true,
  primaryColor: "#1B2856",
  logoUrl: "",
  footerText: "",
  senderName: "Real Property Management Prestige",
  senderAddress: "4811 Hwy 6 N, Suite B",
  senderCity: "Houston",
  senderState: "TX",
  senderZip: "77084",
};

const INITIAL_LETTER_HTML =
  '<p>Dear [Name],</p><p>&nbsp;</p><p>Sincerely,<br>Real Property Management Prestige</p>';

// ─── Editor (uncontrolled contentEditable to avoid cursor-jump bug) ──────────

type EditorProps = {
  initialHtml: string;
  onChange: (html: string) => void;
  placeholder?: string;
};

function RichTextEditor({ initialHtml, onChange, placeholder }: EditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  // The contentEditable is uncontrolled — we set innerHTML ONCE on mount
  // and read from it via onInput. Re-setting innerHTML on each parent
  // re-render is what was killing the cursor position before.
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!editorRef.current || initializedRef.current) return;
    editorRef.current.innerHTML = initialHtml || "";
    initializedRef.current = true;
  }, [initialHtml]);

  const exec = useCallback((cmd: string, value?: string) => {
    document.execCommand(cmd, false, value);
    if (editorRef.current) {
      editorRef.current.focus();
      onChange(editorRef.current.innerHTML);
    }
  }, [onChange]);

  const handleInput = useCallback(() => {
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  }, [onChange]);

  return (
    <div className={styles.editorWrap}>
      <div className={styles.editorToolbar} role="toolbar" aria-label="Formatting">
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("bold")} title="Bold (Ctrl+B)"><b>B</b></button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("italic")} title="Italic (Ctrl+I)"><i>I</i></button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("underline")} title="Underline (Ctrl+U)"><u>U</u></button>
        <span className={styles.editorDivider} />
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("formatBlock", "h2")} title="Heading">H</button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("formatBlock", "p")} title="Paragraph">¶</button>
        <span className={styles.editorDivider} />
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("insertUnorderedList")} title="Bullet list">•</button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("insertOrderedList")} title="Numbered list">1.</button>
        <span className={styles.editorDivider} />
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("removeFormat")} title="Clear formatting">⨯</button>
      </div>
      <div
        ref={editorRef}
        className={styles.editor}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        data-placeholder={placeholder || "Start typing your letter…"}
      />
    </div>
  );
}

// ─── Live letterhead preview (renders into an iframe, no React re-renders) ──

type PreviewProps = {
  letterHtml: string;
  recipient: { name: string; address: string; city: string; state: string; zip: string };
  letterhead: Letterhead;
};

function LetterheadPreview({ letterHtml, recipient, letterhead }: PreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!iframeRef.current) return;
    const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const color = letterhead.primaryColor || "#1B2856";
    const footer = letterhead.footerText
      || `${letterhead.senderName}  |  ${letterhead.senderCity}, ${letterhead.senderState}  |  (281) 984-7463`;

    const headerHtml = letterhead.showLetterhead ? `
      <div class="lh">
        <div class="lh-left">
          ${letterhead.logoUrl ? `<img class="lh-logo" src="${escapeAttr(letterhead.logoUrl)}" alt="" />` : ""}
          <div>
            <div class="brand">${esc(letterhead.senderName)}</div>
            <div class="addr">${esc(letterhead.senderAddress)}<br>${esc(letterhead.senderCity)}, ${esc(letterhead.senderState)} ${esc(letterhead.senderZip)}</div>
          </div>
        </div>
        <div class="date">${esc(date)}</div>
      </div>` : "";

    const footerHtml = letterhead.showFooter
      ? `<div class="footer">${esc(footer)}</div>`
      : "";

    const preview = `<!DOCTYPE html><html><head><style>
      body { font-family: Arial, sans-serif; font-size: 11pt; margin: 32px; color: #222; background: #fff; }
      .lh { border-bottom: 3px solid ${color}; padding-bottom: 10px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
      .lh-left { display: flex; align-items: flex-start; gap: 10px; }
      .lh-logo { max-height: 48px; max-width: 140px; object-fit: contain; }
      .brand { font-size: 15pt; font-weight: bold; color: ${color}; }
      .addr { font-size: 9pt; color: #6A737B; margin-top: 3px; line-height: 1.4; }
      .date { font-size: 10pt; color: #6A737B; white-space: nowrap; }
      .recip { margin-bottom: 20px; line-height: 1.6; }
      .body p { margin-bottom: 8px; }
      .body h1, .body h2, .body h3 { color: ${color}; margin: 12px 0 6px; }
      .footer { margin-top: 32px; padding-top: 10px; border-top: 1px solid #ddd; font-size: 8pt; color: #9ca3af; text-align: center; }
    </style></head><body>
      ${headerHtml}
      <div class="recip">${esc(recipient.name || "[Recipient Name]")}<br>${esc(recipient.address || "[Address]")}<br>${esc(recipient.city || "Houston")}, ${esc(recipient.state || "TX")} ${esc(recipient.zip || "[ZIP]")}</div>
      <div class="body">${letterHtml}</div>
      ${footerHtml}
    </body></html>`;

    const doc = iframeRef.current.contentDocument;
    if (doc) {
      doc.open();
      doc.write(preview);
      doc.close();
    }
  }, [letterHtml, recipient, letterhead]);

  return <iframe ref={iframeRef} className={styles.previewFrame} title="Letter preview" />;
}

function esc(s: string) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function escapeAttr(s: string) { return esc(s); }

// ─── Main component ───────────────────────────────────────────────────────────

export default function ComposeMailerClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { authHeaders, user } = useAuth();

  const [step, setStep] = useState<StepName>("Content");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [createdMailerId, setCreatedMailerId] = useState<number | null>(null);

  // Source mode: write a letter, upload a PDF, or start from a saved document
  const [source, setSource] = useState<SourceMode>("write");

  // Letter content
  const [letterTitle, setLetterTitle] = useState("");
  const [letterHtml, setLetterHtml] = useState(INITIAL_LETTER_HTML);
  const [mailType, setMailType] = useState<MailType>("certified");

  // Uploaded PDF (when source === 'upload')
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfFileName, setPdfFileName] = useState<string>("");
  const [pdfUploadProgress, setPdfUploadProgress] = useState<number | null>(null);

  // Recipient
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

  // Letterhead customization
  const [letterhead, setLetterhead] = useState<Letterhead>(DEFAULT_LETTERHEAD);

  // Document picker
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docSearch, setDocSearch] = useState("");

  // Autocomplete
  const [suggestions, setSuggestions] = useState<{ field: string; values: string[] } | null>(null);

  // ── If we arrived from /documents?compose=… preload that doc ──────────────
  const initialDocFetched = useRef(false);
  useEffect(() => {
    const docId = searchParams?.get("document_id");
    if (!docId || initialDocFetched.current) return;
    initialDocFetched.current = true;
    fetch(apiUrl(`/documents/${docId}`), { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        if (d.document) {
          setLetterTitle(d.document.title);
          setLetterHtml(d.document.content || INITIAL_LETTER_HTML);
          setSource("write");
        }
      })
      .catch(() => {});
  }, [searchParams, authHeaders]);

  // ── Load documents lazily when the document picker is opened ──────────────
  useEffect(() => {
    if (source !== "document" || documents.length > 0) return;
    setDocsLoading(true);
    fetch(apiUrl("/documents"), { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setDocuments(d.documents || []))
      .catch(() => setDocuments([]))
      .finally(() => setDocsLoading(false));
  }, [source, documents.length, authHeaders]);

  const filteredDocs = useMemo(() => {
    const q = docSearch.toLowerCase();
    if (!q) return documents.slice(0, 24);
    return documents.filter((d) => d.title.toLowerCase().includes(q) || d.folder.toLowerCase().includes(q)).slice(0, 24);
  }, [documents, docSearch]);

  const setLetterheadField = useCallback(<K extends keyof Letterhead>(k: K, v: Letterhead[K]) => {
    setLetterhead((prev) => ({ ...prev, [k]: v }));
  }, []);

  // ── Submit ────────────────────────────────────────────────────────────────

  const validate = useCallback(() => {
    if (!letterTitle.trim()) return "Letter title is required.";
    if (!recipientName.trim()) return "Recipient name is required.";
    if (!recipientAddress.trim()) return "Recipient street address is required.";
    if (!recipientZip.trim()) return "Recipient ZIP is required.";
    if (source === "upload" && !pdfFile && !createdMailerId) return "Please attach a PDF to upload.";
    if (source === "write" && !letterHtml.replace(/<[^>]+>/g, "").trim()) return "Letter body cannot be empty.";
    return null;
  }, [letterTitle, recipientName, recipientAddress, recipientZip, source, pdfFile, createdMailerId, letterHtml]);

  async function handleSave(sendNow: boolean) {
    setError("");
    const v = validate();
    if (v) { setError(v); return; }

    setSubmitting(true);
    try {
      const body = {
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
        sent_by: user?.displayName || user?.username || "Unknown",
        // Letterhead customization
        letterhead_show_letterhead: letterhead.showLetterhead,
        letterhead_show_footer: letterhead.showFooter,
        letterhead_primary_color: letterhead.primaryColor,
        letterhead_logo_url: letterhead.logoUrl || undefined,
        letterhead_footer_text: letterhead.footerText || undefined,
        sender_name: letterhead.senderName,
        sender_address: letterhead.senderAddress,
        sender_city: letterhead.senderCity,
        sender_state: letterhead.senderState,
        sender_zip: letterhead.senderZip,
      };

      // 1. Create draft mailer
      const createResp = await fetch(apiUrl("/mailers"), {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const createData = await createResp.json();
      if (!createResp.ok) {
        setError(createData.error || "Failed to create mailer.");
        return;
      }
      const mailerId: number = createData.mailer.id;
      setCreatedMailerId(mailerId);

      // 2. If uploading a PDF, attach it now
      if (source === "upload" && pdfFile) {
        const fd = new FormData();
        fd.append("pdf", pdfFile);
        const uploadResp = await fetch(apiUrl(`/mailers/${mailerId}/upload-pdf`), {
          method: "POST",
          headers: authHeaders(),
          body: fd,
        });
        if (!uploadResp.ok) {
          const err = await uploadResp.json().catch(() => ({}));
          setError(err.error || "PDF upload failed. The draft mailer was saved.");
          router.push("/mailers");
          return;
        }
      }

      // 3. Either redirect to the list or open the quote/send flow
      if (sendNow) router.push(`/mailers?openQuote=${mailerId}`);
      else router.push("/mailers");
    } catch (_e) {
      setError("An unexpected error occurred.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Autocomplete ───────────────────────────────────────────────────────────
  async function fetchSuggestions(field: string, q: string) {
    if (!q.trim()) { setSuggestions(null); return; }
    const r = await fetch(apiUrl(`/mailers/suggestions?field=${field}&q=${encodeURIComponent(q)}`), {
      headers: authHeaders(),
    });
    const d = await r.json();
    setSuggestions({ field, values: d.suggestions || [] });
  }

  function loadDocument(doc: DocumentRecord) {
    setLetterTitle(doc.title);
    setLetterHtml(doc.content || INITIAL_LETTER_HTML);
    setSource("write");
  }

  // ── Step renderers ─────────────────────────────────────────────────────────

  const currentStepIdx = STEPS.indexOf(step);

  function renderContent() {
    return (
      <div className={styles.stepContent}>
        <h2 className={styles.stepTitle}>Letter content</h2>
        <p className={styles.stepDesc}>
          Type your letter, attach a ready-made PDF, or start from one of your saved documents.
        </p>

        <div className={styles.sourceTabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={source === "write"}
            className={`${styles.sourceTab} ${source === "write" ? styles.sourceTabActive : ""}`}
            onClick={() => setSource("write")}
          >
            ✏️ Write letter
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={source === "upload"}
            className={`${styles.sourceTab} ${source === "upload" ? styles.sourceTabActive : ""}`}
            onClick={() => setSource("upload")}
          >
            📎 Upload PDF
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={source === "document"}
            className={`${styles.sourceTab} ${source === "document" ? styles.sourceTabActive : ""}`}
            onClick={() => setSource("document")}
          >
            📄 From document
          </button>
        </div>

        <div className={styles.formField}>
          <label className={styles.label}>Letter title</label>
          <input
            className={styles.input}
            value={letterTitle}
            onChange={(e) => setLetterTitle(e.target.value)}
            placeholder="e.g. Lease Violation Notice — 123 Main St"
          />
        </div>

        <div className={styles.formField}>
          <label className={styles.label}>Mail type</label>
          <div className={styles.mailTypeGrid}>
            {MAIL_TYPES.map((mt) => (
              <button
                key={mt.value}
                type="button"
                className={`${styles.mailTypeCard} ${mailType === mt.value ? styles.mailTypeCardActive : ""}`}
                style={mailType === mt.value ? { borderColor: mt.color, background: `${mt.color}10` } : undefined}
                onClick={() => setMailType(mt.value)}
              >
                <span className={styles.mailTypeDot} style={{ background: mt.color }} />
                <div className={styles.mailTypeBody}>
                  <div className={styles.mailTypeLabel}>{mt.label}</div>
                  <div className={styles.mailTypeDesc}>{mt.description}</div>
                  <div className={styles.mailTypeCost}>{mt.estimatedCost}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {source === "write" && (
          <div className={styles.formField}>
            <label className={styles.label}>Letter body</label>
            <RichTextEditor
              initialHtml={letterHtml}
              onChange={setLetterHtml}
              placeholder="Dear …"
            />
            <p className={styles.helpHint}>Tip: the letterhead, recipient block, and footer are added automatically when the PDF is generated — just write the body here.</p>
          </div>
        )}

        {source === "upload" && (
          <div className={styles.formField}>
            <label className={styles.label}>PDF file (max 10 MB)</label>
            <div className={styles.uploadDropZone}>
              <input
                id="mailer-pdf-input"
                type="file"
                accept="application/pdf"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size > 10 * 1024 * 1024) { setError("PDF must be under 10 MB."); return; }
                  setError("");
                  setPdfFile(f);
                  setPdfFileName(f.name);
                  if (!letterTitle.trim()) setLetterTitle(f.name.replace(/\.pdf$/i, ""));
                }}
              />
              <label htmlFor="mailer-pdf-input" className={styles.uploadDropLabel}>
                {pdfFile ? (
                  <>
                    <div className={styles.uploadIcon}>📄</div>
                    <div className={styles.uploadFile}>{pdfFileName}</div>
                    <div className={styles.uploadHint}>Click to replace · {(pdfFile.size / 1024).toFixed(0)} KB</div>
                  </>
                ) : (
                  <>
                    <div className={styles.uploadIcon}>📎</div>
                    <div className={styles.uploadFile}>Click to choose a PDF</div>
                    <div className={styles.uploadHint}>or drag &amp; drop here · PDF only · 10 MB max</div>
                  </>
                )}
              </label>
            </div>
            <p className={styles.helpHint}>
              The uploaded PDF will be mailed as-is — no letterhead is added. Make sure your file already has any branding,
              addresses, and signatures baked in.
            </p>
          </div>
        )}

        {source === "document" && (
          <div className={styles.formField}>
            <label className={styles.label}>Pick a saved document</label>
            <input
              className={styles.input}
              placeholder="Search documents…"
              value={docSearch}
              onChange={(e) => setDocSearch(e.target.value)}
            />
            <div className={styles.docGrid}>
              {docsLoading ? (
                <p className={styles.helpHint}>Loading…</p>
              ) : filteredDocs.length === 0 ? (
                <p className={styles.helpHint}>No documents match.</p>
              ) : (
                filteredDocs.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className={styles.docCard}
                    onClick={() => loadDocument(d)}
                  >
                    <div className={styles.docCardIcon}>📝</div>
                    <div className={styles.docCardTitle}>{d.title}</div>
                    <div className={styles.docCardFolder}>{d.folder}</div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderLetterheadStep() {
    if (source === "upload") {
      return (
        <div className={styles.stepContent}>
          <h2 className={styles.stepTitle}>Letterhead</h2>
          <p className={styles.stepDesc}>
            You uploaded a ready-made PDF, so we'll mail it as-is — no letterhead is added.
            Skip ahead to recipient details.
          </p>
        </div>
      );
    }

    return (
      <div className={styles.composeLayout}>
        <div className={styles.composeLeft}>
          <h2 className={styles.stepTitle}>Customize the letterhead</h2>
          <p className={styles.stepDesc}>
            These settings are applied to the PDF when we generate it. Changes are reflected in the preview on the right.
          </p>

          <div className={styles.toggleRow}>
            <label className={styles.toggleLabel}>
              <input
                type="checkbox"
                checked={letterhead.showLetterhead}
                onChange={(e) => setLetterheadField("showLetterhead", e.target.checked)}
              />
              Show letterhead at the top of the page
            </label>
          </div>

          <div className={styles.toggleRow}>
            <label className={styles.toggleLabel}>
              <input
                type="checkbox"
                checked={letterhead.showFooter}
                onChange={(e) => setLetterheadField("showFooter", e.target.checked)}
              />
              Show footer at the bottom of the page
            </label>
          </div>

          <div className={styles.formField}>
            <label className={styles.label}>Sender name</label>
            <input className={styles.input} value={letterhead.senderName}
              onChange={(e) => setLetterheadField("senderName", e.target.value)} />
          </div>

          <div className={styles.formRow}>
            <div className={styles.formField}>
              <label className={styles.label}>Sender street</label>
              <input className={styles.input} value={letterhead.senderAddress}
                onChange={(e) => setLetterheadField("senderAddress", e.target.value)} />
            </div>
          </div>
          <div className={styles.formRow}>
            <div className={styles.formField} style={{ flex: 2 }}>
              <label className={styles.label}>City</label>
              <input className={styles.input} value={letterhead.senderCity}
                onChange={(e) => setLetterheadField("senderCity", e.target.value)} />
            </div>
            <div className={styles.formField} style={{ flex: 1 }}>
              <label className={styles.label}>State</label>
              <input className={styles.input} value={letterhead.senderState}
                onChange={(e) => setLetterheadField("senderState", e.target.value)} />
            </div>
            <div className={styles.formField} style={{ flex: 1 }}>
              <label className={styles.label}>ZIP</label>
              <input className={styles.input} value={letterhead.senderZip}
                onChange={(e) => setLetterheadField("senderZip", e.target.value)} />
            </div>
          </div>

          <div className={styles.formField}>
            <label className={styles.label}>Logo URL (optional)</label>
            <input
              className={styles.input}
              value={letterhead.logoUrl}
              onChange={(e) => setLetterheadField("logoUrl", e.target.value)}
              placeholder="https://…/logo.png"
            />
            <p className={styles.helpHint}>Paste a public URL to a PNG/JPG. Max recommended size 160×60 px.</p>
          </div>

          <div className={styles.formRow}>
            <div className={styles.formField} style={{ flex: 1 }}>
              <label className={styles.label}>Accent color</label>
              <div className={styles.colorRow}>
                <input
                  type="color"
                  value={letterhead.primaryColor}
                  onChange={(e) => setLetterheadField("primaryColor", e.target.value)}
                  className={styles.colorSwatch}
                />
                <input
                  className={styles.input}
                  value={letterhead.primaryColor}
                  onChange={(e) => setLetterheadField("primaryColor", e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className={styles.formField}>
            <label className={styles.label}>Footer text (optional)</label>
            <input
              className={styles.input}
              value={letterhead.footerText}
              onChange={(e) => setLetterheadField("footerText", e.target.value)}
              placeholder="Leave blank to use the default footer"
            />
          </div>
        </div>

        <div className={styles.composeRight}>
          <h3 className={styles.previewLabel}>Live preview</h3>
          <div className={styles.previewCard}>
            <LetterheadPreview
              letterHtml={letterHtml}
              recipient={{ name: recipientName, address: recipientAddress, city: recipientCity, state: recipientState, zip: recipientZip }}
              letterhead={letterhead}
            />
          </div>
        </div>
      </div>
    );
  }

  function renderRecipient() {
    return (
      <div className={styles.stepContent}>
        <h2 className={styles.stepTitle}>Recipient details</h2>
        <p className={styles.stepDesc}>Where the letter is going.</p>

        <div className={styles.formField}>
          <label className={styles.label}>Recipient name <span className={styles.req}>*</span></label>
          <input className={styles.input} value={recipientName}
            onChange={(e) => setRecipientName(e.target.value)} placeholder="John Doe" />
        </div>
        <div className={styles.formField}>
          <label className={styles.label}>Street address <span className={styles.req}>*</span></label>
          <input className={styles.input} value={recipientAddress}
            onChange={(e) => setRecipientAddress(e.target.value)} placeholder="123 Main St, Apt 4" />
        </div>
        <div className={styles.formRow}>
          <div className={styles.formField} style={{ flex: 2 }}>
            <label className={styles.label}>City</label>
            <input className={styles.input} value={recipientCity}
              onChange={(e) => setRecipientCity(e.target.value)} />
          </div>
          <div className={styles.formField} style={{ flex: 1 }}>
            <label className={styles.label}>State</label>
            <input className={styles.input} value={recipientState}
              onChange={(e) => setRecipientState(e.target.value)} />
          </div>
          <div className={styles.formField} style={{ flex: 1 }}>
            <label className={styles.label}>ZIP <span className={styles.req}>*</span></label>
            <input className={styles.input} value={recipientZip}
              onChange={(e) => setRecipientZip(e.target.value)} placeholder="77084" />
          </div>
        </div>

        <h3 className={styles.subHeading}>Categorization (optional)</h3>
        <div className={styles.formRow}>
          <div className={styles.formField}>
            <label className={styles.label}>Property address</label>
            <input className={styles.input} value={propertyAddress}
              onChange={(e) => { setPropertyAddress(e.target.value); void fetchSuggestions("property_address", e.target.value); }} />
            {suggestions?.field === "property_address" && suggestions.values.length > 0 && (
              <div className={styles.suggestList}>
                {suggestions.values.map((v) => (
                  <button key={v} type="button" className={styles.suggestItem}
                    onClick={() => { setPropertyAddress(v); setSuggestions(null); }}>{v}</button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className={styles.formRow}>
          <div className={styles.formField}>
            <label className={styles.label}>Owner</label>
            <input className={styles.input} value={ownerName}
              onChange={(e) => { setOwnerName(e.target.value); void fetchSuggestions("owner_name", e.target.value); }} />
          </div>
          <div className={styles.formField}>
            <label className={styles.label}>Tenant</label>
            <input className={styles.input} value={tenantName}
              onChange={(e) => { setTenantName(e.target.value); void fetchSuggestions("tenant_name", e.target.value); }} />
          </div>
        </div>
        <div className={styles.formField}>
          <label className={styles.label}>Letter category</label>
          <select className={styles.input} value={letterCategory}
            onChange={(e) => setLetterCategory(e.target.value)}>
            <option value="">— None —</option>
            {LETTER_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div className={styles.formField}>
          <label className={styles.label}>Internal notes</label>
          <textarea className={styles.textarea} rows={3} value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything you want to remember about this mailer (not visible on the letter)" />
        </div>
      </div>
    );
  }

  function renderReview() {
    const mailTypeInfo = MAIL_TYPES.find((m) => m.value === mailType);
    return (
      <div className={styles.composeLayout}>
        <div className={styles.composeLeft}>
          <h2 className={styles.stepTitle}>Review &amp; send</h2>
          <p className={styles.stepDesc}>One last look before we ship it.</p>

          <div className={styles.summaryGrid}>
            <div className={styles.summaryRow}>
              <span className={styles.summaryLabel}>Mail type</span>
              <span className={styles.summaryValue}>
                <span className={styles.mailTypeDot} style={{ background: mailTypeInfo?.color }} />
                {mailTypeInfo?.label} <span className={styles.helpHint}>({mailTypeInfo?.estimatedCost})</span>
              </span>
            </div>
            <div className={styles.summaryRow}>
              <span className={styles.summaryLabel}>Content source</span>
              <span className={styles.summaryValue}>
                {source === "upload" ? `Uploaded PDF — ${pdfFileName || "no file"}` : "Letter from editor (with letterhead)"}
              </span>
            </div>
            <div className={styles.summaryRow}>
              <span className={styles.summaryLabel}>Recipient</span>
              <span className={styles.summaryValue}>
                <strong>{recipientName || "—"}</strong><br />
                {recipientAddress}<br />
                {recipientCity}, {recipientState} {recipientZip}
              </span>
            </div>
            {letterCategory && (
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>Category</span>
                <span className={styles.summaryValue}>
                  {LETTER_CATEGORIES.find((c) => c.value === letterCategory)?.label}
                </span>
              </div>
            )}
          </div>

          <div className={styles.callout}>
            <strong>Estimated cost: {mailTypeInfo?.estimatedCost}</strong><br />
            Final cost is calculated by LetterStream after page count + class. You'll see it confirmed in the success toast.
          </div>

          {error && <div className={styles.errorBox}>{error}</div>}

          <div className={styles.stepFooter}>
            <button type="button" className={styles.btnSecondary} onClick={() => setStep("Recipient")} disabled={submitting}>
              ← Back
            </button>
            <div className={styles.footerActions}>
              <button type="button" className={styles.btnSecondary} onClick={() => handleSave(false)} disabled={submitting}>
                {submitting ? "Saving…" : "Save as Draft"}
              </button>
              <button type="button" className={styles.btnPrimary} onClick={() => handleSave(true)} disabled={submitting}>
                {submitting ? "Sending…" : `Send via LetterStream →`}
              </button>
            </div>
          </div>
        </div>
        <div className={styles.composeRight}>
          <h3 className={styles.previewLabel}>Final preview</h3>
          <div className={styles.previewCard}>
            {source === "upload" ? (
              <div className={styles.previewUploaded}>
                <div className={styles.previewUploadedIcon}>📄</div>
                <div className={styles.previewUploadedText}>
                  <strong>{pdfFileName || "No file attached"}</strong>
                  <div className={styles.helpHint}>This PDF will be mailed as-is.</div>
                </div>
              </div>
            ) : (
              <LetterheadPreview
                letterHtml={letterHtml}
                recipient={{ name: recipientName, address: recipientAddress, city: recipientCity, state: recipientState, zip: recipientZip }}
                letterhead={letterhead}
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Header / stepper ──────────────────────────────────────────────────────

  const canAdvance: Record<StepName, boolean> = {
    Content: !!(letterTitle.trim() && (source !== "upload" || pdfFile)),
    Letterhead: true,
    Recipient: !!(recipientName.trim() && recipientAddress.trim() && recipientZip.trim()),
    Review: true,
  };

  function goNext() {
    const i = STEPS.indexOf(step);
    if (i < STEPS.length - 1) setStep(STEPS[i + 1]);
  }
  function goBack() {
    const i = STEPS.indexOf(step);
    if (i > 0) setStep(STEPS[i - 1]);
  }

  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>
        <Link href="/mailers" className={styles.crumbLink}>← Mailers</Link>
        <h1 className={styles.title}>New mailer</h1>
        <div className={styles.spacer} />
        <Link href="/mailers" className={styles.btnGhost}>Cancel</Link>
      </header>

      <nav className={styles.stepper} aria-label="Compose steps">
        {STEPS.map((s, i) => {
          const isActive = step === s;
          const isDone = i < currentStepIdx;
          return (
            <button
              key={s}
              type="button"
              className={`${styles.stepperItem} ${isActive ? styles.stepperItemActive : ""} ${isDone ? styles.stepperItemDone : ""}`}
              onClick={() => setStep(s)}
            >
              <span className={styles.stepperNum}>{isDone ? "✓" : i + 1}</span>
              <span className={styles.stepperLabel}>{s}</span>
            </button>
          );
        })}
      </nav>

      <main className={styles.body}>
        {step === "Content" && renderContent()}
        {step === "Letterhead" && renderLetterheadStep()}
        {step === "Recipient" && renderRecipient()}
        {step === "Review" && renderReview()}
      </main>

      {step !== "Review" && (
        <footer className={styles.bottomBar}>
          {error && <div className={styles.errorBox} style={{ marginRight: "auto" }}>{error}</div>}
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={goBack}
            disabled={currentStepIdx === 0}
          >
            ← Back
          </button>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={goNext}
            disabled={!canAdvance[step]}
          >
            Next: {STEPS[currentStepIdx + 1]} →
          </button>
        </footer>
      )}
    </div>
  );
}
