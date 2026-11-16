import { CURATED_MOVIES } from "./sample-movies.js";
import type { MemStorage } from "./storage.js";
import type { NewMovie } from "../shared/types.js";

const API_BASE = "https://www.googleapis.com/youtube/v3";

/**
 * Catalog strategy (rebuilt 2026-11-16): YouTube's REAL free movies.
 *
 * Two sources, both quota-cheap (playlistItems + videos.list = 1 unit/call;
 * no search.list hammering):
 *  1. YouTube's official "Movies & TV" storefront channel (UClgRkhTL3_hImCAmdLfDE4g,
 *     "YouTube Movies", 200M subs). Its "Free to watch" / "Newly Available Free To
 *     Watch Movies" playlists list the free-with-ads storefront movies. Verified
 *     2026-11-16: those videos report status.embeddable=true and oEmbed 200, so
 *     they play in the in-site player -> category "free-with-ads" (first section).
 *  2. Legit distributor free-movie channels (verified via the API: predominantly
 *     full-length uploads). Their uploads playlists -> genre categories.
 *
 * HARD filters for every candidate: embeddable, >= 60 minutes, title blocklist
 * (trailers/reactions/recaps/commentary/non-English dubs/...), dedupe by videoId
 * and normalized title. The 21 curated public-domain classics are kept only in
 * "public-domain-classics" and serve as the fallback when the API is unusable.
 */
export const OFFICIAL_MOVIES_CHANNEL_ID = "UClgRkhTL3_hImCAmdLfDE4g";
export const OFFICIAL_FREE_PLAYLISTS: { id: string; title: string }[] = [
  { id: "PLHPTxTxtC0iZVLY__17lVH9TjEFreUGi6", title: "Newly Available Free To Watch Movies" },
  { id: "PLHPTxTxtC0iZEVO3zMX2x6zw9xAkUCeq2", title: "Newly Available Free To Watch Movies" },
  { id: "PLHPTxTxtC0ibM-6U18JPCy2BAJiSnI-r5", title: "Free to watch" },
  { id: "PLHPTxTxtC0ia0v4dUvfVDQOwM2u1JXzDy", title: "Free to watch" },
  { id: "PLHPTxTxtC0ibVZrT2_WKWUl2SAxsKuKwx", title: "Free to watch" },
];

export const DISTRIBUTOR_CHANNELS: { id: string; name: string }[] = [
  { id: "UCGBzBkV-MinlBvHBzZawfLQ", name: "Movie Central" },
  { id: "UCNT5YLfnn2cQGIxGw8iOxJQ", name: "Film&Clips" },
  { id: "UCGADft_i4N1U5nXlfr2424A", name: "Boxoffice | NEW Full Movies in English" },
  { id: "UCX1nchEcBshItKBeJvH-YMw", name: "FREE MOVIES" },
  { id: "UCE_0zvmu1pMYZAgqyjW6qsQ", name: "Bigtime - Free Movies" },
  { id: "UCvRI1Nyvj9pAyHPzX7AviWQ", name: "Family Central" },
  { id: "UC6slmYIj9veZc_auiX3e5Dg", name: "CREEPY POPCORN" },
  { id: "UCtkUhM2VZjvoQEhOLmSzaNg", name: "Full Movies in English HD" },
];

const UPLOADS_PER_CHANNEL = 100; // 2 playlistItems pages of 50
const MIN_DURATION_SEC = 3600;

const BLOCK_PATTERNS: RegExp[] = [
  /\btrailer\b/i, /\bteaser\b/i, /\breaction\b/i, /\breview\b/i, /i watched/i,
  /explained/i, /top\s*10\b/i, /top\s*20\b/i, /\brecap\b/i,
  /commentary/i, /movie night/i, /\bpodcast\b/i, /best scenes/i, /\bclips?\b/i,
  /\bpart\s*[12]\b/i, /\bepisode\b/i, /\bstream\b/i,
  /pel[ií]cula completa/i, /film complet\b/i, /film lengkap/i, /filme completo/i,
  /comedy special/i, /stand[- ]up special/i,
  /pel[ií]cula/i, /filme completo/i, /film completo/i, /auf deutsch/i, /kompletter film/i,
  /ganzer film/i, /en espa[ñn]ol/i, /doblado/i, /subtitle indonesia/i, /subt[ií]tulos/i, /film bahasa/i,
];
function blockedBy(title: string): boolean {
  const test = title.replace(/film\s*&\s*clips/gi, ""); // channel branding, not the word "clips"
  return BLOCK_PATTERNS.some((re) => re.test(test));
}
const isDocumentary = (v: RawVideo) => /documentary/i.test(v.title + " " + v.description.slice(0, 200));

