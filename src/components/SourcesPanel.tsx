"use client";

/**
 * SourcesPanel — one card per phenomenon, so every sound in the app can be traced.
 *
 * Cards are built from the server's own dataset catalogue, so a phenomenon can never appear here
 * without a real source behind it. Phenomena that need a login or have no public numeric series are
 * listed as "linked only" and are explicitly not sonified.
 */
import { useEffect, useMemo, useState } from "react";
import { useApp } from "./Providers";
import { apiFetch } from "@/lib/hooks";
import { ExternalLink } from "./parts";
import type { MessageKey } from "@/lib/i18n/messages";

type SourceInfo = {
  name: string;
  producer: string;
  citation: string;
  url: string;
  dataUrl: string | null;
  notNasaProduced: boolean;
};

type DatasetMeta = {
  id: string;
  topic: string;
  title: string;
  availability: "numeric" | "image-derived";
  variable: string | null;
  units: string | null;
  temporalResolution: string;
  referencePeriod: string | null;
  source: SourceInfo;
};

/** Phenomena that exist in the roadmap but have no public numeric series here yet. */
const LINKED_ONLY = [
  {
    id: "precipitation",
    name: "Precipitation",
    unit: "mm",
    producer: "NASA POWER",
    url: "https://power.larc.nasa.gov/",
    why: "Point and gridded daily data are public, but no fetcher is implemented in this build.",
  },
  {
    id: "fire",
    name: "Fire detections",
    unit: "count",
    producer: "NASA FIRMS",
    url: "https://firms.modaps.eosdis.nasa.gov/",
    why: "CSV feeds are public; a key-less, allow-listed fetcher is planned for the next phase.",
  },
  {
    id: "air-quality",
    name: "Air quality",
    unit: "AQI",
    producer: "NASA GIBS",
    url: "https://gibs.earthdata.nasa.gov/",
    why: "Available as imagery only; would be sonified image-derived, like the ocean panel.",
  },
  {
    id: "greenhouse",
    name: "Greenhouse gases",
    unit: "ppm",
    producer: "NASA GISS",
    url: "https://data.giss.nasa.gov/",
    why: "No login-free numeric endpoint is wired into this deployment.",
  },
  {
    id: "sea-level",
    name: "Sea level",
    unit: "mm",
    producer: "NASA Earth Information Center",
    url: "https://earth.gov/sealevel",
    why: "Published as a dashboard; only linked here, never sonified.",
  },
  {
    id: "biodiversity",
    name: "Biodiversity",
    unit: "index",
    producer: "NASA / partner programmes",
    url: "https://science.nasa.gov/earth/",
    why: "No single public numeric series suitable for sonification.",
  },
];

export function SourcesPanel() {
  const { t, fmtDate } = useApp();
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    apiFetch<{ datasets: DatasetMeta[] }>("/api/datasets")
      .then((d) => alive && setDatasets(d.datasets))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const sonified = useMemo(() => datasets.filter((d) => d.availability === "numeric"), [datasets]);
  const imageDerived = useMemo(() => datasets.filter((d) => d.availability === "image-derived"), [datasets]);

  const card = (opts: {
    key: string;
    index: number;
    name: string;
    dataset: string;
    producer: string;
    unit: string;
    coverage: string;
    href: string;
    badge: string;
    badgeClass: string;
    note: string;
  }) => (
    <article className="src-card" key={opts.key}>
      <header className="src-head">
        <span className="src-index mono">{String(opts.index).padStart(2, "0")}</span>
        <span className={`src-badge ${opts.badgeClass}`}>{opts.badge}</span>
      </header>
      <h3 className="src-name">{opts.name}</h3>
      <hr className="src-rule" />
      <p className="src-dataset">{opts.dataset}</p>
      <p className="src-producer">{opts.producer}</p>
      <p className="src-meta mono">
        {opts.unit} <span aria-hidden="true">|</span> {opts.coverage}
      </p>
      <p className="src-note">{opts.note}</p>
      <ExternalLink href={opts.href}>{t("sources.open")}</ExternalLink>
    </article>
  );

  return (
    <section className="section section-alt2" id="sources" aria-labelledby="sources-h">
      <div className="wrap">
        <span className="section-index" aria-hidden="true">07</span>
        <p className="eyebrow2">{t("sources.eyebrow")}</p>
        <h2 id="sources-h">{t("sources.title")}</h2>
        <p className="lead">{t("sources.lead")}</p>

        {failed && (
          <div className="notice notice-error" role="alert">
            <p>{t("agent.error.network")}</p>
          </div>
        )}

        <h3 className="src-group-h">{t("sources.groupSonified")}</h3>
        <div className="src-grid">
          {sonified.map((d, i) =>
            card({
              key: d.id,
              index: i + 1,
              name: d.title,
              dataset: d.source.name,
              producer: d.source.producer,
              unit: d.units ?? "—",
              coverage: d.referencePeriod ? `${d.temporalResolution} · ${d.referencePeriod}` : d.temporalResolution,
              href: d.source.url,
              badge: t("sources.badgeNumeric"),
              badgeClass: "is-numeric",
              note: d.source.notNasaProduced ? t("sources.notNasa") : t("sources.nasaProduced"),
            }),
          )}
          {imageDerived.map((d, i) =>
            card({
              key: d.id,
              index: sonified.length + i + 1,
              name: d.title,
              dataset: d.source.name,
              producer: d.source.producer,
              unit: "image-derived",
              coverage: d.temporalResolution,
              href: d.source.url,
              badge: t("sources.badgeImage"),
              badgeClass: "is-image",
              note: t("sources.imageNote"),
            }),
          )}
          {LINKED_ONLY.map((d, i) =>
            card({
              key: d.id,
              index: sonified.length + imageDerived.length + i + 1,
              name: d.name,
              dataset: d.producer,
              producer: t("sources.linkedOnlyProducer"),
              unit: d.unit,
              coverage: "—",
              href: d.url,
              badge: t("sources.badgeLinked"),
              badgeClass: "is-linked",
              note: d.why,
            }),
          )}
        </div>

        <div className="src-footer">
          <div>
            <p className="mono src-cite-line">{t("sources.citation")}</p>
            <p className="src-license">{t("sources.license")}</p>
            <p className="mono src-retrieved">
              {t("sources.retrieved")}: {fmtDate(new Date().toISOString().slice(0, 10), "full")}
            </p>
          </div>
          <div className="src-footer-actions">
            <ExternalLink href="/api/release">{t("sources.manifest")}</ExternalLink>
            <ExternalLink href="/api/team-data">{t("sources.releaseJson")}</ExternalLink>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Re-exported so the i18n parity test can see the keys this component uses. */
export const SOURCE_KEYS: MessageKey[] = [
  "sources.eyebrow",
  "sources.title",
  "sources.lead",
  "sources.open",
];
