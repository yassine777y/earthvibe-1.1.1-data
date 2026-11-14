/**
 * Land geometry for the globe, from the Natural Earth 110m dataset shipped by `world-atlas`
 * (public domain, ~110 KB TopoJSON). Converted once into unit-sphere triangle rings so the
 * renderer only ever deals with plain Float32Arrays.
 *
 * Nothing here touches the DOM, so it is safe to import from a server component or a test.
 */
import { feature } from "topojson-client";
import type { FeatureCollection, Geometry, MultiPolygon, Polygon, Position } from "geojson";

type Topology = Parameters<typeof feature>[0];
type LandMesh = {
  /** flat [x,y,z, x,y,z, ...] triangles on the unit sphere */
  vertices: Float32Array;
  /** number of triangles */
  triangles: number;
};

type Poly = Position[][];

let cachedMesh: LandMesh | null = null;
let cachedTopo: Topology | null = null;

/** Natural Earth 110m land polygons as GeoJSON rings. Loaded lazily, cached for the process. */
export async function loadLandTopology(): Promise<Topology> {
  if (cachedTopo) return cachedTopo;
  const mod = (await import("world-atlas/countries-110m.json")) as unknown as { default: Topology };
  cachedTopo = mod.default;
  return cachedTopo;
}

export function toCartesian(lon: number, lat: number, r = 1): [number, number, number] {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  return [-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta)];
}

/**
 * Triangulate every country polygon as a fan around its centroid and lift it slightly above the
 * ocean sphere. Country borders are not drawn, so neighbouring fans meet without seams.
 */
export async function buildLandMesh(): Promise<LandMesh> {
  if (cachedMesh) return cachedMesh;
  const topo = await loadLandTopology();
  const geo = feature(topo, topo.objects.countries) as unknown as FeatureCollection<Geometry>;

  const verts: number[] = [];
  const push = (lon: number, lat: number) => {
    const [x, y, z] = toCartesian(lon, lat);
    verts.push(x, y, z);
  };

  for (const f of geo.features) {
    const g = f.geometry;
    if (!g) continue;
    const polys: Poly[] = g.type === "Polygon" ? [g.coordinates as Poly] : g.type === "MultiPolygon" ? (g.coordinates as Poly[]) : [];
    for (const poly of polys) {
      const outer = poly[0];
      if (!outer || outer.length < 4) continue;
      // centroid of the outer ring, used as the fan apex
      let sx = 0;
      let sy = 0;
      for (const [lon, lat] of outer) {
        sx += lon;
        sy += lat;
      }
      const clon = sx / outer.length;
      const clat = sy / outer.length;
      for (let i = 0; i < outer.length - 1; i++) {
        const a = outer[i];
        const b = outer[i + 1];
        // skip segments that wrap the antimeridian (would smear across the globe)
        if (Math.abs(a[0] - b[0]) > 180) continue;
        push(clon, clat);
        push(a[0], a[1]);
        push(b[0], b[1]);
      }
    }
  }

  cachedMesh = { vertices: new Float32Array(verts), triangles: verts.length / 9 };
  return cachedMesh;
}

/** Small deterministic hash so the same country always gets the same subtle tint. */
export function tintFor(index: number): number {
  const x = Math.sin(index * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
