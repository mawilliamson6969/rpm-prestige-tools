"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../context/AuthContext";
import { apiUrl } from "../../../lib/api";
import { avatarInitials, formatDuration, relativeTime, type VideoRow } from "../../../lib/videos";
import VideoRecorderModal from "./VideoRecorderModal";
import styles from "./videos.module.css";

type SortOption = "newest" | "oldest" | "most_viewed";
type FilterOption = "all" | "my" | "shared";

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

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    p.set("limit", "36");
    p.set("offset", "0");
    p.set("sort", sort);
    p.set("filter", filter);
    if (search) p.set("search", search);
    return p.toString();
  }, [filter, search, sort]);

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
    loadVideos();
  }, [loadVideos]);

  const onUploaded = useCallback(
    (videoId: number) => {
      setRecorderOpen(false);
      router.push(`/videos/${videoId}`);
    },
    [router]
  );

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <h1>Video Messages</h1>
          <p>Record, transcribe, and share async updates with your team.</p>
        </div>
        <button type="button" className={styles.recordBtn} onClick={() => setRecorderOpen(true)}>
          <span aria-hidden>🔴</span> Record Video
        </button>
      </header>

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
          <Link key={video.id} href={`/videos/${video.id}`} className={styles.videoCard}>
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
        ))}
      </section>

      <footer className={styles.libraryFooter}>{total} total video messages</footer>

      <VideoRecorderModal open={recorderOpen} onClose={() => setRecorderOpen(false)} onUploaded={onUploaded} />
    </main>
  );
}
