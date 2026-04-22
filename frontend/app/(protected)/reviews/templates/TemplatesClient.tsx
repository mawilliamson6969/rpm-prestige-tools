"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../../context/AuthContext";
import { apiUrl } from "../../../../lib/api";
import ReviewsNav from "../ReviewsNav";
import TemplateEditorModal from "./TemplateEditorModal";
import { type ReviewTemplate } from "../utils";
import styles from "../reviews.module.css";

export default function TemplatesClient() {
  const { authHeaders } = useAuth();
  const [templates, setTemplates] = useState<ReviewTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<ReviewTemplate | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(apiUrl("/reviews/templates"), { headers: { ...authHeaders() } });
    const body = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(body.templates)) setTemplates(body.templates);
    setLoading(false);
  }, [authHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  const onCreate = () => {
    setEditing(null);
    setEditOpen(true);
  };

  const onEdit = (t: ReviewTemplate) => {
    setEditing(t);
    setEditOpen(true);
  };

  const onDuplicate = async (t: ReviewTemplate) => {
    await fetch(apiUrl(`/reviews/templates/${t.id}/duplicate`), {
      method: "POST",
      headers: { ...authHeaders() },
    });
    load();
  };

  const onArchive = async (t: ReviewTemplate) => {
    if (!window.confirm(`Archive template "${t.name}"?`)) return;
    await fetch(apiUrl(`/reviews/templates/${t.id}`), {
      method: "DELETE",
      headers: { ...authHeaders() },
    });
    load();
  };

  return (
    <div className={styles.page}>
      <div className={styles.topRow}>
        <div>
          <h1 className={styles.title}>📋 Review Templates</h1>
          <p className={styles.sub}>
            Reusable messages for email and SMS review requests. Performance is tracked per template.
          </p>
        </div>
        <button type="button" className={styles.btnPrimary} onClick={onCreate}>
          + Create Template
        </button>
      </div>

      <ReviewsNav />

      {loading ? (
        <div className={styles.loading}>Loading…</div>
      ) : templates.length === 0 ? (
        <div className={styles.emptyState}>
          <h3>No templates yet</h3>
          <p>Create a template to start sending review requests.</p>
          <button type="button" className={styles.btnPrimary} onClick={onCreate}>
            Create your first template
          </button>
        </div>
      ) : (
        <div className={styles.grid2}>
          {templates.map((t) => (
            <article key={t.id} className={styles.templateCard}>
              <div className={styles.templateCardHead}>
                <div>
                  <h3 className={styles.templateName}>{t.name}</h3>
                  <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.25rem", flexWrap: "wrap" }}>
                    <span className={`${styles.channelBadge} ${channelClass(t.channel)}`}>
                      {t.channel}
                    </span>
                    <span className={styles.recipientBadge}>{t.recipient_type}</span>
                    {t.is_default ? (
                      <span className={styles.recipientBadge} style={{ background: "rgba(245,158,11,0.15)", color: "#92400e" }}>
                        ★ default
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
              {t.subject ? (
                <p className={styles.templatePreview} style={{ fontWeight: 600, color: "#1b2856" }}>
                  {t.subject}
                </p>
              ) : null}
              <p className={styles.templatePreview}>{t.body}</p>
              <div className={styles.templateStats}>
                <span>
                  <strong>{t.send_count}</strong> sent
                </span>
                <span>
                  <strong>{t.review_count}</strong> reviews
                </span>
                <span>
                  <strong>{t.conversion_rate ?? 0}%</strong> conversion
                </span>
              </div>
              <div className={styles.templateActions}>
                <button type="button" className={styles.btnSecondary} onClick={() => onEdit(t)}>
                  Edit
                </button>
                <button type="button" className={styles.btnSecondary} onClick={() => onDuplicate(t)}>
                  Duplicate
                </button>
                <button type="button" className={styles.btnDanger} onClick={() => onArchive(t)}>
                  Archive
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {editOpen ? (
        <TemplateEditorModal
          template={editing}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            load();
          }}
        />
      ) : null}
    </div>
  );
}

function channelClass(channel: string) {
  if (channel === "email") return styles.channelEmail;
  if (channel === "sms") return styles.channelSms;
  return styles.channelBoth;
}
