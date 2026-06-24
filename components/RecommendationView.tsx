"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Reason { code: string; text: string; positive: boolean }
interface PlanMeta {
  id: string; name: string; carrier: string; planType: string;
  smgSupported: boolean; isScan: boolean; isCompetitor: boolean;
  monthlyPremium: number; annualOOPMax: number;
}
interface Exposure {
  mean: number; worst: number; medCoverageRate: number; catastrophicRate: number;
  topUncoveredDrugs: { name: string; rate: number }[];
}
interface ScoreComp { value: number; max: number }
interface Breakdown {
  coverageFit: ScoreComp; networkFit: ScoreComp; medicationFit: ScoreComp;
  mismatchPenalty: ScoreComp; catastrophicDownside: ScoreComp; preference: number;
}
interface RankedItem {
  planId: string; expectedFit: number; downsideRisk: number; confidence: number;
  preferenceContribution: number; total: number; reasons: Reason[];
  plan: PlanMeta; exposure: Exposure; providerGaps?: string[]; breakdown: Breakdown;
}
interface NearMiss {
  reason: string; requiredProviders: string[]; regionName: string; ranked: RankedItem[];
}
interface RecData {
  seed: number; scenarioCount: number;
  preferenceWeightingEnabled: boolean; preferenceChangedTop: boolean; topPlanId: string | null;
  ranked: RankedItem[];
  excluded: { plan: PlanMeta; reasons: { detail: string }[] }[];
  nearMiss?: NearMiss | null;
}
interface ScenarioResult {
  id: string; label: string; description: string;
  topPlanId: string | null; topPlanName: string | null; topTotal: number | null;
  changed: boolean; eligibleCount: number;
  baselineTop: {
    planId: string | null; planName: string | null;
    rankUnderScenario: number | null; totalUnderScenario: number | null;
  };
}
interface ScenarioData {
  baseline: { topPlanId: string | null; topPlanName: string | null; topTotal: number | null };
  scenarios: ScenarioResult[];
}

const usd = (n: number) => "$" + n.toLocaleString();
const premiumLabel = (n: number) => (n === 0 ? "$0" : "$" + n);
const pct = (n: number) => Math.round(n * 100) + "%";
const confLabel = (c: number) => (c >= 66 ? "High" : c >= 33 ? "Moderate" : "Low");

function PlanChips({ plan }: { plan: PlanMeta }) {
  const chips: string[] = [];
  if (plan.isScan) chips.push("SCAN");
  else if (plan.smgSupported) chips.push("SMG network");
  return (
    <>
      {chips.map((c) => (
        <span key={c} className="rounded-md bg-[#f0fdf9] px-2 py-0.5 text-[10.5px] font-semibold text-accent">
          {c}
        </span>
      ))}
    </>
  );
}

