/**
 * EarthVibe voice agent — the "brain".
 *
 * This is deliberately a small, deterministic, rule-based dialog engine, not a cloud LLM:
 *  - it only ever answers from the released data (data/team/*.csv via loadTeamData);
 *  - it never invents a number: missing years are reported as missing;
 *  - it labels model projections as projections, never as observations;
 *  - every answer is produced in three languages and includes a plain spoken form.
 *
 * The speech, the on-screen text and the sonification offered with each answer are all derived
 * from the same answer object, so what is heard and what is read can never drift apart.
 */
import type { Lang } from "../i18n/messages";
import type { AnnualRecord, Prediction, TeamData } from "../server/teamData";
import { AGENT_VERSION } from "./version.ts";

export { AGENT_VERSION };

export type Intent =
  | "greeting"
  | "help"
  | "about"
  | "latest"
  | "warmest"
  | "coldest"
  | "year"
  | "trend"
  | "compare"
  | "prediction"
  | "data"
  | "play"
  | "human"
  | "thanks"
  | "goodbye"
  | "unknown";

export type AgentListen = {
  from: string;
  to: string;
  label: string;
  records: { date: string; value: number }[];
  scale: { min: number; max: number; zero: number | null };
};

export type AgentAnswer = {
  intent: Intent;
  lang: Lang;
  heard: string;
  headline: string;
  /** Plain-language text meant to be read aloud; also shown on screen as the text alternative. */
  speech: string;
  /** Key facts as short label/value pairs for the transcript card. */
  sections: { label: string; value: string }[];
  /** Sonification to offer after the answer (observed data only, never projections). */
  listen: AgentListen | null;
  suggestions: string[];
  sources: { label: string; url: string }[];
  /** True when the answer mentions model projections. */
  usesProjection: boolean;
};

/* ───────────────────────── language helpers ───────────────────────── */

const AR_LETTERS = /[\u0621-\u064A]/g;
const LATIN_LETTERS = /[A-Za-zÀ-ÿ]/g;

const FR_WORDS = new Set([
  "le","la","les","de","des","du","est","et","une","un","quel","quelle","quels","quelles","quelle","combien","temperature","température",
  "annee","année","plus","chaud","chaude","froid","froide","donnees","données","merci","bonjour","salut","jouer","ecouter","écouter","son",
  "prevision","prévision","previsions","prévisions","difference","différence","comparer","compare","tendance","rechauffement","réchauffement",
  "aide","comment","aveugle","aveugles","malvoyant","malvoyants","qui","es","tu","je","voudrais","savoir","donne","moi","s il","vous","plait",
  "derniere","dernière","actuelle","maintenant","recente","récente","climat","record","futur","avenir","an","annees","années",
]);

const EN_WORDS = new Set([
  "the","is","what","which","how","was","were","warmest","coldest","hottest","trend","warming","compare","difference","data","download",
  "please","hello","hi","thanks","thank","you","play","listen","sound","audio","music","predict","prediction","forecast","future","latest",
  "current","recent","year","years","blind","help","about","who","are","can","tell","me","show","give","open","source","agent","record",
]);

/** Lowercase, strip Arabic diacritics and tatweel, unify alef/ya/ta-marbuta, drop punctuation. */
export function normalizeInput(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[’'`´]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Detects the language of a question. Returns null when there is no alphabetic content. */
export function detectLanguage(text: string): Lang | null {
  const arabic = (text.match(AR_LETTERS) ?? []).length;
  const latin = (text.match(LATIN_LETTERS) ?? []).length;
  if (arabic === 0 && latin === 0) return null;
  if (arabic >= 3 && arabic >= latin * 0.6) return "ar";
  const words = normalizeInput(text).split(" ").filter(Boolean);
  let fr = 0;
  let enHit = 0;
  for (const w of words) {
    if (FR_WORDS.has(w)) fr += 1;
    if (EN_WORDS.has(w)) enHit += 1;
  }
  if (/[àâçéèêëîïôûùüœ]/.test(text.toLowerCase())) fr += 2;
  return fr > enHit ? "fr" : "en";
}

/** Finds the first 4-digit year between 1880 and 2030, including Arabic-Indic digits. */
export function extractYears(text: string): number[] {
  const ascii = text
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660)) // Arabic-Indic digits
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0)) // Extended Arabic-Indic digits
    .replace(/[\u00B2\u00B3\u00B9\u2070\u2074-\u2079]/g, (d) => {
      const map: Record<string, string> = { "\u00B2": "2", "\u00B3": "3", "\u00B9": "1", "\u2070": "0" };
      return map[d] ?? String(d.charCodeAt(0) - 0x2070);
    }) // superscript digits, e.g. ²⁰²⁴
    .replace(/[\u2080-\u2089]/g, (d) => String(d.charCodeAt(0) - 0x2080)); // subscript digits
  const out: number[] = [];
  for (const m of ascii.matchAll(/\b(1[89]\d{2}|20[0-4]\d)\b/g)) {
    const y = Number(m[1]);
    if (!out.includes(y)) out.push(y);
  }
  return out;
}

/* ───────────────────────── intent detection ───────────────────────── */

const INTENT_WORDS: Record<Exclude<Intent, "year" | "unknown" | "greeting">, string[]> = {
  latest: [
    "latest","newest","most recent","current","now","today","last data","recent year","dernier","derniere","actuel","actuelle","maintenant","recent","recente",
    "احدث","اخر","الحالي","الان","احدث سنه","اخر سنه",
  ],
  warmest: ["warmest","hottest","highest","most warm","record high","le plus chaud","la plus chaude","record de chaleur","ادفا","اسخن","احر","اعلي حراره"],
  coldest: ["coldest","coolest","lowest","record low","le plus froid","la plus froide","ابرد","اسخفن","اقل حراره"],
  trend: ["trend","warming","warmer","rising","rate","per decade","increase","tendance","rechauffement","rythme","hausse","اتجاه","احترار","معدل","يرتفع","ارتفاع"],
  compare: ["compare","comparison","versus"," vs ","difference","than","comparer","difference","ecart","قارن","مقارنه","الفرق","فرق","افرق"],
  prediction: [
    "predict","prediction","forecast","outlook","future","next year","2026","2027","projection","prevision","previsions","futur","avenir","prochaine",
    "توقع","توقعات","مستقبل","تنبؤ","العام القادم",
  ],
  data: [
    "data","dataset","download","csv","json","api","open data","released","release","file","files","مصدر","بيانات","تحميل","ملف","ملفات","منشور","مفتوح",
    "donnees","telecharger","fichier","fichiers","source",
  ],
  play: ["play","sound","audio","listen","music","sonify","hear","tone","melody","joue","ecouter","son","audio","musique","شغل","صوت","اسمع","استمع","نغمه","موسيقي"],
  about: ["who are you","what are you","about","what is earthvibe","earthvibe","tell me about","qui es tu","qui etes vous","a propos","ما هذا","من انت","عن المشروع","ما هو"],
  help: [
    "help","how do i","what can i ask","commands","options","guide","instructions","example","examples","blind","vision","screen reader","accessibility",
    "what can you","what can i ask","how can you help","what do you do","aide","aidez","comment","aveugle","aveugles","malvoyant","malvoyants","lecteur d ecran","مساعدة","ساعدني","كيف","مثال","امثله","اعمى","كفيف","قارئ الشاشه",
  ],
  human: ["human","person","real person","contact","team","volunteer","email","someone","humain","personne","equipe","contacter","بشري","انسان","فريق","تواصل","شخص"],
  thanks: ["thanks","thank you","merci","شكرا","شكرا لك","مشكور"],
  goodbye: ["goodbye","bye","see you","au revoir","a bientot","الي اللقاء","وداعا","باي"],
};

