import { errorResponse, json } from "@/lib/server/http";
import { getRelease } from "@/lib/server/release";

export const dynamic = "force-dynamic";

/**
 * GET /api/release — the open data release manifest: contents, provenance, access points and
 * SHA-256 hashes of the exact files this deployment ships.
 */
export async function GET(req: Request) {
  try {
    return json(req, await getRelease(), { headers: { "Cache-Control": "public, max-age=300" } });
  } catch (error) {
    return errorResponse(req, error);
  }
}
