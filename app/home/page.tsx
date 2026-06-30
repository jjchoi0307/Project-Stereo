/** Public landing page — the logged-out front door. */
import type { Metadata } from "next";
import PublicHome from "@/components/PublicHome";

export const metadata: Metadata = {
  title: "SMG Broker Plan Recommender",
  description:
    "A fact-driven, fully traceable Medicare Advantage plan recommendation for Seoul Medical Group brokers and the members they serve.",
};

// Rendered per-request so the production CSP's per-request script nonce
// (middleware.ts) is stamped onto this page's scripts. A statically prerendered
// page would bake script tags at build time with no nonce, and the strict CSP
// would then block them.
export const dynamic = "force-dynamic";

export default function HomePage() {
  return <PublicHome />;
}