const escapeRe = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Matches ASCII words on word boundaries (so "thanks" never matches "than") and other scripts as substrings. */
function containsWord(haystack: string, needle: string): boolean {
  const w = needle.trim();
  if (!w) return false;
  if (/^[\x20-\x7E]+$/.test(w)) return new RegExp(`(^|[^a-z0-9])${escapeRe(w)}([^a-z0-9]|$)`, "i").test(haystack);
  return haystack.includes(w);
}

function findIntent(norm: string): Intent {
  const padded = ` ${norm} `;
  // greetings only when the message is (almost) nothing but a greeting
  if (/^(hi|hello|hey|salam|salaam|marhaba|bonjour|salut|bonsoir|اهلا|مرحبا|السلام عليكم|صباح الخير|مساء الخير)( there| earthvibe)?$/.test(norm)) {
    return "greeting";
  }
  for (const key of ["latest", "warmest", "coldest", "trend", "compare", "prediction", "play", "data", "about", "help", "human", "thanks", "goodbye"] as const) {
    for (const w of INTENT_WORDS[key]) {
      if (containsWord(padded, w)) {
        // "playing data" should not be caught as a play request when it is clearly about the dataset
        if (key === "play" && /(data|dataset|بيانات|donnees)/.test(norm) && !/(sound|audio|listen|play|صوت|اسمع|استمع|ecouter|son)/.test(norm)) continue;
        return key;
      }
    }
  }
  return "unknown";
}

/* ───────────────────────── facts ───────────────────────── */

type YearStat = {
  year: number;
  value: number;
  movingAverage10Y: number | null;
  rank: number;
  total: number;
};

export type Facts = {
  start: number;
  end: number;
  total: number;
  latest: YearStat;
  warmest: YearStat;
  coldest: YearStat;
  earlyMean: number;
  recentMean: number;
  movingAverage: number | null;
  trendAll: number;
  trendRecent: number;
  asked: YearStat | null;
  asked2: YearStat | null;
  delta: number | null;
  projection2026: { mean: number; min: number; max: number; count: number; ytd: number | null } | null;
  projection2027: number | null;
};

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / (values.length || 1);

function trendPerDecade(records: AnnualRecord[], fromYear: number, toYear: number): number {
  const pts = records
    .map((r) => ({ x: Number(r.date.slice(0, 4)), y: r.value }))
    .filter((p) => p.x >= fromYear && p.x <= toYear);
  if (pts.length < 3) return 0;
  const mx = mean(pts.map((p) => p.x));
  const my = mean(pts.map((p) => p.y));
  let num = 0;
  let den = 0;
  for (const p of pts) {
    num += (p.x - mx) * (p.y - my);
    den += (p.x - mx) ** 2;
  }
  return den === 0 ? 0 : (num / den) * 10;
}

export function computeFacts(data: TeamData): Facts {
  const records = data.dataset.records;
  const n = records.length;
  const sorted = [...records].sort((a, b) => b.value - a.value);
  const rankOf = (year: number) => sorted.findIndex((r) => Number(r.date.slice(0, 4)) === year) + 1;
  const stat = (r: AnnualRecord): YearStat => ({
    year: Number(r.date.slice(0, 4)),
    value: r.value,
    movingAverage10Y: r.movingAverage10Y,
    rank: rankOf(Number(r.date.slice(0, 4))),
    total: n,
  });
  const start = Number(records[0].date.slice(0, 4));
  const end = Number(records[n - 1].date.slice(0, 4));
  const early = records.filter((r) => Number(r.date.slice(0, 4)) <= start + 29);
  const recent = records.slice(Math.max(0, n - 10));
  const latest = stat(records[n - 1]);

  const for2026 = data.predictions.records.filter((p) => p.year === 2026);
  const projected = for2026.filter((p) => !/^ytd/i.test(p.model));
  const projection2026 = projected.length
    ? {
        mean: mean(projected.map((p: Prediction) => p.value)),
        min: Math.min(...projected.map((p) => p.value)),
        max: Math.max(...projected.map((p) => p.value)),
        count: projected.length,
        ytd: for2026.find((p) => /^ytd/i.test(p.model))?.value ?? null,
      }
    : null;
  const p2027 = data.predictions.records.find((p) => p.year === 2027)?.value ?? null;

  return {
    start,
    end,
    total: n,
    latest,
    warmest: stat(sorted[0]),
    coldest: stat(sorted[sorted.length - 1]),
    earlyMean: mean(early.map((r) => r.value)),
    recentMean: mean(recent.map((r) => r.value)),
    movingAverage: latest.movingAverage10Y,
    trendAll: trendPerDecade(records, start, end),
    trendRecent: trendPerDecade(records, Math.max(start, end - 29), end),
    asked: null,
    asked2: null,
    delta: null,
    projection2026,
    projection2027: p2027,
  };
}

