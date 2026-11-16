import { Router, type Request } from "express";
import { randomUUID } from "node:crypto";
import { storage } from "./storage.js";
import { populateMovieDatabase } from "./youtube-fetcher.js";

declare module "express-session" { interface SessionData { userId: string } }

export function userId(req: Request): string {
  if (!req.session.userId) req.session.userId = randomUUID();
  return req.session.userId;
}

export const router = Router();

router.get("/movies/count", (_req, res) => res.json({ count: storage.count() }));
router.get("/movies/category/:category", (req, res) => res.json(storage.getMoviesByCategory(req.params.category)));
router.get("/movies/:id", (req, res) => {
  const movie = storage.getMovie(Number(req.params.id));
  if (!movie) return res.status(404).json({ error: "Movie not found" });
  res.json(movie);
});
router.get("/movies", (_req, res) => res.json(storage.getMovies()));
router.get("/search", (req, res) => res.json(storage.searchMovies(String(req.query.q ?? ""))));

router.get("/watchlist", (req, res) => {
  const ids = new Set(storage.getWatchlist(userId(req)).map((i) => i.movieId));
  res.json(storage.getMovies().filter((m) => ids.has(m.id)));
});
router.post("/watchlist", (req, res) => {
  const movieId = Number(req.body?.movieId);
  if (!storage.getMovie(movieId)) return res.status(404).json({ error: "Movie not found" });
  storage.addToWatchlist(userId(req), movieId);
  res.json({ ok: true });
});
router.delete("/watchlist/:movieId", (req, res) => { storage.removeFromWatchlist(userId(req), Number(req.params.movieId)); res.json({ ok: true }); });

router.get("/history", (req, res) => {
  res.json(storage.getHistory(userId(req)).map((h) => ({ ...h, movie: storage.getMovie(h.movieId) })).filter((h) => h.movie));
});
router.post("/history", (req, res) => {
  const movieId = Number(req.body?.movieId);
  if (!storage.getMovie(movieId)) return res.status(404).json({ error: "Movie not found" });
  storage.recordHistory(userId(req), movieId, Number(req.body?.progressSeconds ?? 0));
  res.json({ ok: true });
});
router.put("/history/:movieId/progress", (req, res) => {
  storage.updateProgress(userId(req), Number(req.params.movieId), Number(req.body?.progressSeconds ?? 0));
  res.json({ ok: true });
});
router.post("/history/:movieId/progress", (req, res) => {
  storage.updateProgress(userId(req), Number(req.params.movieId), Number(req.body?.progressSeconds ?? 0));
  res.json({ ok: true });
});
router.delete("/history/:movieId", (req, res) => { storage.removeFromHistory(userId(req), Number(req.params.movieId)); res.json({ ok: true }); });

router.post("/populate-movies", async (_req, res) => {
  try { res.json({ message: "Movie population completed", ...(await populateMovieDatabase(storage)) }); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});
router.post("/clear-movies", (_req, res) => { storage.clearMovies(); res.json({ ok: true, count: 0 }); });
