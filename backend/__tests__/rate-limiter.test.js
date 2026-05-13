/**
 * Token-bucket rate limiter tests.
 *
 * Uses Node's built-in test runner (no extra dep). Injects fake now()/wait()
 * so the test is deterministic — no real sleep.
 *
 * Run:  cd backend && node --test __tests__/rate-limiter.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter } from "../lib/appfolio-db/rate-limiter.js";

function makeFakeClock(start = 1_000_000) {
  let t = start;
  const waits = [];
  return {
    now: () => t,
    wait: (ms) => {
      waits.push(ms);
      t += ms;
      return Promise.resolve();
    },
    advance: (ms) => {
      t += ms;
    },
    get waits() {
      return waits;
    },
  };
}

test("waitMs returns 0 when below all caps", () => {
  const clock = makeFakeClock();
  const rl = createRateLimiter({ now: clock.now, wait: clock.wait });
  assert.equal(rl.waitMs(clock.now()), 0);
});

test("per-second window forces a wait at the 9th call within 1s", async () => {
  const clock = makeFakeClock();
  const rl = createRateLimiter({ now: clock.now, wait: clock.wait });
  // 8 calls in the same instant should all acquire without sleeping.
  for (let i = 0; i < 8; i++) {
    await rl.acquire();
  }
  assert.equal(clock.waits.length, 0, "first 8 should not have to wait");
  // 9th: the per-second cap has been hit. waitMs must be positive.
  const w = rl.waitMs(clock.now());
  assert.ok(w > 0, `expected positive wait, got ${w}`);
  assert.ok(w <= 1_010, `wait should be <= ~1s, got ${w}`);
});

test("per-minute window kicks in after 256 calls in <1min", async () => {
  const clock = makeFakeClock();
  const rl = createRateLimiter({ now: clock.now, wait: clock.wait });
  // Spread 256 calls across the minute so per-second never blocks
  // (256 / 60 ≈ 4.3 per second; well under 8/sec).
  for (let i = 0; i < 256; i++) {
    clock.advance(200); // 5/sec
    await rl.acquire();
  }
  // We've burned the per-minute cap. The next acquire must wait.
  const w = rl.waitMs(clock.now());
  assert.ok(w > 0, "per-minute cap should force a wait");
});

test("acquire eventually resolves under sustained load", async () => {
  const clock = makeFakeClock();
  const rl = createRateLimiter({ now: clock.now, wait: clock.wait });
  // 20 back-to-back at the same instant: 8 should pass, the rest queue.
  for (let i = 0; i < 20; i++) {
    await rl.acquire();
  }
  // We expect at least one forced wait, and the simulated clock advanced.
  assert.ok(clock.waits.length > 0, "some calls should have waited");
  assert.ok(clock.now() > 1_000_000, "fake clock should have advanced");
});

test("evicts old entries past longest window", async () => {
  const clock = makeFakeClock();
  const rl = createRateLimiter({ now: clock.now, wait: clock.wait });
  await rl.acquire();
  clock.advance(3_700_000); // > 1 hour
  // After advance, prior entry is outside the hour window — bucket
  // is effectively empty again. waitMs should be 0.
  assert.equal(rl.waitMs(clock.now()), 0);
});
