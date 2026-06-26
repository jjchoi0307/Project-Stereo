"use client";

import { useEffect, useState } from "react";
import RecommendationView, { TopCard, RecommendationLoading, OtherEligibleTable, type RankedItem } from "./RecommendationView";
import { HORIZON_REC, SCORING } from "@/lib/engine/config";

// ── Shapes returned by the AI horizon route ──────────────────────────────────
interface PlanMeta {
  id: string; name: string; carrier: string; planType: string; snpType?: string;
  smgSupported: boolean; isScan: boolean; isCompetitor: boolean;
  monthlyPremium: number; annualOOPMax: number;
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
  // Full-detail top-3, shaped exactly like the Today recommendation.
  recommended: RankedItem | null;
  ranked: RankedItem[];
  distribution: { plan: PlanMeta; fitScore: number }[];
}
interface HorizonsData {
  model?: string; todayTopPlanId: string | null; todayTopPlanName: string | null; horizons: HorizonRec[];
}

type Tab = "today" | number;

export default function RecommendationTabs({ sessionId }: { sessionId: string }) {
  const [tab, setTab] = useState<Tab>("today");
  const [horizons, setHorizons] = useState<HorizonsData | null>(null);
  const [hStatus, setHStatus] = useState<"idle" | "loading" | "error">("idle");
  const [today, setToday] = useState<{ topPlanId: string | null; topPlanName: string | null; topIds: string[] } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Load the across-horizon recommendation IN PARALLEL with Today, on mount.
  // Measured end-to-end (realistic 33-eligible-plan profile): Today + both horizons
  // running concurrently finish in ~35s with no rate-limit errors, vs ~72s when the
  // horizons wait for Today. The horizons reuse Today's exact pipeline on the
  // projected profile, and "changes vs today" is computed client-side (below), so
  // there's no ordering dependency. Cached server-side → one compute per facts-version.
  useEffect(() => {
    if (horizons || hStatus === "loading") return;
    let active = true;
    setHStatus("loading");
    fetch(`/api/sessions/${sessionId}/recommendation/horizons`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("request failed"))))
      .then((d) => active && (setHorizons(d), setHStatus("idle")))
      .catch(() => active && setHStatus("error"));
    return () => { active = false; };
  }, [sessionId, reloadKey]);

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
        <RecommendationView sessionId={sessionId} onLoaded={setToday} />
      </div>

      {typeof tab === "number" && (
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0}>
          {hStatus !== "error" && !horizons && (
            <RecommendationLoading
              title={`Looking ${tab} years ahead…`}
              subtitle={`Projecting how the member's health is likely to change over ${tab} years, then finding the best-fit plans for that future. (~30–45s)`}
              steps={[
                `Projecting the member's health in ${tab} years`,
                "Finding & scoring the best-fit plans",
                "Writing the details & citations",
              ]}
            />
          )}
          {hStatus === "error" && (
            <div className="flex items-center gap-3 text-sm text-rose-600">
              <span>Could not load the projection.</span>
              <button
                onClick={() => setReloadKey((k) => k + 1)}
                className="rounded-[7px] border border-slate-300 bg-white px-3 py-1.5 text-[12.5px] font-medium text-slate-700 hover:bg-slate-50"
              >
                Retry
              </button>
            </div>
          )}
          {horizons &&
            (activeHorizon ? (
              <HorizonPanel
                horizon={activeHorizon}
                // Lineup-aware comparison vs Today, computed client-side (the
                // horizon loads in parallel with Today, so no ordering dependency).
                status={lineupStatus(activeHorizon, today)}
                todayName={today?.topPlanName ?? horizons.todayTopPlanName}
              />
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

type LineupStatus = "same" | "reordered" | "changed";

/**
 * Compare the horizon's top-3 plan lineup to Today's, so the banner is ACCURATE:
 *  - "changed"   — a different plan is the #1 best fit at this horizon
 *  - "reordered" — same #1, but the rest of the top-3 shifts as health evolves
 *  - "same"      — the same three plans, in the same lead
 * Falls back to a lead-only comparison until Today's lineup has loaded.
 */
function lineupStatus(h: HorizonRec, today: { topPlanId: string | null; topIds: string[] } | null): LineupStatus {
  const lead = h.recommended?.planId ?? null;
  if (!today) return h.changedVsToday ? "changed" : "same";
  if (lead && today.topPlanId && lead !== today.topPlanId) return "changed";
  const hIds = h.ranked.slice(0, 3).map((r) => r.planId);
  const tIds = today.topIds ?? [];
  const sameSet = tIds.length > 0 && hIds.length === tIds.length && tIds.every((id) => hIds.includes(id));
  return sameSet ? "same" : "reordered";
}

function HorizonPanel({ horizon: h, status, todayName }: { horizon: HorizonRec; status: LineupStatus; todayName: string | null }) {
  const rec = h.recommended;
  const ranked = h.ranked ?? [];
  const top = ranked.slice(0, 3);
  const rest = ranked.slice(3);
  const [showChanges, setShowChanges] = useState(false);
  const hasAssumptions = h.projection.conditions.length > 0 || h.projection.medications.length > 0;

  return (
    <div>
      {/* AI future projection — simple on the surface (headline + summary); the
          specific projected conditions/medications live behind a toggle. */}
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
          <p className="m-0 text-[13px] leading-[1.6] text-[#3f3357]">{h.projection.summary}</p>
        )}
        {hasAssumptions && (
          <>
            <button
              type="button"
              onClick={() => setShowChanges((v) => !v)}
              aria-expanded={showChanges}
              className="mt-3 flex items-center gap-1.5 text-[12.5px] font-semibold text-violet-700"
            >
              <span className="text-[10px]">{showChanges ? "▾" : "▸"}</span>
              {showChanges ? "Hide the projected changes" : "See the projected conditions & medications"}
            </button>
            {showChanges && (
              <div className="mt-3 flex flex-wrap gap-2">
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
          </>
        )}
      </section>

      {/* Changes-vs-today banner — accurate to the whole top-3 lineup, not just #1. */}
      {status === "changed" ? (
        <div className="mb-[18px] rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="mb-0.5 text-[13px] font-bold text-amber-800">⚑ Best fit changes at {h.years} years</div>
          <div className="text-[12.5px] leading-[1.5] text-amber-700">
            As the member&apos;s health evolves, today&apos;s pick{todayName ? ` (${todayName})` : ""} is no longer the
            best fit. {rec ? `${rec.plan.name} fits the projected member better.` : ""}
          </div>
        </div>
      ) : status === "reordered" ? (
        <div className="mb-[18px] rounded-[10px] border border-sky-200 bg-sky-50 px-4 py-3">
          <div className="mb-0.5 text-[13px] font-bold text-sky-800">↻ Same lead plan, different runner-ups</div>
          <div className="text-[12.5px] leading-[1.5] text-sky-700">
            {todayName ? `${todayName} ` : "Today's pick "}is still the best fit at {h.years} years, but the other
            plans in the top 3 shift as the member&apos;s projected needs change.
          </div>
        </div>
      ) : (
        <div className="mb-[18px] rounded-[10px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] font-semibold text-emerald-900">
          ✓ Same as today — the same plans fit best at this horizon.
        </div>
      )}

      {!rec || top.length === 0 ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          No plan stays eligible for the projected member at {h.years} years.
        </div>
      ) : (
        <>
          <div className="mb-3 text-xs font-bold uppercase tracking-[.04em] text-slate-500">
            Best fit at {h.years} years — full detail for each pick
          </div>
          {/* Same full-detail cards as Today: fit-score breakdown, "includes",
              sources & cost all live behind each card's drill-down. */}
          <div className="mb-7 flex flex-col gap-5">
            {top.map((item, i) => (
              <TopCard key={item.planId} item={item} rank={i + 1} highlight={i === 0} />
            ))}
          </div>
          {/* The rest of the eligible plans, ranked — same as Today. */}
          {rest.length > 0 && <OtherEligibleTable rest={rest} />}
        </>
      )}
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
