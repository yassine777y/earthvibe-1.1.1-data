"use client";

/**
 * SoundStudio — the simple place: pick a date, hear that year.
 *
 * Layout: a year scrubber, one big Play button, and a rail of date posters generated from data.
 * Every poster is drawn from the same released annual record as everything else, so selecting a
 * poster changes the globe, the readout and the player together.
 *
 * Accessibility: the rail is a real radio group (arrow keys, Home/End), the scrubber is a native
 * range input with a spoken value, and the transport is the shared, tested <Transport />.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "./Providers";
import { Transport } from "./Transport";
import { usePlayer, apiFetch } from "@/lib/hooks";
import { buildSeriesFrames } from "@/lib/audio/mapping";
import { describeFrame } from "@/lib/describe";
import { rampColor, norm } from "@/lib/globe/ramp";

type Annual = { year: number; value: number; movingAverage10Y: number | null };
type Payload = {
  dataset: { records: { date: string; value: number; movingAverage10Y: number | null }[]; units: string; referencePeriod: string };
};

/** A single-year track: one note per value, so the whole year is heard as a cluster. */
function yearTrack(value: number, min: number, max: number, movingAverage: number | null) {
  const scale = { min, max, zero: 0 };
  const records = Array.from({ length: 12 }, (_, m) => ({
    date: `2000-${String(m + 1).padStart(2, "0")}-01`,
    // distribute the year's anomaly across the months with a small, deterministic seasonal shape
    value: value + Math.sin((m / 12) * Math.PI * 2) * 0.02 + (movingAverage !== null ? (movingAverage - value) * 0.05 : 0),
  }));
  return buildSeriesFrames(records, scale, "temperature");
}

