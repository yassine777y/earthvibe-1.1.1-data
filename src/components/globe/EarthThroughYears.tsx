"use client";

/**
 * EarthThroughYears — one small Earth per year.
 *
 * Every tile is the same planet (the NASA Blue Marble photograph, clipped to a sphere) with the
 * year's own latitude overlay painted over it, so the difference between 1880 and 2025 is visible
 * as colour, not as a number you have to trust. Selecting a tile drives the shared hero globe.
 *
 * The gallery is a real radiogroup: arrow keys move, Home/End jump to the ends, and each tile
 * carries a spoken label with the year and its anomaly. The rail is horizontally scrollable and
 * scroll-snaps, with a fixed number of tiles at every breakpoint so no tile is a different size.
 */
import { useCallback, useMemo, useRef } from "react";
import { useApp } from "@/components/Providers";
import { latitudeBands, norm } from "@/lib/globe/ramp";
import type { MessageKey } from "@/lib/i18n/messages";

export type YearRow = { year: number; value: number };

/** One small globe: the photograph plus that year's latitude overlay. */
function YearGlobe({ t, size = 96, uid }: { t: number; size?: number; uid: string }) {
  const bands = useMemo(() => latitudeBands(t, 0, 1, 22), [t]);
  const r = size / 2 - 2;
  const cx = size / 2;
  const cy = size / 2;

  const slices = bands.map((b, i) => {
    const latTop = 90 - (180 * i) / bands.length;
    const latBottom = 90 - (180 * (i + 1)) / bands.length;
    const yTop = cy - Math.sin((latTop * Math.PI) / 180) * r;
    const yBottom = cy - Math.sin((latBottom * Math.PI) / 180) * r;
    const wTop = Math.max(0.5, Math.cos((latTop * Math.PI) / 180) * r);
    const wBottom = Math.max(0.5, Math.cos((latBottom * Math.PI) / 180) * r);
    const n = (v: number) => Math.round(v * 10) / 10;
    return {
      d: `M${n(cx - wTop)} ${n(yTop)}A${n(wTop)} ${n(wTop * 0.34)} 0 0 0 ${n(cx + wTop)} ${n(yTop)}L${n(cx + wBottom)} ${n(yBottom)}A${n(wBottom)} ${n(wBottom * 0.34)} 0 0 1 ${n(cx - wBottom)} ${n(yBottom)}Z`,
      color: b.color,
      key: i,
    };
  });

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={`${uid}-clip`}>
          <circle cx={cx} cy={cy} r={r} />
        </clipPath>
        <radialGradient id={`${uid}-shade`} cx="34%" cy="26%" r="82%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="50%" stopColor="#ffffff" stopOpacity="0.02" />
          <stop offset="80%" stopColor="#000000" stopOpacity="0.36" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.64" />
        </radialGradient>
      </defs>
      <image
        href="/textures/earth-day-thumb.jpg"
        x={-size * 0.5}
        y={0}
        width={size * 2}
        height={size}
        preserveAspectRatio="xMidYMid slice"
        clipPath={`url(#${uid}-clip)`}
      />
      <g clipPath={`url(#${uid}-clip)`} style={{ mixBlendMode: "screen" }} opacity="0.55">
        {slices.map((s) => (
          <path key={s.key} d={s.d} fill={s.color} />
        ))}
      </g>
      <circle cx={cx} cy={cy} r={r} fill={`url(#${uid}-shade)`} />
    </svg>
  );
}

export function EarthThroughYears({
  rows,
  selectedYear,
  onSelect,
  min,
  max,
}: {
  rows: YearRow[];
  selectedYear: number | null;
  onSelect: (year: number) => void;
  min: number;
  max: number;
}) {
  const { t, fmtNumber } = useApp();
  const railRef = useRef<HTMLDivElement>(null);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      let next = index;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next = Math.min(rows.length - 1, index + 1);
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = Math.max(0, index - 1);
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = rows.length - 1;
      else return;
      e.preventDefault();
      onSelect(rows[next].year);
      // keep the focused tile in view as the selection moves
      const rail = railRef.current;
      const child = rail?.children[next] as HTMLElement | undefined;
      child?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    },
    [onSelect, rows],
  );

  if (!rows.length) return null;

  return (
    <div className="years">
      <div className="years-head">
        <h3 className="years-title">{t("years.title")}</h3>
        <p className="years-note">{t("years.note")}</p>
      </div>
      <div
        className="years-rail"
        ref={railRef}
        role="radiogroup"
        aria-label={t("years.title")}
      >
        {rows.map((row, i) => {
          const isSel = row.year === selectedYear;
          const tt = norm(row.value, min, max);
          return (
            <button
              key={row.year}
              type="button"
              role="radio"
              aria-checked={isSel}
              tabIndex={isSel ? 0 : -1}
              className={`year-tile${isSel ? " is-selected" : ""}`}
              onClick={() => onSelect(row.year)}
              onKeyDown={(e) => onKeyDown(e, i)}
              aria-label={`${row.year}: ${row.value > 0 ? "plus" : "minus"} ${Math.abs(row.value).toFixed(2)} degrees Celsius`}
            >
              <YearGlobe t={tt} uid={`y${row.year}`} />
              <span className="year-tile-year mono">{row.year}</span>
              <span className={`year-tile-val mono ${row.value >= 0 ? "is-warm" : "is-cool"}`}>
                {row.value > 0 ? "+" : ""}
                {fmtNumber(row.value, 2)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const YEARS_KEYS: MessageKey[] = ["years.title", "years.note"];
