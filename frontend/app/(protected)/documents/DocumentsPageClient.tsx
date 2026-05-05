"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./documents.module.css";
import { useAuth } from "../../../context/AuthContext";
import { apiUrl } from "../../../lib/api";

type DocumentRecord = {
  id: number;
  title: string;
  content: string;
  folder: string;
  tags: string[];
  owner: string;
  pinned: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

type FolderDef = { name: string; color: string };

const FOLDERS: FolderDef[] = [
  { name: "Templates", color: "#1B2856" },
  { name: "Operations", color: "#287840" },
  { name: "Meeting Notes", color: "#9a5f00" },
  { name: "Owner Docs", color: "#a32020" },
  { name: "HR & Team", color: "#6A737B" },
  { name: "General", color: "#0098D0" },
];

const TEAM_MEMBERS = ["Mike", "Lori", "Amanda", "Amelia"] as const;

const TEAM_COLORS: Record<string, string> = {
  Mike: "#1B2856",
  Lori: "#287840",
  Amanda: "#9a5f00",
  Amelia: "#a32020",
};

type NavView = "all" | "mine" | "shared" | "recent" | "starred" | "archived";

const NAV_ITEMS: { id: NavView; label: string; icon: string }[] = [
  { id: "all", label: "All Docs", icon: "📄" },
  { id: "mine", label: "My Docs", icon: "👤" },
  { id: "shared", label: "Shared with me", icon: "🤝" },
  { id: "recent", label: "Recently Viewed", icon: "🕒" },
  { id: "starred", label: "Starred", icon: "⭐" },
  { id: "archived", label: "Archived", icon: "🗄️" },
];

type TemplateKey = "blank" | "meeting" | "sop" | "owner" | "wiki";

const TEMPLATES: { key: TemplateKey; label: string; icon: string; folder: string; title: string; content: string }[] = [
  {
    key: "blank",
    label: "Blank Doc",
    icon: "📄",
    folder: "General",
    title: "Untitled Document",
    content: `<h2>Untitled Document</h2><p>Start writing here...</p>`,
  },
  {
    key: "meeting",
    label: "Meeting Notes",
    icon: "📝",
    folder: "Meeting Notes",
    title: "Meeting Notes",
    content: `<h2>Meeting Notes</h2>
<p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
<h3>Attendees</h3>
<ul><li>Mike Williamson</li><li></li></ul>
<h3>Agenda</h3>
<ol><li></li></ol>
<h3>Discussion</h3>
<p></p>
<h3>Action Items</h3>
<ul><li>[ ] </li></ul>
<blockquote><strong>Next Meeting:</strong> </blockquote>`,
  },
  {
    key: "sop",
    label: "SOP",
    icon: "📋",
    folder: "Operations",
    title: "Standard Operating Procedure",
    content: `<h2>Standard Operating Procedure</h2>
<h3>Purpose</h3>
<p>Describe why this procedure exists and what outcome it produces.</p>
<h3>Scope</h3>
<p>Who follows this SOP and when it applies.</p>
<h3>Step-by-step Procedure</h3>
<ol>
  <li>Step one — what to do.</li>
  <li>Step two — what to do.</li>
  <li>Step three — what to do.</li>
</ol>
<blockquote><strong>Notes:</strong> Document any exceptions, escalation paths, or things to watch for.</blockquote>`,
  },
  {
    key: "owner",
    label: "Owner Letter",
    icon: "✉️",
    folder: "Owner Docs",
    title: "Owner Letter",
    content: `<h2>Letter to Owner</h2>
<p>Dear [Owner Name],</p>
<p><strong>Property:</strong> [123 Property Address, Houston, TX]</p>
<p>Body of the letter goes here. Explain the situation, the recommendation, and the rationale.</p>
<h3>Next Steps</h3>
<ol><li>Action item one</li><li>Action item two</li></ol>
<p>Please let us know how you'd like to proceed. We're here to help.</p>
<p>Sincerely,</p>
<p><strong>Mike Williamson</strong><br>Owner / Operator<br><strong>Real Property Management Prestige</strong><br>Houston, TX</p>`,
  },
  {
    key: "wiki",
    label: "Wiki",
    icon: "📚",
    folder: "Operations",
    title: "Wiki Article",
    content: `<h2>Wiki Article</h2>
<h3>Overview</h3>
<p>Short summary of the topic.</p>
<h3>Key Information</h3>
<ul><li></li></ul>
<h3>Resources & Links</h3>
<ul>
  <li><a href="https://rpmtx033.appfolio.com" target="_blank" rel="noopener">AppFolio</a></li>
  <li><a href="https://prestigedash.com" target="_blank" rel="noopener">Prestige Dash</a></li>
</ul>`,
  },
];

const FOLDER_COLOR_MAP: Record<string, string> = FOLDERS.reduce((acc, f) => {
  acc[f.name] = f.color;
  return acc;
}, {} as Record<string, string>);

function folderColor(folder: string): string {
  return FOLDER_COLOR_MAP[folder] || "#0098D0";
}

function relativeTime(iso: string): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const diff = Date.now() - then;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

function avatarInitial(name: string): string {
  const n = (name || "?").trim();
  return n.slice(0, 1).toUpperCase() || "?";
}

const RECENT_KEY = "rpm-documents-recent";
const STARRED_KEY = "rpm-documents-starred";

function readJsonArray(key: string): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "number") : [];
  } catch {
    return [];
  }
}

