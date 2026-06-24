"use client";

import { useEffect, useState } from "react";
import RecommendationView from "./RecommendationView";
import { HORIZON_REC } from "@/lib/engine/config";
import Spinner from "@/components/ui/Spinner";

// ── Shapes returned by the routes ───────────────────────────────────────────
interface PlanMeta {
  id: string; name: string; carrier: string; planType: string;
  smgSupported: boolean; isScan: boolean; isCompetitor: boolean;
  monthlyPremium: number; annualOOPMax: number;
}
interface Reason { code: string; text: string; positive: boolean }
interface Exposure {
  mean: number; worst: number; medCoverageRate: number; catastrophicRate: number;
  topUncoveredDrugs: { name: string; rate: number }[];
}
interface HorizonRec {
  years: number; replicas: number; scenarioCount: number;
  winShare: number; noneEligibleRate: number; changedVsToday: boolean;
  recommended: { plan: PlanMeta; winShare: number; reasons: Reason[]; exposure: Exposure | null } | null;
  distribution: { plan: PlanMeta; share: number }[];
  projectedAssumptions: { conditions: { label: string; incidence: number }[]; medications: { name: string; incidence: number }[] };
}
interface HorizonsData { todayTopPlanId: string | null; todayTopPlanName: string | null; horizons: HorizonRec[] }

interface NarrativeWatch { event: string; rationale: string; groundedIn: string }
interface NarrativeHorizon {
  years: number; headline: string; narrative: string; watchItems: NarrativeWatch[];
  careOutlook: string; planConsiderations: string[]; confidence: "low" | "moderate" | "high";
}
interface NarrativeData { overallCaveat: string; horizons: NarrativeHorizon[] }

const usd = (n: number) => "$" + n.toLocaleString();
const pct = (n: number) => Math.round(n * 100) + "%";
const premiumLabel = (n: number) => (n === 0 ? "$0/mo" : "$" + n + "/mo");

type Tab = "today" | number;

