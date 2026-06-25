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
        <h1 className="mb-1 text-2xl font-semibold tracking-[-.01em] text-ink">Audit log</h1>
        <p className="mb-6 text-[13.5px] text-slate-500">
          Reproducible records of every delivered recommendation. Each pins the exact data and engine
          versions used.
        </p>

        {records.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-[54px] text-center text-sm text-slate-500">
            No audit records yet. Generate a recommendation to create one.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="grid grid-cols-[140px_110px_1fr_1fr_120px] gap-4 border-b border-slate-200 bg-slate-50 px-5 py-3 text-[11px] font-semibold uppercase tracking-[.04em] text-slate-500">
              <div>Record</div>
              <div>Client</div>
              <div>Recommended plan</div>
              <div>Versions</div>
              <div className="text-right">Date</div>
            </div>
            {records.map((r) => {
              const topId = r.ranking[0];
              return (
                <Link
                  key={r.id}
                  href={`/audit/${r.id}`}
                  className="grid grid-cols-[140px_110px_1fr_1fr_120px] items-center gap-4 border-b border-slate-100 px-5 py-[15px] last:border-b-0 hover:bg-slate-50"
                >
                  <div className="num text-[12.5px] font-medium text-accent">{r.id}</div>
                  <div className="num text-[12.5px] font-semibold text-slate-600">{clientRef(sessionIdOf(r.profileSnapshot.id))}</div>
                  <div>
                    <div className="text-[13.5px] font-semibold">{topId ? planName.get(topId) ?? topId : "—"}</div>
                    <div className="text-xs text-slate-400">{topId ? planCarrier.get(topId) ?? "" : ""}</div>
                  </div>
                  <div className="num text-[11.5px] leading-[1.5] text-slate-500">
                    {r.dataVersion}
                    <br />
                    {r.engineVersion}
                  </div>
                  <div className="text-right text-[12.5px] text-slate-500">{fmtDate(r.createdAt)}</div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
