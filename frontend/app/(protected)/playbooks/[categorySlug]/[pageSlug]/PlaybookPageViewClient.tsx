"use client";

import Link from "next/link";
import type { ChangeEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import MarkdownBody, { useWikiHeadings } from "../../../../../components/wiki/MarkdownBody";
import WikiToc from "../../../../../components/wiki/WikiToc";
import WikiVersionPanel from "../../../../../components/wiki/WikiVersionPanel";
import { useAuth } from "../../../../../context/AuthContext";
import { apiUrl } from "../../../../../lib/api";
import shell from "../../playbook-shell.module.css";
import art from "../../playbook-article.module.css";

type PageDetail = {
  id: number;
  title: string;
  slug: string;
  content_markdown: string;
  status: string;
  is_pinned: boolean;
  category_slug: string;
  category_name: string;
  created_by_name: string | null;
  last_edited_by_name: string | null;
  created_at: string;
  updated_at: string;
  current_version: number | null;
  created_by: number | null;
};

type Att = {
  id: number;
  filename: string;
  file_size_bytes: number | null;
  created_at: string;
  uploaded_by: number | null;
};

export default function PlaybookPageViewClient({
  categorySlug,
  pageSlug,
}: {
  categorySlug: string;
  pageSlug: string;
}) {
  const router = useRouter();
  const { authHeaders, isAdmin, user } = useAuth();
  const [page, setPage] = useState<PageDetail | null>(null);
  const [attachments, setAttachments] = useState<Att[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const lRes = await fetch(
        apiUrl(
          `/playbooks/pages?categorySlug=${encodeURIComponent(categorySlug)}&pageSlug=${encodeURIComponent(pageSlug)}`
        ),
        { headers: { ...authHeaders() }, cache: "no-store" }
      );
      const lBody = await lRes.json().catch(() => ({}));
      if (!lRes.ok) throw new Error(typeof lBody.error === "string" ? lBody.error : "Load failed.");
      const rows = Array.isArray(lBody.pages) ? lBody.pages : [];
      const row = rows[0];
      if (!row) {
        setPage(null);
        setAttachments([]);
        setErr("Playbook not found.");
        return;
      }
      const dRes = await fetch(apiUrl(`/playbooks/pages/${row.id}`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      const dBody = await dRes.json().catch(() => ({}));
      if (!dRes.ok) throw new Error(typeof dBody.error === "string" ? dBody.error : "Load failed.");
      setPage(dBody.page);
      setAttachments(Array.isArray(dBody.attachments) ? dBody.attachments : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    }
  }, [authHeaders, categorySlug, pageSlug]);

  useEffect(() => {
    load();
  }, [load]);

  const md = page?.content_markdown ?? "";
  const headings = useWikiHeadings(md);

  const canDelete = page && (isAdmin || page.created_by === user?.id);
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

  const downloadAtt = async (id: number, filename: string) => {
    const res = await fetch(apiUrl(`/playbooks/attachments/${id}`), { headers: { ...authHeaders() } });
    if (!res.ok) return;
    const blob = await res.blob();
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(u);
  };

  const onPin = async () => {
    if (!page) return;
    setBusy(true);
    try {
      const res = await fetch(apiUrl(`/playbooks/pages/${page.id}/pin`), {
        method: "PUT",
        headers: { ...authHeaders() },
      });
      if (res.ok) await load();
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!page) return;
    setBusy(true);
    try {
      const res = await fetch(apiUrl(`/playbooks/pages/${page.id}`), {
        method: "DELETE",
        headers: { ...authHeaders() },
      });
      if (res.ok) router.replace(`/playbooks/${categorySlug}`);
    } finally {
      setBusy(false);
      setDeleteOpen(false);
    }
  };

  const onUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !page) return;
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(apiUrl(`/playbooks/pages/${page.id}/attachments`), {
      method: "POST",
      headers: { ...authHeaders() },
      body: fd,
    });
    e.target.value = "";
    if (res.ok) await load();
  };

  const onDeleteAtt = async (id: number) => {
    if (!page) return;
    const res = await fetch(apiUrl(`/playbooks/attachments/${id}`), {
      method: "DELETE",
      headers: { ...authHeaders() },
    });
    if (res.ok) await load();
  };

  if (err && !page) {
    return (
      <>
        <div className={shell.breadcrumb}>
          <Link href="/">Team Hub</Link>
          <span>/</span>
          <Link href="/playbooks">Playbooks</Link>
        </div>
        <p style={{ color: "#b32317" }}>{err}</p>
      </>
    );
  }
  if (!page) {
    return <p style={{ color: "#6a737b" }}>Loading…</p>;
  }

  return (
    <>
      <div className={shell.breadcrumb}>
        <Link href="/">Team Hub</Link>
        <span>/</span>
        <Link href="/playbooks">Playbooks</Link>
        <span>/</span>
        <Link href={`/playbooks/${categorySlug}`}>{page.category_name}</Link>
        <span>/</span>
        <span>{page.title}</span>
      </div>

      <div className={shell.readLayout}>
        {headings.length > 0 ? <WikiToc headings={headings} /> : null}
        <article className={shell.articleCol}>
          <div className={art.actions}>
            <Link href={`/playbooks/${categorySlug}/${pageSlug}/edit`} className={shell.btnPrimary}>
              Edit
            </Link>
            <button type="button" className={shell.btnSecondary} onClick={() => setHistoryOpen(true)}>
              History
            </button>
            {isAdmin ? (
              <button type="button" className={shell.btnSecondary} onClick={onPin} disabled={busy}>
                {page.is_pinned ? "Unpin" : "Pin"}
              </button>
            ) : null}
            {canDelete ? (
              <button type="button" className={shell.btnDanger} onClick={() => setDeleteOpen(true)}>
                Delete
              </button>
            ) : null}
          </div>

          <h1 className={shell.pageTitle}>{page.title}</h1>
          <div className={art.metaBar}>
            <span>Created by {page.created_by_name ?? "—"}</span>
            <span>
              Last edited by {page.last_edited_by_name ?? "—"} on {fmt(page.updated_at)}
            </span>
            <span>Version {page.current_version ?? 1}</span>
            <span className={`${shell.badge} ${page.status === "draft" ? shell.badgeDraft : shell.badgePublished}`}>
              {page.status}
            </span>
          </div>

          <MarkdownBody markdown={md} />

          <section className={art.attachSection}>
            <h2 className={art.attachTitle}>Attachments</h2>
            <label className={shell.btnSecondary} style={{ display: "inline-block", marginBottom: "1rem" }}>
              Upload Attachment
              <input type="file" hidden onChange={onUpload} />
            </label>
            <ul className={art.attachList}>
              {attachments.length === 0 ? (
                <li style={{ border: "none", color: "#6a737b" }}>No attachments yet.</li>
              ) : (
                attachments.map((a) => (
                  <li key={a.id}>
                    <span className={art.attachName}>{a.filename}</span>
                    <span className={art.attachMeta}>
                      {a.file_size_bytes != null ? `${Math.round(a.file_size_bytes / 1024)} KB · ` : ""}
                      {fmt(a.created_at)}
                    </span>
                    <button type="button" className={art.linkBtn} onClick={() => downloadAtt(a.id, a.filename)}>
                      Download
                    </button>
                    {isAdmin || a.uploaded_by === user?.id ? (
                      <button type="button" className={art.linkBtn} onClick={() => onDeleteAtt(a.id)}>
                        Remove
                      </button>
                    ) : null}
                  </li>
                ))
              )}
            </ul>
          </section>
        </article>
      </div>

      <WikiVersionPanel
        open={historyOpen}
        pageId={page.id}
        onClose={() => setHistoryOpen(false)}
        onRestored={load}
        basePath="playbooks"
      />

      {deleteOpen ? (
        <div className={art.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="del-title">
          <div className={art.modal}>
            <h3 id="del-title">Delete this playbook?</h3>
            <p>This permanently removes "{page.title}", its version history, and attachments.</p>
            <div className={art.modalActions}>
              <button type="button" className={shell.btnSecondary} onClick={() => setDeleteOpen(false)}>
                Cancel
              </button>
              <button type="button" className={shell.btnDanger} onClick={onDelete} disabled={busy}>
                {busy ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
