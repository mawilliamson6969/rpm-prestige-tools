"use client";

import { useEffect, useState } from "react";
import { apiUrl } from "../../../../lib/api";
import { formatDuration, timestampLabel, type VideoRow } from "../../../../lib/videos";
import styles from "../../../(protected)/videos/videos.module.css";

function parseTranscript(transcript: string) {
  return transcript.split(/\n+/).filter(Boolean);
}

function parseTimestampFromText(text: string): number | null {
  const match = text.match(/\[(\d{2}):(\d{2})\]/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export default function SharedVideoClient({ token }: { token: string }) {
  const [video, setVideo] = useState<VideoRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(apiUrl(`/videos/shared/${token}`), { cache: "no-store" })
      .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        if (ok && body.video) setVideo(body.video);
      })
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <main className={styles.sharedPage}>Loading shared video...</main>;
  if (!video) return <main className={styles.sharedPage}>This share link is no longer available.</main>;

  return (
    <main className={styles.sharedPage}>
      <header className={styles.sharedHeader}>
        <h1>{video.title}</h1>
        <p>
          {video.recordedByName} · {new Date(video.createdAt).toLocaleString()} · {formatDuration(video.durationSeconds)}
        </p>
      </header>
      <video controls className={styles.player} src={apiUrl(`/videos/shared/${token}/stream`)} />
      <section className={styles.sharedDescription}>
        <p>{video.description || "No description provided."}</p>
      </section>
      {video.transcriptStatus === "unavailable" ? (
        <section className={styles.transcriptSection}>
          <h2>Transcript</h2>
          <p>Transcription will be available in a future update.</p>
        </section>
      ) : video.transcript && video.transcriptStatus === "completed" ? (
        <section className={styles.transcriptSection}>
          <h2>Transcript</h2>
          <div className={styles.transcriptBody}>
            {parseTranscript(video.transcript).map((line, index) => {
              const timestamp = parseTimestampFromText(line);
              return (
                <p key={`${index}-${line.slice(0, 12)}`}>
                  {timestamp != null ? <strong>{timestampLabel(timestamp)}</strong> : null} {line}
                </p>
              );
            })}
          </div>
        </section>
      ) : null}
      <footer className={styles.sharedFooter}>Powered by RPM Prestige</footer>
    </main>
  );
}
