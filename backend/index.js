/**
 * Express API — Nginx serves /api/* from the browser; paths here are without the /api prefix.
 */
import express from "express";
import {
  fetchAppfolioUnitsJson,
  getUnitsForResponse,
  summarizeOccupancy,
} from "./lib/appfolio.js";
import { ensureOwnerTerminationSchema } from "./lib/db.js";
import {
  exportOwnerTerminationsCsv,
  listOwnerTerminations,
  patchOwnerTermination,
  postOwnerTermination,
} from "./routes/ownerTermination.js";

const app = express();
const port = Number(process.env.PORT) || 4000;

app.use(express.json({ limit: "12mb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
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

app.get("/appfolio/units", async (_req, res) => {
  try {
    const json = await fetchAppfolioUnitsJson();
    res.json(json);
  } catch (err) {
    sendAppfolioError(res, err);
  }
});

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

app.post("/forms/owner-termination", postOwnerTermination);
app.get("/forms/owner-termination/export.csv", exportOwnerTerminationsCsv);
app.get("/forms/owner-termination", listOwnerTerminations);
app.patch("/forms/owner-termination/:id", patchOwnerTermination);

async function start() {
  if (process.env.DATABASE_URL) {
    try {
      await ensureOwnerTerminationSchema();
      console.log("Database schema OK (owner_termination_requests).");
    } catch (e) {
      console.error("Could not ensure database schema:", e.message);
    }
  } else {
    console.warn("DATABASE_URL not set — owner termination routes may fail.");
  }

  app.listen(port, "0.0.0.0", () => {
    console.log(`API listening on ${port}`);
  });
}

start();
