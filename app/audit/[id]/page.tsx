import Link from "next/link";
import { notFound } from "next/navigation";
import VerifyBadge from "@/components/VerifyBadge";
import Header from "@/components/ui/Header";
import { getAuditStore } from "@/lib/audit/store";
import { getDataStore } from "@/lib/data";
import { getIntakeReference } from "@/lib/intake/reference";
import { CONDITION_OPTIONS } from "@/lib/intake/options";
import type { ExclusionReason, NormalizedProfile, RiskBand } from "@/lib/domain";

export const dynamic = "force-dynamic";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const RULE_LABEL: Record<ExclusionReason, string> = {
  provider_out_of_network: "NETWORK_REQUIRED",
  medication_off_formulary: "DRUG_FORMULARY",
  region_unavailable: "REGION_UNAVAILABLE",
};

const MARKER_LABEL: Record<keyof Omit<NormalizedProfile, "profileId">, string> = {
  diabetes: "Diabetes / metabolic",
  networkSensitivity: "Network sensitivity",
  specialistNeed: "Specialist need",
  drugUtilizationIntensity: "Drug utilization",
  mentalHealthUtilization: "Mental health",
  oncologyRisk: "Oncology",
};
const BAND_TEXT: Record<RiskBand, string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
  very_high: "Very high",
};

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await (await getAuditStore()).get(id);
  if (!record) notFound();

  const [plans, reference] = await Promise.all([getDataStore().listPlans(), getIntakeReference()]);
  const planName = new Map(plans.map((p) => [p.id, p.name]));
  const name = (pid: string) => planName.get(pid) ?? pid;
  const p = record.profileSnapshot;
  const n = record.normalizedProfile;

  const regionName = reference.regions.find((r) => r.id === p.marketRegion)?.name ?? p.marketRegion;
  const condLabel = (c: string) => CONDITION_OPTIONS.find((o) => o.value === c)?.label ?? c;
  const conditions = p.conditions.map(condLabel).join(", ") || "—";
  const requiredProviders = p.providerConstraints.map((c) => c.label).join(", ") || "None";
  const topId = record.ranking[0];
  const seedHex = "0x" + (record.scenarioSeed >>> 0).toString(16).toUpperCase();
  const excluded = record.exclusionLog.filter((e) => e.severity === "exclude");

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-[840px] px-6 pb-14 pt-7" data-fade>
        <Link href="/audit" className="lk mb-3.5 inline-block text-[13px]">
          ← Audit log
        </Link>
        <div className="mb-1.5 flex items-center gap-2.5">
          <h1 className="num m-0 text-[21px] font-semibold text-accent">{record.id}</h1>
          <span className="rounded-md bg-slate-100 px-2.5 py-[3px] text-[10.5px] font-semibold uppercase tracking-[.03em] text-slate-600">
            Immutable
          </span>
        </div>
        <p className="text-[13px] text-slate-500">
          {fmtDate(record.createdAt)} · recommended{" "}
          <strong className="font-semibold text-ink">{topId ? name(topId) : "—"}</strong>
        </p>

        {/* Verify hero */}
        <div className="my-5 rounded-[13px] bg-ink p-[22px] text-white">
          <div className="flex flex-wrap items-center gap-[18px]">
            <div className="min-w-[220px] flex-1">
              <div className="mb-1 text-sm font-semibold">Verify reproducibility</div>
              <p className="m-0 text-[12.5px] leading-[1.5] text-slate-400">
                Re-runs the engine with the recorded seed and versions, then confirms the ranking reproduces
                exactly.
              </p>
            </div>
            <VerifyBadge auditId={record.id} />
          </div>
        </div>

        {/* Snapshot grid */}
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SnapshotCard title="Profile snapshot">
            <KV k="Age / region" v={`${p.age} · ${regionName}`} />
            <KV k="Conditions" v={conditions} />
            <KV k="Medications" v={`${p.medications.length} captured`} />
            <KV k="Required provider" v={requiredProviders} />
          </SnapshotCard>
          <SnapshotCard title="Versions & seed">
            <KV k="Plan data" v={record.dataVersion ?? "—"} mono />
            <KV k="Engine" v={record.engineVersion ?? "—"} mono />
            <KV k="Random seed" v={seedHex} mono />
            <KV k="Futures" v={String(record.scenarioCount)} mono />
          </SnapshotCard>
        </div>

        {/* Normalized markers */}
        <Card title="Normalized markers">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(MARKER_LABEL) as (keyof typeof MARKER_LABEL)[]).map((k) => (
              <span
                key={k}
                className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-[5px] text-xs text-slate-600"
              >
                {MARKER_LABEL[k]} · <span className="num font-semibold">{Math.round(n[k].value * 100)}</span>{" "}
                <span className="text-slate-400">{BAND_TEXT[n[k].band]}</span>
              </span>
            ))}
          </div>
        </Card>

        {/* Exclusion log */}
        <Card title="Exclusion log">
          {excluded.length === 0 ? (
            <p className="text-sm text-slate-500">No plans excluded for this profile.</p>
          ) : (
            <div className="flex flex-col">
              {excluded.map((e, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 border-b border-slate-100 py-[7px] text-[12.5px] last:border-b-0"
                >
                  <span className="num flex-[0_0_170px] font-medium text-rose-700">{RULE_LABEL[e.reason]}</span>
                  <span className="flex-[0_0_180px] font-semibold">{name(e.planId)}</span>
                  <span className="flex-1 text-slate-500">{e.detail}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Per-plan scores */}
        <Card title="Per-plan scores & ranking">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[.03em] text-slate-500">
                <th className="px-2 py-1.5 font-semibold">Rank</th>
                <th className="px-2 py-1.5 font-semibold">Plan</th>
                <th className="px-2 py-1.5 text-right font-semibold">Fit</th>
                <th className="px-2 py-1.5 text-right font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {record.perPlanScores.map((s, i) => (
                <tr key={s.planId} className="border-t border-slate-100">
                  <td className="num px-2 py-2 text-slate-400">{i + 1}</td>
                  <td className="px-2 py-2 font-medium">{name(s.planId)}</td>
                  <td className="num px-2 py-2 text-right font-semibold text-accent">{s.total}</td>
                  <td className="px-2 py-2 text-right text-[11.5px] text-emerald-600">eligible</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </main>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4 rounded-xl border border-slate-200 bg-white p-[18px]">
      <div className="mb-3 text-[11px] font-bold uppercase tracking-[.05em] text-slate-500">{title}</div>
      {children}
    </section>
  );
}

function SnapshotCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-[18px]">
      <div className="mb-3 text-[11px] font-bold uppercase tracking-[.05em] text-slate-500">{title}</div>
      <div className="flex flex-col gap-[7px] text-[12.5px]">{children}</div>
    </div>
  );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-500">{k}</span>
      <span className={`text-right ${mono ? "num" : ""}`}>{v}</span>
    </div>
  );
}
