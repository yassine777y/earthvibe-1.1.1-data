"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SeriesResponse } from "@/lib/server/datasets";
import type { Visualization } from "@/lib/server/visualizations";
import type { ImageFeatures } from "@/lib/server/image-analysis";
import { JukeboxEngine, type EngineState } from "@/lib/audio/engine";
import type { Track } from "@/lib/audio/mapping";

export type ApiErrorBody = { code: string; message: string; details: Record<string, unknown> | null };

export class ClientApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public details: Record<string, unknown> | null,
    public status: number,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ClientApiError("network_error", "Network error", null, 0);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const e = (body as { error?: ApiErrorBody } | null)?.error;
    throw new ClientApiError(e?.code ?? "http_error", e?.message ?? `HTTP ${res.status}`, e?.details ?? null, res.status);
  }
  return body as T;
}

export type Remote<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: ClientApiError }
  | { status: "ready"; data: T };

export function useSeries(
  datasetId: "temperature" | "seaice" | null,
  opts: { start?: string | null; end?: string | null; region?: string | null; month?: number | null },
) {
  const [state, setState] = useState<Remote<SeriesResponse>>({ status: "idle" });
  const [nonce, setNonce] = useState(0);
  const { start, end, region, month } = opts;

  useEffect(() => {
    if (!datasetId) {
      setState({ status: "idle" });
      return;
    }
    const ctl = new AbortController();
    setState({ status: "loading" });
    const q = new URLSearchParams();
    if (start) q.set("start", start);
    if (end) q.set("end", end);
    if (region && datasetId === "seaice") q.set("region", region);
    if (month && datasetId === "seaice") q.set("month", String(month));
    if (nonce > 0) q.set("refresh", "1");
    apiFetch<SeriesResponse>(`/api/datasets/${datasetId}/series?${q.toString()}`, { signal: ctl.signal })
      .then((data) => setState({ status: "ready", data }))
      .catch((error: unknown) => {
        if (ctl.signal.aborted) return;
        setState({ status: "error", error: error instanceof ClientApiError ? error : new ClientApiError("network_error", "Network error", null, 0) });
      });
    return () => ctl.abort();
  }, [datasetId, start, end, region, month, nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return { state, retry };
}

export function useVisualizations() {
  const [state, setState] = useState<Remote<Visualization[]>>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    setState({ status: "loading" });
    apiFetch<{ visualizations: Visualization[] }>("/api/visualizations")
      .then((d) => alive && setState({ status: "ready", data: d.visualizations }))
      .catch((e: unknown) => alive && setState({ status: "error", error: e as ClientApiError }));
    return () => {
      alive = false;
    };
  }, [nonce]);
  return { state, retry: () => setNonce((n) => n + 1) };
}

export type AnalyzeResult = {
  source: { type: "user-upload" } | { type: "catalog"; visualization: Visualization; cache: string; retrievedAt: string };
  features: ImageFeatures;
};

export async function analyzeImage(input: { file?: File; visualizationId?: string }): Promise<AnalyzeResult> {
  const form = new FormData();
  if (input.file) form.set("file", input.file);
  if (input.visualizationId) form.set("visualizationId", input.visualizationId);
  return apiFetch<AnalyzeResult>("/api/images/analyze", { method: "POST", body: form });
}

/* ───────────── EarthVibe voice agent ───────────── */

export type AgentAnswerClient = {
  intent: string;
  lang: "en" | "ar" | "fr";
  heard: string;
  headline: string;
  speech: string;
  sections: { label: string; value: string }[];
  listen: { from: string; to: string; label: string; records: { date: string; value: number }[]; scale: { min: number; max: number; zero: number | null } } | null;
  suggestions: string[];
  sources: { label: string; url: string }[];
  usesProjection: boolean;
};

export type AgentManifestClient = {
  name: string;
  version: string;
  languages: string[];
  data: { endpoint: string; files: string[]; observedRange: { start: string; end: string } | null; records: number; note: string };
  privacy: { audio: string; text: string };
  intents: string[];
  heartbeat: string;
};

export async function fetchAgentManifest(): Promise<AgentManifestClient> {
  return apiFetch<AgentManifestClient>("/api/agent");
}

export async function askAgent(question: string, defaultLang: "en" | "ar" | "fr"): Promise<AgentAnswerClient> {
  return apiFetch<AgentAnswerClient>("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, defaultLang }),
  });
}

export type TranscribeOutcome =
  | { status: "text"; text: string }
  | { status: "empty" }
  | { status: "not_configured" }
  | { status: "error"; message: string };

/** Send one recorded clip for transcription. Audio is forwarded once and never stored. */
export async function transcribeAudio(blob: Blob): Promise<TranscribeOutcome> {
  const form = new FormData();
  form.set("audio", blob, "question.webm");
  let res: Response;
  try {
    res = await fetch("/api/transcribe", { method: "POST", body: form });
  } catch {
    return { status: "error", message: "network_error" };
  }
  const body = (await res.json().catch(() => null)) as
    | { text?: string; empty?: boolean; error?: { code: string; message: string } }
    | null;
  if (res.status === 501 || body?.error?.code === "transcription_not_configured") return { status: "not_configured" };
  if (!res.ok) return { status: "error", message: body?.error?.message ?? `HTTP ${res.status}` };
  if (!body?.text) return { status: "empty" };
  return { status: "text", text: body.text };
}

export function usePlayer(track: Track | null) {
  const [engineState, setEngineState] = useState<EngineState>({ position: 0, playing: false, ended: false });
  const [speed, setSpeedState] = useState(1);
  const [volume, setVolumeState] = useState(0.6);
  const [muted, setMutedState] = useState(false);
  const [stereo, setStereoState] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const engineRef = useRef<JukeboxEngine | null>(null);

  useEffect(() => {
    const engine = new JukeboxEngine(setEngineState);
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.load(track);
    engineRef.current?.setSpeed(speed);
    engineRef.current?.setVolume(volume);
    engineRef.current?.setMuted(muted);
    engineRef.current?.setStereo(stereo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track]);

  const play = useCallback(async () => {
    try {
      setAudioError(false);
      await engineRef.current?.play();
    } catch {
      setAudioError(true);
    }
  }, []);
  const pause = useCallback(() => engineRef.current?.pause(), []);
  const stop = useCallback(() => engineRef.current?.stop(), []);
  const seek = useCallback((p: number) => engineRef.current?.seek(p), []);
  const setSpeed = useCallback((s: number) => {
    setSpeedState(s);
    engineRef.current?.setSpeed(s);
  }, []);
  const setVolume = useCallback((v: number) => {
    setVolumeState(v);
    engineRef.current?.setVolume(v);
  }, []);
  const setMuted = useCallback((m: boolean) => {
    setMutedState(m);
    engineRef.current?.setMuted(m);
  }, []);
  const setStereo = useCallback((on: boolean) => {
    setStereoState(on);
    engineRef.current?.setStereo(on);
  }, []);

  const getAnalyser = useCallback(() => engineRef.current?.getAnalyser() ?? null, []);

  return { ...engineState, speed, volume, muted, stereo, audioError, play, pause, stop, seek, setSpeed, setVolume, setMuted, setStereo, getAnalyser };
}

export type PlayerApi = ReturnType<typeof usePlayer>;
