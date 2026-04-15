"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../../context/AuthContext";
import { apiUrl } from "../../../../lib/api";
import shell from "../playbook-shell.module.css";

type Category = {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  icon: string;
  page_count: number;
};

export default function PlaybookManageClient() {
  const router = useRouter();
  const { authHeaders, isAdmin } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("📋");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editIcon, setEditIcon] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/playbooks/categories"), { headers: { ...authHeaders() } });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof j.error === "string" ? j.error : "Load failed.");
      setCategories(Array.isArray(j.categories) ? j.categories : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    }
  }, [authHeaders]);

  useEffect(() => {
    if (!isAdmin) {
      router.replace("/playbooks");
      return;
    }
    load();
  }, [isAdmin, load, router]);

  const onCreate = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(apiUrl("/playbooks/categories"), {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null, icon: icon || "📋" }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof j.error === "string" ? j.error : "Failed.");
      setName("");
      setDescription("");
      setIcon("📋");
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (c: Category) => {
    setEditingId(c.id);
    setEditName(c.name);
    setEditDesc(c.description ?? "");
    setEditIcon(c.icon || "📋");
  };

  const onSaveEdit = async (id: number) => {
    setBusy(true);
    try {
      const res = await fetch(apiUrl(`/playbooks/categories/${id}`), {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDesc.trim() || null,
          icon: editIcon || "📋",
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof j.error === "string" ? j.error : "Failed.");
      setEditingId(null);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (c: Category) => {
    if (c.page_count > 0) {
      alert("Delete all playbooks in this category first.");
      return;
    }
    if (!window.confirm(`Delete category "${c.name}"?`)) return;
    setBusy(true);
    try {
      const res = await fetch(apiUrl(`/playbooks/categories/${c.id}`), {
        method: "DELETE",
        headers: { ...authHeaders() },
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(typeof j.error === "string" ? j.error : "Failed.");
      }
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  };

  if (!isAdmin) return null;

  return (
    <>
      <div className={shell.breadcrumb}>
        <Link href="/">Team Hub</Link>
        <span>/</span>
        <Link href="/playbooks">Playbooks</Link>
        <span>/</span>
        <span>Manage categories</span>
      </div>
      <h1 className={shell.pageTitle}>Manage categories</h1>
      {err ? <p style={{ color: "#b32317" }}>{err}</p> : null}

      <section style={{ marginBottom: "2rem", padding: "1.25rem", background: "#fff", borderRadius: 12, border: "1px solid #e6eaef" }}>
        <h2 className={shell.sectionTitle} style={{ marginTop: 0 }}>
          New category
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem", maxWidth: 480 }}>
          <input className={shell.searchInput} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input
            className={shell.searchInput}
            placeholder="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <input className={shell.searchInput} placeholder="Icon (emoji)" value={icon} onChange={(e) => setIcon(e.target.value)} />
          <button type="button" className={shell.btnPrimary} onClick={onCreate} disabled={busy}>
            Create
          </button>
        </div>
      </section>

      <ul className={shell.recentList}>
        {categories.map((c) => (
          <li key={c.id} style={{ padding: "1rem" }}>
            {editingId === c.id ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <input className={shell.searchInput} value={editName} onChange={(e) => setEditName(e.target.value)} />
                <input className={shell.searchInput} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
                <input className={shell.searchInput} value={editIcon} onChange={(e) => setEditIcon(e.target.value)} />
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button type="button" className={shell.btnPrimary} onClick={() => onSaveEdit(c.id)} disabled={busy}>
                    Save
                  </button>
                  <button type="button" className={shell.btnSecondary} onClick={() => setEditingId(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "0.75rem" }}>
                <div>
                  <strong style={{ color: "#1b2856" }}>
                    {c.icon} {c.name}
                  </strong>
                  <div style={{ fontSize: "0.85rem", color: "#6a737b" }}>{c.description}</div>
                  <div style={{ fontSize: "0.8rem", marginTop: "0.25rem" }}>
                    slug: <code>{c.slug}</code> · {c.page_count} playbooks
                  </div>
                </div>
                <div style={{ display: "flex", gap: "0.35rem" }}>
                  <button type="button" className={shell.btnSecondary} onClick={() => startEdit(c)}>
                    Edit
                  </button>
                  <button type="button" className={shell.btnDanger} onClick={() => onDelete(c)} disabled={busy}>
                    Delete
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      <p style={{ marginTop: "1.5rem" }}>
        <Link href="/playbooks" className={shell.btnSecondary}>
          &larr; Back to playbooks
        </Link>
      </p>
    </>
  );
}
