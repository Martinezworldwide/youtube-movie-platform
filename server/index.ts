import express from "express";
import session from "express-session";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { router, userId } from "./routes.js";
import { storage } from "./storage.js";
import { populateMovieDatabase } from "./youtube-fetcher.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 5000);
const isProd = process.env.NODE_ENV === "production";

const app = express();
app.use(express.json());
if (!process.env.SESSION_SECRET) console.warn("[session] SESSION_SECRET not set — using a dev-only fallback. Set it in .env for anything real.");
app.use(session({
  secret: process.env.SESSION_SECRET || "dev-only-change-me",
  resave: false, saveUninitialized: true,
  cookie: { httpOnly: true, sameSite: "lax" },
}));
app.use((req, _res, next) => { userId(req); next(); }); // session-based userId, like the original
app.use("/api", router);

const clientDir = path.join(root, "dist/client");
if (fs.existsSync(clientDir)) {
  app.use(express.static(clientDir));
  app.get("*", (req, res, next) => req.path.startsWith("/api") ? next() : res.sendFile(path.join(clientDir, "index.html")));
} else if (!isProd) {
  // Dev: API on :5000, Vite client on :5173 (proxies /api here). Also serve a
  // tiny hint page at / so hitting :5000 directly isn't a dead end.
  app.get("/", (_req, res) => res.type("html").send(`<!doctype html><title>YouTube Movie Platform API</title><body style="background:#141414;color:#fff;font-family:sans-serif;padding:2rem"><h1>API running on :${PORT}</h1><p>Dev UI: run <code>npm run dev:client</code> and open http://localhost:5173 — or <code>npm run build</code> then restart with NODE_ENV=production for a single-server app on this port.</p><p><a style="color:#e50914" href="/api/movies/count">/api/movies/count</a></p></body>`));
}

app.listen(PORT, async () => {
  console.log(`[express] serving on port ${PORT}`);
  // FIXED: auto-populate on startup when empty (original required a button click).
  if (storage.count() === 0) {
    try { const r = await populateMovieDatabase(storage); console.log(`[startup] auto-populated ${r.count} movies (${r.source})`); }
    catch (e: any) { console.error(`[startup] auto-populate failed: ${e.message}`); }
  }
});
