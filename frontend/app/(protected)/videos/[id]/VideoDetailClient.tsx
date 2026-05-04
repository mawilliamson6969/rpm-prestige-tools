"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiUrl, apiUrlWithAuthQuery } from "../../../../lib/api";
import { formatDuration, timestampLabel, type VideoCommentRow, type VideoRow } from "../../../../lib/videos";
import { useAuth } from "../../../../context/AuthContext";
import styles from "../videos.module.css";

type DetailTab = "transcript" | "comments" | "details";

function parseTranscript(transcript: string) {
  return transcript.split(/\n+/).filter(Boolean);
}

function parseTimestampFromText(text: string): number | null {
  const match = text.match(/\[(\d{2}):(\d{2})\]/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function statusLabel(video: VideoRow) {
  if (video.processingStatus === "error") return "Processing failed";
  if (video.processingStatus === "ffmpeg") return "Processing";
  if (video.transcriptStatus === "processing" || video.transcriptStatus === "pending") return "Transcribing";
  if (video.transcriptStatus === "completed") return "Transcript ready";
  if (video.visibility === "shared") return "Shared";
  return "Private";
}

function statusTone(video: VideoRow) {
  if (video.processingStatus === "error" || video.transcriptStatus === "failed") return "danger";
  if (video.processingStatus === "ffmpeg" || video.transcriptStatus === "processing" || video.transcriptStatus === "pending") {
    return "warning";
  }
  if (video.transcriptStatus === "completed") return "success";
  return "neutral";
}

export default function VideoDetailClient({ videoId }: { videoId: number }) {
  const router = useRouter();
  const { authHeaders, user, isAdmin, token } = useAuth();
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
  const [activeTab, setActiveTab] = useState<DetailTab>("transcript");

  const canManage = useMemo(() => {
    if (!video || !user) return false;
    return isAdmin || user.id === video.recordedBy;
  }, [isAdmin, user, video]);

  const loadVideo = useCallback(async () => {
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
    let cancelled = false;
    (async () => {
      setLoading(true);
      await loadVideo();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadVideo]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  useEffect(() => {
    if (!video) return;
    const processing =
      video.processingStatus === "ffmpeg" ||
      video.transcriptStatus === "pending" ||
      video.transcriptStatus === "processing";
    if (!processing && video.processingStatus !== "error") return;
    const id = setInterval(() => {
      void loadVideo();
    }, 2000);
    return () => clearInterval(id);
  }, [loadVideo, video]);

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
      setVideo((prev) =>
        prev ? { ...prev, visibility: "shared", shareUrl: body.shareUrl, shareToken: body.shareToken } : prev
      );
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
      setActiveTab("comments");
    }
  };

  const transcriptLines = useMemo(() => {
    if (!video?.transcript) return [];
    return parseTranscript(video.transcript).filter((line) =>
      transcriptSearch.trim() ? line.toLowerCase().includes(transcriptSearch.trim().toLowerCase()) : true
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

  const transcriptStatusMessage =
    video.processingStatus === "error" ? (
      <p>Video processing failed.</p>
    ) : video.processingStatus === "ffmpeg" ? (
      <p>Processing video...</p>
    ) : video.transcriptStatus === "failed" ? (
      <p>Transcription failed.</p>
    ) : video.transcriptStatus === "unavailable" ? (
      <p>Transcription will be available in a future update.</p>
    ) : video.transcriptStatus === "processing" || video.transcriptStatus === "pending" ? (
      <p>Transcribing...</p>
    ) : null;

  const tone = statusTone(video);
  const toneClass = styles[`status${tone[0].toUpperCase()}${tone.slice(1)}`];

  return (
    <main className={styles.detailPage}>
      <div className={styles.detailTopBar}>
        <button type="button" className={styles.backLinkButton} onClick={() => router.push("/videos")}>
          ← Back to videos
        </button>
        <div className={styles.detailTopActions}>
          <span className={`${styles.statusBadge} ${toneClass}`}>{statusLabel(video)}</span>
          {video.visibility === "shared" ? (
            <button type="button" className={styles.btnSecondary} onClick={toggleShare} disabled={shareBusy}>
              Revoke Link
            </button>
          ) : (
            <button type="button" className={styles.btnShare} onClick={toggleShare} disabled={shareBusy}>
              Create Share Link
            </button>
          )}
        </div>
      </div>

      <section className={styles.detailHero}>
        <div className={styles.detailHeader}>
          {canManage ? (
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={styles.titleInput} maxLength={255} />
          ) : (
            <h1>{video.title}</h1>
          )}
          <div className={styles.detailMetaChips}>
            <span className={styles.toolbarChip}>Recorded by {video.recordedByName}</span>
            <span className={styles.toolbarChip}>{new Date(video.createdAt).toLocaleString()}</span>
            <span className={styles.toolbarChip}>{formatDuration(video.durationSeconds)}</span>
            <span className={styles.toolbarChip}>{video.viewsCount} views</span>
          </div>
        </div>
        <p className={styles.detailSummary}>
          {video.description || "Use the details panel to add context, sharing notes, or a short summary for this video."}
        </p>
      </section>

      <div className={styles.detailWorkspace}>
        <section className={styles.detailMain}>
          <div className={styles.playerCard}>
            <video
              ref={videoRef}
              controls
              className={styles.player}
              src={apiUrlWithAuthQuery(`/videos/${video.id}/stream`, token)}
            />
          </div>

          <div className={styles.quickCommentCard}>
            <div className={styles.quickCommentHeader}>
              <h2>Leave a response</h2>
              <span className={styles.sectionSubtle}>Add timestamped feedback while the video is fresh.</span>
            </div>
            <div className={styles.commentComposer}>
              <textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Add a comment, handoff note, or follow-up..."
                rows={3}
              />
              <div className={styles.commentComposerFooter}>
                <label className={styles.inlineCheck}>
                  <input
                    type="checkbox"
                    checked={commentAtCurrent}
                    onChange={(e) => setCommentAtCurrent(e.target.checked)}
                  />
                  At current playback time
                </label>
                <button type="button" className={styles.btnPrimary} onClick={addComment}>
                  Add Comment
                </button>
              </div>
            </div>
          </div>
        </section>

        <aside className={styles.detailSidebar}>
          <div className={styles.detailTabs}>
            {([
              ["transcript", `Transcript${video.transcriptStatus === "completed" ? ` (${transcriptLines.length})` : ""}`],
              ["comments", `Comments (${comments.length})`],
              ["details", "Details"],
            ] as const).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                className={`${styles.detailTab} ${activeTab === tab ? styles.detailTabActive : ""}`}
                onClick={() => setActiveTab(tab)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className={styles.detailPanel}>
            {activeTab === "transcript" ? (
              <section className={styles.detailSection}>
                <div className={styles.detailSectionHeader}>
                  <h2>Transcript</h2>
                  <span className={styles.sectionSubtle}>Search and jump to key moments.</span>
                </div>
                {transcriptStatusMessage}
                {video.transcript && video.transcriptStatus === "completed" ? (
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
                          <p key={`${index}-${line.slice(0, 20)}`} className={styles.transcriptLine}>
                            {timestamp != null ? (
                              <button type="button" onClick={() => jumpTo(timestamp)} className={styles.btnTimestamp}>
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
            ) : null}

            {activeTab === "comments" ? (
              <section className={styles.detailSection}>
                <div className={styles.detailSectionHeader}>
                  <h2>Comments</h2>
                  <span className={styles.sectionSubtle}>Keep feedback tied to the exact moment it matters.</span>
                </div>
                <div className={styles.commentList}>
                  {comments.length === 0 ? <p className={styles.sectionSubtle}>No comments yet.</p> : null}
                  {comments.map((comment) => (
                    <article key={comment.id} className={styles.commentItem}>
                      <div className={styles.commentHeader}>
                        <strong>{comment.displayName}</strong>
                        <span>{new Date(comment.createdAt).toLocaleString()}</span>
                      </div>
                      {comment.timestampSeconds != null ? (
                        <button type="button" onClick={() => jumpTo(comment.timestampSeconds)} className={styles.btnTimestamp}>
                          {timestampLabel(comment.timestampSeconds)}
                        </button>
                      ) : null}
                      <p>{comment.comment}</p>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {activeTab === "details" ? (
              <section className={styles.detailSection}>
                <div className={styles.detailSectionHeader}>
                  <h2>Details</h2>
                  <span className={styles.sectionSubtle}>Manage the summary, sharing, and lifecycle of this video.</span>
                </div>
                {canManage ? (
                  <>
                    <textarea
                      className={styles.descriptionInput}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={5}
                      placeholder="Description"
                    />
                    <div className={styles.detailActions}>
                      <div className={styles.detailActionsRow}>
                        <button type="button" className={styles.btnPrimary} onClick={saveMetadata}>
                          Save Details
                        </button>
                        <button
                          type="button"
                          className={video.visibility === "shared" ? styles.btnSecondary : styles.btnShare}
                          onClick={toggleShare}
                          disabled={shareBusy}
                        >
                          {video.visibility === "shared" ? "Revoke Link" : "Create Share Link"}
                        </button>
                        <button type="button" className={styles.btnDanger} onClick={removeVideo}>
                          Delete Video
                        </button>
                      </div>
                      {video.shareUrl ? (
                        <div className={styles.shareBox}>
                          <input value={video.shareUrl} readOnly />
                          <button type="button" className={styles.btnSecondary} onClick={copyShareLink}>
                            Copy Link
                          </button>
                        </div>
                      ) : (
                        <p className={styles.sectionSubtle}>Create a share link when you want to send this outside the app.</p>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <p>{video.description || "No description provided."}</p>
                    {video.shareUrl ? (
                      <div className={styles.shareBox}>
                        <input value={video.shareUrl} readOnly />
                        <button type="button" className={styles.btnSecondary} onClick={copyShareLink}>
                          Copy Link
                        </button>
                      </div>
                    ) : null}
                  </>
                )}
              </section>
            ) : null}
          </div>
        </aside>
      </div>
    </main>
  );
}
