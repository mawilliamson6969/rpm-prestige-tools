"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../../context/AuthContext";
import { apiUrl } from "../../../lib/api";
import styles from "./mailers.module.css";

// ─── Types ────────────────────────────────────────────────────────────────────

type MailType = "certified" | "certified_return_receipt" | "first_class" | "priority" | "postcard" | "marketing";
type MailStatus =
  | "draft" | "queued" | "preauth_pending" | "sent" | "sent_test"
  | "in_production" | "mailed" | "in_transit" | "out_for_delivery" | "delivered"
  | "attempted" | "returned" | "failed" | "failed_funding" | "needs_attention"
  | "address_warning" | "cancelled";

type Mailer = {
  id: number;
  documentId: number | null;
  letterTitle: string;
  letterHtml: string;
  mailType: MailType;
  recipientName: string;
  recipientAddress: string;
  recipientCity: string;
  recipientState: string;
  recipientZip: string;
  propertyAddress: string | null;
  ownerName: string | null;
  tenantName: string | null;
  letterCategory: string | null;
  notes: string | null;
  senderName: string;
  senderAddress: string;
  senderCity: string;
  senderState: string;
  senderZip: string;
  provider: string;
  providerJobId: string | null;
  providerDocId: string | null;
  providerAuthcode: string | null;
  providerBatchId: string | null;
  providerTrackingNumber: string | null;
  providerExpectedDelivery: string | null;
  quotedCostCents: number | null;
  quotedAt: string | null;
  pageCount: number | null;
  costCents: number | null;
  testMode: boolean;
  includeReturnEnvelope: boolean;
  signatureFilePath: string | null;
  currentScanStatus: string | null;
  currentScanCode: string | null;
  lastScannedAt: string | null;
  lastScanFacility: string | null;
  lastScanZip: string | null;
  triggeredBy: string;
  triggeredFrom: string | null;
  sentBy: string | null;
  status: MailStatus;
  sentAt: string | null;
  deliveredAt: string | null;
  lastStatusCheck: string | null;
  createdAt: string;
  updatedAt: string;
};

type MailerEvent = {
  id: number;
  mailer_id: number;
  event_type: string;
  event_detail: string | null;
  event_time: string;
  created_by: string;
};

type Stats = {
  totalSent: number;
  delivered: number;
  inTransit: number;
  failedReturned: number;
  totalCostThisMonth: number;
  totalCostAllTime: number;
  breakdownByType: { mail_type: string; count: string; total_cost: string }[];
  breakdownByCategory: { letter_category: string; count: string }[];
  recentActivity: (MailerEvent & { letter_title: string; recipient_name: string })[];
};

// ─── Constants ────────────────────────────────────────────────────────────────

const MAIL_TYPE_LABELS: Record<MailType, string> = {
  certified: "Certified",
  certified_return_receipt: "Certified+RR",
  first_class: "First Class",
  priority: "Priority",
  postcard: "Postcard",
  marketing: "Marketing",
};

const MAIL_TYPE_COLORS: Record<MailType, string> = {
  certified: "#0098D0",
  certified_return_receipt: "#0098D0",
  first_class: "#6A737B",
  priority: "#d97706",
  postcard: "#0d9488",
  marketing: "#7c3aed",
};

const STATUS_LABELS: Record<MailStatus, string> = {
  draft: "Draft",
  queued: "Queued",
  preauth_pending: "Quote Pending",
  sent: "Sent",
  sent_test: "Sent (Test)",
  in_production: "In Production",
  mailed: "Mailed",
  in_transit: "In Transit",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  attempted: "Attempted",
  returned: "Returned",
  failed: "Failed",
  failed_funding: "Failed (Funds)",
  needs_attention: "Needs Attention",
  address_warning: "Address Warning",
  cancelled: "Cancelled",
};

const STATUS_COLORS: Record<MailStatus, string> = {
  draft: "#6A737B",
  queued: "#6A737B",
  preauth_pending: "#9333ea",
  sent: "#0098D0",
  sent_test: "#9333ea",
  in_production: "#0098D0",
  mailed: "#0098D0",
  in_transit: "#d97706",
  out_for_delivery: "#65a30d",
  delivered: "#287840",
  attempted: "#ea580c",
  returned: "#dc4e00",
  failed: "#B32317",
  failed_funding: "#B32317",
  needs_attention: "#d97706",
  address_warning: "#d97706",
  cancelled: "#9ca3af",
};

