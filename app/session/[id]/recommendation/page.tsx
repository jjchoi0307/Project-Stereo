import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import RecommendationTabs from "@/components/RecommendationTabs";
import Header from "@/components/ui/Header";
import Stepper from "@/components/ui/Stepper";
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
      <main className="mx-auto w-full max-w-[880px] px-6 pb-14 pt-7" data-fade>
        <Link href={`/session/${id}`} className="lk mb-4 inline-block font-mono text-[12px]">
          ← Back to session
        </Link>
        <Stepper
          current={2}
          steps={[
            { label: "Capture facts", href: `/session/${id}` },
            { label: "Clinical read", href: `/session/${id}` },
            { label: "Recommendation", href: `/session/${id}/recommendation` },
            { label: "On record" },
          ]}
        />
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-5">
          <div>
            <div className="eyebrow mb-1.5 text-accent">Recommendation of record</div>
            <h1 className="display mb-1 text-[33px] font-semibold leading-[1.05] text-ink">Recommendation</h1>
            <p className="text-[13.5px] text-ink2">
              {client}. The ranking and every number below are deterministic and auditable.
            </p>
          </div>
          {/* Clean, plain-language client-facing summary the broker can show or print. */}
          <Link
            href={`/session/${id}/recommendation/present`}
            className="flex-none border border-accent bg-surface px-4 py-2 text-[13px] font-semibold text-accent hover:bg-accent/10"
          >
            Present to member →
          </Link>
        </div>

        {/* Key on the facts version so horizon + narrative state resets if the
            client's facts are corrected, rather than showing a stale projection. */}
        <RecommendationTabs key={p.capturedAt} sessionId={id} />
      </main>
    </div>
  );
}
