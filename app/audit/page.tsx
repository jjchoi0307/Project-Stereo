import Link from "next/link";
import Header from "@/components/ui/Header";
import { getAuditStore } from "@/lib/audit/store";
import { getDataStore } from "@/lib/data";
import { clientRef } from "@/lib/session/ref";

const sessionIdOf = (profileId: string) => profileId.replace(/^profile-/, "");

export const dynamic = "force-dynamic";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default async function AuditLogPage() {
  const [records, plans] = await Promise.all([(await getAuditStore()).list(), getDataStore().listPlans()]);
  const planName = new Map(plans.map((p) => [p.id, p.name]));
  const planCarrier = new Map(plans.map((p) => [p.id, p.carrier]));

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-[920px] px-6 pb-14 pt-9" data-fade>
        <div className="eyebrow mb-1.5 text-accent">Record of recommendations</div>
        <h1 className="display mb-1 text-[33px] font-semibold leading-[1.05] text-ink">Audit log</h1>
        <p className="mb-6 text-[13.5px] leading-[1.5] text-ink2">
          Reproducible records of every delivered recommendation. Each pins the exact data and engine
          versions used.
        </p>

        {records.length === 0 ? (
          <div className="record px-6 py-[54px] text-center text-sm text-ink2">
            No audit records yet. Generate a recommendation to create one.
          </div>
        ) : (
          <div className="record overflow-hidden">
            <div className="grid grid-cols-[140px_110px_1fr_1fr_120px] gap-4 border-b border-line bg-paper px-5 py-3 text-[11px] font-semibold uppercase tracking-[.04em] text-ink2">
              <div>Record</div>
              <div>Client</div>
              <div>Recommended plan</div>
              <div>Versions</div>
              <div className="text-right">Date</div>
            </div>
            {records.map((r) => {
              // Show the AI-delivered top pick (what the member saw), not the
              // deterministic engine order in `ranking`.
              const ai = r.aiRecommendation;
              const topId = ai ? ai.topPlanId ?? ai.ranked[0]?.planId ?? null : r.ranking[0];
              const topName = topId
                ? ai?.ranked.find((p) => p.planId === topId)?.planName ?? planName.get(topId) ?? topId
                : null;
              return (
                <Link
                  key={r.id}
                  href={`/audit/${r.id}`}
                  className="grid grid-cols-[140px_110px_1fr_1fr_120px] items-center gap-4 border-t border-line px-5 py-[15px] first:border-t-0 hover:bg-paper"
                >
                  <div className="num text-[12.5px] font-medium text-accent">{r.id}</div>
                  <div className="num text-[12.5px] font-semibold text-ink2">{clientRef(sessionIdOf(r.profileSnapshot.id))}</div>
                  <div>
                    <div className="display text-[15px] font-semibold text-ink">{topName ?? "—"}</div>
                    <div className="text-xs text-ink2">{topId ? planCarrier.get(topId) ?? "" : ""}</div>
                  </div>
                  <div className="num text-[11.5px] leading-[1.5] text-ink2">
                    {r.dataVersion}
                    <br />
                    {r.engineVersion}
                  </div>
                  <div className="num text-right text-[12.5px] text-ink2">{fmtDate(r.createdAt)}</div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
