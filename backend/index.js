/**
 * Minimal Express API — expand with routes, DB access (e.g. pg + DATABASE_URL), auth, etc.
 * Nginx serves /api/* from the browser; paths here are without the /api prefix (see rpm-prestige.conf).
 */
import express from "express";

const app = express();
const port = Number(process.env.PORT) || 4000;

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "rpm-prestige-api" });
});

app.get("/", (_req, res) => {
  res.json({ message: "RPM Prestige API — use /health for a quick check." });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`API listening on ${port}`);
});