const EVENT_ICONS: Record<string, string> = {
  created: "○",
  queued: "○",
  sent: "✉",
  in_transit: "→",
  out_for_delivery: "→",
  delivered: "✓",
  attempted: "!",
  returned: "↩",
  failed: "✕",
  cancelled: "✕",
  note_added: "📝",
  resent: "↻",
};

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

const CATEGORY_COLORS: Record<string, string> = {
  eviction: "#B32317",
  violation: "#dc4e00",
  termination: "#ea580c",
  move_out: "#d97706",
  deposit: "#0098D0",
  general: "#6A737B",
  marketing: "#7c3aed",
  other: "#6A737B",
};

const NAV_ITEMS = [
  { id: "all", label: "All Mail", icon: "📬" },
  { id: "certified", label: "Certified Mail", icon: "🏷️", filter: { mail_type: "certified" } },
  { id: "first_class", label: "First Class", icon: "✉️", filter: { mail_type: "first_class" } },
  { id: "postcard", label: "Postcards", icon: "📮", filter: { mail_type: "postcard" } },
  { id: "marketing", label: "Marketing", icon: "📢", filter: { mail_type: "marketing" } },
  { id: "draft", label: "Drafts", icon: "📝", filter: { status: "draft" } },
  { id: "failed", label: "Failed / Needs Attention", icon: "⚠️", filter: { status: "failed" } },
];

