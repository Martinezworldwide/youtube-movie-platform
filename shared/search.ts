/**
 * Search v2 — shared by the Express API (server/storage.ts) and the static
 * client (client/src/App.tsx) so both modes behave identically.
 *
 * v1 was tokenized exact-substring matching with tier ranking. It found the
 * right movie only when the catalog was fully loaded and the query was tidy:
 * no typo tolerance, no stopword handling, ties broken by harvest order (so
 * "the ring" surfaced 2,593 results in arbitrary order), and regional
 * editions ("Deadpool 2 (Subtitulada)", "(VF)") ranked as high as the
 * English edition. v2 keeps the normalization, and adds:
 *
 * - Word-level token matching with flexibility: a query token matches a
 *   haystack word when the word starts with the token, or the edit distance
 *   is <= 1 (token length >= 5) or <= 2 (length >= 8). Small bounded
 *   Levenshtein, length-prefiltered, over per-movie prepared word lists
 *   cached in a WeakMap so repeat keystrokes don't re-normalize 47k records.
 * - Two passes: strict (every query token must match somewhere in
 *   title+genre+description+year+channel), then — only if strict finds
 *   nothing — relaxed: stopwords (the, a, an, of, and, in, on) are dropped
 *   and at least half of the remaining tokens (min 1) must match.
 * - Real scoring instead of tiers (see scoreMovie): exact-title and
 *   title-token bonuses, official-channel / free-with-ads boosts, runtime
 *   and recency bonuses, a title-length closeness term, and a penalty for
 *   non-English edition markers (subtitulada, (VF), vostfr, …) unless the
 *   query itself asks for that edition.
 * - Results are deduped by normalized title: only the best-scored record
 *   per title is returned, with `editionCount` = how many other records
 *   were collapsed into it.
 * - Search v2.1 (catalog polish): title hits are scored by match QUALITY.
 *   A token that equals a whole title word ("man" in "Gemini Man") scores
 *   far above a token that merely prefixes a longer word ("man" in
 *   "Manu"/"Mantra"/"Mandy"), and the title-starts-with-query bonus only
 *   fires at a whole-word boundary ("man " in "Man Made", not "man" in
 *   "Manu"). Before this, single common-word queries surfaced short
 *   prefix matches ahead of real whole-word titles.
 *
 * Also exports suggestTitles() for "Did you mean" suggestions on zero
 * results. Dependency-free.
 */
export interface SearchableMovie {
  title: string;
  genre: string;
  description: string;
  year: number;
  channelTitle?: string;
  category?: string;
  durationSeconds?: number;
}

export type SearchResult<T> = T & { editionCount: number };

export function normalizeSearchText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’ʼ]/g, "'")
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set(["the", "a", "an", "of", "and", "in", "on"]);

/** Bounded Levenshtein: true iff distance(a, b) <= maxDist. Early-exits. */
function levWithin(a: string, b: string, maxDist: number): boolean {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > maxDist) return false;
  if (a === b) return true;
  let prev: number[] = new Array(lb + 1);
  let curr: number[] = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= lb; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > maxDist) return false;
    const tmp = prev; prev = curr; curr = tmp;
  }
  return prev[lb] <= maxDist;
}

/** Full Levenshtein distance (used only by the suggestion scan). */
function levDistance(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  let prev: number[] = new Array(lb + 1);
  let curr: number[] = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev; prev = curr; curr = tmp;
  }
  return prev[lb];
}

function tokenMatchesWord(token: string, word: string): boolean {
  if (!word) return false;
  if (word === token || word.startsWith(token)) return true;
  const maxDist = token.length >= 8 ? 2 : token.length >= 5 ? 1 : 0;
  if (!maxDist) return false;
  return levWithin(token, word, maxDist);
}

