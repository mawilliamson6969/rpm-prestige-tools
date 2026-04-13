"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../../context/AuthContext";
import { apiUrl, apiUrlWithAuthQuery } from "../../../lib/api";
import styles from "./files.module.css";

type FolderNode = {
  id: number;
  name: string;
  icon: string;
  isSystem: boolean;
  folderType: string;
  children: FolderNode[];
  fileCount: number;
  totalFileCount: number;
};

type FileRow = {
  id: number;
  folderId: number;
  originalFilename: string;
  fileSizeBytes: number;
  mimeType: string;
  fileType: string;
  description: string | null;
  tags: string[];
  aiSummary: string | null;
  aiAnalysisStatus: string;
  uploadedByName: string | null;
  downloadCount: number;
  createdAt: string;
  shareUrl?: string | null;
};

function initials(name: string | null | undefined) {
  if (!name?.trim()) return "?";
  const p = name.trim().split(/\s+/).slice(0, 2);
  return p.map((s) => s[0]?.toUpperCase() ?? "").join("") || "?";
}

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function fileIcon(ft: string) {
  const m: Record<string, string> = {
    pdf: "📄",
    image: "🖼",
    document: "📝",
    spreadsheet: "📊",
    presentation: "📽",
    video: "🎬",
    audio: "🎵",
    other: "📎",
  };
  return m[ft] || m.other;
}

function flattenFolders(nodes: FolderNode[], depth = 0, out: { id: number; label: string }[] = []) {
  for (const n of nodes) {
    out.push({ id: n.id, label: `${"—".repeat(depth)} ${n.icon} ${n.name}`.trim() });
    if (n.children?.length) flattenFolders(n.children, depth + 1, out);
  }
  return out;
}

function filterTree(nodes: FolderNode[], q: string): FolderNode[] {
  if (!q.trim()) return nodes;
  const needle = q.trim().toLowerCase();
  const walk = (list: FolderNode[]): FolderNode[] => {
    const res: FolderNode[] = [];
    for (const n of list) {
      const kids = walk(n.children || []);
      const selfHit = n.name.toLowerCase().includes(needle);
      if (selfHit || kids.length) res.push({ ...n, children: kids });
    }
    return res;
  };
  return walk(nodes);
}

function collectFolderPath(nodes: FolderNode[], targetId: number, path: FolderNode[] = []): FolderNode[] | null {
  for (const n of nodes) {
    const next = [...path, n];
    if (n.id === targetId) return next;
    if (n.children?.length) {
      const hit = collectFolderPath(n.children, targetId, next);
      if (hit) return hit;
    }
  }
  return null;
}

