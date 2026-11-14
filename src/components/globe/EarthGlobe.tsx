"use client";

/**
 * EarthGlobe — the 3D centerpiece.
 *
 * A real sphere with real continents (Natural Earth 110m), a day-side light, a faint rim, and a
 * climate band overlay whose colours come from the released annual record. It is decorative:
 * `aria-hidden` on the canvas, and every number it shows also exists as text next to it.
 *
 * Written against three.js directly (no react-three-fiber) to keep the lazily-loaded chunk small.
 * Nothing runs until the component mounts, and it stops rendering when off-screen or when the tab
 * is hidden.
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { buildLandMesh, toCartesian } from "@/lib/globe/land";
import { latitudeBands } from "@/lib/globe/ramp";

export type GlobeProps = {
  /** 0..1 position of the selected value on the whole-record scale */
  t: number;
  /** label shown in the canvas corner (e.g. "1998") */
  year: number;
  /** optional live audio amplitude 0..1; without it there is no pulse */
  level?: number;
  /** theme affects ocean/atmosphere colours */
  theme: "dark" | "light";
  /** when true the globe does not auto-rotate */
  still?: boolean;
};

const OCEAN = { dark: 0x0b1a26, light: 0x1b3a52 };
const RIM = { dark: 0x6fd3e0, light: 0x1d6fe0 };
const LAND = { dark: 0x2a3b40, light: 0x8fa8a0 };

