import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import RecommendationTabs from "@/components/RecommendationTabs";
import Header from "@/components/ui/Header";
import { getIntakeReference } from "@/lib/intake/reference";
import { getSessionStore } from "@/lib/session/store";

export const dynamic = "force-dynamic";

export default async function RecommendationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await (await getSessionStore()).get(id);
  if (!session) notFound();
  if (!session.profile) redirect(`/session/${id}`); // need facts first

  const reference = await getIntakeReference();
  const p = session.profile;
  const regionName = reference.regions.find((r) => r.id === p.marketRegion)?.name ?? p.marketRegion;
  const client = `${session.clientLabel ?? "Client"} · ${p.age} · ${regionName} County`;

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-[920px] px-6 pb-14 pt-7" data-fade>
        <Link href={`/session/${id}`} className="lk mb-3 inline-block text-[13px]">
          ← Back to session
        </Link>
        <h1 className="mb-1 text-[25px] font-semibold tracking-[-.01em] text-ink">Recommendation</h1>
        <p className="mb-5 text-[13.5px] text-slate-500">
          {client}. The ranking and every number below are deterministic and auditable.
        </p>

        {/* Key on the facts version so horizon + narrative state resets if the
            client's facts are corrected, rather than showing a stale projection. */}
        <RecommendationTabs key={p.capturedAt} sessionId={id} />
      </main>
    </div>
  );
}
