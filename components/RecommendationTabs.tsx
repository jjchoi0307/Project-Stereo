"use client";

import { useEffect, useState } from "react";
import RecommendationView from "./RecommendationView";
import { HORIZON_REC, SCORING } from "@/lib/engine/config";
import Spinner from "@/components/ui/Spinner";
import PlanKind from "@/components/ui/PlanKind";
import { Ref, Sources, type Citation } from "@/components/ui/Citation";

// ── Shapes returned by the AI horizon route ──────────────────────────────────
interface PlanMeta {
  id: string; name: string; carrier: string; planType: string; snpType?: string;
  smgSupported: boolean; isScan: boolean; isCompetitor: boolean;
  monthlyPremium: number; annualOOPMax: number;
}
interface Reason { code: string; text: string; positive: boolean; citation?: Citation | null }
interface Exposure {
  mean: number; worst: number; medCoverageRate: number; catastrophicRate: number;
  topUncoveredDrugs: { name: string; rate: number }[];
}
interface RankedPlan {
  planId: string; total: number; confidence: number; plan: PlanMeta;
  reasons: Reason[]; exposure: Exposure; providerGaps?: string[]; networkStatus?: "in" | "gap" | "keeps";
}
type Likelihood = "low" | "moderate" | "high";
interface HorizonProjection {
  headline: string; summary: string;
  conditions: { label: string; likelihood: Likelihood }[];
  medications: { name: string; likelihood: Likelihood }[];
}
interface HorizonRec {
  years: number; changedVsToday: boolean;
  projection: HorizonProjection;
  recommended: RankedPlan | null;
  distribution: { plan: PlanMeta; fitScore: number }[];
}
interface HorizonsData {
  model?: string; todayTopPlanId: string | null; todayTopPlanName: string | null; horizons: HorizonRec[];
}

const usd = (n: number) => "$" + n.toLocaleString();
const pct = (n: number) => Math.round(n * 100) + "%";
const premiumLabel = (n: number) => (n === 0 ? "$0/mo" : "$" + n + "/mo");
const confLabel = (c: number) => (c >= 66 ? "High" : c >= 33 ? "Moderate" : "Low");

type Tab = "today" | number;

