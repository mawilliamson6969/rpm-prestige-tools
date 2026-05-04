"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../context/AuthContext";
import { apiUrl, apiUrlWithAuthQuery } from "../../../lib/api";
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
type HomeView = "recent" | "mine" | "shared" | "organize";
type FolderScope = { kind: "all" } | { kind: "unfiled" } | { kind: "folder"; id: number };

function statusTone(video: VideoRow) {
  if (video.processingStatus === "error" || video.transcriptStatus === "failed") return "danger";
  if (video.processingStatus === "ffmpeg" || video.transcriptStatus === "pending" || video.transcriptStatus === "processing") {
    return "warning";
  }
  if (video.transcriptStatus === "completed") return "success";
  return "neutral";
}

function statusLabel(video: VideoRow) {
  if (video.processingStatus === "error") return "Processing failed";
  if (video.processingStatus === "ffmpeg") return "Processing";
  if (video.transcriptStatus === "processing" || video.transcriptStatus === "pending") return "Transcribing";
  if (video.transcriptStatus === "completed") return "Transcript ready";
  if (video.visibility === "shared") return "Shared";
  return "Private";
}

function recordingTypeLabel(type: VideoRow["recordingType"]) {
  if (type === "screen") return "Screen";
  if (type === "webcam") return "Webcam";
  if (type === "both") return "Screen + webcam";
  return "Video";
}

