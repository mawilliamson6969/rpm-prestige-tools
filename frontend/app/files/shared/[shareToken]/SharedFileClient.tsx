"use client";

import { useCallback, useEffect, useState } from "react";
import { apiUrl } from "../../../../lib/api";

type Props = { shareToken: string };

type FileMeta = {
  id: number;
  originalFilename: string;
  mimeType: string;
  fileType: string;
  fileSizeBytes: number;
  description: string | null;
  aiSummary: string | null;
  createdAt: string;
};

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SharedFileClient({ shareToken }: Props) {
  const [file, setFile] = useState<FileMeta | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await fetch(apiUrl(`/files/shared/${encodeURIComponent(shareToken)}`), { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(typeof body.error === "string" ? body.error : "Could not load file.");
        setFile(null);
        return;
      }
      setFile(body.file ?? null);
    } catch {
      setErr("Could not load file.");
      setFile(null);
    }
  }, [shareToken]);

  useEffect(() => {
    void load();
  }, [load]);

  if (err) {
    return (
      <div style={{ padding: "2rem", fontFamily: "system-ui", maxWidth: 560, margin: "0 auto" }}>
        <h1 style={{ color: "#1b2856" }}>Shared file</h1>
        <p style={{ color: "#b32317" }}>{err}</p>
      </div>
    );
  }

  if (!file) {
    return (
      <div style={{ padding: "2rem", fontFamily: "system-ui" }}>
        <p style={{ color: "#6a737b" }}>Loading…</p>
      </div>
    );
  }

  const dl = apiUrl(`/files/shared/${encodeURIComponent(shareToken)}/download`);

  return (
    <div
      style={{
        padding: "2rem",
        fontFamily: "system-ui, sans-serif",
        maxWidth: 640,
        margin: "0 auto",
        color: "#1b2856",
      }}
    >
      <h1 style={{ fontSize: "1.35rem", marginBottom: "0.5rem" }}>Shared document</h1>
      <p style={{ fontWeight: 600, marginBottom: "0.25rem" }}>{file.originalFilename}</p>
      <p style={{ color: "#6a737b", fontSize: "0.9rem", marginBottom: "1rem" }}>
        {file.fileType.toUpperCase()} · {fmtBytes(file.fileSizeBytes)}
      </p>
      {file.description ? <p style={{ marginBottom: "1rem" }}>{file.description}</p> : null}
      {file.aiSummary ? (
        <div style={{ marginBottom: "1.25rem" }}>
          <h2 style={{ fontSize: "1rem" }}>Summary</h2>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              fontSize: "0.85rem",
              background: "#f5f5f5",
              padding: "0.75rem",
              borderRadius: 8,
            }}
          >
            {file.aiSummary}
          </pre>
        </div>
      ) : null}
      <a
        href={dl}
        style={{
          display: "inline-block",
          background: "#0098d0",
          color: "#fff",
          padding: "0.65rem 1.25rem",
          borderRadius: 8,
          textDecoration: "none",
          fontWeight: 600,
        }}
      >
        Download
      </a>
    </div>
  );
}
