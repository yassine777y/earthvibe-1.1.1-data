"use client";

/**
 * EarthGlobe — a photoreal Earth.
 *
 * A real Blue Marble (NASA, public domain) is mapped onto the sphere, lit by a sun that always
 * keeps a visible day/night terminator, and wrapped in a thin atmospheric rim. The climate data is
 * laid over it as a latitude-band tint whose colours come from the released annual record, so the
 * warming is visible *on the planet itself* rather than in a detached chart.
 *
 * Written against three.js directly (no react-three-fiber) so the lazily loaded chunk stays small.
 * Nothing runs before mount; rendering pauses off-screen, in a hidden tab, and for users who asked
 * for reduced motion the caller renders the SVG poster instead.
 *
 * Accessibility: the canvas is decorative (`aria-hidden` on the wrapper is provided by the caller),
 * and every number it shows also exists as text beside it.
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { latitudeBands } from "@/lib/globe/ramp";

export type GlobeProps = {
  /** 0..1 position of the selected value on the whole-record scale */
  t: number;
  /** label shown in the canvas corner (e.g. "1998") */
  year: number;
  /** optional live audio amplitude 0..1; without it there is no pulse */
  level?: number;
  /** theme affects the texture variant, rim and overlay strength */
  theme: "dark" | "light";
  /** when true the globe does not auto-rotate */
  still?: boolean;
};

const RIM = { dark: 0x7fdce8, light: 0x2f7fe8 };
const TEXTURE = { dark: "/textures/earth-day.jpg", light: "/textures/earth-light.jpg" };

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
      queueMicrotask(() => setFailed(true));
      return;
    }

    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(host.clientWidth, host.clientHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = "display:block;width:100%;height:100%;";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, host.clientWidth / Math.max(1, host.clientHeight), 0.1, 100);
    camera.position.set(0, 0, 3.05);

    const root = new THREE.Group();
    root.rotation.z = THREE.MathUtils.degToRad(23.4); // axial tilt
    root.rotation.y = -0.6; // start on Africa / Europe
    scene.add(root);

    /* ── the planet ── */
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    const earthTex = loader.load(TEXTURE[theme]);
    earthTex.colorSpace = THREE.SRGBColorSpace;
    earthTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    const earthGeo = new THREE.SphereGeometry(1, 128, 96);
    const earthMat = new THREE.MeshStandardMaterial({
      map: earthTex,
      roughness: 0.86,
      metalness: 0.0,
    });
    const earth = new THREE.Mesh(earthGeo, earthMat);
    root.add(earth);

    /* ── atmosphere rim: a slightly larger back-facing sphere ── */
    const rimMat = new THREE.MeshBasicMaterial({
      color: RIM[theme],
      transparent: true,
      opacity: 0.18,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    root.add(new THREE.Mesh(new THREE.SphereGeometry(1.045, 96, 64), rimMat));

    /* ── climate overlay: latitude bands, transparent so the planet shows through ── */
    const BANDS = 36;
    const bandGroup = new THREE.Group();
    const bandMeshes: THREE.Mesh[] = [];
    const bandGeo = new THREE.SphereGeometry(1.002, 96, 3);
    for (let i = 0; i < BANDS; i++) {
      const phiTop = (Math.PI * i) / BANDS;
      const geo = new THREE.SphereGeometry(1.002, 96, 3, 0, Math.PI * 2, phiTop, Math.PI / BANDS);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(geo, mat);
      bandMeshes.push(mesh);
      bandGroup.add(mesh);
    }
    bandGroup.visible = true;
    root.add(bandGroup);
    bandGeo.dispose(); // the per-band geometries above are the ones in use

    /* ── lighting: a sun that keeps the terminator visible ── */
    const sun = new THREE.DirectionalLight(0xfff4e6, theme === "dark" ? 2.6 : 2.2);
    sun.position.set(-2.6, 0.9, 2.2);
    scene.add(sun);
    const fill = new THREE.AmbientLight(theme === "dark" ? 0x2c4250 : 0xdce8f4, theme === "dark" ? 0.42 : 0.72);
    scene.add(fill);
    // a very dim rim light from behind so the night side is not pure black
    const back = new THREE.DirectionalLight(theme === "dark" ? 0x1d5f7a : 0x8fb8dd, 0.35);
    back.position.set(1.6, -0.4, -1.8);
    scene.add(back);

    /* ── interaction: drag to spin, wheel to zoom, arrows to turn ── */
    const drag = { active: false, x: 0, y: 0, rx: 0, ry: root.rotation.y, vx: 0.0016 };
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
      camera.position.z = THREE.MathUtils.clamp(camera.position.z + e.deltaY * 0.0016, 1.9, 5.0);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") drag.ry -= 0.08;
      else if (e.key === "ArrowRight") drag.ry += 0.08;
      else if (e.key === "ArrowUp") camera.position.z = Math.max(1.9, camera.position.z - 0.15);
      else if (e.key === "ArrowDown") camera.position.z = Math.min(5.0, camera.position.z + 0.15);
      else return;
      e.preventDefault();
    };

    host.style.cursor = "grab";
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

    /* ── pause off-screen / hidden ── */
    let visible = true;
    const io = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? true;
    });
    io.observe(host);
    const onVis = () => {
      visible = !document.hidden;
    };
    document.addEventListener("visibilitychange", onVis);

    /* ── loop ── */
    let last = performance.now();
    let pulse = 0;
    let currentTheme = theme;

    const tick = (now: number) => {
      if (disposed) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (visible) {
        const s = stateRef.current;

        if (s.theme !== currentTheme) {
          currentTheme = s.theme;
          earthTex.dispose();
          const next = loader.load(TEXTURE[currentTheme]);
          next.colorSpace = THREE.SRGBColorSpace;
          next.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
          earthMat.map = next;
          earthMat.needsUpdate = true;
          rimMat.color.setHex(RIM[currentTheme]);
          sun.intensity = currentTheme === "dark" ? 2.6 : 2.2;
          fill.color.setHex(currentTheme === "dark" ? 0x2c4250 : 0xdce8f4);
          fill.intensity = currentTheme === "dark" ? 0.42 : 0.72;
          back.color.setHex(currentTheme === "dark" ? 0x1d5f7a : 0x8fb8dd);
        }

        if (!s.still && !drag.active) drag.ry += drag.vx * dt * 60 * 0.35;
        root.rotation.y = drag.ry;
        root.rotation.x = drag.rx;

        pulse += ((s.level ?? 0) - pulse) * Math.min(1, dt * 6);
        root.scale.setScalar(1 + pulse * 0.03);
        rimMat.opacity = 0.16 + pulse * 0.2;

        // Overlay strength: a whisper at the coldest year, stronger at the warmest, so "how much"
        // reads as a visual intensity instead of a hue that is impossible to compare by eye.
        const strength = 0.10 + s.t * 0.34;
        const bands = latitudeBands(s.t, 0, 1, BANDS);
        for (let i = 0; i < bandMeshes.length; i++) {
          const mat = bandMeshes[i].material as THREE.MeshBasicMaterial;
          mat.color.set(bands[i].color);
          mat.opacity = strength;
        }
        bandGroup.rotation.y = drag.ry * -0.02; // slight parallax, keeps bands from looking painted on

        renderer.render(scene, camera);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

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
      earthTex.dispose();
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
      aria-label={`Rotating globe of the Earth showing the ${year} climate overlay. Use arrow keys to turn it.`}
    />
  );
}