function withYears(facts: Facts, records: AnnualRecord[], years: number[]): Facts {
  const find = (y: number): YearStat | null => {
    const r = records.find((rec) => Number(rec.date.slice(0, 4)) === y);
    if (!r) return null;
    const sorted = [...records].sort((a, b) => b.value - a.value);
    return {
      year: y,
      value: r.value,
      movingAverage10Y: r.movingAverage10Y,
      rank: sorted.findIndex((s) => s.date === r.date) + 1,
      total: records.length,
    };
  };
  const [a, b] = years;
  const asked = a === undefined ? null : find(a);
  const asked2 = b === undefined ? null : find(b);
  return {
    ...facts,
    asked,
    asked2,
    delta: asked && asked2 ? asked2.value - asked.value : null,
  };
}

/* ───────────────────────── formatting + copy ───────────────────────── */

const fmt = (lang: Lang, value: number, digits = 2) =>
  new Intl.NumberFormat(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false }).format(value);

const anom = (lang: Lang, value: number) => {
  const abs = fmt(lang, Math.abs(value));
  if (lang === "ar") return `${abs} درجة مئوية ${value >= 0 ? "فوق" : "تحت"} متوسط 1951–1980`;
  if (lang === "fr") return `${abs} °C ${value >= 0 ? "au-dessus" : "en dessous"} de la moyenne 1951–1980`;
  return `${abs} °C ${value >= 0 ? "above" : "below"} the 1951–1980 average`;
};

type Copy = {
  anom: (v: number) => string;
  latest: (f: Facts) => string;
  warmest: (f: Facts) => string;
  coldest: (f: Facts) => string;
  year: (f: Facts) => string;
  yearMissing: (y: number, f: Facts) => string;
  trend: (f: Facts) => string;
  compare: (f: Facts) => string;
  compareSame: string;
  prediction: (f: Facts) => string;
  data: (f: Facts) => string;
  play: string;
  human: string;
  greeting: (f: Facts) => string;
  help: string;
  about: string;
  thanks: string;
  goodbye: string;
  unknown: string;
  headline: Record<Intent, string>;
  labels: { latest: string; anomaly: string; rank: string; warmest: string; coldest: string; trend: string; compare: string; outlook: string; range: string; records: string };
  suggestions: { greeting: string[]; help: string[]; unknown: string[]; year: string[]; compare: string[]; prediction: string[]; play: string[]; trend: string[]; latest: string[]; data: string[] };
  listenLabel: string;
  sources: { gibs: string; repo: string };
};

const en: Copy = {
  anom: (v) => anom("en", v),
  latest: (f) =>
    `The newest observation in the released record is ${f.latest.year}: ${anom("en", f.latest.value)}. ` +
    `It ranks ${f.latest.rank} of ${f.latest.total} years, from warmest to coldest. ` +
    `The warmest year is ${f.warmest.year} at ${anom("en", f.warmest.value)}, and the ten-year moving average now stands at ${fmt("en", f.movingAverage ?? f.recentMean)} °C.`,
  warmest: (f) =>
    `The warmest year in this record is ${f.warmest.year}: ${anom("en", f.warmest.value)}. ` +
    `That is ${fmt("en", f.warmest.value - f.earlyMean)} °C warmer than the average of the first thirty years, ${f.start} to ${f.start + 29}.`,
  coldest: (f) =>
    `The coldest year in this record is ${f.coldest.year}: ${anom("en", f.coldest.value)}. ` +
    `For comparison, the warmest year, ${f.warmest.year}, is ${fmt("en", f.warmest.value - f.coldest.value)} °C warmer than that.`,
  year: (f) => {
    const a = f.asked!;
    const parts = [
      `${a.year}: ${anom("en", a.value)}.`,
      `It ranks ${a.rank} of ${a.total} years.`,
      f.asked2 && f.delta !== null
        ? `${f.asked2.year} was ${anom("en", f.asked2.value)}, so ${Math.abs(f.delta) < 0.005 ? "the two years are practically equal" : `${f.delta > 0 ? f.asked2.year : a.year} was ${fmt("en", Math.abs(f.delta))} °C warmer`}.`
        : a.movingAverage10Y !== null
          ? `Its ten-year moving average is ${fmt("en", a.movingAverage10Y)} °C.`
          : `This is an annual value; no ten-year average is available for it.`,
    ];
    return parts.join(" ");
  },
  yearMissing: (y, f) => `There is no confirmed observation for ${y} in the released record. The annual series covers ${f.start} to ${f.end}.`,
  trend: (f) =>
    `From ${f.start} to ${f.end}, the record warms by about ${fmt("en", f.trendAll)} °C per decade, fitted by least squares. ` +
    `Over the last thirty years the rate is about ${fmt("en", f.trendRecent)} °C per decade. ` +
    `The ten-year moving average is ${fmt("en", f.movingAverage ?? f.recentMean)} °C and the last ten years average ${fmt("en", f.recentMean)} °C.`,
  compare: (f) => {
    const a = f.asked!;
    const b = f.asked2!;
    const d = f.delta ?? 0;
    const warmer = d > 0 ? b.year : a.year;
    return `${a.year} was ${anom("en", a.value)}; ${b.year} was ${anom("en", b.value)}. ` +
      (Math.abs(d) < 0.005 ? `The two years are practically indistinguishable in this record.` : `So ${warmer} was ${fmt("en", Math.abs(d))} °C warmer.`);
  },
  compareSame: `I need two different years for a comparison. Ask for example: compare 1990 and 2024.`,
  prediction: (f) => {
    const p = f.projection2026;
    if (!p) return `The released file contains no projections for 2026.`;
    return (
      `The team's outlook for 2026 has ${p.count} model entries between ${fmt("en", p.min)} and ${fmt("en", p.max)} °C, averaging ${fmt("en", p.mean)} °C${p.ytd !== null ? `, while the year-to-date value is ${fmt("en", p.ytd)} °C` : ""}. ` +
      (f.projection2027 !== null ? `One projected entry for 2027 stands at ${fmt("en", f.projection2027)} °C. ` : "") +
      `These are model projections, not measurements, and they are not official NASA forecasts.`
    );
  },
  data: (f) =>
    `The released data is ${f.total} annual values from ${f.start} to ${f.end}, derived from NASA GISTEMP v4 and supplied as three CSV files with an open JSON endpoint, /api/team-data. ` +
    `It includes a sonification-ready series and a separate predictions file. The same numbers I speak are the numbers you can download.`,
  play: `Press the Listen to the data button. Each year becomes one tone; warmer years sound higher, and the number of pulses follows whether the trend is rising or falling. Loudness is never used for data.`,
  human: `I am a demonstration agent, so I cannot pass you to a person. The project team can be reached through the repository's issues page.`,
  greeting: (f) =>
    `Hello! I am the EarthVibe voice agent. Ask me about the open annual temperature record from ${f.start} to ${f.end}, and I will answer out loud and turn the data into sound. ` +
    `For example: what is the latest year? or: compare 1990 and 2024.`,
  help: `I can answer questions about the latest year, the warmest or coldest year, a specific year such as 1998, the warming trend, a comparison between two years, the released data files, and the team's projections. ` +
    `I always read my answer aloud; if sound is on, I then play the same numbers as tones. You can type, use your screen reader, or press the microphone button and speak. Every answer also stays on screen as text.`,
  about: `EarthVibe is an accessibility project that turns real Earth science data into sound and spoken answers, made for blind and low-vision listeners. ` +
    `I am a rule-based agent: I answer only from the released record, I never guess a number, and I say plainly when a value is a projection rather than a measurement.`,
  thanks: `You are welcome. The data stays available, so you can listen again at any time.`,
  goodbye: `Goodbye. The data, the transcript and the sonification remain available here whenever you return.`,
  unknown: `Sorry, I did not understand that question. You can ask: what is the latest year? what is the trend? compare 1990 and 2024? or: what data is released?`,
  headline: {
    greeting: "Hello from EarthVibe",
    help: "What you can ask",
    about: "About this voice agent",
    latest: "Latest year",
    warmest: "Warmest year",
    coldest: "Coldest year",
    year: "Year in the record",
    trend: "Warming trend",
    compare: "Two years compared",
    prediction: "Model outlook",
    data: "Released data",
    play: "Listening guide",
    human: "Talking to a person",
    thanks: "You are welcome",
    goodbye: "Goodbye",
    unknown: "I did not catch that",
  },
  labels: {
    latest: "Latest year",
    anomaly: "Anomaly",
    rank: "Rank (warmest to coldest)",
    warmest: "Warmest year",
    coldest: "Coldest year",
    trend: "Trend per decade",
    compare: "Difference",
    outlook: "Outlook",
    range: "Record range",
    records: "Annual values",
  },
  suggestions: {
    greeting: ["What is the latest year?", "What is the trend?", "What data is released?"],
    help: ["What is the warmest year?", "Compare 1990 and 2024", "What does the sound mean?"],
    unknown: ["What is the latest year?", "What is the trend?", "Compare 1990 and 2024"],
    year: ["How does it compare with 2024?", "What is the trend?"],
    compare: ["What is the warmest year?", "What is the trend?"],
    prediction: ["What is the latest observation?", "What is the trend?"],
    play: ["What is the latest year?", "Compare 1990 and 2024"],
    trend: ["What is the warmest year?", "What is the latest year?"],
    latest: ["What is the warmest year?", "What is the trend?"],
    data: ["What is the latest year?", "What does the sound mean?"],
  },
  listenLabel: "Annual temperature record",
  sources: {
    gibs: "NASA GISTEMP v4 — source of the observations",
    repo: "EarthVibe repository — open data files and code",
  },
};