/** Display-title cleanup: distributor channels pad titles with plot hooks, cast lists and "Full Movie" tails. */
export function cleanTitle(rawTitle: string): string {
  let t = rawTitle.replace(/\s+/g, " ").trim();
  t = t.replace(/[\[\(]?\s*full movie\s*[\]\)]?/gi, " ");
  const parts = t.split("|").map((s) => s.trim()).filter(Boolean);
  let main = parts[0] || t;
  if (parts.length >= 2 && main.length > 45 && parts[1].length <= 55
    && !/^(full|new|free|best|top)\b/i.test(parts[1]) && !parts[1].includes(",")
    && parts[1].split(/\s+/).length <= 6) main = parts[1];
  if (main.length > 55 && main.includes(" - ")) main = main.split(" - ")[0];
  main = main.replace(/\s*\((?:19|20)\d{2}\)\s*/g, " ");
  main = main.replace(/\s*[-–—:]\s*(full|hd|4k|new|free)\b.*$/i, " ");
  main = main.replace(/\s*[-–—]\s*(19|20)\d{2}\s*[-–—].*$/, " ");
  main = main.replace(/[\p{Extended_Pictographic}\u{FE0F}]/gu, " ");
  main = main.replace(/\s+/g, " ").replace(/^[\s|•·\-–—:]+|[\s|•·\-–—:]+$/g, "").trim();
  return main || rawTitle.trim();
}
const normTitle = (t: string) => cleanTitle(t).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

const GENRE_RULES: [string, string, RegExp][] = [
  ["horror-central", "Horror", /horror|haunted|zombie|vampire|ghost|terror|nightmare|slasher|demon|paranormal|exorc|creepy|scary|curse|witch|scream|possess|evil|devil|ouija|seance/i],
  ["sci-fi", "Sci-Fi", /sci-?fi|science fiction|alien|space|robot|galaxy|starship|ufo|futuristic|time travel|planet of|outer space|spaceship|android|cyber|mutation|invasion/i],
  ["action", "Action", /action|war\b|warrior|battle|soldier|mission|commando|mercenary|martial arts|kung fu|revenge|sniper|special forces|navy seal|deadly|lethal|assassin|combat|fighter/i],
  ["comedy-collection", "Comedy", /comedy|funny|hilarious|parody|laugh|goofy|silly|wacky/i],
  ["thriller", "Thriller", /thriller|suspense|crime|murder|detective|noir|heist|kidnap|conspiracy|mystery|stalker|psycho|serial killer|fbi|cia|espionage|spy\b|undercover|gangster|mafia|cartel/i],
  ["drama", "Drama", /drama|romance|love|family|true story|wedding|christmas|heart|story of|based on/i],
];
function categorize(v: RawVideo): { slug: string; label: string } {
  const text = v.title + " " + v.description.slice(0, 300);
  for (const [slug, label, re] of GENRE_RULES) if (re.test(text)) return { slug, label };
  if (/creepy popcorn/i.test(v.channelTitle)) return { slug: "horror-central", label: "Horror" };
  return { slug: "drama", label: "Drama" };
}
function extractYear(v: RawVideo): number {
  const upYear = v.publishedAt ? new Date(v.publishedAt).getFullYear() : 0;
  const paren = v.title.match(/\((19\d{2}|20\d{2})\)/);
  if (paren) return Number(paren[1]);
  const t = v.title.match(/\b(19\d{2}|20[0-2]\d)\b/);
  if (t) return Number(t[1]);
  const years = [...v.description.matchAll(/\b(19[3-9]\d|20[0-2]\d)\b/g)].map((m) => Number(m[1])).filter((y) => !upYear || y <= upYear);
  if (years.length) {
    const freq: Record<number, number> = {};
    for (const y of years) freq[y] = (freq[y] || 0) + 1;
    return Number(Object.entries(freq).sort((a, b) => b[1] - a[1] || Number(b[0]) - Number(a[0]))[0][0]);
  }
  return upYear;
}
function parseDuration(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
}
const fmtDuration = (s: number) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h > 0 ? `${h}h ${m}m` : `${m}m`; };