export default function RecommendationTabs({ sessionId }: { sessionId: string }) {
  const [tab, setTab] = useState<Tab>("today");
  const [horizons, setHorizons] = useState<HorizonsData | null>(null);
  const [hStatus, setHStatus] = useState<"idle" | "loading" | "error">("idle");
  const [todayReady, setTodayReady] = useState(false);

  // Prefetch the across-horizon projection in the BACKGROUND once Today is done —
  // not in parallel with it. The Today ensemble is the priority; firing the heavy
  // horizon call alongside it just makes them compete (Anthropic rate limits) and
  // slows Today. By waiting for Today, then computing the 3/5-year projection while
  // the broker reads Today, the horizon tabs feel instant when opened. (If the
  // broker jumps straight to a horizon tab, we load it then.) Cached server-side,
  // so this is at most one call per facts-version.
  useEffect(() => {
    if (horizons || hStatus === "loading") return;
    if (!todayReady && typeof tab !== "number") return;
    let active = true;
    setHStatus("loading");
    fetch(`/api/sessions/${sessionId}/recommendation/horizons`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("request failed"))))
      .then((d) => active && (setHorizons(d), setHStatus("idle")))
      .catch(() => active && setHStatus("error"));
    return () => { active = false; };
  }, [sessionId, horizons, hStatus, todayReady, tab]);

  const years = horizons?.horizons.map((h) => h.years) ?? [...HORIZON_REC.horizonsYears];
  const activeHorizon =
    typeof tab === "number" && horizons ? horizons.horizons.find((h) => h.years === tab) : undefined;

  const tabKeys: Tab[] = ["today", ...years];
  const onTabKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = tabKeys.indexOf(tab);
    let next = i;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % tabKeys.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + tabKeys.length) % tabKeys.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabKeys.length - 1;
    else return;
    e.preventDefault();
    const nt = tabKeys[next];
    setTab(nt);
    document.getElementById(`tab-${nt}`)?.focus();
  };

  return (
    <div>
      <CriteriaPanel />

      <div
        role="tablist"
        aria-label="Recommendation horizon"
        onKeyDown={onTabKeyDown}
        className="mb-6 inline-flex gap-0.5 rounded-[10px] bg-[#eef2f5] p-1"
      >
        {tabKeys.map((t) => (
          <TabButton key={String(t)} tabKey={t} active={tab === t} onSelect={() => setTab(t)}>
            {t === "today" ? "Today" : `${t} years`}
          </TabButton>
        ))}
      </div>

      {/* Kept mounted (hidden when inactive) so its on-mount audit POST fires once. */}
      <div role="tabpanel" id="panel-today" aria-labelledby="tab-today" hidden={tab !== "today"}>
        <RecommendationView sessionId={sessionId} onLoaded={() => setTodayReady(true)} />
      </div>

      {typeof tab === "number" && (
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0}>
          {hStatus === "loading" && !horizons && (
            <div className="flex items-center gap-2.5 text-sm text-slate-500">
              <Spinner /> Projecting the member&apos;s future and re-ranking the plans with AI… (~40s)
            </div>
          )}
          {hStatus === "error" && (
            <div className="flex items-center gap-3 text-sm text-rose-600">
              <span>Could not load the projection.</span>
              <button
                onClick={() => setHStatus("idle")}
                className="rounded-[7px] border border-slate-300 bg-white px-3 py-1.5 text-[12.5px] font-medium text-slate-700 hover:bg-slate-50"
              >
                Retry
              </button>
            </div>
          )}
          {horizons &&
            (activeHorizon ? (
              <HorizonPanel horizon={activeHorizon} todayName={horizons.todayTopPlanName} />
            ) : (
              <p className="text-sm text-slate-500">No data for this horizon.</p>
            ))}
        </div>
      )}
    </div>
  );
}

function TabButton({ tabKey, active, onSelect, children }: { tabKey: Tab; active: boolean; onSelect: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      id={`tab-${tabKey}`}
      aria-selected={active}
      aria-controls={`panel-${tabKey}`}
      tabIndex={active ? 0 : -1}
      onClick={onSelect}
      className="rounded-lg px-[18px] py-2 text-[13.5px] font-semibold"
      style={{ background: active ? "#ffffff" : "transparent", color: active ? "#0d6e6e" : "#64748b" }}
    >
      {children}
    </button>
  );
}

const LIKELIHOOD_STYLE: Record<Likelihood, string> = {
  low: "text-slate-400",
  moderate: "text-amber-500",
  high: "text-orange-500",
};

