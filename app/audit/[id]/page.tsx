import Link from "next/link";
import { notFound } from "next/navigation";
import VerifyBadge from "@/components/VerifyBadge";
import { getAuditStore } from "@/lib/audit/store";
import { getDataStore } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await getAuditStore().get(id);
  if (!record) notFound();

  const plans = await getDataStore().listPlans();
  const planName = new Map(plans.map((p) => [p.id, p.name]));
  const name = (pid: string) => planName.get(pid) ?? pid;
  const p = record.profileSnapshot;
  const n = record.normalizedProfile;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-6">
        <Link href="/audit" className="text-sm text-accent hover:underline">← Audit log</Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-mono text-xl font-semibold text-ink">{record.id}</h1>
          <VerifyBadge auditId={record.id} />
        </div>
        <p className="mt-1 text-sm text-slate-600">
          Reproducible record of one recommendation. Created {new Date(record.createdAt).toLocaleString()}.
        </p>
      </header>

      <Section title="Run">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
          <KV k="Scenario seed" v={String(record.scenarioSeed)} />
          <KV k="Scenarios" v={String(record.scenarioCount)} />
          <KV k="Preference weighting" v={record.preferenceWeightingEnabled ? "on" : "off"} />
          <KV k="Changed top pick" v={record.preferenceChangedTop ? "yes ⚑" : "no"} />
        </dl>
      </Section>

      <Section title="Inputs (profile snapshot)">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
          <KV k="Origin" v={p.capturedBy} />
          <KV k="Age" v={String(p.age)} />
          <KV k="Region" v={p.marketRegion} />
          <KV k="Medications" v={p.medications.map((m) => m.raw).join(", ") || "—"} full />
          <KV k="Conditions" v={p.conditions.join(", ") || "—"} full />
          <KV k="Must keep" v={p.providerConstraints.map((c) => c.label).join("; ") || "—"} full />
        </dl>
      </Section>

      <Section title="Normalized profile">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
          {(["diabetes", "oncologyRisk", "specialistNeed", "drugUtilizationIntensity", "mentalHealthUtilization", "networkSensitivity"] as const).map((k) => (
            <KV key={k} k={k} v={`${Math.round(n[k].value * 100)} · ${n[k].band.replace("_", " ")}`} />
          ))}
        </dl>
      </Section>

      <Section title="Exclusion log">
        {record.exclusionLog.length === 0 ? (
          <p className="text-sm text-slate-500">No exclusions or flags.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {record.exclusionLog.map((e, i) => (
              <li key={i} className={e.severity === "exclude" ? "text-rose-600" : "text-amber-700"}>
                {e.severity === "exclude" ? "✗" : "⚑"} <span className="font-medium">{name(e.planId)}</span>: {e.detail}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Per-plan scores (ranked)">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="py-1 pr-3 font-medium">#</th>
                <th className="py-1 pr-3 font-medium">Plan</th>
                <th className="py-1 pr-3 text-right font-medium">Expected fit</th>
                <th className="py-1 pr-3 text-right font-medium">Downside</th>
                <th className="py-1 pr-3 text-right font-medium">Confidence</th>
                <th className="py-1 pr-3 text-right font-medium">Preference</th>
                <th className="py-1 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {record.perPlanScores.map((s, i) => (
                <tr key={s.planId} className="border-t border-slate-100">
                  <td className="py-1.5 pr-3 text-slate-400">{i + 1}</td>
                  <td className="py-1.5 pr-3 font-medium text-ink">{name(s.planId)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{s.expectedFit}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{s.downsideRisk}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{s.confidence}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{s.preferenceContribution > 0 ? `+${s.preferenceContribution}` : "0"}</td>
                  <td className="py-1.5 text-right font-semibold tabular-nums">{s.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
    </section>
  );
}

function KV({ k, v, full }: { k: string; v: string; full?: boolean }) {
  return (
    <div className={full ? "sm:col-span-3" : ""}>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{k}</dt>
      <dd className="mt-0.5 text-slate-800">{v}</dd>
    </div>
  );
}
