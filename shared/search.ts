/**
 * Tokenized search shared by the Express API (server/storage.ts) and the
 * static client (client/src/App.tsx) so both modes behave identically.
 *
 * Replaces the old exact-substring match, which silently missed titles when
 * the query skipped a word ("assault precinct" vs "Assault On Precinct 13")
 * or differed in punctuation ("oceans eleven" vs "Ocean's Eleven").
 *
 * Rules: normalize both sides (lowercase, apostrophes dropped, other
 * punctuation -> space, whitespace collapsed); split the query into tokens;
 * a movie matches only if EVERY token appears in its combined normalized
 * title + genre + description + year + channel. Ranking: exact normalized
 * title first, then all-tokens-in-title, then matches elsewhere; ties keep
 * catalog order. Dependency-free.
 */
export interface SearchableMovie {
  title: string;
  genre: string;
  description: string;
  year: number;
  channelTitle?: string;
}

export function normalizeSearchText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’ʼ]/g, "'")
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function searchMovies<T extends SearchableMovie>(movies: T[], query: string): T[] {
  const nq = normalizeSearchText(query);
  const tokens = nq.split(" ").filter(Boolean);
  if (!tokens.length) return [...movies];
  const scored: { m: T; tier: number; titleHits: number; idx: number }[] = [];
  movies.forEach((m, idx) => {
    const nTitle = normalizeSearchText(m.title);
    const haystack = normalizeSearchText(
      [m.title, m.genre, m.description, String(m.year), m.channelTitle ?? ""].join(" "),
    );
    if (!tokens.every((t) => haystack.includes(t))) return;
    const titleHits = tokens.filter((t) => nTitle.includes(t)).length;
    const tier = nTitle === nq ? 0 : titleHits === tokens.length ? 1 : 2;
    scored.push({ m, tier, titleHits, idx });
  });
  scored.sort((a, b) => a.tier - b.tier || b.titleHits - a.titleHits || a.idx - b.idx);
  return scored.map((s) => s.m);
}
