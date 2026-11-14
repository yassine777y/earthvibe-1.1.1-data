"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "./Providers";
import { GlobeStage } from "./globe/GlobeStage";
import { apiFetch, type Remote } from "@/lib/hooks";
import { norm } from "@/lib/globe/ramp";
import type { MessageKey } from "@/lib/i18n/messages";

/**
 * Hero — globe first, then one headline, then the ask/search bar.
 *
 * Data path: the released team dataset (`/api/team-data`) is bundled with the repository, so the
 * globe and the readout render even when the sandbox cannot reach the upstream NASA hosts. The
 * GISTEMP series endpoint is only used as a refinement when it happens to be reachable.
 *
 * The search bar is deliberately the first interactive element in the DOM after the heading, so a
 * screen-reader or keyboard user lands on it immediately; the globe is decorative.
 */
type Series = { year: number; value: number; movingAverage10Y: number | null };
type TeamPayload = {
  dataset: {
    records: { date: string; value: number; movingAverage10Y: number | null }[];
    units: string;
    referencePeriod: string;
  };
};

function toAnnual(records: { date: string; value: number; movingAverage10Y: number | null }[]): Series[] {
  const byYear = new Map<number, { sum: number; n: number; ma: number | null }>();
  for (const r of records) {
    if (!Number.isFinite(r.value)) continue;
    const y = Number(r.date.slice(0, 4));
    if (!Number.isFinite(y)) continue;
    const cur = byYear.get(y) ?? { sum: 0, n: 0, ma: r.movingAverage10Y };
    cur.sum += r.value;
    cur.n += 1;
    if (cur.ma === null && r.movingAverage10Y !== null) cur.ma = r.movingAverage10Y;
    byYear.set(y, cur);
  }
  return [...byYear.entries()]
    .map(([year, a]) => ({ year, value: a.sum / a.n, movingAverage10Y: a.ma }))
    .sort((a, b) => a.year - b.year);
}

export function Hero() {
  const { t, fmtNumber, theme, announce } = useApp();
  const [year, setYear] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [series, setSeries] = useState<Remote<Series[]>>({ status: "loading" });
  const inputRef = useRef<HTMLInputElement>(null);

  // The CSV-backed annual record is a local asset, so this never depends on the upstream network.
  useEffect(() => {
    let alive = true;
    // State is only touched from the promise callback, never synchronously in the effect body.
    apiFetch<TeamPayload>("/api/team-data")
      .then((d) => alive && setSeries({ status: "ready", data: toAnnual(d.dataset.records) }))
      .catch((e) => alive && setSeries({ status: "error", error: e }));
    return () => {
      alive = false;
    };
  }, []);

  const annual = useMemo(() => (series.status === "ready" ? series.data : []), [series]);

  const scale = useMemo(() => {
    if (!annual.length) return { min: -0.5, max: 1.5 };
    return { min: Math.min(...annual.map((a) => a.value)), max: Math.max(...annual.map((a) => a.value)) };
  }, [annual]);

  const selected = useMemo(() => {
    if (!annual.length) return null;
    const want = year ?? annual[annual.length - 1].year;
    return annual.find((a) => a.year === want) ?? annual[annual.length - 1];
  }, [annual, year]);

  const ask = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const q = query.trim();
      if (!q) {
        inputRef.current?.focus();
        return;
      }
      announce(q);
      const el = document.getElementById("agent");
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
      window.dispatchEvent(new CustomEvent("earthvibe:ask", { detail: { question: q } }));
      setQuery("");
    },
    [announce, query],
  );

  const value = selected?.value ?? 0;
  const tNorm = norm(value, scale.min, scale.max);
  const chips: MessageKey[] = ["hero.chip.year", "hero.chip.warmest", "hero.chip.trend", "hero.chip.data"];

  return (
    <section className="hero2" id="top" aria-labelledby="hero-title">
      <div className="wrap hero2-grid">
        <div className="hero2-copy">
          <p className="eyebrow2">{t("hero.eyebrow")}</p>
          <h1 id="hero-title" className="hero2-title">
            {t("hero2.title.1")} <span className="hero2-accent">{t("hero2.title.2")}</span>
          </h1>
          <p className="hero2-lead">{t("hero2.lead")}</p>

          <form className="askbar" onSubmit={ask} role="search">
            <label htmlFor="hero-ask" className="sr-only">
              {t("agent.question.label")}
            </label>
            <svg className="askbar-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
              <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              id="hero-ask"
              ref={inputRef}
              className="askbar-input"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("hero2.ask.placeholder")}
              autoComplete="off"
              maxLength={280}
            />
            <button type="submit" className="btn btn-primary askbar-btn">
              {t("agent.ask")}
            </button>
          </form>

          <div className="hero2-chips" role="group" aria-label={t("agent.suggestions")}>
            {chips.map((k) => (
              <button
                key={k}
                type="button"
                className="chip2"
                onClick={() => {
                  setQuery(t(k));
                  inputRef.current?.focus();
                }}
              >
                {t(k)}
              </button>
            ))}
          </div>

          <dl className="hero2-readout" aria-live="polite">
            <div>
              <dt>{t("hero2.readout.year")}</dt>
              <dd className="mono">{selected ? selected.year : "—"}</dd>
            </div>
            <div>
              <dt>{t("hero2.readout.anomaly")}</dt>
              <dd className={`mono ${value >= 0 ? "is-warm" : "is-cool"}`}>
                {annual.length ? `${value > 0 ? "+" : ""}${fmtNumber(value, 2)} °C` : "—"}
              </dd>
            </div>
            <div>
              <dt>{t("hero2.readout.basis")}</dt>
              <dd className="mono">{annual.length ? `${annual[0].year}–${annual[annual.length - 1].year}` : "—"}</dd>
            </div>
          </dl>

          {series.status === "error" && (
            <p className="hero2-offline mono" role="status">
              {t("hero2.offline")}
            </p>
          )}
        </div>

        <div className="hero2-art">
          <GlobeStage
            value={value}
            min={scale.min}
            max={scale.max}
            year={selected?.year ?? 0}
            theme={theme}
            size={640}
          />
          {selected && (
            <p className="hero2-caption">
              <span className="mono">{selected.year}</span>
              <span aria-hidden="true"> · </span>
              <span className={`mono ${value >= 0 ? "is-warm" : "is-cool"}`}>
                {value > 0 ? "+" : ""}
                {fmtNumber(value, 2)} °C
              </span>
              <span className="muted"> — {t("hero2.caption.note")}</span>
            </p>
          )}
          {annual.length > 0 && (
            <div className="hero2-scrub">
              <label htmlFor="hero-year" className="sr-only">
                {t("hero2.readout.year")}
              </label>
              <input
                id="hero-year"
                type="range"
                min={annual[0].year}
                max={annual[annual.length - 1].year}
                step={1}
                value={selected?.year ?? annual[0].year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="slider"
                aria-valuetext={`${selected?.year ?? ""}, ${value.toFixed(2)} degrees`}
                style={{ ["--fill" as string]: `${Math.round(tNorm * 100)}%` }}
              />
              <div className="hero2-scrub-ends" aria-hidden="true">
                <span className="mono">{annual[0].year}</span>
                <span className="mono">{annual[annual.length - 1].year}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
