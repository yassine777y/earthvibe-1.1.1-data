import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";

/* Fonts are self-hosted (@fontsource-variable) so the build never depends on fonts.googleapis.com.
   Arabic falls back to the system Arabic face declared in --font-arabic. */

export const metadata: Metadata = {
  title: "Earth Jukebox — hear NASA Earth data",
  description:
    "Accessible, multilingual sonification of real NASA Earth data (GISTEMP, sea ice, ocean imagery). Independent student project — not an official NASA product.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#08090C" },
    { media: "(prefers-color-scheme: light)", color: "#F7F9FC" },
  ],
};

const themeScript = `(function(){try{var s=localStorage.getItem('earthjukebox.theme');var t=s==='light'||s==='dark'?s:(window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr" data-theme="dark" suppressHydrationWarning >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
