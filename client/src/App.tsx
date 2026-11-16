import { useEffect, useMemo, useRef, useState } from "react";
import type { Movie } from "../../shared/types";
import { CATEGORIES } from "../../shared/types";
import { CATALOG } from "./catalog";

const api = async (path: string, init?: RequestInit) => {
  const r = await fetch(`/api${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...init });
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json();
};

// ---- Static (no-server) mode: bundled catalog + localStorage ----
// Used when the Express API is unreachable, e.g. the GitHub Pages build in /docs.
const LS_WL = "ymp-watchlist";
const LS_HIST = "ymp-history";
const lsGet = <T,>(k: string, dflt: T): T => { try { return JSON.parse(localStorage.getItem(k) || "") as T; } catch { return dflt; } };
const lsSet = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
type HistEntry = { movie: Movie; progressSeconds: number };
const staticWatchlist = (): Movie[] => lsGet<number[]>(LS_WL, []).map((id) => CATALOG.find((m) => m.id === id)).filter(Boolean) as Movie[];
const staticHistory = (): HistEntry[] => lsGet<{ movieId: number; progressSeconds: number }[]>(LS_HIST, [])
  .map((h) => ({ movie: CATALOG.find((m) => m.id === h.movieId) as Movie, progressSeconds: h.progressSeconds })).filter((h) => h.movie);
const saveStaticHistory = (hist: HistEntry[]) => lsSet(LS_HIST, hist.map((h) => ({ movieId: h.movie.id, progressSeconds: h.progressSeconds })));

function Card({ movie, onOpen }: { movie: Movie; onOpen: (m: Movie) => void }) {
  return (
    <button className="card" onClick={() => onOpen(movie)}>
      <img src={movie.thumbnailUrl} alt={movie.title} loading="lazy" />
      <div className="meta"><b>{movie.title}</b><span>{movie.year} · {movie.genre} · {movie.duration}</span></div>
    </button>
  );
}

function Row({ title, movies, onOpen }: { title: string; movies: Movie[]; onOpen: (m: Movie) => void }) {
  if (!movies.length) return null;
  return (<section style={{ padding: "0 4%", marginTop: 28 }}>
    <h2 style={{ fontSize: 20, margin: "0 0 10px" }}>{title}</h2>
    <div className="row-scroll">{movies.map((m) => <Card key={m.id} movie={m} onOpen={onOpen} />)}</div>
  </section>);
}

export default function App() {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [watchlist, setWatchlist] = useState<Movie[]>([]);
  const [history, setHistory] = useState<HistEntry[]>([]);
  const [selected, setSelected] = useState<Movie | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Movie[]>([]);
  const [status, setStatus] = useState("");
  const [staticMode, setStaticMode] = useState(false);
  const staticRef = useRef(false);
  const progressTimer = useRef<number | undefined>(undefined);

  const enterStatic = () => {
    staticRef.current = true; setStaticMode(true);
    setMovies(CATALOG); setWatchlist(staticWatchlist()); setHistory(staticHistory());
  };

  const loadAll = async () => {
    if (staticRef.current) { setMovies(CATALOG); setWatchlist(staticWatchlist()); setHistory(staticHistory()); return; }
    const [all, wl, hist] = await Promise.all([api("/movies"), api("/watchlist"), api("/history")]);
    setMovies(all); setWatchlist(wl); setHistory(hist);
  };
  useEffect(() => { loadAll().catch(() => enterStatic()); }, []);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    if (staticRef.current) {
      const q = query.toLowerCase();
      setResults(CATALOG.filter((m) => [m.title, m.genre, m.description, String(m.year)].some((f) => f.toLowerCase().includes(q))));
      return;
    }
    const t = setTimeout(() => api(`/search?q=${encodeURIComponent(query)}`).then(setResults).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [query]);

  const hero = useMemo(() => movies.find((m) => m.category === "free-with-ads") ?? movies.find((m) => m.category === "featured") ?? movies[0], [movies]);
  const inList = (id: number) => watchlist.some((m) => m.id === id);

  const toggleList = async (m: Movie) => {
    if (staticRef.current) {
      const ids = lsGet<number[]>(LS_WL, []);
      lsSet(LS_WL, ids.includes(m.id) ? ids.filter((i) => i !== m.id) : [...ids, m.id]);
      setWatchlist(staticWatchlist()); return;
    }
    if (inList(m.id)) await api(`/watchlist/${m.id}`, { method: "DELETE" });
    else await api("/watchlist", { method: "POST", body: JSON.stringify({ movieId: m.id }) });
    setWatchlist(await api("/watchlist"));
  };

  const openMovie = async (m: Movie) => {
    setSelected(m);
    let p = 0; window.clearInterval(progressTimer.current);
    if (staticRef.current) {
      const hist = [{ movie: m, progressSeconds: 0 }, ...staticHistory().filter((h) => h.movie.id !== m.id)];
      setHistory(hist); saveStaticHistory(hist);
      progressTimer.current = window.setInterval(() => {
        p += 10;
        setHistory((prev) => { const next = prev.map((h) => h.movie.id === m.id ? { ...h, progressSeconds: p } : h); saveStaticHistory(next); return next; });
      }, 10000);
      return;
    }
    await api("/history", { method: "POST", body: JSON.stringify({ movieId: m.id, progressSeconds: 0 }) }).catch(() => {});
    setHistory(await api("/history").catch(() => history));
    // Simulated progress heartbeat while the player is open (iframe has no time API without YT JS API).
    progressTimer.current = window.setInterval(() => { p += 10; api(`/history/${m.id}/progress`, { method: "POST", body: JSON.stringify({ progressSeconds: p }) }).catch(() => {}); }, 10000);
  };
  const closeMovie = () => { window.clearInterval(progressTimer.current); setSelected(null); loadAll().catch(() => {}); };

  const refresh = async () => {
    if (staticRef.current) { setStatus(`Static mode — ${CATALOG.length} curated movies bundled in this build (no server). Run the Express version for live YouTube fetching.`); enterStatic(); return; }
    setStatus("Refreshing movies…");
    try {
      const r = await api("/populate-movies", { method: "POST" });
      setStatus(`${r.count} movies loaded (${r.source})${r.apiError ? ` — API: ${r.apiError}` : ""}`);
      await loadAll();
    } catch { enterStatic(); }
  };

  return (<div>
    <header style={{ position: "sticky", top: 0, zIndex: 20, display: "flex", gap: 24, alignItems: "center", padding: "12px 4%", background: "linear-gradient(#000,#141414)" }}>
      <div style={{ color: "#e50914", fontWeight: 900, fontSize: 26, letterSpacing: 1 }}>MOVIES</div>
      <nav style={{ display: "flex", gap: 16, color: "#ddd", fontSize: 14 }}><span>Home</span><span>Movies</span><span>My List</span></nav>
      <div style={{ marginLeft: "auto", position: "relative" }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search titles…" style={{ background: "#000", border: "1px solid #555", color: "#fff", padding: "8px 10px", width: 240 }} />
        {results.length > 0 && (<div style={{ position: "absolute", right: 0, top: 40, width: 320, background: "#1f1f1f", border: "1px solid #333", borderRadius: 6, overflow: "hidden" }}>
          {results.slice(0, 8).map((m) => <div key={m.id} onClick={() => { openMovie(m); setQuery(""); }} style={{ padding: "8px 10px", cursor: "pointer", fontSize: 14 }}>{m.title} <span style={{ color: "#999" }}>({m.year})</span></div>)}
        </div>)}
      </div>
      <button onClick={refresh} style={{ background: "#e50914", color: "#fff", border: 0, padding: "8px 14px", borderRadius: 4 }}>Refresh Movies</button>
    </header>
    {staticMode && <div style={{ padding: "6px 4%", color: "#9fd3a8", fontSize: 13 }}>Static mode — bundled catalog, watchlist &amp; history saved in this browser.</div>}
    {status && <div style={{ padding: "6px 4%", color: "#ffb3b3", fontSize: 13 }}>{status}</div>}

    {hero && (<section style={{ position: "relative", minHeight: 380, display: "flex", alignItems: "flex-end", padding: "40px 4%", background: `linear-gradient(to top,#141414 5%,transparent 60%), url(${hero.thumbnailUrl}) center/cover` }}>
      <div style={{ maxWidth: 560 }}>
        <h1 style={{ fontSize: 44, margin: "0 0 8px" }}>{hero.title}</h1>
        <p style={{ color: "#ddd" }}>{hero.year} · {hero.genre} · {hero.duration}</p>
        <p>{hero.description}</p>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => openMovie(hero)} style={{ padding: "10px 22px", fontSize: 16, border: 0, borderRadius: 4 }}>▶ Play</button>
          <button onClick={() => toggleList(hero)} style={{ padding: "10px 18px", fontSize: 16, border: 0, borderRadius: 4, background: "rgba(109,109,110,.7)", color: "#fff" }}>{inList(hero.id) ? "✓ In My List" : "+ My List"}</button>
        </div>
      </div>
    </section>)}

    <main style={{ paddingBottom: 60 }}>
      {Object.entries(CATEGORIES).map(([slug, label]) => (
        <Row key={slug} title={label} movies={movies.filter((m) => m.category === slug)} onOpen={openMovie} />
      ))}
      {[...new Set(movies.map((m) => m.category))].filter((c) => !(c in CATEGORIES)).map((c) => (
        <Row key={c} title={c} movies={movies.filter((m) => m.category === c)} onOpen={openMovie} />
      ))}
      <Row title="My List" movies={watchlist} onOpen={openMovie} />
      <Row title="Recently Watched" movies={history.map((h) => h.movie)} onOpen={openMovie} />
      {!movies.length && <p style={{ padding: "20px 4%", color: "#aaa" }}>No movies available in this category — server is populating, or click Refresh Movies.</p>}
    </main>

    {selected && (<div onClick={closeMovie} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#181818", borderRadius: 8, maxWidth: 880, width: "100%", overflow: "hidden" }}>
        <div style={{ aspectRatio: "16/9", background: "#000" }}>
          <iframe title={selected.title} width="100%" height="100%" style={{ border: 0 }}
            src={`https://www.youtube.com/embed/${selected.youtubeId}?autoplay=1&rel=0`} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
            <div><h2 style={{ margin: 0 }}>{selected.title}</h2><p style={{ color: "#aaa" }}>{selected.year} · {selected.genre} · {selected.duration} · {selected.rating}</p></div>
            <button onClick={closeMovie} style={{ background: "transparent", color: "#fff", border: "1px solid #555", borderRadius: "50%", width: 34, height: 34 }}>✕</button>
          </div>
          <p>{selected.description}</p>
          <button onClick={() => toggleList(selected)} style={{ padding: "8px 16px", border: 0, borderRadius: 4 }}>{inList(selected.id) ? "✓ In My List" : "+ My List"}</button>
        </div>
      </div>
    </div>)}
  </div>);
}
