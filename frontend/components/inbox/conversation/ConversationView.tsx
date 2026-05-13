"use client";

// Conversation view — D0-aligned design.
//
// Source: design/shared-inbox-ux-and-ui/project/inbox.jsx lines 341–567.
// Top bar with breadcrumb + prev/next + maximize, a subject block with
// action buttons (Assignee picker / Snooze / Tag / Close), a meta row
// (channel + From + Assigned + SLA chip + tags), the message list as
// rounded cards, and a tabbed composer. A gated presence indicator
// renders the "Devon is viewing" chip when a presence prop is supplied.

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./conversation.module.css";
import { sanitizeEmailHtml } from "../../../lib/sanitizeEmailHtml";
import type { ThreadMessage, ThreadRow } from "../../../hooks/inbox/types";
import type { UseAIDraft } from "../../../hooks/inbox/useAIDraft";
import type { UseCompose } from "../../../hooks/inbox/useCompose";
import type { SlaView } from "../../../hooks/inbox/useSLA";
import type { UseTeamUsers } from "../../../hooks/inbox/useTeamUsers";
import type { UseThreadDetail } from "../../../hooks/inbox/useThreadDetail";
import type {
  AutomationAutoFiring,
  UseThreadAutomations,
} from "../../../hooks/inbox/useThreadAutomations";
import rulesStyles from "../rules/rules.module.css";
import {
  ChannelBadge,
  TagPill,
  avatarColor,
  avatarInitials,
  extractSnoozeUntil,
  formatAbsoluteTime,
  formatRelativeTime,
} from "./chips";
import { slaChipColor } from "../../../hooks/inbox/useSLA";
import ConvoComposer from "./ConvoComposer";
import AttachmentChip from "../AttachmentChip";

export type ConversationViewPresence = {
  /** Display name to show ("Devon"). */
  name: string;
  /** Optional user id for avatar coloring. */
  userId?: number | null;
} | null;

type Props = {
  detail: UseThreadDetail;
  teamUsers: UseTeamUsers;
  slaView: SlaView;
  canMetaMailbox: boolean;
  canReplyMailbox: boolean;
  compose: UseCompose;
  aiDraft: UseAIDraft;
  /** Mailbox name displayed in the breadcrumb. */
  mailboxLabel: string | null;
  /** Mobile-only back action. */
  onCloseMobile: () => void;
  onToggleStar: (t: ThreadRow) => void;
  onUpdate: (patch: Record<string, unknown>) => void;
  onRunAiDraft: () => void;
  onDismissAiDraft: () => void;
  onSend: () => void;
  /** Snooze the thread (POST /snooze). Optional ISO date to schedule a wake-up. */
  onSnooze: (untilIso: string | null) => void;
  /** Add or remove tags additively (POST /tags). */
  onTagOp: (op: { add?: string[]; remove?: string[] }) => void;
  /** Set the thread status (PATCH). */
  onStatusChange: (next: "open" | "snoozed" | "closed") => void;
  /** Presence indicator. When null, the chip is hidden. */
  presence?: ConversationViewPresence;
  /** Prev/next arrows: optional callbacks. */
  onPrevThread?: () => void;
  onNextThread?: () => void;
  /** Phase 4: pending suggestions + recent auto firings on this thread. */
  automations?: UseThreadAutomations | null;
  /** Called after an automation acts on or reverts the thread. Lets the
   *  parent refetch detail + stats. */
  onPatchThreadRefresh?: () => void | Promise<void>;
};

type ConversationEntry =
  | { kind: "message"; data: ThreadMessage; at: string }
  | {
      kind: "response";
      id: number;
      response_type: string;
      body: string | null;
      body_html: string | null;
      sender_name: string | null;
      created_at: string;
      sent_at: string | null;
      send_status: string | null;
      send_error: string | null;
      at: string;
    };

// 24h shortcut tags. Phase 7 replaces the prompt-based flow with a tag
// manager UI.
const SUGGESTED_TAGS = ["urgent", "renewal", "legal", "repair", "waiting:tenant", "waiting:owner"];

