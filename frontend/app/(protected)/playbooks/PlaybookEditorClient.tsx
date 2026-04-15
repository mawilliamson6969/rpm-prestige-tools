"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MarkdownBody from "../../../components/wiki/MarkdownBody";
import { useAuth } from "../../../context/AuthContext";
import { apiUrl } from "../../../lib/api";
import shell from "./playbook-shell.module.css";
import ed from "./playbook-editor.module.css";
import art from "./playbook-article.module.css";

type Category = { id: number; name: string; slug: string };

function insertAround(ta: HTMLTextAreaElement, before: string, after = "") {
  const s = ta.selectionStart;
  const e = ta.selectionEnd;
  const sel = ta.value.slice(s, e);
  const next = ta.value.slice(0, s) + before + sel + after + ta.value.slice(e);
  ta.value = next;
  const pos = s + before.length + sel.length + after.length;
  ta.setSelectionRange(pos, pos);
  ta.focus();
}

function draftKey(parts: string[]) {
  return `playbook_draft_${parts.join("_")}`;
}

export default function PlaybookEditorClient({
  mode,
  categorySlug,
  pageSlug,
}: {
  mode: "new" | "edit";
  categorySlug?: string;
  pageSlug?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qpCategory = searchParams.get("category")?.trim() || "";
  const { authHeaders } = useAuth();

  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<number>(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<"published" | "draft">("published");
  const [changeSummary, setChangeSummary] = useState("");
  const [pageId, setPageId] = useState<number | null>(null);
  const [slug, setSlug] = useState("");
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [mobileTab, setMobileTab] = useState<"edit" | "preview">("edit");
  const [previewDebounced, setPreviewDebounced] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const initialRef = useRef({
    title: "",
    body: "",
    status: "published" as "published" | "draft",
    categoryId: 0,
  });

  const effectiveCatSlug = mode === "edit" ? categorySlug ?? "" : qpCategory || "";

  const storageKey = useMemo(
    () =>
      draftKey([
        mode,
        String(pageId ?? "new"),
        String(categoryId || "0"),
        slug || "slug",
      ]),
    [mode, pageId, categoryId, slug]
  );

  const loadCategories = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/playbooks/categories"), { headers: { ...authHeaders() } });
      const j = await res.json().catch(() => ({}));
      const cats: Category[] = Array.isArray(j.categories) ? j.categories : [];
      setCategories(cats);
      if (mode === "new") {
        const fromQ = qpCategory ? cats.find((c) => c.slug === qpCategory) : null;
        const pick = fromQ ?? cats[0];
        if (pick) setCategoryId(pick.id);
      }
    } catch {
      setCategories([]);
    }
  }, [authHeaders, mode, qpCategory]);

  const loadPage = useCallback(async () => {
    if (mode !== "edit" || !categorySlug || !pageSlug) return;
    setLoadErr(null);
    try {
      const lRes = await fetch(
        apiUrl(
          `/playbooks/pages?categorySlug=${encodeURIComponent(categorySlug)}&pageSlug=${encodeURIComponent(pageSlug)}`
        ),
        { headers: { ...authHeaders() } }
      );
      const lBody = await lRes.json().catch(() => ({}));
      const row = Array.isArray(lBody.pages) ? lBody.pages[0] : null;
      if (!row) {
        setLoadErr("Playbook not found.");
        return;
      }
      const dRes = await fetch(apiUrl(`/playbooks/pages/${row.id}`), { headers: { ...authHeaders() } });
      const dBody = await dRes.json().catch(() => ({}));
      if (!dRes.ok) throw new Error(typeof dBody.error === "string" ? dBody.error : "Load failed.");
      const p = dBody.page;
      setPageId(p.id);
      setTitle(p.title ?? "");
      setBody(p.content_markdown ?? "");
      setStatus(p.status === "draft" ? "draft" : "published");
      setSlug(p.slug ?? pageSlug);
      setCategoryId(p.category_id ?? row.category_id);
      initialRef.current = {
        title: p.title ?? "",
        body: p.content_markdown ?? "",
        status: p.status === "draft" ? "draft" : "published",
        categoryId: p.category_id ?? row.category_id,
      };
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "Error");
    }
  }, [authHeaders, categorySlug, mode, pageSlug]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  useEffect(() => {
    const t = setTimeout(() => setPreviewDebounced(body), 200);
    return () => clearTimeout(t);
  }, [body]);

  useEffect(() => {
    if (typeof window === "undefined" || mode !== "new") return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const o = JSON.parse(raw) as { title?: string; body?: string; status?: string; categoryId?: number };
      if (typeof o.title === "string") setTitle(o.title);
      if (typeof o.body === "string") setBody(o.body);
      if (o.status === "draft" || o.status === "published") setStatus(o.status);
      if (typeof o.categoryId === "number") setCategoryId(o.categoryId);
    } catch {
      /* ignore */
    }
  }, [mode, storageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = window.setInterval(() => {
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({ title, body, status, categoryId, savedAt: Date.now() })
        );
      } catch {
        /* ignore */
      }
    }, 30_000);
    return () => clearInterval(id);
  }, [storageKey, title, body, status, categoryId]);

  const dirty =
    title !== initialRef.current.title ||
    body !== initialRef.current.body ||
    status !== initialRef.current.status ||
    categoryId !== initialRef.current.categoryId;

  useEffect(() => {
    const fn = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", fn);
    return () => window.removeEventListener("beforeunload", fn);
  }, [dirty]);

  const tool = (fn: () => void) => () => {
    const ta = taRef.current;
    if (!ta) return;
    fn();
    setBody(ta.value);
  };

  const onSave = async () => {
    if (!title.trim()) {
      alert("Title is required.");
      return;
    }
    if (!categoryId) {
      alert("Choose a category.");
      return;
    }
    if (mode === "edit" && !changeSummary.trim()) {
      alert("Please describe what you changed.");
      return;
    }
    setSaving(true);
    try {
      if (mode === "new") {
        const res = await fetch(apiUrl("/playbooks/pages"), {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            categoryId,
            contentMarkdown: body,
            status,
          }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof j.error === "string" ? j.error : "Save failed.");
        const p = j.page;
        const cat = categories.find((c) => c.id === categoryId);
        try {
          localStorage.removeItem(storageKey);
        } catch {
          /* ignore */
        }
        router.replace(`/playbooks/${cat?.slug ?? "unknown"}/${p.slug}`);
        return;
      }
      if (!pageId) return;
      const res = await fetch(apiUrl(`/playbooks/pages/${pageId}`), {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          contentMarkdown: body,
          changeSummary: changeSummary.trim(),
          status,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof j.error === "string" ? j.error : "Save failed.");
      const p = j.page;
      const cat = categories.find((c) => c.id === categoryId);
      initialRef.current = {
        title: p.title,
        body: p.content_markdown,
        status: p.status === "draft" ? "draft" : "published",
        categoryId,
      };
      setChangeSummary("");
      router.push(`/playbooks/${cat?.slug ?? categorySlug}/${p.slug}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const onCancel = () => {
    if (dirty) setCancelOpen(true);
    else router.back();
  };

  const catSlugForBreadcrumb =
    mode === "edit"
      ? categorySlug
      : categories.find((c) => c.id === categoryId)?.slug ?? effectiveCatSlug;

  if (loadErr && mode === "edit") {
    return <p style={{ color: "#b32317" }}>{loadErr}</p>;
  }

  return (
    <>
      <div className={shell.breadcrumb}>
        <Link href="/">Team Hub</Link>
        <span>/</span>
        <Link href="/playbooks">Playbooks</Link>
        {catSlugForBreadcrumb ? (
          <>
            <span>/</span>
            <Link href={`/playbooks/${catSlugForBreadcrumb}`}>{categories.find((c) => c.slug === catSlugForBreadcrumb)?.name ?? catSlugForBreadcrumb}</Link>
          </>
        ) : null}
        {mode === "edit" && pageSlug ? (
          <>
            <span>/</span>
            <Link href={`/playbooks/${categorySlug}/${pageSlug}`}>{title || pageSlug}</Link>
            <span>/</span>
            <span>Edit</span>
          </>
        ) : (
          <>
            <span>/</span>
            <span>New playbook</span>
          </>
        )}
      </div>

      <h1 className={shell.pageTitle}>{mode === "new" ? "New playbook" : "Edit playbook"}</h1>

      <div className={ed.editorPage}>
        <div className={ed.fields}>
          <label className={ed.paneLabel} htmlFor="playbook-title">
            Title
          </label>
          <input
            id="playbook-title"
            className={ed.titleInput}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Playbook title"
          />
          <div className={ed.row}>
            <label className={ed.hint} htmlFor="playbook-cat">
              Category
            </label>
            <select
              id="playbook-cat"
              className={ed.select}
              value={categoryId || ""}
              onChange={(e) => setCategoryId(Number(e.target.value))}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <div className={ed.toggle} role="group" aria-label="Status">
              <button
                type="button"
                className={`${ed.toggleBtn} ${status === "published" ? ed.toggleBtnActive : ""}`}
                onClick={() => setStatus("published")}
              >
                Published
              </button>
              <button
                type="button"
                className={`${ed.toggleBtn} ${status === "draft" ? ed.toggleBtnActive : ""}`}
                onClick={() => setStatus("draft")}
              >
                Draft
              </button>
            </div>
          </div>
          {mode === "edit" ? (
            <>
              <label className={ed.paneLabel} htmlFor="playbook-sum">
                What did you change?
              </label>
              <input
                id="playbook-sum"
                className={ed.select}
                style={{ width: "100%", maxWidth: "560px" }}
                value={changeSummary}
                onChange={(e) => setChangeSummary(e.target.value)}
                placeholder="Required — short summary for version history"
              />
            </>
          ) : (
            <p className={ed.hint}>Change summary is optional when creating a new playbook.</p>
          )}
        </div>

        <div className={ed.tabs}>
          <button
            type="button"
            className={`${ed.tabBtn} ${mobileTab === "edit" ? ed.tabBtnActive : ""}`}
            onClick={() => setMobileTab("edit")}
          >
            Edit
          </button>
          <button
            type="button"
            className={`${ed.tabBtn} ${mobileTab === "preview" ? ed.tabBtnActive : ""}`}
            onClick={() => setMobileTab("preview")}
          >
            Preview
          </button>
        </div>

        <div className={ed.toolbar}>
          <button type="button" className={ed.toolBtn} onClick={tool(() => insertAround(taRef.current!, "**", "**"))}>
            Bold
          </button>
          <button type="button" className={ed.toolBtn} onClick={tool(() => insertAround(taRef.current!, "*", "*"))}>
            Italic
          </button>
          <button type="button" className={ed.toolBtn} onClick={tool(() => insertAround(taRef.current!, "## ", ""))}>
            H2
          </button>
          <button
            type="button"
            className={ed.toolBtn}
            onClick={tool(() => {
              const label = window.prompt("Link text", "text");
              const url = window.prompt("URL", "https://");
              if (!url) return;
              insertAround(taRef.current!, `[${label || "link"}](${url})`, "");
            })}
          >
            Link
          </button>
          <button
            type="button"
            className={ed.toolBtn}
            onClick={tool(() => {
              const alt = window.prompt("Image description", "image");
              const url = window.prompt("Image URL", "https://");
              if (!url) return;
              insertAround(taRef.current!, `![${alt || ""}](${url})`, "");
            })}
          >
            Image
          </button>
          <button type="button" className={ed.toolBtn} onClick={tool(() => insertAround(taRef.current!, "- ", ""))}>
            Bullet
          </button>
          <button type="button" className={ed.toolBtn} onClick={tool(() => insertAround(taRef.current!, "1. ", ""))}>
            Numbered
          </button>
          <button type="button" className={ed.toolBtn} onClick={tool(() => insertAround(taRef.current!, "- [ ] ", ""))}>
            Checkbox
          </button>
          <button
            type="button"
            className={ed.toolBtn}
            onClick={tool(() =>
              insertAround(
                taRef.current!,
                "| Col1 | Col2 |\n| --- | --- |\n|  |  |\n",
                ""
              )
            )}
          >
            Table
          </button>
          <button
            type="button"
            className={ed.toolBtn}
            onClick={tool(() => insertAround(taRef.current!, "```\n", "\n```"))}
          >
            Code
          </button>
          <button type="button" className={ed.toolBtn} onClick={tool(() => insertAround(taRef.current!, "> ", ""))}>
            Quote
          </button>
          <button type="button" className={ed.toolBtn} onClick={tool(() => insertAround(taRef.current!, "\n---\n", ""))}>
            HR
          </button>
        </div>

        <div className={ed.split}>
          <div className={`${ed.pane} ${mobileTab === "preview" ? ed.hideMobile : ""}`}>
            <div className={ed.paneLabel}>Markdown</div>
            <textarea
              ref={taRef}
              className={ed.textarea}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              spellCheck={false}
            />
          </div>
          <div className={`${ed.pane} ${mobileTab === "edit" ? ed.hideMobile : ""}`}>
            <div className={ed.paneLabel}>Preview</div>
            <div className={ed.previewPane}>
              <MarkdownBody markdown={previewDebounced || "_Nothing to preview._"} />
            </div>
          </div>
        </div>

        <div className={ed.row} style={{ marginTop: "1.25rem", justifyContent: "flex-end" }}>
          <button type="button" className={shell.btnSecondary} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={shell.btnPrimary} onClick={onSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
        <p className={ed.hint} style={{ marginTop: "0.75rem" }}>
          Draft auto-saves locally every 30 seconds (restore after a crash on new playbooks).
        </p>
      </div>

      {cancelOpen ? (
        <div className={art.modalOverlay}>
          <div className={art.modal}>
            <h3 style={{ marginTop: 0 }}>Discard changes?</h3>
            <p>You have unsaved edits.</p>
            <div className={art.modalActions}>
              <button type="button" className={shell.btnSecondary} onClick={() => setCancelOpen(false)}>
                Keep editing
              </button>
              <button
                type="button"
                className={shell.btnDanger}
                onClick={() => {
                  setCancelOpen(false);
                  router.back();
                }}
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
