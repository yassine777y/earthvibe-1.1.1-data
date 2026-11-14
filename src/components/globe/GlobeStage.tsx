"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";
import { GlobeFallback } from "./GlobeFallback";

/**
 * GlobeStage decides *how* the globe is drawn, and never blocks first paint:
 *
 *  1. server and hydration  → static SVG poster (same colours, same data, no JS)
 *  2. after mount, if WebGL exists and motion is allowed → swap in the 3D chunk
 *  3. reduced motion, no WebGL, or a chunk failure → keep the SVG poster
 *
 * Server and client must agree on the first render, so the decision is made in an effect rather
 * than in a state initialiser: an initialiser reads `window` on the client and would make
 * hydration produce different markup than the server.
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

/**
 * Capability probe, exposed as an external store. `getServerSnapshot` returns false, so the server
 * and the first client render both draw the poster; immediately after hydration React re-reads the
 * client snapshot and switches to 3D only when it is actually usable. This is the documented way to
 * read browser-only state without a state update inside an effect.
 */
let cached3d: boolean | null = null;

function canRender3d(): boolean {
  if (cached3d === null) {
    cached3d =
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches && webglAvailable();
  }
  return cached3d;
}

const noSubscription = () => () => {};

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
  const use3d = useSyncExternalStore(noSubscription, canRender3d, () => false);

  const t = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0.5;

  return (
    <div className="globe-stage" style={{ aspectRatio: "1 / 1" }}>
      {use3d ? (
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
