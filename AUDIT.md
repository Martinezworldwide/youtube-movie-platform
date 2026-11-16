# Audit — YouTubeMoviePlatform (Replit, @acetoymaker) & Off-Replit Migration

Audited live in Replit 2026-11-15 23:56–23:59 ET; migration built locally 2026-11-16.
Original stack: TypeScript, React 18 + Vite, Express + TS, PostgreSQL + Drizzle ORM (declared),
TanStack Query, shadcn/ui + Radix, Tailwind, Wouter. Run: `npm run dev` → `tsx server/index.ts`, port 5000.

## Findings

### (a) YouTube API 403 — root cause
The app itself starts, serves and renders fine. The **only** functional defect is that every
YouTube Data API v3 call returns **HTTP 403 Forbidden** (reproduced live: 12× in one populate run),
so no API movies are ever added — only the 10 hardcoded films from `server/sample-movies.ts` show.
The stored `YOUTUBE_API_KEY` secret exists (the fetcher's "key not found" throw never fired) but is
rejected by Google. Likely causes, in order: YouTube Data API v3 **not enabled** in the key's Google
Cloud project; key **API/referrer/IP restrictions** blocking a server call from Replit; key revoked/
regenerated; or project quota/standing. The Replit Agent reached the same conclusion ~4 months
earlier and its question ("Have you enabled the YouTube Data API v3…?") was still unanswered.

Compounding it, the original fetcher logged only `YouTube API error: 403 Forbidden` and **discarded
Google's response body** (which contains `error.errors[].reason` + `error.message` — e.g.
`accessNotConfigured`, `quotaExceeded`, `keyInvalid`), making the exact cause undiagnosable from logs.
**Fix applied:** the migrated fetcher parses the error JSON and logs
`status=… reason=… message="…"` in full, and propagates it in the populate result.

### (b) Runtime storage is in-memory; Postgres/Drizzle is unused at runtime
Despite `shared/schema.ts` (Drizzle pg tables) and a Postgres dependency, the running app uses
`MemStorage` (in-memory Maps). Consequences: **all data resets on restart**, no DB migration is
needed to move the app, and watchlist/history were never durable. The migration keeps MemStorage
deliberately and says so in code/README — same behaviour, no fake persistence.

### (c) Fetcher `apiSuccess` bug
In the original `fetchFromKnownChannels`, per-query failures were caught and swallowed (logged,
empty array returned), so the caller saw success and `apiSuccess` stayed **true** even when every
call 403'd. Populate then proceeded through all 7 category fetches, hammering a dead key.
**Fix applied:** failures are counted (`callsFailed/callsMade`), `apiSuccess=false` on total
failure, category fetching **stops** on total failure / first category failure.

### (d) Populate clears the database before confirming new data
Original `populateMovieDatabase` deleted all movies first, then fetched. Any failure after the
clear left the site empty. **Fix applied:** the new dataset (curated + API) is fully built and
deduped first; `storage.replaceAll()` swaps the catalog only when the new set is non-empty.
If nothing is confirmed, the existing catalog is left untouched.

### (e) No auto-populate on startup
A fresh/restarted app served `{"count":0}` / `[]` and every section read "No movies available"
until someone clicked **Load Movies**. **Fix applied:** on boot, if `count===0`, the server
auto-populates (curated at minimum) and logs the result.

### (f) Replit export lock-in
Verified 2026-11-16 00:14 ET: the Replit UI for this account offers **no zip download and no git
remote**. Server core files were transcribed via the Replit Shell; client UI files were **not**
captured. That is why this migration rebuilds the client cleanly instead of copying it.

