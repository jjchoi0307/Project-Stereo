/**
 * Plan-data reference view — renders the seeded plan data through the
 * data-access layer. Useful for sanity-checking the fixtures; not part of the
 * broker recommendation flow.
 */

import Link from "next/link";
import { getDataStore } from "@/lib/data";

export default async function PlansPage() {
  const db = getDataStore();
  const plans = await db.listPlans();
  const networks = await Promise.all(plans.map((p) => db.getNetwork(p.networkId)));
  const [regions, profiles] = await Promise.all([db.listRegions(), db.listExampleProfiles()]);
  const uclaByNetwork = new Map(networks.map((n) => [n?.id, n?.systemIds.includes("sys-ucla")]));

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <Link href="/" className="text-sm text-accent hover:underline">← Home</Link>
        <h1 className="mt-2 text-2xl font-semibold text-ink">Plan data (synthetic)</h1>
        <p className="mt-1 text-sm text-slate-600">Seeded fixtures behind the data-access layer.</p>
      </header>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">14 plans</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Plan</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Flags</th>
                <th className="px-3 py-2 font-medium">UCLA</th>
                <th className="px-3 py-2 font-medium">Regions</th>
                <th className="px-3 py-2 font-medium">Formulary</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <div className="font-medium text-ink">{p.name}</div>
                    <div className="text-xs text-slate-500">{p.carrier}</div>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{p.planType}</td>
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap gap-1">
                      {p.isScan && <Tag color="emerald">SCAN</Tag>}
                      {p.smgSupported && !p.isScan && <Tag color="emerald">SMG</Tag>}
                      {p.isCompetitor && <Tag color="rose">competitor</Tag>}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {uclaByNetwork.get(p.networkId) ? (
                      <span className="text-emerald-700">in-network</span>
                    ) : (
                      <span className="text-slate-400">no</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{p.regionsAvailable.join(", ")}</td>
                  <td className="px-3 py-2 text-slate-600">{p.formularyId.replace("form-", "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-6 sm:grid-cols-2">
        <Card title={`${regions.length} market regions`}>
          <ul className="space-y-1 text-sm text-slate-600">
            {regions.map((r) => (
              <li key={r.id}><span className="font-medium text-ink">{r.name}</span> — {r.counties.join(", ")}</li>
            ))}
          </ul>
        </Card>
        <Card title={`${profiles.length} example client profiles`}>
          <ul className="space-y-1 text-sm text-slate-600">
            {profiles.map((p) => (
              <li key={p.id}>
                <span className="font-medium text-ink">{p.id.replace("profile-", "")}</span> · age {p.age} ·{" "}
                {p.conditions.join(", ") || "—"} · entered by {p.capturedBy}
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </main>
  );
}

function Tag({ children, color }: { children: React.ReactNode; color: "emerald" | "rose" }) {
  const cls =
    color === "emerald"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : "bg-rose-50 text-rose-700 ring-rose-200";
  return <span className={`rounded px-1.5 py-0.5 text-xs ring-1 ${cls}`}>{children}</span>;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
    </div>
  );
}