interface RawVideo {
  videoId: string; title: string; description: string; publishedAt: string;
  channelTitle: string; durationSec: number; viewCount: number;
  embeddable: boolean; thumbnail?: string;
}

export interface FetchResult { movies: NewMovie[]; apiSuccess: boolean; apiError?: string; callsFailed: number; callsMade: number; }

interface YouTubeErrorBody { error?: { code?: number; message?: string; errors?: { reason?: string; message?: string }[] } }

/**
 * Fetcher rules (kept from the fixed version):
 * - Logs Google's FULL error body (status, reason, message) — never just "403 Forbidden".
 * - Failures are counted and propagated; total failure sets apiSuccess=false and the
 *   caller falls back to the curated classics instead of hammering on.
 */
export class YouTubeFetcher {
  private key?: string;
  callsMade = 0;
  callsFailed = 0;
  constructor(key = process.env.YOUTUBE_API_KEY) { this.key = key?.trim() || undefined; }
  get hasKey() { return !!this.key; }

  private async apiGet(path: string, params: Record<string, string>): Promise<any> {
    const url = new URL(API_BASE + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("key", this.key!);
    this.callsMade++;
    const res = await fetch(url);
    if (!res.ok) {
      this.callsFailed++;
      let body: YouTubeErrorBody = {};
      try { body = await res.json(); } catch { /* non-JSON error body */ }
      const reason = body.error?.errors?.[0]?.reason ?? "unknown";
      const message = body.error?.message ?? res.statusText;
      console.error(`[youtube] API error status=${res.status} reason=${reason} message="${message}" path=${path}`);
      const err = new Error(`YouTube API ${res.status} ${reason}: ${message}`) as Error & { status?: number; reason?: string };
      err.status = res.status; err.reason = reason;
      throw err;
    }
    return res.json();
  }

  private async playlistVideoIds(playlistId: string, max: number): Promise<string[]> {
    const ids: string[] = [];
    let pageToken = "";
    while (ids.length < max) {
      const params: Record<string, string> = { part: "contentDetails", maxResults: "50", playlistId };
      if (pageToken) params.pageToken = pageToken;
      const data = await this.apiGet("/playlistItems", params);
      for (const it of data.items ?? []) if (it?.contentDetails?.videoId) ids.push(it.contentDetails.videoId);
      pageToken = data.nextPageToken || "";
      if (!pageToken) break;
    }
    return ids.slice(0, max);
  }

  private async videoDetails(ids: string[]): Promise<RawVideo[]> {
    const out: RawVideo[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const data = await this.apiGet("/videos", { part: "snippet,contentDetails,statistics,status", id: ids.slice(i, i + 50).join(",") });
      for (const it of data.items ?? []) {
        out.push({
          videoId: it.id,
          title: it.snippet?.title ?? "",
          description: it.snippet?.description ?? "",
          publishedAt: it.snippet?.publishedAt ?? "",
          channelTitle: it.snippet?.channelTitle ?? "",
          durationSec: parseDuration(it.contentDetails?.duration ?? ""),
          viewCount: Number(it.statistics?.viewCount ?? 0),
          embeddable: it.status?.embeddable === true,
          thumbnail: it.snippet?.thumbnails?.high?.url,
        });
      }
    }
    return out;
  }

  private async uploadsPlaylistId(channelId: string): Promise<string | null> {
    const data = await this.apiGet("/channels", { part: "contentDetails", id: channelId });
    return data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads ?? null;
  }

  /** Fetch + filter one raw pool. Returns kept RawVideos (pre-categorization). */
  private collect(rawPool: RawVideo[], seenIds: Set<string>, seenTitles: Set<string>): RawVideo[] {
    const kept: RawVideo[] = [];
    for (const v of rawPool) {
      if (!v.embeddable) continue;
      if (v.durationSec < MIN_DURATION_SEC) continue;
      if (blockedBy(v.title)) continue;
      if (seenIds.has(v.videoId)) continue;
      const nt = normTitle(v.title);
      if (nt && seenTitles.has(nt)) continue;
      seenIds.add(v.videoId);
      if (nt) seenTitles.add(nt);
      kept.push(v);
    }
    return kept;
  }

  async fetchAll(): Promise<FetchResult> {
    const seenIds = new Set<string>();
    const seenTitles = new Set<string>();
    let firstError = "";

    // 1) Official YouTube Movies & TV free-with-ads playlists.
    const officialRaw: RawVideo[] = [];
    for (const pl of OFFICIAL_FREE_PLAYLISTS) {
      try {
        const ids = await this.playlistVideoIds(pl.id, 100);
        officialRaw.push(...await this.videoDetails([...new Set(ids)]));
      } catch (e: any) { if (!firstError) firstError = e.message; console.error(`[youtube] official playlist ${pl.id} failed: ${e.message}`); }
    }
    const officialKept = this.collect(officialRaw, seenIds, seenTitles);

    // 2) Distributor channel uploads.
    const distributorRaw: RawVideo[] = [];
    for (const ch of DISTRIBUTOR_CHANNELS) {
      try {
        const uploads = await this.uploadsPlaylistId(ch.id);
        if (!uploads) { console.error(`[youtube] channel ${ch.name} (${ch.id}) returned no uploads playlist`); continue; }
        const ids = await this.playlistVideoIds(uploads, UPLOADS_PER_CHANNEL);
        distributorRaw.push(...await this.videoDetails([...new Set(ids)]));
      } catch (e: any) { if (!firstError) firstError = e.message; console.error(`[youtube] channel ${ch.name} failed: ${e.message}`); }
    }
    const distributorKept = this.collect(distributorRaw, seenIds, seenTitles);

    const toMovie = (v: RawVideo, category: string, genreLabel: string): NewMovie => ({
      youtubeId: v.videoId,
      title: cleanTitle(v.title),
      year: extractYear(v),
      genre: genreLabel,
      category,
      description: v.description.slice(0, 500),
      duration: fmtDuration(v.durationSec),
      durationSeconds: v.durationSec,
      rating: "NR",
      channelTitle: v.channelTitle,
      thumbnailUrl: v.thumbnail,
    });

    const movies: NewMovie[] = [];
    for (const v of officialKept) movies.push(toMovie(v, "free-with-ads", categorize(v).label));

    const featuredIds = new Set(
      [...distributorKept].sort((a, b) => b.viewCount - a.viewCount)
        .filter((v) => !isDocumentary(v)).slice(0, 12).map((v) => v.videoId),
    );
    for (const v of distributorKept) {
      const cat = categorize(v);
      movies.push(toMovie(v, featuredIds.has(v.videoId) ? "featured" : cat.slug, cat.label));
    }

    const apiSuccess = movies.length > 0 && this.callsFailed === 0;
    return { movies, apiSuccess, apiError: firstError || undefined, callsFailed: this.callsFailed, callsMade: this.callsMade };
  }
}

export async function populateMovieDatabase(store: MemStorage): Promise<{ count: number; source: string; apiSuccess: boolean; apiError?: string }> {
  console.log("Starting to populate movie database with real YouTube free movies...");
  const curated = [...CURATED_MOVIES];
  const fetcher = new YouTubeFetcher();

  if (!fetcher.hasKey) {
    console.warn("[youtube] WARNING: YOUTUBE_API_KEY is not set — running in curated-only mode. Set a valid YouTube Data API v3 key to enable live fetching (see README).");
    const count = store.replaceAll(curated);
    console.log(`Added ${count} curated movies to database (curated-only mode)`);
    return { count, source: "curated-only (no API key)", apiSuccess: false, apiError: "YOUTUBE_API_KEY not set" };
  }

  let result: FetchResult;
  try {
    result = await fetcher.fetchAll();
  } catch (e: any) {
    console.error(`[youtube] Populate fetch failed: ${e.message}`);
    result = { movies: [], apiSuccess: false, apiError: e.message, callsFailed: 1, callsMade: fetcher.callsMade };
  }

  // Build the full confirmed dataset FIRST; only replace the catalog once the new
  // data is known non-empty. If the API yields nothing, fall back to the curated
  // classics so the site is never left empty.
  const apiMovies = result.movies;
  const combined = apiMovies.length > 0 ? [...apiMovies, ...curated] : [...curated];
  const deduped = combined.filter((m, i) => combined.findIndex((x) => x.youtubeId === m.youtubeId) === i);
  const count = store.replaceAll(deduped);
  console.log(`Movie database population completed! ${count} movies (api=${apiMovies.length}, curated=${curated.length}, apiSuccess=${result.apiSuccess}, apiCalls=${result.callsMade}, failedCalls=${result.callsFailed})`);
  return {
    count,
    source: apiMovies.length > 0 ? "YouTube API (official free-with-ads + distributor channels) + curated classics" : "curated (API failed)",
    apiSuccess: result.apiSuccess,
    apiError: result.apiError,
  };
}
