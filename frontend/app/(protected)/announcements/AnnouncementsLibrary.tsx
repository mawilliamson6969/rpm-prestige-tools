"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AddAnnouncementModal from "../../AddAnnouncementModal";
import { useAuth } from "../../../context/AuthContext";
import { apiUrl } from "../../../lib/api";
import styles from "./announcements.module.css";

type StatusTab = "all" | "active" | "archived";

type AnnouncementRow = {
  id: string;
  title: string;
  content: string;
  created_at: string;
  attachment_url?: string | null;
  attachment_label?: string | null;
  status?: string;
  archived_at?: string | null;
};

function attachmentHref(url: string) {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return apiUrl(url);
}

export default function AnnouncementsLibrary() {
  const { authHeaders, isAdmin } = useAuth();
  const headers = useMemo(() => authHeaders(), [authHeaders]);
  const [tab, setTab] = useState<StatusTab>("all");
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [items, setItems] = useState<AnnouncementRow[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState<number | null>(null);
  const [perPage] = useState(15);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AnnouncementRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const buildUrl = useCallback(
    (nextPage: number) => {
      const q = new URLSearchParams();
      if (tab === "all") q.set("status", "all");
      else if (tab === "archived") q.set("status", "archived");
      else {
        q.set("status", "active");
        q.set("allDates", "1");
      }
      q.set("sort", sort);
      if (searchDebounced) q.set("search", searchDebounced);
      q.set("page", String(nextPage));
      q.set("limit", String(perPage));
      return `${apiUrl("/announcements")}?${q.toString()}`;
    },
    [tab, sort, searchDebounced, perPage]
  );

  const loadPage = useCallback(
    async (nextPage: number, append: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(buildUrl(nextPage), {
          cache: "no-store",
          headers: { ...headers },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(typeof body.error === "string" ? body.error : `HTTP ${res.status}`);
        }
        const rows = Array.isArray(body.announcements) ? body.announcements : [];
        setTotal(typeof body.total === "number" ? body.total : null);
        setPage(nextPage);
        setItems((prev) => (append ? [...prev, ...rows] : rows));
      } catch (e) {
        if (!append) setItems([]);
        setError(e instanceof Error ? e.message : "Could not load.");
      } finally {
        setLoading(false);
      }
    },
    [buildUrl, headers]
  );

  useEffect(() => {
    setPage(1);
    void loadPage(1, false);
  }, [tab, sort, searchDebounced, loadPage]);

  const hasMore = total != null && items.length < total;

  const refresh = () => loadPage(1, false);

  async function archiveRow(id: string) {
    const res = await fetch(apiUrl(`/announcements/${id}/archive`), {
      method: "PUT",
      headers: { ...headers },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(typeof body.error === "string" ? body.error : "Archive failed");
      return;
    }
    refresh();
  }

  async function restoreRow(id: string) {
    const res = await fetch(apiUrl(`/announcements/${id}/restore`), {
      method: "PUT",
      headers: { ...headers },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(typeof body.error === "string" ? body.error : "Restore failed");
      return;
    }
    refresh();
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(apiUrl(`/announcements/${deleteTarget.id}`), {
        method: "DELETE",
        headers: { ...headers },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(typeof body.error === "string" ? body.error : "Delete failed");
        return;
      }
      setDeleteTarget(null);
      refresh();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>Team Announcements</h1>
          </div>
        </header>

        <div className={styles.toolbar}>
          {isAdmin ? (
            <button type="button" className={styles.newBtn} onClick={() => setAddOpen(true)}>
              + New Announcement
            </button>
          ) : null}
          <div className={styles.tabs} role="tablist" aria-label="Announcement status">
            {(
              [
                ["all", "All"],
                ["active", "Active"],
                ["archived", "Archived"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={`${styles.tab} ${tab === id ? styles.tabActive : ""}`}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            type="search"
            className={styles.search}
            placeholder="Search announcements…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search announcements"
          />
          <label className={styles.hint} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            Sort
            <select className={styles.sort} value={sort} onChange={(e) => setSort(e.target.value as "newest" | "oldest")}>
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
            </select>
          </label>
        </div>

        {error ? (
          <p className={styles.hint} style={{ color: "#b32317" }}>
            {error}
          </p>
        ) : null}
        {loading && !items.length ? <p className={styles.hint}>Loading…</p> : null}

        {items.map((a) => (
          <article key={a.id} className={styles.card}>
            <div className={styles.cardMeta}>
              <time dateTime={a.created_at}>{new Date(a.created_at).toLocaleString()}</time>
              <span
                className={`${styles.badge} ${a.status === "archived" ? styles.badgeArchived : styles.badgeActive}`}
              >
                {a.status === "archived" ? "Archived" : "Active"}
              </span>
            </div>
            <div className={styles.content}>
              <strong>{a.title}</strong> — {a.content}
            </div>
            {a.attachment_url ? (
              <div className={styles.attach}>
                <a href={attachmentHref(a.attachment_url)} target="_blank" rel="noopener noreferrer">
                  {a.attachment_label?.trim() || "View attachment"}
                </a>
              </div>
            ) : null}
            {isAdmin ? (
              <div className={styles.actions}>
                {a.status !== "archived" ? (
                  <button type="button" className={styles.btnSm} onClick={() => archiveRow(a.id)}>
                    Archive
                  </button>
                ) : (
                  <button type="button" className={styles.btnSm} onClick={() => restoreRow(a.id)}>
                    Restore
                  </button>
                )}
                <button type="button" className={`${styles.btnSm} ${styles.btnDanger}`} onClick={() => setDeleteTarget(a)}>
                  Delete
                </button>
              </div>
            ) : null}
          </article>
        ))}

        {!loading && !items.length && !error ? <p className={styles.hint}>No announcements match this view.</p> : null}

        {hasMore ? (
          <button
            type="button"
            className={styles.loadMore}
            disabled={loading}
            onClick={() => void loadPage(page + 1, true)}
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        ) : null}
      </div>

      <AddAnnouncementModal open={addOpen} onClose={() => setAddOpen(false)} onSaved={() => refresh()} />

      {deleteTarget ? (
        <div
          className={styles.overlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="del-ann-title"
          onClick={() => !deleting && setDeleteTarget(null)}
        >
          <div className={styles.confirmModal} onClick={(e) => e.stopPropagation()}>
            <h2 id="del-ann-title">Permanently delete this announcement?</h2>
            <p className={styles.hint} style={{ margin: 0 }}>
              This cannot be undone.
            </p>
            <div className={styles.confirmActions}>
              <button type="button" className={styles.btnSm} onClick={() => setDeleteTarget(null)} disabled={deleting}>
                Cancel
              </button>
              <button type="button" className={styles.btnPrimary} onClick={() => void confirmDelete()} disabled={deleting}>
                {deleting ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
