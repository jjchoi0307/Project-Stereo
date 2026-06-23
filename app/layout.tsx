import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