export function SoundStudio() {
  const { t, fmtNumber, announce, dir } = useApp();
  const [annual, setAnnual] = useState<Annual[]>([]);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [mode, setMode] = useState<"year" | "record">("year");

  useEffect(() => {
    let alive = true;
    // State is set from the network callback only, after an await — never synchronously.
    apiFetch<Payload>("/api/team-data")
      .then((d) => {
        if (!alive) return;
        const rows: Annual[] = d.dataset.records
          .map((r) => ({ year: Number(r.date.slice(0, 4)), value: r.value, movingAverage10Y: r.movingAverage10Y }))
          .filter((r) => Number.isFinite(r.value))
          .sort((a, b) => a.year - b.year);
        setAnnual(rows);
        setSelected(rows.length ? rows[rows.length - 1].year : null);
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, []);

  const scale = useMemo(() => {
    if (!annual.length) return { min: -0.5, max: 1.5 };
    return { min: Math.min(...annual.map((a) => a.value)), max: Math.max(...annual.map((a) => a.value)) };
  }, [annual]);

  const current = useMemo(() => annual.find((a) => a.year === selected) ?? null, [annual, selected]);

  const track = useMemo(() => {
    if (!annual.length) return null;
    if (mode === "record") {
      return buildSeriesFrames(
        annual.map((a) => ({ date: `${a.year}-01-01`, value: a.value })),
        { ...scale, zero: 0 },
        "temperature",
      );
    }
    if (!current) return null;
    return yearTrack(current.value, scale.min, scale.max, current.movingAverage10Y);
  }, [annual, current, mode, scale]);

  const player = usePlayer(track);

  const idx = track ? Math.min(track.frames.length - 1, Math.max(0, Math.floor(player.position))) : 0;
  const frame = track?.frames[idx];
  const description =
    frame && track && current
      ? describeFrame({
          t,
          mode: "temperature",
          frame,
          dateText: mode === "record" ? String(current.year) : String(current.year),
          valueText: fmtNumber(frame.value, 2),
          unit: "°C",
          frameCount: track.frames.length,
          frameIndex: idx,
          fmtPct: (v) => fmtNumber(v, 0),
        })
      : null;

  const pick = useCallback(
    (year: number) => {
      setSelected(year);
      setMode("year");
      player.stop();
      const row = annual.find((a) => a.year === year);
      if (row) announce(`${year}, ${row.value > 0 ? "plus" : "minus"} ${Math.abs(row.value).toFixed(2)} degrees`);
    },
    [announce, annual, player],
  );

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (!annual.length) return;
    let next = index;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = Math.min(annual.length - 1, index + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = Math.max(0, index - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = annual.length - 1;
    else return;
    e.preventDefault();
    pick(annual[next].year);
  };

  const posters = useMemo(() => {
    if (!annual.length) return [];
    // show the full record but sampled so the rail stays scannable: every Nth year + the last one
    const step = Math.max(1, Math.floor(annual.length / 22));
    return annual.filter((_, i) => i % step === 0 || i === annual.length - 1);
  }, [annual]);

  if (error) {
    return (
      <section className="section" id="studio" aria-labelledby="studio-h">
        <div className="wrap">
          <h2 id="studio-h">{t("studio.title")}</h2>
          <div className="notice notice-error" role="alert">
            <p>{t("agent.error.network")}</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="section" id="studio" aria-labelledby="studio-h">
      <div className="wrap">
        <span className="section-index" aria-hidden="true">01</span>
        <h2 id="studio-h">{t("studio.title")}</h2>
        <p className="lead">{t("studio.lead")}</p>

        <div className="studio panel2">
          <div className="studio-controls">
            <div className="studio-year">
              <span className="studio-year-label">{t("studio.year")}</span>
              <output className="studio-year-value mono" aria-live="polite">
                {selected ?? "—"}
              </output>
              {current && (
                <span className={`studio-anomaly mono ${current.value >= 0 ? "is-warm" : "is-cool"}`}>
                  {current.value > 0 ? "+" : ""}
                  {fmtNumber(current.value, 2)} °C
                </span>
              )}
            </div>

            <div className="studio-slider">
              <label htmlFor="studio-range" className="sr-only">
                {t("studio.year")}
              </label>
              <input
                id="studio-range"
                type="range"
                min={annual[0]?.year ?? 1880}
                max={annual[annual.length - 1]?.year ?? 2025}
                step={1}
                value={selected ?? 1880}
                disabled={!annual.length}
                onChange={(e) => {
                  const y = Number(e.target.value);
                  setSelected(y);
                  setMode("year");
                }}
                className="slider"
                aria-valuetext={current ? `${current.year}, ${current.value.toFixed(2)} degrees` : ""}
                style={{ ["--fill" as string]: `${current ? Math.round(norm(current.value, scale.min, scale.max) * 100) : 0}%` }}
              />
              <div className="studio-ends" aria-hidden="true">
                <span className="mono">{annual[0]?.year ?? "1880"}</span>
                <span className="mono">{annual[annual.length - 1]?.year ?? "2025"}</span>
              </div>
            </div>

            <div className="studio-actions">
              <button
                type="button"
                className="btn btn-primary btn-lg"
                disabled={!track}
                onClick={() => {
                  setMode("year");
                  void player.play();
                  announce(t("player.announce.playing"));
                }}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
                  <path d="M7 4.5v15l13-7.5z" fill="currentColor" />
                </svg>
                {t("studio.playYear")}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-lg"
                disabled={!annual.length}
                onClick={() => {
                  setMode("record");
                  player.stop();
                  announce(t("studio.fullRecord"));
                }}
              >
                {t("studio.fullRecord")}
              </button>
            </div>
          </div>

          <div className="studio-player">
            <Transport player={player} track={track} valueText={description ?? ""} idPrefix="studio" />
            {description && <p className="note studio-hearing">{description}</p>}
          </div>
        </div>

        <h3 className="studio-posters-h">{t("studio.posters")}</h3>
        <p className="note">{t("studio.postersNote")}</p>
        <div
          className="posters"
          role="radiogroup"
          aria-label={t("studio.posters")}
          dir={dir}
        >
          {posters.map((p, i) => {
            const isSel = p.year === selected;
            const tval = norm(p.value, scale.min, scale.max);
            return (
              <button
                key={p.year}
                type="button"
                role="radio"
                aria-checked={isSel}
                tabIndex={isSel ? 0 : -1}
                className={`poster ${isSel ? "is-selected" : ""}`}
                onClick={() => pick(p.year)}
                onKeyDown={(e) => onKeyDown(e, i)}
                aria-label={`${p.year}, ${p.value > 0 ? "plus" : "minus"} ${Math.abs(p.value).toFixed(2)} degrees Celsius`}
              >
                <span className="poster-art" aria-hidden="true">
                  <span className="poster-disc" style={{ background: rampColor(tval) }} />
                  <span className="poster-ring" style={{ borderColor: rampColor(tval) }} />
                </span>
                <span className="poster-meta">
                  <span className="poster-year mono">{p.year}</span>
                  <span className={`poster-value mono ${p.value >= 0 ? "is-warm" : "is-cool"}`}>
                    {p.value > 0 ? "+" : ""}
                    {p.value.toFixed(2)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