export default function EarthGlobe({ t, year, level = 0, theme, still = false }: GlobeProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const stateRef = useRef({ t, level, theme, still });

  // Prop changes reach the render loop through a ref; writing it in an effect keeps render pure.
  useEffect(() => {
    stateRef.current = { t, level, theme, still };
  }, [t, level, theme, still]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let raf = 0;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      // WebGL could not be initialised: GlobeStage will keep the SVG poster instead.
      queueMicrotask(() => setFailed(true));
      return;
    }

    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(host.clientWidth, host.clientHeight, false);
    host.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = "display:block;width:100%;height:100%;";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, host.clientWidth / Math.max(1, host.clientHeight), 0.1, 100);
    camera.position.set(0, 0, 3.15);

    const root = new THREE.Group();
    root.rotation.z = THREE.MathUtils.degToRad(23.4); // axial tilt
    scene.add(root);

    /* ── ocean sphere ── */
    const oceanGeo = new THREE.SphereGeometry(1, 96, 64);
    const oceanMat = new THREE.MeshStandardMaterial({ color: OCEAN[theme], roughness: 0.92, metalness: 0.0 });
    const ocean = new THREE.Mesh(oceanGeo, oceanMat);
    root.add(ocean);

    /* ── atmosphere rim: a back-facing sphere with additive falloff ── */
    const rimGeo = new THREE.SphereGeometry(1.035, 64, 48);
    const rimMat = new THREE.MeshBasicMaterial({ color: RIM[theme], transparent: true, opacity: 0.16, side: THREE.BackSide });
    root.add(new THREE.Mesh(rimGeo, rimMat));

    /* ── climate bands: thin latitude ribbons sitting just above the ocean ── */
    const bandGroup = new THREE.Group();
    root.add(bandGroup);
    const BANDS = 32;
    const bandMeshes: THREE.Mesh[] = [];
    for (let i = 0; i < BANDS; i++) {
      const latTop = 90 - (180 * i) / BANDS;
      const latBottom = 90 - (180 * (i + 1)) / BANDS;
      const phiTop = ((90 - latTop) * Math.PI) / 180;
      const phiBottom = ((90 - latBottom) * Math.PI) / 180;
      const geo = new THREE.SphereGeometry(1.004, 96, 3, 0, Math.PI * 2, phiTop, phiBottom - phiTop);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
      const mesh = new THREE.Mesh(geo, mat);
      bandMeshes.push(mesh);
      bandGroup.add(mesh);
    }

    /* ── land: one mesh, real continents ── */
    let landMesh: THREE.Mesh | null = null;

    /* ── lighting: one key light (day side) + soft fill ── */
    const key = new THREE.DirectionalLight(0xffffff, theme === "dark" ? 2.1 : 2.6);
    key.position.set(-2.2, 1.4, 2.6);
    scene.add(key);
    const fill = new THREE.AmbientLight(theme === "dark" ? 0x4a6a7a : 0xdfe8f0, theme === "dark" ? 0.55 : 0.9);
    scene.add(fill);

    /* ── interaction: drag to spin, wheel to zoom ── */
    const drag = { active: false, x: 0, y: 0, rx: 0, ry: 0, vx: 0.0012 };
    const onDown = (e: PointerEvent) => {
      drag.active = true;
      drag.x = e.clientX;
      drag.y = e.clientY;
      renderer.domElement.setPointerCapture(e.pointerId);
      host.style.cursor = "grabbing";
    };
    const onMove = (e: PointerEvent) => {
      if (!drag.active) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.ry += dx * 0.005;
      drag.rx = THREE.MathUtils.clamp(drag.rx + dy * 0.004, -0.9, 0.9);
      drag.vx = dx * 0.0004;
    };
    const onUp = (e: PointerEvent) => {
      drag.active = false;
      if (renderer.domElement.hasPointerCapture(e.pointerId)) renderer.domElement.releasePointerCapture(e.pointerId);
      host.style.cursor = "grab";
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      camera.position.z = THREE.MathUtils.clamp(camera.position.z + e.deltaY * 0.0016, 2.1, 5.2);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") drag.ry -= 0.08;
      else if (e.key === "ArrowRight") drag.ry += 0.08;
      else if (e.key === "ArrowUp") camera.position.z = Math.max(2.1, camera.position.z - 0.15);
      else if (e.key === "ArrowDown") camera.position.z = Math.min(5.2, camera.position.z + 0.15);
      else return;
      e.preventDefault();
    };

    host.style.cursor = "grab";
    host.tabIndex = 0;
    host.addEventListener("pointerdown", onDown);
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerup", onUp);
    host.addEventListener("pointercancel", onUp);
    host.addEventListener("wheel", onWheel, { passive: false });
    host.addEventListener("keydown", onKey);

    /* ── resize ── */
    const ro = new ResizeObserver(() => {
      const w = host.clientWidth;
      const h = Math.max(1, host.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(host);

    /* ── pause when off-screen or hidden ── */
    let visible = true;
    const io = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? true;
    });
    io.observe(host);
    const onVis = () => {
      visible = !document.hidden;
    };
    document.addEventListener("visibilitychange", onVis);

    /* ── build land asynchronously, then start the loop ── */
    let started = false;
    const start = () => {
      if (started || disposed) return;
      started = true;
      let last = performance.now();
      let pulse = 0;

      const tick = (now: number) => {
        if (disposed) return;
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        if (visible) {
          const s = stateRef.current;
          if (!s.still && !drag.active) drag.ry += drag.vx * dt * 60 * 0.35;
          root.rotation.y = drag.ry;
          root.rotation.x = drag.rx;
          pulse += ((s.level ?? 0) - pulse) * Math.min(1, dt * 6);
          const scale = 1 + pulse * 0.035;
          root.scale.setScalar(scale);
          rimMat.opacity = 0.14 + pulse * 0.22;

          if (landMesh) (landMesh.material as THREE.MeshStandardMaterial).color.setHex(LAND[s.theme]);
          oceanMat.color.setHex(OCEAN[s.theme]);
          rimMat.color.setHex(RIM[s.theme]);
          key.intensity = s.theme === "dark" ? 2.1 : 2.6;
          fill.intensity = s.theme === "dark" ? 0.55 : 0.9;

          const bands = latitudeBands(s.t, 0, 1, BANDS);
          for (let i = 0; i < bandMeshes.length; i++) {
            (bandMeshes[i].material as THREE.MeshBasicMaterial).color.set(bands[i].color);
          }
          renderer.render(scene, camera);
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };

    buildLandMesh()
      .then(({ vertices }) => {
        if (disposed) return;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
        geo.computeVertexNormals();
        const mat = new THREE.MeshStandardMaterial({
          color: LAND[theme],
          roughness: 0.85,
          metalness: 0.02,
          side: THREE.DoubleSide,
        });
        landMesh = new THREE.Mesh(geo, mat);
        landMesh.scale.setScalar(1.006);
        root.add(landMesh);
        start();
      })
      .catch(() => {
        setFailed(false); // still render ocean + bands rather than nothing
        start();
      });

    /* ── cleanup ── */
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onUp);
      host.removeEventListener("wheel", onWheel);
      host.removeEventListener("keydown", onKey);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (failed) return null;

  return (
    <div
      ref={hostRef}
      className="globe-host"
      role="img"
      aria-label={`Rotating globe showing the ${year} climate band overlay. Use arrow keys to turn it.`}
    />
  );
}

/** Pre-computes a few lat/lon helpers for tests and the fallback poster. */
export const _internal = { toCartesian };
