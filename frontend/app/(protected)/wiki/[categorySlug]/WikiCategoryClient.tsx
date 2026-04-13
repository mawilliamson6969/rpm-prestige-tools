"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../../context/AuthContext";
import { apiUrl } from "../../../../lib/api";
import shell from "../wiki-shell.module.css";

type PageRow = {
  id: number;
  title: string;
  slug: string;
  status: string;
  is_pinned: boolean;
  display_order: number;
  updated_at: string;
  last_edited_by_name: string | null;
};

type Category = {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  icon: string;
};

export default function WikiCategoryClient({
  categorySlug,
}: {
  categorySlug: string;
}) {
  const { authHeaders, token } = useAuth();
  const [category, setCategory] = useState<Category | null>(null);
  const [pages, setPages] = useState<PageRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [sortBy, setSortBy] = useState<"title" | "updated" | "order">("order");

  const load = useCallback(async () => {
    if (!token) return;
    setErr(null);
    try {
      const [cRes, pRes] = await Promise.all([
        fetch(apiUrl("/wiki/categories"), { headers: { ...authHeaders() }, cache: "no-store" }),
        fetch(apiUrl(`/wiki/pages?categorySlug=${encodeURIComponent(categorySlug)}`), {
          headers: { ...authHeaders() },
          cache: "no-store",
        }),
      ]);
      const cBody = await cRes.json().catch(() => ({}));
      const pBody = await pRes.json().catch(() => ({}));
      if (!cRes.ok) throw new Error(typeof cBody.error === "string" ? cBody.error : "Load failed.");
      if (!pRes.ok) throw new Error(typeof pBody.error === "string" ? pBody.error : "Load failed.");
      const cats: Category[] = Array.isArray(cBody.categories) ? cBody.categories : [];
      const cat = cats.find((c) => c.slug === categorySlug) ?? null;
      setCategory(cat);
      setPages(Array.isArray(pBody.pages) ? pBody.pages : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load department.");
    }
  }, [authHeaders, token, categorySlug]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const filtered = useMemo(() => {
    let list = pages;
    if (debouncedQ) {
      const d = debouncedQ.toLowerCase();
      list = list.filter((p) => p.title.toLowerCase().includes(d));
    }
    const out = [...list];
    if (sortBy === "title") out.sort((a, b) => a.title.localeCompare(b.title));
    else if (sortBy === "updated") out.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    else out.sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0) || a.title.localeCompare(b.title));
    return out;
  }, [pages, debouncedQ, sortBy]);

  const pinned = filtered.filter((p) => p.is_pinned);
  const rest = filtered.filter((p) => !p.is_pinned);

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });

  if (err) {
    return <p style={{ color: "#b32317" }}>{err}</p>;
  }
  if (!category && !err) {
    return <p style={{ color: "#6a737b" }}>Loading…</p>;
  }
  if (!category) {
    return <p>Department not found.</p>;
  }

  return (
    <>
      <div className={shell.breadcrumb}>
        <Link href="/">Team Hub</Link>
        <span>/</span>
        <Link href="/wiki">Wiki</Link>
        <span>/</span>
        <span>{category.name}</span>
      </div>

      <div className={shell.toolbar}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className={shell.pageTitle} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span aria-hidden>{category.icon}</span>
            {category.name}
          </h1>
          {category.description ? (
            <p style={{ margin: 0, color: "#6a737b", maxWidth: "720px", lineHeight: 1.5 }}>{category.description}</p>
          ) : null}
        </div>
        <Link href={`/wiki/new?category=${encodeURIComponent(category.slug)}`} className={shell.btnPrimary}>
          New Page in {category.name}
        </Link>
      </div>

      <div className={shell.toolbar} style={{ marginBottom: "1rem" }}>
        <input
          type="search"
          placeholder="Search in this department…"
          className={shell.searchInput}
          style={{ maxWidth: "320px", margin: 0 }}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search pages in category"
        />
        <label style={{ fontSize: "0.88rem", color: "#6a737b", display: "flex", alignItems: "center", gap: "0.35rem" }}>
          Sort
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className={shell.searchInput}
            style={{ padding: "0.45rem 0.65rem", maxWidth: "200px" }}
          >
            <option value="order">Display order</option>
            <option value="title">Title</option>
            <option value="updated">Recently updated</option>
          </select>
        </label>
      </div>

      {pinned.length > 0 ? (
        <>
          <h2 className={shell.sectionTitle}>Pinned</h2>
          <ul className={shell.recentList} style={{ marginBottom: "1.5rem" }}>
            {pinned.map((p) => (
              <li key={p.id}>
                <Link href={`/wiki/${category.slug}/${p.slug}`}>
                  <span className={shell.recentTitle}>{p.title}</span>
                  <span className={shell.recentMeta}>
                    <span className={`${shell.badge} ${p.status === "draft" ? shell.badgeDraft : shell.badgePublished}`}>
                      {p.status}
                    </span>
                    {" · "}
                    {p.last_edited_by_name ?? "—"} · {fmt(p.updated_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h2 className={shell.sectionTitle}>All pages</h2>
      <ul className={shell.recentList}>
        {rest.length === 0 ? (
          <li>
            <span style={{ display: "block", padding: "0.85rem 1rem", color: "#6a737b" }}>No pages in this view.</span>
          </li>
        ) : (
          rest.map((p) => (
            <li key={p.id}>
              <Link href={`/wiki/${category.slug}/${p.slug}`}>
                <span className={shell.recentTitle}>{p.title}</span>
                <span className={shell.recentMeta}>
                  <span className={`${shell.badge} ${p.status === "draft" ? shell.badgeDraft : shell.badgePublished}`}>
                    {p.status}
                  </span>
                  {" · "}
                  {p.last_edited_by_name ?? "—"} · {fmt(p.updated_at)}
                </span>
              </Link>
            </li>
          ))
        )}
      </ul>
    </>
  );
}
