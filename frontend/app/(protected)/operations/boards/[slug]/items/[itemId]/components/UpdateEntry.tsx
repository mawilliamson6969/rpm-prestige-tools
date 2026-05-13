"use client";

import { useState } from "react";
import styles from "./detail.module.css";
import AttachmentChip from "./AttachmentChip";
import ReactionBar from "./ReactionBar";
import UpdateComposer from "./UpdateComposer";
import type { MentionableUser } from "./MentionDropdown";
import type { ItemUpdate, ReactionEmoji } from "@/types/mb";

const EDIT_WINDOW_MS = 15 * 60 * 1000;

function relativeTime(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

export default function UpdateEntry({
  update,
  replies,
  currentUserId,
  isAdmin,
  users,
  onReply,
  onEdit,
  onDelete,
  onReact,
}: {
  update: ItemUpdate;
  replies: ItemUpdate[];
  currentUserId: number | null;
  isAdmin: boolean;
  users: MentionableUser[];
  onReply: (parentId: number, data: { bodyHtml: string; text: string; files: File[] }) => Promise<boolean>;
  onEdit: (id: number, data: { bodyHtml: string }) => Promise<boolean>;
  onDelete: (id: number) => Promise<void>;
  onReact: (id: number, emoji: ReactionEmoji, mine: boolean) => Promise<void>;
}) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // System entries render minimal.
  if (update.update_type === "system") {
    return (
      <div className={styles.systemEntry}>
        <span className={styles.systemDot} />
        <span style={{ fontWeight: 600, color: "#1b2856" }}>
          {update.user_display_name || "System"}
        </span>
        <span>·</span>
        <span>{update.body}</span>
        <span className={styles.entryTime} style={{ marginLeft: "auto" }}>
          {relativeTime(update.created_at)}
        </span>
      </div>
    );
  }

  const deleted = update.deleted_at != null;
  const mine = update.user_id != null && update.user_id === currentUserId;
  const ageMs = Date.now() - new Date(update.created_at).getTime();
  const canEdit = !deleted && mine && ageMs < EDIT_WINDOW_MS;
  const canDelete = !deleted && (mine || isAdmin);

  return (
    <div className={styles.entry}>
      <div className={styles.entryHead}>
        <span className={styles.entryAuthor}>
          {update.user_display_name || "Unknown user"}
        </span>
        <span className={styles.entryTime}>{relativeTime(update.created_at)}</span>
        {update.edited_at ? (
          <span
            className={styles.editedBadge}
            title={`Edited ${new Date(update.edited_at).toLocaleString()}`}
          >
            (edited)
          </span>
        ) : null}
        <div className={styles.entryActions}>
          {canEdit ? (
            <button
              type="button"
              className={styles.actionLink}
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
          ) : null}
          {canDelete ? (
            <button
              type="button"
              className={`${styles.actionLink} ${styles.actionLinkDanger}`}
              onClick={() => onDelete(update.id)}
            >
              Delete
            </button>
          ) : null}
        </div>
      </div>

      {editing ? (
        <UpdateComposer
          users={users}
          initialHtml={update.body_html ?? ""}
          submitLabel="Save"
          onCancel={() => setEditing(false)}
          submitting={submitting}
          onSubmit={async ({ bodyHtml }) => {
            setSubmitting(true);
            const ok = await onEdit(update.id, { bodyHtml });
            setSubmitting(false);
            if (ok) setEditing(false);
            return ok;
          }}
        />
      ) : deleted ? (
        <div className={`${styles.entryBody} ${styles.deletedEntry}`}>
          Comment deleted
        </div>
      ) : (
        <div
          className={styles.entryBody}
          dangerouslySetInnerHTML={{ __html: update.body_html ?? "" }}
        />
      )}

      {!deleted && update.attachments && update.attachments.length > 0 ? (
        <div className={styles.attachmentList}>
          {update.attachments.map((a) => (
            <AttachmentChip key={a.id} attachment={a} />
          ))}
        </div>
      ) : null}

      {!deleted && update.parent_update_id == null ? (
        <ReactionBar
          reactions={update.reactions ?? []}
          currentUserId={currentUserId}
          onToggle={(e, mineNow) => onReact(update.id, e, mineNow)}
        />
      ) : null}

      {/* Reply controls are only on top-level comments. */}
      {!deleted && update.parent_update_id == null ? (
        <div style={{ marginTop: "0.4rem" }}>
          <button
            type="button"
            className={styles.actionLink}
            onClick={() => setReplyOpen((v) => !v)}
          >
            {replies.length > 0
              ? `${replies.length} repl${replies.length === 1 ? "y" : "ies"} · Reply`
              : "Reply"}
          </button>
        </div>
      ) : null}

      {replies.length > 0 ? (
        <div className={styles.replies}>
          {replies.map((r) => (
            <UpdateEntry
              key={r.id}
              update={r}
              replies={[]}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              users={users}
              onReply={onReply}
              onEdit={onEdit}
              onDelete={onDelete}
              onReact={onReact}
            />
          ))}
        </div>
      ) : null}

      {replyOpen ? (
        <div className={styles.replyComposer}>
          <UpdateComposer
            users={users}
            placeholder="Write a reply…"
            submitLabel="Reply"
            submitting={submitting}
            onCancel={() => setReplyOpen(false)}
            onSubmit={async (data) => {
              setSubmitting(true);
              const ok = await onReply(update.id, data);
              setSubmitting(false);
              if (ok) setReplyOpen(false);
              return ok;
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
