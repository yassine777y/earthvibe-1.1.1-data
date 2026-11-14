import type { NextConfig } from "next";

/**
 * Dev origins.
 *
 * This app is served through a preview proxy whose host looks like
 * `3000-<sandbox-id>.e2b.app`. Next.js blocks cross-origin access to its own dev
 * resources (the HMR socket in particular) unless the origin is listed here, which
 * makes the preview load but never hot-reload and logs a 403 on /_next/webpack-hmr.
 *
 * These entries only affect `next dev`; they are ignored in a production build.
 */
const nextConfig: NextConfig = {
  allowedDevOrigins: ["*.e2b.app", "*.arena.ai", "localhost", "127.0.0.1"],
};

export default nextConfig;
