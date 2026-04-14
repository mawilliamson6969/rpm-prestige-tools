"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { walkthruBasePath } from "../../../lib/api";
import styles from "./walkthru-public.module.css";

type ItemStatus = "pending" | "no_issues" | "has_issues" | "not_applicable";
type ReportStatus = "in_progress" | "completed" | "reviewed";

type WalkthruItem = {
  id: number;
  roomId: number;
  itemName: string;
  itemOrder: number;
  status: ItemStatus;
  comment: string;
  photoFilenames: string[];
};

type WalkthruRoom = {
  id: number;
  reportId: number;
  roomName: string;
  roomOrder: number;
  isCustom: boolean;
  items: WalkthruItem[];
};

type WalkthruReport = {
  id: number;
  status: ReportStatus;
  propertyAddress: string;
  residentName: string;
  reportDate: string | null;
};

type WalkthruPayload = {
  report: WalkthruReport;
  rooms: WalkthruRoom[];
};

type PendingItemSync = Record<number, { status: ItemStatus; comment: string }>;
type DraftState = Record<number, { status: ItemStatus; comment: string }>;

function draftKey(token: string) {
  return `walkthru_draft_${token}`;
}

function queueKey(token: string) {
  return `walkthru_queue_${token}`;
}

function fmtDate(v: string | null) {
  if (!v) return new Date().toLocaleDateString();
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString();
}

function photoUrl(reportId: number, filename: string) {
  const base = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
  if (base) return `${base}/uploads/walkthru/${reportId}/${filename}`;
  if (process.env.NODE_ENV === "development") {
    return `http://localhost:4000/uploads/walkthru/${reportId}/${filename}`;
  }
  return `/api/uploads/walkthru/${reportId}/${filename}`;
}

async function compressClientImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const width = Math.min(1200, bitmap.width);
  const height = Math.round((bitmap.height * width) / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create image context.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Could not compress image."));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      0.8
    );
  });
}