function writeJsonArray(key: string, value: number[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export default function DocumentsPageClient() {
  const { user, authHeaders } = useAuth();
  const meName = user?.displayName?.trim() || user?.username || "Mike";

  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeNav, setActiveNav] = useState<NavView>("all");
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [openDocId, setOpenDocId] = useState<number | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [draftFolder, setDraftFolder] = useState("General");
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [draftOwner, setDraftOwner] = useState(meName);
  const [tagInput, setTagInput] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [recentIds, setRecentIds] = useState<number[]>([]);
  const [starredIds, setStarredIds] = useState<number[]>([]);

  const editorRef = useRef<HTMLDivElement>(null);
  const initialContentRef = useRef<string>("");
  const draftRef = useRef({
    title: "",
    content: "",
    folder: "General",
    tags: [] as string[],
    owner: meName,
  });
  const dirtyRef = useRef(false);
  const autosaveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setRecentIds(readJsonArray(RECENT_KEY));
    setStarredIds(readJsonArray(STARRED_KEY));
  }, []);

  useEffect(() => {
    draftRef.current = {
      title: draftTitle,
      content: draftContent,
      folder: draftFolder,
      tags: draftTags,
      owner: draftOwner,
    };
  }, [draftTitle, draftContent, draftFolder, draftTags, draftOwner]);

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (activeNav === "archived") params.set("archived", "true");
      const url = apiUrl(`/documents${params.toString() ? `?${params.toString()}` : ""}`);
      const res = await fetch(url, { headers: { ...authHeaders() }, cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(body.documents)) {
        setDocuments(body.documents as DocumentRecord[]);
      } else {
        setDocuments([]);
      }
    } catch {
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  }, [activeNav, authHeaders]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const visibleDocuments = useMemo(() => {
    let docs = documents.slice();
    if (activeNav === "mine") docs = docs.filter((d) => d.owner === meName);
    if (activeNav === "shared") docs = docs.filter((d) => d.owner !== meName);
    if (activeNav === "starred") docs = docs.filter((d) => starredIds.includes(d.id));
    if (activeNav === "recent") {
      const order = new Map(recentIds.map((id, i) => [id, i]));
      docs = docs
        .filter((d) => order.has(d.id))
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    }
    if (activeFolder) docs = docs.filter((d) => d.folder === activeFolder);
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      docs = docs.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          d.content.toLowerCase().includes(q) ||
          d.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return docs;
  }, [documents, activeNav, activeFolder, searchTerm, meName, recentIds, starredIds]);

  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of documents) {
      if (d.archived) continue;
      counts.set(d.folder, (counts.get(d.folder) || 0) + 1);
    }
    return counts;
  }, [documents]);

  const navCounts = useMemo(() => {
    const total = documents.filter((d) => !d.archived).length;
    const mine = documents.filter((d) => !d.archived && d.owner === meName).length;
    const shared = documents.filter((d) => !d.archived && d.owner !== meName).length;
    const starred = documents.filter((d) => !d.archived && starredIds.includes(d.id)).length;
    const archived = documents.filter((d) => d.archived).length;
    const recent = documents.filter((d) => !d.archived && recentIds.includes(d.id)).length;
    return { all: total, mine, shared, starred, archived, recent };
  }, [documents, meName, recentIds, starredIds]);

  const openDoc = useCallback(
    (doc: DocumentRecord) => {
      setOpenDocId(doc.id);
      setDraftTitle(doc.title);
      setDraftContent(doc.content);
      setDraftFolder(doc.folder);
      setDraftTags(doc.tags);
      setDraftOwner(doc.owner);
      setSavedAt(doc.updatedAt);
      initialContentRef.current = doc.content;
      dirtyRef.current = false;
      setAiPrompt("");
      setAiError(null);
      setRecentIds((prev) => {
        const next = [doc.id, ...prev.filter((i) => i !== doc.id)].slice(0, 25);
        writeJsonArray(RECENT_KEY, next);
        return next;
      });
    },
    []
  );

  const closeDoc = useCallback(() => {
    setOpenDocId(null);
    if (autosaveTimerRef.current) {
      window.clearInterval(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  }, []);

  const persistDraft = useCallback(async () => {
    if (openDocId == null) return;
    if (!dirtyRef.current) return;
    setSaving(true);
    try {
      const res = await fetch(apiUrl(`/documents/${openDocId}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(draftRef.current),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.document) {
        const doc = body.document as DocumentRecord;
        setSavedAt(doc.updatedAt);
        setDocuments((prev) => prev.map((d) => (d.id === doc.id ? doc : d)));
        dirtyRef.current = false;
      }
    } finally {
      setSaving(false);
    }
  }, [openDocId, authHeaders]);

  useEffect(() => {
    if (openDocId == null) return;
    if (autosaveTimerRef.current) window.clearInterval(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setInterval(() => {
      persistDraft();
    }, 30000);
    return () => {
      if (autosaveTimerRef.current) {
        window.clearInterval(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [openDocId, persistDraft]);

  useEffect(() => {
    if (openDocId == null) return;
    const handler = () => {
      persistDraft();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [openDocId, persistDraft]);

  useEffect(() => {
    if (openDocId == null) return;
    const el = editorRef.current;
    if (!el) return;
    if (el.innerHTML !== initialContentRef.current) {
      el.innerHTML = initialContentRef.current || "";
    }
  }, [openDocId]);

  const onEditorInput = () => {
    const html = editorRef.current?.innerHTML ?? "";
    setDraftContent(html);
    dirtyRef.current = true;
  };

  const markDirty = () => {
    dirtyRef.current = true;
  };

  const onTitleChange = (value: string) => {
    setDraftTitle(value);
    dirtyRef.current = true;
  };

  const onFolderChange = (value: string) => {
    setDraftFolder(value);
    dirtyRef.current = true;
  };

  const onOwnerChange = (value: string) => {
    setDraftOwner(value);
    dirtyRef.current = true;
  };

  const onAddTag = () => {
    const t = tagInput.trim();
    if (!t) return;
    if (draftTags.includes(t)) {
      setTagInput("");
      return;
    }
    setDraftTags([...draftTags, t]);
    setTagInput("");
    dirtyRef.current = true;
  };

  const onRemoveTag = (tag: string) => {
    setDraftTags(draftTags.filter((t) => t !== tag));
    dirtyRef.current = true;
  };

  const exec = (command: string, value?: string) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    document.execCommand(command, false, value);
    setDraftContent(el.innerHTML);
    dirtyRef.current = true;
  };

  const insertHtml = (html: string) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    document.execCommand("insertHTML", false, html);
    setDraftContent(el.innerHTML);
    dirtyRef.current = true;
  };

  const onInsertLink = () => {
    const url = window.prompt("Enter URL");
    if (!url) return;
    exec("createLink", url);
  };

  const onInsertImage = () => {
    const url = window.prompt("Image URL");
    if (!url) return;
    exec("insertImage", url);
  };

  const onInsertTable = () => {
    const rowsRaw = window.prompt("Rows", "3");
    const colsRaw = window.prompt("Columns", "3");
    const r = Math.max(1, Math.min(20, Number(rowsRaw) || 3));
    const c = Math.max(1, Math.min(10, Number(colsRaw) || 3));
    let html = '<table><thead><tr>';
    for (let i = 0; i < c; i++) html += `<th>Col ${i + 1}</th>`;
    html += "</tr></thead><tbody>";
    for (let i = 0; i < r; i++) {
      html += "<tr>";
      for (let j = 0; j < c; j++) html += "<td>&nbsp;</td>";
      html += "</tr>";
    }
    html += "</tbody></table><p></p>";
    insertHtml(html);
  };

  const onInsertCallout = () => {
    insertHtml('<blockquote>Important callout — type your message here.</blockquote><p></p>');
  };

  const onInsertDivider = () => {
    insertHtml("<hr><p></p>");
  };

  const onInsertChecklist = () => {
    insertHtml(
      '<ul><li><input type="checkbox" /> Task one</li><li><input type="checkbox" /> Task two</li></ul><p></p>'
    );
  };

  const createDoc = useCallback(
    async (template: TemplateKey) => {
      const tpl = TEMPLATES.find((t) => t.key === template) || TEMPLATES[0];
      try {
        const res = await fetch(apiUrl("/documents"), {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            title: tpl.title,
            content: tpl.content,
            folder: tpl.folder,
            owner: meName,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.document) {
          const doc = body.document as DocumentRecord;
          setDocuments((prev) => [doc, ...prev]);
          openDoc(doc);
        }
      } catch (e) {
        console.error("create doc", e);
      }
    },
    [authHeaders, meName, openDoc]
  );

  const duplicateDoc = useCallback(
    async (id: number) => {
      try {
        const res = await fetch(apiUrl(`/documents/${id}/duplicate`), {
          method: "POST",
          headers: { ...authHeaders() },
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.document) {
          setDocuments((prev) => [body.document as DocumentRecord, ...prev]);
        }
      } catch (e) {
        console.error("duplicate", e);
      }
    },
    [authHeaders]
  );

  const deleteDoc = useCallback(
    async (id: number) => {
      if (!window.confirm("Delete this document? This cannot be undone.")) return;
      try {
        const res = await fetch(apiUrl(`/documents/${id}`), {
          method: "DELETE",
          headers: { ...authHeaders() },
        });
        if (res.ok) {
          setDocuments((prev) => prev.filter((d) => d.id !== id));
          if (openDocId === id) closeDoc();
          setStarredIds((prev) => {
            const next = prev.filter((i) => i !== id);
            writeJsonArray(STARRED_KEY, next);
            return next;
          });
        }
      } catch (e) {
        console.error("delete", e);
      }
    },
    [authHeaders, openDocId, closeDoc]
  );

  const togglePinned = useCallback(
    async (doc: DocumentRecord) => {
      try {
        const res = await fetch(apiUrl(`/documents/${doc.id}`), {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ pinned: !doc.pinned }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.document) {
          setDocuments((prev) => prev.map((d) => (d.id === doc.id ? body.document : d)));
        }
      } catch (e) {
        console.error("pin", e);
      }
    },
    [authHeaders]
  );

  const toggleStarred = useCallback((id: number) => {
    setStarredIds((prev) => {
      const next = prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id];
      writeJsonArray(STARRED_KEY, next);
      return next;
    });
  }, []);

  const archiveDoc = useCallback(
    async (id: number, archived: boolean) => {
      try {
        const res = await fetch(apiUrl(`/documents/${id}`), {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ archived }),
        });
        if (res.ok) {
          setDocuments((prev) => prev.filter((d) => d.id !== id));
          if (openDocId === id) closeDoc();
          loadDocuments();
        }
      } catch (e) {
        console.error("archive", e);
      }
    },
    [authHeaders, openDocId, closeDoc, loadDocuments]
  );

  const exportPdf = useCallback(() => {
    if (openDocId == null) return;
    const html = `
      <!doctype html><html><head><meta charset="utf-8" />
      <title>${(draftTitle || "Document").replace(/[<>]/g, "")}</title>
      <style>
        body { font-family: Georgia, "Times New Roman", serif; color: #1B2856; max-width: 720px; margin: 2rem auto; padding: 0 1.25rem; line-height: 1.6; }
        h1, h2, h3 { color: #1B2856; }
        blockquote { border-left: 4px solid #0098D0; background: #f5fbfe; padding: 0.85rem 1rem; margin: 1rem 0; border-radius: 0 6px 6px 0; }
        table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
        th, td { border: 1px solid #d6dce5; padding: 0.5rem 0.75rem; text-align: left; }
        a { color: #0098D0; }
      </style></head><body>
      <h1>${(draftTitle || "Document").replace(/[<>]/g, "")}</h1>
      ${draftContent}
      </body></html>
    `;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  }, [openDocId, draftTitle, draftContent]);

  const runAi = useCallback(async () => {
    setAiBusy(true);
    setAiError(null);
    try {
      const res = await fetch(apiUrl("/documents/ai-assist"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          content: aiPrompt || draftContent,
          instruction: aiPrompt && aiPrompt !== draftContent ? aiPrompt : "",
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAiError(typeof body.error === "string" ? body.error : "AI request failed.");
        return;
      }
      const html = typeof body.content === "string" ? body.content : "";
      if (!html) {
        setAiError("AI returned no content.");
        return;
      }
      if (editorRef.current) editorRef.current.innerHTML = html;
      setDraftContent(html);
      dirtyRef.current = true;
      setAiOpen(false);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "AI request failed.");
    } finally {
      setAiBusy(false);
    }
  }, [aiPrompt, draftContent, authHeaders]);

  const openDocRecord = openDocId != null ? documents.find((d) => d.id === openDocId) : null;

  if (openDocId != null && openDocRecord) {
    return (
      <div className={styles.shell}>
        <div className={styles.editorShell}>
          <div className={styles.editorMain}>
            <div className={styles.editorHeader}>
              <button type="button" className={styles.backBtn} onClick={() => { persistDraft(); closeDoc(); }}>
                ← Back
              </button>
              <input
                className={styles.titleInput}
                value={draftTitle}
                onChange={(e) => onTitleChange(e.target.value)}
                placeholder="Untitled Document"
              />
              <span className={styles.savedMeta}>
                {saving ? "Saving..." : savedAt ? `Saved ${relativeTime(savedAt)}` : "Not saved"}
              </span>
              <button type="button" className={styles.aiBtn} onClick={() => { setAiPrompt(""); setAiOpen(true); }}>
                ✨ AI Assist
              </button>
              <a
                href={`/mailers/compose?document_id=${openDocId}`}
                className={styles.aiBtn}
                style={{ textDecoration: "none", marginLeft: 4 }}
              >
                📬 Send as Mailer
              </a>
            </div>

            <div className={styles.formatBar}>
              <div className={styles.formatGroup}>
                <select
                  className={styles.formatSelect}
                  defaultValue=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    exec("formatBlock", e.target.value);
                    e.target.value = "";
                  }}
                >
                  <option value="">Paragraph style</option>
                  <option value="<h2>">Heading 2</option>
                  <option value="<h3>">Heading 3</option>
                  <option value="<h4>">Heading 4</option>
                  <option value="<p>">Paragraph</option>
                </select>
              </div>
              <div className={styles.formatGroup}>
                <button type="button" className={styles.formatBtn} onClick={() => exec("bold")} title="Bold">
                  <strong>B</strong>
                </button>
                <button type="button" className={styles.formatBtn} onClick={() => exec("italic")} title="Italic">
                  <em>I</em>
                </button>
                <button type="button" className={styles.formatBtn} onClick={() => exec("underline")} title="Underline">
                  <u>U</u>
                </button>
              </div>
              <div className={styles.formatGroup}>
                <button type="button" className={styles.formatBtn} onClick={() => exec("insertUnorderedList")} title="Bullet list">
                  •
                </button>
                <button type="button" className={styles.formatBtn} onClick={() => exec("insertOrderedList")} title="Numbered list">
                  1.
                </button>
                <button type="button" className={styles.formatBtn} onClick={onInsertChecklist} title="Checklist">
                  ☑
                </button>
              </div>
              <div className={styles.formatGroup}>
                <button type="button" className={styles.formatBtn} onClick={onInsertLink} title="Insert link">
                  🔗
                </button>
                <button type="button" className={styles.formatBtn} onClick={onInsertTable} title="Insert table">
                  ▦
                </button>
                <button type="button" className={styles.formatBtn} onClick={onInsertImage} title="Insert image">
                  🖼
                </button>
              </div>
              <div className={styles.formatGroup}>
                <button type="button" className={styles.formatBtn} onClick={onInsertCallout} title="Callout">
                  💬
                </button>
                <button type="button" className={styles.formatBtn} onClick={onInsertDivider} title="Divider">
                  ―
                </button>
              </div>
            </div>

            <div className={styles.canvas}>
              <div
                ref={editorRef}
                className={styles.editor}
                contentEditable
                suppressContentEditableWarning
                onInput={onEditorInput}
                onBlur={() => persistDraft()}
                onKeyDown={markDirty}
              />
            </div>
          </div>

          <aside className={styles.propsPanel}>
            <div className={styles.propGroup}>
              <div className={styles.propLabel}>Folder</div>
              <select className={styles.propSelect} value={draftFolder} onChange={(e) => onFolderChange(e.target.value)}>
                {FOLDERS.map((f) => (
                  <option key={f.name} value={f.name}>{f.name}</option>
                ))}
              </select>
            </div>

            <div className={styles.propGroup}>
              <div className={styles.propLabel}>Tags</div>
              <input
                className={styles.propInput}
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onAddTag();
                  }
                }}
                placeholder="Type and press Enter"
              />
              <div className={styles.propTags}>
                {draftTags.map((t) => (
                  <span key={t} className={styles.tagRemovable}>
                    {t}
                    <button type="button" className={styles.tagRemove} onClick={() => onRemoveTag(t)} aria-label={`Remove ${t}`}>×</button>
                  </span>
                ))}
              </div>
            </div>

            <div className={styles.propGroup}>
              <div className={styles.propLabel}>Owner</div>
              <select className={styles.propSelect} value={draftOwner} onChange={(e) => onOwnerChange(e.target.value)}>
                {Array.from(new Set([draftOwner, ...TEAM_MEMBERS])).map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>

            <div className={styles.propGroup}>
              <div className={styles.propLabel}>Shared With</div>
              <div className={styles.sharedAvatars}>
                {TEAM_MEMBERS.map((name) => (
                  <span
                    key={name}
                    className={styles.sharedAvatar}
                    style={{ background: TEAM_COLORS[name] || "#1B2856" }}
                    title={name}
                  >
                    {avatarInitial(name)}
                  </span>
                ))}
              </div>
            </div>

            <div className={styles.propGroup}>
              <div className={styles.propLabel}>Created</div>
              <div className={styles.dateMeta}>
                {openDocRecord.createdAt ? new Date(openDocRecord.createdAt).toLocaleString() : "—"}
              </div>
            </div>

            <div className={styles.propGroup}>
              <div className={styles.propLabel}>Actions</div>
              <button type="button" className={styles.propBtn} onClick={exportPdf}>📄 Export PDF</button>
              <button type="button" className={styles.propBtn} onClick={() => duplicateDoc(openDocRecord.id)}>📑 Duplicate</button>
              <button
                type="button"
                className={styles.propBtn}
                onClick={() => archiveDoc(openDocRecord.id, !openDocRecord.archived)}
              >
                🗄️ {openDocRecord.archived ? "Unarchive" : "Archive"}
              </button>
              <button
                type="button"
                className={`${styles.propBtn} ${styles.propBtnDanger}`}
                onClick={() => deleteDoc(openDocRecord.id)}
              >
                🗑 Delete
              </button>
            </div>
          </aside>
        </div>

        {aiOpen ? (
          <div className={styles.modalBackdrop} onClick={() => !aiBusy && setAiOpen(false)}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <span className={styles.modalTitle}>✨ AI Assist</span>
                <button type="button" className={styles.btnSecondary} onClick={() => setAiOpen(false)} disabled={aiBusy}>Close</button>
              </div>
              <div className={styles.modalBody}>
                <label className={styles.modalLabel}>
                  Document content (edit before sending — or add an instruction below)
                </label>
                <textarea
                  className={styles.modalTextarea}
                  value={aiPrompt || draftContent}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="The current document content will be sent. Edit here to add instructions, or leave as-is to ask the AI to improve it."
                />
                {aiError ? <div className={styles.aiError}>{aiError}</div> : null}
              </div>
              <div className={styles.modalFooter}>
                <button type="button" className={styles.btnSecondary} onClick={() => setAiOpen(false)} disabled={aiBusy}>Cancel</button>
                <button type="button" className={styles.btnPrimary} onClick={runAi} disabled={aiBusy}>
                  {aiBusy ? "Working..." : "Improve with AI"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <span className={styles.sidebarTitle}>Documents</span>
          <button type="button" className={styles.newBtn} onClick={() => createDoc("blank")}>+ New</button>
        </div>

        <div className={styles.navGroup}>
          {NAV_ITEMS.map((item) => {
            const active = activeNav === item.id;
            const count =
              item.id === "all"
                ? navCounts.all
                : item.id === "mine"
                ? navCounts.mine
                : item.id === "shared"
                ? navCounts.shared
                : item.id === "starred"
                ? navCounts.starred
                : item.id === "archived"
                ? navCounts.archived
                : navCounts.recent;
            return (
              <button
                type="button"
                key={item.id}
                className={`${styles.navItem} ${active ? styles.navItemActive : ""}`}
                onClick={() => {
                  setActiveNav(item.id);
                  setActiveFolder(null);
                }}
              >
                <span className={styles.navIcon}>{item.icon}</span>
                <span>{item.label}</span>
                <span className={styles.navCount}>{count}</span>
              </button>
            );
          })}
        </div>

        <div className={styles.navGroup}>
          <div className={styles.navLabel}>Folders</div>
          {FOLDERS.map((f) => {
            const active = activeFolder === f.name;
            const count = folderCounts.get(f.name) || 0;
            return (
              <button
                type="button"
                key={f.name}
                className={`${styles.folderRow} ${active ? styles.folderRowActive : ""}`}
                onClick={() => {
                  setActiveFolder(active ? null : f.name);
                }}
              >
                <span className={styles.folderDot} style={{ background: f.color }} />
                <span>{f.name}</span>
                <span className={styles.navCount}>{count}</span>
              </button>
            );
          })}
        </div>
      </aside>

      <div className={styles.main}>
        <div className={styles.toolbar}>
          <input
            className={styles.searchInput}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search documents..."
          />
          <button type="button" className={styles.toolbarBtn}>Tags</button>
          <button type="button" className={styles.toolbarBtn}>Sort</button>
          <span className={styles.toolbarSpacer} />
          <div className={styles.viewToggle}>
            <button
              type="button"
              className={`${styles.viewToggleBtn} ${viewMode === "list" ? styles.viewToggleBtnActive : ""}`}
              onClick={() => setViewMode("list")}
              title="List view"
            >
              ☰ List
            </button>
            <button
              type="button"
              className={`${styles.viewToggleBtn} ${viewMode === "grid" ? styles.viewToggleBtnActive : ""}`}
              onClick={() => setViewMode("grid")}
              title="Grid view"
            >
              ▦ Grid
            </button>
          </div>
        </div>

        <div className={styles.quickStart}>
          <span className={styles.quickStartLabel}>Quick start:</span>
          {TEMPLATES.map((tpl) => (
            <button
              type="button"
              key={tpl.key}
              className={styles.quickCard}
              onClick={() => createDoc(tpl.key)}
            >
              <span className={styles.quickIcon}>{tpl.icon}</span>
              <span>{tpl.label}</span>
            </button>
          ))}
        </div>

        <div className={styles.listWrap}>
          {loading ? (
            <div className={styles.loading}>Loading documents...</div>
          ) : visibleDocuments.length === 0 ? (
            <div className={styles.empty}>
              No documents yet. Create one from the Quick Start templates above.
            </div>
          ) : viewMode === "list" ? (
            <div className={styles.list}>
              <div className={styles.listHead}>
                <span>Name</span>
                <span>Folder</span>
                <span>Tags</span>
                <span>Updated</span>
                <span>Owner</span>
                <span>Actions</span>
              </div>
              {visibleDocuments.map((doc) => (
                <div key={doc.id} className={styles.listRow} onClick={() => openDoc(doc)}>
                  <div className={styles.docName}>
                    <span>📄</span>
                    {doc.pinned ? <span className={styles.docPin}>★</span> : null}
                    <span className={styles.docTitle}>{doc.title}</span>
                  </div>
                  <div className={styles.folderLabel}>
                    <span className={styles.folderDot} style={{ background: folderColor(doc.folder) }} />
                    {doc.folder}
                  </div>
                  <div className={styles.tagPills}>
                    {doc.tags.slice(0, 3).map((t) => (
                      <span key={t} className={styles.tagPill}>{t}</span>
                    ))}
                  </div>
                  <div className={styles.relTime}>{relativeTime(doc.updatedAt)}</div>
                  <div>
                    <span
                      className={styles.ownerAvatar}
                      style={{ background: TEAM_COLORS[doc.owner] || "#1B2856" }}
                      title={doc.owner}
                    >
                      {avatarInitial(doc.owner)}
                    </span>
                  </div>
                  <div className={styles.rowActions} onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className={styles.rowActionBtn}
                      onClick={() => togglePinned(doc)}
                      title={doc.pinned ? "Unpin" : "Pin"}
                    >
                      {doc.pinned ? "★" : "☆"}
                    </button>
                    <button
                      type="button"
                      className={styles.rowActionBtn}
                      onClick={() => openDoc(doc)}
                      title="Edit"
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className={styles.rowActionBtn}
                      onClick={() => duplicateDoc(doc.id)}
                      title="Duplicate"
                    >
                      ⎘
                    </button>
                    <button
                      type="button"
                      className={styles.rowActionBtn}
                      onClick={() => toggleStarred(doc.id)}
                      title={starredIds.includes(doc.id) ? "Unstar" : "Star"}
                    >
                      {starredIds.includes(doc.id) ? "⭐" : "☆"}
                    </button>
                    <button
                      type="button"
                      className={styles.rowActionBtn}
                      onClick={() => archiveDoc(doc.id, !doc.archived)}
                      title={doc.archived ? "Unarchive" : "Archive"}
                    >
                      🗄
                    </button>
                    <button
                      type="button"
                      className={styles.rowActionBtn}
                      onClick={() => deleteDoc(doc.id)}
                      title="Delete"
                    >
                      🗑
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.grid}>
              {visibleDocuments.map((doc) => (
                <div key={doc.id} className={styles.gridCard} onClick={() => openDoc(doc)}>
                  <div className={styles.gridCardTitle}>
                    📄 {doc.pinned ? <span className={styles.docPin}>★</span> : null}
                    {doc.title}
                  </div>
                  <div className={styles.gridCardFolder}>
                    <span className={styles.folderDot} style={{ background: folderColor(doc.folder) }} />
                    {doc.folder}
                  </div>
                  <div className={styles.tagPills}>
                    {doc.tags.slice(0, 4).map((t) => (
                      <span key={t} className={styles.tagPill}>{t}</span>
                    ))}
                  </div>
                  <div className={styles.gridCardMeta}>
                    Updated {relativeTime(doc.updatedAt)} • {doc.owner}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
