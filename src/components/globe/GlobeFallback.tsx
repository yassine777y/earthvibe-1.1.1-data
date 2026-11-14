"use client";

import { useMemo } from "react";
import { latitudeBands, norm } from "@/lib/globe/ramp";

/**
 * GlobeFallback — the same planet, drawn as static SVG.
 *
 * Used when WebGL is unavailable, when the user prefers reduced motion, or before the 3D chunk has
 * loaded. It uses the same Blue Marble photograph as the WebGL globe (clipped to the sphere and
 * shaded), plus the identical latitude-band colours computed from the identical function, so the
 * reader loses no information. This is the accessible source of truth for the hero visual.
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
  const uid = useMemo(() => `g${Math.abs(Math.round(value * 1000))}-${size}`, [value, size]);

  // Each latitude band is a spherical slice seen from the camera: a band of constant latitude
  // projects to an ellipse segment, so the slice is drawn between two half-ellipses.
  const slices = bands.map((b, i) => {
    const latTop = 90 - (180 * i) / bands.length;
    const latBottom = 90 - (180 * (i + 1)) / bands.length;
    const yTop = cy - Math.sin((latTop * Math.PI) / 180) * r;
    const yBottom = cy - Math.sin((latBottom * Math.PI) / 180) * r;
    const wTop = Math.cos((latTop * Math.PI) / 180) * r;
    const wBottom = Math.cos((latBottom * Math.PI) / 180) * r;
    const n = (v: number) => Math.round(v * 10) / 10;
    const d = `M${n(cx - wTop)} ${n(yTop)}A${n(wTop)} ${n(wTop * 0.34)} 0 0 0 ${n(cx + wTop)} ${n(yTop)}L${n(cx + wBottom)} ${n(yBottom)}A${n(wBottom)} ${n(wBottom * 0.34)} 0 0 1 ${n(cx - wBottom)} ${n(yBottom)}Z`;
    return { d, color: b.color, key: i };
  });

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      width={size}
      height={size}
      role="img"
      aria-label={`Globe of the Earth for ${year}, with a climate latitude overlay from cool at the poles to warm near the equator. The value is printed beside the globe.`}
    >
      <defs>
        <clipPath id={`${uid}-clip`}>
          <circle cx={cx} cy={cy} r={r} />
        </clipPath>
        {/* day-side shading: light from the upper left, falling off to the lower right */}
        <radialGradient id={`${uid}-day`} cx="34%" cy="26%" r="82%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.34" />
          <stop offset="46%" stopColor="#ffffff" stopOpacity="0.05" />
          <stop offset="78%" stopColor="#000000" stopOpacity="0.34" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.62" />
        </radialGradient>
        <radialGradient id={`${uid}-rim`} cx="50%" cy="50%" r="50%">
          <stop offset="88%" stopColor="var(--c-signal)" stopOpacity="0" />
          <stop offset="100%" stopColor="var(--c-signal)" stopOpacity="0.55" />
        </radialGradient>
      </defs>

      {/* the real planet */}
      <image
        href="/textures/earth-day.jpg"
        x={0}
        y={0}
        width={size * 2}
        height={size}
        preserveAspectRatio="xMidYMid slice"
        clipPath={`url(#${uid}-clip)`}
      />
      {/* climate overlay, additive so the photograph still reads */}
      <g clipPath={`url(#${uid}-clip)`} style={{ mixBlendMode: "screen" }} opacity="0.5">
        {slices.map((s) => (
          <path key={s.key} d={s.d} fill={s.color} />
        ))}
      </g>
      {/* day / night shading */}
      <circle cx={cx} cy={cy} r={r} fill={`url(#${uid}-day)`} />
      {/* atmospheric rim */}
      <circle cx={cx} cy={cy} r={r} fill={`url(#${uid}-rim)`} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--c-signal)" strokeWidth="1" opacity="0.45" />
    </svg>
  );
}
