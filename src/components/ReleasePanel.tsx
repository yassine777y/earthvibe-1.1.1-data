"use client";

import { useEffect, useState } from "react";
import { useApp } from "./Providers";
import { ExternalLink, LoadingNotice } from "./parts";
import { apiFetch } from "@/lib/hooks";
import { APP_NAME, APP_VERSION } from "@/lib/agent/version";
import type { MessageKey } from "@/lib/i18n/messages";

type ReleaseFile = { file: string; bytes: number; sha256: string };

type ReleaseInfo = {
  release: { id: string; title: string; version: string; generatedAt: string; agentVersion: string; license: string; citation: string };
  summary: { observedYears: number; start: string; end: string; predictionRows: number; warmestYear: number; warmestValue: number; quote: string };
  provenance: { suppliedBy: string; source: string; sourceUrl: string; files: string[]; attribution: string };
  access: { files: string[]; endpoints: Record<string, string>; note: string };
  integrity: { algorithm: string; files: ReleaseFile[]; note: string };
  agent: { version: string; languages: string[]; mode: string; capabilities: string[]; limitations: string[] };
  disclaimer: string;
};

function shortHash(hash: string) {
  return `${hash.slice(0, 12)}…${hash.slice(-6)}`;
}

export function ReleasePanel() {
  const { t, fmtDate } = useApp();
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    apiFetch<ReleaseInfo>("/api/release")
      .then((data) => alive && setRelease(data))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section className="section" id="release" aria-labelledby="release-h">
      <div className="wrap">
        <span className="section-index" aria-hidden="true">06</span>
        <p className="eyebrow release-eyebrow">{t("release.eyebrow")}</p>
        <h2 id="release-h">{t("release.title")}</h2>
        <p className="lead">{t("release.lead")}</p>

        {error && (
          <div className="notice notice-error" role="alert">
            <strong>{t("err.title")}</strong>
            <p>{t("release.error")}</p>
            <p className="notice-actions">
              <ExternalLink href="/api/release">{t("release.openJson")}</ExternalLink>
            </p>
          </div>
        )}

        {!release && !error && <LoadingNotice label={t("common.loading")} />}

        {release && (
          <>
            <div className="release-summary grid-3">
              <article className="panel">
                <h3>{t("release.summary.record")}</h3>
                <p className="release-big">
                  {fmtDate(release.summary.start, "year")} – {fmtDate(release.summary.end, "year")}
                </p>
                <p className="note">{t("release.summary.recordNote", { n: release.summary.observedYears })}</p>
              </article>
              <article className="panel">
                <h3>{t("release.summary.warmest")}</h3>
                <p className="release-big">
                  {release.summary.warmestYear} · +{release.summary.warmestValue.toFixed(2)} °C
                </p>
                <p className="note">{t("release.summary.warmestNote")}</p>
              </article>
              <article className="panel">
                <h3>{t("release.summary.predictions")}</h3>
                <p className="release-big">{release.summary.predictionRows}</p>
                <p className="note">{t("release.summary.predictionsNote")}</p>
              </article>
            </div>

            <div className="grid-2 release-grid">
              <article className="panel">
                <h3>{t("release.files.title")}</h3>
                <p>{t("release.files.body")}</p>
                <div className="table-scroll" tabIndex={0} role="region" aria-label={t("release.files.title")}>
                  <table className="data-table">
                    <caption>{t("release.files.caption", { algorithm: release.integrity.algorithm.toUpperCase() })}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{t("release.files.colFile")}</th>
                        <th scope="col">{t("release.files.colSize")}</th>
                        <th scope="col">{release.integrity.algorithm.toUpperCase()}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {release.integrity.files.map((f) => (
                        <tr key={f.file}>
                          <th scope="row">
                            <code>{f.file}</code>
                          </th>
                          <td>{new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(f.bytes)} B</td>
                          <td>
                            <abbr title={f.sha256}>{shortHash(f.sha256)}</abbr>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="link-row">
                  <ExternalLink href="/api/release">{t("release.openJson")}</ExternalLink>
                  <ExternalLink href={release.provenance.sourceUrl}>{t("release.openSource")}</ExternalLink>
                </p>
                <p className="note">{release.integrity.note}</p>
              </article>

              <article className="panel">
                <h3>{t("release.boot.title")}</h3>
                <p>{t("release.boot.body")}</p>
                <ul className="boot-badges">
                  <li className="badge badge-ocean">
                    {APP_NAME} {APP_VERSION}
                  </li>
                  <li className="badge badge-ice">
                    {t("release.boot.agent")} {release.agent.version}
                  </li>
                  <li className="badge badge-warn">{t("release.boot.langs", { langs: release.agent.languages.join(" · ") })}</li>
                </ul>
                <h4>{t("release.boot.can")}</h4>
                <ul className="list">
                  {release.agent.capabilities.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
                <h4>{t("release.boot.cannot")}</h4>
                <ul className="list">
                  {release.agent.limitations.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
                <h4>{t("release.api.title")}</h4>
                <ul className="api-list">
                  {Object.entries(release.access.endpoints).map(([name, path]) => (
                    <li key={name}>
                      <code>
                        {path.startsWith("/api/team-data") ? "GET" : name === "agent" ? "GET · POST" : name === "transcribe" ? "GET · POST" : "GET"} {path}
                      </code>
                      <span className="muted"> — {t(`release.api.${name}` as MessageKey)}</span>
                    </li>
                  ))}
                </ul>
              </article>
            </div>

            <div className="panel release-provenance">
              <h3>{t("release.provenance.title")}</h3>
              <p>{release.release.citation}</p>
              <p className="note">{release.release.license}</p>
              <p className="note">{release.disclaimer}</p>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
