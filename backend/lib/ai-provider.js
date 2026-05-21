const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

const DEFAULT_MODELS = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4o",
};

const DEFAULT_TIMEOUT_MS = 35_000;
const DEFAULT_MAX_TOKENS = 4096;

export function isAiConfigured() {
  return Boolean(
    process.env.ANTHROPIC_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim()
  );
}

function getKey(provider) {
  const key = (provider === "anthropic"
    ? process.env.ANTHROPIC_API_KEY
    : process.env.OPENAI_API_KEY)?.trim();
  if (!key) {
    const err = new Error(`${provider.toUpperCase()}_API_KEY is not set.`);
    err.code = "AI_NOT_CONFIGURED";
    err.provider = provider;
    throw err;
  }
  return key;
}

function classifyError(err) {
  // network/abort errors are infra failures → eligible for failover
  if (err?.name === "AbortError") return { failover: true, reason: "timeout" };
  if (err?.code === "ECONNRESET" || err?.code === "ENOTFOUND" || err?.code === "ECONNREFUSED")
    return { failover: true, reason: "connection_error" };
  if (typeof err?.status === "number") {
    const s = err.status;
    if (s === 400 || s === 401 || s === 403) return { failover: false, reason: `http_${s}` };
    if (s === 429 || s >= 500) return { failover: true, reason: `http_${s}` };
    return { failover: false, reason: `http_${s}` };
  }
  // unknown error — treat as infra failure
  return { failover: true, reason: "unknown_error" };
}

