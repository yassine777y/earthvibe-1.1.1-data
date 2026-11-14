import { json, errorResponse } from "@/lib/server/http";
import { loadTeamData } from "@/lib/server/teamData";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    return json(req, await loadTeamData());
  } catch (error) {
    return errorResponse(req, error);
  }
}
