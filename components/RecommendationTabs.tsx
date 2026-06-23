"use client";

import { useEffect, useState } from "react";
import RecommendationView from "./RecommendationView";
import { HORIZON_REC } from "@/lib/engine/config";

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

function tags(p: PlanMeta) {
  return (
    <span className="flex gap-1">
      {p.isScan && <Chip tone="emerald">SCAN</Chip>}
      {p.smgSupported && !p.isScan && <Chip tone="emerald">SMG</Chip>}
      {p.isCompetitor && <Chip tone="rose">competitor</Chip>}
    </span>
  );
}
function Chip({ tone, children }: { tone: "emerald" | "rose"; children: React.ReactNode }) {
  const cls = tone === "emerald" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-rose-50 text-rose-700 ring-rose-200";
  return <span className={`rounded px-1.5 py-0.5 text-[10px] ring-1 ${cls}`}>{children}</span>;
}

const CONFIDENCE_STYLE: Record<NarrativeHorizon["confidence"], string> = {
  low: "bg-slate-100 text-slate-600",
  moderate: "bg-amber-100 text-amber-700",
  high: "bg-emerald-100 text-emerald-700",
};

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
  // Guarded lookup — never assert; if a selected horizon isn't in the payload, render a fallback.
  const activeHorizon =
    typeof tab === "number" && horizons ? horizons.horizons.find((h) => h.years === tab) : undefined;

  return (
    <div className="space-y-6">
      <div role="tablist" aria-label="Recommendation horizon" className="inline-flex rounded-lg border border-slate-200 bg-white p-1 text-sm">
        <TabButton active={tab === "today"} onClick={() => setTab("today")}>Today</TabButton>
        {years.map((y) => (
          <TabButton key={y} active={tab === y} onClick={() => setTab(y)}>{y} years</TabButton>
        ))}
      </div>

      {/* Kept mounted (hidden when inactive) so its on-mount audit POST fires once,
          not on every return to this tab. */}
      <div role="tabpanel" hidden={tab !== "today"}>
        <RecommendationView sessionId={sessionId} />
      </div>

      {tab !== "today" && (
        <div role="tabpanel">
          {hStatus === "loading" && !horizons && (
            <p className="text-sm text-slate-500">
              Scoring the recommendation across simulated futures…
            </p>
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

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-md px-4 py-1.5 font-medium ${active ? "bg-accent text-white" : "text-slate-600 hover:bg-slate-50"}`}
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

  return (
    <div className="space-y-6">
      <p className="text-xs text-slate-400">
        Each of {h.replicas} simulated futures at {h.years} years scored across {h.scenarioCount} financial
        scenarios · deterministic · reproducible
      </p>

      {/* The recommended plan for this horizon */}
      {!rec ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          No plan stays eligible in most {h.years}-year futures
          {h.noneEligibleRate > 0 && ` (${pct(h.noneEligibleRate)} of futures had no eligible plan)`}.
        </div>
      ) : (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Recommended at {h.years} years
            </h2>
            {h.changedVsToday ? (
              <span className="rounded bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200">
                ⚑ changes vs today
              </span>
            ) : (
              <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                ✓ same as today
              </span>
            )}
          </div>

          <div className="rounded-lg border border-accent bg-white p-5 ring-1 ring-accent">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-ink">{rec.plan.name}</h3>
                  {tags(rec.plan)}
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  {rec.plan.carrier} · {rec.plan.planType} ·{" "}
                  {rec.plan.monthlyPremium === 0 ? "$0 premium" : usd(rec.plan.monthlyPremium) + "/mo"} ·{" "}
                  {usd(rec.plan.annualOOPMax)} OOP max
                </p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-semibold text-ink">{pct(rec.winShare)}</div>
                <div className="text-[11px] uppercase tracking-wide text-slate-400">of futures</div>
              </div>
            </div>

            <p className="mt-3 text-sm text-slate-700">
              {h.changedVsToday ? (
                <>
                  Today&apos;s pick is <span className="font-medium">{todayName ?? "—"}</span>, but as this client&apos;s
                  health evolves, <span className="font-medium">{rec.plan.name}</span> wins the most {h.years}-year
                  futures.
                </>
              ) : (
                <>Holds up as the client&apos;s health evolves — the same plan wins the most {h.years}-year futures.</>
              )}
            </p>

            {rec.reasons.filter((r) => r.positive).length > 0 && (
              <ul className="mt-3 space-y-1">
                {rec.reasons.filter((r) => r.positive).map((r) => (
                  <li key={r.code} className="flex items-start gap-2 text-sm text-slate-700">
                    <span className="text-emerald-600">✓</span> {r.text}
                  </li>
                ))}
              </ul>
            )}

            {rec.exposure && (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Stat label="Medications">{pct(rec.exposure.medCoverageRate)} covered</Stat>
                <Stat label="Worst case">
                  {usd(rec.exposure.worst)}
                  <span className="block text-xs text-slate-400">{pct(rec.exposure.catastrophicRate)} catastrophic</span>
                </Stat>
                <Stat label="Est. cost">{usd(rec.exposure.mean)}/yr</Stat>
              </div>
            )}

            {rec.reasons.filter((r) => !r.positive).length > 0 && (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Tradeoffs</span>
                {rec.reasons.filter((r) => !r.positive).map((r) => (
                  <div key={r.code} className="mt-1 flex items-start gap-2 text-sm text-amber-700">
                    <span>⚑</span> {r.text}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Win-share distribution across futures */}
          {h.distribution.length > 1 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                How the {h.replicas} futures split
              </h3>
              <div className="space-y-2">
                {h.distribution.map((d) => (
                  <div key={d.plan.id} className="flex items-center gap-3">
                    <span className="w-56 shrink-0 truncate text-sm text-slate-700">{d.plan.name}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <span className="block h-full bg-accent" style={{ width: `${Math.round(d.share * 100)}%` }} />
                    </span>
                    <span className="w-10 shrink-0 text-right text-xs tabular-nums text-slate-500">{pct(d.share)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* What the futures assumed had changed clinically */}
      {(h.projectedAssumptions.conditions.length > 0 || h.projectedAssumptions.medications.length > 0) && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            What the futures assumed by year {h.years}
          </h3>
          <p className="mb-2 text-xs text-slate-400">
            Newly-acquired facts, by how often they appeared across the simulated futures.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {h.projectedAssumptions.conditions.map((c) => (
              <span key={c.label} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                {c.label} <span className="text-slate-400">{pct(c.incidence)}</span>
              </span>
            ))}
            {h.projectedAssumptions.medications.map((m) => (
              <span key={m.name} className="rounded bg-sky-50 px-2 py-0.5 text-xs text-sky-700">
                + {m.name} <span className="text-sky-400">{pct(m.incidence)}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {/* AI narrative for this horizon (shared across tabs, on-demand) */}
      <NarrativePanel years={h.years} {...narrative} />
    </div>
  );
}

function NarrativePanel({ years, status, error, horizon, overallCaveat, onGenerate }: NarrativeProps & { years: number }) {
  return (
    <section className="rounded-lg border border-violet-100 bg-violet-50/40 p-4">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-ink">Why the future looks this way</h3>
        <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-violet-700">
          AI
        </span>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Claude interprets the same simulation into a plain-language {years}-year outlook. Interpretive only — it
        doesn&apos;t produce the recommendation above or enter the audit record.
      </p>

      {status === "idle" && (
        <button onClick={onGenerate} className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
          Generate narrative
        </button>
      )}
      {status === "loading" && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-violet-400" />
          Reasoning over the simulation…
        </div>
      )}
      {status === "error" && error && (
        <div className="rounded-md border border-rose-100 bg-rose-50 p-3 text-sm text-rose-700">
          {error.notConfigured ? <><span className="font-medium">Not enabled.</span> {error.message}</> : <>Couldn&apos;t generate: {error.message}</>}
          <button onClick={onGenerate} className="ml-2 underline hover:no-underline">retry</button>
        </div>
      )}
      {status === "done" && !horizon && (
        <p className="text-sm text-slate-500">No narrative available for this horizon.</p>
      )}
      {status === "done" && horizon && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-800">{horizon.headline}</span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${CONFIDENCE_STYLE[horizon.confidence]}`}>
              {horizon.confidence} confidence
            </span>
          </div>
          <p className="text-sm text-slate-600">{horizon.narrative}</p>
          <ul className="space-y-1">
            {horizon.watchItems.map((w, i) => (
              <li key={i} className="text-sm text-slate-700">
                <span className="font-medium">{w.event}</span> — {w.rationale}
                <span className="mt-0.5 block text-xs text-slate-400">grounded in: {w.groundedIn}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-slate-600">
            <span className="font-medium text-slate-700">Care outlook:</span> {horizon.careOutlook}
          </p>
          {overallCaveat && <p className="border-t border-violet-100 pt-2 text-xs italic text-slate-400">{overallCaveat}</p>}
        </div>
      )}
    </section>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-ink">{children}</div>
    </div>
  );
}