const ar: Copy = {
  anom: (v) => anom("ar", v),
  latest: (f) =>
    `أحدث قيمة منشورة هي عام ${f.latest.year}: ${anom("ar", f.latest.value)}. ` +
    `ترتيبها ${f.latest.rank} من ${f.latest.total} سنة، من الأدفأ إلى الأبرد. ` +
    `أدفأ عام هو ${f.warmest.year} بمقدار ${anom("ar", f.warmest.value)}، ومتوسط العشر سنوات الأخيرة ${fmt("ar", f.movingAverage ?? f.recentMean)} درجة مئوية.`,
  warmest: (f) =>
    `أدفأ عام في هذا السجل هو ${f.warmest.year}: ${anom("ar", f.warmest.value)}. ` +
    `وهو أدفأ بـ${fmt("ar", f.warmest.value - f.earlyMean)} درجة مئوية من متوسط السنوات الثلاثين الأولى، من ${f.start} إلى ${f.start + 29}.`,
  coldest: (f) =>
    `أبرد عام في هذا السجل هو ${f.coldest.year}: ${anom("ar", f.coldest.value)}. ` +
    `للمقارنة، أدفأ عام، ${f.warmest.year}، أدفأ منه بـ${fmt("ar", f.warmest.value - f.coldest.value)} درجة مئوية.`,
  year: (f) => {
    const a = f.asked!;
    const parts = [
      `عام ${a.year}: ${anom("ar", a.value)}.`,
      `ترتيبه ${a.rank} من ${a.total} سنة.`,
      f.asked2 && f.delta !== null
        ? `عام ${f.asked2.year} كان ${anom("ar", f.asked2.value)}، لذا ${Math.abs(f.delta) < 0.005 ? "العامان متساويان تقريبًا" : `${f.delta > 0 ? f.asked2.year : a.year} أدفأ بـ${fmt("ar", Math.abs(f.delta))} درجة مئوية`}.`
        : a.movingAverage10Y !== null
          ? `متوسط العشر سنوات له ${fmt("ar", a.movingAverage10Y)} درجة مئوية.`
          : `هذه قيمة سنوية، ولا يتوفر لها متوسط عشر سنوات.`,
    ];
    return parts.join(" ");
  },
  yearMissing: (y, f) => `لا يوجد قياس مؤكد لعام ${y} في البيانات المنشورة. السلسلة السنوية تغطي ${f.start} حتى ${f.end}.`,
  trend: (f) =>
    `من ${f.start} إلى ${f.end} يرتفع السجل بنحو ${fmt("ar", f.trendAll)} درجة مئوية كل عشر سنوات، بحسب خط الاتجاه. ` +
    `وفي الثلاثين سنة الأخيرة يبلغ المعدل نحو ${fmt("ar", f.trendRecent)} درجة مئوية كل عشر سنوات. ` +
    `متوسط العشر سنوات الأخيرة ${fmt("ar", f.movingAverage ?? f.recentMean)} درجة مئوية.`,
  compare: (f) => {
    const a = f.asked!;
    const b = f.asked2!;
    const d = f.delta ?? 0;
    const warmer = d > 0 ? b.year : a.year;
    return `عام ${a.year} كان ${anom("ar", a.value)}؛ وعام ${b.year} كان ${anom("ar", b.value)}. ` +
      (Math.abs(d) < 0.005 ? `لا يمكن التمييز بين العامين في هذا السجل.` : `إذن ${warmer} أدفأ بـ${fmt("ar", Math.abs(d))} درجة مئوية.`);
  },
  compareSame: `أحتاج إلى عامين مختلفين للمقارنة. اسأل مثلًا: قارن 1990 و2024.`,
  prediction: (f) => {
    const p = f.projection2026;
    if (!p) return `لا يحتوي الملف المنشور على توقعات لعام 2026.`;
    return (
      `توقعات الفريق لعام 2026 تضم ${p.count} مدخلات بين ${fmt("ar", p.min)} و${fmt("ar", p.max)} درجة مئوية، بمتوسط ${fmt("ar", p.mean)} درجة${p.ytd !== null ? `، وقيمة العام حتى تاريخه ${fmt("ar", p.ytd)} درجة` : ""}. ` +
      (f.projection2027 !== null ? `وهناك مدخل متوقع واحد لعام 2027 عند ${fmt("ar", f.projection2027)} درجة. ` : "") +
      `هذه توقعات نماذج وليست قياسات، وليست توقعات رسمية من ناسا.`
    );
  },
  data: (f) =>
    `البيانات المنشورة هي ${f.total} قيمة سنوية من ${f.start} إلى ${f.end}، مأخوذة من GISTEMP v4 التابع لناسا، ومتاحة في ثلاثة ملفات CSV مع واجهة JSON مفتوحة على المسار /api/team-data. ` +
    `وهي تشمل سلسلة جاهزة للتحويل إلى صوت وملف توقعات منفصل. الأرقام التي أنطقها هي نفس الأرقام التي يمكنك تنزيلها.`,
  play: `اضغط زر استمع إلى البيانات. كل سنة تصبح نغمة واحدة؛ كلما ارتفعت الحرارة ارتفعت النغمة، وعدد النبضات يتبع اتجاه التغير، وشدة الصوت لا تُستخدم أبدًا لتمثيل البيانات.`,
  human: `أنا وكيل تجريبي، لذلك لا أستطيع تحويلك إلى شخص. يمكنك التواصل مع فريق المشروع عبر صفحة المشاكل في المستودع.`,
  greeting: (f) =>
    `مرحبًا! أنا وكيل EarthVibe الصوتي. اسألني عن سجل درجات الحرارة السنوي المفتوح من ${f.start} إلى ${f.end}، وسأجيب بصوت مسموع وأحوّل البيانات إلى صوت. ` +
    `جرّب: ما أحدث سنة؟ أو: قارن 1990 و2024.`,
  help: `أستطيع الإجابة عن أحدث سنة، وأدفأ وأبرد سنة، وسنة محددة مثل 1998، واتجاه الاحترار، ومقارنة بين عامين، وملفات البيانات المنشورة، وتوقعات الفريق. ` +
    `أقرأ إجابتي بصوت مسموع دائمًا، ثم أشغّل الأرقام نفسها كنغمات عند تفعيل الصوت. يمكنك الكتابة، أو استخدام قارئ الشاشة، أو الضغط على زر الميكروفون والتحدث. وتبقى كل إجابة مكتوبة على الشاشة.`,
  about: `EarthVibe مشروع لإتاحة بيانات علوم الأرض الحقيقية عبر الصوت والإجابات المنطوقة، مخصص للمكفوفين وضعاف البصر. ` +
    `أنا وكيل قائم على قواعد واضحة: أجيب فقط من السجل المنشور، ولا أخمّن أي رقم، وأقول بصراحة عندما تكون القيمة توقعًا لا قياسًا.`,
  thanks: `على الرحب والسعة. البيانات متاحة دائمًا، ويمكنك الاستماع مرة أخرى في أي وقت.`,
  goodbye: `إلى اللقاء. تبقى البيانات والنص والتحويل الصوتي متاحة هنا عند عودتك.`,
  unknown: `عذرًا، لم أفهم هذا السؤال. يمكنك أن تسأل: ما أحدث سنة؟ ما الاتجاه؟ قارن 1990 و2024؟ أو: ما البيانات المنشورة؟`,
  headline: {
    greeting: "مرحبًا من EarthVibe",
    help: "ماذا يمكنك أن تسأل",
    about: "عن هذا الوكيل الصوتي",
    latest: "أحدث سنة",
    warmest: "أدفأ سنة",
    coldest: "أبرد سنة",
    year: "سنة في السجل",
    trend: "اتجاه الاحترار",
    compare: "مقارنة بين عامين",
    prediction: "توقعات النماذج",
    data: "البيانات المنشورة",
    play: "دليل الاستماع",
    human: "التحدث إلى شخص",
    thanks: "على الرحب والسعة",
    goodbye: "إلى اللقاء",
    unknown: "لم أفهم السؤال",
  },
  labels: {
    latest: "أحدث سنة",
    anomaly: "الشذوذ الحراري",
    rank: "الترتيب (من الأدفأ إلى الأبرد)",
    warmest: "أدفأ سنة",
    coldest: "أبرد سنة",
    trend: "الاتجاه لكل عشر سنوات",
    compare: "الفرق",
    outlook: "التوقعات",
    range: "نطاق السجل",
    records: "القيم السنوية",
  },
  suggestions: {
    greeting: ["ما أحدث سنة؟", "ما الاتجاه؟", "ما البيانات المنشورة؟"],
    help: ["ما أدفأ سنة؟", "قارن 1990 و2024", "ماذا يعني الصوت؟"],
    unknown: ["ما أحدث سنة؟", "ما الاتجاه؟", "قارن 1990 و2024"],
    year: ["كيف تقارن مع 2024؟", "ما الاتجاه؟"],
    compare: ["ما أدفأ سنة؟", "ما الاتجاه؟"],
    prediction: ["ما أحدث قياس؟", "ما الاتجاه؟"],
    play: ["ما أحدث سنة؟", "قارن 1990 و2024"],
    trend: ["ما أدفأ سنة؟", "ما أحدث سنة؟"],
    latest: ["ما أدفأ سنة؟", "ما الاتجاه؟"],
    data: ["ما أحدث سنة؟", "ماذا يعني الصوت؟"],
  },
  listenLabel: "سجل درجات الحرارة السنوي",
  sources: {
    gibs: "GISTEMP v4 من ناسا — مصدر القياسات",
    repo: "مستودع EarthVibe — ملفات البيانات المفتوحة والشيفرة",
  },
};

