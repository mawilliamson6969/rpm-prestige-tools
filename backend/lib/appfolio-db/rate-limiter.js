/**
 * Triple-window token bucket for the AppFolio Database API.
 *
 * AppFolio publishes three concurrent rate ceilings:
 *   8/sec, 256/min, 4096/hour
 *
 * A request must satisfy ALL three. The bucket tracks request timestamps
 * in a single sorted array and checks each window before granting a slot.
 *
 * Hot-path note: we keep one array and drop timestamps older than the
 * longest window (1 hour). For typical traffic this stays well under a
 * few thousand entries, which is cheap to iterate.
 *
 * For tests, `now()` and `wait()` can be injected so behavior is
 * deterministic without real sleep.
 */

export const APPFOLIO_RATE_LIMITS = Object.freeze({
  perSecond: { max: 8, windowMs: 1_000 },
  perMinute: { max: 256, windowMs: 60_000 },
  perHour: { max: 4_096, windowMs: 3_600_000 },
});

export function createRateLimiter({
  limits = APPFOLIO_RATE_LIMITS,
  now = () => Date.now(),
  wait = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const timestamps = [];
  const longestWindowMs = Math.max(
    limits.perSecond.windowMs,
    limits.perMinute.windowMs,
    limits.perHour.windowMs
  );

  /** Drop timestamps older than the longest tracked window. */
  function evict(t) {
    const cutoff = t - longestWindowMs;
    while (timestamps.length && timestamps[0] < cutoff) {
      timestamps.shift();
    }
  }

  /** ms to wait until the next slot is available. 0 if available now. */
  function waitMs(t) {
    evict(t);
    const checks = [
      { count: limits.perSecond.max, windowMs: limits.perSecond.windowMs },
      { count: limits.perMinute.max, windowMs: limits.perMinute.windowMs },
      { count: limits.perHour.max, windowMs: limits.perHour.windowMs },
    ];
    let worst = 0;
    for (const { count, windowMs } of checks) {
      if (timestamps.length < count) continue;
      // The oldest call within this window's lookback is the one whose
      // expiry releases a slot. With N timestamps total, the window's
      // oldest in-window entry is at index (N - count).
      const idx = timestamps.length - count;
      const oldest = timestamps[idx];
      const release = oldest + windowMs - t;
      if (release > worst) worst = release;
    }
    return worst > 0 ? worst + 5 : 0;
  }

  async function acquire() {
    for (;;) {
      const t = now();
      const w = waitMs(t);
      if (w === 0) {
        timestamps.push(t);
        return;
      }
      await wait(w);
    }
  }

  return {
    acquire,
    waitMs,
    /** Test/debug helpers. */
    _state: () => ({ count: timestamps.length, limits }),
    _reset: () => {
      timestamps.length = 0;
    },
  };
}
