import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/next";
import { Archivo, IBM_Plex_Mono, Zen_Kaku_Gothic_New } from "next/font/google";

import "./globals.css";
import { ExperienceFrame } from "./components/ExperienceFrame";

const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  axes: ["wdth"],
  display: "swap",
});

// Kanji fallback for platforms without a good system gothic. Google serves it
// in unicode-range slices, so only the glyphs a page actually uses download.
const zenKaku = Zen_Kaku_Gothic_New({
  weight: ["500", "700"],
  subsets: ["latin"],
  variable: "--font-zen-kaku",
  display: "swap",
  preload: false,
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-plex-mono",
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Matchi — Find the Tokyo neighborhood that fits your life",
  description:
    "Meet your Matchi. Compare Tokyo neighborhoods by commute, modeled rent, and everyday rhythm — quietness, groceries, dining, and more — not just listings.",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${zenKaku.variable} ${plexMono.variable}`}>
      <body>
        <ExperienceFrame>{children}</ExperienceFrame>
        <Analytics />
      </body>
    </html>
  );
}
