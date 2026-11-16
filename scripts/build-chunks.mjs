#!/usr/bin/env node
/**
 * Split the canonical movie-catalog JSON export into web-sized chunks for the
 * static (GitHub Pages) build.
 *
 * Why: the full catalog (47,754 movies, ~25 MB of JSON) cannot ship inside the
 * JS bundle — a single file that size exceeds the GitHub connector's
 * 16,777,216-byte per-file hard limit and practical push sizes (~4 MB). So the
 * static site loads the catalog as data files instead:
 *
 *   docs/data/index.json          manifest { count, chunks, chunkCounts }
 *   docs/data/catalog-001.json    JSON array of full movie records
 *   docs/data/catalog-002.json    ...
 *
 * Chunks are split on movie boundaries (a record is never cut in half) and each
 * chunk stays under --max-bytes (default 2,600,000) so every file can be pushed
 * individually.
 *
 * Usage:
 *   node scripts/build-chunks.mjs [input.json] [outDir] [--max-bytes N]
 *
 * Defaults: input = ../../ymp-movies.json (the canonical GET /api/movies export,
 * kept outside the repo because of its size), outDir = ../docs/data.
 * The canonical committed form of the catalog is the chunk set + manifest.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");

const args = process.argv.slice(2);
let maxBytes = 2_600_000;
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--max-bytes") maxBytes = Number(args[++i]);
  else positional.push(args[i]);
}
const inputPath = positional[0]
  ? path.resolve(positional[0])
  : path.resolve(projectRoot, "..", "ymp-movies.json");
const outDir = positional[1] ? path.resolve(positional[1]) : path.join(projectRoot, "docs", "data");

const raw = fs.readFileSync(inputPath, "utf8");
const movies = JSON.parse(raw);
if (!Array.isArray(movies)) throw new Error(`${inputPath} is not a JSON array`);
const ids = new Set(movies.map((m) => m.id));
if (ids.size !== movies.length) throw new Error("duplicate movie ids in input — refusing to chunk");

fs.mkdirSync(outDir, { recursive: true });
// Remove stale chunks from any previous run so the manifest is the only truth.
for (const f of fs.readdirSync(outDir)) {
  if (/^catalog-\d+\.json$/.test(f) || f === "index.json") fs.unlinkSync(path.join(outDir, f));
}

const chunks = [];
let current = [];
let currentBytes = 2; // "[]"
for (const movie of movies) {
  const s = JSON.stringify(movie);
  const add = Buffer.byteLength(s) + (current.length ? 1 : 0); // comma separator
  if (current.length && currentBytes + add > maxBytes) {
    chunks.push(current);
    current = [];
    currentBytes = 2;
  }
  current.push(s);
  currentBytes += Buffer.byteLength(s) + (current.length > 1 ? 1 : 0);
}
if (current.length) chunks.push(current);

const names = [];
const chunkCounts = [];
chunks.forEach((parts, i) => {
  const name = `catalog-${String(i + 1).padStart(3, "0")}.json`;
  const body = `[${parts.join(",")}]`;
  fs.writeFileSync(path.join(outDir, name), body);
  names.push(name);
  chunkCounts.push(parts.length);
  console.log(`${name}: ${parts.length} movies, ${Buffer.byteLength(body)} bytes`);
});

const manifest = { count: movies.length, chunks: names, chunkCounts };
fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`index.json: count=${manifest.count}, ${names.length} chunks -> ${outDir}`);