export default function WalkthruPublicForm({ token }: { token: string }) {
  const [payload, setPayload] = useState<WalkthruPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRoom, setExpandedRoom] = useState<number | null>(null);
  const [savingIds, setSavingIds] = useState<Record<number, boolean>>({});
  const [uploadingIds, setUploadingIds] = useState<Record<number, boolean>>({});
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [addRoomName, setAddRoomName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const queueRef = useRef<PendingItemSync>({});
  const timersRef = useRef<Record<number, number | undefined>>({});
  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sigDrawingRef = useRef(false);
  const sigLastRef = useRef<{ x: number; y: number } | null>(null);

  const totalItems = useMemo(
    () => payload?.rooms.reduce((acc, r) => acc + r.items.length, 0) || 0,
    [payload]
  );
  const completedItems = useMemo(
    () =>
      payload?.rooms.reduce((acc, r) => acc + r.items.filter((it) => it.status !== "pending").length, 0) || 0,
    [payload]
  );
  const pendingItems = Math.max(0, totalItems - completedItems);
  const progress = totalItems ? Math.round((completedItems / totalItems) * 100) : 0;

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${walkthruBasePath()}/public/${token}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : `HTTP ${res.status}`);
      const draftRaw = localStorage.getItem(draftKey(token));
      const draft: DraftState = draftRaw ? JSON.parse(draftRaw) : {};
      for (const room of body.rooms || []) {
        for (const item of room.items || []) {
          const override = draft[item.id];
          if (!override) continue;
          item.status = override.status;
          item.comment = override.comment;
        }
      }
      setPayload(body);
      setExpandedRoom((body.rooms?.[0]?.id as number | undefined) ?? null);
      const queueRaw = localStorage.getItem(queueKey(token));
      queueRef.current = queueRaw ? JSON.parse(queueRaw) : {};
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load report.");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const persistDraft = useCallback(
    (nextPayload: WalkthruPayload) => {
      const draft: DraftState = {};
      for (const room of nextPayload.rooms) {
        for (const item of room.items) {
          draft[item.id] = { status: item.status, comment: item.comment || "" };
        }
      }
      localStorage.setItem(draftKey(token), JSON.stringify(draft));
    },
    [token]
  );

  const queueSync = useCallback((itemId: number, status: ItemStatus, comment: string) => {
    queueRef.current[itemId] = { status, comment };
    localStorage.setItem(queueKey(token), JSON.stringify(queueRef.current));
  }, [token]);

  const flushSingleItem = useCallback(async (itemId: number) => {
    const pending = queueRef.current[itemId];
    if (!pending) return;
    if (!navigator.onLine) return;
    setSavingIds((prev) => ({ ...prev, [itemId]: true }));
    try {
      const res = await fetch(`${walkthruBasePath()}/public/${token}/items/${itemId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pending),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status >= 500) return;
        throw new Error(typeof body.error === "string" ? body.error : `HTTP ${res.status}`);
      }
      delete queueRef.current[itemId];
      localStorage.setItem(queueKey(token), JSON.stringify(queueRef.current));
      setSavingIds((prev) => ({ ...prev, [itemId]: false }));
      const row = document.getElementById(`item-${itemId}`);
      if (row) {
        row.classList.add(styles.savedFlash);
        window.setTimeout(() => row.classList.remove(styles.savedFlash), 700);
      }
    } catch {
      setSavingIds((prev) => ({ ...prev, [itemId]: false }));
    }
  }, [token]);

  const flushQueue = useCallback(async () => {
    const ids = Object.keys(queueRef.current).map((k) => Number(k));
    for (const id of ids) {
      await flushSingleItem(id);
    }
  }, [flushSingleItem]);

  useEffect(() => {
    function onOnline() {
      void flushQueue();
    }
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [flushQueue]);

  function mutateItem(itemId: number, patch: Partial<WalkthruItem>) {
    setPayload((prev) => {
      if (!prev) return prev;
      const next: WalkthruPayload = {
        ...prev,
        rooms: prev.rooms.map((room) => ({
          ...room,
          items: room.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
        })),
      };
      persistDraft(next);
      return next;
    });
  }

  function scheduleItemSync(itemId: number, status: ItemStatus, comment: string) {
    queueSync(itemId, status, comment);
    const current = timersRef.current[itemId];
    if (current) window.clearTimeout(current);
    timersRef.current[itemId] = window.setTimeout(() => {
      void flushSingleItem(itemId);
    }, 500);
  }

  function updateItemStatus(item: WalkthruItem, status: ItemStatus) {
    const nextComment = status === "has_issues" ? item.comment || "" : item.comment || "";
    mutateItem(item.id, { status, comment: nextComment });
    scheduleItemSync(item.id, status, nextComment);
  }

  function updateItemComment(item: WalkthruItem, comment: string) {
    mutateItem(item.id, { comment, status: item.status === "pending" ? "has_issues" : item.status });
    const nextStatus = item.status === "pending" ? "has_issues" : item.status;
    scheduleItemSync(item.id, nextStatus, comment);
  }

  async function uploadPhoto(item: WalkthruItem, file: File) {
    if (!payload) return;
    if (!navigator.onLine) {
      alert("You are offline. Please reconnect to upload photos.");
      return;
    }
    try {
      setUploadingIds((prev) => ({ ...prev, [item.id]: true }));
      const compressed = await compressClientImage(file);
      const fd = new FormData();
      fd.append("photo", compressed, `${Date.now()}.jpg`);
      const res = await fetch(`${walkthruBasePath()}/public/${token}/items/${item.id}/photo`, {
        method: "POST",
        body: fd,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : `HTTP ${res.status}`);
      mutateItem(item.id, body.item);
      if (body.item?.status && body.item?.comment != null) {
        scheduleItemSync(item.id, body.item.status, body.item.comment || "");
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not upload photo.");
    } finally {
      setUploadingIds((prev) => ({ ...prev, [item.id]: false }));
    }
  }

  async function deletePhoto(item: WalkthruItem, photoIndex: number) {
    if (!navigator.onLine) {
      alert("You are offline. Please reconnect to delete photos.");
      return;
    }
    const res = await fetch(`${walkthruBasePath()}/public/${token}/items/${item.id}/photo/${photoIndex}`, {
      method: "DELETE",
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(typeof body.error === "string" ? body.error : "Could not delete photo.");
      return;
    }
    mutateItem(item.id, { photoFilenames: body.photoFilenames || [] });
  }

  async function addRoom() {
    const roomName = addRoomName.trim();
    if (!roomName) return;
    const res = await fetch(`${walkthruBasePath()}/public/${token}/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomName }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(typeof body.error === "string" ? body.error : "Could not add room.");
      return;
    }
    setAddRoomName("");
    await loadReport();
    setExpandedRoom(body?.room?.id || null);
  }

  function signatureCanvas() {
    return signatureCanvasRef.current;
  }

  function startDraw(e: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = signatureCanvas();
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    sigDrawingRef.current = true;
    sigLastRef.current = { x, y };
    canvas.setPointerCapture(e.pointerId);
  }

  function moveDraw(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!sigDrawingRef.current) return;
    const canvas = signatureCanvas();
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const ctx = canvas.getContext("2d");
    if (!ctx || !sigLastRef.current) return;
    ctx.strokeStyle = "#1b2856";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(sigLastRef.current.x, sigLastRef.current.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    sigLastRef.current = { x, y };
  }

  function endDraw() {
    sigDrawingRef.current = false;
    sigLastRef.current = null;
  }

  function clearSignature() {
    const canvas = signatureCanvas();
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  async function submitReport() {
    const canvas = signatureCanvas();
    if (!canvas) return;
    const data = canvas.toDataURL("image/png");
    if (!data || data.length < 100) {
      alert("Please sign before submitting.");
      return;
    }
    setSubmitting(true);
    try {
      await flushQueue();
      const res = await fetch(`${walkthruBasePath()}/public/${token}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signatureData: data }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : `HTTP ${res.status}`);
      localStorage.removeItem(draftKey(token));
      localStorage.removeItem(queueKey(token));
      setSubmitted(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not submit report.");
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 600;
    const h = canvas.clientHeight || 220;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
  }, [payload]);

  if (submitted) {
    return (
      <main className={styles.page}>
        <div className={styles.wrap}>
          <div className={styles.submitCard} style={{ textAlign: "center" }}>
            <h1 style={{ marginTop: 0 }}>Your walk-thru report has been submitted.</h1>
            <p style={{ color: "#6A737B" }}>
              A copy will be saved to your records.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Walk-Thru Report</h1>
        <p className={styles.sub}>
          {payload?.report.propertyAddress || "Loading property"} · {payload?.report.residentName || "Resident"}
        </p>
        <div className={styles.progressOuter}>
          <div className={styles.progressInner} style={{ width: `${progress}%` }} />
        </div>
        <div className={styles.progressText}>
          {completedItems} of {totalItems} items completed
        </div>
      </header>

      <div className={styles.wrap}>
        {loading ? <p>Loading walk-thru report...</p> : null}
        {error ? <p style={{ color: "#B32317" }}>{error}</p> : null}
        {!loading && payload ? (
          <>
            {payload.rooms.map((room) => {
              const done = room.items.filter((item) => item.status !== "pending").length;
              const full = done === room.items.length && room.items.length > 0;
              const open = expandedRoom === room.id;
              return (
                <section key={room.id} className={styles.roomCard}>
                  <button
                    type="button"
                    className={`${styles.roomHead} ${full ? styles.roomHeadDone : ""}`}
                    onClick={() => setExpandedRoom(open ? null : room.id)}
                  >
                    <div>
                      <h2 className={styles.roomName}>{room.roomName}</h2>
                      <p className={styles.roomMeta}>
                        {done} of {room.items.length} items {full ? "✓" : ""}
                      </p>
                    </div>
                    <span>{open ? "▾" : "▸"}</span>
                  </button>
                  {open ? (
                    <div className={styles.roomBody}>
                      {room.items.map((item) => {
                        const saving = !!savingIds[item.id];
                        const uploading = !!uploadingIds[item.id];
                        const issue = item.status === "has_issues";
                        return (
                          <div
                            key={item.id}
                            id={`item-${item.id}`}
                            className={`${styles.itemRow} ${issue ? styles.itemIssues : ""}`}
                          >
                            <p className={styles.itemTitle}>
                              {item.itemName} {saving ? "· saving..." : uploading ? "· uploading photo..." : ""}
                            </p>
                            <div className={styles.statusRow}>
                              <button
                                type="button"
                                className={`${styles.statusBtn} ${item.status === "no_issues" ? styles.statusNoIssues : ""}`}
                                onClick={() => updateItemStatus(item, "no_issues")}
                              >
                                ✓ No Issues
                              </button>
                              <button
                                type="button"
                                className={`${styles.statusBtn} ${item.status === "has_issues" ? styles.statusHasIssues : ""}`}
                                onClick={() => updateItemStatus(item, "has_issues")}
                              >
                                ⚠ Has Issues
                              </button>
                              <button
                                type="button"
                                className={`${styles.statusBtn} ${item.status === "not_applicable" ? styles.statusNA : ""}`}
                                onClick={() => updateItemStatus(item, "not_applicable")}
                              >
                                N/A
                              </button>
                            </div>

                            {issue ? (
                              <>
                                <textarea
                                  className={styles.comment}
                                  placeholder="Describe the issue..."
                                  value={item.comment || ""}
                                  onChange={(e) => updateItemComment(item, e.target.value)}
                                />
                                <div className={styles.photosWrap}>
                                  <label style={{ display: "inline-flex" }}>
                                    <input
                                      type="file"
                                      accept="image/*"
                                      capture="environment"
                                      style={{ display: "none" }}
                                      onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) void uploadPhoto(item, file);
                                        e.currentTarget.value = "";
                                      }}
                                    />
                                    <span className={styles.photoBtn}>📸 Add Photo</span>
                                  </label>
                                  <div className={styles.photoGrid}>
                                    {item.photoFilenames.map((filename, photoIndex) => {
                                      const src = photoUrl(payload.report.id, filename);
                                      return (
                                        <div className={styles.thumbWrap} key={`${item.id}-${filename}`}>
                                          {/* eslint-disable-next-line @next/next/no-img-element */}
                                          <img
                                            src={src}
                                            alt="Walk-thru issue photo"
                                            className={styles.thumb}
                                            onClick={() => setLightboxSrc(src)}
                                          />
                                          <button
                                            type="button"
                                            className={styles.thumbX}
                                            onClick={() => deletePhoto(item, photoIndex)}
                                          >
                                            ×
                                          </button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              </>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              );
            })}

            <section className={styles.submitCard}>
              <h3 style={{ marginTop: 0, marginBottom: 8 }}>Add Room</h3>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={addRoomName}
                  onChange={(e) => setAddRoomName(e.target.value)}
                  placeholder='Custom room name (e.g. "Laundry Room")'
                  style={{ flex: 1, borderRadius: 8, border: "1px solid rgba(27,40,86,0.2)", padding: "0.52rem" }}
                />
                <button type="button" className={styles.secondaryBtn} onClick={() => addRoom()}>
                  Add Room
                </button>
              </div>
            </section>

            <section className={styles.submitCard}>
              <h3 style={{ marginTop: 0, marginBottom: 5 }}>Submit Report</h3>
              {pendingItems > 0 ? (
                <p className={styles.warning}>{pendingItems} items not yet inspected.</p>
              ) : (
                <p style={{ color: "#2E7D6B", fontWeight: 700, marginTop: 0 }}>All items have been inspected.</p>
              )}
              <p style={{ marginBottom: 6, color: "#6A737B", fontSize: "0.85rem" }}>
                Report Date: {fmtDate(payload.report.reportDate)}
              </p>
              <div className={styles.signatureBox}>
                <canvas
                  ref={signatureCanvasRef}
                  className={styles.signatureCanvas}
                  onPointerDown={startDraw}
                  onPointerMove={moveDraw}
                  onPointerUp={endDraw}
                  onPointerLeave={endDraw}
                />
              </div>
              <button type="button" className={styles.secondaryBtn} onClick={clearSignature} style={{ marginTop: 8 }}>
                Clear
              </button>
              <button type="button" className={styles.submitBtn} onClick={submitReport} disabled={submitting}>
                {submitting ? "Submitting..." : "Submit Report"}
              </button>
            </section>
          </>
        ) : null}
      </div>

      {lightboxSrc ? (
        <button type="button" className={styles.lightbox} onClick={() => setLightboxSrc(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightboxSrc} alt="Walk-thru issue full size" />
        </button>
      ) : null}
    </main>
  );
}
