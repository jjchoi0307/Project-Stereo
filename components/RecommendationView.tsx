"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Ref, Sources, type Citation } from "@/components/ui/Citation";
import PlanKind from "@/components/ui/PlanKind";
import Spinner from "@/components/ui/Spinner";

interface Reason { code: string; text: string; positive: boolean; citation?: Citation | null }
interface PlanMeta {
  id: string; name: string; carrier: string; planType: string; snpType?: string;
  smgSupported: boolean; isScan: boolean; isCompetitor: boolean;
  monthlyPremium: number; annualOOPMax: number;
}
interface Exposure {
  mean: number; worst: number; medCoverageRate: number; catastrophicRate: number;
  topUncoveredDrugs: { name: string; rate: number }[];
}
interface ScoreComp { value: number; max: number; why?: string | null }
interface Breakdown {
  coverageFit: ScoreComp; networkFit: ScoreComp; medicationFit: ScoreComp;
  mismatchPenalty: ScoreComp; catastrophicDownside: ScoreComp; preference: number;
}
interface CostItem { label: string; annualEstimate: number; basis: string }
interface CostBreakdown { items: CostItem[]; estimatedAnnualTotal: number }
interface PlanFeature { label: string; value: string | null; included: boolean }
interface RankedItem {
  planId: string; expectedFit: number; downsideRisk: number; confidence: number;
  preferenceContribution: number; total: number; reasons: Reason[];
  plan: PlanMeta; exposure: Exposure; providerGaps?: string[]; breakdown: Breakdown;
  networkStatus?: "in" | "gap" | "keeps";
  costBreakdown?: CostBreakdown | null; deepWritten?: boolean;
  topThreeVotes?: number; features?: PlanFeature[];
}
interface NearMiss {
  reason: string; requiredProviders: string[]; regionName: string; ranked: RankedItem[];
}
interface RecData {
  seed: number; scenarioCount: number;
  model?: string; aiPowered?: boolean;
  ensembleRuns?: number;
  preferenceWeightingEnabled: boolean; preferenceChangedTop: boolean; topPlanId: string | null;
  ranked: RankedItem[];
  excluded: { plan: PlanMeta; reasons: { detail: string }[] }[];
  nearMiss?: NearMiss | null;
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

export default function RecommendationView({ sessionId, onLoaded }: { sessionId: string; onLoaded?: () => void }) {
  const [data, setData] = useState<RecData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<{ message: string; notConfigured: boolean } | null>(null);
  const [auditId, setAuditId] = useState<string | null>(null);

  // The delivered recommendation is AI-powered, so the audit record preserves the
  // exact AI output + citations. POST it AFTER the recommendation loads, so the
  // server has cached the AI result and the audit can store the same delivered
  // ranking ("reproducibility by record"). Upserted by facts-version.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    fetch(`/api/sessions/${sessionId}/recommendation`, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!active) return;
        if (r.ok) {
          setData(d);
          // Today is done — let the parent kick off the 3/5-year projection in the
          // background so it's ready by the time the broker opens a horizon tab.
          onLoaded?.();
          // Now that the AI recommendation is warm in the server cache, snapshot it.
          fetch(`/api/sessions/${sessionId}/audit`, { method: "POST" })
            .then((res) => (res.ok ? res.json() : null))
            .then((a) => active && a && setAuditId(a.auditId));
        } else {
          setLoadError({
            message: d?.detail ?? d?.error ?? "Could not load a recommendation.",
            notConfigured: r.status === 503,
          });
        }
      })
      .catch(() => active && setLoadError({ message: "Could not reach the recommendation service.", notConfigured: false }))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [sessionId]);

  if (loading && !data)
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-[13px] border border-slate-200 bg-white px-6 py-12 text-center">
        <Spinner size={26} />
        <div>
          <div className="text-[14px] font-semibold text-ink">Generating the AI recommendation…</div>
          <div className="mt-1 text-[12.5px] text-slate-500">
            Reasoning over the 2026 plan files to rank plans, score fit, and cite every figure. (~30–45s)
          </div>
        </div>
        <div className="flex flex-col gap-2.5 pt-1">
          {["Screening eligible plans", "Scoring fit & writing reasons", "Citing the source pages"].map((step, i) => (
            <div key={step} className="flex items-center gap-2.5 text-[12px] text-slate-400">
              <span
                className="h-1.5 w-1.5 rounded-full bg-accent"
                style={{ animation: "pulseDot 1.4s ease-in-out infinite", animationDelay: `${i * 0.25}s` }}
              />
              {step}
            </div>
          ))}
        </div>
      </div>
    );
  if (loadError && !data)
    return loadError.notConfigured ? (
      <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
        The AI recommendation is not enabled for this account. {loadError.message}
      </div>
    ) : (
      <p className="text-sm text-rose-600">{loadError.message}</p>
    );
  if (!data || !data.ranked) return <p className="text-sm text-rose-600">Could not load a recommendation.</p>;

  const noneEligible = data.ranked.length === 0;
  const top = data.ranked.slice(0, 3);
  const rest = data.ranked.slice(3);
  const nm = data.nearMiss ?? null;

  return (
    <div>
      <div className="mb-[18px] flex flex-wrap items-center gap-3">
        <span className="rounded-md bg-[#f6fdfb] px-2.5 py-1 text-[12px] font-medium text-accent ring-1 ring-[#ccebe6]">
          AI-ranked on fit — grounded in the 2026 plan files, no carrier preference
        </span>
        {data.model && (
          <span className="num ml-auto text-[11px] text-slate-400">
            AI-powered · {data.model}
          </span>
        )}
      </div>

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

      {/* Top plans — full-width stacked cards (readable; comparison reads down the page) */}
      {!noneEligible && (
        <div className="mb-7">
          {typeof data.ensembleRuns === "number" && data.ensembleRuns > 0 && (
            <p className="mb-3 text-[12.5px] leading-[1.45] text-slate-500">
              We ran the analysis <span className="num">{data.ensembleRuns}</span> times and show the plans that came
              out on top most often. These are planning aids, not medical advice.
            </p>
          )}
          <div className="flex flex-col gap-3.5">
            {top.map((item, i) => (
              <TopCard key={item.planId} item={item} rank={i + 1} highlight={i === 0} ensembleRuns={data.ensembleRuns} />
            ))}
          </div>
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
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{item.plan.name}</span>
                        <PlanKind snpType={item.plan.snpType} />
                      </div>
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

// Full per-plan analysis — the original detailed card body (reason bullets with
// citations, the fit-score breakdown, and the predicted-cost breakdown). Kept
// intact and reused inside both the stacked near-miss cards and the top-3
// drill-down so nothing from the audited analysis is lost.
function FullAnalysis({ item }: { item: RankedItem }) {
  const positives = item.reasons.filter((r) => r.positive);
  const caveats = item.reasons.filter((r) => !r.positive);
  const e = item.exposure;
  const networkLabel =
    item.networkStatus === "gap"
      ? "gap risk"
      : item.networkStatus === "keeps"
        ? "keeps required"
        : "in network";

  return (
    <>
      {(() => {
        const cited = [...positives, ...caveats].filter((r) => r.citation);
        const refOf = (r: Reason) => {
          const i = cited.indexOf(r);
          return i >= 0 ? i + 1 : null;
        };
        return (
          <>
            <div className="my-4 grid grid-cols-2 gap-x-6 gap-y-2">
              <div>
                {positives.map((r) => (
                  <div key={r.code} className="mb-[5px] flex gap-2 text-[12.5px] leading-[1.45] text-slate-700">
                    <span className="flex-none text-emerald-600">✓</span>
                    <span>{r.text}<Ref n={refOf(r)} /></span>
                  </div>
                ))}
              </div>
              <div>
                {caveats.map((r) => (
                  <div key={r.code} className="mb-[5px] flex gap-2 text-[12.5px] leading-[1.45] text-slate-700">
                    <span className="flex-none text-amber-600">⚑</span>
                    <span>{r.text}<Ref n={refOf(r)} /></span>
                  </div>
                ))}
              </div>
            </div>
            {cited.length > 0 && <Sources cited={cited} />}
          </>
        );
      })()}

      <div className="grid grid-cols-2 gap-2.5 border-t border-slate-100 pt-3.5 sm:grid-cols-4">
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
    </>
  );
}

// Stacked detailed card — full width so nothing is squished. Header + an
// "includes" grid + the full analysis inline. Used for the top-3 recommendation
// and the near-miss ("closest plans") fallback.
function TopCard({ item, rank, highlight, ensembleRuns }: { item: RankedItem; rank: number; highlight: boolean; ensembleRuns?: number }) {
  const hasEnsemble = typeof ensembleRuns === "number" && ensembleRuns > 0 && typeof item.topThreeVotes === "number";
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
            <PlanKind snpType={item.plan.snpType} />
            <PlanChips plan={item.plan} />
            {highlight && (
              <span className="rounded-md bg-[#f0fdf9] px-2 py-0.5 text-[10.5px] font-semibold text-accent">Lead pick</span>
            )}
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
          {hasEnsemble &&
            (item.topThreeVotes && item.topThreeVotes > 0 ? (
              <div className="mt-1 text-[11px] leading-[1.35] text-slate-400">
                top 3 in <span className="num font-semibold text-slate-600">{item.topThreeVotes}</span>/
                <span className="num">{ensembleRuns}</span> runs
              </div>
            ) : (
              <div className="mt-1 text-[11px] leading-[1.35] text-slate-400">alternative carrier · shown for choice</div>
            ))}
        </div>
      </div>

      {item.providerGaps && item.providerGaps.length > 0 && (
        <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">
          ✗ Drops required provider: <strong>{item.providerGaps.join(", ")}</strong>
        </div>
      )}

      {/* ── Calm surface: a fifth-grader read ──────────────────────────────────
          Plain "why it fits" (no footnotes) + the few facts a broker says out
          loud. All the depth — full benefit list, cited bullets + sources, the
          fit-score breakdown, and the cost detail — sits one click below. */}
      {(() => {
        const surfaceWhy = item.reasons.filter((r) => r.positive).slice(0, 3);
        return surfaceWhy.length > 0 ? (
          <div className="mt-3.5 flex flex-col gap-1.5">
            {surfaceWhy.map((r) => (
              <div key={r.code} className="flex gap-2 text-[13px] leading-[1.45] text-slate-700">
                <span className="flex-none text-emerald-600">✓</span>
                <span>{r.text}</span>
              </div>
            ))}
          </div>
        ) : null;
      })()}

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-slate-500">
        <span>
          Your medications <span className="font-semibold text-ink">{pct(item.exposure.medCoverageRate)} covered</span>
        </span>
        <span>
          Network:{" "}
          <span className="font-semibold text-emerald-600">
            {item.networkStatus === "gap" ? "gap risk" : item.networkStatus === "keeps" ? "keeps your providers" : "in network"}
          </span>
        </span>
      </div>

      {/* ── Depth, one click away (nothing removed) ──────────────────────────── */}
      <details className="mt-3.5 border-t border-slate-100 pt-3">
        <summary className="cursor-pointer list-none text-[12.5px] font-medium text-accent">
          ▸ See full details, sources &amp; cost
        </summary>
        <div className="mt-3">
          {item.features && item.features.length > 0 && (
            <div className="mb-1">
              <div className="mb-2 text-[10.5px] font-bold uppercase tracking-[.03em] text-slate-400">What it includes</div>
              <div className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                {item.features.map((f) => (
                  <div key={f.label} className="flex items-baseline justify-between gap-3 border-b border-slate-50 py-[5px]">
                    <span className="text-[12px] text-slate-500">{f.label}</span>
                    {f.included ? (
                      <span className="flex items-baseline gap-1 text-right text-[12.5px] font-semibold text-ink">
                        <span className="text-emerald-600">✓</span> <span className="num">{f.value}</span>
                      </span>
                    ) : (
                      <span className="text-right text-[12px] text-slate-300">Not included</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <FullAnalysis item={item} />
        </div>
      </details>
    </div>
  );
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function CompRow({ label, value, max, sign, why }: { label: string; value: number; max: number; sign: "+" | "−"; why?: string | null }) {
  const pos = sign === "+";
  return (
    <div className="py-[3px]">
      <div className="flex items-center gap-2.5">
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
      {why && <div className="ml-[150px] pl-2.5 pr-[100px] text-[11px] leading-[1.4] text-slate-400">{why}</div>}
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
        <CompRow label="Coverage fit" value={b.coverageFit.value} max={b.coverageFit.max} sign="+" why={b.coverageFit.why} />
        <CompRow label="Network fit" value={b.networkFit.value} max={b.networkFit.max} sign="+" why={b.networkFit.why} />
        <CompRow label="Medication fit" value={b.medicationFit.value} max={b.medicationFit.max} sign="+" why={b.medicationFit.why} />
        <CompRow label="Mismatch penalty" value={b.mismatchPenalty.value} max={b.mismatchPenalty.max} sign="−" why={b.mismatchPenalty.why} />
        <div className="my-1.5 flex justify-between border-t border-dashed border-slate-200 pt-1.5 text-[12px]">
          <span className="text-slate-500">= Expected fit</span>
          <span className="num font-semibold">{round1(item.expectedFit)}</span>
        </div>
        <CompRow label="Catastrophic downside" value={b.catastrophicDownside.value} max={b.catastrophicDownside.max} sign="−" why={b.catastrophicDownside.why} />
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
          Each component is a 0–1 fit measure × its weight, with the AI&apos;s grounded reason for the score.
          Higher coverage/network/medication fit is better; mismatch and catastrophic downside are subtracted.
        </p>
      </div>

      {item.costBreakdown && item.costBreakdown.items.length > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <div className="mb-1.5 text-[12px] font-medium text-accent">
            Predicted annual cost — how the ${item.costBreakdown.estimatedAnnualTotal.toLocaleString()}/yr estimate is built
          </div>
          <div className="flex flex-col gap-1">
            {item.costBreakdown.items.map((ci, i) => (
              <div key={i} className="flex items-baseline gap-2.5 text-[12px]">
                <span className="flex-[0_0_180px] text-slate-600">{ci.label}</span>
                <span className="num flex-[0_0_70px] text-right font-semibold text-ink">${ci.annualEstimate.toLocaleString()}</span>
                <span className="flex-1 text-[11px] italic text-slate-400">{ci.basis}</span>
              </div>
            ))}
            <div className="mt-1 flex items-baseline gap-2.5 border-t border-slate-200 pt-1.5 text-[12.5px]">
              <span className="flex-[0_0_180px] font-semibold">Estimated total / year</span>
              <span className="num flex-[0_0_70px] text-right font-bold text-accent">
                ${item.costBreakdown.estimatedAnnualTotal.toLocaleString()}
              </span>
              <span className="flex-1 text-[11px] italic text-slate-400">tied to this member&apos;s expected use</span>
            </div>
          </div>
        </div>
      )}
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

