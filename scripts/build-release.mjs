#!/usr/bin/env node
/**
 * Publish the open data release manifest to release/release.json.
 *
 * Run with: npm run release
 *
 * This script deliberately re-implements the small amount of CSV reading it needs instead of
 * importing the TypeScript modules, so it runs with plain Node and has no build step. It reads the
 * exact files in data/team/, validates their structure, and writes one JSON file that can be
 * committed, archived or attached to a GitHub release.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const TEAM_DIR = path.join(ROOT, "data", "team");
const OUT_DIR = path.join(ROOT, "release");
const APP_VERSION = "1.1.1";
const AGENT_VERSION = "1.0.0";

const files = ["full_dataset.csv", "sonification_dataset.csv", "annual_predictions_202610.csv"];

const parseCsv = (text) =>
  text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => line.split(",").map((cell) => cell.trim()));

const num = (v) => {
  if (v === undefined || v.trim() === "" || v.trim().toLowerCase() === "nan") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function readAnnual(rows, file) {
  const header = rows[0] ?? [];
  const idx = Object.fromEntries(["Year", "J-D", "Moving_Average_10Y", "Trend"].map((c) => [c, header.indexOf(c)]));
  for (const [name, i] of Object.entries(idx)) {
    if (i < 0) throw new Error(`${file} is missing the required column '${name}'.`);
  }
  return rows
    .slice(1)
    .flatMap((row) => {
      const year = num(row[idx.Year]);
      const value = num(row[idx["J-D"]]);
      if (year === null || value === null || !Number.isInteger(year)) return [];
      return [{ date: `${year}-01-01`, value, movingAverage10Y: num(row[idx.Moving_Average_10Y]), trend: num(row[idx.Trend]) }];
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

const [historyCsv, sonificationCsv, predictionsCsv] = await Promise.all(
  files.map((f) => readFile(path.join(TEAM_DIR, f), "utf8")),
);

const history = readAnnual(parseCsv(historyCsv), files[0]);
const sonification = readAnnual(parseCsv(sonificationCsv), files[1]);
if (!history.length) throw new Error("No valid annual records found.");
if (
  sonification.length !== history.length ||
  sonification.some((r, i) => r.date !== history[i]?.date || r.value !== history[i]?.value)
) {
  throw new Error("The full and sonification datasets do not match; refusing to build a release.");
}

const predRows = parseCsv(predictionsCsv);
const pHeader = predRows[0] ?? [];
const pIdx = Object.fromEntries(["method/model", "year", "pred_GMSTA"].map((c) => [c, pHeader.indexOf(c)]));
for (const [name, i] of Object.entries(pIdx)) {
  if (i < 0) throw new Error(`${files[2]} is missing the required column '${name}'.`);
}
const ciIdx = pHeader.indexOf("CI_95");
const predictions = predRows
  .slice(1)
  .flatMap((row) => {
    const year = num(row[pIdx.year]);
    const value = num(row[pIdx.pred_GMSTA]);
    const model = row[pIdx["method/model"]];
    if (!model || year === null || value === null || !Number.isInteger(year)) return [];
    return [{ model, year, value, confidence95: ciIdx >= 0 ? num(row[ciIdx]) : null }];
  })
  .sort((a, b) => a.year - b.year || a.model.localeCompare(b.model));

const integrity = [];
for (const name of files) {
  const absolute = path.join(TEAM_DIR, name);
  const [info, hash] = await Promise.all([stat(absolute), sha256(absolute)]);
  integrity.push({ file: `data/team/${name}`, bytes: info.size, sha256: hash });
}

const warmest = history.reduce((a, b) => (b.value > a.value ? b : a));
const warmestYear = Number(warmest.date.slice(0, 4));
const start = history[0].date;
const end = history[history.length - 1].date;

const release = {
  release: {
    id: "earthvibe-1.1.1-data",
    title: "EarthVibe open data release — annual global temperature and voice-agent record",
    version: APP_VERSION,
    generatedAt: new Date().toISOString(),
    agentVersion: AGENT_VERSION,
    kind: "open data release",
    license:
      "Project code: see the repository. Original temperature observations: NASA GISS GISTEMP v4, a public NASA product — see https://data.giss.nasa.gov/gistemp/ for its usage terms. Processed annual series and the prediction file are supplied by the Earth Jukebox / EarthVibe project team.",
    citation:
      "Processed data and model predictions supplied in the Earth Jukebox team data archive. Original temperature observations: NASA GISS GISTEMP v4.",
  },
  summary: {
    observedYears: history.length,
    start,
    end,
    predictionRows: predictions.length,
    warmestYear,
    warmestValue: warmest.value,
    quote: `In this released record, ${warmestYear} is the warmest year at ${warmest.value.toFixed(2)} °C above the 1951–1980 average.`,
  },
  dataset: {
    title: "Annual global mean surface temperature anomaly",
    units: "°C",
    referencePeriod: "1951–1980 mean",
    temporalResolution: "annual",
    records: history,
    sonificationRecords: sonification,
    availableRange: { start, end },
  },
  predictions: {
    title: "Annual GMSTA model predictions",
    records: predictions,
    note: "Model estimates supplied by the project team; these are predictions, not observed measurements. The YTD and projected DJF entries are not directly equivalent to a completed calendar-year observation.",
  },
  provenance: {
    suppliedBy: "Earth Jukebox project team",
    source: "NASA GISS GISTEMP v4 (processed annual series)",
    sourceUrl: "https://data.giss.nasa.gov/gistemp/",
    files,
    attribution:
      "Processed data and model predictions supplied in the Earth Jukebox team data archive. Original temperature observations: NASA GISS GISTEMP v4.",
  },
  access: {
    files: files.map((f) => `data/team/${f}`),
    endpoints: { teamData: "/api/team-data", agent: "/api/agent", release: "/api/release", transcribe: "/api/transcribe" },
    download: "/api/release",
    note: "Every value the voice agent speaks comes from these files. The JSON endpoints are open, same-origin and unauthenticated; the files can be downloaded directly from the repository.",
  },
  integrity: {
    algorithm: "sha256",
    files: integrity,
    note: "Hashes cover the exact bytes shipped by this release. Recompute with: sha256sum data/team/*.csv",
  },
  agent: {
    version: AGENT_VERSION,
    languages: ["en", "ar", "fr"],
    mode: "rule-based",
    capabilities: [
      "answers spoken or typed questions in English, Arabic and French",
      "reads every answer aloud in the browser and shows it as text",
      "turns the same numbers into sound (Web Audio) on request",
      "reports missing years as missing and labels projections as projections",
      "exposes the questions it understands at GET /api/agent",
    ],
    limitations: [
      "answers only from the released annual record; no live NASA feed is reachable in this deployment",
      "cannot book, buy, or pass the user to a human",
      "server-side speech recognition is optional and only used when TRANSCRIBE_API_URL is configured",
    ],
  },
  disclaimer:
    "Independent student project for the NASA Space Apps Challenge. Not an official NASA product and not endorsed by NASA. Model projections in the predictions file are estimates, not measurements.",
};

await mkdir(OUT_DIR, { recursive: true });
const outFile = path.join(OUT_DIR, "release.json");
await writeFile(outFile, `${JSON.stringify(release, null, 2)}\n`, "utf8");

console.log(`✔ wrote ${path.relative(ROOT, outFile)}`);
console.log(`  ${history.length} annual observations, ${start} → ${end}`);
console.log(`  ${predictions.length} prediction rows, ${integrity.length} files hashed`);
for (const f of integrity) console.log(`  ${f.sha256.slice(0, 16)}…  ${String(f.bytes).padStart(7)} B  ${f.file}`);