function HorizonPanel({ horizon: h, todayName }: { horizon: HorizonRec; todayName: string | null }) {
  const rec = h.recommended;
  const hasAssumptions = h.projection.conditions.length > 0 || h.projection.medications.length > 0;

  return (
    <div>
      {/* AI future projection for this horizon */}
      <section className="mb-6 rounded-[13px] border border-[#ddd6fe] bg-[#faf8ff] p-[22px]">
        <div className="mb-1.5 flex flex-wrap items-center gap-2.5">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-[7px] bg-violet-600 text-[13px] text-white">✦</span>
          <h3 className="m-0 text-[15px] font-semibold text-violet-900">{h.years}-year health projection</h3>
          <span className="rounded-md bg-violet-100 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[.03em] text-violet-700">
            AI · grounded in the member&apos;s facts
          </span>
        </div>
        {h.projection.headline && (
          <h4 className="m-0 mb-1.5 text-[15px] font-semibold leading-[1.35] text-[#1f1147]">{h.projection.headline}</h4>
        )}
        {h.projection.summary && (
          <p className="mb-3 text-[13px] leading-[1.6] text-[#3f3357]">{h.projection.summary}</p>
        )}
        {hasAssumptions && (
          <div className="flex flex-wrap gap-2">
            {h.projection.conditions.map((c) => (
              <span key={c.label} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">
                {c.label} <span className={LIKELIHOOD_STYLE[c.likelihood]}>· {c.likelihood} likelihood</span>
              </span>
            ))}
            {h.projection.medications.map((m) => (
              <span key={m.name} className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700">
                + {m.name} <span className={LIKELIHOOD_STYLE[m.likelihood]}>· {m.likelihood}</span>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Changes-vs-today banner */}
      {h.changedVsToday ? (
        <div className="mb-[18px] rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="mb-0.5 text-[13px] font-bold text-amber-800">⚑ Changes vs today</div>
          <div className="text-[12.5px] leading-[1.5] text-amber-700">
            As the member&apos;s health evolves, today&apos;s pick{todayName ? ` (${todayName})` : ""} is no longer the
            best fit at {h.years} years. {rec ? `${rec.plan.name} fits the projected member better.` : ""}
          </div>
        </div>
      ) : (
        <div className="mb-[18px] rounded-[10px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] font-semibold text-emerald-900">
          ✓ Same as today — the recommended plan still fits best at this horizon.
        </div>
      )}

      {!rec ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          No plan stays eligible for the projected member at {h.years} years.
        </div>
      ) : (
        <>
          {/* Hero */}
          <div className="mb-6 rounded-[13px] border border-accent bg-white p-6 shadow-hero">
            <div className="flex flex-wrap items-start gap-5">
              <div className="min-w-[220px] flex-1">
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.05em] text-accent">
                  Best fit at {h.years} years
                </div>
                <div className="mb-1 flex flex-wrap items-center gap-2.5">
                  <h3 className="text-xl font-semibold">{rec.plan.name}</h3>
                  <PlanKind snpType={rec.plan.snpType} />
                </div>
                <div className="text-[12.5px] text-slate-500">
                  {rec.plan.carrier} · {rec.plan.planType} · {premiumLabel(rec.plan.monthlyPremium)} ·{" "}
                  {usd(rec.plan.annualOOPMax)} OOP max
                </div>
              </div>
              <div className="flex-none text-right">
                <div className="num text-[38px] font-bold leading-none text-accent">{rec.total}</div>
                <div className="text-[11px] text-slate-400">fit score · {confLabel(rec.confidence)} confidence</div>
              </div>
            </div>

            {(() => {
              const positives = rec.reasons.filter((r) => r.positive);
              const cited = positives.filter((r) => r.citation);
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
                    <div className="grid grid-cols-2 content-start gap-2.5">
                      <HeroStat label="Est. / yr">{usd(rec.exposure.mean)}</HeroStat>
                      <HeroStat label="OOP max">{usd(rec.exposure.worst)}</HeroStat>
                      <HeroStat label="Meds covered">{pct(rec.exposure.medCoverageRate)}</HeroStat>
                      <HeroStat label="Catastrophic est.">{pct(rec.exposure.catastrophicRate)}</HeroStat>
                    </div>
                  </div>
                  {cited.length > 0 && <Sources cited={cited} />}
                </>
              );
            })()}
          </div>

          {/* Fit-score comparison across the projected candidates */}
          {h.distribution.length > 1 && (
            <>
              <div className="mb-3 text-xs font-bold uppercase tracking-[.04em] text-slate-500">
                Fit at {h.years} years
              </div>
              <div className="mb-6 flex flex-col gap-[11px] rounded-[11px] border border-slate-200 bg-white p-[18px]">
                {(() => {
                  const max = Math.max(...h.distribution.map((d) => d.fitScore), 1);
                  return h.distribution.map((d) => (
                    <div key={d.plan.id} className="flex items-center gap-3">
                      <span className="flex-[0_0_220px] truncate text-[12.5px] text-slate-700">{d.plan.name}</span>
                      <span className="h-[9px] flex-1 overflow-hidden rounded-full bg-slate-100">
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${Math.round((d.fitScore / max) * 100)}%`,
                            background: d.plan.id === rec.plan.id ? "#0d6e6e" : "#cbd5e1",
                          }}
                        />
                      </span>
                      <span className="num flex-[0_0_38px] text-right text-[12.5px] font-semibold text-slate-600">
                        {d.fitScore}
                      </span>
                    </div>
                  ));
                })()}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function HeroStat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase text-slate-400">{label}</div>
      <div className="num text-[15px] font-semibold">{children}</div>
    </div>
  );
}

const WEIGHT_DEFS: { key: keyof typeof SCORING.weights; label: string; def: string; sign: "+" | "−" }[] = [
  { key: "coverageFit", label: "Coverage fit", def: "OOP protection + acupuncture / mental-health / specialist cost matched to this member's needs", sign: "+" },
  { key: "networkFit", label: "Network fit", def: "required + likely-needed providers stay in network", sign: "+" },
  { key: "medicationFit", label: "Medication fit", def: "current + likely-future prescriptions covered", sign: "+" },
  { key: "mismatchPenalty", label: "Mismatch penalty", def: "expected coverage gaps + expected annual cost", sign: "−" },
  { key: "catastrophicDownside", label: "Catastrophic downside", def: "worst-case out-of-pocket exposure", sign: "−" },
];

/**
 * The scoring criteria. The AI assigns each eligible plan a 0–1 fit on each
 * dimension below, reasoning ONLY over the 2026 plan files, and the fit score is
 * those sub-scores × the published weights — so brokers read exactly the rubric
 * the recommendation is built on.
 */
function CriteriaPanel() {
  const W = SCORING.weights;
  return (
    <details className="mb-6 rounded-xl border border-slate-200 bg-white p-[18px]">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[13px] font-semibold text-ink">
        <span className="text-accent">ⓘ</span> How plans are scored — AI-powered, grounded in the 2026 plan files &amp; cited
      </summary>

      <div className="mt-3 space-y-4 text-[12.5px] leading-[1.55] text-slate-600">
        <div>
          <div className="mb-1 text-[11px] font-bold uppercase tracking-[.04em] text-slate-500">1 · Eligibility (hard rules, run before any scoring)</div>
          A plan is excluded — never ranked — if it fails any of: not sold in the member&apos;s region; doesn&apos;t
          keep a <strong>must-keep</strong> provider in network; or leaves a <strong>critical medication</strong>{" "}
          (insulin, oncology) off formulary. These are pass/fail facts read straight from the plan files.
        </div>

        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.04em] text-slate-500">2 · Fit score (AI scores eligible plans on the member&apos;s facts)</div>
          <div className="flex flex-col gap-1">
            {WEIGHT_DEFS.map((w) => (
              <div key={w.key} className="flex items-baseline gap-2">
                <span className="num flex-[0_0_44px] font-semibold" style={{ color: w.sign === "+" ? "#0d6e6e" : "#b45309" }}>
                  {w.sign}{W[w.key]}
                </span>
                <span><strong className="text-slate-700">{w.label}</strong> — {w.def}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[12px] text-slate-500">
            <span className="num">Fit = Coverage + Network + Medication − Mismatch − Catastrophic downside</span>.
            The AI reasons strictly over the benefits in the 2026 plan files; every bullet cites the source PDF +
            page, and a programmatic check drops any figure not present in the plan&apos;s data.
          </div>
        </div>

        <div className="rounded-lg border border-[#ccebe6] bg-[#f6fdfb] p-3 text-[12px] text-slate-600">
          <strong className="text-accent">No plan preference.</strong> Eligible plans are ranked purely on the fit
          score above. The tool applies <strong>no carrier or plan preference of any kind</strong> — the ranking is
          determined only by how each plan fits the member&apos;s captured facts, sourced from the plan files.
        </div>
      </div>
    </details>
  );
}
