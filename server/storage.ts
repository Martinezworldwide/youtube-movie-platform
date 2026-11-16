import type { HistoryItem, Movie, NewMovie, WatchlistItem } from "../shared/types.js";
import { searchMovies as searchMovieList } from "../shared/search.js";

const thumb = (youtubeId: string) => `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`;

/**
 * In-memory storage — same model as the original Replit app at runtime
 * (its Postgres/Drizzle layer was never actually used; see AUDIT.md §b).
 * Data resets on restart by design; curated movies auto-populate on boot.
 */
export class MemStorage {
  private movies = new Map<number, Movie>();
  private nextId = 1;
  private watchlist = new Map<string, WatchlistItem[]>();
  private history = new Map<string, HistoryItem[]>();

  getMovies(): Movie[] { return [...this.movies.values()]; }
  getMovie(id: number) { return this.movies.get(id); }
  getMoviesByCategory(cat: string) { return this.getMovies().filter((m) => m.category === cat); }
  searchMovies(q: string) {
    // Tokenized search shared with the static client — see shared/search.ts.
    return searchMovieList(this.getMovies(), q);
  }
  count() { return this.movies.size; }
  clearMovies() { this.movies.clear(); this.nextId = 1; }
  addMovie(input: NewMovie): Movie {
    const existing = this.getMovies().find((m) => m.youtubeId === input.youtubeId);
    if (existing) return existing;
    const movie: Movie = { ...input, id: this.nextId++, thumbnailUrl: input.thumbnailUrl || thumb(input.youtubeId) };
    this.movies.set(movie.id, movie);
    return movie;
  }
  /** Replace catalog atomically — callers must pass CONFIRMED data (see fetcher fix). */
  replaceAll(inputs: NewMovie[]) {
    const fresh = new Map<number, Movie>(); let id = 1;
    for (const input of inputs) {
      if ([...fresh.values()].some((m) => m.youtubeId === input.youtubeId)) continue;
      fresh.set(id, { ...input, id, thumbnailUrl: input.thumbnailUrl || thumb(input.youtubeId) }); id++;
    }
    this.movies = fresh; this.nextId = id;
    return this.count();
  }
  // watchlist
  getWatchlist(userId: string) { return this.watchlist.get(userId) ?? []; }
  addToWatchlist(userId: string, movieId: number) {
    const list = this.getWatchlist(userId);
    if (!list.some((i) => i.movieId === movieId))
      list.push({ userId, movieId, addedAt: new Date().toISOString() });
    this.watchlist.set(userId, list); return list;
  }
  removeFromWatchlist(userId: string, movieId: number) {
    const list = this.getWatchlist(userId).filter((i) => i.movieId !== movieId);
    this.watchlist.set(userId, list); return list;
  }
  // history + progress
  getHistory(userId: string) { return [...(this.history.get(userId) ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  recordHistory(userId: string, movieId: number, progressSeconds = 0) {
    const list = this.getHistory(userId).filter((i) => i.movieId !== movieId);
    const now = new Date().toISOString();
    list.unshift({ userId, movieId, progressSeconds, watchedAt: now, updatedAt: now });
    this.history.set(userId, list); return list;
  }
  updateProgress(userId: string, movieId: number, progressSeconds: number) {
    const list = this.getHistory(userId);
    const item = list.find((i) => i.movieId === movieId);
    if (item) { item.progressSeconds = progressSeconds; item.updatedAt = new Date().toISOString(); }
    else return this.recordHistory(userId, movieId, progressSeconds);
    this.history.set(userId, list); return list;
  }
  removeFromHistory(userId: string, movieId: number) {
    const list = this.getHistory(userId).filter((i) => i.movieId !== movieId);
    this.history.set(userId, list); return list;
  }
}
export const storage = new MemStorage();