function formatCents(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MailersPageClient() {
  const { authHeaders } = useAuth();

  const [activeNav, setActiveNav] = useState("all");
  const [activeTab, setActiveTab] = useState<"dashboard" | "table">("dashboard");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [mailers, setMailers] = useState<Mailer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedMailer, setSelectedMailer] = useState<Mailer | null>(null);
  const [selectedEvents, setSelectedEvents] = useState<MailerEvent[]>([]);
  const [noteText, setNoteText] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string[]>([]);
  const [filterCategory, setFilterCategory] = useState<string[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // LetterStream balance (in cents) + cached flag
  const [balance, setBalance] = useState<{ balanceCents: number | null; cached: boolean } | null>(null);

  // Quote → confirm modal
  type QuoteState = {
    mailerId: number;
    authcode: string | null;
    costCents: number;
    pageCount: number;
    testMode: boolean;
    code: string;
  };
  const [quote, setQuote] = useState<QuoteState | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);

  // Debounce search
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(search), 300);
  }, [search]);

  // Build query params from active nav + filters + search
  const buildParams = useCallback(() => {
    const params: Record<string, string> = {};
    const navItem = NAV_ITEMS.find((n) => n.id === activeNav);
    if (navItem?.filter) Object.assign(params, navItem.filter);
    if (debouncedSearch) params.search = debouncedSearch;
    if (filterStatus.length === 1) params.status = filterStatus[0];
    if (filterCategory.length === 1) params.letter_category = filterCategory[0];
    params.page = String(page);
    params.limit = "50";
    return params;
  }, [activeNav, debouncedSearch, filterStatus, filterCategory, page]);

  const loadMailers = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams(buildParams()).toString();
      const r = await fetch(apiUrl(`/mailers?${qs}`), { headers: authHeaders() });
      const d = await r.json();
      setMailers(d.mailers || []);
      setTotal(d.total || 0);
    } catch {
      setMailers([]);
    } finally {
      setLoading(false);
    }
  }, [buildParams, authHeaders]);

  const loadStats = useCallback(async () => {
    try {
      const r = await fetch(apiUrl("/mailers/stats"), { headers: authHeaders() });
      const d = await r.json();
      setStats(d);
    } catch { /* ignore */ }
  }, [authHeaders]);

  useEffect(() => {
    loadMailers();
  }, [loadMailers]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // Load detail when selected
  useEffect(() => {
    if (!selectedId) {
      setSelectedMailer(null);
      setSelectedEvents([]);
      return;
    }
    fetch(apiUrl(`/mailers/${selectedId}`), { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        setSelectedMailer(d.mailer || null);
        setSelectedEvents(d.events || []);
      })
      .catch(() => {});
  }, [selectedId, authHeaders]);

  // Charts via Chart.js CDN
  const chartJsLoaded = useRef(false);
  const barChartRef = useRef<HTMLCanvasElement>(null);
  const donutChartRef = useRef<HTMLCanvasElement>(null);
  const barChartInstance = useRef<unknown>(null);
  const donutChartInstance = useRef<unknown>(null);

  useEffect(() => {
    if (!stats || activeTab !== "dashboard") return;
    const renderCharts = () => {
      const Chart = (window as unknown as Record<string, unknown>).Chart as {
        new (ctx: CanvasRenderingContext2D, config: unknown): { destroy(): void };
      };
      if (!Chart) return;

      if (barChartInstance.current) (barChartInstance.current as { destroy(): void }).destroy();
      if (donutChartInstance.current) (donutChartInstance.current as { destroy(): void }).destroy();

      if (barChartRef.current) {
        const ctx = barChartRef.current.getContext("2d");
        if (ctx) {
          barChartInstance.current = new Chart(ctx, {
            type: "bar",
            data: {
              labels: stats.breakdownByType.map((t) => MAIL_TYPE_LABELS[t.mail_type as MailType] || t.mail_type),
              datasets: [{
                label: "Letters Sent",
                data: stats.breakdownByType.map((t) => parseInt(t.count, 10)),
                backgroundColor: stats.breakdownByType.map((t) => MAIL_TYPE_COLORS[t.mail_type as MailType] || "#6A737B"),
                borderRadius: 6,
              }],
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
            },
          });
        }
      }

      if (donutChartRef.current && stats.breakdownByCategory.length > 0) {
        const ctx = donutChartRef.current.getContext("2d");
        if (ctx) {
          donutChartInstance.current = new Chart(ctx, {
            type: "doughnut",
            data: {
              labels: stats.breakdownByCategory.map((c) =>
                LETTER_CATEGORIES.find((l) => l.value === c.letter_category)?.label || c.letter_category
              ),
              datasets: [{
                data: stats.breakdownByCategory.map((c) => parseInt(c.count, 10)),
                backgroundColor: stats.breakdownByCategory.map((c) => CATEGORY_COLORS[c.letter_category] || "#6A737B"),
              }],
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { position: "right" } },
            },
          });
        }
      }
    };

    if (!chartJsLoaded.current) {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js";
      script.onload = () => {
        chartJsLoaded.current = true;
        setTimeout(renderCharts, 50);
      };
      document.head.appendChild(script);
    } else {
      setTimeout(renderCharts, 50);
    }
  }, [stats, activeTab]);

  // ── Actions ────────────────────────────────────────────────────────────────

  // Two-step send flow: /quote gets price + authcode, /confirm-send releases the job.
  async function handleQuote(id: number) {
    setActionLoading(true);
    setQuoteError(null);
    try {
      const r = await fetch(apiUrl(`/mailers/${id}/quote`), {
        method: "POST",
        headers: authHeaders(),
      });
      const d = await r.json();
      if (!r.ok) {
        setQuoteError(d.error || "Failed to get quote.");
        alert(d.error || "Failed to get quote.");
        return;
      }
      setSelectedMailer(d.mailer);
      setQuote({
        mailerId: id,
        authcode: d.quote?.authcode || null,
        costCents: d.quote?.costCents || 0,
        pageCount: d.quote?.pageCount || 1,
        testMode: !!d.quote?.testMode,
        code: String(d.quote?.code || ""),
      });
      await loadMailers();
    } finally {
      setActionLoading(false);
    }
  }

  async function handleConfirmSend() {
    if (!quote) return;
    setActionLoading(true);
    try {
      const r = await fetch(apiUrl(`/mailers/${quote.mailerId}/confirm-send`), {
        method: "POST",
        headers: authHeaders(),
      });
      const d = await r.json();
      if (!r.ok) {
        setQuoteError(d.error || "Failed to send.");
        alert(d.error || "Failed to send.");
        return;
      }
      setSelectedMailer(d.mailer);
      setQuote(null);
      await loadMailers();
      await loadStats();
      void loadBalance(true);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRefreshTracking(id: number) {
    setActionLoading(true);
    try {
      const r = await fetch(apiUrl(`/mailers/${id}/tracking`), {
        headers: authHeaders(),
      });
      const d = await r.json();
      if (!r.ok) {
        alert(d.error || "Failed to refresh tracking.");
        return;
      }
      setSelectedMailer(d.mailer);
      await loadMailerEvents(id);
      await loadMailers();
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDownloadSignature(id: number) {
    setActionLoading(true);
    try {
      const r = await fetch(apiUrl(`/mailers/${id}/signature`), {
        headers: authHeaders(),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        alert(d.error || "Signature not available yet.");
        return;
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      // Open in a new tab and remember for cleanup
      window.open(url, "_blank", "noopener,noreferrer");
      if (signatureUrl) URL.revokeObjectURL(signatureUrl);
      setSignatureUrl(url);
    } finally {
      setActionLoading(false);
    }
  }

  async function loadMailerEvents(id: number) {
    try {
      const r = await fetch(apiUrl(`/mailers/${id}`), { headers: authHeaders() });
      if (!r.ok) return;
      const d = await r.json();
      if (d.events) setSelectedEvents(d.events);
    } catch { /* ignore */ }
  }

  const loadBalance = useCallback(async (force = false) => {
    try {
      const r = await fetch(apiUrl("/mailers/account-balance"), {
        headers: authHeaders(),
        cache: force ? "no-store" : "default",
      });
      if (!r.ok) { setBalance(null); return; }
      const d = await r.json();
      setBalance({ balanceCents: d.balanceCents ?? null, cached: !!d.cached });
    } catch { setBalance(null); }
  }, [authHeaders]);

  useEffect(() => { loadBalance(); }, [loadBalance]);

  // Auto-open the quote modal if compose redirected us here with ?openQuote=<id>.
  // We strip the param after firing so refreshes don't re-quote.
  const autoQuoteFiredRef = useRef(false);
  useEffect(() => {
    if (autoQuoteFiredRef.current) return;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const idStr = params.get("openQuote");
    if (!idStr) return;
    const id = Number(idStr);
    if (!Number.isFinite(id) || id <= 0) return;
    autoQuoteFiredRef.current = true;
    setSelectedId(id);
    // Slight delay to let mailers list load so the slide-over has data
    setTimeout(() => { void handleQuote(id); }, 400);
    // Strip the query param
    const url = new URL(window.location.href);
    url.searchParams.delete("openQuote");
    window.history.replaceState({}, "", url.toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCancel(id: number) {
    if (!confirm("Cancel this mailer?")) return;
    setActionLoading(true);
    try {
      const r = await fetch(apiUrl(`/mailers/${id}/cancel`), {
        method: "POST",
        headers: authHeaders(),
      });
      const d = await r.json();
      if (!r.ok) { alert(d.error || "Failed."); return; }
      setSelectedMailer(d.mailer);
      await loadMailers();
    } finally {
      setActionLoading(false);
    }
  }

  async function handleResend(id: number) {
    setActionLoading(true);
    try {
      const r = await fetch(apiUrl(`/mailers/${id}/resend`), {
        method: "POST",
        headers: authHeaders(),
      });
      const d = await r.json();
      if (!r.ok) { alert(d.error || "Failed."); return; }
      setSelectedId(d.mailer.id);
      await loadMailers();
    } finally {
      setActionLoading(false);
    }
  }

  async function handleAddNote(id: number) {
    if (!noteText.trim()) return;
    setActionLoading(true);
    try {
      const r = await fetch(apiUrl(`/mailers/${id}/note`), {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ note: noteText }),
      });
      if (!r.ok) { alert("Failed to add note."); return; }
      setNoteText("");
      // Refresh events
      const d = await fetch(apiUrl(`/mailers/${id}`), { headers: authHeaders() }).then((x) => x.json());
      setSelectedEvents(d.events || []);
    } finally {
      setActionLoading(false);
    }
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  function renderStatusBadge(status: MailStatus) {
    const color = STATUS_COLORS[status] || "#6A737B";
    const label = STATUS_LABELS[status] || status;
    return (
      <span
        className={styles.badge}
        style={{ background: `${color}1a`, color, borderColor: `${color}40` }}
      >
        {label}
      </span>
    );
  }

  function renderMailTypeDot(mailType: MailType) {
    const color = MAIL_TYPE_COLORS[mailType] || "#6A737B";
    const label = MAIL_TYPE_LABELS[mailType] || mailType;
    return (
      <span className={styles.typeChip}>
        <span className={styles.typeDot} style={{ background: color }} />
        {label}
      </span>
    );
  }

  function renderCategoryBadge(cat: string | null) {
    if (!cat) return null;
    const color = CATEGORY_COLORS[cat] || "#6A737B";
    const label = LETTER_CATEGORIES.find((l) => l.value === cat)?.label || cat;
    return (
      <span className={styles.badge} style={{ background: `${color}1a`, color, borderColor: `${color}40` }}>
        {label}
      </span>
    );
  }

  // ── Slide-over detail panel ────────────────────────────────────────────────

  function renderSlideOver() {
    if (!selectedId || !selectedMailer) return null;
    const m = selectedMailer;

    return (
      <div className={styles.slideOverBackdrop} onClick={() => setSelectedId(null)}>
        <div className={styles.slideOver} onClick={(e) => e.stopPropagation()}>
          <div className={styles.slideOverHeader}>
            <div>
              <h2 className={styles.slideOverTitle}>{m.letterTitle}</h2>
              <div style={{ marginTop: 4 }}>{renderStatusBadge(m.status)}</div>
            </div>
            <button className={styles.slideOverClose} onClick={() => setSelectedId(null)}>✕</button>
          </div>

          {/* Tracking timeline */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Tracking Timeline</h3>
            <div className={styles.timeline}>
              {selectedEvents.length === 0 && (
                <p className={styles.empty}>No events yet.</p>
              )}
              {selectedEvents.map((ev) => (
                <div key={ev.id} className={styles.timelineItem}>
                  <span className={styles.timelineIcon}>{EVENT_ICONS[ev.event_type] || "·"}</span>
                  <div className={styles.timelineBody}>
                    <span className={styles.timelineType}>{ev.event_type.replace(/_/g, " ")}</span>
                    {ev.event_detail && (
                      <span className={styles.timelineDetail}>{ev.event_detail}</span>
                    )}
                    <span className={styles.timelineTime}>{timeAgo(ev.event_time)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recipient & property info */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Recipient & Property</h3>
            <dl className={styles.dl}>
              <dt>Recipient</dt><dd>{m.recipientName}</dd>
              <dt>Address</dt><dd>{m.recipientAddress}, {m.recipientCity}, {m.recipientState} {m.recipientZip}</dd>
              {m.propertyAddress && <><dt>Property</dt><dd>{m.propertyAddress}</dd></>}
              {m.ownerName && <><dt>Owner</dt><dd>{m.ownerName}</dd></>}
              {m.tenantName && <><dt>Tenant</dt><dd>{m.tenantName}</dd></>}
              {m.letterCategory && <><dt>Category</dt><dd>{renderCategoryBadge(m.letterCategory)}</dd></>}
              {m.costCents != null && <><dt>Cost</dt><dd>{formatCents(m.costCents)}</dd></>}
              {m.sentBy && <><dt>Sent By</dt><dd>{m.sentBy}</dd></>}
              {m.triggeredBy !== "manual" && <><dt>Triggered</dt><dd>{m.triggeredBy} {m.triggeredFrom ? `(${m.triggeredFrom})` : ""}</dd></>}
              {m.providerTrackingNumber && <><dt>Tracking #</dt><dd>{m.providerTrackingNumber}</dd></>}
            </dl>
          </div>

          {/* Letter preview */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Letter Preview</h3>
            <div className={styles.letterPreviewWrap}>
              <iframe
                srcDoc={m.letterHtml}
                className={styles.letterPreviewIframe}
                title="Letter preview"
                sandbox="allow-same-origin"
              />
            </div>
          </div>

          {/* Add note */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Add Note</h3>
            <div className={styles.noteRow}>
              <input
                className={styles.noteInput}
                placeholder="Add a note..."
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAddNote(m.id); }}
              />
              <button
                className={styles.btnSm}
                onClick={() => handleAddNote(m.id)}
                disabled={actionLoading || !noteText.trim()}
              >
                Add
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className={styles.slideOverActions}>
            {(m.status === "draft" || m.status === "preauth_pending") && (
              <button className={styles.btnPrimary} onClick={() => handleQuote(m.id)} disabled={actionLoading}>
                {m.status === "preauth_pending" ? "Re-Quote" : "Get Quote & Send…"}
              </button>
            )}
            {["sent", "sent_test", "in_production", "mailed", "in_transit", "out_for_delivery", "attempted"].includes(m.status) && m.providerDocId && (
              <button className={styles.btnSm} onClick={() => handleRefreshTracking(m.id)} disabled={actionLoading}>
                ↻ Refresh Status
              </button>
            )}
            {m.status === "delivered" && (m.mailType === "certified" || m.mailType === "certified_return_receipt") && m.providerTrackingNumber && (
              <button className={styles.btnSm} onClick={() => handleDownloadSignature(m.id)} disabled={actionLoading}>
                📄 Download Signature
              </button>
            )}
            {["failed", "failed_funding", "returned", "cancelled", "needs_attention"].includes(m.status) && (
              <button className={styles.btnSm} onClick={() => handleResend(m.id)} disabled={actionLoading}>
                ↻ Resend
              </button>
            )}
            {["draft", "queued", "preauth_pending"].includes(m.status) && (
              <button className={`${styles.btnSm} ${styles.btnDanger}`} onClick={() => handleCancel(m.id)} disabled={actionLoading}>
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Dashboard tab ──────────────────────────────────────────────────────────

  function renderDashboard() {
    if (!stats) return <div className={styles.loading}>Loading stats…</div>;

    return (
      <div className={styles.dashContent}>
        {/* LetterStream balance */}
        {balance && (
          <div
            className={styles.balanceCard}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0.85rem 1.1rem",
              marginBottom: "1rem",
              background: "linear-gradient(90deg, #1B2856 0%, #0098D0 100%)",
              color: "#fff",
              borderRadius: 8,
            }}
          >
            <div>
              <div style={{ fontSize: "0.75rem", opacity: 0.85, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                LetterStream Prepaid Balance{balance.cached ? " (cached)" : ""}
              </div>
              <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>
                {balance.balanceCents != null ? formatCents(balance.balanceCents) : "—"}
              </div>
            </div>
            <a
              href="https://www.letterstream.com/ls/myacct?action=billing"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                background: "rgba(255,255,255,0.15)",
                color: "#fff",
                padding: "0.5rem 0.9rem",
                borderRadius: 6,
                textDecoration: "none",
                fontWeight: 600,
                fontSize: "0.85rem",
              }}
            >
              + Add Funds ↗
            </a>
          </div>
        )}

        {/* Stats row */}
        <div className={styles.statsRow}>
          <div className={styles.statCard}>
            <div className={styles.statValue}>{stats.totalSent}</div>
            <div className={styles.statLabel}>Total Sent This Month</div>
          </div>
          <div className={styles.statCard} style={{ borderTop: `3px solid ${STATUS_COLORS.delivered}` }}>
            <div className={styles.statValue} style={{ color: STATUS_COLORS.delivered }}>{stats.delivered}</div>
            <div className={styles.statLabel}>Delivered</div>
          </div>
          <div className={styles.statCard} style={{ borderTop: `3px solid ${STATUS_COLORS.in_transit}` }}>
            <div className={styles.statValue} style={{ color: STATUS_COLORS.in_transit }}>{stats.inTransit}</div>
            <div className={styles.statLabel}>In Transit</div>
          </div>
          <div
            className={styles.statCard}
            style={{ borderTop: `3px solid ${STATUS_COLORS.failed}`, cursor: "pointer" }}
            onClick={() => { setActiveNav("failed"); setActiveTab("table"); }}
          >
            <div className={styles.statValue} style={{ color: STATUS_COLORS.failed }}>{stats.failedReturned}</div>
            <div className={styles.statLabel}>Failed / Returned</div>
          </div>
          <div className={styles.statCard} style={{ borderTop: "3px solid #1B2856" }}>
            <div className={styles.statValue} style={{ color: "#1B2856" }}>{formatCents(stats.totalCostThisMonth)}</div>
            <div className={styles.statLabel}>Cost This Month</div>
          </div>
        </div>

        {/* Charts */}
        <div className={styles.chartsRow}>
          <div className={styles.chartCard}>
            <h3 className={styles.chartTitle}>Mail by Type</h3>
            <div className={styles.chartWrap}>
              <canvas ref={barChartRef} />
            </div>
          </div>
          <div className={styles.chartCard}>
            <h3 className={styles.chartTitle}>By Category</h3>
            <div className={styles.chartWrap}>
              {stats.breakdownByCategory.length === 0 ? (
                <p className={styles.empty}>No data yet.</p>
              ) : (
                <canvas ref={donutChartRef} />
              )}
            </div>
          </div>
        </div>

        {/* Recent activity */}
        <div className={styles.activityCard}>
          <h3 className={styles.chartTitle}>Recent Activity</h3>
          {stats.recentActivity.length === 0 ? (
            <p className={styles.empty}>No recent activity.</p>
          ) : (
            <div className={styles.activityList}>
              {stats.recentActivity.map((ev) => (
                <div key={ev.id} className={styles.activityItem}>
                  <span className={styles.activityIcon}>{EVENT_ICONS[ev.event_type] || "·"}</span>
                  <div className={styles.activityBody}>
                    <span className={styles.activityTitle}>{ev.letter_title}</span>
                    <span className={styles.activityRecip}>{ev.recipient_name}</span>
                    <span className={styles.activityEvent}>{ev.event_type.replace(/_/g, " ")}</span>
                  </div>
                  <span className={styles.activityTime}>{timeAgo(ev.event_time)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Table tab ──────────────────────────────────────────────────────────────

  function renderTable() {
    return (
      <div className={styles.tableWrap}>
        {loading ? (
          <div className={styles.loading}>Loading…</div>
        ) : mailers.length === 0 ? (
          <div className={styles.empty}>
            No mailers found.{" "}
            <Link href="/mailers/compose" className={styles.link}>
              Create one →
            </Link>
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Type</th>
                <th>Letter Title</th>
                <th>Recipient</th>
                <th>Property</th>
                <th>Category</th>
                <th>Status</th>
                <th>Sent</th>
                <th>Expected</th>
                <th>Cost</th>
                <th>Sent By</th>
              </tr>
            </thead>
            <tbody>
              {mailers.map((m) => (
                <tr
                  key={m.id}
                  className={styles.tableRow}
                  onClick={() => setSelectedId(m.id)}
                >
                  <td>{renderMailTypeDot(m.mailType)}</td>
                  <td className={styles.titleCell}>{m.letterTitle}</td>
                  <td>{m.recipientName}</td>
                  <td className={styles.dimCell}>{m.propertyAddress || "—"}</td>
                  <td>{renderCategoryBadge(m.letterCategory)}</td>
                  <td>{renderStatusBadge(m.status)}</td>
                  <td className={styles.dimCell}>{m.sentAt ? new Date(m.sentAt).toLocaleDateString() : "—"}</td>
                  <td className={styles.dimCell}>{m.providerExpectedDelivery ? new Date(m.providerExpectedDelivery).toLocaleDateString() : "—"}</td>
                  <td>{formatCents(m.costCents)}</td>
                  <td className={styles.dimCell}>{m.sentBy || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {total > 50 && (
          <div className={styles.pagination}>
            <button
              className={styles.pageBtn}
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              ← Prev
            </button>
            <span>{page} of {Math.ceil(total / 50)}</span>
            <button
              className={styles.pageBtn}
              disabled={page * 50 >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next →
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────

  return (
    <div className={styles.shell}>
      {/* Left sidebar */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarSearch}>
          <input
            className={styles.searchInput}
            placeholder="Search mailers…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <nav className={styles.sidebarNav}>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`${styles.navItem} ${activeNav === item.id ? styles.navItemActive : ""}`}
              onClick={() => { setActiveNav(item.id); setPage(1); setActiveTab("table"); }}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className={styles.sidebarSection}>Quick Filters</div>
        {[
          { label: "This Month", from: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString() },
        ].map((f) => (
          <button key={f.label} className={styles.navItem} onClick={() => setPage(1)}>
            <span>📅</span>
            <span>{f.label}</span>
          </button>
        ))}

        <div className={styles.sidebarSection}>
          <button className={styles.filterToggle} onClick={() => setFilterOpen((o) => !o)}>
            Filters {filterOpen ? "▴" : "▾"}
          </button>
        </div>

        {filterOpen && (
          <div className={styles.filterPanel}>
            <div className={styles.filterGroup}>
              <div className={styles.filterLabel}>Category</div>
              {LETTER_CATEGORIES.map((cat) => (
                <label key={cat.value} className={styles.filterCheck}>
                  <input
                    type="checkbox"
                    checked={filterCategory.includes(cat.value)}
                    onChange={(e) => {
                      if (e.target.checked) setFilterCategory((p) => [...p, cat.value]);
                      else setFilterCategory((p) => p.filter((c) => c !== cat.value));
                    }}
                  />
                  {cat.label}
                </label>
              ))}
            </div>

            <div className={styles.filterGroup}>
              <div className={styles.filterLabel}>Status</div>
              {(Object.keys(STATUS_LABELS) as MailStatus[]).map((s) => (
                <label key={s} className={styles.filterCheck}>
                  <input
                    type="checkbox"
                    checked={filterStatus.includes(s)}
                    onChange={(e) => {
                      if (e.target.checked) setFilterStatus((p) => [...p, s]);
                      else setFilterStatus((p) => p.filter((x) => x !== s));
                    }}
                  />
                  {STATUS_LABELS[s]}
                </label>
              ))}
            </div>
          </div>
        )}
      </aside>

      {/* Main content */}
      <main className={styles.main}>
        {/* Header */}
        <div className={styles.header}>
          <h1 className={styles.pageTitle}>📬 Mailers</h1>
          <Link href="/mailers/compose" className={styles.btnPrimary}>
            + New Mailer
          </Link>
        </div>

        {/* Tabs */}
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${activeTab === "dashboard" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("dashboard")}
          >
            Dashboard
          </button>
          <button
            className={`${styles.tab} ${activeTab === "table" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("table")}
          >
            All Mail {total > 0 ? `(${total})` : ""}
          </button>
        </div>

        {activeTab === "dashboard" ? renderDashboard() : renderTable()}
      </main>

      {renderSlideOver()}

      {/* Quote confirmation modal */}
      {quote && selectedMailer && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed", inset: 0, zIndex: 1500,
            background: "rgba(15, 23, 42, 0.55)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "1rem",
          }}
          onClick={() => !actionLoading && setQuote(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff", borderRadius: 12, maxWidth: 480, width: "100%",
              boxShadow: "0 20px 60px rgba(0,0,0,0.25)", overflow: "hidden",
            }}
          >
            <div style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid #e5e7eb" }}>
              <div style={{ fontSize: "0.75rem", color: "#6A737B", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                Confirm Send {quote.testMode ? "· TEST MODE" : ""}
              </div>
              <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "#1B2856", marginTop: 4 }}>
                Send for ${(quote.costCents / 100).toFixed(2)}?
              </div>
            </div>
            <div style={{ padding: "1.25rem 1.5rem", lineHeight: 1.55, color: "#374151" }}>
              <div style={{ marginBottom: "0.75rem" }}>
                This will send <strong>{MAIL_TYPE_LABELS[selectedMailer.mailType]}</strong> mail to:
              </div>
              <div style={{ background: "#f8fafc", borderRadius: 8, padding: "0.75rem 1rem", fontSize: "0.9rem" }}>
                <strong>{selectedMailer.recipientName}</strong><br />
                {selectedMailer.recipientAddress}<br />
                {selectedMailer.recipientCity}, {selectedMailer.recipientState} {selectedMailer.recipientZip}
              </div>
              <div style={{ marginTop: "0.85rem", fontSize: "0.85rem", color: "#6A737B" }}>
                {quote.pageCount} page{quote.pageCount === 1 ? "" : "s"} · LetterStream code {quote.code}
                {quote.testMode && (
                  <div style={{ marginTop: "0.5rem", padding: "0.5rem 0.75rem", background: "#fef3c7", color: "#92400e", borderRadius: 6 }}>
                    ⚠ Test mode is enabled — no real mail will be sent. The job will sit in your LetterStream shopping cart for review.
                  </div>
                )}
              </div>
              {quoteError && (
                <div style={{ marginTop: "0.75rem", color: "#B32317", fontSize: "0.85rem" }}>{quoteError}</div>
              )}
            </div>
            <div style={{ padding: "1rem 1.5rem", display: "flex", justifyContent: "flex-end", gap: "0.5rem", background: "#f8fafc" }}>
              <button
                className={styles.btnSm}
                onClick={() => setQuote(null)}
                disabled={actionLoading}
              >
                Cancel
              </button>
              <button
                className={styles.btnPrimary}
                onClick={handleConfirmSend}
                disabled={actionLoading || !quote.authcode}
                style={{ minWidth: 160 }}
              >
                {actionLoading ? "Sending…" : `Confirm & Send · $${(quote.costCents / 100).toFixed(2)}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