### (g) Preserved vs rebuilt
**Preserved (behaviour/API):** all original endpoints and shapes — `GET /api/movies`,
`/api/movies/count`, `/api/movies/category/:category`, `/api/movies/:id`, `/api/search?q=`,
`GET/POST/DELETE /api/watchlist`, `/api/history` (+ progress), `POST /api/populate-movies`,
`POST /api/clear-movies`; Express on port 5000; session-based `userId`; the original 10 curated
movies (titles/years/categories); Netflix-style UX (hero, category rows, modal YouTube embed player,
My List, Recently Watched); secrets by name only (`YOUTUBE_API_KEY`, `SESSION_SECRET`).
**Rebuilt/simplified:** client UI rewritten from scratch (single `App.tsx`, no shadcn/Tailwind/
TanStack/Wouter — plain React + inline styles, functionally equivalent); Drizzle pg schema replaced
by plain TS types in `shared/types.ts` (runtime never used it — see §b); lean dependency set
(express, express-session, react, react-dom + vite/tsx/typescript dev tooling).
**Fixed:** §a logging, §c apiSuccess/stop-on-failure, §d no-clear-before-confirm,
§e auto-populate, missing-key = warning + curated-only mode (original threw / failed opaquely).

## Curated catalog — oEmbed verification (mandatory gate)
Method: `curl https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=<ID>&format=json`
— only IDs returning **HTTP 200** were admitted. Verified **2026-11-16 05:15–05:17 UTC**.
Rejected during verification (NOT included): `d7HXb7E7Qho` (The General alt upload, 401),
`lnklvVxNMP8` (Gulliver's Travels alt upload, 404), `QG-YeTteDmQ` (404).

| # | Title (year) | Category | YouTube ID | oEmbed |
|---|---|---|---|---|
| 1 | Me at the zoo (2005) | featured | jNQXAC9IVRw | 200 |
| 2 | Charade (1963) | featured | VhGNhwOtbVs | 200 |
| 3 | The Cabinet of Dr. Caligari (1920) | featured | IP0KB2XC29o | 200 |
| 4 | Night of the Living Dead (1968) | horror-central | jclhVKSC0Tk | 200 |
| 5 | House on Haunted Hill (1959) | horror-central | gukIa86UAQI | 200 |
| 6 | Carnival of Souls (1962) | horror-central | udpi8Zfih94 | 200 |
| 7 | The Phantom of the Opera (1925) | horror-central | cnf-VVmpC5I | 200 |
| 8 | Plan 9 from Outer Space (1956) | comedy-collection | crEWfY1DPEo | 200 |
| 9 | The Little Shop of Horrors (1960) | comedy-collection | PC7pHTlHHn4 | 200 |
| 10 | His Girl Friday (1940) | comedy-collection | UzQWJNNg8DU | 200 |
| 11 | Nosferatu (1922) | horror-central | 6HsyDHtKv6Q | 200 |
| 12 | The Last Man on Earth (1964) | horror-central | t5vJLaQ9dKY | 200 |
| 13 | Metropolis (1927) | featured | yzK7UlWYDbI | 200 |
| 14 | Gulliver's Travels (1939) | featured | vvuiAPvEU6E | 200 |
| 15 | Detour (1945) | film-noir | rteEkq6qz1w | 200 |
| 16 | D.O.A. (1950) | film-noir | BrAGwCigqKw | 200 |
| 17 | The Stranger (1946) | film-noir | xwLxpdox884 | 200 |
| 18 | Scarlet Street (1945) | film-noir | cXVKJLgcXwM | 200 |
| 19 | Reefer Madness (1936) | comedy-collection | esfKfTBGadg | 200 |
| 20 | Safety Last! (1923) | silent-classics | HteglhuU2e0 | 200 |
| 21 | The General (1926) | silent-classics | RW77C75dkWw | 200 |

**Total: 21 movies** — featured 5, horror-central 6, comedy-collection 4, film-noir 4, silent-classics 2.
Note: oEmbed 200 proves the video exists and is embeddable-metadata-visible; it does not by itself
prove full-length/public-domain status — titles were chosen as well-known public-domain classics and
sourced from search results describing them as full movies (see README caveat).

## Still blocked
Live (non-curated) fetching still requires a **valid YouTube Data API v3 key** whose Cloud project
has the API enabled and no server-blocking restrictions. No key was used, tested, or invented here.
The app is fully functional in curated-only mode without one. Not deployed anywhere.
