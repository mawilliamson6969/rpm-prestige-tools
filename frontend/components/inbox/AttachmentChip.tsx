"use client";

// Message-body attachment chip — Phase 5, design-aligned.
//
// Source: design/.../styles.css .cv-attach-card / .cv-attach-thumb /
// .cv-attach-name / .cv-attach-size, ported into the conversation CSS
// module by D0. The "fetching from Graph" pending state is the
// engine-level reality the spec accepts (lazy-fetch first paint, bytes
// land on a refetch a few seconds later).

import type { ThreadAttachment } from "../../hooks/inbox/types";
import { useAuth } from "../../context/AuthContext";
import { apiUrlWithAuthQuery } from "../../lib/api";
import styles from "./conversation/conversation.module.css";

const PREVIEWABLE_MIME = /^image\/|application\/pdf$/i;

function formatSize(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileGlyph(contentType: string | null | undefined, filename: string): string {
  if (contentType?.startsWith("image/")) return "🖼";
  if (contentType === "application/pdf") return "📄";
  if (contentType?.startsWith("audio/")) return "🎵";
  if (contentType?.startsWith("video/")) return "🎞";
  if (/\.zip$|\.tar$|\.gz$/i.test(filename)) return "🗂";
  if (/\.docx?$/i.test(filename)) return "📄";
  if (/\.xlsx?$/i.test(filename)) return "📊";
  return "📎";
}

export default function AttachmentChip({ att }: { att: ThreadAttachment }) {
  const { token } = useAuth();
  const sizeLabel = formatSize(att.size_bytes);
  const previewable = !!att.content_type && PREVIEWABLE_MIME.test(att.content_type);

  if (!att.fetched) {
    return (
      <div
        className={styles.cvAttachCard}
        title="Fetching from Microsoft Graph…"
        style={{ opacity: 0.7, cursor: "default" }}
      >
        <span className={styles.cvAttachThumb} aria-hidden>
          ⏳
        </span>
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <span
            className={styles.cvAttachName}
            style={{
              maxWidth: 220,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {att.filename}
          </span>
          <span className={styles.cvAttachSize}>
            {sizeLabel ? `${sizeLabel} · ` : ""}fetching…
          </span>
        </div>
      </div>
    );
  }

  const downloadHref = apiUrlWithAuthQuery(`/inbox/attachments/${att.id}/download`, token);
  const previewHref = apiUrlWithAuthQuery(`/inbox/attachments/${att.id}/preview`, token);

  return (
    <div className={styles.cvAttachCard}>
      <span className={styles.cvAttachThumb} aria-hidden>
        {fileGlyph(att.content_type, att.filename)}
      </span>
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <span
          className={styles.cvAttachName}
          style={{
            maxWidth: 220,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={att.filename}
        >
          {att.filename}
        </span>
        <span className={styles.cvAttachSize}>{sizeLabel || "—"}</span>
      </div>
      <span className={styles.cvAttachActions}>
        <a
          href={downloadHref}
          download={att.filename}
          className={styles.cvAttachActionBtn}
          title={`Download ${att.filename}`}
          aria-label={`Download ${att.filename}`}
        >
          ↓
        </a>
        {previewable ? (
          <a
            href={previewHref}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.cvAttachActionBtn}
            title="Preview in a new tab"
            aria-label="Preview"
          >
            ↗
          </a>
        ) : null}
      </span>
    </div>
  );
}
