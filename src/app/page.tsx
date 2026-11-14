import { Providers } from "@/components/Providers";
import { Experience } from "@/components/Experience";
import { VoiceAgent } from "@/components/VoiceAgent";
import { ReleasePanel } from "@/components/ReleasePanel";
import { SourcesPanel } from "@/components/SourcesPanel";
import { Footer, Header, Method } from "@/components/Chrome";
import { Hero } from "@/components/Hero";
import { SoundStudio } from "@/components/SoundStudio";

export default function HomePage() {
  return (
    <Providers>
      <Header />
      <main id="main" tabIndex={-1}>
        <Hero />
        <SoundStudio />
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