interface Prepared {
  nTitle: string;
  titleWords: string[];
  otherWords: string[]; // genre + description + year + channel words
}
const prepCache = new WeakMap<object, Prepared>();
function prepare(m: SearchableMovie): Prepared {
  let p = prepCache.get(m);
  if (!p) {
    const nTitle = normalizeSearchText(m.title);
    p = {
      nTitle,
      titleWords: nTitle.split(" ").filter(Boolean),
      otherWords: normalizeSearchText(
        [m.genre, m.description, String(m.year || ""), m.channelTitle ?? ""].join(" "),
      ).split(" ").filter(Boolean),
    };
    prepCache.set(m, p);
  }
  return p;
}

const EDITION_MARKER_RE = /(subtitulada|doblada|dublado|legendada|\(vf\)|\(vo\)|vostfr|hindi dubbed|tamil|telugu)/i;
const EDITION_MARKERS = ["subtitulada", "doblada", "dublado", "legendada", "(vf)", "(vo)", "vostfr", "hindi dubbed", "tamil", "telugu"];

/** -120 when the title carries a non-English edition marker the query didn't ask for. */
function editionPenalty(rawTitle: string, rawQueryLower: string): number {
  if (!EDITION_MARKER_RE.test(rawTitle)) return 0;
  const lt = rawTitle.toLowerCase();
  const markersInTitle = EDITION_MARKERS.filter((mk) => lt.includes(mk));
  const asked = markersInTitle.some((mk) => rawQueryLower.includes(mk) || rawQueryLower.includes(mk.replace(/[()]/g, "")));
  return asked ? 0 : -120;
}

const stripLeadingThe = (s: string) => (s.startsWith("the ") ? s.slice(4) : s);

/** How a query token matched a title word: whole word > fuzzy (typo) > prefix. */
export type TitleMatchKind = "exact" | "fuzzy" | "prefix" | null;

function scoreMovie(
  m: SearchableMovie,
  p: Prepared,
  tokens: string[],
  nq: string,
  titleMatchKinds: TitleMatchKind[],
  elsewhereHits: number,
  rawQueryLower: string,
): number {
  let score = 0;
  if (p.nTitle === nq) score += 1000;
  else if (stripLeadingThe(p.nTitle) === stripLeadingThe(nq)) score += 900;
  const titleHits = titleMatchKinds.filter(Boolean).length;
  const exactHits = titleMatchKinds.filter((k) => k === "exact").length;
  // All query tokens present in the title: full bonus only when every one
  // is a whole title word; a title matched only via prefixes/fuzzy gets a
  // token presence bonus, not the whole-word bonus.
  if (tokens.length && exactHits === tokens.length) score += 300;
  else if (tokens.length && titleHits === tokens.length) score += 60;
  // Title starts with the query: full bonus only at a whole-word boundary
  // ("man made" for "man"), a small one for a mere string prefix ("manu").
  if (nq && (p.nTitle === nq || p.nTitle.startsWith(nq + " "))) score += 150;
  else if (nq && p.nTitle.startsWith(nq)) score += 25;
  // Per-token quality: whole word >> typo-tolerant fuzzy > bare prefix.
  score += exactHits * 80;
  score += titleMatchKinds.filter((k) => k === "fuzzy").length * 30;
  score += titleMatchKinds.filter((k) => k === "prefix").length * 5;
  score += elsewhereHits * 5; // tokens matched only outside the title
  if (m.channelTitle === "YouTube Movies") score += 60;
  if (m.category === "free-with-ads") score += 40;
  if ((m.durationSeconds ?? 0) >= 5400) score += 10;
  if (m.year) score += Math.min(Math.max(m.year - 1990, 0), 35);
  score -= Math.abs(p.nTitle.length - nq.length) * 2;
  score += editionPenalty(m.title, rawQueryLower);
  return score;
}

interface Scored<T> { m: T; score: number; idx: number; nTitle: string }

