"use client";

import styles from "../../app/(protected)/inbox/inbox.module.css";
import { sanitizeEmailHtml } from "../../lib/sanitizeEmailHtml";
import type { TicketRow } from "../../hooks/inbox/types";
import type { UseThreadDetail } from "../../hooks/inbox/useThreadDetail";
import type { UseTeamUsers } from "../../hooks/inbox/useTeamUsers";
import type { SlaView } from "../../hooks/inbox/useSLA";
import { CATEGORY_OPTIONS, priorityTier } from "./inboxConstants";

type Props = {
  detail: UseThreadDetail;
  teamUsers: UseTeamUsers;
  slaView: SlaView;
  /** Mailbox permission allows changing status / assign / priority / category. */
  canMetaMailbox: boolean;
  onToggleStar: (ticket: TicketRow) => void;
  onUpdate: (patch: Record<string, unknown>) => void;
};

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

  return (
    <>
      <div className={styles.detailHeaderSection}>
        <div className={styles.detailHead}>
          <h2>{t.subject || "(No subject)"}</h2>
          <p className={styles.metaLine}>
            From: {t.sender_name || "—"} &lt;{t.sender_email || ""}&gt;
          </p>
          <p className={styles.metaLine}>To: {t.recipient_emails || "—"}</p>
          <p className={styles.metaLineReceived}>
            <span>
              Received: {t.received_at ? new Date(t.received_at).toLocaleString() : "—"}
            </span>
            {slaView ? (
              <span className={styles.slaBadge} data-variant={slaView.variant}>
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
            {t.is_starred ? "★ Starred" : "☆ Star"}
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
              <option value="open">Open</option>
              <option value="in_progress">In progress</option>
              <option value="waiting">Waiting</option>
              <option value="resolved">Resolved</option>
            </select>
          </label>
          <label>
            Assigned to
            <select
              value={t.assigned_to ?? ""}
              disabled={!canMetaMailbox}
              onChange={(e) =>
                onUpdate({
                  assignedTo: e.target.value === "" ? null : Number(e.target.value),
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
              value={priorityTier(t.priority)}
              disabled={!canMetaMailbox}
              onChange={(e) => onUpdate({ priority: Number(e.target.value) })}
            >
              <option value={95}>Urgent</option>
              <option value={75}>High</option>
              <option value={50}>Normal</option>
              <option value={25}>Low</option>
            </select>
          </label>
          <label>
            Category
            <select
              value={t.category}
              disabled={!canMetaMailbox}
              onChange={(e) => onUpdate({ category: e.target.value })}
            >
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
        <div
          className={styles.bodyHtml}
          dangerouslySetInnerHTML={{
            __html: sanitizeEmailHtml(t.body_html || "<p>(No body)</p>"),
          }}
        />

        {detail.messages.length > 0 ? (
          <div className={styles.threadBlock}>
            <h3 style={{ fontSize: "0.95rem", marginBottom: "0.5rem" }}>Thread & notes</h3>
            {detail.messages.map((r) => (
              <div key={r.id} className={styles.threadItem}>
                <div className={styles.threadMeta}>
                  {r.response_type === "reply" ? "Reply" : "Note"} · {r.responded_by_name || "—"} ·{" "}
                  {new Date(r.created_at).toLocaleString()}
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
