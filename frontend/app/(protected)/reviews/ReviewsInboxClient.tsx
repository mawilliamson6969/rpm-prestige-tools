"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../context/AuthContext";
import { apiUrl } from "../../../lib/api";
import ReviewsNav from "./ReviewsNav";
import StarRow from "./StarRow";
import { type Review, absDate, avatarColor, initialsOf, relTime, starColor } from "./utils";
import styles from "./reviews.module.css";

type Stats = {
  total: number;
  avgRating: number;
  ratingDistribution: Record<string, number>;
  replied: number;
  unread: number;
  needsReply: number;
  responseRate: number;
  avgResponseTimeHours: number;
};

type SetupStatus = {
  google: { configured: boolean; connected: boolean };
  openphone: { configured: boolean };
  reviewUrl: string;
  emailConfigured: boolean;
};

export default function ReviewsInboxClient() {
  const { authHeaders } = useAuth();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [ratingFilter, setRatingFilter] = useState<string>("all");
  const [isReadFilter, setIsReadFilter] = useState<string>("all");
  const [hasReplyFilter, setHasReplyFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [replyDraft, setReplyDraft] = useState<Record<number, string>>({});
  const [aiLoading, setAiLoading] = useState<number | null>(null);
  const [replyLoading, setReplyLoading] = useState<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const loadData = useCallback(async () => {
    const params = new URLSearchParams();
    if (ratingFilter !== "all") params.set("rating", ratingFilter);
    if (isReadFilter !== "all") params.set("isRead", isReadFilter);
    if (hasReplyFilter !== "all") params.set("hasReply", hasReplyFilter);
    if (debouncedSearch) params.set("search", debouncedSearch);
    try {
      const [rRes, sRes, setupRes] = await Promise.all([
        fetch(apiUrl(`/reviews?${params}`), { headers: { ...authHeaders() } }),
        fetch(apiUrl("/reviews/stats"), { headers: { ...authHeaders() } }),
        fetch(apiUrl("/reviews/setup"), { headers: { ...authHeaders() } }),
      ]);
      const [rBody, sBody, setupBody] = await Promise.all([
        rRes.json().catch(() => ({})),
        sRes.json().catch(() => ({})),
        setupRes.json().catch(() => ({})),
      ]);
      if (rRes.ok && Array.isArray(rBody.reviews)) setReviews(rBody.reviews);
      if (sRes.ok) setStats(sBody);
      if (setupRes.ok) setSetup(setupBody);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, ratingFilter, isReadFilter, hasReplyFilter, debouncedSearch]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onSync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch(apiUrl("/reviews/sync"), {
        method: "POST",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) {
        setSyncMsg(body.error || "Sync failed. Check Google connection.");
      } else {
        setSyncMsg(`Synced ${body.upserted ?? 0} reviews (${body.newReviews ?? 0} new).`);
        await loadData();
      }
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(null), 5000);
    }
  };

  const onToggleRead = async (review: Review) => {
    await fetch(apiUrl(`/reviews/${review.id}/read`), {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ isRead: !review.is_read }),
    });
    loadData();
  };

  const onToggleFlag = async (review: Review) => {
    await fetch(apiUrl(`/reviews/${review.id}/flag`), {
      method: "PUT",
      headers: { ...authHeaders() },
    });
    loadData();
  };

  const onAiSuggest = async (review: Review) => {
    setAiLoading(review.id);
    try {
      const res = await fetch(apiUrl(`/reviews/${review.id}/ai-suggest`), {
        method: "POST",
        headers: { ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.reply) {
        setReplyDraft((d) => ({ ...d, [review.id]: body.reply }));
      } else {
        alert(body.error || "AI unavailable");
      }
    } finally {
      setAiLoading(null);
    }
  };

  const onSubmitReply = async (review: Review) => {
    const comment = (replyDraft[review.id] || "").trim();
    if (!comment) return;
    setReplyLoading(review.id);
    try {
      const res = await fetch(apiUrl(`/reviews/${review.id}/reply`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ comment }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(body.error || "Could not post reply.");
      } else if (body.warning) {
        alert(body.warning);
      }
      setExpandedId(null);
      setReplyDraft((d) => ({ ...d, [review.id]: "" }));
      loadData();
    } finally {
      setReplyLoading(null);
    }
  };

  const maxCount = useMemo(() => {
    if (!stats) return 1;
    return Math.max(1, ...Object.values(stats.ratingDistribution));
  }, [stats]);

  const needsSetup =
    setup &&
    !setup.google.connected &&
    !setup.reviewUrl;

  return (
    <div className={styles.page}>
      <div className={styles.topRow}>
        <div>
          <h1 className={styles.title}>
            ⭐ Reviews
            {stats ? (
              <span className={styles.ratingBadge}>
                {stats.avgRating.toFixed(1)} ★ · {stats.total} reviews
              </span>
            ) : null}
          </h1>
          <p className={styles.sub}>Manage Google reviews, request feedback, and track performance.</p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <Link href="/reviews/send" className={styles.btnPrimary} style={{ textDecoration: "none" }}>
            ✉️ Send Request
          </Link>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={onSync}
            disabled={syncing}
          >
            {syncing ? "Syncing…" : "🔄 Sync Now"}
          </button>
        </div>
      </div>

      <ReviewsNav />

      {syncMsg ? (
        <div className={styles.insightCallout} style={{ marginBottom: "1rem" }}>
          {syncMsg}
        </div>
      ) : null}

      {needsSetup ? (
        <div className={styles.emptyState} style={{ marginBottom: "1rem" }}>
          <h3>Connect Google Business Profile to see reviews</h3>
          <p>
            You can still send review requests and use templates without connecting Google. But to see
            and reply to reviews here, complete setup.
          </p>
          <Link href="/reviews/setup" className={styles.btnPrimary} style={{ textDecoration: "none" }}>
            Go to Setup →
          </Link>
        </div>
      ) : null}

      <div className={styles.filters}>
        <div>
          <label htmlFor="rf">Rating</label>
          <select id="rf" value={ratingFilter} onChange={(e) => setRatingFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="5">5 stars</option>
            <option value="4">4 stars</option>
            <option value="3">3 stars</option>
            <option value="2">2 stars</option>
            <option value="1">1 star</option>
          </select>
        </div>
        <div>
          <label htmlFor="ur">Unread</label>
          <select id="ur" value={isReadFilter} onChange={(e) => setIsReadFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="false">Unread</option>
            <option value="true">Read</option>
          </select>
        </div>
        <div>
          <label htmlFor="nr">Needs reply</label>
          <select
            id="nr"
            value={hasReplyFilter}
            onChange={(e) => setHasReplyFilter(e.target.value)}
          >
            <option value="all">All</option>
            <option value="false">Needs reply</option>
            <option value="true">Replied</option>
          </select>
        </div>
        <div style={{ flex: 1, minWidth: "14rem" }}>
          <label htmlFor="sr">Search</label>
          <input
            id="sr"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Reviewer or keyword…"
            style={{ width: "100%" }}
          />
        </div>
      </div>

      <div className={styles.layout}>
        <div>
          {loading ? (
            <div className={styles.loading}>Loading reviews…</div>
          ) : reviews.length === 0 ? (
            <div className={styles.emptyState}>
              <h3>No reviews yet</h3>
              <p>Reviews will sync here every 30 minutes once Google is connected.</p>
            </div>
          ) : (
            <div className={styles.reviewList}>
              {reviews.map((r) => {
                const isExpanded = expandedId === r.id;
                const ratingClass =
                  r.star_rating === 5
                    ? styles.reviewRating5
                    : r.star_rating === 4
                    ? styles.reviewRating4
                    : r.star_rating === 3
                    ? styles.reviewRating3
                    : r.star_rating === 2
                    ? styles.reviewRating2
                    : styles.reviewRating1;
                return (
                  <article
                    key={r.id}
                    className={`${styles.reviewCard} ${!r.is_read ? styles.reviewCardUnread : ""} ${ratingClass}`}
                  >
                    <header className={styles.reviewHeader}>
                      <div className={styles.reviewLeft}>
                        {r.reviewer_photo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img className={styles.reviewAvatarImg} src={r.reviewer_photo_url} alt="" />
                        ) : (
                          <div
                            className={styles.reviewAvatar}
                            style={{ background: avatarColor(r.reviewer_name) }}
                          >
                            {initialsOf(r.reviewer_name)}
                          </div>
                        )}
                        <div>
                          <p className={styles.reviewName}>
                            {!r.is_read ? <span className={styles.reviewUnreadDot} /> : null}
                            {r.reviewer_name || "Anonymous"}
                          </p>
                          <p className={styles.reviewDate}>
                            {relTime(r.create_time)} · {absDate(r.create_time)}
                          </p>
                        </div>
                      </div>
                      <div className={styles.reviewRight}>
                        <StarRow rating={r.star_rating} />
                        <button
                          type="button"
                          className={`${styles.iconBtn} ${r.is_flagged ? styles.iconBtnActive : ""}`}
                          title={r.is_flagged ? "Unflag" : "Flag"}
                          onClick={() => onToggleFlag(r)}
                        >
                          {r.is_flagged ? "🔖" : "🏳️"}
                        </button>
                        <button
                          type="button"
                          className={styles.iconBtn}
                          title={r.is_read ? "Mark unread" : "Mark read"}
                          onClick={() => onToggleRead(r)}
                        >
                          {r.is_read ? "✉️" : "✅"}
                        </button>
                      </div>
                    </header>

                    {r.comment ? <p className={styles.reviewBody}>{r.comment}</p> : null}

                    {Array.isArray(r.tags) && r.tags.length > 0 ? (
                      <div className={styles.tagRow}>
                        {r.tags.map((t) => (
                          <span key={t} className={styles.tagChip}>
                            #{t}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    {r.reply_comment ? (
                      <div className={styles.reviewReply}>
                        <p className={styles.reviewReplyHead}>
                          Reply {r.replied_by_name ? `by ${r.replied_by_name}` : ""} ·{" "}
                          {relTime(r.reply_update_time)}
                        </p>
                        <p className={styles.reviewReplyText}>{r.reply_comment}</p>
                      </div>
                    ) : null}

                    <div className={styles.reviewActions}>
                      {!r.reply_comment ? (
                        <button
                          type="button"
                          className={styles.btnPrimary}
                          onClick={() => setExpandedId(isExpanded ? null : r.id)}
                          style={{ padding: "0.4rem 0.85rem", fontSize: "0.82rem" }}
                        >
                          {isExpanded ? "Cancel" : "Reply"}
                        </button>
                      ) : null}
                      {isExpanded ? (
                        <button
                          type="button"
                          className={styles.btnAi}
                          onClick={() => onAiSuggest(r)}
                          disabled={aiLoading === r.id}
                        >
                          {aiLoading === r.id ? "Thinking…" : "✨ AI Suggest Reply"}
                        </button>
                      ) : null}
                    </div>

                    {isExpanded ? (
                      <div className={styles.replyBox}>
                        <textarea
                          value={replyDraft[r.id] || ""}
                          onChange={(e) =>
                            setReplyDraft((d) => ({ ...d, [r.id]: e.target.value }))
                          }
                          placeholder="Write a thoughtful reply…"
                        />
                        <div className={styles.replyBoxActions}>
                          <button
                            type="button"
                            className={styles.btnPrimary}
                            onClick={() => onSubmitReply(r)}
                            disabled={replyLoading === r.id || !(replyDraft[r.id] || "").trim()}
                          >
                            {replyLoading === r.id ? "Posting…" : "Post Reply"}
                          </button>
                          <button
                            type="button"
                            className={styles.btnSecondary}
                            onClick={() => setExpandedId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <aside>
          <div className={styles.statsPanel}>
            <div className={styles.statsAvg}>
              <div className={styles.statsAvgNumber}>
                {stats ? stats.avgRating.toFixed(1) : "—"}
              </div>
              <div className={styles.statsAvgStars}>
                <StarRow rating={stats ? Math.round(stats.avgRating) : 0} />
              </div>
              <div className={styles.statsAvgTotal}>
                Based on {stats?.total ?? 0} reviews
              </div>
            </div>
            <div>
              {[5, 4, 3, 2, 1].map((n) => {
                const count = stats?.ratingDistribution[String(n)] ?? 0;
                const pct = Math.round((count / maxCount) * 100);
                return (
                  <div key={n} className={styles.distRow}>
                    <span className={styles.distLabel}>{n}★</span>
                    <div className={styles.distBar}>
                      <div
                        className={styles.distBarFill}
                        style={{ width: `${pct}%`, background: starColor(n) }}
                      />
                    </div>
                    <span className={styles.distCount}>{count}</span>
                  </div>
                );
              })}
            </div>
            <div className={styles.statsKpi}>
              <span>Response rate</span>
              <strong>{stats ? `${stats.responseRate}%` : "—"}</strong>
            </div>
            <div className={styles.statsKpi}>
              <span>Avg response time</span>
              <strong>
                {stats && stats.avgResponseTimeHours
                  ? `${stats.avgResponseTimeHours.toFixed(1)}h`
                  : "—"}
              </strong>
            </div>
            <div className={styles.statsKpi}>
              <span>Needs reply</span>
              <strong style={{ color: stats && stats.needsReply > 0 ? "#b32317" : undefined }}>
                {stats?.needsReply ?? 0}
              </strong>
            </div>
            <div className={styles.statsKpi}>
              <span>Unread</span>
              <strong>{stats?.unread ?? 0}</strong>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
