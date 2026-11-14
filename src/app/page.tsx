import { Providers } from "@/components/Providers";
import { Experience } from "@/components/Experience";
import { VoiceAgent } from "@/components/VoiceAgent";
import { ReleasePanel } from "@/components/ReleasePanel";
import { SourcesPanel } from "@/components/SourcesPanel";
import { Footer, Header, Method } from "@/components/Chrome";
import { Hero } from "@/components/Hero";
import { SoundStudio } from "@/components/SoundStudio";
import { loadTeamData } from "@/lib/server/teamData";

/**
 * The released annual record is a file in this repository, so it can be read during the server
 * render. Passing it down means the hero globe, its readout and the year gallery are all present
 * in the first HTML response — no blank first paint, and it works with JavaScript disabled.
 * If the file cannot be read the pages still render and say so, instead of inventing numbers.
 */
async function readAnnualForHero() {
  try {
    const data = await loadTeamData();
    return data.dataset.records
      .map((r) => ({ date: r.date, value: r.value, movingAverage10Y: r.movingAverage10Y }))
      .filter((r) => Number.isFinite(r.value));
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const records = await readAnnualForHero();
  return (
    <Providers>
      <Header />
      <main id="main" tabIndex={-1}>
        <Hero initialRecords={records} />
        <SoundStudio initialRecords={records} />
        <VoiceAgent />
        <Experience />
        <ReleasePanel />
        <SourcesPanel />
        <Method />
      </main>
      <Footer />
    </Providers>
  );
}