export default function RecommendationView({ sessionId }: { sessionId: string }) {
  const [preference, setPreference] = useState(true);
  const [data, setData] = useState<RecData | null>(null);
  const [loading, setLoading] = useState(true);
  const [auditId, setAuditId] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioData | null>(null);

  // Every recommendation produces a reproducible audit record (the delivered,
  // preference-on recommendation), upserted by facts-version.
  useEffect(() => {
    let active = true;
    fetch(`/api/sessions/${sessionId}/audit`, { method: "POST" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => active && d && setAuditId(d.auditId));
    return () => { active = false; };
  }, [sessionId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/sessions/${sessionId}/recommendation?preference=${preference ? "on" : "off"}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => active && setData(d))
      .catch(() => active && setData(null))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [sessionId, preference]);

  // Stress-test: how the recommendation holds up under "what-if" scenarios.
  useEffect(() => {
    let active = true;
    setScenarios(null);
    fetch(`/api/sessions/${sessionId}/scenarios?preference=${preference ? "on" : "off"}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => active && d && !d.error && setScenarios(d));
    return () => { active = false; };
  }, [sessionId, preference]);

  if (loading && !data) return <p className="text-sm text-slate-500">Running the recommendation…</p>;
  if (!data || !data.ranked) return <p className="text-sm text-rose-600">Could not load a recommendation.</p>;

  const noneEligible = data.ranked.length === 0;
  const top = data.ranked.slice(0, 3);
  const rest = data.ranked.slice(3);
  const nm = data.nearMiss ?? null;

  return (
    <div>
      {/* Preference weighting */}
      <div className="mb-[18px] flex flex-wrap items-center gap-3">
        <span className="text-[13px] font-medium text-slate-600">Preference weighting</span>
        <div className="inline-flex rounded-lg bg-[#eef2f5] p-[3px]">
          <PrefButton on={preference} label="On" onClick={() => setPreference(true)} />
          <PrefButton on={!preference} label="Off — pure fit" onClick={() => setPreference(false)} />
        </div>
        <span className="num ml-auto text-[11px] text-slate-400">
          {data.scenarioCount} scenarios · seed {data.seed}
        </span>
      </div>

      {data.preferenceWeightingEnabled && data.preferenceChangedTop && (
        <div className="mb-[18px] rounded-[9px] border border-amber-200 bg-amber-50 px-3.5 py-[11px] text-[12.5px] leading-[1.5] text-amber-800">
          ⚑ Turning preference weighting off changed the ordering of eligible plans. The top recommendation is
          unchanged.
        </div>
      )}

      {/* No eligible plan — explain, then offer the closest near-misses. */}
      {noneEligible && (
        <div className="space-y-4">
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
            <h2 className="text-sm font-semibold text-rose-800">No plan matches every hard requirement</h2>
            <p className="mt-1 text-sm leading-[1.5] text-rose-700">
              {nm
                ? nm.requiredProviders.length > 1
                  ? `No single plan in ${nm.regionName} keeps all of these must-keep providers in network: ${nm.requiredProviders.join(", ")}. The closest plans are below — each shows which required provider it would drop.`
                  : `No plan in ${nm.regionName} keeps ${nm.requiredProviders[0] ?? "the required provider"} in network. The closest plans are below.`
                : "Every plan was excluded for this profile (see “Not recommended” below). Try widening the market region or relaxing a hard requirement."}
            </p>
          </div>
          {nm && nm.ranked.length > 0 && (
            <div className="flex flex-col gap-3.5">
              {nm.ranked.slice(0, 3).map((item, i) => (
                <TopCard key={item.planId} item={item} rank={i + 1} highlight={false} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Top plans */}
      {!noneEligible && (
        <div className="mb-7 flex flex-col gap-3.5">
          {top.map((item, i) => (
            <TopCard key={item.planId} item={item} rank={i + 1} highlight={i === 0} />
          ))}
        </div>
      )}

      {/* Other eligible */}
      {rest.length > 0 && (
        <>
          <div className="mb-2.5 text-xs font-bold uppercase tracking-[.04em] text-slate-500">Other eligible plans</div>
          <div className="mb-7 overflow-hidden rounded-[11px] border border-slate-200 bg-white">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-[.03em] text-slate-500">
                  <th className="px-3.5 py-2.5 font-semibold">Plan</th>
                  <th className="px-3.5 py-2.5 text-right font-semibold">Premium</th>
                  <th className="px-3.5 py-2.5 text-right font-semibold">OOP max</th>
                  <th className="px-3.5 py-2.5 text-right font-semibold">Fit</th>
                </tr>
              </thead>
              <tbody>
                {rest.map((item) => (
                  <tr key={item.planId} className="border-t border-slate-100">
                    <td className="px-3.5 py-[11px]">
                      <div className="font-semibold">{item.plan.name}</div>
                      <div className="text-[11.5px] text-slate-400">
                        {item.plan.carrier} · {item.plan.planType}
                      </div>
                    </td>
                    <td className="num px-3.5 py-[11px] text-right">{premiumLabel(item.plan.monthlyPremium)}</td>
                    <td className="num px-3.5 py-[11px] text-right text-slate-600">{usd(item.plan.annualOOPMax)}</td>
                    <td className="num px-3.5 py-[11px] text-right font-semibold text-accent">{item.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Stress tests */}
      {scenarios && scenarios.scenarios.length > 0 && <StressTests data={scenarios} />}

      {/* Not recommended */}
      {data.excluded.length > 0 && (
        <>
          <div className="mb-2.5 text-xs font-bold uppercase tracking-[.04em] text-slate-500">Not recommended</div>
          <div className="mb-7 flex flex-col gap-[7px]">
            {data.excluded.map(({ plan, reasons }) => (
              <div
                key={plan.id}
                className="flex items-center gap-3 rounded-[9px] border border-slate-100 bg-white px-3.5 py-2.5"
              >
                <span className="flex-none font-bold text-rose-600">✗</span>
                <div className="flex-1">
                  <span className="text-[13px] font-semibold">{plan.name}</span>{" "}
                  <span className="text-xs text-slate-400">· {plan.carrier}</span>
                </div>
                <div className="flex-[1.4] text-right text-xs text-rose-800">
                  {reasons.map((r) => r.detail).join(" ")}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Audit footer */}
      {auditId && (
        <div className="flex items-center gap-2.5 rounded-[11px] border border-slate-200 bg-slate-50 px-[18px] py-3.5 text-[12.5px] text-slate-600">
          <span className="font-bold text-emerald-600">✓</span> Audit record saved on view —{" "}
          <Link href={`/audit/${auditId}`} className="num lk font-medium">
            {auditId}
          </Link>
        </div>
      )}
    </div>
  );
}

function PrefButton({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-md px-3.5 py-1.5 text-[12.5px] font-semibold"
      style={{ background: on ? "#0d6e6e" : "transparent", color: on ? "#fff" : "#64748b" }}
    >
      {label}
    </button>
  );
}

function StressTests({ data }: { data: ScenarioData }) {
  return (
    <>
      <div className="mb-2.5 text-xs font-bold uppercase tracking-[.04em] text-slate-500">Stress tests</div>
      <div className="mb-7 rounded-[11px] border border-slate-200 bg-white px-[18px] py-2">
        {data.scenarios.map((s) => {
          const bt = s.baselineTop;
          const baselineFate =
            bt.rankUnderScenario == null
              ? `${bt.planName ?? "baseline pick"} becomes ineligible`
              : bt.rankUnderScenario === 1
                ? `${bt.planName ?? "baseline pick"} stays #1`
                : `${bt.planName ?? "baseline pick"} falls to #${bt.rankUnderScenario}`;
          const note = s.changed
            ? `Top pick shifts to ${s.topPlanName ?? "— none eligible"}. ${baselineFate}.`
            : `Top pick unchanged. ${baselineFate}.`;
          return (
            <div key={s.id} className="flex items-start gap-3 border-b border-slate-100 py-3 last:border-b-0">
              <span
                className="flex-none rounded-md px-2.5 py-[3px] text-xs font-bold"
                style={{
                  background: s.changed ? "#fffbeb" : "#ecfdf5",
                  color: s.changed ? "#d97706" : "#059669",
                }}
              >
                {s.changed ? "⚑" : "✓"}
              </span>
              <div className="flex-1">
                <div className="text-[13px] font-semibold">{s.label}</div>
                <div className="mt-0.5 text-[12.5px] leading-[1.45] text-slate-500">{note}</div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function TopCard({ item, rank, highlight }: { item: RankedItem; rank: number; highlight: boolean }) {
  const positives = item.reasons.filter((r) => r.positive);
  const caveats = item.reasons.filter((r) => !r.positive);
  const e = item.exposure;
  const keepsProviders = item.reasons.some((r) => r.code === "keeps_required_providers");
  const networkGap = item.reasons.some((r) => r.code === "network_gap_risk");
  const networkLabel = networkGap ? "gap risk" : keepsProviders ? "keeps required" : "in network";

  return (
    <div
      className="relative rounded-[13px] border bg-white p-[22px]"
      style={{
        borderColor: highlight ? "#0d6e6e" : "#e2e8f0",
        boxShadow: highlight ? "0 8px 24px -12px rgba(13,110,110,.35)" : "none",
      }}
    >
      <div className="flex items-start gap-4">
        <div
          className="num flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] text-[15px] font-bold text-white"
          style={{ background: highlight ? "#0d6e6e" : "#0f172a" }}
        >
          {rank}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex flex-wrap items-center gap-2.5">
            <h3 className="text-[17px] font-semibold">{item.plan.name}</h3>
            <PlanChips plan={item.plan} />
          </div>
          <div className="text-[12.5px] text-slate-500">
            {item.plan.carrier} · {item.plan.planType} ·{" "}
            {item.plan.monthlyPremium === 0 ? "$0" : usd(item.plan.monthlyPremium)} premium ·{" "}
            {usd(item.plan.annualOOPMax)} OOP max
          </div>
        </div>
        <div className="flex-none text-right">
          <div className="num text-[34px] font-bold leading-none text-accent">{item.total}</div>
          <div className="text-[10.5px] uppercase tracking-[.03em] text-slate-400">fit score</div>
        </div>
      </div>

      {item.providerGaps && item.providerGaps.length > 0 && (
        <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">
          ✗ Drops required provider: <strong>{item.providerGaps.join(", ")}</strong>
        </div>
      )}

      <div className="my-4 grid grid-cols-2 gap-x-6 gap-y-2">
        <div>
          {positives.map((r) => (
            <div key={r.code} className="mb-[5px] flex gap-2 text-[12.5px] leading-[1.45] text-slate-700">
              <span className="flex-none text-emerald-600">✓</span>
              {r.text}
            </div>
          ))}
        </div>
        <div>
          {caveats.map((r) => (
            <div key={r.code} className="mb-[5px] flex gap-2 text-[12.5px] leading-[1.45] text-slate-700">
              <span className="flex-none text-amber-600">⚑</span>
              {r.text}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2.5 border-t border-slate-100 pt-3.5">
        <Stat label="Meds covered">
          <span className="num">{pct(e.medCoverageRate)}</span>
        </Stat>
        <Stat label="Network">
          <span className="text-emerald-600">{networkLabel}</span>
        </Stat>
        <Stat label="Worst-case / cat.">
          <span className="num">{usd(e.worst)}</span> <span className="font-normal text-slate-400">· {pct(e.catastrophicRate)}</span>
        </Stat>
        <Stat label="Confidence / est.">
          {confLabel(item.confidence)} <span className="font-normal text-slate-400">· <span className="num">{usd(e.mean)}</span>/yr</span>
        </Stat>
      </div>

      <BreakdownDetails item={item} />
    </div>
  );
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function CompRow({ label, value, max, sign }: { label: string; value: number; max: number; sign: "+" | "−" }) {
  const pos = sign === "+";
  return (
    <div className="flex items-center gap-2.5 py-[3px]">
      <span className="flex-[0_0_150px] text-[12px] text-slate-600">{label}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
        <span
          className="block h-full rounded-full"
          style={{ width: `${Math.round((Math.abs(value) / max) * 100)}%`, background: pos ? "#0d6e6e" : "#f59e0b" }}
        />
      </span>
      <span className="num flex-[0_0_64px] text-right text-[12px] font-semibold" style={{ color: pos ? "#0f172a" : "#b45309" }}>
        {sign}{round1(Math.abs(value))}
      </span>
      <span className="num flex-[0_0_30px] text-right text-[11px] text-slate-400">/{max}</span>
    </div>
  );
}

function BreakdownDetails({ item }: { item: RankedItem }) {
  const b = item.breakdown;
  return (
    <details className="mt-3 border-t border-slate-100 pt-3">
      <summary className="cursor-pointer list-none text-[12px] font-medium text-accent">
        ▸ How this fit score is built ({round1(item.total)})
      </summary>
      <div className="mt-2.5">
        <CompRow label="Coverage fit" value={b.coverageFit.value} max={b.coverageFit.max} sign="+" />
        <CompRow label="Network fit" value={b.networkFit.value} max={b.networkFit.max} sign="+" />
        <CompRow label="Medication fit" value={b.medicationFit.value} max={b.medicationFit.max} sign="+" />
        <CompRow label="Mismatch penalty" value={b.mismatchPenalty.value} max={b.mismatchPenalty.max} sign="−" />
        <div className="my-1.5 flex justify-between border-t border-dashed border-slate-200 pt-1.5 text-[12px]">
          <span className="text-slate-500">= Expected fit</span>
          <span className="num font-semibold">{round1(item.expectedFit)}</span>
        </div>
        <CompRow label="Catastrophic downside" value={b.catastrophicDownside.value} max={b.catastrophicDownside.max} sign="−" />
        {b.preference > 0 && (
          <div className="flex items-center gap-2.5 py-[3px]">
            <span className="flex-[0_0_150px] text-[12px] text-slate-600">SMG/SCAN preference</span>
            <span className="flex-1 text-[11px] italic text-slate-400">bounded tiebreak, logged</span>
            <span className="num flex-[0_0_64px] text-right text-[12px] font-semibold text-accent">+{round1(b.preference)}</span>
            <span className="num flex-[0_0_30px] text-right text-[11px] text-slate-400">/5</span>
          </div>
        )}
        <div className="mt-1.5 flex justify-between border-t border-slate-200 pt-1.5 text-[12.5px]">
          <span className="font-semibold">= Fit score</span>
          <span className="num font-bold text-accent">{round1(item.total)}</span>
        </div>
        <p className="mt-2 text-[11px] leading-[1.45] text-slate-400">
          Each component is a 0–1 fit measure × its weight. Higher coverage/network/medication fit is better;
          mismatch and catastrophic downside are subtracted. Components are rounded for display.
        </p>
      </div>
    </details>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 text-[10.5px] uppercase tracking-[.03em] text-slate-400">{label}</div>
      <div className="text-[13px] font-semibold">{children}</div>
    </div>
  );
}
