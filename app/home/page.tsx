/** Public landing page — the logged-out front door. */
import type { Metadata } from "next";
import PublicHome from "@/components/PublicHome";

export const metadata: Metadata = {
  title: "SMG Broker Plan Recommender",
  description:
    "A fact-driven, fully traceable Medicare Advantage plan recommendation for Seoul Medical Group brokers and the members they serve.",
};

export default function HomePage() {
  return <PublicHome />;
}
