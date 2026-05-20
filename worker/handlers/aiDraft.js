/**
 * AI draft step. Calls Claude to generate text based on a prompt that
 * may interpolate event/context values. The result is written back into
 * the run's context under `output_key` (default 'draft') so later steps
 * can reference it via {{context.draft}}.
 *
 * config: {
 *   prompt: string (with {{...}} already rendered upstream),
 *   output_key?: string,
 *   max_tokens?: number,
 *   model?: string,
 *   system?: string
 * }
 */

import Anthropic from "@anthropic-ai/sdk";

const DEFAULT_MODEL = "claude-opus-4-7";
const DEFAULT_MAX_TOKENS = 600;

let client;
function getClient() {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  client = new Anthropic({ apiKey });
  return client;
}

export async function runAiDraft({ config, context }) {
  const prompt = String(config.prompt || "").trim();
  if (!prompt) {
    return { status: "failed", error: "ai_draft: 'prompt' is required." };
  }
  const c = getClient();
  if (!c) {
    return { status: "failed", error: "ai_draft: ANTHROPIC_API_KEY is not set in the worker env." };
  }

  const model = String(config.model || DEFAULT_MODEL);
  const maxTokens = Number.isFinite(Number(config.max_tokens))
    ? Math.min(Math.max(64, Number(config.max_tokens)), 4096)
    : DEFAULT_MAX_TOKENS;
  const outputKey = String(config.output_key || "draft").trim() || "draft";

  try {
    const messages = [{ role: "user", content: prompt }];
    const req = { model, max_tokens: maxTokens, messages };
    if (config.system && String(config.system).trim()) {
      req.system = String(config.system);
    }
    const resp = await c.messages.create(req);
    const text = (resp.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    // Mutate the shared context so downstream steps can reference the
    // draft via {{context.<output_key>}}.
    if (context && typeof context === "object") {
      context[outputKey] = text;
    }

    return {
      status: "success",
      output: {
        output_key: outputKey,
        text_preview: text.length > 120 ? `${text.slice(0, 117)}...` : text,
        model,
        usage: resp.usage ?? null,
      },
    };
  } catch (err) {
    // The Anthropic SDK surfaces `.status` on APIError instances. 429
    // (rate limit), 529 (overloaded), and 5xx are retry-worthy; 4xx
    // means our prompt or auth is wrong — don't burn budget on retries.
    const status = typeof err.status === "number" ? err.status : null;
    const transient =
      status === 408 ||
      status === 429 ||
      status === 529 ||
      (status != null && status >= 500 && status < 600);
    return {
      status: "failed",
      transient,
      status_code: status ?? undefined,
      error: `ai_draft: ${err.message}`,
    };
  }
}
