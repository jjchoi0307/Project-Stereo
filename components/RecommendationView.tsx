"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Ref, Sources, type Citation } from "@/components/ui/Citation";
import PlanKind from "@/components/ui/PlanKind";
import Spinner from "@/components/ui/Spinner";
import FitScore from "@/components/ui/FitScore";
import RecordSeal from "@/components/ui/RecordSeal";
import SmgLoader from "@/components/ui/SmgLoader";

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
export interface RankedItem {
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

/** The "Other eligible plans" table (ranked tail below the top-3 cards). Exported
 *  so the 3yr/5yr horizon tab shows the same ranked tail as Today. */
export function OtherEligibleTable({ rest }: { rest: RankedItem[] }) {
  return (
    <>
      <div className="eyebrow mb-2.5 text-ink2">Other eligible plans</div>
      <div className="mb-7 overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-paper text-left text-[11px] uppercase tracking-[.03em] text-ink2">
              <th className="px-3.5 py-2.5 font-semibold">Plan</th>
              <th className="px-3.5 py-2.5 text-right font-semibold">Premium</th>
              <th className="px-3.5 py-2.5 text-right font-semibold">OOP max</th>
              <th className="px-3.5 py-2.5 text-right font-semibold">Fit</th>
            </tr>
          </thead>
          <tbody>
            {rest.map((item) => (
              <tr key={item.planId} className="border-t border-line">
                <td className="px-3.5 py-[11px]">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{item.plan.name}</span>
                    <PlanKind snpType={item.plan.snpType} />
                  </div>
                  <div className="text-[11.5px] text-ink2">
                    {item.plan.carrier} · {item.plan.planType}
                  </div>
                </td>
                <td className="num px-3.5 py-[11px] text-right">{premiumLabel(item.plan.monthlyPremium)}</td>
                <td className="num px-3.5 py-[11px] text-right text-ink2">{usd(item.plan.annualOOPMax)}</td>
                <td className="num px-3.5 py-[11px] text-right font-semibold text-accent">{item.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Shared AI loading card (centered spinner + pulsing step dots). Used by Today
 *  and by the 3yr/5yr horizon tab so the loading experience is identical. */
export function RecommendationLoading({ title, subtitle, steps }: { title: string; subtitle: string; steps: string[] }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-line bg-surface shadow-card px-6 py-12 text-center">
      <SmgLoader size={52} />
      <div>
        <div className="display text-[16px] font-semibold text-ink">{title}</div>
        <div className="mt-1 text-[12.5px] text-ink2">{subtitle}</div>
      </div>
      <div className="flex flex-col gap-2.5 pt-1">
        {steps.map((step, i) => (
          <div key={step} className="flex items-center gap-2.5 text-[12px] text-ink2">
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
}

function PlanChips({ plan }: { plan: PlanMeta }) {
  const chips: string[] = [];
  if (plan.isScan) chips.push("SCAN");
  else if (plan.smgSupported) chips.push("SMG network");
  return (
    <>
      {chips.map((c) => (
        <span key={c} className="border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[.04em] text-accent">
          {c}
        </span>
      ))}
    </>
  );
}

export default function RecommendationView({
  sessionId,
  onLoaded,
}: {
  sessionId: string;
  onLoaded?: (today: { topPlanId: string | null; topPlanName: string | null; topIds: string[] }) => void;
}) {
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
          // Hand the parent today's top pick so it can label "changes vs today"
          // on the horizon tabs without the horizon route having to wait for /
          // read today's cache (the two now load in parallel).
          const topId: string | null = d?.topPlanId ?? null;
          const ranked: RankedItem[] = Array.isArray(d?.ranked) ? d.ranked : [];
          const topName = ranked.find((x) => x.planId === topId)?.plan?.name ?? null;
          // Top-3 lineup ids — the parent uses these to label the horizon banner
          // accurately ("same lineup" vs "lead unchanged, runners-up shift" vs "changed").
          const topIds = ranked.slice(0, 3).map((x) => x.planId);
          onLoaded?.({ topPlanId: topId, topPlanName: topName, topIds });
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
      <RecommendationLoading
        title="Generating the AI recommendation…"
        subtitle="Reasoning over the 2026 plan files to rank plans, score fit, and cite every figure. (~30–45s)"
        steps={["Screening eligible plans", "Scoring fit & writing reasons", "Citing the source pages"]}
      />
    );
  if (loadError && !data)
    return loadError.notConfigured ? (
      <div className="rounded-xl border border-ai bg-surface px-4 py-3 text-sm text-ai">
        The AI recommendation is not enabled for this account. {loadError.message}
      </div>
    ) : (
      <p className="text-sm text-neg">{loadError.message}</p>
    );
  if (!data || !data.ranked) return <p className="text-sm text-neg">Could not load a recommendation.</p>;

  const noneEligible = data.ranked.length === 0;
  const top = data.ranked.slice(0, 3);
  const rest = data.ranked.slice(3);
  const nm = data.nearMiss ?? null;

  return (
    <div>
      <div className="mb-[18px] flex flex-wrap items-center gap-3 border-l-2 border-accent pl-3">
        <span className="text-[12.5px] leading-[1.45] text-ink2">
          Ranked on <span className="font-semibold text-ink">fit alone</span> — grounded in the 2026 plan files, with{" "}
          <span className="font-semibold text-ink">no carrier preference</span>.
        </span>
        {data.aiPowered && (
          <span className="eyebrow ml-auto !tracking-[.06em] text-ink2">AI-powered</span>
        )}
      </div>

      {/* No eligible plan — explain, then offer the closest near-misses. */}
      {noneEligible && (
        <div className="space-y-4">
          <div className="rounded-xl border border-neg bg-surface px-4 py-3">
            <h2 className="text-sm font-semibold text-neg">No plan matches every hard requirement</h2>
            <p className="mt-1 text-sm leading-[1.5] text-neg">
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
            <p className="mb-3 text-[12.5px] leading-[1.45] text-ink2">
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
      {rest.length > 0 && <OtherEligibleTable rest={rest} />}

      {/* Not recommended */}
      {data.excluded.length > 0 && (
        <>
          <div className="eyebrow mb-2.5 text-ink2">Not recommended for this member</div>
          <div className="mb-7 flex flex-col gap-[7px]">
            {data.excluded.map(({ plan, reasons }) => (
              <div
                key={plan.id}
                className="flex items-center gap-3 rounded-sm border border-line bg-surface px-3.5 py-2.5"
              >
                <span className="flex-none font-bold text-neg">✗</span>
                <div className="flex-1">
                  <span className="text-[13px] font-semibold">{plan.name}</span>{" "}
                  <span className="text-xs text-ink2">· {plan.carrier}</span>
                </div>
                <div className="flex-[1.4] text-right text-xs text-neg">
                  {reasons.map((r) => r.detail).join(" ")}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Record strip — the signature. The recommendation is snapshotted to a
          reproducible audit record the moment it's viewed; the seal carries that
          promise (same facts + engine → same ranking, re-verifiable). */}
      {!noneEligible && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-surface shadow-card px-[18px] py-4">
          <RecordSeal
            tone={auditId ? "recorded" : "pending"}
            caption={
              auditId ? (
                <>
                  <span className="block text-[12px] font-semibold text-ink">On record · re-verifiable</span>
                  {typeof data.ensembleRuns === "number" && data.ensembleRuns > 0 ? (
                    <>
                      Ranked across <span className="num">{data.ensembleRuns}</span> analysis runs and snapshotted to an
                      immutable audit record — re-verify any time.
                    </>
                  ) : (
                    <>
                      <span className="num">{data.scenarioCount}</span> scenarios · seed{" "}
                      <span className="num">{data.seed}</span> — the same facts always rank the same.
                    </>
                  )}
                </>
              ) : (
                <>
                  <span className="block text-[12px] font-semibold text-ink">Saving to record…</span>
                  snapshotting this ranking for re-verification.
                </>
              )
            }
          />
          {auditId && (
            <Link
              href={`/audit/${auditId}`}
              className="flex-none rounded-lg border border-accent bg-surface px-3.5 py-2 text-[12.5px] font-semibold text-accent hover:bg-accent-tint"
            >
              View audit record <span className="num">{auditId}</span> →
            </Link>
          )}
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
                  <div key={r.code} className="mb-[5px] flex gap-2 text-[12.5px] leading-[1.45] text-ink">
                    <span className="flex-none text-pos">✓</span>
                    <span>{r.text}<Ref n={refOf(r)} /></span>
                  </div>
                ))}
              </div>
              <div>
                {caveats.map((r) => (
                  <div key={r.code} className="mb-[5px] flex gap-2 text-[12.5px] leading-[1.45] text-ink">
                    <span className="flex-none text-warn">⚑</span>
                    <span>{r.text}<Ref n={refOf(r)} /></span>
                  </div>
                ))}
              </div>
            </div>
            {cited.length > 0 && <Sources cited={cited} />}
          </>
        );
      })()}

      <div className="grid grid-cols-2 gap-2.5 border-t border-line pt-3.5 sm:grid-cols-4">
        <Stat label="Meds covered">
          <span className="num">{pct(e.medCoverageRate)}</span>
        </Stat>
        <Stat label="Network">
          <span className="text-pos">{networkLabel}</span>
        </Stat>
        <Stat label="Worst-case / cat.">
          <span className="num">{usd(e.worst)}</span> <span className="font-normal text-ink2">· {pct(e.catastrophicRate)}</span>
        </Stat>
        <Stat label="Confidence / est.">
          {confLabel(item.confidence)} <span className="font-normal text-ink2">· <span className="num">{usd(e.mean)}</span>/yr</span>
        </Stat>
      </div>

      <BreakdownDetails item={item} />
    </>
  );
}

// Stacked detailed card — full width so nothing is squished. Header + an
// "includes" grid + the full analysis inline. Used for the top-3 recommendation
// and the near-miss ("closest plans") fallback.
export function TopCard({ item, rank, highlight, ensembleRuns }: { item: RankedItem; rank: number; highlight: boolean; ensembleRuns?: number }) {
  const hasEnsemble = typeof ensembleRuns === "number" && ensembleRuns > 0 && typeof item.topThreeVotes === "number";
  return (
    <div
      className={`relative rounded-xl border bg-surface p-[22px] shadow-card ${highlight ? "border-brand/40" : "border-line"}`}
      style={highlight ? { borderTopWidth: 3, borderTopColor: "#00a840" } : undefined}
    >
      <div className="flex items-start gap-4">
        <div className={`num flex-none pt-0.5 text-[26px] font-semibold leading-none ${highlight ? "text-accent" : "text-ink2"}`}>
          {String(rank).padStart(2, "0")}
        </div>
        <div className="min-w-0 flex-1">
          {highlight && (
            <div className="eyebrow mb-1 text-accent">Recommended — best fit for this member</div>
          )}
          <div className="mb-0.5 flex flex-wrap items-center gap-2.5">
            <h3 className="display text-[22px] font-semibold leading-tight text-ink">{item.plan.name}</h3>
            <PlanKind snpType={item.plan.snpType} />
            <PlanChips plan={item.plan} />
          </div>
          <div className="text-[12.5px] text-ink2">
            {item.plan.carrier} · {item.plan.planType} ·{" "}
            <span className="num">{item.plan.monthlyPremium === 0 ? "$0" : usd(item.plan.monthlyPremium)}</span> premium ·{" "}
            <span className="num">{usd(item.plan.annualOOPMax)}</span> OOP max
          </div>
        </div>
        <div className="flex-none">
          <FitScore value={item.total} confidence={item.confidence} />
          {hasEnsemble &&
            (item.topThreeVotes && item.topThreeVotes > 0 ? (
              <div className="mt-1.5 text-right text-[11px] leading-[1.35] text-ink2">
                top 3 in <span className="num font-semibold text-ink2">{item.topThreeVotes}</span>/
                <span className="num">{ensembleRuns}</span> runs
              </div>
            ) : (
              <div className="mt-1.5 text-right text-[11px] leading-[1.35] text-ink2">rounds out the top 3</div>
            ))}
        </div>
      </div>

      {item.providerGaps && item.providerGaps.length > 0 && (
        <div className="mt-3 rounded-md border border-neg bg-surface px-3 py-2 text-[12.5px] text-neg">
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
              <div key={r.code} className="flex gap-2 text-[13px] leading-[1.45] text-ink">
                <span className="flex-none text-pos">✓</span>
                <span>{r.text}</span>
              </div>
            ))}
          </div>
        ) : null;
      })()}

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-ink2">
        <span>
          Your medications <span className="font-semibold text-ink">{pct(item.exposure.medCoverageRate)} covered</span>
        </span>
        <span>
          Network:{" "}
          <span className="font-semibold text-pos">
            {item.networkStatus === "gap" ? "gap risk" : item.networkStatus === "keeps" ? "keeps your providers" : "in network"}
          </span>
        </span>
      </div>

      {/* ── Depth, one click away (nothing removed) ──────────────────────────── */}
      <details className="mt-3.5 border-t border-line pt-3">
        <summary className="cursor-pointer list-none text-[12.5px] font-medium text-accent">
          ▸ See full details, sources &amp; cost
        </summary>
        <div className="mt-3">
          {item.features && item.features.length > 0 && (
            <div className="mb-1">
              <div className="mb-2 text-[10.5px] font-bold uppercase tracking-[.03em] text-ink2">What it includes</div>
              <div className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                {item.features.map((f) => (
                  <div key={f.label} className="flex items-baseline justify-between gap-3 border-b border-line py-[5px]">
                    <span className="text-[12px] text-ink2">{f.label}</span>
                    {f.included ? (
                      <span className="flex items-baseline gap-1 text-right text-[12.5px] font-semibold text-ink">
                        <span className="text-pos">✓</span> <span className="num">{f.value}</span>
                      </span>
                    ) : (
                      <span className="text-right text-[12px] text-line">Not included</span>
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
        <span className="flex-[0_0_150px] text-[12px] text-ink2">{label}</span>
        <span className="h-[5px] flex-1 overflow-hidden bg-line">
          <span
            className="block h-full"
            style={{ width: `${Math.round((Math.abs(value) / max) * 100)}%`, background: pos ? "#047a32" : "#b07514" }}
          />
        </span>
        <span className="num flex-[0_0_64px] text-right text-[12px] font-semibold" style={{ color: pos ? "#142433" : "#b07514" }}>
          {sign}{round1(Math.abs(value))}
        </span>
        <span className="num flex-[0_0_30px] text-right text-[11px] text-ink2">/{max}</span>
      </div>
      {why && <div className="ml-[150px] pl-2.5 pr-[100px] text-[11px] leading-[1.4] text-ink2">{why}</div>}
    </div>
  );
}

function BreakdownDetails({ item }: { item: RankedItem }) {
  const b = item.breakdown;
  return (
    <details className="mt-3 border-t border-line pt-3">
      <summary className="cursor-pointer list-none text-[12px] font-medium text-accent">
        ▸ How this fit score is built ({round1(item.total)})
      </summary>
      <div className="mt-2.5">
        <CompRow label="Coverage fit" value={b.coverageFit.value} max={b.coverageFit.max} sign="+" why={b.coverageFit.why} />
        <CompRow label="Network fit" value={b.networkFit.value} max={b.networkFit.max} sign="+" why={b.networkFit.why} />
        <CompRow label="Medication fit" value={b.medicationFit.value} max={b.medicationFit.max} sign="+" why={b.medicationFit.why} />
        <CompRow label="Mismatch penalty" value={b.mismatchPenalty.value} max={b.mismatchPenalty.max} sign="−" why={b.mismatchPenalty.why} />
        <div className="my-1.5 flex justify-between border-t border-dashed border-line pt-1.5 text-[12px]">
          <span className="text-ink2">= Expected fit</span>
          <span className="num font-semibold">{round1(item.expectedFit)}</span>
        </div>
        <CompRow label="Catastrophic downside" value={b.catastrophicDownside.value} max={b.catastrophicDownside.max} sign="−" why={b.catastrophicDownside.why} />
        {b.preference > 0 && (
          <div className="flex items-center gap-2.5 py-[3px]">
            <span className="flex-[0_0_150px] text-[12px] text-ink2">SMG/SCAN preference</span>
            <span className="flex-1 text-[11px] italic text-ink2">bounded tiebreak, logged</span>
            <span className="num flex-[0_0_64px] text-right text-[12px] font-semibold text-accent">+{round1(b.preference)}</span>
            <span className="num flex-[0_0_30px] text-right text-[11px] text-ink2">/5</span>
          </div>
        )}
        <div className="mt-1.5 flex justify-between border-t border-line pt-1.5 text-[12.5px]">
          <span className="font-semibold">= Fit score</span>
          <span className="num font-bold text-accent">{round1(item.total)}</span>
        </div>
        <p className="mt-2 text-[11px] leading-[1.45] text-ink2">
          Each component is a 0–1 fit measure × its weight, with the AI&apos;s grounded reason for the score.
          Higher coverage/network/medication fit is better; mismatch and catastrophic downside are subtracted.
        </p>
      </div>

      {item.costBreakdown && item.costBreakdown.items.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <div className="mb-1.5 text-[12px] font-medium text-accent">
            Predicted annual cost — how the ${item.costBreakdown.estimatedAnnualTotal.toLocaleString()}/yr estimate is built
          </div>
          <div className="flex flex-col gap-1">
            {item.costBreakdown.items.map((ci, i) => (
              <div key={i} className="flex items-baseline gap-2.5 text-[12px]">
                <span className="flex-[0_0_180px] text-ink2">{ci.label}</span>
                <span className="num flex-[0_0_70px] text-right font-semibold text-ink">${ci.annualEstimate.toLocaleString()}</span>
                <span className="flex-1 text-[11px] italic text-ink2">{ci.basis}</span>
              </div>
            ))}
            <div className="mt-1 flex items-baseline gap-2.5 border-t border-line pt-1.5 text-[12.5px]">
              <span className="flex-[0_0_180px] font-semibold">Estimated total / year</span>
              <span className="num flex-[0_0_70px] text-right font-bold text-accent">
                ${item.costBreakdown.estimatedAnnualTotal.toLocaleString()}
              </span>
              <span className="flex-1 text-[11px] italic text-ink2">tied to this member&apos;s expected use</span>
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
      <div className="mb-0.5 text-[10.5px] uppercase tracking-[.03em] text-ink2">{label}</div>
      <div className="text-[13px] font-semibold">{children}</div>
    </div>
  );
}

