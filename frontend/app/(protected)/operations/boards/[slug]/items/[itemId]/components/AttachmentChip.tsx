"use client";

import styles from "./detail.module.css";
import { apiUrl } from "@/lib/api";
import { apiUrlWithAuthQuery } from "@/lib/api";
import type { AttachmentRef } from "@/types/mb";
import { useAuth } from "@/context/AuthContext";

function isImage(mime: string) {
  return /^image\//.test(mime);
}

function iconFor(mime: string) {
  if (mime === "application/pdf") return "📄";
  if (mime.includes("word")) return "📝";
  if (mime.includes("excel") || mime.includes("spreadsheet")) return "📊";
  if (mime.includes("powerpoint") || mime.includes("presentation")) return "📑";
  if (mime.startsWith("text/")) return "📃";
  return "📎";
}

export default function AttachmentChip({
  attachment,
}: {
  attachment: AttachmentRef;
}) {
  const { token } = useAuth();
  // Image previews need a URL that authenticates inline (browsers can't
  // attach a header to an <img src>). We piggy-back on the existing
  // `?token=` query-param fallback used by video streams.
  const href = apiUrlWithAuthQuery(
    `/mb/attachments/${attachment.id}/download`,
    token
  );
  const apiHref = apiUrl(`/mb/attachments/${attachment.id}/download`);

  if (isImage(attachment.mime_type)) {
    return (
      <a href={apiHref} target="_blank" rel="noopener noreferrer" title={attachment.filename}>
        <img
          src={href}
          alt={attachment.filename}
          className={styles.imgAttach}
          loading="lazy"
        />
      </a>
    );
  }
  return (
    <a
      href={apiHref}
      target="_blank"
      rel="noopener noreferrer"
      className={styles.filePill}
      title={attachment.filename}
    >
      <span className={styles.fileIcon}>{iconFor(attachment.mime_type)}</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>
        {attachment.filename}
      </span>
    </a>
  );
}
