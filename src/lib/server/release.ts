/**
 * Open data release for the EarthVibe voice agent.
 *
 * The release is built from the files actually present on disk at request time, so the manifest
 * can never describe data that is not shipped: every entry carries the file size and SHA-256 hash
 * of the exact bytes in data/team/. The same builder is used by /api/release and by
 * scripts/build-release.mjs (npm run release) to publish release/release.json.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { loadTeamData, TEAM_FILES, PREDICTION_NOTE, type TeamData } from "./teamData";
const AGENT_VERSION = "1.0.0";
const APP_VERSION = "1.1.1";
const RELEASE_ID = "earthvibe-1.1.1-data";

export type ReleaseFile = { file: string; bytes: number; sha256: string };

export type Release = {
  release: {
    id: string;
    title: string;
    version: string;
    generatedAt: string;
    agentVersion: string;
    kind: "open data release";
    license: string;
    citation: string;
  };
  summary: {
    observedYears: number;
    start: string;
    end: string;
    predictionRows: number;
    warmestYear: number;
    warmestValue: number;
    quote: string;
  };
  dataset: TeamData["dataset"];
  predictions: TeamData["predictions"];
  provenance: TeamData["provenance"];
  access: {
    files: string[];
    endpoints: { teamData: string; agent: string; release: string; transcribe: string };
    download: string;
    note: string;
  };
  integrity: { algorithm: "sha256"; files: ReleaseFile[]; note: string };
  agent: {
    version: string;
    languages: string[];
    mode: "rule-based";
    capabilities: string[];
    limitations: string[];
  };
  disclaimer: string;
};

const LICENSE_NOTE =
  "Project code: see the repository. Original temperature observations: NASA GISS GISTEMP v4, a public NASA product — see https://data.giss.nasa.gov/gistemp/ for its usage terms. Processed annual series and the prediction file are supplied by the Earth Jukebox / EarthVibe project team.";

const DISCLAIMER =
  "Independent student project for the NASA Space Apps Challenge. Not an official NASA product and not endorsed by NASA. Model projections in the predictions file are estimates, not measurements.";

export async function sha256File(absolutePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(absolutePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function buildRelease(now: Date = new Date()): Promise<Release> {
  const data = await loadTeamData();
  const records = data.dataset.records;
  const warmest = records.reduce((a, b) => (b.value > a.value ? b : a));
  const files: ReleaseFile[] = [];
  for (const name of TEAM_FILES) {
    const absolute = path.join(process.cwd(), "data", "team", name);
    const [info, sha256] = await Promise.all([stat(absolute), sha256File(absolute)]);
    files.push({ file: `data/team/${name}`, bytes: info.size, sha256 });
  }
  const startYear = Number(data.dataset.availableRange.start.slice(0, 4));
  const endYear = Number(data.dataset.availableRange.end.slice(0, 4));
  const warmestYear = Number(warmest.date.slice(0, 4));

  return {
    release: {
      id: RELEASE_ID,
      title: "EarthVibe open data release — annual global temperature and voice-agent record",
      version: APP_VERSION,
      generatedAt: now.toISOString(),
      agentVersion: AGENT_VERSION,
      kind: "open data release",
      license: LICENSE_NOTE,
      citation: data.provenance.attribution,
    },
    summary: {
      observedYears: records.length,
      start: data.dataset.availableRange.start,
      end: data.dataset.availableRange.end,
      predictionRows: data.predictions.records.length,
      warmestYear,
      warmestValue: warmest.value,
      quote: `In this released record, ${warmestYear} is the warmest year at ${warmest.value.toFixed(2)} °C above the 1951–1980 average.`,
    },
    dataset: data.dataset,
    predictions: { ...data.predictions, note: PREDICTION_NOTE },
    provenance: data.provenance,
    access: {
      files: TEAM_FILES.map((f) => `data/team/${f}`),
      endpoints: {
        teamData: "/api/team-data",
        agent: "/api/agent",
        release: "/api/release",
        transcribe: "/api/transcribe",
      },
      download: "/api/release",
      note:
        "Every value the voice agent speaks comes from these files. The JSON endpoints are open, same-origin and unauthenticated; the files can be downloaded directly from the repository.",
    },
    integrity: {
      algorithm: "sha256",
      files,
      note: "Hashes cover the exact bytes shipped in this deployment. Recompute with: sha256sum data/team/*.csv",
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
    disclaimer: DISCLAIMER,
  };
}

let cache: { at: number; value: Release } | null = null;
const TTL_MS = 5 * 60 * 1000;

/** Cached release used by the API route (5-minute TTL, invalidated by restart). */
export async function getRelease(): Promise<Release> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const value = await buildRelease();
  cache = { at: Date.now(), value };
  return value;
}
