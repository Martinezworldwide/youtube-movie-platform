import { CURATED_MOVIES } from "./sample-movies.js";
import type { MemStorage } from "./storage.js";
import type { NewMovie } from "../shared/types.js";

const API_BASE = "https://www.googleapis.com/youtube/v3";

// Known legitimate / public-domain-oriented channels searched by the original app.
const KNOWN_CHANNEL_QUERIES = [
  "public domain full movie classic",
  "public domain horror full movie",
  "film noir full movie public domain",
];
export const CATEGORY_QUERIES: Record<string, string> = {
  "featured": "classic full movie public domain",
  "warner-bros-classics": "classic hollywood full movie",
  "recent-blockbusters": "full movie classic",
  "horror-central": "classic horror full movie public domain",
  "comedy-collection": "classic comedy full movie public domain",
  "indie-films": "independent classic full movie",
  "international": "classic international full movie subtitles",
};

export interface FetchResult { movies: NewMovie[]; apiSuccess: boolean; apiError?: string; callsFailed: number; callsMade: number; }

interface YouTubeErrorBody { error?: { code?: number; message?: string; errors?: { reason?: string; message?: string }[] } }

/**
 * FIXED fetcher (see AUDIT.md §a, §c):
 * - Logs Google's FULL error body (status, reason, message) — never just "403 Forbidden".
 * - A failed call is counted and propagated; total API failure sets apiSuccess=false.
 * - Callers stop after total failure instead of hammering every category.
 */
export class YouTubeFetcher {
  private key?: string;
  constructor(key = process.env.YOUTUBE_API_KEY) { this.key = key?.trim() || undefined; }
  get hasKey() { return !!this.key; }

  private async apiGet(path: string, params: Record<string, string>): Promise<any> {
    const url = new URL(API_BASE + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("key", this.key!);
    const res = await fetch(url);
    if (!res.ok) {
      let body: YouTubeErrorBody = {};
      try { body = await res.json(); } catch { /* non-JSON error body */ }
      const reason = body.error?.errors?.[0]?.reason ?? "unknown";
      const message = body.error?.message ?? res.statusText;
      // FULL error body in the log — this is the fix for the original silent 403s.
      console.error(`[youtube] API error status=${res.status} reason=${reason} message="${message}" path=${path}`);
      const err = new Error(`YouTube API ${res.status} ${reason}: ${message}`) as Error & { status?: number; reason?: string };
      err.status = res.status; err.reason = reason;
      throw err;
    }
    return res.json();
  }

  private mapItem(item: any, category: string): NewMovie | null {
    const vid = item?.id?.videoId; const sn = item?.snippet;
    if (!vid || !sn?.title) return null;
    return {
      youtubeId: vid, title: sn.title, year: sn.publishedAt ? new Date(sn.publishedAt).getFullYear() : 0,
      genre: "Classic", category, description: (sn.description || "").slice(0, 500),
      duration: "", durationSeconds: 0, rating: "NR", channelTitle: sn.channelTitle,
      thumbnailUrl: sn.thumbnails?.high?.url,
    };
  }

  async search(query: string, category: string, max = 10): Promise<NewMovie[]> {
    const data = await this.apiGet("/search", { part: "snippet", type: "video", videoEmbeddable: "true", videoDuration: "long", maxResults: String(max), q: query });
    return (data.items ?? []).map((i: any) => this.mapItem(i, category)).filter(Boolean) as NewMovie[];
  }

  /** FIXED: failures are NOT swallowed — they are counted and rethrown as a failed result. */
  async fetchFromKnownChannels(): Promise<FetchResult> {
    const out: NewMovie[] = []; let failed = 0; let lastError = "";
    for (const q of KNOWN_CHANNEL_QUERIES) {
      try { out.push(...await this.search(q, "featured", 8)); }
      catch (e: any) { failed++; lastError = e.message; console.error(`[youtube] known-channels query failed: ${e.message}`); }
    }
    return { movies: out, apiSuccess: failed < KNOWN_CHANNEL_QUERIES.length, apiError: failed ? lastError : undefined, callsFailed: failed, callsMade: KNOWN_CHANNEL_QUERIES.length };
  }
}

export async function populateMovieDatabase(store: MemStorage): Promise<{ count: number; source: string; apiSuccess: boolean; apiError?: string }> {
  console.log("Starting to populate movie database with real YouTube content...");
  console.log("Loading curated movie collection...");
  const curated = [...CURATED_MOVIES];
  const fetcher = new YouTubeFetcher();

  if (!fetcher.hasKey) {
    // FIXED: missing key is a clear warning, not a throw — curated movies still load.
    console.warn("[youtube] WARNING: YOUTUBE_API_KEY is not set — running in curated-only mode. Set a valid YouTube Data API v3 key to enable live fetching (see README).");
    const count = store.replaceAll(curated);
    console.log(`Added ${count} curated movies to database (curated-only mode)`);
    return { count, source: "curated-only (no API key)", apiSuccess: false, apiError: "YOUTUBE_API_KEY not set" };
  }

  let apiMovies: NewMovie[] = []; let apiSuccess = true; let apiError: string | undefined;
  try {
    console.log("Attempting to fetch additional movies from YouTube API...");
    console.log("Fetching movies from known legitimate channels...");
    const known = await fetcher.fetchFromKnownChannels();
    apiMovies.push(...known.movies); apiSuccess = known.apiSuccess; apiError = known.apiError;

    if (!apiSuccess && known.movies.length === 0) {
      // FIXED: total API failure — stop here instead of hammering all 7 categories (original bug).
      console.error(`[youtube] Total API failure (${known.callsFailed}/${known.callsMade} calls failed: ${apiError}). Skipping category fetches. Existing movies are kept unless curated replacement succeeds below.`);
    } else {
      for (const [category, query] of Object.entries(CATEGORY_QUERIES)) {
        try { console.log(`Fetching movies for category: ${category}`); apiMovies.push(...await fetcher.search(query, category, 6)); }
        catch (e: any) { apiSuccess = false; apiError = e.message; console.error(`[youtube] Category ${category} failed, stopping further category fetches: ${e.message}`); break; }
      }
    }
  } catch (e: any) { apiSuccess = false; apiError = e.message; console.error(`[youtube] Populate fetch failed: ${e.message}`); }

  // FIXED: build the full confirmed dataset FIRST, and only replace the catalog
  // once we know the new data is non-empty. The original cleared the DB up front,
  // so a failed fetch left the site empty.
  const combined = [...curated, ...apiMovies];
  const deduped = combined.filter((m, i) => combined.findIndex((x) => x.youtubeId === m.youtubeId) === i);
  if (deduped.length === 0) {
    console.error("[youtube] No confirmed movies to load — keeping existing catalog untouched.");
    return { count: store.count(), source: "unchanged (no confirmed data)", apiSuccess, apiError };
  }
  const count = store.replaceAll(deduped);
  console.log(`Movie database population completed! ${count} movies (curated=${curated.length}, api=${count - curated.length > 0 ? count - curated.length : 0}, apiSuccess=${apiSuccess})`);
  return { count, source: apiSuccess ? "curated + YouTube API" : "curated (API failed)", apiSuccess, apiError };
}
