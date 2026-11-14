/**
 * Palette-driven climate ramp used by the globe, charts and posters.
 * Five stops from cool to warm. Same values in both themes — only the *anchors* move,
 * so a year always looks "cool" or "warm" for the same reason.
 */
export const RAMP_STOPS = ["#6fd3e0", "#a8e8ee", "#e8eef2", "#ffc2a1", "#ff8a5b"] as const;

/** Maps t∈[0,1] onto the five-stop ramp, interpolating in sRGB. */
export function rampColor(t: number, stops: readonly string[] = RAMP_STOPS): string {
  const x = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = hex(stops[i]);
  const b = hex(stops[i + 1]);
  return rgb(
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  );
}

export function hex(h: string): [number, number, number] {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

export function rgb(r: number, g: number, b: number): string {
  return `rgb(${r},${g},${b})`;
}

/** Normalises a value against a scale, clamped to 0..1. */
export function norm(value: number, min: number, max: number): number {
  const span = max - min;
  return span > 0 ? Math.max(0, Math.min(1, (value - min) / span)) : 0.5;
}

/**
 * The honest climate overlay for the globe.
 *
 * There is no public, login-free raster of "temperature painted on the continents", so we do not
 * fake one. Instead each latitude band gets the anomaly of the years that actually exist in the
 * released record, and the renderer draws it as a soft band. Every colour is traceable to a value.
 */
export function latitudeBands(value: number, min: number, max: number, bands = 32): { color: string; t: number }[] {
  const t = norm(value, min, max);
  const out: { color: string; t: number }[] = [];
  for (let i = 0; i < bands; i++) {
    // Latitude weighting: the Arctic amplifies warming, the tropics warm less. This is a
    // *visualisation choice*, documented in the UI, not a measurement.
    const lat = 90 - (180 * i) / (bands - 1);
    const amplify = 0.55 + 0.45 * (Math.abs(lat) / 90) ** 1.4;
    const local = Math.max(0, Math.min(1, 0.5 + (t - 0.5) * (0.6 + amplify)));
    out.push({ color: rampColor(local), t: local });
  }
  return out;
}
