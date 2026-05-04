"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiUrl } from "../../../lib/api";
import { formatDuration, type VideoRow } from "../../../lib/videos";
import { useAuth } from "../../../context/AuthContext";
import styles from "./videos.module.css";

type RecordingMode = "screen" | "webcam" | "both";
type UploadPhase = "idle" | "uploading" | "processing" | "transcribing" | "error";
type RecorderStep = "setup" | "record" | "review";

type Props = {
  open: boolean;
  onClose: () => void;
  onUploaded: (videoId: number) => void;
  defaultFolderId?: number | null;
};

function defaultTitle() {
  const now = new Date();
  return `Video from ${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function modeTitle(mode: RecordingMode) {
  if (mode === "screen") return "Screen only";
  if (mode === "webcam") return "Webcam only";
  return "Screen + webcam";
}

async function mixAudioStreams(streams: MediaStream[]): Promise<MediaStreamTrack | null> {
  const audioTracks = streams.flatMap((stream) => stream.getAudioTracks());
  if (!audioTracks.length) return null;
  const ctx = new AudioContext();
  const destination = ctx.createMediaStreamDestination();
  const sources = streams.filter((stream) => stream.getAudioTracks().length > 0);
  for (const stream of sources) {
    const source = ctx.createMediaStreamSource(stream);
    source.connect(destination);
  }
  return destination.stream.getAudioTracks()[0] || null;
}

function pickRecorderMime(): { mimeType: string; bits: number } {
  const preferred = "video/webm;codecs=vp9,opus";
  if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(preferred)) {
    return { mimeType: preferred, bits: 1_500_000 };
  }
  return { mimeType: "video/webm", bits: 1_500_000 };
}

export default function VideoRecorderModal({ open, onClose, onUploaded, defaultFolderId = null }: Props) {
  const { authHeaders } = useAuth();
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const rawStreamsRef = useRef<MediaStream[]>([]);
  const drawLoopRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const meterAnimationRef = useRef<number | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [step, setStep] = useState<RecorderStep>("setup");
  const [mode, setMode] = useState<RecordingMode>("screen");
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState<string>("");
  const [cameraId, setCameraId] = useState<string>("");
  const [audioLevel, setAudioLevel] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [blobUrl, setBlobUrl] = useState<string>("");
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState("");
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    navigator.mediaDevices
      .getUserMedia({ audio: true, video: true })
      .then((stream) => {
        stream.getTracks().forEach((t) => t.stop());
        return navigator.mediaDevices.enumerateDevices();
      })
      .then((devices) => {
        const audioInputs = devices.filter((d) => d.kind === "audioinput");
        const videoInputs = devices.filter((d) => d.kind === "videoinput");
        setMicrophones(audioInputs);
        setCameras(videoInputs);
        if (!micId && audioInputs.length > 0) setMicId(audioInputs[0].deviceId);
        if (!cameraId && videoInputs.length > 0) setCameraId(videoInputs[0].deviceId);
      })
      .catch(() => {
        navigator.mediaDevices
          .getUserMedia({ audio: true })
          .then((stream) => {
            stream.getTracks().forEach((t) => t.stop());
            return navigator.mediaDevices.enumerateDevices();
          })
          .then((devices) => {
            const audioInputs = devices.filter((d) => d.kind === "audioinput");
            const videoInputs = devices.filter((d) => d.kind === "videoinput");
            setMicrophones(audioInputs);
            setCameras(videoInputs);
            if (!micId && audioInputs.length > 0) setMicId(audioInputs[0].deviceId);
            if (!cameraId && videoInputs.length > 0) setCameraId(videoInputs[0].deviceId);
          })
          .catch(() => {
            setMicrophones([]);
            setCameras([]);
          });
      });
  }, [open, micId, cameraId]);

  const stopEverything = useCallback(() => {
    if (drawLoopRef.current != null) cancelAnimationFrame(drawLoopRef.current);
    if (meterAnimationRef.current != null) cancelAnimationFrame(meterAnimationRef.current);
    drawLoopRef.current = null;
    meterAnimationRef.current = null;
    analyserRef.current = null;
    recorderRef.current = null;
    if (activeStreamRef.current) {
      activeStreamRef.current.getTracks().forEach((track) => track.stop());
      activeStreamRef.current = null;
    }
    rawStreamsRef.current.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
    rawStreamsRef.current = [];
    if (previewRef.current) {
      previewRef.current.srcObject = null;
    }
  }, []);

  const clearPoll = useCallback(() => {
    if (pollTimerRef.current != null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!open) {
      clearPoll();
      stopEverything();
      setStep("setup");
      setIsRecording(false);
      setIsPaused(false);
      setSeconds(0);
      setBlob(null);
      setError(null);
      setUploadProgress(0);
      setUploadPhase("idle");
      setDescription("");
      setTitle(defaultTitle());
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      setBlobUrl("");
      setAudioLevel(0);
    }
  }, [open, stopEverything, blobUrl, clearPoll]);

  useEffect(() => {
    if (!isRecording || isPaused) return;
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [isRecording, isPaused]);

  const timerTone = useMemo(() => {
    if (seconds >= 600) return styles.timerRed;
    if (seconds >= 480) return styles.timerYellow;
    return "";
  }, [seconds]);

  const startAudioMeter = useCallback((stream: MediaStream | null) => {
    if (!stream || stream.getAudioTracks().length === 0) {
      setAudioLevel(0);
      return;
    }
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    analyserRef.current = analyser;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (!analyserRef.current) return;
      analyserRef.current.getByteFrequencyData(dataArray);
      const avg = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
      setAudioLevel(Math.min(100, Math.round((avg / 255) * 120)));
      meterAnimationRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const buildRecordingStream = useCallback(async (): Promise<MediaStream> => {
    const micConstraints: MediaTrackConstraints | boolean =
      micId && micId.length > 0 ? { deviceId: { exact: micId }, echoCancellation: true, noiseSuppression: true } : true;
    const cameraConstraints: MediaTrackConstraints | boolean =
      cameraId && cameraId.length > 0 ? { deviceId: { exact: cameraId } } : true;
    if (mode === "webcam") {
      const webcam = await navigator.mediaDevices.getUserMedia({ video: cameraConstraints, audio: micConstraints });
      rawStreamsRef.current = [webcam];
      return webcam;
    }

    const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const microphone = await navigator.mediaDevices.getUserMedia({ audio: micConstraints, video: false });

    if (mode === "screen") {
      const mixedAudioTrack = await mixAudioStreams([screen, microphone]);
      const finalTracks = [...screen.getVideoTracks()];
      if (mixedAudioTrack) finalTracks.push(mixedAudioTrack);
      rawStreamsRef.current = [screen, microphone];
      return new MediaStream(finalTracks);
    }

    const webcam = await navigator.mediaDevices.getUserMedia({ video: cameraConstraints, audio: false });
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext("2d");
    const screenVideo = document.createElement("video");
    screenVideo.srcObject = screen;
    screenVideo.muted = true;
    await screenVideo.play();
    const webcamVideo = document.createElement("video");
    webcamVideo.srcObject = webcam;
    webcamVideo.muted = true;
    await webcamVideo.play();

    const render = () => {
      if (!ctx) return;
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);
      const bubbleWidth = 300;
      const bubbleHeight = 170;
      const x = canvas.width - bubbleWidth - 24;
      const y = canvas.height - bubbleHeight - 24;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(x - 4, y - 4, bubbleWidth + 8, bubbleHeight + 8);
      ctx.drawImage(webcamVideo, x, y, bubbleWidth, bubbleHeight);
      drawLoopRef.current = requestAnimationFrame(render);
    };
    render();

    const canvasTrack = canvas.captureStream(30).getVideoTracks()[0];
    const mixedAudioTrack = await mixAudioStreams([screen, microphone]);
    const tracks: MediaStreamTrack[] = [canvasTrack];
    if (mixedAudioTrack) tracks.push(mixedAudioTrack);
    rawStreamsRef.current = [screen, webcam, microphone];
    return new MediaStream(tracks);
  }, [cameraId, micId, mode]);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      setBlob(null);
      setBlobUrl("");
      setSeconds(0);
      const stream = await buildRecordingStream();
      activeStreamRef.current = stream;
      if (previewRef.current) {
        previewRef.current.srcObject = stream;
        await previewRef.current.play().catch(() => {});
      }
      startAudioMeter(rawStreamsRef.current.find((s) => s.getAudioTracks().length > 0) || null);

      const chunks: BlobPart[] = [];
      const { mimeType, bits } = pickRecorderMime();
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: bits,
      });
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        const finalBlob = new Blob(chunks, { type: "video/webm" });
        setBlob(finalBlob);
        const nextUrl = URL.createObjectURL(finalBlob);
        setBlobUrl(nextUrl);
        setIsRecording(false);
        setIsPaused(false);
        setStep("review");
        stopEverything();
      };
      recorder.start(1000);
      setStep("record");
      setIsRecording(true);
      setIsPaused(false);

      const screenTrack = rawStreamsRef.current[0]?.getVideoTracks?.()[0];
      if (screenTrack) {
        screenTrack.onended = () => {
          if (recorder.state !== "inactive") recorder.stop();
        };
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start recording.");
      stopEverything();
      setStep("setup");
    }
  }, [blobUrl, buildRecordingStream, startAudioMeter, stopEverything]);

  const togglePause = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state === "recording") {
      recorder.pause();
      setIsPaused(true);
      return;
    }
    if (recorder.state === "paused") {
      recorder.resume();
      setIsPaused(false);
    }
  }, []);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
  }, []);

  const reRecord = useCallback(() => {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlob(null);
    setBlobUrl("");
    setSeconds(0);
    setTitle(defaultTitle());
    setDescription("");
    setError(null);
    setUploadPhase("idle");
    setUploadProgress(0);
    setStep("setup");
  }, [blobUrl]);

  const pollUntilReady = useCallback(
    (videoId: number) => {
      const poll = async () => {
        try {
          const res = await fetch(apiUrl(`/videos/${videoId}`), {
            headers: { ...authHeaders() },
            cache: "no-store",
          });
          const body = await res.json().catch(() => ({}));
          const v = body.video as VideoRow | undefined;
          if (!v) {
            pollTimerRef.current = setTimeout(poll, 1200);
            return;
          }
          if (v.processingStatus === "error") {
            setUploadPhase("error");
            setError("Video processing failed.");
            return;
          }
          if (v.processingStatus === "ffmpeg") {
            setUploadPhase("processing");
            pollTimerRef.current = setTimeout(poll, 1000);
            return;
          }
          if (v.transcriptStatus === "processing" || v.transcriptStatus === "pending") {
            setUploadPhase("transcribing");
            pollTimerRef.current = setTimeout(poll, 1200);
            return;
          }
          if (
            v.transcriptStatus === "completed" ||
            v.transcriptStatus === "failed" ||
            v.transcriptStatus === "unavailable"
          ) {
            onUploaded(videoId);
            return;
          }
          pollTimerRef.current = setTimeout(poll, 1000);
        } catch {
          pollTimerRef.current = setTimeout(poll, 1500);
        }
      };
      pollTimerRef.current = setTimeout(poll, 400);
    },
    [authHeaders, onUploaded]
  );

  const saveAndUpload = useCallback(async () => {
    if (!blob) return;
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    setError(null);
    setUploadPhase("uploading");
    setUploadProgress(0);

    const payload = new FormData();
    payload.append("video", blob, "recording.webm");
    payload.append("title", title.trim());
    payload.append("description", description.trim());
    payload.append("recording_type", mode);
    if (defaultFolderId != null && defaultFolderId > 0) {
      payload.append("folder_id", String(defaultFolderId));
    }

    try {
      const videoId = await new Promise<number>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", apiUrl("/videos/upload"));
        const headers = authHeaders();
        Object.entries(headers).forEach(([name, value]) => xhr.setRequestHeader(name, value));
        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return;
          setUploadProgress(Math.round((event.loaded / event.total) * 100));
        };
        xhr.onload = () => {
          let body: { error?: string; video?: { id?: number } } = {};
          try {
            body = JSON.parse(xhr.responseText || "{}");
          } catch {
            body = {};
          }
          if (xhr.status < 200 || xhr.status >= 300) {
            reject(new Error(body.error || "Upload failed."));
            return;
          }
          const id = body.video?.id;
          if (!id) {
            reject(new Error("Invalid upload response."));
            return;
          }
          resolve(id);
        };
        xhr.onerror = () => reject(new Error("Network error during upload."));
        xhr.send(payload);
      });

      setUploadProgress(100);
      setUploadPhase("processing");
      pollUntilReady(videoId);
    } catch (e) {
      setUploadPhase("error");
      setError(e instanceof Error ? e.message : "Upload failed.");
    }
  }, [authHeaders, blob, defaultFolderId, description, mode, pollUntilReady, title]);

  const pipelineBusy = uploadPhase === "uploading" || uploadPhase === "processing" || uploadPhase === "transcribing";

  const phaseMessage =
    uploadPhase === "uploading"
      ? `Uploading ${uploadProgress}%`
      : uploadPhase === "processing"
        ? "Processing video"
        : uploadPhase === "transcribing"
          ? "Generating transcript"
          : uploadPhase === "error"
            ? "Upload failed"
            : "Ready to publish";

  if (!open) return null;

  return (
    <div className={styles.recorderOverlay}>
      <div className={styles.recorderShell}>
        <div className={styles.recorderHeader}>
          <div>
            <h2>Record Video Message</h2>
            <p className={styles.recorderSubtle}>Capture, review, and publish in one guided flow.</p>
          </div>
          <button type="button" onClick={onClose} className={styles.btnSecondary} disabled={pipelineBusy}>
            Close
          </button>
        </div>

        <div className={styles.stepper}>
          {([
            ["setup", "1. Setup"],
            ["record", "2. Record"],
            ["review", "3. Review"],
          ] as const).map(([value, label]) => (
            <div
              key={value}
              className={`${styles.stepPill} ${step === value ? styles.stepPillActive : ""} ${
                (step === "record" && value === "setup") || (step === "review" && value !== "review") ? styles.stepPillDone : ""
              }`}
            >
              {label}
            </div>
          ))}
        </div>

        {step === "setup" ? (
          <div className={styles.setupGrid}>
            <div className={styles.setupCard}>
              <h3>Choose what to record</h3>
              <div className={styles.modeRow}>
                {(["screen", "webcam", "both"] as RecordingMode[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`${styles.modeButton} ${mode === value ? styles.modeActive : ""}`}
                    onClick={() => setMode(value)}
                  >
                    {value === "screen" ? "Screen" : value === "webcam" ? "Webcam" : "Screen + Webcam"}
                  </button>
                ))}
              </div>

              <label className={styles.formStack}>
                <span>Microphone</span>
                <select value={micId} onChange={(e) => setMicId(e.target.value)}>
                  {microphones.length === 0 ? <option value="">No microphone found</option> : null}
                  {microphones.map((mic) => (
                    <option key={mic.deviceId} value={mic.deviceId}>
                      {mic.label || "Microphone"}
                    </option>
                  ))}
                </select>
              </label>

              {mode !== "screen" ? (
                <label className={styles.formStack}>
                  <span>Camera</span>
                  <select value={cameraId} onChange={(e) => setCameraId(e.target.value)}>
                    {cameras.length === 0 ? <option value="">No camera found</option> : null}
                    {cameras.map((camera) => (
                      <option key={camera.deviceId} value={camera.deviceId}>
                        {camera.label || "Camera"}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <div className={styles.audioMeter}>
                <div className={styles.audioMeterFill} style={{ width: `${audioLevel}%` }} />
              </div>

              <div className={styles.setupTips}>
                <strong>Before you start</strong>
                <ul className={styles.setupList}>
                  <li>Close noisy tabs and notifications.</li>
                  <li>Keep the update short and title it clearly.</li>
                  <li>{defaultFolderId ? "This recording will save into the current folder." : "You can organize it after publishing."}</li>
                </ul>
              </div>
            </div>

            <div className={styles.setupSummaryCard}>
              <span className={styles.summaryEyebrow}>Ready to capture</span>
              <h3>{modeTitle(mode)}</h3>
              <p>
                {mode === "screen"
                  ? "Best for walkthroughs, process demos, and task handoffs."
                  : mode === "webcam"
                    ? "Best for quick personal updates or announcements."
                    : "Best when you want the screen context plus a face-to-face feel."}
              </p>
              <div className={styles.summaryRows}>
                <div>
                  <span>Destination</span>
                  <strong>{defaultFolderId ? "Current folder" : "Main video library"}</strong>
                </div>
                <div>
                  <span>Microphone</span>
                  <strong>{microphones.find((mic) => mic.deviceId === micId)?.label || "Default mic"}</strong>
                </div>
                {mode !== "screen" ? (
                  <div>
                    <span>Camera</span>
                    <strong>{cameras.find((camera) => camera.deviceId === cameraId)?.label || "Default camera"}</strong>
                  </div>
                ) : null}
              </div>
              <button type="button" className={styles.btnPrimary} onClick={startRecording}>
                Start Recording
              </button>
              {error ? <p className={styles.errorText}>{error}</p> : null}
            </div>
          </div>
        ) : null}

        {step === "record" ? (
          <div className={styles.recorderStage}>
            <div className={styles.previewPane}>
              <video
                ref={previewRef}
                className={styles.previewVideo}
                autoPlay
                muted
                playsInline
                controls={false}
                poster="/icons/icon-512.png"
              />
            </div>
            <div className={styles.recorderControls}>
              <div className={styles.liveBadgeRow}>
                <span className={styles.liveBadge}>{isPaused ? "Paused" : "Recording live"}</span>
                <span className={styles.recordingModeLabel}>{modeTitle(mode)}</span>
              </div>
              <div className={`${styles.timer} ${timerTone}`}>⏺ {formatDuration(seconds)}</div>
              <div className={styles.audioMeter}>
                <div className={styles.audioMeterFill} style={{ width: `${audioLevel}%` }} />
              </div>
              <p className={styles.recorderSubtle}>
                {mode === "screen"
                  ? "Share your screen, talk through the work, then stop when you’re ready to review."
                  : mode === "webcam"
                    ? "Speak naturally like a quick async standup or handoff."
                    : "Keep the screen as the main story and let the webcam support it."}
              </p>
              <div className={styles.recordingActions}>
                <button type="button" className={styles.btnSecondary} onClick={togglePause}>
                  {isPaused ? "Resume" : "Pause"}
                </button>
                <button type="button" className={styles.btnDanger} onClick={stopRecording}>
                  Stop Recording
                </button>
              </div>
              {error ? <p className={styles.errorText}>{error}</p> : null}
            </div>
          </div>
        ) : null}

        {step === "review" ? (
          <div className={styles.reviewPane}>
            <video src={blobUrl} controls className={styles.reviewVideo} />
            <div className={styles.reviewForm}>
              <div className={styles.publishSummary}>
                <span className={styles.summaryEyebrow}>Ready to publish</span>
                <strong>{phaseMessage}</strong>
                <small>{formatDuration(seconds)} · {modeTitle(mode)}</small>
              </div>

              <label className={styles.formStack}>
                <span>Title</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255} disabled={pipelineBusy} />
              </label>

              <label className={styles.formStack}>
                <span>Description</span>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} disabled={pipelineBusy} />
              </label>

              <div className={styles.reviewMeta}>
                <span className={styles.toolbarChip}>{modeTitle(mode)}</span>
                <span className={styles.toolbarChip}>{defaultFolderId ? "Saving to current folder" : "Saving to library"}</span>
              </div>

              <div className={styles.reviewActions}>
                <button type="button" className={styles.btnSecondary} onClick={reRecord} disabled={pipelineBusy}>
                  Record Again
                </button>
                <button type="button" className={styles.btnPrimary} onClick={saveAndUpload} disabled={pipelineBusy}>
                  Publish Video
                </button>
              </div>

              {uploadPhase === "uploading" ? (
                <>
                  <p className={styles.progressLabel}>Uploading... {uploadProgress}%</p>
                  <div className={styles.progressWrap}>
                    <div className={styles.progressBar} style={{ width: `${uploadProgress}%` }} />
                  </div>
                </>
              ) : null}
              {uploadPhase === "processing" ? <p className={styles.phaseMessage}>Processing video...</p> : null}
              {uploadPhase === "transcribing" ? <p className={styles.phaseMessage}>Generating transcript...</p> : null}
              {uploadPhase === "error" && error ? <p className={styles.errorText}>{error}</p> : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
