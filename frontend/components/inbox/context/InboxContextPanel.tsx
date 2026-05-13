"use client";

// Right-hand context panel — Phase 6, design-aligned.
//
// Source: design/.../inbox.jsx ContextPanel (lines 568–666). Five
// sections: property card, lease, work orders, past conversations,
// notes. Data loads in parallel with the message detail.

import { useState } from "react";
import { avatarColor, avatarInitials } from "../conversation/chips";
import type { UseThreadContext, ContextWorkOrder, ContextPastConversation } from "../../../hooks/inbox/useThreadContext";
import styles from "./context.module.css";

const CHANNEL_ICON: Record<string, string> = {
  email: "✉",
  sms: "💬",
  whatsapp: "🟢",
  voicemail: "📞",
  webchat: "💭",
};

function formatRent(rent: number | null | undefined): string {
  if (rent == null || !Number.isFinite(rent)) return "—";
  return `$${rent.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function leaseStatusVariant(status: string | null | undefined): string {
  if (!status) return styles.ctxSectionPillNeutral;
  const s = status.toLowerCase();
  if (s.includes("expir")) return styles.ctxSectionPillWarn;
  if (s.includes("end")) return styles.ctxSectionPillNeutral;
  return ""; // "Active" → default green pill
}

function newWorkOrderHref(propertyName: string | null | undefined): string {
  // AppFolio doesn't accept query-param prefill, but landing the operator
  // on the work-orders page with the property pre-known is the lowest-
  // friction option until we wire a deep link.
  const base = "https://rpmtx033.appfolio.com/work_orders/new";
  if (propertyName) {
    return `${base}?property=${encodeURIComponent(propertyName)}`;
  }
  return base;
}

export default function InboxContextPanel({
  context,
  onSelectPastThread,
  onLinkProperty,
}: {
  context: UseThreadContext;
  onSelectPastThread?: (threadId: string) => void;
  onLinkProperty?: () => void;
}) {
  const data = context.data;

  if (context.loading && !data) {
    return (
      <aside className={styles.ctxPanel} aria-label="Conversation context">
        <div className={styles.ctxEmpty}>
          <div className={styles.ctxEmptySub}>Loading context…</div>
        </div>
      </aside>
    );
  }

  if (!data || !data.hasLinkedEntity) {
    return (
      <aside className={styles.ctxPanel} aria-label="Conversation context">
        <div className={styles.ctxEmpty}>
          <div className={styles.ctxEmptyTitle}>No property linked</div>
          <p className={styles.ctxEmptySub}>
            The conversation classifier hasn&rsquo;t matched a property, tenant, or owner
            yet. Link one to see lease info, work orders, and past conversations here.
          </p>
          <button
            type="button"
            className={styles.ctxEmptyBtn}
            onClick={() => onLinkProperty?.()}
            disabled={!onLinkProperty}
          >
            Link a property
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className={styles.ctxPanel} aria-label="Conversation context">
      {data.property ? <PropertyCard property={data.property} /> : null}
      {data.lease ? <LeaseSection lease={data.lease} /> : null}
      <WorkOrdersSection
        workOrders={data.workOrders}
        propertyName={data.property?.name ?? null}
      />
      <PastConversationsSection
        rows={data.pastConversations}
        onSelect={onSelectPastThread}
      />
      <NotesSection
        notes={data.notes}
        onAdd={context.addNote}
        onDelete={context.deleteNote}
      />
    </aside>
  );
}

/* ────────────────────────── Sections ────────────────────────── */

function PropertyCard({ property }: { property: NonNullable<UseThreadContext["data"]>["property"] }) {
  if (!property) return null;
  const cityLine = [property.city, property.state, property.zip].filter(Boolean).join(", ");
  const metaBits = [
    property.beds ? `${property.beds} bd` : null,
    property.baths ? `${property.baths} ba` : null,
    property.sqft ? `${property.sqft.toLocaleString()} sqft` : null,
    property.type,
  ].filter(Boolean);

  return (
    <section className={`${styles.ctxSection} ${styles.ctxProperty}`}>
      <div className={styles.ctxPropertyImg}>
        <svg viewBox="0 0 200 110" preserveAspectRatio="xMidYMid slice" style={{ width: "100%", height: "100%" }}>
          <defs>
            <linearGradient id="ctxG" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#1B2856" />
              <stop offset="100%" stopColor="#0098D0" />
            </linearGradient>
          </defs>
          <rect width="200" height="110" fill="url(#ctxG)" />
          <g fill="rgba(255,255,255,.12)">
            <path d="M0 90 L40 60 L80 78 L130 50 L200 84 L200 110 L0 110 z" />
          </g>
          <g stroke="rgba(255,255,255,.5)" fill="rgba(255,255,255,.08)" strokeWidth="1.2">
            <path d="M120 85 V60 L142 46 L164 60 V85 Z" />
            <rect x="135" y="68" width="14" height="17" fill="rgba(27,40,86,.55)" />
          </g>
        </svg>
        {property.portfolio ? (
          <span className={styles.ctxPropertyPortfolio}>{property.portfolio}</span>
        ) : null}
      </div>
      <div className={styles.ctxSectionBody}>
        <h3 className={styles.ctxPropertyAddr}>{property.address || property.name}</h3>
        {cityLine ? <div className={styles.ctxPropertySub}>{cityLine}</div> : null}
        {metaBits.length ? (
          <div className={styles.ctxPropertyMeta}>
            {metaBits.map((b, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                {i > 0 ? <span className={styles.ctxDot} /> : null}
                <span>{b}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function LeaseSection({ lease }: { lease: NonNullable<UseThreadContext["data"]>["lease"] }) {
  if (!lease) return null;
  const statusLabel = lease.status || "Active";
  return (
    <section className={styles.ctxSection}>
      <div className={styles.ctxSectionHd}>
        <span>Lease</span>
        <span className={`${styles.ctxSectionPill} ${leaseStatusVariant(statusLabel)}`}>
          {statusLabel}
        </span>
      </div>
      <div className={`${styles.ctxSectionBody} ${styles.ctxLeaseGrid}`}>
        <div>
          <div className={styles.ctxKvK}>Tenant</div>
          <div className={styles.ctxKvV}>{lease.tenant || "—"}</div>
        </div>
        <div>
          <div className={styles.ctxKvK}>Rent</div>
          <div className={styles.ctxKvV}>{formatRent(lease.rent)}</div>
        </div>
        <div>
          <div className={styles.ctxKvK}>Start</div>
          <div className={styles.ctxKvV}>{formatDate(lease.start)}</div>
        </div>
        <div>
          <div className={styles.ctxKvK}>End</div>
          <div className={styles.ctxKvV}>{formatDate(lease.end)}</div>
        </div>
      </div>
    </section>
  );
}

function WorkOrdersSection({
  workOrders,
  propertyName,
}: {
  workOrders: ContextWorkOrder[];
  propertyName: string | null;
}) {
  return (
    <section className={styles.ctxSection}>
      <div className={styles.ctxSectionHd}>
        <span>Work orders</span>
        <a
          href={newWorkOrderHref(propertyName)}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.ctxSectionLink}
        >
          + New
        </a>
      </div>
      <div className={styles.ctxSectionBody} style={{ paddingTop: 4, paddingBottom: 4 }}>
        {workOrders.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-3)", padding: "8px 0" }}>
            No open work orders.
          </div>
        ) : (
          workOrders.map((wo, i) => <WorkOrderRow key={wo.id ?? i} wo={wo} />)
        )}
      </div>
    </section>
  );
}

function WorkOrderRow({ wo }: { wo: ContextWorkOrder }) {
  const prio = (wo.priority || "").toLowerCase();
  const prioClass =
    prio.startsWith("h") || prio === "emergency"
      ? styles.ctxWoPrioHigh
      : prio.startsWith("m") || prio === "normal"
        ? styles.ctxWoPrioMed
        : prio.startsWith("l")
          ? styles.ctxWoPrioLow
          : "";
  const label = (wo.priority || "—").slice(0, 1).toUpperCase();
  return (
    <button
      type="button"
      className={styles.ctxWo}
      onClick={() => {
        if (wo.id) {
          window.open(`https://rpmtx033.appfolio.com/work_orders/${wo.id}`, "_blank", "noopener");
        }
      }}
      title={wo.title}
    >
      <span className={`${styles.ctxWoPrio} ${prioClass}`}>{label}</span>
      <span className={styles.ctxWoBody}>
        <span className={styles.ctxWoTitle}>
          {wo.id ? <span className={styles.ctxWoId}>#{wo.id}</span> : null}
          {wo.title}
        </span>
        <span className={styles.ctxWoMeta}>
          {[wo.vendor, wo.status].filter(Boolean).join(" · ") || "—"}
        </span>
      </span>
      <span style={{ color: "var(--text-4)", fontSize: 12 }}>›</span>
    </button>
  );
}

