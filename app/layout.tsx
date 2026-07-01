import type { Metadata } from "next";
import { Plus_Jakarta_Sans, IBM_Plex_Mono, Newsreader } from "next/font/google";
import "./globals.css";
import PublicAnalytics from "@/components/PublicAnalytics";

// SMG identity (see DESIGN.md): a friendly, professional humanist sans for all
// headings + UI — warm and accessible for the Korean-American senior members SMG
// serves, deliberately NOT Inter/Roboto. A ledger mono for figures/ids keeps the
// "every number is traceable" promise. Self-hosted via next/font (no Google
// beacon; satisfies the PHI app's strict font-src 'self' CSP).
const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
  display: "swap",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});
// Editorial display serif for flagship headlines (hero, section titles) — the
// premium, non-"AI" register. Light weights + optical sizing read like GS/NYT.
const serif = Newsreader({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SMG Broker Engagement Tool",
  description:
    "Fact-driven plan recommendations for Seoul Medical Group brokers.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable}`}>
      <body>
        {children}
        <PublicAnalytics />
      </body>
    </html>
  );
}