export default function ConversationView({
  detail,
  teamUsers,
  slaView,
  canMetaMailbox,
  canReplyMailbox,
  compose,
  aiDraft,
  mailboxLabel,
  onCloseMobile,
  onToggleStar,
  onUpdate,
  onRunAiDraft,
  onDismissAiDraft,
  onSend,
  onSnooze,
  onTagOp,
  onStatusChange,
  presence = null,
  onPrevThread,
  onNextThread,
  automations = null,
  onPatchThreadRefresh,
}: Props) {
  const t = detail.thread;
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const assigneeAnchor = useRef<HTMLButtonElement | null>(null);
  const snoozeAnchor = useRef<HTMLButtonElement | null>(null);
  const tagAnchor = useRef<HTMLButtonElement | null>(null);

  // Close popovers on outside click / Escape.
  useEffect(() => {
    if (!assigneeOpen && !snoozeOpen && !tagOpen) return;
    const onDoc = (e: Event) => {
      const target = e.target as Node;
      const inside =
        assigneeAnchor.current?.contains(target) ||
        snoozeAnchor.current?.contains(target) ||
        tagAnchor.current?.contains(target) ||
        (target as HTMLElement | null)?.closest?.("[data-convo-popover]") !== null;
      if (!inside) {
        setAssigneeOpen(false);
        setSnoozeOpen(false);
        setTagOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAssigneeOpen(false);
        setSnoozeOpen(false);
        setTagOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [assigneeOpen, snoozeOpen, tagOpen]);

  const merged = useMemo<ConversationEntry[]>(() => {
    if (!t) return [];
    const out: ConversationEntry[] = [];
    for (const m of detail.messages) {
      out.push({ kind: "message", data: m, at: m.received_at || "" });
    }
    for (const r of detail.responses) {
      const at = r.sent_at || r.created_at;
      out.push({
        kind: "response",
        id: r.id,
        response_type: r.response_type,
        body: r.body,
        body_html: r.body_html,
        sender_name: r.responded_by_name,
        created_at: r.created_at,
        sent_at: r.sent_at ?? null,
        send_status: r.send_status ?? null,
        send_error: r.send_error ?? null,
        at,
      });
    }
    out.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    return out;
  }, [t, detail.messages, detail.responses]);

  if (!t) {
    return (
      <section className={styles.convoView}>
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-3)",
            fontSize: 13,
          }}
        >
          Select a conversation
        </div>
      </section>
    );
  }

  const sla = slaView;
  const slaChipStyle = sla ? slaChipColor(sla.variant) : null;

  const snoozedUntil = extractSnoozeUntil(t.tags);
  const visibleTags = Array.isArray(t.tags)
    ? t.tags.filter((x) => !x.startsWith("snooze:until:"))
    : [];

  const fromMessage =
    detail.messages.find((m) => m.direction === "inbound") || detail.messages[0];
  const fromName = fromMessage?.sender_name || fromMessage?.sender_email || "—";
  const fromColor = avatarColor(fromMessage?.sender_email || fromMessage?.sender_name || t.thread_id);
  const fromInitials = avatarInitials(fromMessage?.sender_name, fromMessage?.sender_email);

  const assignee =
    t.assignee_id != null
      ? teamUsers.teamUsers.find((u) => u.id === t.assignee_id)
      : null;

  return (
    <section className={styles.convoView}>
      <div className={styles.cvMobileBack}>
        <button
          type="button"
          className={styles.cvMobileBackBtn}
          onClick={onCloseMobile}
          aria-label="Back to list"
        >
          ← Back
        </button>
      </div>

      <header className={styles.cvTopbar}>
        <div className={styles.cvTopbarL}>
          <button
            type="button"
            className={styles.cvIconBtn}
            onClick={onCloseMobile}
            title="Back"
            aria-label="Back"
          >
            ‹
          </button>
          <div className={styles.cvBreadcrumb}>
            {mailboxLabel ? <span>{mailboxLabel}</span> : null}
            {mailboxLabel ? <span>›</span> : null}
            <span className={styles.cvBreadcrumbCurrent}>{t.subject || "(No subject)"}</span>
          </div>
        </div>
        <div className={styles.cvTopbarR}>
          {onPrevThread ? (
            <button
              type="button"
              className={styles.cvIconBtn}
              onClick={onPrevThread}
              title="Previous"
              aria-label="Previous thread"
            >
              ↑
            </button>
          ) : null}
          {onNextThread ? (
            <button
              type="button"
              className={styles.cvIconBtn}
              onClick={onNextThread}
              title="Next"
              aria-label="Next thread"
            >
              ↓
            </button>
          ) : null}
          <span className={styles.cvDivider} aria-hidden />
          <button
            type="button"
            className={styles.cvIconBtn}
            onClick={() => onToggleStar(t)}
            title={t.starred ? "Unstar" : "Star"}
            aria-pressed={t.starred}
            style={t.starred ? { color: "#F59E0B" } : undefined}
          >
            {t.starred ? "★" : "☆"}
          </button>
        </div>
      </header>

      <div className={styles.cvSubjectBlock}>
        <div className={styles.cvSubjectRow}>
          <h1 className={styles.cvSubject}>{t.subject || "(No subject)"}</h1>
          <div className={styles.cvActions}>
            <button
              ref={assigneeAnchor}
              type="button"
              className={styles.cvBtn}
              onClick={() => setAssigneeOpen((o) => !o)}
              disabled={!canMetaMailbox}
              aria-expanded={assigneeOpen}
              title={assignee?.displayName || "Unassigned"}
            >
              <span
                style={{
                  display: "inline-flex",
                  width: 16,
                  height: 16,
                  borderRadius: 999,
                  background: assignee ? avatarColor(assignee.username) : "var(--text-4)",
                  color: "#fff",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 9,
                  fontWeight: 700,
                }}
              >
                {assignee ? avatarInitials(assignee.displayName) : "?"}
              </span>
              {assignee ? assignee.displayName.split(/\s+/)[0] : "Assign"}
            </button>
            <button
              ref={snoozeAnchor}
              type="button"
              className={styles.cvBtn}
              onClick={() => setSnoozeOpen((o) => !o)}
              disabled={!canMetaMailbox}
              aria-expanded={snoozeOpen}
              title="Snooze"
            >
              🌙 Snooze
            </button>
            <button
              ref={tagAnchor}
              type="button"
              className={styles.cvBtn}
              onClick={() => setTagOpen((o) => !o)}
              disabled={!canMetaMailbox}
              aria-expanded={tagOpen}
              title="Tag"
            >
              🏷 Tag
            </button>
            <button
              type="button"
              className={styles.cvBtn}
              onClick={() => onStatusChange("closed")}
              disabled={!canMetaMailbox}
              title={t.status === "closed" ? "Reopen" : "Close"}
            >
              {t.status === "closed" ? "↺ Reopen" : "✓ Close"}
            </button>
          </div>
        </div>
        <div className={styles.cvMetaRow}>
          <ChannelBadge channel={t.channel} />
          <span className={styles.cvMetaText}>
            via {(t.channel || "email").charAt(0).toUpperCase() + (t.channel || "email").slice(1)}
          </span>
          <span className={styles.cvDividerDot} />
          <span className={styles.cvMetaText}>From</span>
          <span
            style={{
              display: "inline-flex",
              width: 16,
              height: 16,
              borderRadius: 999,
              background: fromColor,
              color: "#fff",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 9,
              fontWeight: 700,
            }}
          >
            {fromInitials}
          </span>
          <span className={styles.cvMetaStrong}>{fromName}</span>
          {assignee ? (
            <>
              <span className={styles.cvDividerDot} />
              <span className={styles.cvMetaText}>Assigned</span>
              <span
                style={{
                  display: "inline-flex",
                  width: 16,
                  height: 16,
                  borderRadius: 999,
                  background: avatarColor(assignee.username),
                  color: "#fff",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 9,
                  fontWeight: 700,
                }}
              >
                {avatarInitials(assignee.displayName)}
              </span>
              <span className={styles.cvMetaStrong}>{assignee.displayName}</span>
            </>
          ) : null}
          <span style={{ flex: 1 }} />
          {sla && slaChipStyle ? (
            <span
              className={styles.cvSla}
              style={{ color: slaChipStyle.color, background: slaChipStyle.bg }}
              title={sla.tooltip}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
                <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              {sla.label}
            </span>
          ) : null}
          {snoozedUntil ? (
            <span
              className={styles.cvSla}
              style={{ color: "#7A5AE0", background: "rgba(122,90,224,0.08)" }}
            >
              🌙 Snoozed · {formatRelativeTime(snoozedUntil)}
            </span>
          ) : null}
          {visibleTags.map((tag) => (
            <TagPill key={tag} tag={tag} />
          ))}
        </div>
      </div>

      {/* Presence — design ships the styles; gated dark until presence wires up. */}
      <div className={styles.cvPresence} data-hidden={presence ? "false" : "true"}>
        {presence ? (
          <>
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: 999,
                background: avatarColor(presence.userId ?? presence.name),
                color: "#fff",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 9,
                fontWeight: 700,
              }}
            >
              {avatarInitials(presence.name)}
            </span>
            <span>
              <b>{presence.name}</b> is viewing this conversation
            </span>
            <span style={{ flex: 1 }} />
            <span className={styles.cvPresenceDot} />
          </>
        ) : null}
      </div>

      {automations?.autoFirings && automations.autoFirings.length > 0
        ? automations.autoFirings.map((af) => (
            <AutoActionBanner
              key={af.id}
              firing={af}
              onUndo={async () => {
                const r = await automations.revertAutoFiring(af.id);
                if (r.ok) await onPatchThreadRefresh?.();
              }}
            />
          ))
        : null}

      <div className={styles.cvMessages}>
        {merged.map((entry) =>
          entry.kind === "message" ? (
            <MessageCard key={`m-${entry.data.id}`} msg={entry.data} />
          ) : (
            <ResponseCard
              key={`r-${entry.id}`}
              type={entry.response_type}
              body={entry.body}
              body_html={entry.body_html}
              senderName={entry.sender_name}
              sentAt={entry.sent_at}
              createdAt={entry.created_at}
              sendStatus={entry.send_status}
              sendError={entry.send_error}
            />
          )
        )}
      </div>

      <ConvoComposer
        thread={t}
        compose={compose}
        aiDraft={aiDraft}
        canReply={canReplyMailbox}
        onRunAiDraft={onRunAiDraft}
        onDismissAiDraft={onDismissAiDraft}
        onSend={onSend}
        automations={automations}
        onAutomationActed={onPatchThreadRefresh}
      />

      {/* Popovers */}
      {assigneeOpen ? (
        <Popover anchor={assigneeAnchor} onClose={() => setAssigneeOpen(false)}>
          <PopoverTitle>Assign to</PopoverTitle>
          <PopoverItem
            onClick={() => {
              onUpdate({ assignee_id: null });
              setAssigneeOpen(false);
            }}
          >
            <span style={{ color: "var(--text-3)" }}>Unassigned</span>
          </PopoverItem>
          {teamUsers.teamUsers.map((u) => (
            <PopoverItem
              key={u.id}
              onClick={() => {
                onUpdate({ assignee_id: u.id });
                setAssigneeOpen(false);
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  width: 18,
                  height: 18,
                  borderRadius: 999,
                  background: avatarColor(u.username),
                  color: "#fff",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 9,
                  fontWeight: 700,
                  marginRight: 6,
                }}
              >
                {avatarInitials(u.displayName)}
              </span>
              {u.displayName}
            </PopoverItem>
          ))}
        </Popover>
      ) : null}

      {snoozeOpen ? (
        <Popover anchor={snoozeAnchor} onClose={() => setSnoozeOpen(false)}>
          <PopoverTitle>Snooze until</PopoverTitle>
          {[
            { label: "1 hour", hours: 1 },
            { label: "3 hours", hours: 3 },
            { label: "Tomorrow morning", hours: 16, alignToHour: 8 },
            { label: "Next Monday", hours: 24 * 7, alignToHour: 8 },
          ].map((opt) => (
            <PopoverItem
              key={opt.label}
              onClick={() => {
                const d = new Date();
                d.setMilliseconds(0);
                d.setSeconds(0);
                if (opt.alignToHour != null) {
                  d.setHours(opt.alignToHour, 0, 0, 0);
                }
                d.setTime(d.getTime() + opt.hours * 60 * 60 * 1000);
                onSnooze(d.toISOString());
                setSnoozeOpen(false);
              }}
            >
              {opt.label}
            </PopoverItem>
          ))}
          <PopoverItem
            onClick={() => {
              onSnooze(null);
              setSnoozeOpen(false);
            }}
          >
            Snooze (no wake-up)
          </PopoverItem>
        </Popover>
      ) : null}

      {tagOpen ? (
        <Popover anchor={tagAnchor} onClose={() => setTagOpen(false)}>
          <PopoverTitle>Tags</PopoverTitle>
          {SUGGESTED_TAGS.map((tag) => {
            const on = visibleTags.includes(tag);
            return (
              <PopoverItem
                key={tag}
                onClick={() => {
                  onTagOp(on ? { remove: [tag] } : { add: [tag] });
                }}
              >
                <span style={{ marginRight: 6, color: on ? "var(--accent)" : "var(--text-4)" }}>
                  {on ? "✓" : "+"}
                </span>
                {tag.startsWith("waiting:")
                  ? `Waiting · ${tag.slice("waiting:".length)}`
                  : tag.charAt(0).toUpperCase() + tag.slice(1)}
              </PopoverItem>
            );
          })}
        </Popover>
      ) : null}
    </section>
  );
}

