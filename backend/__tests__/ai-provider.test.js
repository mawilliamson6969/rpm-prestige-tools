import { test } from "node:test";
import assert from "node:assert/strict";
import { __testing } from "../lib/ai-provider.js";

const { classifyError, buildAnthropicBody, buildOpenAiBody } = __testing;

test("classifyError: timeout (AbortError) → failover", () => {
  const e = Object.assign(new Error("aborted"), { name: "AbortError" });
  assert.deepEqual(classifyError(e), { failover: true, reason: "timeout" });
});

test("classifyError: 5xx → failover", () => {
  assert.deepEqual(classifyError({ status: 503 }), { failover: true, reason: "http_503" });
});

test("classifyError: 429 → failover", () => {
  assert.deepEqual(classifyError({ status: 429 }), { failover: true, reason: "http_429" });
});

test("classifyError: 401/403 → no failover (backup would fail identically)", () => {
  assert.equal(classifyError({ status: 401 }).failover, false);
  assert.equal(classifyError({ status: 403 }).failover, false);
});

test("classifyError: 400 (bad request) → no failover", () => {
  assert.equal(classifyError({ status: 400 }).failover, false);
});

test("classifyError: connection-level errno → failover", () => {
  assert.equal(classifyError({ code: "ECONNRESET" }).failover, true);
  assert.equal(classifyError({ code: "ENOTFOUND" }).failover, true);
});

test("buildAnthropicBody: system goes in a separate field; messages stay as-is", () => {
  const body = buildAnthropicBody({
    model: "claude-x",
    systemPrompt: "be helpful",
    messages: [{ role: "user", content: "hi" }],
    stream: false,
    maxTokens: 256,
  });
  assert.equal(body.system, "be helpful");
  assert.equal(body.max_tokens, 256);
  assert.deepEqual(body.messages, [{ role: "user", content: "hi" }]);
  assert.equal("stream" in body, false);
});

test("buildOpenAiBody: system prompt is prepended as a system-role message", () => {
  const body = buildOpenAiBody({
    model: "gpt-x",
    systemPrompt: "be helpful",
    messages: [{ role: "user", content: "hi" }],
    stream: true,
    maxTokens: 256,
  });
  assert.equal(body.stream, true);
  assert.deepEqual(body.messages, [
    { role: "system", content: "be helpful" },
    { role: "user", content: "hi" },
  ]);
});

test("buildOpenAiBody: omits system message when no system prompt", () => {
  const body = buildOpenAiBody({
    model: "gpt-x",
    messages: [{ role: "user", content: "hi" }],
  });
  assert.deepEqual(body.messages, [{ role: "user", content: "hi" }]);
});
