"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiUrl } from "../../../../lib/api";
import { formatDuration, timestampLabel, type VideoCommentRow, type VideoRow } from "../../../../lib/videos";
import { useAuth } from "../../../../context/AuthContext";
import styles from "../videos.module.css";

function parseTranscript(transcript: string) {
  return transcript.split(/\n+/).filter(Boolean);
}

function parseTimestampFromText(text: string): number | null {
  const match = text.match(/\[(\d{2}):(\d{2})\]/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export default function VideoDetailClient({ videoId }: { videoId: number }) {
  const router = useRouter();
  const { authHeaders, user, isAdmin } = useAuth();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [video, setVideo] = useState<VideoRow | null>(null);
  const [comments, setComments] = useState<VideoCommentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState("");
  const [commentAtCurrent, setCommentAtCurrent] = useState(true);
  const [transcriptSearch, setTranscriptSearch] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [shareBusy, setShareBusy] = useState(false);

  const canManage = useMemo(() => {
    if (!video || !user) return false;
    return isAdmin || user.id === video.recordedBy;
  }, [isAdmin, user, video]);

  const loadVideo = useCallback(async () => {
    setLoading(true);
    const res = await fetch(apiUrl(`/videos/${videoId}`), {
      headers: { ...authHeaders() },
      cache: "no-store",
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.video) {
      setVideo(body.video);
      setTitle(body.video.title || "");
      setDescription(body.video.description || "");
    }
    setLoading(false);
  }, [authHeaders, videoId]);

  const loadComments = useCallback(async () => {
    const res = await fetch(apiUrl(`/videos/${videoId}/comments`), {
      headers: { ...authHeaders() },
      cache: "no-store",
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(body.comments)) setComments(body.comments);
  }, [authHeaders, videoId]);

  useEffect(() => {
    loadVideo();
    loadComments();
  }, [loadVideo, loadComments]);

  const saveMetadata = async () => {
    if (!video) return;
    const res = await fetch(apiUrl(`/videos/${video.id}`), {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ title, description }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.video) setVideo(body.video);
  };

  const toggleShare = async () => {
    if (!video) return;
    setShareBusy(true);
    if (video.visibility === "shared") {
      await fetch(apiUrl(`/videos/${video.id}/share`), { method: "DELETE", headers: { ...authHeaders() } });
      await loadVideo();
      setShareBusy(false);
      return;
    }
    const res = await fetch(apiUrl(`/videos/${video.id}/share`), { method: "POST", headers: { ...authHeaders() } });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      setVideo((prev) => (prev ? { ...prev, visibility: "shared", shareUrl: body.shareUrl, shareToken: body.shareToken } : prev));
    }
    setShareBusy(false);
  };

  const copyShareLink = async () => {
    if (!video?.shareUrl) return;
    await navigator.clipboard.writeText(video.shareUrl);
  };

  const removeVideo = async () => {
    if (!video) return;
    if (!window.confirm("Delete this video permanently?")) return;
    const res = await fetch(apiUrl(`/videos/${video.id}`), { method: "DELETE", headers: { ...authHeaders() } });
    if (res.ok) router.push("/videos");
  };

  const addComment = async () => {
    if (!video || !commentText.trim()) return;
    const timestampSeconds =
      commentAtCurrent && videoRef.current ? Math.floor(videoRef.current.currentTime || 0) : null;
    const res = await fetch(apiUrl(`/videos/${video.id}/comments`), {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ comment: commentText.trim(), timestamp_seconds: timestampSeconds }),
    });
    if (res.ok) {
      setCommentText("");
      loadComments();
    }
  };

  const transcriptLines = useMemo(() => {
    if (!video?.transcript) return [];
    return parseTranscript(video.transcript).filter((line) =>
      transcriptSearch.trim()
        ? line.toLowerCase().includes(transcriptSearch.trim().toLowerCase())
        : true
    );
  }, [transcriptSearch, video?.transcript]);

  const jumpTo = (seconds: number | null) => {
    if (seconds == null || !videoRef.current) return;
    videoRef.current.currentTime = seconds;
    videoRef.current.play().catch(() => {});
  };

  if (loading || !video) {
    return <main className={styles.page}>Loading video...</main>;
  }

  return (
    <main className={styles.detailPage}>
      <div className={styles.detailHeader}>
        {canManage ? (
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={styles.titleInput} maxLength={255} />
        ) : (
          <h1>{video.title}</h1>
        )}
        <p>
          Recorded by {video.recordedByName} · {new Date(video.createdAt).toLocaleString()} · {formatDuration(video.durationSeconds)} ·{" "}
          {video.viewsCount} views
        </p>
      </div>

      <video ref={videoRef} controls className={styles.player} src={apiUrl(`/videos/${video.id}/stream`)} />

      <section className={styles.detailActions}>
        {canManage ? (
          <>
            <textarea
              className={styles.descriptionInput}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Description"
            />
            <button type="button" onClick={saveMetadata}>
              Save Details
            </button>
            <button type="button" onClick={toggleShare} disabled={shareBusy}>
              {video.visibility === "shared" ? "Revoke Link" : "Create Share Link"}
            </button>
            {video.shareUrl ? (
              <div className={styles.shareBox}>
                <input value={video.shareUrl} readOnly />
                <button type="button" onClick={copyShareLink}>
                  Copy Link
                </button>
              </div>
            ) : null}
            <button type="button" className={styles.deleteBtn} onClick={removeVideo}>
              Delete Video
            </button>
          </>
        ) : (
          <p>{video.description || "No description provided."}</p>
        )}
      </section>

      <section className={styles.transcriptSection}>
        <h2>Transcript</h2>
        {video.transcriptStatus === "pending" || video.transcriptStatus === "processing" ? (
          <p>Transcribing...</p>
        ) : null}
        {video.transcriptStatus === "failed" ? <p>Transcription failed.</p> : null}
        {video.transcript ? (
          <>
            <input
              value={transcriptSearch}
              onChange={(e) => setTranscriptSearch(e.target.value)}
              placeholder="Search transcript"
              className={styles.transcriptSearch}
            />
            <div className={styles.transcriptBody}>
              {transcriptLines.map((line, index) => {
                const timestamp = parseTimestampFromText(line);
                return (
                  <p key={`${index}-${line.slice(0, 20)}`}>
                    {timestamp != null ? (
                      <button type="button" onClick={() => jumpTo(timestamp)} className={styles.timestampBtn}>
                        {timestampLabel(timestamp)}
                      </button>
                    ) : null}{" "}
                    {line}
                  </p>
                );
              })}
            </div>
          </>
        ) : null}
      </section>

      <section className={styles.commentsSection}>
        <h2>Comments</h2>
        <div className={styles.commentComposer}>
          <textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Add a comment"
            rows={3}
          />
          <label className={styles.inlineCheck}>
            <input
              type="checkbox"
              checked={commentAtCurrent}
              onChange={(e) => setCommentAtCurrent(e.target.checked)}
            />
            At current playback time
          </label>
          <button type="button" onClick={addComment}>
            Add Comment
          </button>
        </div>
        <div className={styles.commentList}>
          {comments.map((comment) => (
            <article key={comment.id} className={styles.commentItem}>
              <div>
                <strong>{comment.displayName}</strong> · {new Date(comment.createdAt).toLocaleString()}
              </div>
              {comment.timestampSeconds != null ? (
                <button type="button" onClick={() => jumpTo(comment.timestampSeconds)} className={styles.timestampBtn}>
                  {timestampLabel(comment.timestampSeconds)}
                </button>
              ) : null}
              <p>{comment.comment}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