function PastConversationsSection({
  rows,
  onSelect,
}: {
  rows: ContextPastConversation[];
  onSelect?: (threadId: string) => void;
}) {
  return (
    <section className={styles.ctxSection}>
      <div className={styles.ctxSectionHd}>
        <span>Past conversations</span>
        <span className={styles.ctxSectionCount}>{rows.length}</span>
      </div>
      <div className={styles.ctxSectionBody} style={{ paddingTop: 4, paddingBottom: 8 }}>
        {rows.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-3)", padding: "8px 0" }}>
            No earlier threads on this property.
          </div>
        ) : (
          rows.map((p) => (
            <button
              key={p.threadId}
              type="button"
              className={styles.ctxPast}
              onClick={() => onSelect?.(p.threadId)}
              title={p.subject || "(no subject)"}
            >
              <span className={styles.ctxPastChannel} aria-hidden>
                {CHANNEL_ICON[p.channel] || CHANNEL_ICON.email}
              </span>
              <span className={styles.ctxPastSubject}>
                {p.subject || "(no subject)"}
              </span>
              <span className={styles.ctxPastWhen}>{formatRelative(p.lastMessageAt)}</span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}

function NotesSection({
  notes,
  onAdd,
  onDelete,
}: {
  notes: NonNullable<UseThreadContext["data"]>["notes"];
  onAdd: UseThreadContext["addNote"];
  onDelete: UseThreadContext["deleteNote"];
}) {
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!draft.trim() || saving) return;
    setSaving(true);
    const r = await onAdd(draft);
    setSaving(false);
    if (r.ok) {
      setDraft("");
      setComposing(false);
    }
  };

  return (
    <section className={styles.ctxSection}>
      <div className={styles.ctxSectionHd}>
        <span>Notes</span>
      </div>
      <div className={styles.ctxSectionBody}>
        {notes.length === 0 && !composing ? (
          <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 6 }}>
            No notes yet.
          </div>
        ) : null}
        {notes.map((n) => (
          <div key={n.id} className={styles.ctxNote}>
            <span
              className={styles.ctxNoteAvatar}
              style={{ background: avatarColor(n.authorName || "?") }}
              aria-hidden
            >
              {avatarInitials(n.authorName)}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className={styles.ctxNoteBody}>{n.body}</div>
              <div className={styles.ctxNoteMeta}>
                {n.authorName || "—"} · {formatRelative(n.createdAt)}
              </div>
            </div>
            <button
              type="button"
              className={styles.ctxNoteDelete}
              onClick={() => void onDelete(n.id)}
              aria-label="Delete note"
              title="Delete note"
            >
              ×
            </button>
          </div>
        ))}
        {composing ? (
          <div className={styles.ctxNoteForm}>
            <textarea
              className={styles.ctxNoteInput}
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Add a note about this property…"
              rows={3}
            />
            <div className={styles.ctxNoteFormRow}>
              <button
                type="button"
                className={styles.ctxNoteFormBtn}
                onClick={() => {
                  setComposing(false);
                  setDraft("");
                }}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`${styles.ctxNoteFormBtn} ${styles.ctxNoteFormBtnPrimary}`}
                onClick={() => void save()}
                disabled={saving || !draft.trim()}
              >
                {saving ? "Saving…" : "Save note"}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className={styles.ctxNoteAdd}
            onClick={() => setComposing(true)}
          >
            + Add note
          </button>
        )}
      </div>
    </section>
  );
}