async function logFailover({ feature, primary, fallback, reason, statusCode, errorMessage }) {
  try {
    const { getPool } = await import("./db.js");
    const pool = getPool();
    await pool.query(
      `INSERT INTO ai_failover_log
         (feature, primary_provider, primary_model, fallback_provider, fallback_model, reason, status_code, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        feature || null,
        primary.provider,
        primary.model,
        fallback?.provider || null,
        fallback?.model || null,
        reason,
        statusCode ?? null,
        errorMessage ? String(errorMessage).slice(0, 2000) : null,
      ]
    );
  } catch (e) {
    console.error("[ai-provider] failed to log failover", e);
  }
}

function buildAnthropicBody({ model, systemPrompt, messages, stream, maxTokens }) {
  const body = {
    model,
    max_tokens: maxTokens ?? DEFAULT_MAX_TOKENS,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  };
  if (systemPrompt) body.system = systemPrompt;
  if (stream) body.stream = true;
  return body;
}

function buildOpenAiBody({ model, systemPrompt, messages, stream, maxTokens }) {
  const finalMessages = [];
  if (systemPrompt) finalMessages.push({ role: "system", content: systemPrompt });
  for (const m of messages) finalMessages.push({ role: m.role, content: m.content });
  const body = {
    model,
    messages: finalMessages,
    max_tokens: maxTokens ?? DEFAULT_MAX_TOKENS,
  };
  if (stream) body.stream = true;
  return body;
}

async function httpJson(url, { headers, body, timeoutMs, signal }) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
  clearTimeout(t);
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const msg =
      parsed?.error?.message ||
      parsed?.error ||
      parsed?.message ||
      text ||
      `HTTP ${res.status}`;
    const err = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    err.status = res.status;
    err.body = parsed;
    throw err;
  }
  return parsed;
}

async function callAnthropicOnce({ apiKey, model, systemPrompt, messages, maxTokens, timeoutMs }) {
  const body = buildAnthropicBody({ model, systemPrompt, messages, stream: false, maxTokens });
  const res = await httpJson(ANTHROPIC_URL, {
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body,
    timeoutMs,
  });
  const text = (res?.content || [])
    .filter((b) => b?.type === "text")
    .map((b) => b.text || "")
    .join("\n")
    .trim();
  return { text, raw: res };
}

async function callOpenAiOnce({ apiKey, model, systemPrompt, messages, maxTokens, timeoutMs }) {
  const body = buildOpenAiBody({ model, systemPrompt, messages, stream: false, maxTokens });
  const res = await httpJson(OPENAI_URL, {
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body,
    timeoutMs,
  });
  const text = (res?.choices?.[0]?.message?.content || "").trim();
  return { text, raw: res };
}

async function* anthropicStream({ apiKey, model, systemPrompt, messages, maxTokens, timeoutMs }) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        accept: "text/event-stream",
      },
      body: JSON.stringify(
        buildAnthropicBody({ model, systemPrompt, messages, stream: true, maxTokens })
      ),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
  if (!res.ok) {
    clearTimeout(t);
    const errText = await res.text().catch(() => "");
    const err = new Error(errText || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  try {
    for await (const evt of parseSse(res.body)) {
      if (evt.event === "content_block_delta") {
        const data = safeJson(evt.data);
        const delta = data?.delta?.text;
        if (delta) yield delta;
      } else if (evt.event === "message_stop") {
        return;
      }
    }
  } finally {
    clearTimeout(t);
  }
}

async function* openaiStream({ apiKey, model, systemPrompt, messages, maxTokens, timeoutMs }) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        accept: "text/event-stream",
      },
      body: JSON.stringify(
        buildOpenAiBody({ model, systemPrompt, messages, stream: true, maxTokens })
      ),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
  if (!res.ok) {
    clearTimeout(t);
    const errText = await res.text().catch(() => "");
    const err = new Error(errText || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  try {
    for await (const evt of parseSse(res.body)) {
      if (!evt.data || evt.data === "[DONE]") {
        if (evt.data === "[DONE]") return;
        continue;
      }
      const data = safeJson(evt.data);
      const delta = data?.choices?.[0]?.delta?.content;
      if (delta) yield delta;
    }
  } finally {
    clearTimeout(t);
  }
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

async function* parseSse(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const evt = { event: "message", data: "" };
        for (const line of chunk.split("\n")) {
          if (line.startsWith("event:")) evt.event = line.slice(6).trim();
          else if (line.startsWith("data:")) {
            evt.data = (evt.data ? evt.data + "\n" : "") + line.slice(5).trim();
          }
        }
        if (evt.data) yield evt;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
}

/**
 * Unified AI call with Anthropic-primary, OpenAI-fallback semantics.
 *
 * Non-streaming: returns { text, provider, model, raw }.
 *
 * Streaming: returns { provider, model, stream }, where `stream` is an async
 * iterable of string deltas. Failover happens only if the primary fails before
 * the first token arrives. Mid-stream failures yield a final
 * "[connection interrupted — please regenerate]" message and end.
 *
 * Never fails over on 400/401/403; those errors bubble up unchanged.
 */
export async function askAI({
  provider,
  model,
  systemPrompt,
  messages,
  stream = false,
  feature,
  maxTokens,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    const e = new Error("messages must be a non-empty array");
    e.code = "BAD_REQUEST";
    throw e;
  }

  const explicit = provider === "anthropic" || provider === "openai";
  const primaryName = explicit ? provider : "anthropic";
  const fallbackName = explicit ? null : "openai";
  const primaryModel = model || DEFAULT_MODELS[primaryName];
  const fallbackModel = fallbackName ? DEFAULT_MODELS[fallbackName] : null;

  const primary = { provider: primaryName, model: primaryModel };
  const fallback = fallbackName ? { provider: fallbackName, model: fallbackModel } : null;

  if (stream) {
    return startStreaming({
      primary,
      fallback,
      systemPrompt,
      messages,
      maxTokens,
      timeoutMs,
      feature,
    });
  }

  let primaryApiKey;
  try {
    primaryApiKey = getKey(primaryName);
  } catch (e) {
    if (!fallback) throw e;
    await logFailover({
      feature,
      primary,
      fallback,
      reason: "missing_primary_key",
      errorMessage: e.message,
    });
    const fbKey = getKey(fallback.provider);
    return runNonStreaming(fallback, fbKey, { systemPrompt, messages, maxTokens, timeoutMs });
  }

  try {
    return await runNonStreaming(primary, primaryApiKey, {
      systemPrompt,
      messages,
      maxTokens,
      timeoutMs,
    });
  } catch (err) {
    const { failover, reason } = classifyError(err);
    if (!failover || !fallback) throw err;
    let fbKey;
    try {
      fbKey = getKey(fallback.provider);
    } catch (keyErr) {
      // can't fall back; surface original
      throw err;
    }
    await logFailover({
      feature,
      primary,
      fallback,
      reason,
      statusCode: err.status,
      errorMessage: err.message,
    });
    return runNonStreaming(fallback, fbKey, {
      systemPrompt,
      messages,
      maxTokens,
      timeoutMs,
    });
  }
}

async function runNonStreaming({ provider, model }, apiKey, opts) {
  const fn = provider === "anthropic" ? callAnthropicOnce : callOpenAiOnce;
  const { text, raw } = await fn({ apiKey, model, ...opts });
  return { text, provider, model, raw };
}

async function startStreaming({
  primary,
  fallback,
  systemPrompt,
  messages,
  maxTokens,
  timeoutMs,
  feature,
}) {
  const tryOpen = async (target) => {
    const apiKey = getKey(target.provider);
    const gen =
      target.provider === "anthropic"
        ? anthropicStream({ apiKey, model: target.model, systemPrompt, messages, maxTokens, timeoutMs })
        : openaiStream({ apiKey, model: target.model, systemPrompt, messages, maxTokens, timeoutMs });
    // Pull the first token (or surface the open/first-chunk error) eagerly so
    // we can fail over BEFORE any bytes reach the caller.
    const iter = gen[Symbol.asyncIterator]();
    const first = await iter.next();
    return { iter, first };
  };

  let active;
  let used = primary;
  try {
    active = await tryOpen(primary);
  } catch (err) {
    const { failover, reason } = classifyError(err);
    if (!failover || !fallback) throw err;
    try {
      getKey(fallback.provider);
    } catch (keyErr) {
      throw err;
    }
    await logFailover({
      feature,
      primary,
      fallback,
      reason,
      statusCode: err.status,
      errorMessage: err.message,
    });
    active = await tryOpen(fallback);
    used = fallback;
  }

  const { iter, first } = active;

  async function* combined() {
    if (!first.done && first.value) yield first.value;
    try {
      while (true) {
        const n = await iter.next();
        if (n.done) return;
        if (n.value) yield n.value;
      }
    } catch (err) {
      // mid-stream failure: do NOT restart — surface a single closing chunk
      yield "\n\n[connection interrupted — please regenerate]";
    }
  }

  return { provider: used.provider, model: used.model, stream: combined() };
}

export const __testing = { classifyError, buildAnthropicBody, buildOpenAiBody };