export default function RecommendationTabs({ sessionId }: { sessionId: string }) {
  const [tab, setTab] = useState<Tab>("today");
  const [horizons, setHorizons] = useState<HorizonsData | null>(null);
  const [hStatus, setHStatus] = useState<"idle" | "loading" | "error">("idle");

  // The AI narrative covers BOTH horizons in one call, so fetch it once here and
  // share it across the horizon tabs rather than calling the LLM per tab.
  const [narrative, setNarrative] = useState<NarrativeData | null>(null);
  const [nStatus, setNStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [nError, setNError] = useState<{ message: string; notConfigured: boolean } | null>(null);

  const generateNarrative = async () => {
    setNStatus("loading");
    setNError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/health-future/projection`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) {
        setNError({ message: d.detail ?? d.error ?? "Projection failed.", notConfigured: res.status === 503 });
        setNStatus("error");
        return;
      }
      setNarrative(d.projection as NarrativeData);
      setNStatus("done");
    } catch (e) {
      setNError({ message: (e as Error).message, notConfigured: false });
      setNStatus("error");
    }
  };

  // Lazy-load the deterministic across-futures recommendation when a horizon tab
  // is first opened (it's a heavier nested simulation; no need on the Today tab).
  useEffect(() => {
    if (tab === "today" || horizons || hStatus === "loading") return;
    let active = true;
    setHStatus("loading");
    fetch(`/api/sessions/${sessionId}/recommendation/horizons`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("request failed"))))
      .then((d) => active && (setHorizons(d), setHStatus("idle")))
      .catch(() => active && setHStatus("error"));
    return () => { active = false; };
  }, [tab, sessionId, horizons, hStatus]);

  // Default tabs come from config (not a hardcoded [5,10]) until the data lands.
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
        <RecommendationView sessionId={sessionId} />
      </div>

      {typeof tab === "number" && (
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0}>
          {hStatus === "loading" && !horizons && (
            <div className="flex items-center gap-2.5 text-sm text-slate-500">
              <Spinner /> Scoring the recommendation across simulated futures…
            </div>
          )}
          {hStatus === "error" && (
            <p className="text-sm text-rose-600">Could not load the horizon recommendation.</p>
          )}
          {horizons &&
            (activeHorizon ? (
              <HorizonPanel
                horizon={activeHorizon}
                todayName={horizons.todayTopPlanName}
                narrative={{
                  status: nStatus,
                  error: nError,
                  horizon: narrative?.horizons.find((h) => h.years === tab),
                  overallCaveat: narrative?.overallCaveat,
                  onGenerate: generateNarrative,
                }}
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

interface NarrativeProps {
  status: "idle" | "loading" | "done" | "error";
  error: { message: string; notConfigured: boolean } | null;
  horizon: NarrativeHorizon | undefined;
  overallCaveat: string | undefined;
  onGenerate: () => void;
}

function HorizonPanel({ horizon: h, todayName, narrative }: { horizon: HorizonRec; todayName: string | null; narrative: NarrativeProps }) {
  const rec = h.recommended;
  const hasAssumptions =
    h.projectedAssumptions.conditions.length > 0 || h.projectedAssumptions.medications.length > 0;

  return (
    <div>
      {/* Changes-vs-today banner */}
      {h.changedVsToday ? (
        <div className="mb-[18px] rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="mb-0.5 text-[13px] font-bold text-amber-800">⚑ Changes vs today</div>
          <div className="text-[12.5px] leading-[1.5] text-amber-700">
            Today&apos;s pick{todayName ? ` (${todayName})` : ""} wins fewer {h.years}-year futures as the
            client&apos;s health evolves. {rec ? `${rec.plan.name} wins the most futures at this horizon.` : ""}
          </div>
        </div>
      ) : (
        <div className="mb-[18px] rounded-[10px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] font-semibold text-emerald-900">
          ✓ Same as today — the recommended plan still wins the most simulated futures at this horizon.
        </div>
      )}

      {!rec ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          No plan stays eligible in most {h.years}-year futures
          {h.noneEligibleRate > 0 && ` (${pct(h.noneEligibleRate)} of futures had no eligible plan)`}.
        </div>
      ) : (
        <>
          {/* Hero */}
          <div className="mb-6 rounded-[13px] border border-accent bg-white p-6 shadow-hero">
            <div className="flex flex-wrap items-start gap-5">
              <div className="min-w-[220px] flex-1">
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.05em] text-accent">
                  Wins the most {h.years}-year futures
                </div>
                <h3 className="mb-1 text-xl font-semibold">{rec.plan.name}</h3>
                <div className="text-[12.5px] text-slate-500">
                  {rec.plan.carrier} · {rec.plan.planType} · {premiumLabel(rec.plan.monthlyPremium)} ·{" "}
                  {usd(rec.plan.annualOOPMax)} OOP max
                </div>
              </div>
              <div className="flex-none text-right">
                <div className="num text-[38px] font-bold leading-none text-accent">{pct(rec.winShare)}</div>
                <div className="text-[11px] text-slate-400">
                  of <span className="num">{h.replicas}</span> futures
                </div>
              </div>
            </div>

            <div className="my-4 grid grid-cols-2 gap-x-6 gap-y-2">
              <div>
                {rec.reasons.filter((r) => r.positive).map((r) => (
                  <div key={r.code} className="mb-[5px] flex gap-2 text-[12.5px] leading-[1.45] text-slate-700">
                    <span className="flex-none text-emerald-600">✓</span>
                    {r.text}
                  </div>
                ))}
              </div>
              {rec.exposure && (
                <div className="grid grid-cols-2 content-start gap-2.5">
                  <HeroStat label="Mean / yr">{usd(rec.exposure.mean)}</HeroStat>
                  <HeroStat label="Worst / yr">{usd(rec.exposure.worst)}</HeroStat>
                  <HeroStat label="Meds covered">{pct(rec.exposure.medCoverageRate)}</HeroStat>
                  <HeroStat label="Catastrophic">{pct(rec.exposure.catastrophicRate)}</HeroStat>
                </div>
              )}
            </div>
          </div>

          {/* Win-share distribution */}
          {h.distribution.length > 1 && (
            <>
              <div className="mb-3 text-xs font-bold uppercase tracking-[.04em] text-slate-500">
                Win-share distribution
              </div>
              <div className="mb-6 flex flex-col gap-[11px] rounded-[11px] border border-slate-200 bg-white p-[18px]">
                {h.distribution.map((d) => (
                  <div key={d.plan.id} className="flex items-center gap-3">
                    <span className="flex-[0_0_220px] truncate text-[12.5px] text-slate-700">{d.plan.name}</span>
                    <span className="h-[9px] flex-1 overflow-hidden rounded-full bg-slate-100">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${Math.round(d.share * 100)}%`,
                          background: d.plan.id === rec.plan.id ? "#0d6e6e" : "#cbd5e1",
                        }}
                      />
                    </span>
                    <span className="num flex-[0_0_38px] text-right text-[12.5px] font-semibold text-slate-600">
                      {pct(d.share)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* Assumptions */}
      {hasAssumptions && (
        <>
          <div className="mb-2.5 text-xs font-bold uppercase tracking-[.04em] text-slate-500">
            What the futures assumed by year {h.years}
          </div>
          <div className="mb-7 flex flex-wrap gap-2">
            {h.projectedAssumptions.conditions.map((c) => (
              <span
                key={c.label}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600"
              >
                {c.label} <span className="text-slate-400">{pct(c.incidence)}</span>
              </span>
            ))}
            {h.projectedAssumptions.medications.map((m) => (
              <span
                key={m.name}
                className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700"
              >
                + {m.name} <span className="text-sky-400">{pct(m.incidence)}</span>
              </span>
            ))}
          </div>
        </>
      )}

      {/* AI narrative */}
      <NarrativePanel years={h.years} {...narrative} />
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

function NarrativePanel({ years, status, error, horizon, overallCaveat, onGenerate }: NarrativeProps & { years: number }) {
  return (
    <section className="rounded-[13px] border border-[#ddd6fe] bg-[#faf8ff] p-[22px]">
      <div className="mb-1.5 flex items-center gap-2.5">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-[7px] bg-violet-600 text-[13px] text-white">
          ✦
        </span>
        <h3 className="m-0 text-[15px] font-semibold text-violet-900">AI health-future narrative</h3>
        <span className="rounded-md bg-violet-100 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[.03em] text-violet-700">
          Interpretive
        </span>
      </div>
      <p className="mb-4 text-[12.5px] leading-[1.5] text-violet-400">
        Generated from the simulation distribution. It adds context only — it never changes the deterministic
        recommendation or scores above.
      </p>

      {status === "idle" && (
        <button
          onClick={onGenerate}
          className="rounded-[9px] bg-violet-600 px-5 py-[11px] text-[13.5px] font-semibold text-white hover:opacity-90"
        >
          ✦ Generate narrative
        </button>
      )}
      {status === "loading" && (
        <div className="flex items-center gap-2.5 text-[13.5px] font-medium text-violet-700">
          <span
            className="inline-block h-4 w-4 rounded-full"
            style={{ border: "2px solid #ddd6fe", borderTopColor: "#7c3aed", animation: "spin .7s linear infinite" }}
          />
          Reasoning over the simulation…
        </div>
      )}
      {status === "error" && error && (
        <div>
          {error.notConfigured ? (
            <div className="rounded-[9px] border border-[#ddd6fe] bg-violet-50 px-3.5 py-3 text-[12.5px] text-violet-900">
              The AI narrative is not enabled for this account. {error.message}
            </div>
          ) : (
            <>
              <div className="mb-3 rounded-[9px] border border-rose-200 bg-rose-50 px-3.5 py-3 text-[12.5px] text-rose-700">
                The model call didn&apos;t complete: {error.message}
              </div>
              <button
                onClick={onGenerate}
                className="rounded-[9px] bg-violet-600 px-[18px] py-2.5 text-[13px] font-semibold text-white"
              >
                Retry
              </button>
            </>
          )}
        </div>
      )}
      {status === "done" && !horizon && (
        <p className="text-sm text-slate-500">No narrative available for this horizon.</p>
      )}
      {status === "done" && horizon && (
        <div data-fade>
          <div className="mb-3 flex items-start gap-2.5">
            <h4 className="m-0 flex-1 text-[15px] font-semibold leading-[1.35] text-[#1f1147]">{horizon.headline}</h4>
            <span className="flex-none whitespace-nowrap rounded-md bg-violet-100 px-2.5 py-[3px] text-[11px] font-semibold text-violet-700">
              {horizon.confidence} confidence
            </span>
          </div>
          <p className="mb-4 text-[13px] leading-[1.6] text-[#3f3357]">{horizon.narrative}</p>

          {horizon.watchItems.length > 0 && (
            <>
              <div className="mb-2 text-[11px] font-bold uppercase tracking-[.04em] text-violet-400">Watch items</div>
              <div className="mb-4 flex flex-col gap-2">
                {horizon.watchItems.map((w, i) => (
                  <div key={i} className="rounded-[9px] border border-violet-100 bg-white px-3.5 py-[11px]">
                    <div className="mb-0.5 text-[13px] font-semibold text-[#1f1147]">{w.event}</div>
                    <div className="text-xs leading-[1.45] text-violet-400">
                      {w.rationale} <span className="font-semibold">Grounding:</span> {w.groundedIn}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="rounded-[9px] border border-violet-100 bg-white px-3.5 py-3">
            <div className="mb-1 text-[11px] font-bold uppercase text-violet-400">Care outlook</div>
            <div className="text-[12.5px] leading-[1.5] text-[#3f3357]">{horizon.careOutlook}</div>
          </div>

          {overallCaveat && (
            <p className="mt-3.5 text-[11px] italic leading-[1.5] text-[#a99fc4]">{overallCaveat}</p>
          )}
        </div>
      )}
    </section>
  );
}
