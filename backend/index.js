/**
 * Minimal Express API — expand with routes, DB access (e.g. pg + DATABASE_URL), auth, etc.
 * Nginx serves /api/* from the browser; paths here are without the /api prefix (see rpm-prestige.conf).
 */
import express from "express";
import {
  fetchAppfolioUnitsJson,
  getUnitsForResponse,
  summarizeOccupancy,
} from "./lib/appfolio.js";

const app = express();
const port = Number(process.env.PORT) || 4000;

app.use(express.json());

// Allow local dev when the Next.js dev server calls Express directly (different origin).
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

function sendAppfolioError(res, err) {
  if (err.code === "APPFOLIO_CONFIG") {
    return res.status(503).json({
      error: err.message,
      code: err.code,
    });
  }
  if (err.code === "APPFOLIO_NETWORK" || err.code === "APPFOLIO_PARSE") {
    return res.status(502).json({
      error: err.message,
      code: err.code,
    });
  }
  if (err.code === "APPFOLIO_HTTP") {
    return res.status(502).json({
      error: err.message,
      code: err.code,
      status: err.status,
    });
  }
  console.error(err);
  return res.status(500).json({
    error: "Unexpected server error.",
    code: "INTERNAL",
  });
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "rpm-prestige-api" });
});

app.get("/", (_req, res) => {
  res.json({ message: "RPM Prestige API — use /health for a quick check." });
});

/** Proxies AppFolio GET /units.json (browser: /api/appfolio/units). */
app.get("/appfolio/units", async (_req, res) => {
  try {
    const json = await fetchAppfolioUnitsJson();
    res.json(json);
  } catch (err) {
    sendAppfolioError(res, err);
  }
});

/** Occupancy summary derived from units (browser: /api/dashboard/occupancy). */
app.get("/dashboard/occupancy", async (_req, res) => {
  try {
    const units = await getUnitsForResponse();
    const summary = summarizeOccupancy(units);
    res.json({
      ...summary,
      refreshedAt: new Date().toISOString(),
    });
  } catch (err) {
    sendAppfolioError(res, err);
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`API listening on ${port}`);
});
