import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import RecommendationTabs from "@/components/RecommendationTabs";
import { getSessionStore } from "@/lib/session/store";

export const dynamic = "force-dynamic";

export default async function RecommendationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await (await getSessionStore()).get(id);
  if (!session) notFound();
  if (!session.profile) redirect(`/session/${id}`); // need facts first

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-6">
        <Link href={`/session/${id}`} className="text-sm text-accent hover:underline">
          ← Session {id}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-ink">Plan recommendation</h1>
        <p className="mt-1 text-sm text-slate-600">
          Ranked by fit across the client's likely futures — today, and as their health evolves over 5 and 10 years.
        </p>
      </header>

      {/* Key on the facts version so horizon + narrative state resets if the
          client's facts are corrected, rather than showing a stale projection. */}
      <RecommendationTabs key={session.profile.capturedAt} sessionId={id} />
    </main>
  );
}
