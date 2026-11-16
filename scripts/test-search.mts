#!/usr/bin/env tsx
/**
 * Search v2 test battery — loads the REAL static catalog chunks (default:
 * ../docs/data, or a directory passed as argv[2] containing index.json +
 * catalog-*.json), runs the shared search over them, prints the top 5 for
 * each probe query, and checks the expectations from the search-v2 spec.
 *
 * Usage: npx tsx scripts/test-search.mts [dataDir]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { searchMovies, suggestTitles, normalizeSearchText } from "../shared/search.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, "docs", "data");

const manifest = JSON.parse(fs.readFileSync(path.join(dataDir, "index.json"), "utf8"));
const movies: any[] = [];
for (const name of manifest.chunks) {
  movies.push(...JSON.parse(fs.readFileSync(path.join(dataDir, name), "utf8")));
}
console.log(`Loaded ${movies.length} movies from ${dataDir} (manifest count ${manifest.count})\n`);

let failures = 0;
const check = (label: string, ok: boolean, extra = "") => {
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures++;
};
const show = (q: string, rs: any[]) => {
  console.log(`Q: "${q}" → ${rs.length} results`);
  rs.slice(0, 5).forEach((r, i) =>
    console.log(`   ${i + 1}. ${r.title} (${r.year}) [${r.channelTitle ?? "?"}]${r.editionCount ? ` +${r.editionCount} editions` : ""}`));
};
const nt = (s: string) => normalizeSearchText(s);

// 1. Gemini Man — exact, must be #1
let rs = searchMovies(movies, "Gemini Man");
show("Gemini Man", rs);
check("Gemini Man #1", rs.length > 0 && nt(rs[0].title) === "gemini man", rs[0]?.title);

// 2. Typo tolerance
rs = searchMovies(movies, "gemeni man");
show("gemeni man", rs);
check("gemeni man → Gemini Man in top 3", rs.slice(0, 3).some((r) => nt(r.title) === "gemini man"));

// 3. Deadpool — English editions above regional ones
rs = searchMovies(movies, "deadpool");
show("deadpool", rs);
check("Deadpool #1", rs.length > 0 && nt(rs[0].title) === "deadpool", rs[0]?.title);
const MARKER = /(subtitulada|doblada|dublado|legendada|\(vf\)|\(vo\)|vostfr|hindi dubbed|tamil|telugu)/i;
const idxEnglish2 = rs.findIndex((r) => nt(r.title) === "deadpool 2");
const idxMarked2 = rs.findIndex((r) => /^deadpool 2/i.test(r.title) && MARKER.test(r.title));
check("English Deadpool 2 above marked editions",
  idxEnglish2 >= 0 && (idxMarked2 === -1 || idxEnglish2 < idxMarked2),
  `english@${idxEnglish2} marked@${idxMarked2}`);

// 4. The Ring — exact #1 despite 2,593 loose matches in v1
rs = searchMovies(movies, "the ring");
show("the ring", rs);
check("The Ring #1", rs.length > 0 && nt(rs[0].title) === "the ring", rs[0]?.title);

// 5. ring — The Ring in top 5
rs = searchMovies(movies, "ring");
show("ring", rs);
check("The Ring in top 5 for 'ring'", rs.slice(0, 5).some((r) => nt(r.title) === "the ring"));

// 6. Avatar #1
rs = searchMovies(movies, "avatar");
show("avatar", rs);
check("Avatar #1", rs.length > 0 && nt(rs[0].title) === "avatar", rs[0]?.title);

// 7. Skipped-word query still lands the exact film
rs = searchMovies(movies, "assault precinct");
show("assault precinct", rs);
check("Assault On Precinct 13 #1", rs.length > 0 && nt(rs[0].title) === "assault on precinct 13", rs[0]?.title);

// 8. One common word — no crash, sensible official-heavy top 10
const t0 = Date.now();
rs = searchMovies(movies, "man");
console.log(`Q: "man" → ${rs.length} results in ${Date.now() - t0}ms`);
rs.slice(0, 10).forEach((r, i) => console.log(`   ${i + 1}. ${r.title} (${r.year}) [${r.channelTitle ?? "?"}]`));
const officialInTop10 = rs.slice(0, 10).filter((r) => r.channelTitle === "YouTube Movies").length;
check("'man' no crash, results returned", rs.length > 0, `${officialInTop10}/10 top results are official-channel`);
// 8b. Whole-word improvement (search v2.1): at least one top-5 title for
// "man" must contain "man" as a WHOLE word (e.g. "Gemini Man", "Man Made"),
// not only prefix matches like "Manu"/"Mantra"/"Mandy" that v2 surfaced.
const hasWholeWordMan = (t: string) => nt(t).split(" ").includes("man");
const wholeWordInTop5 = rs.slice(0, 5).filter((r) => hasWholeWordMan(r.title));
check("'man' top 5 contains a whole-word 'man' title",
  wholeWordInTop5.length >= 1,
  `${wholeWordInTop5.length}/5 top results are whole-word: ${wholeWordInTop5.map((r) => r.title).join(", ") || "none"}`);

// 9. Gibberish — zero results, suggestions path survives
rs = searchMovies(movies, "zzzzqqq");
show("zzzzqqq", rs);
check("zzzzqqq → 0 results", rs.length === 0);
const sugg = suggestTitles(movies, "zzzzqqq");
console.log(`  suggestions for "zzzzqqq": ${JSON.stringify(sugg)}`);
const sugg2 = suggestTitles(movies, "gemeni man");
console.log(`  suggestions for "gemeni man": ${JSON.stringify(sugg2)}`);
check("suggestions path doesn't crash", Array.isArray(sugg) && Array.isArray(sugg2));

console.log(`\n${failures ? `${failures} FAILURE(S)` : "ALL CHECKS PASSED"}`);
process.exit(failures ? 1 : 0);
