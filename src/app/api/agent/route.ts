/**
 * POST /api/agent — ask the EarthVibe voice agent a question.
 *
 * Body: { question: string, lang?: "en"|"ar"|"fr", defaultLang?: "en"|"ar"|"fr" }
 * Reply: an AgentAnswer (speech text, headline, facts, sonification) produced only from the
 * released annual temperature record in data/team/*.csv.
 *
 * No question text is logged or stored. The agent is deliberately rule-based: it cannot invent a
 * number and it labels model projections as projections.
 */
import { answerQuestion, agentManifest } from "@/lib/agent/answer";
import { ApiError } from "@/lib/server/datasets";
import { errorResponse, json } from "@/lib/server/http";
import { loadTeamData } from "@/lib/server/teamData";
import type { Lang } from "@/lib/i18n/messages";

export const dynamic = "force-dynamic";

const LANGS: Lang[] = ["en", "ar", "fr"];
const MAX_QUESTION = 400;

function parseLang(value: unknown): Lang | undefined {
  return typeof value === "string" && (LANGS as string[]).includes(value) ? (value as Lang) : undefined;
}

export async function GET(req: Request) {
  const manifest = agentManifest();
  const data = await loadTeamData().catch(() => null);
  return json(req, {
    ...manifest,
    data: {
      ...manifest.data,
      observedRange: data ? data.dataset.availableRange : null,
      records: data ? data.dataset.records.length : 0,
    },
    heartbeat: new Date().toISOString(),
  });
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      throw new ApiError(415, "unsupported_media_type", "Send a JSON body with a 'question' field.");
    }
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      throw new ApiError(400, "invalid_body", "The request body must be a JSON object with a 'question' field.");
    }
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question) {
      throw new ApiError(400, "empty_question", "Ask a question, for example: what is the latest year?");
    }
    if (question.length > MAX_QUESTION) {
      throw new ApiError(413, "question_too_long", `Please keep the question under ${MAX_QUESTION} characters.`);
    }
    const data = await loadTeamData();
    const answer = answerQuestion({
      question,
      data,
      lang: parseLang(body.lang),
      defaultLang: parseLang(body.defaultLang) ?? "en",
    });
    return json(req, answer, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(req, error);
  }
}
