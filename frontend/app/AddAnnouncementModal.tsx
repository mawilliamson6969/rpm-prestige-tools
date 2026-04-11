"use client";

import { useCallback, useState, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { apiUrl } from "../lib/api";
import styles from "./add-announcement.module.css";

function formatTitleFromDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
};

export default function AddAnnouncementModal({ open, onClose, onSaved }: Props) {
  const { authHeaders } = useAuth();
  const [dateStr, setDateStr] = useState(() => new Date().toISOString().slice(0, 10));
  const [content, setContent] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setDateStr(new Date().toISOString().slice(0, 10));
    setContent("");
    setLinkUrl("");
    setLinkLabel("");
    setFile(null);
    setError(null);
  }, []);

  const handleClose = () => {
    if (!submitting) {
      reset();
      onClose();
    }
  };

  if (!open) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const text = content.trim();
    if (!text) {
      setError("Enter announcement text.");
      return;
    }

    setSubmitting(true);
    try {
      let attachment_url: string | null = null;
      let attachment_label: string | null = null;

      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        const up = await fetch(apiUrl("/announcements/upload"), {
          method: "POST",
          headers: { ...authHeaders() },
          body: fd,
        });
        const uj = await up.json().catch(() => ({}));
        if (!up.ok) {
          throw new Error(typeof uj.error === "string" ? uj.error : `Upload failed (${up.status})`);
        }
        attachment_url = typeof uj.url === "string" ? uj.url : null;
        attachment_label = file.name || (typeof uj.filename === "string" ? uj.filename : null);
      } else if (linkUrl.trim()) {
        attachment_url = linkUrl.trim();
        attachment_label = linkLabel.trim() || "Link";
      }

      const title = formatTitleFromDate(dateStr);
      const res = await fetch(apiUrl("/announcements"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({
          title,
          content: text,
          attachment_url,
          attachment_label,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : `Save failed (${res.status})`);
      }
      reset();
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="ann-modal-title" onClick={handleClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 id="ann-modal-title">Add announcement</h2>
          <button type="button" className={styles.closeBtn} onClick={handleClose} aria-label="Close">
            ×
          </button>
        </div>
        <form onSubmit={submit} className={styles.form}>
          <label className={styles.field}>
            <span>Date</span>
            <input
              type="date"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              required
            />
          </label>
          <label className={styles.field}>
            <span>Announcement</span>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
              placeholder="What should the team know?"
              required
            />
          </label>

          <fieldset className={styles.fieldset}>
            <legend>Attachment (optional)</legend>
            <p className={styles.hint}>Upload a file (max 8MB) or paste a link to a shared document.</p>
            <label className={styles.field}>
              <span>File</span>
              <input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                disabled={!!linkUrl.trim()}
              />
            </label>
            <p className={styles.or}>or</p>
            <label className={styles.field}>
              <span>Link URL</span>
              <input
                type="url"
                value={linkUrl}
                onChange={(e) => {
                  setLinkUrl(e.target.value);
                  if (e.target.value.trim()) setFile(null);
                }}
                placeholder="https://…"
                disabled={!!file}
              />
            </label>
            <label className={styles.field}>
              <span>Link label</span>
              <input
                type="text"
                value={linkLabel}
                onChange={(e) => setLinkLabel(e.target.value)}
                placeholder="e.g. Q1 policy PDF"
                disabled={!!file || !linkUrl.trim()}
              />
            </label>
          </fieldset>

          {error && (
            <div className={styles.error} role="alert">
              {error}
            </div>
          )}

          <div className={styles.actions}>
            <button type="button" className={styles.cancel} onClick={handleClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className={styles.submit} disabled={submitting}>
              {submitting ? "Saving…" : "Post announcement"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
