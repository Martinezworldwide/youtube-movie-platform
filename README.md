# YouTube Movie Platform — off-Replit migration

Netflix-style site for browsing and playing public-domain movies hosted on YouTube.
Migrated off Replit (see `AUDIT.md` for the full audit of the original app and what was fixed).

**Repository:** https://github.com/Martinezworldwide/youtube-movie-platform

**Live site (GitHub Pages):** https://martinezworldwide.github.io/youtube-movie-platform/
— **Status: LIVE** (enabled 2026-11-16, verified HTTP 200; source: `main` / `/docs`).
The Pages build runs in static mode: the bundled 21-movie catalog loads
without the Express server, and watchlist/history are kept in the browser's localStorage.

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
```

The client automatically falls back to static mode when `/api` is unreachable:
catalog comes from `client/src/catalog.ts` (generated from `server/sample-movies.ts`)
and watchlist/history use localStorage. No API key is ever used client-side.

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

## Catalog note

Curated movies are public-domain classics whose YouTube IDs were each verified live via the
keyless oEmbed endpoint on 2026-11-16 (full table in `AUDIT.md`). oEmbed verifies existence,
not rights — the underlying films are well-known public-domain works, but check the specific
upload if you ever take this public.
