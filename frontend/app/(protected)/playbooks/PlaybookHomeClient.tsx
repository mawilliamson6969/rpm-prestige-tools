"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../context/AuthContext";
import { apiUrl } from "../../../lib/api";
import styles from "./playbook-shell.module.css";

type Category = {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  icon: string;
  page_count: number;
};

type RecentPage = {
  id: number;
  title: string;
  slug: string;
  updated_at: string;
  category_name: string;
  category_slug: string;
  last_edited_by_name: string | null;
};

type SearchHit = {
  id: number;
  title: string;
  slug: string;
  categoryName: string;
  categorySlug: string;
  snippet: string;
  updatedAt: string;
};

function escapeRe(s: string) {
  return s.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function SnippetWithHighlight({ text, q }: { text: string; q: string }) {
  const parts = useMemo(() => {
    const t = q.trim();
    if (!t) return [{ k: "a", v: text }];
    const re = new RegExp(`(${escapeRe(t)})`, "gi");
    const out: { k: string; v: string; h?: boolean }[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    const r = new RegExp(re.source, re.flags);
    while ((m = r.exec(text)) != null) {
      if (m.index > last) out.push({ k: `p-${last}`, v: text.slice(last, m.index) });
      out.push({ k: `h-${m.index}`, v: m[1], h: true });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ k: `p-${last}`, v: text.slice(last) });
    return out.length ? out : [{ k: "a", v: text }];
  }, [text, q]);

  return (
    <span className={styles.recentMeta}>
      {parts.map((p) =>
        p.h ? (
          <mark key={p.k} className={styles.mark}>
            {p.v}
          </mark>
        ) : (
          <span key={p.k}>{p.v}</span>
        )
      )}
    </span>
  );
}

export default function PlaybookHomeClient() {
  const { authHeaders, isAdmin, token } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [recent, setRecent] = useState<RecentPage[]>([]);
  const [totalPages, setTotalPages] = useState(0);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoadErr(null);
    try {
      const res = await fetch(apiUrl("/playbooks/categories"), {
        cache: "no-store",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Load failed.");
      setCategories(Array.isArray(body.categories) ? body.categories : []);
      setRecent(Array.isArray(body.recentPages) ? body.recentPages : []);
      setTotalPages(typeof body.totalPages === "number" ? body.totalPages : 0);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "Could not load playbooks.");
    }
  }, [authHeaders, token]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!token || debouncedQ.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    (async () => {
      try {
        const res = await fetch(apiUrl(`/playbooks/search?q=${encodeURIComponent(debouncedQ)}`), {
          headers: { ...authHeaders() },
        });
        const body = await res.json().catch(() => ({}));
        if (!cancelled) {
          setHits(res.ok && Array.isArray(body.results) ? body.results : []);
        }
      } catch {
        if (!cancelled) setHits([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedQ, authHeaders, token]);

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

  return (
    <>
      <div className={styles.breadcrumb}>
        <Link href="/">Team Hub</Link>
        <span>/</span>
        <span>Playbooks</span>
      </div>

      <header style={{ textAlign: "center", marginBottom: "0.5rem" }}>
        <h1 className={styles.pageTitle} style={{ marginBottom: "1.25rem" }}>
          Playbooks &amp; SOPs
        </h1>
        <div className={styles.searchWrap}>
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Search playbooks and SOPs…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 200)}
            aria-label="Search playbooks"
          />
          {searchOpen && debouncedQ.length >= 2 ? (
            <div
              className={styles.searchDropdown}
              onMouseDown={(e) => e.preventDefault()}
              role="listbox"
              aria-label="Search results"
            >
              {searching ? (
                <div className={styles.searchItem}>Searching…</div>
              ) : hits.length === 0 ? (
                <div className={styles.searchItem}>No results.</div>
              ) : (
                hits.map((h) => (
                  <Link
                    key={h.id}
                    href={`/playbooks/${h.categorySlug}/${h.slug}`}
                    className={styles.searchItem}
                    style={{ display: "block" }}
                  >
                    <div style={{ fontWeight: 700, color: "#1b2856", marginBottom: "0.25rem" }}>{h.title}</div>
                    <span className={`${styles.badge} ${styles.badgePublished}`}>{h.categoryName}</span>
                    <div style={{ marginTop: "0.35rem" }}>
                      <SnippetWithHighlight text={h.snippet} q={debouncedQ} />
                    </div>
                  </Link>
                ))
              )}
            </div>
          ) : null}
        </div>
      </header>

      <div className={styles.toolbar} style={{ justifyContent: "center" }}>
        <Link href="/playbooks/new" className={styles.btnPrimary}>
          New Playbook
        </Link>
        {isAdmin ? (
          <Link href="/playbooks/manage" className={styles.btnSecondary}>
            Manage Categories
          </Link>
        ) : null}
      </div>

      {loadErr ? <p style={{ color: "#b32317" }}>{loadErr}</p> : null}

      <h2 className={styles.sectionTitle}>Recently Updated</h2>
      <ul className={styles.recentList}>
        {recent.length === 0 ? (
          <li>
            <span style={{ display: "block", padding: "0.85rem 1rem", color: "#6a737b" }}>No playbooks yet.</span>
          </li>
        ) : (
          recent.map((p) => (
            <li key={p.id}>
              <Link href={`/playbooks/${p.category_slug}/${p.slug}`}>
                <span className={styles.recentTitle}>{p.title}</span>
                <span className={styles.recentMeta}>
                  {p.category_name} · {p.last_edited_by_name ?? "—"} · {fmtDate(p.updated_at)}
                </span>
              </Link>
            </li>
          ))
        )}
      </ul>

      <h2 className={styles.sectionTitle}>Categories ({totalPages} playbooks)</h2>
      <div className={styles.cardGrid}>
        {categories.map((c) => (
          <Link key={c.id} href={`/playbooks/${c.slug}`} className={styles.deptCard}>
            <div className={styles.deptIcon} aria-hidden>
              {c.icon || "📋"}
            </div>
            <h3 className={styles.deptName}>{c.name}</h3>
            {c.description ? <p className={styles.deptDesc}>{c.description}</p> : null}
            <div className={styles.deptMeta}>{c.page_count} playbooks</div>
          </Link>
        ))}
      </div>
    </>
  );
}
