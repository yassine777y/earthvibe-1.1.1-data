"use client";

import { useMemo } from "react";
import { latitudeBands, norm } from "@/lib/globe/ramp";

/**
 * GlobeFallback — the same globe, drawn as static SVG.
 *
 * Used when WebGL is unavailable, when the user prefers reduced motion, or before the 3D chunk has
 * loaded. It shows the identical latitude-band colours, computed from the identical function, so no
 * information is lost. This is the accessible source of truth for the hero visual.
 */
export function GlobeFallback({
  value,
  min,
  max,
  year,
  size = 520,
  className,
}: {
  value: number;
  min: number;
  max: number;
  year: number;
  size?: number;
  className?: string;
}) {
  const r = size / 2 - 6;
  const cx = size / 2;
  const cy = size / 2;
  const bands = useMemo(() => latitudeBands(norm(value, min, max), 0, 1, 28), [value, min, max]);

  // Draw each latitude band as an ellipse-clipped horizontal slice of the sphere.
  const slices = bands.map((b, i) => {
    const latTop = 90 - (180 * i) / bands.length;
    const latBottom = 90 - (180 * (i + 1)) / bands.length;
    const yTop = cy - Math.sin((latTop * Math.PI) / 180) * r;
    const yBottom = cy - Math.sin((latBottom * Math.PI) / 180) * r;
    const wTop = Math.cos((latTop * Math.PI) / 180) * r;
    const wBottom = Math.cos((latBottom * Math.PI) / 180) * r;
    const h = Math.max(1, yBottom - yTop);
    // a trapezoid approximates the curved slice well at 28 bands
    const d = `M ${cx - wTop} ${yTop} L ${cx + wTop} ${yTop} L ${cx + wBottom} ${yBottom} L ${cx - wBottom} ${yBottom} Z`;
    return { d, color: b.color, key: i, h };
  });

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      width={size}
      height={size}
      role="img"
      aria-label={`Globe for ${year}: climate band overlay from cool to warm. The value is printed beside the globe.`}
    >
      <defs>
        <clipPath id="globe-clip">
          <circle cx={cx} cy={cy} r={r} />
        </clipPath>
      </defs>
      {/* ocean */}
      <circle cx={cx} cy={cy} r={r} fill="var(--c-surface-2)" />
      {/* climate latitude bands */}
      <g clipPath="url(#globe-clip)" opacity="0.92">
        {slices.map((s) => (
          <path key={s.key} d={s.d} fill={s.color} />
        ))}
      </g>
      {/* meridians, hairline */}
      <g clipPath="url(#globe-clip)" stroke="var(--c-line-strong)" strokeWidth="1" opacity="0.5" fill="none">
        <ellipse cx={cx} cy={cy} rx={r * 0.62} ry={r} />
        <ellipse cx={cx} cy={cy} rx={r * 0.24} ry={r} />
        <line x1={cx - r} y1={cy} x2={cx + r} y2={cy} />
        <line x1={cx} y1={cy - r} x2={cx} y2={cy + r} />
      </g>
      {/* rim */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--c-signal)" strokeWidth="1.5" opacity="0.75" />
      <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke="var(--c-signal)" strokeWidth="1" opacity="0.22" />
    </svg>
  );
}
