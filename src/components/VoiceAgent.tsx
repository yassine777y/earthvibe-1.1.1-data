"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useApp } from "./Providers";
import { Transport } from "./Transport";
import { ExternalLink } from "./parts";
import { askAgent, transcribeAudio, usePlayer, type AgentAnswerClient } from "@/lib/hooks";
import { buildSeriesFrames } from "@/lib/audio/mapping";
import { describeFrame } from "@/lib/describe";
import { languageName, speak, stopSpeaking } from "@/lib/speech";
import type { MessageKey } from "@/lib/i18n/messages";
import type { Lang } from "@/lib/i18n/messages";

type Turn = { id: number; question: string; answer: AgentAnswerClient | null; error: boolean };

const SUGGESTIONS: Record<Lang, string[]> = {
  en: ["What is the latest year?", "What is the trend?", "Compare 1990 and 2024", "What data is released?", "What does the sound mean?"],
  ar: ["ما أحدث سنة؟", "ما الاتجاه؟", "قارن 1990 و2024", "ما البيانات المنشورة؟", "ماذا يعني الصوت؟"],
  fr: ["Quelle est l’année la plus récente ?", "Quelle est la tendance ?", "Compare 1990 et 2024", "Quelles données sont publiées ?", "Que signifie le son ?"],
};