const fr: Copy = {
  anom: (v) => anom("fr", v),
  latest: (f) =>
    `La valeur la plus récente du jeu de données est ${f.latest.year} : ${anom("fr", f.latest.value)}. ` +
    `Elle se classe ${f.latest.rank} sur ${f.latest.total} années, de la plus chaude à la plus froide. ` +
    `L'année la plus chaude est ${f.warmest.year} avec ${anom("fr", f.warmest.value)}, et la moyenne glissante sur dix ans atteint ${fmt("fr", f.movingAverage ?? f.recentMean)} °C.`,
  warmest: (f) =>
    `L'année la plus chaude de ce relevé est ${f.warmest.year} : ${anom("fr", f.warmest.value)}. ` +
    `C'est ${fmt("fr", f.warmest.value - f.earlyMean)} °C de plus que la moyenne des trente premières années, de ${f.start} à ${f.start + 29}.`,
  coldest: (f) =>
    `L'année la plus froide de ce relevé est ${f.coldest.year} : ${anom("fr", f.coldest.value)}. ` +
    `À titre de comparaison, l'année la plus chaude, ${f.warmest.year}, est plus chaude de ${fmt("fr", f.warmest.value - f.coldest.value)} °C.`,
  year: (f) => {
    const a = f.asked!;
    const parts = [
      `${a.year} : ${anom("fr", a.value)}.`,
      `Elle se classe ${a.rank} sur ${a.total} années.`,
      f.asked2 && f.delta !== null
        ? `${f.asked2.year} était ${anom("fr", f.asked2.value)} ; ${Math.abs(f.delta) < 0.005 ? "les deux années sont pratiquement égales" : `${f.delta > 0 ? f.asked2.year : a.year} était plus chaude de ${fmt("fr", Math.abs(f.delta))} °C`}.`
        : a.movingAverage10Y !== null
          ? `Sa moyenne glissante sur dix ans est ${fmt("fr", a.movingAverage10Y)} °C.`
          : `C'est une valeur annuelle ; aucune moyenne sur dix ans n'est disponible.`,
    ];
    return parts.join(" ");
  },
  yearMissing: (y, f) => `Il n'y a pas d'observation confirmée pour ${y} dans le jeu de données. La série annuelle couvre ${f.start} à ${f.end}.`,
  trend: (f) =>
    `De ${f.start} à ${f.end}, le relevé se réchauffe d'environ ${fmt("fr", f.trendAll)} °C par décennie, par ajustement des moindres carrés. ` +
    `Sur les trente dernières années, le rythme est d'environ ${fmt("fr", f.trendRecent)} °C par décennie. ` +
    `La moyenne glissante sur dix ans est de ${fmt("fr", f.movingAverage ?? f.recentMean)} °C.`,
  compare: (f) => {
    const a = f.asked!;
    const b = f.asked2!;
    const d = f.delta ?? 0;
    const warmer = d > 0 ? b.year : a.year;
    return `${a.year} était ${anom("fr", a.value)} ; ${b.year} était ${anom("fr", b.value)}. ` +
      (Math.abs(d) < 0.005 ? `Les deux années sont pratiquement indiscernables dans ce relevé.` : `Donc ${warmer} était plus chaude de ${fmt("fr", Math.abs(d))} °C.`);
  },
  compareSame: `J'ai besoin de deux années différentes pour comparer. Demandez par exemple : compare 1990 et 2024.`,
  prediction: (f) => {
    const p = f.projection2026;
    if (!p) return `Le fichier publié ne contient aucune projection pour 2026.`;
    return (
      `Les projections de l'équipe pour 2026 comptent ${p.count} entrées de modèle, entre ${fmt("fr", p.min)} et ${fmt("fr", p.max)} °C, avec une moyenne de ${fmt("fr", p.mean)} °C${p.ytd !== null ? `, tandis que la valeur depuis le début de l'année est de ${fmt("fr", p.ytd)} °C` : ""}. ` +
      (f.projection2027 !== null ? `Une entrée projetée pour 2027 se situe à ${fmt("fr", f.projection2027)} °C. ` : "") +
      `Ce sont des projections de modèles, pas des mesures, et ce ne sont pas des prévisions officielles de la NASA.`
    );
  },
  data: (f) =>
    `Le jeu de données publié contient ${f.total} valeurs annuelles de ${f.start} à ${f.end}, issues de NASA GISTEMP v4 et fournies dans trois fichiers CSV avec un point d'accès JSON ouvert, /api/team-data. ` +
    `Il comprend une série prête pour la sonification et un fichier de projections séparé. Les chiffres que je prononce sont ceux que vous pouvez télécharger.`,
  play: `Appuyez sur le bouton Écouter les données. Chaque année devient une note ; plus il fait chaud, plus la note est haute, et le nombre d'impulsions suit la direction de la tendance. Le volume ne sert jamais à représenter les données.`,
  human: `Je suis un agent de démonstration et je ne peux pas vous mettre en relation avec une personne. L'équipe du projet est joignable via la page des tickets du dépôt.`,
  greeting: (f) =>
    `Bonjour ! Je suis l'agent vocal EarthVibe. Interrogez-moi sur le relevé annuel ouvert de ${f.start} à ${f.end} : je réponds à voix haute et je transforme les données en son. ` +
    `Par exemple : quelle est l'année la plus récente ? ou : compare 1990 et 2024.`,
  help: `Je réponds aux questions sur l'année la plus récente, l'année la plus chaude ou la plus froide, une année précise comme 1998, la tendance au réchauffement, la comparaison de deux années, les fichiers publiés et les projections de l'équipe. ` +
    `Je lis toujours ma réponse à voix haute ; si le son est activé, je joue ensuite les mêmes chiffres en notes. Vous pouvez écrire, utiliser votre lecteur d'écran, ou appuyer sur le bouton micro et parler. Chaque réponse reste aussi affichée en texte.`,
  about: `EarthVibe est un projet d'accessibilité qui transforme de vraies données de sciences de la Terre en son et en réponses parlées, pensé pour les personnes aveugles et malvoyantes. ` +
    `Je suis un agent à règles : je réponds uniquement à partir du relevé publié, je ne devine jamais un chiffre, et je précise clairement quand une valeur est une projection et non une mesure.`,
  thanks: `Avec plaisir. Les données restent disponibles : vous pouvez réécouter à tout moment.`,
  goodbye: `Au revoir. Les données, la transcription et la sonification restent disponibles ici à votre retour.`,
  unknown: `Désolé, je n'ai pas compris cette question. Vous pouvez demander : quelle est l'année la plus récente ? quelle est la tendance ? compare 1990 et 2024 ? ou : quelles données sont publiées ?`,
  headline: {
    greeting: "Bonjour d'EarthVibe",
    help: "Ce que vous pouvez demander",
    about: "À propos de cet agent vocal",
    latest: "Année la plus récente",
    warmest: "Année la plus chaude",
    coldest: "Année la plus froide",
    year: "Une année du relevé",
    trend: "Tendance au réchauffement",
    compare: "Deux années comparées",
    prediction: "Projections des modèles",
    data: "Données publiées",
    play: "Guide d'écoute",
    human: "Parler à une personne",
    thanks: "Avec plaisir",
    goodbye: "Au revoir",
    unknown: "Je n'ai pas compris",
  },
  labels: {
    latest: "Année la plus récente",
    anomaly: "Anomalie",
    rank: "Rang (de la plus chaude à la plus froide)",
    warmest: "Année la plus chaude",
    coldest: "Année la plus froide",
    trend: "Tendance par décennie",
    compare: "Écart",
    outlook: "Projections",
    range: "Étendue du relevé",
    records: "Valeurs annuelles",
  },
  suggestions: {
    greeting: ["Quelle est l'année la plus récente ?", "Quelle est la tendance ?", "Quelles données sont publiées ?"],
    help: ["Quelle est l'année la plus chaude ?", "Compare 1990 et 2024", "Que signifie le son ?"],
    unknown: ["Quelle est l'année la plus récente ?", "Quelle est la tendance ?", "Compare 1990 et 2024"],
    year: ["Comment se compare-t-elle à 2024 ?", "Quelle est la tendance ?"],
    compare: ["Quelle est l'année la plus chaude ?", "Quelle est la tendance ?"],
    prediction: ["Quelle est la dernière observation ?", "Quelle est la tendance ?"],
    play: ["Quelle est l'année la plus récente ?", "Compare 1990 et 2024"],
    trend: ["Quelle est l'année la plus chaude ?", "Quelle est l'année la plus récente ?"],
    latest: ["Quelle est l'année la plus chaude ?", "Quelle est la tendance ?"],
    data: ["Quelle est l'année la plus récente ?", "Que signifie le son ?"],
  },
  listenLabel: "Relevé annuel des températures",
  sources: {
    gibs: "NASA GISTEMP v4 — source des observations",
    repo: "Dépôt EarthVibe — fichiers de données ouverts et code",
  },
};

