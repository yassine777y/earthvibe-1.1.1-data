import { readFile } from "node:fs/promises";
import path from "node:path";
import { json, errorResponse } from "@/lib/server/http";

export const dynamic = "force-dynamic";

type AnnualRecord = {
  date: string;
  value: number;
  movingAverage10Y: number | null;
  trend: number | null;
};
type Prediction = { model: string; year: number; value: number; confidence95: number | null };

function parseNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "" || value.trim().toLowerCase() === "nan") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseCsv(text: string): string[][] {
  // These project files contain plain comma-separated numeric/text fields (no quoted commas).
  return text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim()).map((line) => line.split(",").map((cell) => cell.trim()));
}

async function readTeamFile(name: string): Promise<string> {
  return readFile(path.join(process.cwd(), "data", "team", name), "utf8");
}

export async function GET(req: Request) {
  try {
    const [historyCsv, sonificationCsv, predictionsCsv] = await Promise.all([
      readTeamFile("full_dataset.csv"),
      readTeamFile("sonification_dataset.csv"),
      readTeamFile("annual_predictions_202610.csv"),
    ]);
    const historyRows = parseCsv(historyCsv);
    const historyHeader = historyRows.shift() ?? [];
    const col = (name: string) => historyHeader.indexOf(name);
    const yearCol = col("Year"), annualCol = col("J-D"), averageCol = col("Moving_Average_10Y"), trendCol = col("Trend");
    if ([yearCol, annualCol, averageCol, trendCol].some((i) => i < 0)) {
      throw new Error("The team's full_dataset.csv is missing one or more required columns.");
    }
    const history: AnnualRecord[] = historyRows.flatMap((row) => {
      const year = parseNumber(row[yearCol]);
      const value = parseNumber(row[annualCol]);
      if (year === null || value === null || !Number.isInteger(year)) return [];
      return [{ date: `${year}-01-01`, value, movingAverage10Y: parseNumber(row[averageCol]), trend: parseNumber(row[trendCol]) }];
    }).sort((a, b) => a.date.localeCompare(b.date));

    const sonificationRows = parseCsv(sonificationCsv);
    const sonificationHeader = sonificationRows.shift() ?? [];
    const scol = (name: string) => sonificationHeader.indexOf(name);
    const sYear = scol("Year"), sAnnual = scol("J-D"), sAverage = scol("Moving_Average_10Y"), sTrend = scol("Trend");
    if ([sYear, sAnnual, sAverage, sTrend].some((i) => i < 0)) {
      throw new Error("The team's sonification_dataset.csv is missing required columns.");
    }
    const sonification = sonificationRows.flatMap((row) => {
      const year = parseNumber(row[sYear]);
      const value = parseNumber(row[sAnnual]);
      if (year === null || value === null || !Number.isInteger(year)) return [];
      return [{ date: `${year}-01-01`, value, movingAverage10Y: parseNumber(row[sAverage]), trend: parseNumber(row[sTrend]) }];
    }).sort((a, b) => a.date.localeCompare(b.date));
    if (sonification.length !== history.length || sonification.some((record, index) =>
      record.date !== history[index]?.date || record.value !== history[index]?.value
    )) {
      throw new Error("The team's full and sonification datasets do not contain matching annual observations.");
    }

    const predictionRows = parseCsv(predictionsCsv);
    const predictionHeader = predictionRows.shift() ?? [];
    const pcol = (name: string) => predictionHeader.indexOf(name);
    const modelCol = pcol("method/model"), pYearCol = pcol("year"), valueCol = pcol("pred_GMSTA"), ciCol = pcol("CI_95");
    if ([modelCol, pYearCol, valueCol].some((i) => i < 0)) {
      throw new Error("The team's predictions file is missing required columns.");
    }
    const predictions: Prediction[] = predictionRows.flatMap((row) => {
      const year = parseNumber(row[pYearCol]);
      const value = parseNumber(row[valueCol]);
      const model = row[modelCol];
      if (!model || year === null || value === null || !Number.isInteger(year)) return [];
      return [{ model, year, value, confidence95: parseNumber(row[ciCol]) }];
    }).sort((a, b) => a.year - b.year || a.model.localeCompare(b.model));

    if (!history.length) throw new Error("The team's annual history file contains no valid records.");
    return json(req, {
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
        note: "Model estimates supplied by the project team; these are predictions, not observed measurements. The YTD and projected DJF entries are not directly equivalent to a completed calendar-year observation.",
      },
      provenance: {
        suppliedBy: "Earth Jukebox project team",
        source: "NASA GISS GISTEMP v4 (processed annual series)",
        sourceUrl: "https://data.giss.nasa.gov/gistemp/",
        files: ["full_dataset.csv", "sonification_dataset.csv", "annual_predictions_202610.csv"],
        attribution: "Processed data and model predictions supplied in the Earth Jukebox team data archive. Original temperature observations: NASA GISS GISTEMP v4.",
      },
    });
  } catch (error) {
    return errorResponse(req, error);
  }
}
