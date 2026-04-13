export type VideoRow = {
  id: number;
  title: string;
  description: string | null;
  filename: string;
  thumbnailFilename: string | null;
  durationSeconds: number | null;
  fileSizeBytes: number;
  mimeType: string;
  recordingType: "screen" | "webcam" | "both" | string;
  transcript: string | null;
  transcriptStatus: "pending" | "processing" | "completed" | "failed" | string;
  visibility: "private" | "shared" | string;
  shareToken: string | null;
  shareUrl: string | null;
  recordedBy: number | null;
  recordedByName: string;
  viewsCount: number;
  createdAt: string;
  updatedAt: string;
};

export type VideoCommentRow = {
  id: number;
  videoId: number;
  userId: number;
  displayName: string;
  comment: string;
  timestampSeconds: number | null;
  createdAt: string;
};

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function relativeTime(iso: string): string {
  const date = new Date(iso);
  const sec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 7) return `${day}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function timestampLabel(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `[${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}]`;
}