const COPIES: Record<Lang, Copy> = { en, ar, fr };

/* ───────────────────────── the answering machine ───────────────────────── */

export const REPO_URL = "https://github.com/yassine777y/earthvibe-1.1.1-data";
export const GISTEMP_URL = "https://data.giss.nasa.gov/gistemp/";

function sonification(
  records: AnnualRecord[],
  all: AnnualRecord[],
  range: { fromYear: number; toYear: number },
  label: string,
): AgentListen {
  const chosen = records.filter((r) => {
    const y = Number(r.date.slice(0, 4));
    return y >= range.fromYear && y <= range.toYear;
  });
  const values = all.map((r) => r.value);
  return {
    from: chosen[0]?.date ?? all[0].date,
    to: chosen[chosen.length - 1]?.date ?? all[all.length - 1].date,
    label,
    records: (chosen.length ? chosen : all).map((r) => ({ date: r.date, value: r.value })),
    scale: { min: Math.min(...values), max: Math.max(...values), zero: 0 },
  };
}

function sourcesFor(lang: Lang, intent: Intent): { label: string; url: string }[] {
  const c = COPIES[lang];
  const out = [{ label: c.sources.gibs, url: GISTEMP_URL }];
  if (intent === "data" || intent === "human" || intent === "about" || intent === "help") {
    out.push({ label: c.sources.repo, url: REPO_URL });
  }
  return out;
}