function runPass<T extends SearchableMovie>(
  movies: T[],
  tokens: string[],
  required: number,
  nq: string,
  rawQueryLower: string,
): Scored<T>[] {
  const out: Scored<T>[] = [];
  movies.forEach((m, idx) => {
    const p = prepare(m);
    let matched = 0;
    let elsewhereHits = 0;
    const titleMatchKinds: TitleMatchKind[] = [];
    for (const t of tokens) {
      // Classify the title match by quality: exact whole word first, then
      // a longer word the token merely prefixes, then a fuzzy (edit-
      // distance) match. A token counts as a title hit in all three cases;
      // only the score differs (see scoreMovie).
      let kind: TitleMatchKind = null;
      if (p.titleWords.includes(t)) kind = "exact";
      else if (p.titleWords.some((w) => w.startsWith(t))) kind = "prefix";
      else if (p.titleWords.some((w) => tokenMatchesWord(t, w))) kind = "fuzzy";
      titleMatchKinds.push(kind);
      if (kind) { matched++; continue; }
      if (p.otherWords.some((w) => tokenMatchesWord(t, w))) { matched++; elsewhereHits++; }
      else if (required === tokens.length) return; // strict pass: one miss kills it
    }
    if (matched < required) return;
    out.push({ m, score: scoreMovie(m, p, tokens, nq, titleMatchKinds, elsewhereHits, rawQueryLower), idx, nTitle: p.nTitle });
  });
  return out;
}

export function searchMovies<T extends SearchableMovie>(movies: T[], query: string): SearchResult<T>[] {
  const nq = normalizeSearchText(query);
  const tokens = nq.split(" ").filter(Boolean);
  if (!tokens.length) return movies.map((m) => ({ ...m, editionCount: 0 }));
  const rawQueryLower = query.toLowerCase();

  let scored = runPass(movies, tokens, tokens.length, nq, rawQueryLower);
  if (!scored.length) {
    // Relaxed pass: drop stopwords, require at least half of what's left.
    const kept = tokens.filter((t) => !STOPWORDS.has(t));
    if (kept.length && kept.length < tokens.length) {
      const required = Math.max(1, Math.ceil(kept.length / 2));
      scored = runPass(movies, kept, required, nq, rawQueryLower);
    }
  }

  scored.sort((a, b) => b.score - a.score || a.idx - b.idx);

  // Dedupe by normalized title: best-scored record wins, count the rest.
  const counts = new Map<string, number>();
  for (const s of scored) counts.set(s.nTitle, (counts.get(s.nTitle) ?? 0) + 1);
  const seen = new Set<string>();
  const results: SearchResult<T>[] = [];
  for (const s of scored) {
    if (seen.has(s.nTitle)) continue;
    seen.add(s.nTitle);
    results.push({ ...s.m, editionCount: (counts.get(s.nTitle) ?? 1) - 1 });
  }
  return results;
}

/**
 * "Did you mean" candidates for a zero-result query: the closest catalog
 * titles by Levenshtein distance over normalized titles (also compared
 * against the title with a leading "the " stripped). Returns up to `limit`
 * original titles, best first; titles farther than a length-scaled cap are
 * not suggested at all.
 */
export function suggestTitles<T extends SearchableMovie>(movies: T[], query: string, limit = 3): string[] {
  const nq = normalizeSearchText(query);
  if (!nq) return [];
  const maxDist = Math.max(2, Math.floor(nq.length * 0.6));
  const best = new Map<string, { title: string; dist: number }>();
  for (const m of movies) {
    const p = prepare(m);
    if (!p.nTitle) continue;
    const bare = stripLeadingThe(p.nTitle);
    if (Math.abs(p.nTitle.length - nq.length) > maxDist && Math.abs(bare.length - nq.length) > maxDist) continue;
    const d = Math.min(levDistance(nq, p.nTitle), levDistance(nq, bare));
    if (d > maxDist) continue;
    const cur = best.get(p.nTitle);
    if (!cur || d < cur.dist) best.set(p.nTitle, { title: m.title, dist: d });
  }
  return [...best.values()]
    .sort((a, b) => a.dist - b.dist)
    .slice(0, limit)
    .map((x) => x.title);
}
