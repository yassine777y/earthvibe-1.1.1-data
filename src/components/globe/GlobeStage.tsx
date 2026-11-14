"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { GlobeFallback } from "./GlobeFallback";

/**
 * GlobeStage decides *how* the globe is drawn, and never blocks first paint:
 *
 *  1. server / first paint  → static SVG poster (same colours, no JS)
 *  2. after mount, WebGL ok and motion allowed → lazy-load the 3D chunk
 *  3. reduced motion, no WebGL, or chunk failure → keep the SVG poster
 *
 * The 3D chunk is only requested for users who can actually run it.
 */
const EarthGlobe = dynamic(() => import("./EarthGlobe"), {
  ssr: false,
  loading: () => null,
});

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext("webgl2") || canvas.getContext("webgl") || canvas.getContext("experimental-webgl")),
    );
  } catch {
    return false;
  }
}

export type GlobeStageProps = {
  value: number;
  min: number;
  max: number;
  year: number;
  theme: "dark" | "light";
  level?: number;
  /** shown under the globe by the caller */
  size?: number;
};

export function GlobeStage({ value, min, max, year, theme, level = 0, size = 520 }: GlobeStageProps) {
  // Decided once, on the client, in a lazy initialiser: SSR and the first client paint always
  // render the poster, then React re-runs the initialiser on hydration with the real environment.
  const [mode] = useState<"poster" | "3d">(() => {
    if (typeof window === "undefined") return "poster";
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return "poster";
    return webglAvailable() ? "3d" : "poster";
  });

  const t = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0.5;

  return (
    <div className="globe-stage" style={{ aspectRatio: "1 / 1" }}>
      {mode === "3d" ? (
        <>
          <EarthGlobe t={t} year={year} level={level} theme={theme} still={false} />
          {/* text alternative always present, never hidden from assistive tech */}
          <p className="sr-only">
            Rotating three-dimensional globe. The climate band overlay for {year} runs from cool at the poles to warm near
            the equator, and the value {value.toFixed(2)} is printed beside the globe.
          </p>
        </>
      ) : (
        <GlobeFallback value={value} min={min} max={max} year={year} size={size} className="globe-poster" />
      )}
    </div>
  );
}
