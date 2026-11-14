/**
 * Loader for the annual temperature archive supplied by the project team (data/team/*.csv).
 *
 * This is the only dataset that is available offline inside this deployment, so the voice agent
 * (and the /api/team-data endpoint) both read it through this single, validated loader. No values
 * are ever invented: invalid rows are dropped, missing cells stay null, and structural mismatches
 * are reported as errors instead of being papered over.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

export type AnnualRecord = {
  date: string;
  value: number;
  movingAverage10Y: number | null;
  trend: number | null;
};

export type Prediction = { model: string; year: number; value: number; confidence95: number | null };

export type TeamData = {
  dataset: {
    title: string;
    units: string;
    referencePeriod: string;
    temporalResolution: "annual";
    records: AnnualRecord[];
    sonificationRecords: AnnualRecord[];
    availableRange: { start: string; end: string };
  };
  predictions: { title: string; records: Prediction[]; note: string };
  provenance: {
    suppliedBy: string;
    source: string;
    sourceUrl: string;
    files: string[];
    attribution: string;
  };
};

export const TEAM_FILES = ["full_dataset.csv", "sonification_dataset.csv", "annual_predictions_202610.csv"] as const;

export const PREDICTION_NOTE =
  "Model estimates supplied by the project team; these are predictions, not observed measurements. The YTD and projected DJF entries are not directly equivalent to a completed calendar-year observation.";

function parseNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "" || value.trim().toLowerCase() === "nan") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseCsv(text: string): string[][] {
  // These project files contain plain comma-separated numeric/text fields (no quoted commas).
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => line.split(",").map((cell) => cell.trim()));
}

async function readTeamFile(name: string): Promise<string> {
  return readFile(path.join(process.cwd(), "data", "team", name), "utf8");
}

function columnIndex(header: string[], names: string[], file: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of names) {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`The team's ${file} is missing the required column '${name}'.`);
    out[name] = i;
  }
  return out;
}

function readAnnual(rows: string[][], file: string): AnnualRecord[] {
  const header = rows[0] ?? [];
  const col = columnIndex(header, ["Year", "J-D", "Moving_Average_10Y", "Trend"], file);
  return rows
    .slice(1)
    .flatMap((row) => {
      const year = parseNumber(row[col.Year]);
      const value = parseNumber(row[col["J-D"]]);
      if (year === null || value === null || !Number.isInteger(year)) return [];
      return [
        {
          date: `${year}-01-01`,
          value,
          movingAverage10Y: parseNumber(row[col.Moving_Average_10Y]),
          trend: parseNumber(row[col.Trend]),
        },
      ];
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Read, validate and cross-check the three team files. Throws a descriptive error when invalid. */
export async function loadTeamData(): Promise<TeamData> {
  const [historyCsv, sonificationCsv, predictionsCsv] = await Promise.all([
    readTeamFile("full_dataset.csv"),
    readTeamFile("sonification_dataset.csv"),
    readTeamFile("annual_predictions_202610.csv"),
  ]);

  const history = readAnnual(parseCsv(historyCsv), "full_dataset.csv");
  const sonification = readAnnual(parseCsv(sonificationCsv), "sonification_dataset.csv");
  if (!history.length) throw new Error("The team's annual history file contains no valid records.");
  if (
    sonification.length !== history.length ||
    sonification.some((record, index) => record.date !== history[index]?.date || record.value !== history[index]?.value)
  ) {
    throw new Error("The team's full and sonification datasets do not contain matching annual observations.");
  }

  const predictionRows = parseCsv(predictionsCsv);
  const pHeader = predictionRows[0] ?? [];
  const pcol = columnIndex(pHeader, ["method/model", "year", "pred_GMSTA"], "annual_predictions_202610.csv");
  const ci = pHeader.indexOf("CI_95");
  const predictions: Prediction[] = predictionRows
    .slice(1)
    .flatMap((row) => {
      const year = parseNumber(row[pcol.year]);
      const value = parseNumber(row[pcol.pred_GMSTA]);
      const model = row[pcol["method/model"]];
      if (!model || year === null || value === null || !Number.isInteger(year)) return [];
      return [{ model, year, value, confidence95: ci >= 0 ? parseNumber(row[ci]) : null }];
    })
    .sort((a, b) => a.year - b.year || a.model.localeCompare(b.model));

  return {
    dataset: {
      title: "Annual global mean surface temperature anomaly",
      units: "°C",
      referencePeriod: "1951–1980 mean",
      temporalResolution: "annual",
      records: history,
      sonificationRecords: sonification,
      availableRange: { start: history[0].date, end: history[history.length - 1].date },
    },
    predictions: {
      title: "Annual GMSTA model predictions",
      records: predictions,
      note: PREDICTION_NOTE,
    },
    provenance: {
      suppliedBy: "Earth Jukebox project team",
      source: "NASA GISS GISTEMP v4 (processed annual series)",
      sourceUrl: "https://data.giss.nasa.gov/gistemp/",
      files: [...TEAM_FILES],
      attribution:
        "Processed data and model predictions supplied in the Earth Jukebox team data archive. Original temperature observations: NASA GISS GISTEMP v4.",
    },
  };
}