function MicIcon({ recording }: { recording: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      {recording ? (
        <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
      ) : (
        <>
          <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
          <path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21M8.5 21h7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

/** Builds a playable track from the years an answer refers to. Observed values only. */
function useAnswerTrack(answer: AgentAnswerClient | null) {
  return useMemo(() => {
    if (!answer?.listen || answer.listen.records.length === 0) return null;
    return buildSeriesFrames(answer.listen.records, answer.listen.scale, "temperature");
  }, [answer]);
}

export function VoiceAgent() {
  const { t, lang, fmtNumber, fmtDate, announce, dir } = useApp();
  const [answers, setAnswers] = useState<Turn[]>([]);
  const [current, setCurrent] = useState<AgentAnswerClient | null>(null);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  const [voiceOn, setVoiceOn] = useState(true);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [micNotice, setMicNotice] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const nextId = useRef(1);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const micAbort = useRef(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inputId = useId();
  const statusId = useId();

  const track = useAnswerTrack(current);
  const player = usePlayer(track);
  const micSupported =
    typeof window !== "undefined" && typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

  useEffect(() => () => stopSpeaking(), []);

  const readAloud = useCallback(
    (answer: AgentAnswerClient) => {
      if (!voiceOn) return;
      const ok = speak(answer.speech, answer.lang, {
        onStart: () => setSpeaking(true),
        onEnd: () => setSpeaking(false),
      });
      if (!ok) {
        const message = t("agent.speech.off", { lang: languageName(answer.lang) });
        setVoiceNotice(message);
        announce(message);
      } else {
        setVoiceNotice(null);
      }
    },
    [announce, t, voiceOn],
  );

  const ask = useCallback(
    async (raw: string) => {
      const q = raw.trim();
      if (!q || busy) return;
      setBusy(true);
      setErrorKey(null);
      setMicNotice(null);
      player.stop();
      stopSpeaking();
      const turnId = nextId.current++;
      setAnswers((prev) => [...prev, { id: turnId, question: q, answer: null, error: false }]);
      setQuestion("");
      try {
        const answer = await askAgent(q, lang);
        setAnswers((prev) => prev.map((turn) => (turn.id === turnId ? { ...turn, answer } : turn)));
        setCurrent(answer);
        announce(`${t("agent.agent")}: ${answer.headline}`);
        readAloud(answer);
        requestAnimationFrame(() => headingRef.current?.focus());
      } catch {
        setAnswers((prev) => prev.map((turn) => (turn.id === turnId ? { ...turn, error: true } : turn)));
        setErrorKey("agent.error.generic");
      } finally {
        setBusy(false);
      }
    },
    [announce, busy, lang, player, readAloud, t],
  );

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
  }, []);

  const startRecording = useCallback(async () => {
    if (!micSupported) {
      setMicNotice(t("agent.mic.unsupported"));
      return;
    }
    setMicNotice(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg", "audio/mp4"];
      const mime = types.find((type) => MediaRecorder.isTypeSupported(type));
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      micAbort.current = false;
      rec.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
        if (micAbort.current) return;
        const blob = new Blob(chunksRef.current, { type: mime ?? "audio/webm" });
        if (blob.size === 0) {
          setMicNotice(t("agent.mic.empty"));
          return;
        }
        setBusy(true);
        setMicNotice(t("agent.mic.transcribing"));
        const outcome = await transcribeAudio(blob);
        setBusy(false);
        if (outcome.status === "text") {
          setMicNotice(null);
          setQuestion(outcome.text);
          announce(outcome.text);
        } else if (outcome.status === "not_configured") {
          setMicNotice(t("agent.mic.notConfigured"));
        } else if (outcome.status === "empty") {
          setMicNotice(t("agent.mic.empty"));
        } else {
          setMicNotice(t("agent.mic.error"));
        }
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
      announce(t("agent.mic.recording"));
    } catch {
      setMicNotice(t("agent.mic.unsupported"));
    }
  }, [announce, micSupported, t]);

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void ask(question);
  };

  const toggleVoice = () => {
    if (voiceOn) stopSpeaking();
    setVoiceOn((prev) => !prev);
    announce(voiceOn ? t("agent.speech.toggleOff") : t("agent.speech.toggleOn"));
  };

  const clear = () => {
    stopSpeaking();
    player.stop();
    setAnswers([]);
    setCurrent(null);
    setErrorKey(null);
    setMicNotice(null);
    announce(t("agent.clear"));
  };

  const frame = track ? track.frames[Math.min(track.frames.length - 1, Math.max(0, Math.floor(player.position)))] : null;
  const description =
    frame && track
      ? describeFrame({
          t,
          mode: "temperature",
          frame,
          dateText: fmtDate(answerYear(current, frame.label), "year"),
          valueText: fmtNumber(frame.value, 2),
          unit: "°C",
          frameCount: track.frames.length,
          frameIndex: Math.min(track.frames.length - 1, Math.floor(player.position)),
          fmtPct: (v) => fmtNumber(v, 0),
        })
      : null;

  return (
    <section className="section section-alt agent" id="agent" aria-labelledby="agent-h">
      <div className="wrap">
        <span className="section-index" aria-hidden="true">★</span>
        <p className="eyebrow agent-eyebrow">
          <span className="onair" aria-hidden="true" />
          {t("agent.eyebrow")}
        </p>
        <h2 id="agent-h">{t("agent.title")}</h2>
        <p className="lead agent-lead">{t("agent.lead")}</p>

        <div className="agent-grid">
          <div className="agent-console panel">
            <form className="agent-form" onSubmit={onSubmit} aria-describedby={statusId}>
              <div className="field field-grow">
                <label htmlFor={inputId}>{t("agent.question.label")}</label>
                <div className="agent-input-row">
                  <input
                    id={inputId}
                    className="input agent-input"
                    type="text"
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    placeholder={t("agent.question.placeholder")}
                    maxLength={400}
                    autoComplete="off"
                    disabled={busy}
                    dir={dir}
                  />
                  <button type="submit" className="btn btn-primary" disabled={busy || question.trim().length === 0}>
                    {busy ? t("agent.asking") : t("agent.ask")}
                  </button>
                </div>
              </div>
              <div className="agent-mic-row">
                <button
                  type="button"
                  className={`btn ${recording ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => (recording ? stopRecording() : void startRecording())}
                  aria-pressed={recording}
                  disabled={busy && !recording}
                >
                  <MicIcon recording={recording} />
                  <span>{recording ? t("agent.mic.stop") : t("agent.mic")}</span>
                </button>
                <button
                  type="button"
                  className={`btn btn-ghost agent-voice-toggle ${voiceOn ? "is-on" : ""}`}
                  aria-pressed={voiceOn}
                  onClick={toggleVoice}
                >
                  {voiceOn ? "🔊" : "🔇"}
                  <span>{voiceOn ? t("agent.speech.toggleOn") : t("agent.speech.toggleOff")}</span>
                </button>
              </div>
              <p id={statusId} className="agent-status" role="status" aria-live="polite">
                {micNotice ?? voiceNotice ?? (busy ? t("agent.asking") : "")}
              </p>
            </form>

            <div className="agent-suggestions" role="group" aria-label={t("agent.suggestions")}>
              <span className="label-like">{t("agent.suggestions")}</span>
              <div className="agent-chips">
                {SUGGESTIONS[lang].map((s) => (
                  <button key={s} type="button" className="chip" onClick={() => void ask(s)} disabled={busy}>
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {answers.length === 0 && <p className="note">{t("agent.pressToStart")}</p>}

            {errorKey && (
              <div className="notice notice-error" role="alert">
                <strong>{t("err.title")}</strong>
                <p>{t(errorKey)}</p>
                <p className="notice-actions">
                  <button type="button" className="btn btn-primary" onClick={() => void ask(answers[answers.length - 1]?.question ?? "")}>
                    {t("agent.retry")}
                  </button>
                </p>
              </div>
            )}

            {current && (
              <div className="agent-answer" aria-labelledby="agent-answer-h">
                <h3 id="agent-answer-h" tabIndex={-1} ref={headingRef}>
                  {current.headline}
                </h3>
                <p className="agent-speech">{current.speech}</p>
                {current.usesProjection && <p className="badge badge-warn">{t("agent.projection")}</p>}
                {current.sections.length > 0 && (
                  <dl className="agent-facts">
                    {current.sections.map((s) => (
                      <div key={`${s.label}-${s.value}`}>
                        <dt>{s.label}</dt>
                        <dd>{s.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <div className="agent-answer-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => readAloud(current)}>
                    <span aria-hidden="true">▶</span> {t("agent.speech.replay")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      stopSpeaking();
                      setSpeaking(false);
                    }}
                    disabled={!speaking}
                  >
                    {t("agent.speech.stop")}
                  </button>
                </div>
                {track && (
                  <div className="agent-listen">
                    <h4>{t("agent.listen")}</h4>
                    <p className="note">{t("agent.listen.hint")}</p>
                    <Transport player={player} track={track} valueText={description ?? ""} idPrefix="agent" />
                    {description && <p className="note agent-hearing">{description}</p>}
                  </div>
                )}
                {current.sources.length > 0 && (
                  <p className="agent-sources">
                    <span className="label-like">{t("agent.sources")}: </span>
                    {current.sources.map((s, i) => (
                      <span key={s.url}>
                        {i > 0 && " · "}
                        <ExternalLink href={s.url}>{s.label}</ExternalLink>
                      </span>
                    ))}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="agent-transcript panel" aria-labelledby="agent-transcript-h" ref={transcriptRef}>
            <div className="agent-transcript-head">
              <h3 id="agent-transcript-h">{t("agent.transcript")}</h3>
              {answers.length > 0 && (
                <button type="button" className="btn btn-ghost" onClick={clear}>
                  {t("agent.clear")}
                </button>
              )}
            </div>
            {answers.length === 0 ? (
              <p className="note">{t("agent.transcript.empty")}</p>
            ) : (
              <ol className="turns">
                {answers.map((turn) => (
                  <li key={turn.id} className="turn">
                    <p className="turn-q">
                      <span className="label-like">{t("agent.you")}: </span>
                      {turn.question}
                    </p>
                    <div className="turn-a">
                      <span className="label-like">{t("agent.agent")}: </span>
                      {turn.answer ? (
                        <>
                          <strong>{turn.answer.headline}.</strong> {turn.answer.speech}
                        </>
                      ) : turn.error ? (
                        <span>{t("agent.error.generic")}</span>
                      ) : (
                        <span>{t("agent.asking")}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <p className="note agent-privacy">{t("agent.privacy")}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/** frame.label is an ISO date from the annual record; keep the helpers tolerant of other formats. */
function answerYear(_answer: AgentAnswerClient | null, label: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(label) ? label : `${label}-01-01`;
}

