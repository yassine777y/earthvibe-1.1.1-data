/**
 * Browser speech for the EarthVibe voice agent.
 *
 * Uses the device's built-in speech synthesis (no audio leaves the browser, nothing is uploaded and
 * nothing plays without a user action). If the device has no voice for a language we say so instead
 * of reading the answer with the wrong accent, and the answer always remains on screen as text.
 */
import type { Lang } from "@/lib/i18n/messages";

export const SPEECH_LANGS: Record<Lang, string> = { en: "en", ar: "ar", fr: "fr" };

const BCP47: Record<Lang, string> = { en: "en-US", ar: "ar-SA", fr: "fr-FR" };

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

function score(voice: SpeechSynthesisVoice, lang: Lang): number {
  const v = voice.lang.toLowerCase().replace("_", "-");
  const want = SPEECH_LANGS[lang];
  let s = 0;
  if (v === BCP47[lang].toLowerCase()) s += 6;
  else if (v.startsWith(`${want}-`)) s += 4;
  else if (v === want) s += 3;
  else return -1;
  if (voice.localService) s += 2;
  if (voice.default) s += 1;
  return s;
}

/** All installed voices for a language, best first. */
export function voicesFor(lang: Lang): SpeechSynthesisVoice[] {
  if (!speechSupported()) return [];
  return window.speechSynthesis
    .getVoices()
    .map((v) => ({ v, s: score(v, lang) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.v);
}

/** Resolves once the browser has populated its voice list (it is async in Chrome). */
export function whenVoicesReady(timeoutMs = 1200): Promise<void> {
  if (!speechSupported()) return Promise.resolve();
  if (window.speechSynthesis.getVoices().length > 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      window.speechSynthesis.removeEventListener("voiceschanged", done);
      resolve();
    };
    window.speechSynthesis.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, timeoutMs);
  });
}

export type SpeakOptions = { rate?: number; pitch?: number; onStart?: () => void; onEnd?: () => void };

/**
 * Speak `text` in `lang`. Returns false when the device has no voice for that language, so callers
 * can tell the user honestly instead of silently doing nothing.
 */
export function speak(text: string, lang: Lang, opts: SpeakOptions = {}): boolean {
  if (!speechSupported() || !text.trim()) return false;
  const voice = voicesFor(lang)[0];
  if (!voice) return false;
  stopSpeaking();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = BCP47[lang];
  u.voice = voice;
  u.rate = opts.rate ?? 1;
  u.pitch = opts.pitch ?? 1;
  u.volume = 1;
  if (opts.onStart) u.onstart = opts.onStart;
  if (opts.onEnd) {
    u.onend = opts.onEnd;
    u.onerror = opts.onEnd;
  }
  // Chrome pauses long utterances after ~15 s unless the queue is nudged; chunking keeps answers whole.
  const chunks = chunkText(text, 220);
  if (chunks.length <= 1) {
    window.speechSynthesis.speak(u);
    return true;
  }
  let index = 0;
  const speakNext = () => {
    if (index >= chunks.length) {
      opts.onEnd?.();
      return;
    }
    const cu = new SpeechSynthesisUtterance(chunks[index]);
    index += 1;
    cu.lang = BCP47[lang];
    cu.voice = voice;
    cu.rate = u.rate;
    cu.pitch = u.pitch;
    if (index === 1 && opts.onStart) cu.onstart = opts.onStart;
    cu.onend = speakNext;
    if (opts.onEnd) cu.onerror = opts.onEnd;
    window.speechSynthesis.speak(cu);
  };
  speakNext();
  return true;
}

/** Split on sentence boundaries so long answers are not cut off by the browser. */
export function chunkText(text: string, maxLen: number): string[] {
  const sentences = text.match(/[^.!?؟。]+[.!?؟。]*\s*/g) ?? [text];
  const out: string[] = [];
  let current = "";
  for (const s of sentences) {
    if ((current + s).length > maxLen && current.trim()) {
      out.push(current.trim());
      current = s;
    } else {
      current += s;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

export function stopSpeaking(): void {
  if (speechSupported()) window.speechSynthesis.cancel();
}

export function isSpeaking(): boolean {
  return speechSupported() && window.speechSynthesis.speaking;
}

/** Human-readable language name for status messages (never translated by the server). */
export function languageName(lang: Lang): string {
  return lang === "ar" ? "Arabic" : lang === "fr" ? "French" : "English";
}
