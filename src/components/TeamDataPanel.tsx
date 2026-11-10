"use client";

import { useEffect, useState } from "react";
import { Chart } from "./Chart";
import { apiFetch, ClientApiError, type Remote } from "@/lib/hooks";

type TeamData = {
  dataset: {
    title: string;
    units: string;
    referencePeriod: string;
    temporalResolution: string;
    records: { date: string; value: number; movingAverage10Y: number | null; trend: number | null }[];
    sonificationRecords: { date: string; value: number; movingAverage10Y: number | null; trend: number | null }[];
    availableRange: { start: string; end: string };
  };
  predictions: {
    title: string;
    records: { model: string; year: number; value: number; confidence95: number | null }[];
    note: string;
  };
  provenance: { suppliedBy: string; source: string; sourceUrl: string; files: string[]; attribution: string };
};

export function TeamDataPanel() {
  const [state, setState] = useState<Remote<TeamData>>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<TeamData>("/api/team-data", { signal: controller.signal })
      .then((data) => setState({ status: "ready", data }))
      .catch(() => { if (!controller.signal.aborted) setState({ status: "error", error: new ClientApiError("team_data_error", "Unable to load the team's dataset.", null, 500) }); });
    return () => controller.abort();
  }, []);

  return (
    <section className="panel team-data-panel" aria-labelledby="team-data-title">
      <div className="team-data-heading">
        <div>
          <p className="eyebrow">TEAM DATA INTEGRATION</p>
          <h3 id="team-data-title">Annual temperature history &amp; model outlook</h3>
          <p className="note">A separate annual view from the dataset supplied by your teammate. The existing monthly NASA series remains unchanged.</p>
        </div>
        <span className="badge">TEAM DATA</span>
      </div>
      {state.status === "loading" && <p role="status">Loading team data…</p>}
      {state.status === "error" && <p className="notice notice-error" role="alert">The team dataset could not be loaded. Check that the files in <code>data/team/</code> are present, then refresh.</p>}
      {state.status === "ready" && <>
        <div className="team-data-chart">
          <h4>{state.data.dataset.title}</h4>
          <p className="note">Annual sonification series · {state.data.dataset.referencePeriod} baseline · {state.data.dataset.availableRange.start.slice(0, 4)}–{state.data.dataset.availableRange.end.slice(0, 4)}</p>
          <Chart records={state.data.dataset.sonificationRecords} hasZero unit="°C" cursor={null} onSeek={() => undefined} summary="Annual global mean surface temperature anomaly from 1880 to 2025" tone="warm" />
        </div>
        <div className="team-data-predictions">
          <h4>{state.data.predictions.title}</h4>
          <p className="note">{state.data.predictions.note}</p>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Model / method</th><th>Year</th><th>Predicted anomaly</th><th>CI_95 (°C)</th></tr></thead>
              <tbody>{state.data.predictions.records.map((row) => <tr key={`${row.year}-${row.model}`}><td>{row.model}</td><td>{row.year}</td><td>{row.value.toFixed(3)} °C</td><td>{row.confidence95 === null ? "—" : `${row.confidence95.toFixed(3)} °C`}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
        <div className="team-data-provenance">
          <strong>Data provenance</strong>
          <p>{state.data.provenance.attribution}</p>
          <p className="note">Files: {state.data.provenance.files.join(" · ")}</p>
          <a href={state.data.provenance.sourceUrl} target="_blank" rel="noreferrer">NASA GISS GISTEMP source ↗</a>
        </div>
      </>}
    </section>
  );
}
