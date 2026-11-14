import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Providers } from "@/components/Providers";
import { GlobeFallback } from "@/components/globe/GlobeFallback";
import { Hero } from "@/components/Hero";
import { SoundStudio } from "@/components/SoundStudio";
import { SourcesPanel } from "@/components/SourcesPanel";
import { latitudeBands, norm, rampColor, RAMP_STOPS } from "@/lib/globe/ramp";
import { toCartesian } from "@/lib/globe/land";

describe("climate ramp", () => {
  it("clamps t to the five-stop ramp", () => {
    expect(rampColor(-5)).toBe(rampColor(0));
    expect(rampColor(9)).toBe(rampColor(1));
    expect(rampColor(0)).toMatch(/^rgb\(/);
    expect(RAMP_STOPS).toHaveLength(5);
  });

  it("moves from cool to warm as t rises", () => {
    const cool = rampColor(0).match(/\d+/g)!.map(Number);
    const warm = rampColor(1).match(/\d+/g)!.map(Number);
    // the red channel must rise and the blue channel must fall from cool to warm
    expect(warm[0]).toBeGreaterThan(cool[0]);
    expect(warm[2]).toBeLessThan(cool[2]);
  });

  it("normalises against a real scale", () => {
    expect(norm(0, -1, 1)).toBeCloseTo(0.5, 6);
    expect(norm(99, -1, 1)).toBe(1);
    expect(norm(-99, -1, 1)).toBe(0);
    expect(norm(5, 5, 5)).toBe(0.5); // degenerate scale never divides by zero
  });

  it("builds one band per requested latitude row", () => {
    const bands = latitudeBands(1.2, -0.5, 1.5, 32);
    expect(bands).toHaveLength(32);
    expect(bands.every((b) => /^rgb\(/.test(b.color))).toBe(true);
    expect(bands.every((b) => b.t >= 0 && b.t <= 1)).toBe(true);
  });
});

describe("land geometry", () => {
  it("projects lon/lat onto the unit sphere", () => {
    const north = toCartesian(0, 90);
    expect(north[1]).toBeCloseTo(1, 6);
    const equator = toCartesian(0, 0);
    expect(equator[1]).toBeCloseTo(0, 6);
    const len = Math.hypot(...toCartesian(12, 34));
    expect(len).toBeCloseTo(1, 6);
  });
});

describe("globe fallback", () => {
  it("renders a labelled SVG with the year and accessibility text", () => {
    const html = renderToString(
      <Providers>
        <GlobeFallback value={0.58} min={-0.5} max={1.5} year={1998} size={400} />
      </Providers>,
    );
    expect(html).toContain("<svg");
    expect(html).toContain("1998");
    expect(html).toContain('role="img"');
    expect(html).toMatch(/aria-label="Globe for 1998/);
    // it draws real latitude bands, not a flat circle
    expect((html.match(/<path/g) ?? []).length).toBeGreaterThan(20);
  });
});

describe("new sections render without crashing on the server", () => {
  it("hero renders the ask bar, readout and a globe stage", () => {
    const html = renderToString(
      <Providers>
        <Hero />
      </Providers>,
    );
    expect(html).toContain("hero2");
    expect(html).toContain("askbar");
    expect(html).toContain("globe-stage");
    expect(html).toContain("hero2-readout");
    // the search field must be labelled for assistive tech
    expect(html).toMatch(/<label[^>]*for="hero-ask"/);
  });

  it("studio renders its controls inside a labelled section", () => {
    const html = renderToString(
      <Providers>
        <SoundStudio />
      </Providers>,
    );
    expect(html).toContain('id="studio"');
    expect(html).toContain("studio-range");
    expect(html).toContain("radiogroup");
  });

  it("sources panel is a labelled section with an empty state before data arrives", () => {
    const html = renderToString(
      <Providers>
        <SourcesPanel />
      </Providers>,
    );
    expect(html).toContain('id="sources"');
    expect(html).toContain("sources-h");
  });
});