export default function VideosClient() {
  const router = useRouter();
  const { authHeaders, user, token } = useAuth();
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<HomeView>("recent");
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
  const [folderPanelOpen, setFolderPanelOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filter: FilterOption = useMemo(() => {
    if (view === "mine") return "my";
    if (view === "shared") return "shared";
    return "all";
  }, [view]);

  useEffect(() => {
    if (view === "recent") setSort("newest");
  }, [view]);

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
      const res = await fetch(apiUrl("/videos?limit=1&offset=0&sort=newest&filter=all"), {
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
    if (view === "organize") setFolderPanelOpen(true);
  }, [view]);

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
    const res = await fetch(apiUrl("/videos/folders"), {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim().slice(0, 255), parentFolderId }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      window.alert(typeof body.error === "string" ? body.error : `Could not create folder (${res.status}).`);
      return;
    }
    setContextMenu(null);
    setExpanded((prev) => ({ ...prev, [parentFolderId]: true }));
    await loadFolders();
  };

  const createRootFolder = async () => {
    const name = window.prompt("New folder name");
    if (!name?.trim()) return;
    const res = await fetch(apiUrl("/videos/folders"), {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim().slice(0, 255) }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      window.alert(typeof body.error === "string" ? body.error : `Could not create folder (${res.status}).`);
      return;
    }
    await loadFolders();
    setFolderPanelOpen(true);
  };

  const renderFolderNodes = (nodes: VideoFolderNode[], depth: number) =>
    nodes.map((node) => {
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

  const featuredVideo = videos[0] ?? null;
  const folderCount = flatFolders.length;
  const transcriptReadyCount = videos.filter((video) => video.transcriptStatus === "completed").length;
  const sharedCount = videos.filter((video) => video.visibility === "shared").length;

  const viewLabel =
    view === "mine" ? "My videos" : view === "shared" ? "Shared with me" : view === "organize" ? "Organize library" : "Recent videos";

  const emptyCopy =
    search || folderScope.kind !== "all"
      ? "No videos match this view yet."
      : view === "mine"
        ? "You haven't recorded any videos yet."
        : view === "shared"
          ? "Nothing has been shared with you yet."
          : "No videos yet. Record the first one to get this space moving.";

  return (
    <main className={styles.page}>
      <section className={styles.libraryHero}>
        <div className={styles.libraryHeroMain}>
          <span className={styles.heroEyebrow}>Async video workspace</span>
          <h1>Video Messages</h1>
          <p>
            Record updates fast, find the right clip without digging, and keep the library organized only when you need
            to.
          </p>
          <div className={styles.heroActions}>
            <button type="button" className={styles.btnPrimary} onClick={() => setRecorderOpen(true)}>
              <span aria-hidden>🔴</span> Record Video
            </button>
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={() => setFolderPanelOpen((open) => !open)}
              aria-expanded={folderPanelOpen}
            >
              {folderPanelOpen ? "Hide folders" : "Organize folders"}
            </button>
          </div>
        </div>

        <div className={styles.heroStats}>
          <article className={styles.heroStatCard}>
            <span>Total library</span>
            <strong>{allVideosTotal || total}</strong>
            <small>All recorded videos</small>
          </article>
          <article className={styles.heroStatCard}>
            <span>This view</span>
            <strong>{total}</strong>
            <small>{viewLabel}</small>
          </article>
          <article className={styles.heroStatCard}>
            <span>Unfiled</span>
            <strong>{unfiledVideoCount}</strong>
            <small>Ready to organize</small>
          </article>
          <article className={styles.heroStatCard}>
            <span>Folders</span>
            <strong>{folderCount}</strong>
            <small>Library structure</small>
          </article>
        </div>
      </section>

      <section className={styles.viewTabs} aria-label="Video views">
        {([
          ["recent", "Recent"],
          ["mine", "My videos"],
          ["shared", "Shared with me"],
          ["organize", "Organize"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`${styles.viewTab} ${view === id ? styles.viewTabActive : ""}`}
            onClick={() => setView(id)}
          >
            {label}
          </button>
        ))}
      </section>

      <div className={styles.libraryLayout}>
        <aside
          className={`${styles.sidebar} ${folderPanelOpen ? styles.sidebarOpen : ""} ${sidebarMobileOpen ? styles.sidebarMobileOpen : ""}`}
        >
          <div className={styles.sidebarHeader}>
            <div>
              <strong>Folders</strong>
              <p>Drag videos here when you want to tidy the library.</p>
            </div>
            <button type="button" className={styles.btnSecondary} onClick={createRootFolder}>
              New
            </button>
          </div>

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
        </aside>

        <div className={styles.libraryMain}>
          <div className={styles.libraryTopRow}>
            <div>
              <h2>{viewLabel}</h2>
              <p className={styles.sectionSubtle}>
                {folderScope.kind === "all"
                  ? "Start with the videos that need attention, then organize only when it helps."
                  : "You’re browsing a focused folder view."}
              </p>
            </div>
            <button
              type="button"
              className={`${styles.btnSecondary} ${styles.sidebarToggle}`}
              onClick={() => setSidebarMobileOpen((o) => !o)}
              aria-expanded={sidebarMobileOpen}
            >
              {sidebarMobileOpen ? "Hide folders" : "Folders"}
            </button>
          </div>

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

          <section className={styles.toolbarShell}>
            <div className={styles.toolbarMeta}>
              <span className={styles.toolbarChip}>{transcriptReadyCount} transcript-ready</span>
              <span className={styles.toolbarChip}>{sharedCount} shared</span>
              <span className={styles.toolbarChip}>
                {folderScope.kind === "folder" ? "Drop cards here to move them" : "Search title or transcript"}
              </span>
            </div>

            <section className={styles.toolbar}>
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search videos by title or transcript..."
                aria-label="Search videos"
              />
              <select value={filter} disabled aria-label="Filter videos">
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
          </section>

          {!loading && featuredVideo ? (
            <Link href={`/videos/${featuredVideo.id}`} className={styles.featuredCard}>
              <div className={styles.featuredMedia}>
                <img
                  src={apiUrlWithAuthQuery(`/videos/${featuredVideo.id}/thumbnail`, token)}
                  alt=""
                  className={styles.featuredThumb}
                  loading="lazy"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).src = "/icons/icon-512.png";
                  }}
                />
                <span className={styles.featuredPlay}>▶ Watch</span>
              </div>
              <div className={styles.featuredBody}>
                <div className={styles.featuredMetaRow}>
                  <span className={`${styles.statusBadge} ${styles[`status${statusTone(featuredVideo)[0].toUpperCase()}${statusTone(featuredVideo).slice(1)}`]}`}>
                    {statusLabel(featuredVideo)}
                  </span>
                  <span>{recordingTypeLabel(featuredVideo.recordingType)}</span>
                  <span>{formatDuration(featuredVideo.durationSeconds)}</span>
                </div>
                <h3>{featuredVideo.title}</h3>
                <p>{featuredVideo.description || "No description yet. Open the video to add context and comments."}</p>
                <div className={styles.featuredFooter}>
                  <span className={styles.metaRow}>
                    <span className={styles.avatar}>{avatarInitials(featuredVideo.recordedByName)}</span>
                    <span>{featuredVideo.recordedByName}</span>
                  </span>
                  <span className={styles.metaInfo}>
                    {relativeTime(featuredVideo.createdAt)} · {featuredVideo.viewsCount} views
                    {user?.id === featuredVideo.recordedBy ? " · You" : ""}
                  </span>
                </div>
              </div>
            </Link>
          ) : null}

          {loading ? <div className={styles.emptyState}>Loading videos...</div> : null}
          {!loading && videos.length === 0 ? <div className={styles.emptyState}>{emptyCopy}</div> : null}

          <section className={styles.videoGrid}>
            {videos.map((video) => {
              const tone = statusTone(video);
              const toneClass = styles[`status${tone[0].toUpperCase()}${tone.slice(1)}`];
              return (
                <div
                  key={video.id}
                  className={styles.videoCardWrap}
                  draggable={folderPanelOpen || view === "organize"}
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
                          <div className={styles.menuLabel}>Move to folder</div>
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
                        src={apiUrlWithAuthQuery(`/videos/${video.id}/thumbnail`, token)}
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
                      <div className={styles.cardBadgeRow}>
                        <span className={`${styles.statusBadge} ${toneClass}`}>{statusLabel(video)}</span>
                        <span className={styles.cardTypeBadge}>{recordingTypeLabel(video.recordingType)}</span>
                      </div>
                      <h3>{video.title}</h3>
                      <p className={styles.cardDescription}>
                        {video.description || "Open the video to add a short summary and make it easier to scan later."}
                      </p>
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
              );
            })}
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