function MessageCard({ msg }: { msg: ThreadMessage }) {
  const isOutbound = msg.direction === "outbound";
  const senderName = msg.sender_name || msg.sender_email || "(unknown)";
  const initials = avatarInitials(msg.sender_name, msg.sender_email);
  const color = avatarColor(msg.sender_email || msg.sender_name || msg.id);
  return (
    <article className={styles.cvMsg}>
      <span className={styles.cvMsgAvatar} style={{ background: color }} aria-hidden>
        {initials}
      </span>
      <div className={styles.cvMsgBody}>
        <header className={styles.cvMsgHd}>
          <span className={styles.cvMsgName}>
            {isOutbound ? "↗ " : ""}
            {senderName}
          </span>
          {msg.recipient_emails ? (
            <span className={styles.cvMsgTo}>to {msg.recipient_emails}</span>
          ) : null}
          <span className={styles.cvMsgTime}>{formatAbsoluteTime(msg.received_at)}</span>
        </header>
        <div
          className={styles.cvMsgText}
          dangerouslySetInnerHTML={{
            __html: sanitizeEmailHtml(msg.body_html || "<p>(No body)</p>"),
          }}
        />
        {msg.attachments && msg.attachments.length > 0 ? (
          <div className={styles.cvAttachments}>
            {msg.attachments.map((a) => (
              <AttachmentChip key={a.id} att={a} />
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function ResponseCard({
  type,
  body,
  body_html,
  senderName,
  sentAt,
  createdAt,
  sendStatus,
  sendError,
}: {
  type: string;
  body: string | null;
  body_html: string | null;
  senderName: string | null;
  sentAt: string | null;
  createdAt: string;
  sendStatus: string | null;
  sendError: string | null;
}) {
  const isNote = type === "note";
  const initials = avatarInitials(senderName, null);
  const color = avatarColor(senderName);
  const html = body_html || (body ? `<p>${escapeHtml(body)}</p>` : "<p>(No body)</p>");
  return (
    <article
      className={styles.cvMsg}
      style={isNote ? { background: "rgba(245,158,11,0.06)", borderColor: "rgba(180,83,9,0.20)" } : undefined}
    >
      <span className={styles.cvMsgAvatar} style={{ background: color }} aria-hidden>
        {initials}
      </span>
      <div className={styles.cvMsgBody}>
        <header className={styles.cvMsgHd}>
          <span className={styles.cvMsgName}>{senderName || "—"}</span>
          {isNote ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "1px 7px",
                borderRadius: 999,
                background: "rgba(180,83,9,0.12)",
                color: "#B45309",
                fontSize: 10.5,
                fontWeight: 600,
                letterSpacing: "0.02em",
                textTransform: "uppercase",
              }}
            >
              Internal note
            </span>
          ) : null}
          <span className={styles.cvMsgTime}>{formatAbsoluteTime(sentAt || createdAt)}</span>
        </header>
        <div
          className={styles.cvMsgText}
          dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(html) }}
        />
        {sendStatus === "failed" ? (
          <div style={{ marginTop: 6, color: "#B32317", fontSize: 11.5 }}>
            Send failed{sendError ? `: ${sendError}` : ""}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* ────────────────────── Popover primitives ────────────────────── */

function Popover({
  anchor,
  onClose,
  children,
}: {
  anchor: React.RefObject<HTMLElement>;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const rect = anchor.current?.getBoundingClientRect();
  const top = rect ? rect.bottom + 4 : 100;
  const right = rect ? Math.max(8, window.innerWidth - rect.right) : 24;
  void onClose; // close handled at parent level
  return (
    <div
      data-convo-popover
      style={{
        position: "fixed",
        top,
        right,
        minWidth: 200,
        maxHeight: 300,
        overflow: "auto",
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        boxShadow: "0 8px 24px rgba(15,23,42,0.10)",
        padding: 4,
        zIndex: 50,
      }}
    >
      {children}
    </div>
  );
}

function PopoverTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "6px 10px 4px",
        fontSize: 10.5,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: "var(--text-4)",
        fontWeight: 600,
      }}
    >
      {children}
    </div>
  );
}

function PopoverItem({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        width: "100%",
        padding: "6px 10px",
        border: "none",
        background: "transparent",
        color: "var(--text-2)",
        fontSize: 12.5,
        fontWeight: 500,
        textAlign: "left",
        cursor: "pointer",
        borderRadius: 6,
        fontFamily: "inherit",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--hover)";
        e.currentTarget.style.color = "var(--text)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--text-2)";
      }}
    >
      {children}
    </button>
  );
}

