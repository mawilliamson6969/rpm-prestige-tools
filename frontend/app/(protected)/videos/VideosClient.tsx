"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../context/AuthContext";
import { apiUrl } from "../../../lib/api";
import {
  avatarInitials,
  flattenFolderTree,
  folderBreadcrumbPath,
  formatDuration,
  relativeTime,
  type VideoFolderNode,
  type VideoRow,
} from "../../../lib/videos";
import VideoRecorderModal from "./VideoRecorderModal";
import styles from "./videos.module.css";

type SortOption = "newest" | "oldest" | "most_viewed";
type FilterOption = "all" | "my" | "shared";

type FolderScope = { kind: "all" } | { kind: "unfiled" } | { kind: "folder"; id: number };

export default function VideosClient() {
  const router = useRouter();
  const { authHeaders, user } = useAuth();
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterOption>("all");
  const [sort, setSort] = useState<SortOption>("newest");
  const [recorderOpen, setRecorderOpen] = useState(false);
  const [folderScope, setFolderScope] = useState<FolderScope>({ kind: "all" });
  const [folders, setFolders] = useState<VideoFolderNode[]>([]);
  const [unfiledVideoCount, setUnfiledVideoCount] = useState(0);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; folderId: number } | null>(null);
  const [moveMenuVideoId, setMoveMenuVideoId] = useState<number | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<number | "unfiled" | "all" | null>(null);
  const [allVideosTotal, setAllVideosTotal] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const loadFolders = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/videos/folders"), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setFolders(Array.isArray(body.folders) ? body.folders : []);
        setUnfiledVideoCount(typeof body.unfiledVideoCount === "number" ? body.unfiledVideoCount : 0);
      }
    } catch {
      setFolders([]);
    }
  }, [authHeaders]);

  const refreshAllVideosTotal = useCallback(async () => {
    try {
      const res = await fetch(apiUrl(`/videos?limit=1&offset=0&sort=newest&filter=all`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && typeof body.total === "number") setAllVideosTotal(body.total);
    } catch {
      /* ignore */
    }
  }, [authHeaders]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    p.set("limit", "36");
    p.set("offset", "0");
    p.set("sort", sort);
    p.set("filter", filter);
    if (search) p.set("search", search);
    if (folderScope.kind === "unfiled") p.set("unfiled", "1");
    if (folderScope.kind === "folder") p.set("folderId", String(folderScope.id));
    return p.toString();
  }, [filter, folderScope, search, sort]);

  const loadVideos = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl(`/videos?${query}`), {
        headers: { ...authHeaders() },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not load videos.");
      setVideos(Array.isArray(body.videos) ? body.videos : []);
      setTotal(typeof body.total === "number" ? body.total : 0);
    } catch {
      setVideos([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, query]);

  useEffect(() => {
    loadFolders();
  }, [loadFolders]);

  useEffect(() => {
    loadVideos();
  }, [loadVideos]);

  useEffect(() => {
    void refreshAllVideosTotal();
  }, [refreshAllVideosTotal]);

  useEffect(() => {
    if (!moveMenuVideoId) return;
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest?.("[data-video-move-menu]")) return;
      setMoveMenuVideoId(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [moveMenuVideoId]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest?.("[data-folder-context-menu]")) return;
      setContextMenu(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [contextMenu]);

  const moveVideoToFolder = useCallback(
    async (videoId: number, folderId: number | null) => {
      const res = await fetch(apiUrl(`/videos/${videoId}/move`), {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ folderId }),
      });
      if (res.ok) {
        setMoveMenuVideoId(null);
        await loadFolders();
        await loadVideos();
        await refreshAllVideosTotal();
      }
    },
    [authHeaders, loadFolders, loadVideos, refreshAllVideosTotal]
  );

  const onUploaded = useCallback(
    (videoId: number) => {
      setRecorderOpen(false);
      router.push(`/videos/${videoId}`);
    },
    [router]
  );

  const toggleExpand = (id: number) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const breadcrumbParts = useMemo(() => {
    if (folderScope.kind === "all") return [];
    if (folderScope.kind === "unfiled") return ["Unfiled"];
    const path = folderBreadcrumbPath(folders, folderScope.id);
    return path || ["Folder"];
  }, [folderScope, folders]);

  const defaultFolderIdForRecorder =
    folderScope.kind === "folder" && folderScope.id > 0 ? folderScope.id : null;

  const flatFolders = useMemo(() => flattenFolderTree(folders), [folders]);

  const onFolderContextMenu = (e: React.MouseEvent, folderId: number) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, folderId });
  };

  const renameFolder = async (folderId: number) => {
    const name = window.prompt("Folder name");
    if (!name?.trim()) return;
    await fetch(apiUrl(`/videos/folders/${folderId}`), {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim().slice(0, 255) }),
    });
    setContextMenu(null);
    loadFolders();
  };

  const deleteFolder = async (folderId: number) => {
    if (!window.confirm("Delete this folder? Videos will move to the parent level or stay unfiled.")) return;
    await fetch(apiUrl(`/videos/folders/${folderId}`), { method: "DELETE", headers: { ...authHeaders() } });
    setContextMenu(null);
    if (folderScope.kind === "folder" && folderScope.id === folderId) setFolderScope({ kind: "all" });
    loadFolders();
    loadVideos();
  };

  const newSubfolder = async (parentFolderId: number) => {
    const name = window.prompt("New subfolder name");
    if (!name?.trim()) return;
    await fetch(apiUrl("/videos/folders"), {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim().slice(0, 255), parentFolderId }),
    });
    setContextMenu(null);
    setExpanded((prev) => ({ ...prev, [parentFolderId]: true }));
    loadFolders();
  };

  const createRootFolder = async () => {
    const name = window.prompt("New folder name");
    if (!name?.trim()) return;
    await fetch(apiUrl("/videos/folders"), {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim().slice(0, 255) }),
    });
    loadFolders();
  };

  const renderFolderNodes = (nodes: VideoFolderNode[], depth: number) => {
    return nodes.map((node) => {
      const hasChildren = node.children && node.children.length > 0;
      const isOpen = expanded[node.id] ?? false;
      const isActive = folderScope.kind === "folder" && folderScope.id === node.id;
      const dropHighlight = dragOverFolderId === node.id;
      return (
        <div key={node.id} className={depth > 0 ? styles.folderIndent : undefined}>
          <div
            className={`${styles.folderNavBtn} ${isActive ? styles.folderNavActive : ""} ${dropHighlight ? styles.folderDropTarget : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverFolderId(node.id);
            }}
            onDragLeave={() => setDragOverFolderId(null)}
            onDrop={(e) => {
              e.preventDefault();
              const vid = Number(e.dataTransfer.getData("text/video-id"));
              setDragOverFolderId(null);
              if (Number.isFinite(vid)) void moveVideoToFolder(vid, node.id);
            }}
          >
            <button
              type="button"
              className={styles.folderChevron}
              aria-label={isOpen ? "Collapse" : "Expand"}
              onClick={(e) => {
                e.stopPropagation();
                if (hasChildren) toggleExpand(node.id);
              }}
              style={{ visibility: hasChildren ? "visible" : "hidden" }}
            >
              {hasChildren ? (isOpen ? "▼" : "▶") : ""}
            </button>
            <div
              role="button"
              tabIndex={0}
              style={{ flex: 1, textAlign: "left", cursor: "pointer" }}
              onClick={() => {
                setFolderScope({ kind: "folder", id: node.id });
                setSidebarMobileOpen(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setFolderScope({ kind: "folder", id: node.id });
                  setSidebarMobileOpen(false);
                }
              }}
              onContextMenu={(e) => onFolderContextMenu(e, node.id)}
            >
              {node.name}
            </div>
            <span className={styles.folderBadge}>{node.videoCount}</span>
          </div>
          {hasChildren && isOpen ? renderFolderNodes(node.children, depth + 1) : null}
        </div>
      );
    });
  };

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <h1>Video Messages</h1>
          <p>Record, transcribe, and share async updates with your team.</p>
        </div>
        <button type="button" className={styles.btnPrimary} onClick={() => setRecorderOpen(true)}>
          <span aria-hidden>🔴</span> Record Video
        </button>
      </header>

      <button
        type="button"
        className={`${styles.btnSecondary} ${styles.sidebarToggle}`}
        onClick={() => setSidebarMobileOpen((o) => !o)}
        aria-expanded={sidebarMobileOpen}
      >
        {sidebarMobileOpen ? "Hide folders" : "Folders"}
      </button>

      <div className={styles.libraryLayout}>
        <aside className={`${styles.sidebar} ${sidebarMobileOpen ? styles.sidebarMobileOpen : ""}`}>
          <button
            type="button"
            className={`${styles.folderNavBtn} ${folderScope.kind === "all" ? styles.folderNavActive : ""} ${dragOverFolderId === "all" ? styles.folderDropTarget : ""}`}
            onClick={() => {
              setFolderScope({ kind: "all" });
              setSidebarMobileOpen(false);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverFolderId("all");
            }}
            onDragLeave={() => setDragOverFolderId(null)}
            onDrop={(e) => {
              e.preventDefault();
              const vid = Number(e.dataTransfer.getData("text/video-id"));
              setDragOverFolderId(null);
              if (Number.isFinite(vid)) void moveVideoToFolder(vid, null);
            }}
          >
            <span style={{ flex: 1 }}>All Videos</span>
            <span className={styles.folderBadge}>{allVideosTotal || total}</span>
          </button>
          <button
            type="button"
            className={`${styles.folderNavBtn} ${folderScope.kind === "unfiled" ? styles.folderNavActive : ""} ${dragOverFolderId === "unfiled" ? styles.folderDropTarget : ""}`}
            onClick={() => {
              setFolderScope({ kind: "unfiled" });
              setSidebarMobileOpen(false);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverFolderId("unfiled");
            }}
            onDragLeave={() => setDragOverFolderId(null)}
            onDrop={(e) => {
              e.preventDefault();
              const vid = Number(e.dataTransfer.getData("text/video-id"));
              setDragOverFolderId(null);
              if (Number.isFinite(vid)) void moveVideoToFolder(vid, null);
            }}
          >
            <span style={{ flex: 1 }}>Unfiled</span>
            <span className={styles.folderBadge}>{unfiledVideoCount}</span>
          </button>
          {renderFolderNodes(folders, 0)}
          <button type="button" className={`${styles.btnPrimary}`} style={{ width: "100%", marginTop: "0.5rem" }} onClick={createRootFolder}>
            New Folder
          </button>
        </aside>

        <div className={styles.libraryMain}>
          {folderScope.kind !== "all" ? (
            <nav className={styles.breadcrumb} aria-label="Folder path">
              <button type="button" onClick={() => setFolderScope({ kind: "all" })}>
                All Videos
              </button>
              {breadcrumbParts.map((part, idx) => (
                <span key={`${part}-${idx}`}>
                  <span aria-hidden> &gt; </span>
                  {idx === breadcrumbParts.length - 1 ? <strong>{part}</strong> : <span>{part}</span>}
                </span>
              ))}
            </nav>
          ) : null}

          <section className={styles.toolbar}>
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search videos by title or transcript..."
              aria-label="Search videos"
            />
            <select value={filter} onChange={(e) => setFilter(e.target.value as FilterOption)} aria-label="Filter videos">
              <option value="all">All</option>
              <option value="my">My Videos</option>
              <option value="shared">Shared with Me</option>
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortOption)} aria-label="Sort videos">
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="most_viewed">Most Viewed</option>
            </select>
          </section>

          {loading ? <div className={styles.emptyState}>Loading videos...</div> : null}
          {!loading && videos.length === 0 ? <div className={styles.emptyState}>No videos found.</div> : null}

          <section className={styles.videoGrid}>
            {videos.map((video) => (
              <div
                key={video.id}
                className={styles.videoCardWrap}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/video-id", String(video.id));
                  e.dataTransfer.effectAllowed = "move";
                }}
              >
                <div className={styles.cardMenuRow}>
                  <div className={styles.cardMenuHost} data-video-move-menu>
                    <button
                      type="button"
                      className={styles.btnKebab}
                      aria-label="Video actions"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setMoveMenuVideoId((id) => (id === video.id ? null : video.id));
                      }}
                    >
                      ⋮
                    </button>
                    {moveMenuVideoId === video.id ? (
                      <div className={styles.moveMenu} role="menu" data-video-move-menu>
                        <div style={{ padding: "0.25rem 0.65rem", fontSize: "0.75rem", color: "#6a737b" }}>Move to folder</div>
                        <button type="button" onClick={() => moveVideoToFolder(video.id, null)}>
                          Unfiled
                        </button>
                        {flatFolders.map((f) => (
                          <button
                            key={f.id}
                            type="button"
                            style={{ paddingLeft: `${0.75 + f.depth * 0.65}rem` }}
                            onClick={() => moveVideoToFolder(video.id, f.id)}
                          >
                            {f.name}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                <Link href={`/videos/${video.id}`} className={styles.videoCard}>
                  <div className={styles.thumbWrap}>
                    <img
                      src={apiUrl(`/videos/${video.id}/thumbnail`)}
                      alt=""
                      className={styles.thumb}
                      loading="lazy"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).src = "/icons/icon-512.png";
                      }}
                    />
                    <span className={styles.playBadge}>▶</span>
                    <span className={styles.durationBadge}>{formatDuration(video.durationSeconds)}</span>
                  </div>
                  <div className={styles.cardBody}>
                    <h3>{video.title}</h3>
                    <div className={styles.metaRow}>
                      <span className={styles.avatar}>{avatarInitials(video.recordedByName)}</span>
                      <span>{video.recordedByName}</span>
                      {video.visibility === "shared" ? <span title="Shared">🔗</span> : null}
                    </div>
                    <p className={styles.metaInfo}>
                      {relativeTime(video.createdAt)} · {video.viewsCount} views
                      {user?.id === video.recordedBy ? " · You" : ""}
                    </p>
                  </div>
                </Link>
              </div>
            ))}
          </section>

          <footer className={styles.libraryFooter}>{total} video(s) in this view</footer>
        </div>
      </div>

      {contextMenu ? (
        <div
          className={styles.contextMenu}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          data-folder-context-menu
        >
          <button type="button" onClick={() => renameFolder(contextMenu.folderId)}>
            Rename
          </button>
          <button type="button" onClick={() => deleteFolder(contextMenu.folderId)}>
            Delete
          </button>
          <button type="button" onClick={() => newSubfolder(contextMenu.folderId)}>
            New Subfolder
          </button>
        </div>
      ) : null}

      <VideoRecorderModal
        open={recorderOpen}
        onClose={() => setRecorderOpen(false)}
        onUploaded={onUploaded}
        defaultFolderId={defaultFolderIdForRecorder}
      />
    </main>
  );
}
