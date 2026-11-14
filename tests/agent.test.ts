import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  agentManifest,
  answerQuestion,
  computeFacts,
  detectLanguage,
  extractYears,
  normalizeInput,
  type Intent,
} from "@/lib/agent/answer";
import { loadTeamData, TEAM_FILES } from "@/lib/server/teamData";
import { buildRelease, sha256File } from "@/lib/server/release";
import { chunkText } from "@/lib/speech";
import { POST as agentPOST, GET as agentGET } from "@/app/api/agent/route";
import { GET as transcribeGET, POST as transcribePOST } from "@/app/api/transcribe/route";

const dataPromise = loadTeamData();
const ask = async (question: string, lang?: "en" | "ar" | "fr") =>
  answerQuestion({ question, data: await dataPromise, lang });

function postAgent(body: unknown, contentType = "application/json") {
  return agentPOST(
    new Request("http://localhost/api/agent", {
      method: "POST",
      headers: { "content-type": contentType },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

describe("released dataset", () => {
  it("loads the three team files and cross-checks them", async () => {
    const data = await dataPromise;
    expect(data.dataset.records).toHaveLength(146);
    expect(data.dataset.availableRange).toEqual({ start: "1880-01-01", end: "2025-01-01" });
    expect(data.dataset.sonificationRecords).toHaveLength(146);
    expect(data.predictions.records.length).toBeGreaterThan(0);
    expect(data.provenance.files).toEqual([...TEAM_FILES]);
    // no invented records: every value is a real number and every date is January 1st
    for (const r of data.dataset.records) {
      expect(Number.isFinite(r.value)).toBe(true);
      expect(r.date.endsWith("-01-01")).toBe(true);
    }
  });

  it("computes facts from data only", async () => {
    const facts = computeFacts(await dataPromise);
    expect(facts.total).toBe(146);
    expect(facts.warmest.year).toBe(2024);
    expect(facts.warmest.value).toBeCloseTo(1.28, 2);
    expect(facts.warmest.rank).toBe(1);
    expect(facts.latest.year).toBe(2025);
    expect(facts.trendAll).toBeGreaterThan(0);
    expect(facts.coldest.value).toBeLessThan(0);
  });
});

describe("input understanding", () => {
  it("normalises Arabic orthography", () => {
    expect(normalizeInput("مَا أَدْفَأُ سَنَةٍ؟")).toContain("ادفا");
    expect(normalizeInput("Quelle est l’année ?")).toBe("quelle est l annee");
  });

  it("detects English, Arabic and French", () => {
    expect(detectLanguage("what is the latest year?")).toBe("en");
    expect(detectLanguage("ما أدفأ سنة")).toBe("ar");
    expect(detectLanguage("quelle est la tendance ?")).toBe("fr");
    expect(detectLanguage("1990")).toBeNull();
  });

  it("extracts years including Arabic-Indic and superscript digits", () => {
    expect(extractYears("compare 1990 and 2024")).toEqual([1990, 2024]);
    expect(extractYears("قارن ١٩٩٠ و٢٠٢٤")).toEqual([1990, 2024]);
    expect(extractYears("the year ²⁰²⁴")).toEqual([2024]);
    expect(extractYears("1234 and 3000")).toEqual([]);
  });
});

describe("agent answers", () => {
  it.each([
    ["what is the latest year?", "latest"],
    ["ما أحدث سنة؟", "latest"],
    ["quelle est l'année la plus récente ?", "latest"],
    ["what is the warmest year?", "warmest"],
    ["ما أدفأ سنة؟", "warmest"],
    ["what is the coldest year", "coldest"],
    ["what is the trend?", "trend"],
    ["compare 1990 and 2024", "compare"],
    ["قارن 1990 و2024", "compare"],
    ["what are the predictions for 2026", "prediction"],
    ["what data is released?", "data"],
    ["what does the sound mean?", "play"],
    ["what can you ask me?", "help"],
    ["who are you", "about"],
    ["thanks", "thanks"],
    ["goodbye", "goodbye"],
    ["tell me about 1998", "year"],
    ["blah blah", "unknown"],
  ])("understands %j as %s", async (question, intent) => {
    const answer = await ask(question);
    expect(answer.intent).toBe(intent as Intent);
    expect(answer.speech.length).toBeGreaterThan(20);
  });

  it("answers the latest year with the real value and rank", async () => {
    const answer = await ask("what is the latest year?");
    expect(answer.speech).toContain("2025");
    expect(answer.speech).toContain("1.18");
    expect(answer.speech).toMatch(/ranks 2 of 146/);
    expect(answer.listen?.records).toHaveLength(40);
  });

  it("never mixes projections with observations", async () => {
    const answer = await ask("predictions for 2026");
    expect(answer.usesProjection).toBe(true);
    expect(answer.speech).toMatch(/projections/);
    expect(answer.speech).toMatch(/not measurements/);
    // the sonification only offers observed years
    const maxYear = Math.max(...(answer.listen?.records ?? []).map((r) => Number(r.date.slice(0, 4))));
    expect(maxYear).toBeLessThanOrEqual(2025);
  });

  it("reports a year outside the record as missing instead of inventing it", async () => {
    const answer = await ask("tell me about 2040");
    expect(answer.intent).toBe("year");
    expect(answer.speech).toMatch(/no confirmed observation/i);
    expect(answer.speech).toContain("1880");
    expect(answer.speech).toContain("2025");
    expect(answer.listen).toBeNull();
  });

  it("handles a comparison between equal years honestly", async () => {
    const answer = await ask("compare 2024 and 2024");
    expect(answer.speech.length).toBeGreaterThan(20);
    expect(answer.listen).toBeNull();
  });

  it("answers in the language of the question, whatever the UI language is", async () => {
    const answer = await ask("ما أدفأ سنة؟", "en");
    expect(answer.lang).toBe("ar");
    expect(answer.headline).toBe("أدفأ سنة");
    const fr = await ask("quelle est l'année la plus chaude ?");
    expect(fr.lang).toBe("fr");
    expect(fr.speech).toContain("1,28");
  });

  it("provides the same answer in all three languages with matching numbers", async () => {
    const [en, ar, fr] = await Promise.all([
      ask("what is the warmest year?", "en"),
      ask("ما أدفأ سنة؟", "ar"),
      ask("quelle est l'année la plus chaude ?", "fr"),
    ]);
    for (const a of [en, ar, fr]) {
      expect(a.speech.length).toBeGreaterThan(40);
      expect(a.headline.length).toBeGreaterThan(0);
    }
    expect(en.speech).toContain("1.28");
    expect(ar.speech).toContain("1.28"); // Arabic locale digits still resolve to the same value
    expect(fr.speech).toContain("1,28");
    for (const a of [en, ar, fr]) expect(a.speech).toContain("2024");
  });

  it("returns a sonification whose values all come from the released record", async () => {
    const data = await dataPromise;
    const answer = await ask("what is the trend?");
    expect(answer.listen).not.toBeNull();
    const known = new Set(data.dataset.records.map((r) => `${r.date}:${r.value}`));
    for (const r of answer.listen!.records) expect(known.has(`${r.date}:${r.value}`)).toBe(true);
    const values = data.dataset.records.map((r) => r.value);
    expect(answer.listen!.scale).toEqual({ min: Math.min(...values), max: Math.max(...values), zero: 0 });
  });

  it("suggests follow-up questions that are themselves answerable", async () => {
    const answer = await ask("what is the latest year?");
    expect(answer.suggestions.length).toBeGreaterThan(0);
    for (const s of answer.suggestions) {
      const followUp = await ask(s, answer.lang);
      expect(followUp.intent).not.toBe("unknown");
    }
  });

  it("includes sources and never claims to be human", async () => {
    const data = await ask("what data is released?");
    expect(data.sources.some((s) => s.url.includes("giss.nasa.gov"))).toBe(true);
    const human = await ask("can I talk to a human?");
    expect(human.intent).toBe("human");
    expect(human.speech).toMatch(/cannot/i);
  });

  it("exposes a manifest listing what it can and cannot do", () => {
    const manifest = agentManifest();
    expect(manifest.languages).toEqual(["en", "ar", "fr"]);
    expect(manifest.intents).toContain("compare");
    expect(manifest.kind).toMatch(/rule-based/);
  });
});

describe("agent API", () => {
  it("returns the manifest on GET", async () => {
    const res = await agentGET(new Request("http://localhost/api/agent"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { records: number; observedRange: { start: string } } };
    expect(body.data.records).toBe(146);
    expect(body.data.observedRange.start).toBe("1880-01-01");
  });

  it("answers a POSTed question", async () => {
    const res = await postAgent({ question: "what is the latest year?" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { intent: string; speech: string; lang: string };
    expect(body.intent).toBe("latest");
    expect(body.lang).toBe("en");
    expect(body.speech).toContain("2025");
  });

  it("rejects an empty or missing question", async () => {
    expect((await postAgent({ question: "   " })).status).toBe(400);
    expect((await postAgent({})).status).toBe(400);
  });

  it("rejects the wrong content type and over-long questions", async () => {
    expect((await postAgent("question=hi", "text/plain")).status).toBe(415);
    expect((await postAgent({ question: "x".repeat(401) })).status).toBe(413);
  });

  it("honours an explicit language override only when it is supported", async () => {
    const res = await postAgent({ question: "what is the latest year?", defaultLang: "fr" });
    const body = (await res.json()) as { lang: string };
    expect(body.lang).toBe("en"); // the question itself is English
    const arRes = await postAgent({ question: "1998", lang: "ar" });
    const arBody = (await arRes.json()) as { lang: string };
    expect(arBody.lang).toBe("ar");
  });
});

describe("speech transcription endpoint", () => {
  it("reports honestly when server transcription is not configured", async () => {
    const res = await transcribeGET(new Request("http://localhost/api/transcribe"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { configured: boolean }).configured).toBe(false);
  });

  it("refuses to pretend it heard something", async () => {
    const form = new FormData();
    form.set("audio", new File([new Uint8Array([1, 2, 3])], "q.webm", { type: "audio/webm" }));
    const res = await transcribePOST(
      new Request("http://localhost/api/transcribe", { method: "POST", body: form }),
    );
    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("transcription_not_configured");
  });
});

describe("open data release", () => {
  it("hashes exactly the shipped files", async () => {
    const release = await buildRelease();
    expect(release.integrity.files).toHaveLength(3);
    for (const entry of release.integrity.files) {
      const absolute = path.join(process.cwd(), entry.file.split("/").join(path.sep));
      const manual = createHash("sha256").update(await readFile(absolute)).digest("hex");
      expect(entry.sha256).toBe(manual);
      expect(entry.sha256).toBe(await sha256File(absolute));
    }
  });

  it("describes the released record accurately", async () => {
    const release = await buildRelease();
    expect(release.summary.observedYears).toBe(146);
    expect(release.summary.warmestYear).toBe(2024);
    expect(release.dataset.records).toHaveLength(146);
    expect(release.access.endpoints.release).toBe("/api/release");
    expect(release.agent.languages).toEqual(["en", "ar", "fr"]);
    expect(release.disclaimer).toMatch(/not an official NASA product/i);
    expect(release.disclaimer).toMatch(/not measurements/i);
  });

  it("includes the site-hosted release manifest in the repository", async () => {
    const json = JSON.parse(await readFile(path.join(process.cwd(), "release", "release.json"), "utf8")) as {
      summary: { observedYears: number };
      integrity: { files: { sha256: string }[] };
    };
    const release = await buildRelease();
    expect(json.summary.observedYears).toBe(146);
    expect(json.integrity.files.map((f) => f.sha256)).toEqual(release.integrity.files.map((f) => f.sha256));
  });
});

describe("speech text chunking", () => {
  it("keeps short text whole and splits long answers on sentences", () => {
    expect(chunkText("One short answer.", 220)).toEqual(["One short answer."]);
    const long = "First sentence. ".repeat(40);
    const chunks = chunkText(long, 220);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 242)).toBe(true);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toContain("First sentence.");
  });
});
