/**
 * POST /api/transcribe — speech to text for the voice agent.
 *
 * The browser records one clip (only after the user presses the microphone button) and posts it as
 * multipart/form-data with an `audio` field.
 *
 * Two honest modes:
 *  1. If TRANSCRIBE_API_URL is configured (any endpoint that accepts multipart `file` audio and
 *     returns `{ text }`, e.g. a self-hosted Whisper service), the clip is forwarded there and the
 *     transcript is returned. The clip is never written to disk or stored here.
 *  2. Otherwise the route reports `configured: false` and the client falls back to the device's own
 *     speech recognition, or plain typing. It never pretends to have heard something.
 *
 * Size and type limits are enforced before anything is forwarded.
 */
import { ApiError } from "@/lib/server/datasets";
import { errorResponse, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const MAX_BYTES = 6 * 1024 * 1024; // 6 MB is roughly one minute of compressed speech
const ALLOWED = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/aac"];

export function GET(req: Request) {
  return json(req, {
    configured: Boolean(process.env.TRANSCRIBE_API_URL),
    accepts: ALLOWED,
    maxBytes: MAX_BYTES,
    note: "Without TRANSCRIBE_API_URL, the client uses the device's built-in speech recognition or typing. Audio is never stored by this app.",
  });
}

export async function POST(req: Request) {
  try {
    const configuredUrl = process.env.TRANSCRIBE_API_URL;
    if (!configuredUrl) {
      return json(
        req,
        {
          configured: false,
          error: {
            code: "transcription_not_configured",
            message:
              "Server-side speech recognition is not configured. Use the device's speech recognition or type the question instead.",
            details: null,
          },
        },
        { status: 501 },
      );
    }

    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      throw new ApiError(415, "unsupported_media_type", "Send the recording as multipart/form-data with an 'audio' field.");
    }
    const form = await req.formData().catch(() => null);
    const audio = form?.get("audio");
    if (!(audio instanceof File) || audio.size === 0) {
      throw new ApiError(400, "missing_audio", "Attach a non-empty recording in the 'audio' field.");
    }
    if (audio.size > MAX_BYTES) {
      throw new ApiError(413, "audio_too_large", "The recording is too long. Please keep it under one minute.");
    }
    const type = (audio.type || "application/octet-stream").split(";")[0];
    if (!ALLOWED.includes(type)) {
      throw new ApiError(415, "unsupported_audio_type", `Unsupported audio type '${type}'.`, { allowed: ALLOWED });
    }

    const upstream = new FormData();
    upstream.set("file", audio, audio.name || "question.webm");
    let res: Response;
    try {
      res = await fetch(configuredUrl, { method: "POST", body: upstream, redirect: "error" });
    } catch {
      throw new ApiError(503, "transcription_unavailable", "The speech-recognition service could not be reached.");
    }
    if (!res.ok) {
      throw new ApiError(502, "transcription_failed", `The speech-recognition service replied with HTTP ${res.status}.`);
    }
    const body = (await res.json().catch(() => null)) as { text?: unknown } | null;
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) {
      return json(req, { configured: true, text: "", empty: true, note: "No speech was recognised in the recording." });
    }
    return json(req, { configured: true, text: text.slice(0, 400) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(req, error);
  }
}
