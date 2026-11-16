# YouTube Movie Platform — off-Replit migration

Netflix-style site for browsing and playing public-domain movies hosted on YouTube.
Migrated off Replit (see `AUDIT.md` for the full audit of the original app and what was fixed).

**Repository:** https://github.com/Martinezworldwide/youtube-movie-platform

**Live site (GitHub Pages):** https://martinezworldwide.github.io/youtube-movie-platform/
— **Status: LIVE** (enabled 2026-11-16, verified HTTP 200; source: `main` / `/docs`).
The Pages build runs in static mode: the catalog loads at runtime from chunked
JSON data files under `docs/data/` (see "Catalog data" below) without the Express
server, and watchlist/history are kept in the browser's localStorage.

## Run it

```bash
cd ~/workspace/youtube-movie-platform
npm install
npm run build          # builds the client into dist/client
npm start              # Express on http://localhost:5000  (single server: API + UI)
```

Exact start command after install/build: `npm start`
Stop with Ctrl-C. (Dev split mode, optional: `npm run dev` for the API on :5000 plus
`npm run dev:client` for Vite on :5173, which proxies /api.)

## Static build (GitHub Pages, in /docs)

```bash
npx vite build --base ./ --outDir docs --emptyOutDir && touch docs/.nojekyll
node scripts/build-chunks.mjs   # writes docs/data/catalog-*.json + docs/data/index.json
```

(vite's root is `client/`, so the build lands in `client/docs/` — move its contents
into the project `docs/`, keep `docs/.nojekyll`, then run the chunk script.)

The client automatically falls back to static mode when `/api` is unreachable:
it fetches `data/index.json` (manifest) plus every listed `data/catalog-*.json`
chunk and concatenates them into the in-memory catalog; watchlist/history use
localStorage. No API key is ever used client-side.

On startup the server **auto-populates** the curated catalog if the catalog is empty —
no button click needed. Storage is in-memory (same as the original at runtime), so the
catalog, watchlist and history reset on restart; curated movies reload automatically.

## Configuration

Copy `.env.example` values into your environment (no real values live in this repo):

- `YOUTUBE_API_KEY` — optional. Blank = curated-only mode (21 verified movies, clear warning in logs).
- `SESSION_SECRET` — session signing secret; a dev-only fallback is used (with a warning) if blank.
- `PORT` — default 5000.

## Getting live YouTube fetching working (fixing the original 403)

The original Replit app's key was rejected with 403 on every call. To use a fresh, valid key:

1. Go to Google Cloud Console (under the account that should own the key, e.g. acetoymaker@gmail.com).
2. Create/select a project → **APIs & Services → Library → enable "YouTube Data API v3"**.
3. **APIs & Services → Credentials → Create API key.**
4. On the key's restrictions: for server-side use from your own machine, set **Application
   restrictions = None** (do NOT use HTTP-referrer restrictions — those are for browser keys and
   will 403 a server call; IP restrictions only if you pin your server's egress IP), and
   API restrictions = YouTube Data API v3 only.
5. Put it in `YOUTUBE_API_KEY`, restart, then click **Refresh Movies** (or `POST /api/populate-movies`).
6. If it still fails, the server log now prints Google's full error —
   `[youtube] API error status=403 reason=accessNotConfigured message="…"` — the `reason`
   tells you exactly which of the above is wrong (`accessNotConfigured` = API not enabled,
   `quotaExceeded` = quota, `keyInvalid` = bad/revoked key, `forbidden`/`ipRefererBlocked` = restrictions).

## API

`GET /api/movies` · `GET /api/movies/count` · `GET /api/movies/category/:category` ·
`GET /api/movies/:id` · `GET /api/search?q=` · `GET|POST /api/watchlist`, `DELETE /api/watchlist/:movieId` ·
`GET|POST /api/history`, `POST|PUT /api/history/:movieId/progress`, `DELETE /api/history/:movieId` ·
`POST /api/populate-movies` · `POST /api/clear-movies`
Watchlist/history are per-browser-session (cookie), like the original.

## Catalog data

The full catalog (47,754 movies as of 2026-11-16: the complete official
free-with-ads sweep of the YouTube Movies channel plus distributor free-movie
channels) is ~25 MB of JSON — too large for a JS bundle or any single
GitHub-pushable file (the connector hard limit is 16,777,216 bytes/file, and
large pushes fail well below that). Layout:

- **Canonical export:** a `GET /api/movies` JSON dump (`ymp-movies.json`, kept
  outside this repo because of its size). `client/src/catalog.ts` is *generated*
  from that export for local/server use and is likewise not committed at full
  size.
- **Canonical committed form:** the chunk set under `docs/data/` —
  `index.json` manifest (`{count, chunks, chunkCounts}`) + `catalog-001.json`,
  `catalog-002.json`, … each ≤ ~2.6 MB, split on movie boundaries. Regenerate
  with `node scripts/build-chunks.mjs [input.json] [outDir]`.
- The static client loads the manifest + chunks at runtime; the Express server
  mode is unaffected and still preferred when `/api` is reachable.

## Catalog note

Curated movies are public-domain classics whose YouTube IDs were each verified live via the
keyless oEmbed endpoint on 2026-11-16 (full table in `AUDIT.md`). oEmbed verifies existence,
not rights — the underlying films are well-known public-domain works, but check the specific
upload if you ever take this public.