/* ────────────────────── Auto-action banner ────────────────────── */

function AutoActionBanner({
  firing,
  onUndo,
}: {
  firing: AutomationAutoFiring;
  onUndo: () => Promise<void> | void;
}) {
  const action = describeFiringAction(firing);
  return (
    <div className={rulesStyles.autoBanner}>
      <span className={rulesStyles.autoBannerLabel}>
        <b>{action}</b> by <em>“{firing.ruleName}”</em>
      </span>
      <button
        type="button"
        className={rulesStyles.autoBannerUndo}
        onClick={() => void onUndo()}
        disabled={!firing.revertable}
        title={firing.revertable ? "Undo this action" : "This action can't be undone"}
      >
        ↶ Undo
      </button>
    </div>
  );
}

function describeFiringAction(firing: AutomationAutoFiring): string {
  const p = firing.proposedAction || {};
  switch (firing.ruleAction) {
    case "assign":
      return `Auto-assigned to ${p.assignee_username ?? "—"}`;
    case "set_status":
      return `Status set to ${p.status ?? "—"}`;
    case "set_priority":
      return `Priority set to ${p.priority ?? "—"}`;
    case "close":
      return "Auto-closed";
    case "star":
      return "Auto-starred";
    case "escalate": {
      const who = p.assignee_username ?? "—";
      const pri = p.priority ? ` at ${p.priority} priority` : "";
      return `Escalated to ${who}${pri}`;
    }
    case "apply_label":
      return `Tag ${p.label ?? "—"} applied`;
    default:
      return `Auto-action: ${firing.ruleAction}`;
  }
}
