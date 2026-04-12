import { getAskHistoryForUser, runAskAi } from "../lib/ask-ai.js";

export async function postAsk(req, res) {
  const question = req.body?.question;
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    res.status(503).json({
      error: "AI assistant is not configured. Contact your administrator.",
      code: "AI_NOT_CONFIGURED",
    });
    return;
  }
  try {
    const out = await runAskAi(req.user.id, question);
    res.json(out);
  } catch (e) {
    if (e.code === "AI_NOT_CONFIGURED") {
      res.status(503).json({
        error: "AI assistant is not configured. Contact your administrator.",
        code: "AI_NOT_CONFIGURED",
      });
      return;
    }
    if (e.code === "RATE_LIMIT") {
      res.status(429).json({ error: e.message, code: "RATE_LIMIT" });
      return;
    }
    if (e.code === "BAD_REQUEST") {
      res.status(400).json({ error: e.message, code: "BAD_REQUEST" });
      return;
    }
    if (e.code === "AI_QUERY_FAILED") {
      res.status(502).json({
        error: e.message,
        code: "AI_QUERY_FAILED",
      });
      return;
    }
    console.error("[ask]", e);
    res.status(500).json({ error: "Unexpected error.", code: "INTERNAL" });
  }
}

export async function getAskHistory(req, res) {
  try {
    const history = await getAskHistoryForUser(req.user.id);
    res.json({ history });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load history." });
  }
}
