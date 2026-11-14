import { Providers } from "@/components/Providers";
import { Experience } from "@/components/Experience";
import { VoiceAgent } from "@/components/VoiceAgent";
import { ReleasePanel } from "@/components/ReleasePanel";
import { Footer, Header, Hero, Method } from "@/components/Chrome";

export default function HomePage() {
  return (
    <Providers>
      <Header />
      <main id="main" tabIndex={-1}>
        <Hero />
        <VoiceAgent />
        <Experience />
        <ReleasePanel />
        <Method />
      </main>
      <Footer />
    </Providers>
  );
}
