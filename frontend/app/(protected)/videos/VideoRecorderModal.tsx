"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiUrl } from "../../../lib/api";
import { formatDuration } from "../../../lib/videos";
import { useAuth } from "../../../context/AuthContext";
import styles from "./videos.module.css";

type RecordingMode = "screen" | "webcam" | "both";

type Props = {
  open: boolean;
  onClose: () => void;
  onUploaded: (videoId: number) => void;
};

function defaultTitle() {
  const now = new Date();
  return `Video from ${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
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

export default function VideoRecorderModal({ open, onClose, onUploaded }: Props) {
  const { authHeaders } = useAuth();
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const rawStreamsRef = useRef<MediaStream[]>([]);
  const drawLoopRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const meterAnimationRef = useRef<number | null>(null);

  const [mode, setMode] = useState<RecordingMode>("screen");
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState<string>("");
  const [audioLevel, setAudioLevel] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [blobUrl, setBlobUrl] = useState<string>("");
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);

  useEffect(() => {
    if (!open) return;
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        stream.getTracks().forEach((t) => t.stop());
        return navigator.mediaDevices.enumerateDevices();
      })
      .then((devices) => {
        const inputs = devices.filter((d) => d.kind === "audioinput");
        setMicrophones(inputs);
        if (!micId && inputs.length > 0) setMicId(inputs[0].deviceId);
      })
      .catch(() => {
        setMicrophones([]);
      });
  }, [open, micId]);

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

  useEffect(() => {
    if (!open) {
      stopEverything();
      setIsRecording(false);
      setIsPaused(false);
      setSeconds(0);
      setBlob(null);
      setError(null);
      setUploadProgress(0);
      setUploading(false);
      setTranscribing(false);
      setDescription("");
      setTitle(defaultTitle());
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      setBlobUrl("");
    }
  }, [open, stopEverything, blobUrl]);

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
    if (mode === "webcam") {
      const webcam = await navigator.mediaDevices.getUserMedia({ video: true, audio: micConstraints });
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

    const webcam = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
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
  }, [micId, mode]);

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
      const recorder = new MediaRecorder(stream, {
        mimeType: "video/webm;codecs=vp9,opus",
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
        stopEverything();
      };
      recorder.start(1000);
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
  }, [blobUrl]);

  const saveAndUpload = useCallback(async () => {
    if (!blob) return;
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    setError(null);
    setUploading(true);
    setUploadProgress(0);

    const payload = new FormData();
    payload.append("video", blob, "recording.webm");
    payload.append("title", title.trim());
    payload.append("description", description.trim());
    payload.append("recording_type", mode);

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", apiUrl("/videos/upload"));
      const headers = authHeaders();
      Object.entries(headers).forEach(([name, value]) => xhr.setRequestHeader(name, value));
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        setUploadProgress(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onload = () => {
        const body = JSON.parse(xhr.responseText || "{}");
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(body.error || "Upload failed."));
          return;
        }
        const id = body.video?.id;
        if (!id) {
          reject(new Error("Invalid upload response."));
          return;
        }
        setTranscribing(true);
        setTimeout(() => onUploaded(id), 300);
        resolve();
      };
      xhr.onerror = () => reject(new Error("Network error during upload."));
      xhr.send(payload);
    }).catch((e) => {
      setError(e instanceof Error ? e.message : "Upload failed.");
    });

    setUploading(false);
  }, [authHeaders, blob, description, mode, onUploaded, title]);

  if (!open) return null;

  return (
    <div className={styles.recorderOverlay}>
      <div className={styles.recorderShell}>
        <div className={styles.recorderHeader}>
          <h2>Record Video Message</h2>
          <button type="button" onClick={onClose} className={styles.closeBtn} disabled={uploading}>
            Close
          </button>
        </div>

        {!blob ? (
          <>
            <div className={styles.modeRow}>
              {(["screen", "webcam", "both"] as RecordingMode[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`${styles.modeButton} ${mode === value ? styles.modeActive : ""}`}
                  onClick={() => setMode(value)}
                  disabled={isRecording}
                >
                  {value === "screen" ? "Screen" : value === "webcam" ? "Webcam" : "Screen + Webcam"}
                </button>
              ))}
            </div>
            <div className={styles.recorderBody}>
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
                <label>
                  Microphone
                  <select value={micId} onChange={(e) => setMicId(e.target.value)} disabled={isRecording}>
                    {microphones.map((mic) => (
                      <option key={mic.deviceId} value={mic.deviceId}>
                        {mic.label || "Microphone"}
                      </option>
                    ))}
                  </select>
                </label>
                <div className={styles.audioMeter}>
                  <div className={styles.audioMeterFill} style={{ width: `${audioLevel}%` }} />
                </div>
                <div className={`${styles.timer} ${timerTone}`}>⏺ {formatDuration(seconds)}</div>
                {!isRecording ? (
                  <button type="button" className={styles.primaryRecordBtn} onClick={startRecording}>
                    Start Recording
                  </button>
                ) : (
                  <div className={styles.recordingActions}>
                    <button type="button" onClick={togglePause}>
                      {isPaused ? "Resume" : "Pause"}
                    </button>
                    <button type="button" onClick={stopRecording} className={styles.stopBtn}>
                      Stop
                    </button>
                  </div>
                )}
                {error ? <p className={styles.errorText}>{error}</p> : null}
              </div>
            </div>
          </>
        ) : (
          <div className={styles.reviewPane}>
            <video src={blobUrl} controls className={styles.reviewVideo} />
            <div className={styles.reviewForm}>
              <label>
                Title
                <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255} />
              </label>
              <label>
                Description
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
              </label>
              <div className={styles.reviewActions}>
                <button type="button" onClick={reRecord} disabled={uploading}>
                  Re-record
                </button>
                <button type="button" className={styles.primaryRecordBtn} onClick={saveAndUpload} disabled={uploading}>
                  Save & Upload
                </button>
              </div>
              {uploading ? (
                <div className={styles.progressWrap}>
                  <div className={styles.progressBar} style={{ width: `${uploadProgress}%` }} />
                </div>
              ) : null}
              {transcribing ? <p className={styles.transcribing}>Transcribing...</p> : null}
              {error ? <p className={styles.errorText}>{error}</p> : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