export default function FilesPageClient() {
  const { authHeaders, token, isAdmin } = useAuth();
  const [tree, setTree] = useState<FolderNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);
  const [folderSearch, setFolderSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [folderLoading, setFolderLoading] = useState(false);
  const [subfolders, setSubfolders] = useState<FolderNode[]>([]);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [mainSearch, setMainSearch] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [sortKey, setSortKey] = useState<"name" | "date" | "size" | "type">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedFileId, setSelectedFileId] = useState<number | null>(null);
  const [fileDetail, setFileDetail] = useState<(FileRow & { folderPath?: { id: number; name: string }[] }) | null>(
    null
  );
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkIds, setBulkIds] = useState<Set<number>>(() => new Set());
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<{ file: File; description: string; tags: string; progress: number }[]>(
    []
  );
  const [ctx, setCtx] = useState<{ x: number; y: number; folder: FolderNode } | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameFolder, setRenameFolder] = useState<FolderNode | null>(null);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);
  const [newFolderParentId, setNewFolderParentId] = useState<number | null>(null);
  const mainDropRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const filteredTree = useMemo(() => filterTree(tree, folderSearch), [tree, folderSearch]);

  const loadTree = useCallback(async () => {
    setTreeLoading(true);
    try {
      const res = await fetch(apiUrl("/files/folders"), { cache: "no-store", headers: { ...authHeaders() } });
      const body = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(body.folders)) {
        setTree(body.folders);
      }
    } finally {
      setTreeLoading(false);
    }
  }, [authHeaders]);

  const collectAllIds = useCallback((nodes: FolderNode[]): number[] => {
    const out: number[] = [];
    for (const n of nodes) {
      out.push(n.id);
      if (n.children?.length) out.push(...collectAllIds(n.children));
    }
    return out;
  }, []);

  useEffect(() => {
    if (treeLoading || !tree.length || selectedFolderId != null) return;
    setSelectedFolderId(tree[0].id);
    setExpanded(new Set(collectAllIds(tree)));
  }, [tree, treeLoading, selectedFolderId, collectAllIds]);

  const loadFolder = useCallback(
    async (folderId: number, search?: string) => {
      setFolderLoading(true);
      try {
        const q = search?.trim() ? `&search=${encodeURIComponent(search.trim())}` : "";
        const [rDetail, rList] = await Promise.all([
          fetch(apiUrl(`/files/folders/${folderId}`), { cache: "no-store", headers: { ...authHeaders() } }),
          fetch(apiUrl(`/files?folderId=${folderId}${q}`), { cache: "no-store", headers: { ...authHeaders() } }),
        ]);
        const jDetail = await rDetail.json().catch(() => ({}));
        const jList = await rList.json().catch(() => ({}));
        if (rDetail.ok) {
          setSubfolders((jDetail.subfolders || []).map((s: Record<string, unknown>) => mapFolderApi(s)));
          const listFiles = rList.ok && Array.isArray(jList.files) ? jList.files : jDetail.files || [];
          setFiles(listFiles.map(mapFileApi));
        }
      } finally {
        setFolderLoading(false);
      }
    },
    [authHeaders]
  );

  function mapFolderApi(s: Record<string, unknown>): FolderNode {
    return {
      id: Number(s.id),
      name: String(s.name),
      icon: String(s.icon || "📁"),
      isSystem: !!s.isSystem,
      folderType: String(s.folderType || "custom"),
      children: [],
      fileCount: 0,
      totalFileCount: 0,
    };
  }

  function mapFileApi(s: Record<string, unknown>): FileRow {
    return {
      id: Number(s.id),
      folderId: Number(s.folderId),
      originalFilename: String(s.originalFilename),
      fileSizeBytes: Number(s.fileSizeBytes || 0),
      mimeType: String(s.mimeType || ""),
      fileType: String(s.fileType || "other"),
      description: s.description != null ? String(s.description) : null,
      tags: Array.isArray(s.tags) ? (s.tags as string[]) : [],
      aiSummary: s.aiSummary != null ? String(s.aiSummary) : null,
      aiAnalysisStatus: String(s.aiAnalysisStatus || "none"),
      uploadedByName: s.uploadedByName != null ? String(s.uploadedByName) : null,
      downloadCount: Number(s.downloadCount || 0),
      createdAt: String(s.createdAt),
      shareUrl: s.shareUrl != null ? String(s.shareUrl) : null,
    };
  }

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  useEffect(() => {
    if (selectedFolderId != null) loadFolder(selectedFolderId, mainSearch);
  }, [selectedFolderId, mainSearch, loadFolder]);

  const loadFileDetail = useCallback(
    async (id: number) => {
      const res = await fetch(apiUrl(`/files/${id}`), { cache: "no-store", headers: { ...authHeaders() } });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.file) {
        setFileDetail({
          ...mapFileApi(body.file),
          folderPath: body.file.folderPath,
        });
      }
    },
    [authHeaders]
  );

  useEffect(() => {
    if (selectedFileId != null) void loadFileDetail(selectedFileId);
    else setFileDetail(null);
  }, [selectedFileId, loadFileDetail]);

  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (fileDetail?.aiAnalysisStatus === "processing") {
      pollRef.current = setInterval(() => {
        if (selectedFileId) void loadFileDetail(selectedFileId);
      }, 3000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fileDetail?.aiAnalysisStatus, selectedFileId, loadFileDetail]);

  const pathNodes = useMemo(() => {
    if (selectedFolderId == null) return [];
    return collectFolderPath(tree, selectedFolderId) ?? [];
  }, [tree, selectedFolderId]);

  const onSortColumn = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sortedFiles = useMemo(() => {
    const arr = [...files];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      if (sortKey === "name") return a.originalFilename.localeCompare(b.originalFilename) * dir;
      if (sortKey === "size") return (a.fileSizeBytes - b.fileSizeBytes) * dir;
      if (sortKey === "type") return a.fileType.localeCompare(b.fileType) * dir;
      return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir;
    });
    return arr;
  }, [files, sortKey, sortDir]);

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const onPickFiles = (list: FileList | null) => {
    if (!list?.length) return;
    setUploadQueue((q) => [
      ...q,
      ...Array.from(list).map((file) => ({ file, description: "", tags: "", progress: 0 })),
    ]);
    setUploadOpen(true);
  };

  const runUploadAll = async () => {
    if (selectedFolderId == null) return;
    if (!uploadQueue.length) {
      window.alert("Add files using the file picker first.");
      return;
    }
    for (let i = 0; i < uploadQueue.length; i++) {
      const item = uploadQueue[i];
      const fd = new FormData();
      fd.append("folderId", String(selectedFolderId));
      fd.append("description", item.description);
      fd.append("tags", item.tags);
      fd.append("files", item.file);
      setUploadQueue((prev) => {
        const c = [...prev];
        c[i] = { ...c[i], progress: 10 };
        return c;
      });
      const xhr = new XMLHttpRequest();
      await new Promise<void>((resolve, reject) => {
        xhr.open("POST", apiUrl("/files/upload"));
        const h = authHeaders();
        if (h.Authorization) xhr.setRequestHeader("Authorization", h.Authorization);
        xhr.upload.onprogress = (ev) => {
          if (!ev.lengthComputable) return;
          const pct = Math.round((ev.loaded / ev.total) * 100);
          setUploadQueue((prev) => {
            const c = [...prev];
            c[i] = { ...c[i], progress: Math.max(10, pct) };
            return c;
          });
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(xhr.responseText || `HTTP ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error("Network error"));
        xhr.send(fd);
      }).catch(() => {
        setUploadQueue((prev) => {
          const c = [...prev];
          c[i] = { ...c[i], progress: -1 };
          return c;
        });
      });
      setUploadQueue((prev) => {
        const c = [...prev];
        c[i] = { ...c[i], progress: 100 };
        return c;
      });
    }
    setUploadOpen(false);
    setUploadQueue([]);
    if (selectedFolderId != null) await loadFolder(selectedFolderId, mainSearch);
    await loadTree();
  };

  const moveFilesToFolder = async (fileIds: number[], folderId: number) => {
    const res = await fetch(apiUrl("/files/bulk/move"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ fileIds, folderId }),
    });
    if (!res.ok) return;
    setBulkIds(new Set());
    if (selectedFolderId != null) await loadFolder(selectedFolderId, mainSearch);
    await loadTree();
    if (selectedFileId && fileIds.includes(selectedFileId)) void loadFileDetail(selectedFileId);
  };

  const renderFolderRows = (nodes: FolderNode[], depth = 0) => {
    return nodes.map((node) => {
      const hasKids = node.children?.length > 0;
      const open = expanded.has(node.id);
      const active = selectedFolderId === node.id;
      return (
        <div key={node.id}>
          <div
            className={`${styles.folderRow} ${active ? styles.folderRowActive : ""} ${
              dropTargetId === node.id ? styles.folderRowDrop : ""
            }`}
            style={{ paddingLeft: `${8 + depth * 12}px` }}
            onClick={() => setSelectedFolderId(node.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtx({ x: e.clientX, y: e.clientY, folder: node });
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDropTargetId(node.id);
            }}
            onDragLeave={() => setDropTargetId(null)}
            onDrop={(e) => {
              e.preventDefault();
              setDropTargetId(null);
              const raw = e.dataTransfer.getData("application/x-rpm-file-ids");
              if (raw) {
                try {
                  const ids = JSON.parse(raw) as number[];
                  void moveFilesToFolder(ids, node.id);
                } catch {
                  /* ignore */
                }
              } else if (e.dataTransfer.files?.length) {
                onPickFiles(e.dataTransfer.files);
              }
            }}
          >
            {hasKids ? (
              <button
                type="button"
                className={styles.folderToggle}
                aria-label={open ? "Collapse" : "Expand"}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpand(node.id);
                }}
              >
                {open ? "▼" : "▶"}
              </button>
            ) : (
              <span className={styles.folderToggle} />
            )}
            <span className={styles.folderIcon}>{node.icon}</span>
            <span className={styles.folderName}>{node.name}</span>
            <span className={styles.folderBadge}>{node.totalFileCount ?? 0}</span>
          </div>
          {hasKids && open ? renderFolderRows(node.children, depth + 1) : null}
        </div>
      );
    });
  };

  const mobileOptions = flattenFolders(tree);

  return (
    <div className={styles.page} onClick={() => setCtx(null)}>
      <div className={styles.toolbar}>
        <h1>File Manager</h1>
        <button type="button" className={styles.ghostBtn} onClick={() => setView(view === "grid" ? "list" : "grid")}>
          {view === "grid" ? "List view" : "Grid view"}
        </button>
        <button
          type="button"
          className={styles.ghostBtn}
          data-on={bulkMode ? "true" : "false"}
          onClick={() => {
            setBulkMode((v) => !v);
            setBulkIds(new Set());
          }}
        >
          Bulk select
        </button>
      </div>

      <div className={styles.mobileFolderSelect}>
        <span className={styles.visuallyHidden} id="mobile-folder-label">
          Folder
        </span>
        <select
          id="mobile-folder"
          aria-labelledby="mobile-folder-label"
          value={selectedFolderId ?? ""}
          onChange={(e) => setSelectedFolderId(Number(e.target.value))}
        >
          {mobileOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.body}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarSearch}>
            <input
              type="search"
              placeholder="Filter folders…"
              value={folderSearch}
              onChange={(e) => setFolderSearch(e.target.value)}
            />
          </div>
          <div className={styles.treeScroll}>
            {treeLoading ? (
              <>
                <div className={styles.skeleton} style={{ height: 14, margin: "0.5rem" }} />
                <div className={styles.skeleton} style={{ height: 14, margin: "0.5rem" }} />
                <div className={styles.skeleton} style={{ height: 14, margin: "0.5rem" }} />
              </>
            ) : (
              renderFolderRows(filteredTree)
            )}
          </div>
          <div className={styles.sidebarFooter}>
            <button
              type="button"
              className={styles.newFolderBtn}
              onClick={() => {
                setNewFolderParentId(selectedFolderId);
                setNewFolderOpen(true);
              }}
            >
              New folder
            </button>
          </div>
        </aside>

        <main
          className={styles.center}
          ref={mainDropRef}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files?.length) onPickFiles(e.dataTransfer.files);
          }}
        >
          <div className={styles.centerInner}>
            <div className={styles.dropOverlay}>
              <nav className={styles.breadcrumb} aria-label="Folder path">
                <button type="button" onClick={() => setSelectedFolderId(null)}>
                  Files
                </button>
                {pathNodes.map((n, i) => (
                  <span key={n.id}>
                    {" "}
                    /{" "}
                    <button type="button" onClick={() => setSelectedFolderId(n.id)}>
                      {n.name}
                    </button>
                  </span>
                ))}
              </nav>

              <div className={styles.controls}>
                <input
                  className={styles.searchInput}
                  type="search"
                  placeholder="Search files in this folder…"
                  value={mainSearch}
                  onChange={(e) => setMainSearch(e.target.value)}
                />
                <button type="button" className={styles.primaryBtn} onClick={() => setUploadOpen(true)}>
                  Upload files
                </button>
                {bulkMode && bulkIds.size > 0 ? (
                  <>
                    <button
                      type="button"
                      className={styles.ghostBtn}
                      onClick={() => {
                        const fid = window.prompt("Target folder id:");
                        if (!fid) return;
                        void moveFilesToFolder(Array.from(bulkIds), Number(fid));
                      }}
                    >
                      Move selected ({bulkIds.size})
                    </button>
                    {isAdmin ? (
                      <button
                        type="button"
                        className={styles.ghostBtn}
                        style={{ color: "#b32317" }}
                        onClick={async () => {
                          if (!window.confirm(`Delete ${bulkIds.size} files permanently?`)) return;
                          const res = await fetch(apiUrl("/files/bulk/delete"), {
                            method: "POST",
                            headers: { "Content-Type": "application/json", ...authHeaders() },
                            body: JSON.stringify({ fileIds: Array.from(bulkIds) }),
                          });
                          if (res.ok) {
                            setBulkIds(new Set());
                            if (selectedFolderId != null) void loadFolder(selectedFolderId, mainSearch);
                            void loadTree();
                          }
                        }}
                      >
                        Delete selected
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>

              {folderLoading ? (
                <div className={styles.grid}>
                  {[1, 2, 3, 4].map((k) => (
                    <div key={k} className={styles.skeleton} style={{ height: 160 }} />
                  ))}
                </div>
              ) : view === "grid" ? (
                <div className={styles.grid}>
                  {sortedFiles.length === 0 ? (
                    <p className={styles.emptyHint}>No files in this folder. Drag files here or upload.</p>
                  ) : (
                    sortedFiles.map((f) => (
                      <div
                        key={f.id}
                        role="button"
                        tabIndex={0}
                        className={`${styles.card} ${bulkIds.has(f.id) ? styles.cardSelected : ""} ${
                          selectedFileId === f.id ? styles.cardSelected : ""
                        }`}
                        onClick={() => {
                          if (bulkMode) {
                            setBulkIds((prev) => {
                              const n = new Set(prev);
                              if (n.has(f.id)) n.delete(f.id);
                              else n.add(f.id);
                              return n;
                            });
                          } else setSelectedFileId(f.id);
                        }}
                        draggable={!bulkMode}
                        onDragStart={(e) => {
                          e.dataTransfer.setData("application/x-rpm-file-ids", JSON.stringify([f.id]));
                          e.dataTransfer.effectAllowed = "move";
                        }}
                      >
                        <div className={styles.thumb}>
                          {f.fileType === "image" ? (
                            <img
                              src={apiUrlWithAuthQuery(`/files/${f.id}/preview`, token)}
                              alt=""
                              loading="lazy"
                            />
                          ) : f.fileType === "pdf" ? (
                            <span className={styles.thumbPdf} aria-hidden>
                              📄
                            </span>
                          ) : (
                            <span style={{ fontSize: "2rem" }} aria-hidden>
                              {fileIcon(f.fileType)}
                            </span>
                          )}
                        </div>
                        <div className={styles.cardTitle} title={f.originalFilename}>
                          {f.originalFilename}
                        </div>
                        <div className={styles.cardMeta}>
                          {fmtBytes(f.fileSizeBytes)} · {fmtDate(f.createdAt)}
                        </div>
                        <div className={styles.cardMeta} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span className={styles.avatarSm}>{initials(f.uploadedByName)}</span>
                          <span>{f.uploadedByName ?? "—"}</span>
                          {f.aiAnalysisStatus === "completed" ? (
                            <span className={styles.sparkle} title="AI analyzed">
                              ✨
                            </span>
                          ) : null}
                        </div>
                        <div>
                          {f.tags.slice(0, 4).map((t) => (
                            <span key={t} className={styles.tagPill}>
                              {t}
                            </span>
                          ))}
                        </div>
                        <div
                          style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <a
                            className={styles.ghostBtn}
                            style={{ fontSize: "0.72rem", padding: "0.2rem 0.5rem" }}
                            href={apiUrlWithAuthQuery(`/files/${f.id}/download`, token)}
                            download
                          >
                            Download
                          </a>
                          {f.fileType === "pdf" || f.fileType === "image" ? (
                            <a
                              className={styles.ghostBtn}
                              style={{ fontSize: "0.72rem", padding: "0.2rem 0.5rem" }}
                              href={apiUrlWithAuthQuery(`/files/${f.id}/preview`, token)}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Preview
                            </a>
                          ) : null}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        {bulkMode ? <th /> : null}
                        <th onClick={() => onSortColumn("name")}>Name</th>
                        <th onClick={() => onSortColumn("type")}>Type</th>
                        <th onClick={() => onSortColumn("size")}>Size</th>
                        <th>Uploaded by</th>
                        <th onClick={() => onSortColumn("date")}>Date</th>
                        <th>Tags</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedFiles.map((f) => (
                        <tr
                          key={f.id}
                          className={selectedFileId === f.id ? styles.cardSelected : undefined}
                          onClick={() => {
                            if (bulkMode) {
                              setBulkIds((prev) => {
                                const n = new Set(prev);
                                if (n.has(f.id)) n.delete(f.id);
                                else n.add(f.id);
                                return n;
                              });
                            } else setSelectedFileId(f.id);
                          }}
                        >
                          {bulkMode ? (
                            <td>
                              <input
                                type="checkbox"
                                checked={bulkIds.has(f.id)}
                                onChange={() =>
                                  setBulkIds((prev) => {
                                    const n = new Set(prev);
                                    if (n.has(f.id)) n.delete(f.id);
                                    else n.add(f.id);
                                    return n;
                                  })
                                }
                              />
                            </td>
                          ) : null}
                          <td>{f.originalFilename}</td>
                          <td>{f.fileType}</td>
                          <td>{fmtBytes(f.fileSizeBytes)}</td>
                          <td>{f.uploadedByName}</td>
                          <td>{fmtDate(f.createdAt)}</td>
                          <td>{f.tags.join(", ")}</td>
                          <td>
                            <a href={apiUrlWithAuthQuery(`/files/${f.id}/download`, token)} download>
                              Download
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </main>

        {fileDetail && (
          <aside className={styles.detailPanel}>
            <div className={styles.detailHeader}>
              <strong>Details</strong>
              <button type="button" className={styles.detailClose} onClick={() => setSelectedFileId(null)}>
                Close
              </button>
            </div>
            <div className={styles.detailBody}>
              <h3 style={{ marginTop: 0, fontSize: "1rem" }}>{fileDetail.originalFilename}</h3>
              <p style={{ color: "#6a737b", fontSize: "0.85rem" }}>
                {fileDetail.fileType.toUpperCase()} · {fmtBytes(fileDetail.fileSizeBytes)} · {fileDetail.downloadCount}{" "}
                downloads
              </p>
              <p style={{ fontSize: "0.85rem" }}>{fmtDate(fileDetail.createdAt)}</p>
              {fileDetail.folderPath?.length ? (
                <nav className={styles.breadcrumb} style={{ marginBottom: "0.75rem" }}>
                  {fileDetail.folderPath.map((seg, idx) => (
                    <span key={seg.id}>
                      {idx ? " / " : null}
                      <button type="button" onClick={() => setSelectedFolderId(seg.id)}>
                        {seg.name}
                      </button>
                    </span>
                  ))}
                </nav>
              ) : null}
              <div style={{ marginBottom: "0.75rem" }}>
                <strong>Preview</strong>
                {fileDetail.fileType === "image" ? (
                  <img
                    className={styles.previewImg}
                    src={apiUrlWithAuthQuery(`/files/${fileDetail.id}/preview`, token)}
                    alt=""
                  />
                ) : fileDetail.fileType === "pdf" ? (
                  <iframe
                    className={styles.previewFrame}
                    title="PDF preview"
                    src={apiUrlWithAuthQuery(`/files/${fileDetail.id}/preview`, token)}
                  />
                ) : (
                  <div className={styles.previewFrame} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span>{fileIcon(fileDetail.fileType)}</span>
                    <span style={{ marginLeft: 8 }}>Download to view</span>
                  </div>
                )}
              </div>
              <label style={{ fontSize: "0.85rem" }}>
                Description
                <textarea
                  style={{ width: "100%", minHeight: 70, marginTop: 4 }}
                  value={fileDetail.description ?? ""}
                  onChange={(e) => setFileDetail({ ...fileDetail, description: e.target.value })}
                  onBlur={async () => {
                    await fetch(apiUrl(`/files/${fileDetail.id}`), {
                      method: "PUT",
                      headers: { "Content-Type": "application/json", ...authHeaders() },
                      body: JSON.stringify({ description: fileDetail.description }),
                    });
                  }}
                />
              </label>
              <div style={{ marginTop: "0.75rem" }}>
                <strong>AI analysis</strong>
                {fileDetail.aiAnalysisStatus === "processing" ? (
                  <p>Analyzing…</p>
                ) : fileDetail.aiAnalysisStatus === "completed" && fileDetail.aiSummary ? (
                  <pre
                    style={{
                      whiteSpace: "pre-wrap",
                      fontSize: "0.8rem",
                      background: "#f5f5f5",
                      padding: "0.5rem",
                      borderRadius: 8,
                    }}
                  >
                    {fileDetail.aiSummary}
                  </pre>
                ) : (
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    style={{ marginTop: 8 }}
                    onClick={async () => {
                      await fetch(apiUrl(`/files/${fileDetail.id}/analyze`), {
                        method: "POST",
                        headers: { ...authHeaders() },
                      });
                      setFileDetail({ ...fileDetail, aiAnalysisStatus: "processing" });
                    }}
                  >
                    Analyze with AI
                  </button>
                )}
              </div>
              <div style={{ marginTop: "0.75rem" }}>
                <strong>Share</strong>
                {fileDetail.shareUrl ? (
                  <div>
                    <input readOnly style={{ width: "100%", fontSize: "0.75rem" }} value={fileDetail.shareUrl} />
                    <button
                      type="button"
                      className={styles.ghostBtn}
                      style={{ marginTop: 6 }}
                      onClick={() => navigator.clipboard.writeText(fileDetail.shareUrl ?? "")}
                    >
                      Copy link
                    </button>
                    <button
                      type="button"
                      className={styles.ghostBtn}
                      style={{ marginTop: 6, marginLeft: 6 }}
                      onClick={async () => {
                        await fetch(apiUrl(`/files/${fileDetail.id}/share`), {
                      method: "DELETE",
                      headers: { ...authHeaders() },
                    });
                        void loadFileDetail(fileDetail.id);
                      }}
                    >
                      Revoke
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    style={{ marginTop: 8 }}
                    onClick={async () => {
                      const res = await fetch(apiUrl(`/files/${fileDetail.id}/share`), {
                        method: "POST",
                        headers: { ...authHeaders() },
                      });
                      const body = await res.json().catch(() => ({}));
                      if (res.ok) setFileDetail({ ...fileDetail, shareUrl: String(body.shareUrl || "") });
                    }}
                  >
                    Create share link
                  </button>
                )}
              </div>
              <div style={{ marginTop: "1rem", display: "flex", flexWrap: "wrap", gap: 8 }}>
                <a className={styles.primaryBtn} href={apiUrlWithAuthQuery(`/files/${fileDetail.id}/download`, token)} style={{ textDecoration: "none", display: "inline-block" }}>
                  Download
                </a>
                <button
                  type="button"
                  className={styles.ghostBtn}
                  onClick={async () => {
                    const fid = window.prompt("Move to folder id (see sidebar):");
                    if (!fid) return;
                    await fetch(apiUrl(`/files/${fileDetail.id}`), {
                      method: "PUT",
                      headers: { "Content-Type": "application/json", ...authHeaders() },
                      body: JSON.stringify({ folderId: Number(fid) }),
                    });
                    void loadFileDetail(fileDetail.id);
                    if (selectedFolderId != null) void loadFolder(selectedFolderId, mainSearch);
                    void loadTree();
                  }}
                >
                  Move…
                </button>
                <button
                  type="button"
                  className={styles.ghostBtn}
                  style={{ color: "#b32317" }}
                  onClick={async () => {
                    if (!window.confirm("Delete this file?")) return;
                    await fetch(apiUrl(`/files/${fileDetail.id}`), { method: "DELETE", headers: { ...authHeaders() } });
                    setSelectedFileId(null);
                    if (selectedFolderId != null) void loadFolder(selectedFolderId, mainSearch);
                    void loadTree();
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </aside>
        )}
      </div>

      {ctx ? (
        <div className={styles.ctxMenu} style={{ left: ctx.x, top: ctx.y }} onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => {
              setNewFolderName("");
              setNewFolderParentId(ctx.folder.id);
              setNewFolderOpen(true);
              setCtx(null);
              setSelectedFolderId(ctx.folder.id);
            }}
          >
            New subfolder
          </button>
          <button
            type="button"
            onClick={() => {
              setRenameFolder(ctx.folder);
              setNewFolderName(ctx.folder.name);
              setCtx(null);
            }}
          >
            Rename
          </button>
          {!ctx.folder.isSystem ? (
            <button
              type="button"
              className={styles.danger}
              onClick={async () => {
                if (!window.confirm("Delete this folder?")) return;
                await fetch(apiUrl(`/files/folders/${ctx.folder.id}`), {
                  method: "DELETE",
                  headers: { ...authHeaders() },
                });
                setCtx(null);
                void loadTree();
              }}
            >
              Delete
            </button>
          ) : null}
        </div>
      ) : null}

      {newFolderOpen || renameFolder ? (
        <div
          className={styles.modalBackdrop}
          onClick={() => {
            setNewFolderOpen(false);
            setRenameFolder(null);
            setNewFolderParentId(null);
          }}
        >
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2>{renameFolder ? "Rename folder" : "New folder"}</h2>
            <input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Folder name"
              style={{ width: "100%", padding: "0.5rem", boxSizing: "border-box" }}
            />
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.ghostBtn}
                onClick={() => {
                  setNewFolderOpen(false);
                  setRenameFolder(null);
                  setNewFolderParentId(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={async () => {
                  if (!newFolderName.trim()) return;
                  if (renameFolder) {
                    await fetch(apiUrl(`/files/folders/${renameFolder.id}`), {
                      method: "PUT",
                      headers: { "Content-Type": "application/json", ...authHeaders() },
                      body: JSON.stringify({ name: newFolderName.trim() }),
                    });
                  } else {
                  const parent = newFolderParentId ?? selectedFolderId;
                  if (parent == null) return;
                    await fetch(apiUrl("/files/folders"), {
                      method: "POST",
                      headers: { "Content-Type": "application/json", ...authHeaders() },
                      body: JSON.stringify({ name: newFolderName.trim(), parentFolderId: parent, icon: "📁" }),
                    });
                  }
                  setNewFolderOpen(false);
                  setRenameFolder(null);
                  setNewFolderParentId(null);
                  void loadTree();
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {uploadOpen ? (
        <div className={styles.modalBackdrop} onClick={() => setUploadOpen(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2>Upload files</h2>
            <input
              type="file"
              multiple
              onChange={(e) => onPickFiles(e.target.files)}
            />
            {uploadQueue.map((u, idx) => (
              <div key={`${u.file.name}-${idx}`} className={styles.uploadRow}>
                <strong>{u.file.name}</strong> ({fmtBytes(u.file.size)})
                <input
                  placeholder="Description (optional)"
                  value={u.description}
                  onChange={(e) => {
                    const v = e.target.value;
                    setUploadQueue((q) => {
                      const c = [...q];
                      c[idx] = { ...c[idx], description: v };
                      return c;
                    });
                  }}
                />
                <input
                  placeholder="Tags, comma-separated"
                  value={u.tags}
                  onChange={(e) => {
                    const v = e.target.value;
                    setUploadQueue((q) => {
                      const c = [...q];
                      c[idx] = { ...c[idx], tags: v };
                      return c;
                    });
                  }}
                />
                <div className={styles.progress}>
                  <span style={{ width: `${Math.max(0, u.progress)}%` }} />
                </div>
              </div>
            ))}
            <div className={styles.modalActions}>
              <button type="button" className={styles.ghostBtn} onClick={() => setUploadOpen(false)}>
                Cancel
              </button>
              <button type="button" className={styles.primaryBtn} onClick={() => void runUploadAll()}>
                Upload all
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