/**
 * Answer one question from the released data.
 * Pure and synchronous, so every supported question is covered by unit tests.
 */
export function answerQuestion(input: {
  question: string;
  data: TeamData;
  lang?: Lang;
  defaultLang?: Lang;
}): AgentAnswer {
  const heard = input.question.trim().slice(0, 280);
  const lang: Lang = input.lang ?? detectLanguage(heard) ?? input.defaultLang ?? "en";
  const c = COPIES[lang];
  const norm = normalizeInput(heard);
  const years = extractYears(heard);
  let intent = findIntent(norm);

  // A question with two years and comparison wording is a comparison, even if it also contains
  // words like "warmer". A bare pair of years is treated as a comparison too.
  const comparisonCue = /\b(than|vs|versus|compare|difference|compared)\b|compar|difference|écart|ecart|فرق|قارن|مقارن/.test(norm);
  if (years.length >= 2 && (intent === "unknown" || intent === "trend" || comparisonCue)) intent = "compare";
  // "tell me about 1998" / "what about 2040?" are questions about a year, not about the project.
  if (intent === "about" && years.length >= 1) intent = "year";
  if (intent === "unknown" && years.length === 1) intent = "year";
  if (intent === "year" && years.length === 0) intent = "latest";

  const baseFacts = computeFacts(input.data);
  const records = input.data.dataset.records;
  const facts = withYears(baseFacts, records, years);
  const n = records.length;

  let speech = "";
  let listen: AgentListen | null = null;
  const sections: { label: string; value: string }[] = [];
  let suggestions: string[] = [];
  let usesProjection = false;

  const compareFacts: Facts = (() => {
    if (intent !== "compare") return facts;
    if (years.length >= 2) return facts;
    if (years.length === 1) {
      return withYears(baseFacts, records, [years[0], baseFacts.warmest.year === years[0] ? baseFacts.coldest.year : baseFacts.warmest.year]);
    }
    return withYears(baseFacts, records, [baseFacts.warmest.year, baseFacts.coldest.year]);
  })();

  switch (intent) {
    case "greeting":
      speech = c.greeting(facts);
      suggestions = c.suggestions.greeting;
      listen = sonification(records, records, { fromYear: facts.start, toYear: facts.end }, c.listenLabel);
      break;
    case "help":
      speech = c.help;
      suggestions = c.suggestions.help;
      break;
    case "about":
      speech = c.about;
      suggestions = c.suggestions.help;
      break;
    case "latest":
      speech = c.latest(facts);
      sections.push(
        { label: c.labels.latest, value: String(facts.latest.year) },
        { label: c.labels.anomaly, value: c.anom(facts.latest.value) },
        { label: c.labels.rank, value: `${facts.latest.rank} / ${facts.latest.total}` },
        { label: c.labels.range, value: `${facts.start}–${facts.end}` },
      );
      suggestions = c.suggestions.latest;
      listen = sonification(records, records, { fromYear: Math.max(facts.start, facts.end - 39), toYear: facts.end }, c.listenLabel);
      break;
    case "warmest":
      speech = c.warmest(facts);
      sections.push(
        { label: c.labels.warmest, value: String(facts.warmest.year) },
        { label: c.labels.anomaly, value: c.anom(facts.warmest.value) },
        { label: c.labels.coldest, value: `${facts.coldest.year} — ${c.anom(facts.coldest.value)}` },
      );
      suggestions = c.suggestions.latest;
      listen = sonification(records, records, { fromYear: facts.start, toYear: facts.end }, c.listenLabel);
      break;
    case "coldest":
      speech = c.coldest(facts);
      sections.push(
        { label: c.labels.coldest, value: String(facts.coldest.year) },
        { label: c.labels.anomaly, value: c.anom(facts.coldest.value) },
        { label: c.labels.warmest, value: `${facts.warmest.year} — ${c.anom(facts.warmest.value)}` },
      );
      suggestions = c.suggestions.latest;
      listen = sonification(records, records, { fromYear: facts.start, toYear: facts.end }, c.listenLabel);
      break;
    case "year": {
      const asked = facts.asked;
      const year = years[0];
      if (!asked) {
        speech = c.yearMissing(year, facts);
        usesProjection = year > facts.end;
        sections.push(
          { label: c.labels.range, value: `${facts.start}–${facts.end}` },
          { label: c.labels.records, value: String(facts.total) },
        );
      } else {
        speech = c.year(facts);
        sections.push(
          { label: c.labels.anomaly, value: c.anom(asked.value) },
          { label: c.labels.rank, value: `${asked.rank} / ${asked.total}` },
        );
        listen = sonification(records, records, { fromYear: Math.max(facts.start, year - 15), toYear: year }, c.listenLabel);
      }
      suggestions = c.suggestions.year;
      break;
    }
    case "trend":
      speech = c.trend(facts);
      sections.push(
        { label: c.labels.trend, value: `${fmt(lang, facts.trendAll)} °C` },
        { label: c.labels.latest, value: `${facts.latest.year}` },
      );
      suggestions = c.suggestions.trend;
      listen = sonification(records, records, { fromYear: facts.start, toYear: facts.end }, c.listenLabel);
      break;
    case "compare": {
      const a = compareFacts.asked;
      const b = compareFacts.asked2;
      if (years.length >= 1 && !a) {
        speech = c.yearMissing(years[0], facts);
      } else if (years.length >= 2 && !b) {
        speech = c.yearMissing(years[1], facts);
      } else if (!a || !b || a.year === b.year) {
        speech = c.compareSame;
      } else {
        speech = c.compare(compareFacts);
        const d = compareFacts.delta ?? 0;
        sections.push(
          { label: String(a.year), value: c.anom(a.value) },
          { label: String(b.year), value: c.anom(b.value) },
          { label: c.labels.compare, value: `${d > 0 ? b.year : a.year} +${fmt(lang, Math.abs(d))} °C` },
        );
        listen = sonification(
          records,
          records,
          { fromYear: Math.min(a.year, b.year), toYear: Math.max(a.year, b.year) },
          c.listenLabel,
        );
      }
      suggestions = c.suggestions.compare;
      break;
    }
    case "prediction":
      speech = c.prediction(facts);
      usesProjection = true;
      if (facts.projection2026) {
        sections.push({
          label: c.labels.outlook,
          value: `2026 · ${fmt(lang, facts.projection2026.mean)} °C (${facts.projection2026.count})`,
        });
      }
      if (facts.projection2027 !== null) sections.push({ label: "2027", value: `${fmt(lang, facts.projection2027)} °C` });
      sections.push({ label: c.labels.latest, value: `${facts.end} — ${fmt(lang, facts.latest.value)} °C` });
      suggestions = c.suggestions.prediction;
      listen = sonification(records, records, { fromYear: Math.max(facts.start, facts.end - 29), toYear: facts.end }, c.listenLabel);
      break;
    case "data":
      speech = c.data(facts);
      sections.push(
        { label: c.labels.records, value: String(facts.total) },
        { label: c.labels.range, value: `${facts.start}–${facts.end}` },
      );
      suggestions = c.suggestions.data;
      listen = sonification(records, records, { fromYear: facts.start, toYear: facts.end }, c.listenLabel);
      break;
    case "play":
      speech = c.play;
      suggestions = c.suggestions.play;
      listen = sonification(records, records, { fromYear: facts.start, toYear: facts.end }, c.listenLabel);
      break;
    case "human":
      speech = c.human;
      suggestions = c.suggestions.greeting;
      break;
    case "thanks":
      speech = c.thanks;
      suggestions = c.suggestions.greeting;
      break;
    case "goodbye":
      speech = c.goodbye;
      break;
    default:
      speech = c.unknown;
      suggestions = c.suggestions.unknown;
      break;
  }

  return {
    intent,
    lang,
    heard,
    headline: c.headline[intent],
    speech,
    sections,
    listen,
    suggestions: suggestions.length ? suggestions : c.suggestions.greeting,
    sources: sourcesFor(lang, intent),
    usesProjection,
  };
}

/** Static capability manifest used by GET /api/agent and by the UI. */
export function agentManifest() {
  return {
    name: "EarthVibe voice agent",
    version: AGENT_VERSION,
    kind: "rule-based dialog engine over the released annual temperature record",
    languages: ["en", "ar", "fr"] as Lang[],
    inputs: ["text (POST /api/agent)", "speech (in the browser, recorded audio is sent to POST /api/transcribe)"],
    outputs: ["spoken answer (browser speech synthesis)", "text answer", "sonification of the same numbers (Web Audio)"],
    data: {
      endpoint: "/api/team-data",
      files: ["data/team/full_dataset.csv", "data/team/sonification_dataset.csv", "data/team/annual_predictions_202610.csv"],
      observedRange: null as string | null,
      note: "The agent answers only from these files. Missing years are reported as missing; projections are labelled as projections.",
    },
    privacy: {
      audio: "Audio is recorded in the browser only when the microphone button is pressed, is sent once for transcription, and is not stored by this app.",
      text: "Questions and answers stay in the browser session and are never persisted by this app.",
    },
    intents: [
      "greeting","help","about","latest","warmest","coldest","year","trend","compare","prediction","data","play","human","thanks","goodbye","unknown",
    ] as Intent[],
  };
}
