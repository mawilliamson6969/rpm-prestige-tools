"use client";

import styles from "../../app/(protected)/inbox/inbox.module.css";
import { sanitizeEmailHtml } from "../../lib/sanitizeEmailHtml";
import type { ThreadMessage, ThreadRow } from "../../hooks/inbox/types";
import type { UseThreadDetail } from "../../hooks/inbox/useThreadDetail";
import type { UseTeamUsers } from "../../hooks/inbox/useTeamUsers";
import type { SlaView } from "../../hooks/inbox/useSLA";
import { CATEGORY_OPTIONS } from "./inboxConstants";

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "waiting_on_tenant", label: "Waiting on tenant" },
  { value: "waiting_on_owner", label: "Waiting on owner" },
  { value: "waiting_on_vendor", label: "Waiting on vendor" },
  { value: "snoozed", label: "Snoozed" },
  { value: "closed", label: "Closed" },
];

const PRIORITY_OPTIONS: { value: string; label: string }[] = [
  { value: "emergency", label: "Emergency" },
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
];

type Props = {
  detail: UseThreadDetail;
  teamUsers: UseTeamUsers;
  slaView: SlaView;
  canMetaMailbox: boolean;
  onToggleStar: (thread: ThreadRow) => void;
  onUpdate: (patch: Record<string, unknown>) => void;
};

const MSG_BLOCK_STYLE: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e2e4e8",
  borderRadius: 8,
  padding: "0.85rem 1rem",
  marginBottom: "0.6rem",
};
const MSG_BLOCK_OUTBOUND_STYLE: React.CSSProperties = {
  ...MSG_BLOCK_STYLE,
  borderLeft: "3px solid #0098D0",
  background: "#f4faff",
};
const MSG_HEADER_STYLE: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: "0.5rem",
  marginBottom: "0.35rem",
};
const MSG_SENDER_STYLE: React.CSSProperties = { fontWeight: 600, color: "#1b2856", fontSize: "0.92rem" };
const MSG_TIME_STYLE: React.CSSProperties = { color: "#6a737b", fontSize: "0.8rem" };
const MSG_RECIPIENTS_STYLE: React.CSSProperties = { color: "#6a737b", fontSize: "0.8rem", margin: "0 0 0.35rem" };

function MessageBlock({ msg }: { msg: ThreadMessage }) {
  const isOutbound = msg.direction === "outbound";
  return (
    <article style={isOutbound ? MSG_BLOCK_OUTBOUND_STYLE : MSG_BLOCK_STYLE}>
      <header style={MSG_HEADER_STYLE}>
        <span style={MSG_SENDER_STYLE}>
          {isOutbound ? "↗ " : ""}
          {msg.sender_name || msg.sender_email || "(unknown sender)"}
        </span>
        <span style={MSG_TIME_STYLE}>
          {msg.received_at ? new Date(msg.received_at).toLocaleString() : ""}
        </span>
      </header>
      {msg.recipient_emails ? <p style={MSG_RECIPIENTS_STYLE}>To: {msg.recipient_emails}</p> : null}
      <div
        className={styles.bodyHtml}
        dangerouslySetInnerHTML={{
          __html: sanitizeEmailHtml(msg.body_html || "<p>(No body)</p>"),
        }}
      />
    </article>
  );
}

export default function InboxDetail({
  detail,
  teamUsers,
  slaView,
  canMetaMailbox,
  onToggleStar,
  onUpdate,
}: Props) {
  const t = detail.thread;
  if (!t) return null;
  const messageCount = detail.messages.length;

  return (
    <>
      <div className={styles.detailHeaderSection}>
        <div className={styles.detailHead}>
          <h2>{t.subject || "(No subject)"}</h2>
          <p className={styles.metaLine}>
            {messageCount} message{messageCount === 1 ? "" : "s"}
            {t.has_attachments ? " · 📎 attachments" : ""}
          </p>
          <p className={styles.metaLineReceived}>
            <span>
              Last activity: {t.last_message_at ? new Date(t.last_message_at).toLocaleString() : "—"}
            </span>
            {slaView ? (
              <span
                className={styles.slaBadge}
                data-variant={slaView.variant}
                title={slaView.tooltip}
              >
                {slaView.label}
              </span>
            ) : null}
          </p>
          <p className={styles.receivedInLine}>
            Received in: {(t.mailbox_display_name || t.mailbox_email || "").trim() || "—"}
          </p>
          <button
            type="button"
            className={styles.starBtn}
            style={{ fontSize: "1.25rem" }}
            onClick={() => onToggleStar(t)}
          >
            {t.starred ? "★ Starred" : "☆ Star"}
          </button>
        </div>

        {t.ai_summary ? (
          <div className={styles.aiBox}>
            <strong>AI summary:</strong> {t.ai_summary}
            <div className={styles.chips}>
              {t.linked_property_name ? (
                <span className={styles.chip}>Property: {t.linked_property_name}</span>
              ) : null}
              {t.linked_tenant_name ? (
                <span className={styles.chip}>Tenant: {t.linked_tenant_name}</span>
              ) : null}
              {t.linked_owner_name ? (
                <span className={styles.chip}>Owner: {t.linked_owner_name}</span>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className={styles.actionBar}>
          <label>
            Status
            <select
              value={t.status}
              disabled={!canMetaMailbox}
              onChange={(e) => onUpdate({ status: e.target.value })}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Assigned to
            <select
              value={t.assignee_id ?? ""}
              disabled={!canMetaMailbox}
              onChange={(e) =>
                onUpdate({
                  assignee_id: e.target.value === "" ? null : Number(e.target.value),
                })
              }
            >
              <option value="">Unassigned</option>
              {teamUsers.teamUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select
              value={t.priority}
              disabled={!canMetaMailbox}
              onChange={(e) => onUpdate({ priority: e.target.value })}
            >
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Category
            <select
              value={t.category ?? ""}
              disabled={!canMetaMailbox}
              onChange={(e) => onUpdate({ category: e.target.value || null })}
            >
              <option value="">—</option>
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className={styles.detailEmailScroll}>
        <div>
          {detail.messages.map((m) => (
            <MessageBlock key={m.id} msg={m} />
          ))}
        </div>

        {detail.responses.length > 0 ? (
          <div className={styles.threadBlock}>
            <h3 style={{ fontSize: "0.95rem", marginBottom: "0.5rem" }}>Replies & notes</h3>
            {detail.responses.map((r) => (
              <div key={r.id} className={styles.threadItem}>
                <div className={styles.threadMeta}>
                  {r.response_type === "reply" ? "Reply" : "Note"} · {r.responded_by_name || "—"} ·{" "}
                  {new Date(r.created_at).toLocaleString()}
                  {r.send_status === "failed" ? (
                    <span style={{ color: "var(--red, #b32317)", marginLeft: "0.5rem" }}>
                      send failed{r.send_error ? `: ${r.send_error}` : ""}
                    </span>
                  ) : null}
                </div>
                <div>{r.body}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}
