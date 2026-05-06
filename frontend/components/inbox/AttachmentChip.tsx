"use client";

import type { ThreadAttachment } from "../../hooks/inbox/types";
import { useAuth } from "../../context/AuthContext";
import { apiUrlWithAuthQuery } from "../../lib/api";

const CHIP: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.4rem",
  border: "1px solid #cfd4dc",
  borderRadius: 8,
  padding: "0.3rem 0.6rem",
  background: "#fff",
  fontSize: "0.82rem",
  color: "#1b2856",
  textDecoration: "none",
  marginRight: "0.4rem",
  marginTop: "0.35rem",
  maxWidth: "260px",
};

const CHIP_PENDING: React.CSSProperties = {
  ...CHIP,
  background: "#f5f5f5",
  color: "#6a737b",
  cursor: "default",
};

const PREVIEWABLE_MIME = /^image\/|application\/pdf$/i;

function formatSize(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AttachmentChip({ att }: { att: ThreadAttachment }) {
  const { token } = useAuth();
  const sizeLabel = formatSize(att.size_bytes);
  const previewable =
    !!att.content_type && PREVIEWABLE_MIME.test(att.content_type);

  if (!att.fetched) {
    return (
      <span style={CHIP_PENDING} title="Fetching from Microsoft Graph…">
        <span aria-hidden>⏳</span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {att.filename}
        </span>
        {sizeLabel ? <span style={{ color: "#6a737b" }}>{sizeLabel}</span> : null}
      </span>
    );
  }

  const downloadHref = apiUrlWithAuthQuery(`/inbox/attachments/${att.id}/download`, token);
  const previewHref = apiUrlWithAuthQuery(`/inbox/attachments/${att.id}/preview`, token);

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: "0.15rem", marginRight: "0.4rem", marginTop: "0.35rem" }}>
      <span style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
        <a
          href={downloadHref}
          download={att.filename}
          style={CHIP}
          title={`Download ${att.filename}`}
        >
          <span aria-hidden>📎</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {att.filename}
          </span>
          {sizeLabel ? <span style={{ color: "#6a737b" }}>{sizeLabel}</span> : null}
        </a>
        {previewable ? (
          <a
            href={previewHref}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: "0.78rem",
              color: "var(--blue, #0098D0)",
              textDecoration: "none",
            }}
            title="Preview in a new tab"
          >
            preview
          </a>
        ) : null}
      </span>
    </span>
  );
}
