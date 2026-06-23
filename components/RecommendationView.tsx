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
interface RankedItem {
  planId: string; expectedFit: number; downsideRisk: number; confidence: number;
  preferenceContribution: number; total: number; reasons: Reason[];
  plan: PlanMeta; exposure: Exposure; providerGaps?: string[];
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
const pct = (n: number) => Math.round(n * 100) + "%";
const confLabel = (c: number) => (c >= 66 ? "High" : c >= 33 ? "Moderate" : "Low");

function tags(plan: PlanMeta) {
  return (
    <span className="flex gap-1">
      {plan.isScan && <Chip tone="emerald">SCAN</Chip>}
      {plan.smgSupported && !plan.isScan && <Chip tone="emerald">SMG</Chip>}
      {plan.isCompetitor && <Chip tone="rose">competitor</Chip>}
    </span>
  );
}

function fitSummary(item: RankedItem): string {
  const positives = item.reasons.filter((r) => r.positive);
  if (positives.length) return positives.slice(0, 2).map((r) => r.text).join(" ");
  return "Eligible for this client, with the tradeoffs noted below.";
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
      .then((r) => r.json())
      .then((d) => active && setData(d))
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
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-400">
          {data.scenarioCount} seeded scenarios · seed {data.seed} · reproducible
        </p>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500">Preference weighting</span>
          <div className="inline-flex overflow-hidden rounded-md border border-slate-300">
            <button onClick={() => setPreference(true)}
              className={`px-3 py-1 ${preference ? "bg-accent text-white" : "bg-white text-slate-600"}`}>On</button>
            <button onClick={() => setPreference(false)}
              className={`px-3 py-1 ${!preference ? "bg-accent text-white" : "bg-white text-slate-600"}`}>Off (pure fit)</button>
          </div>
        </div>
      </div>

      {data.preferenceWeightingEnabled && data.preferenceChangedTop && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          ⚑ Preference weighting changed the top pick versus the pure-fit ranking. Toggle to “Off” to compare.
        </div>
      )}

      {/* No eligible plan — explain why, then offer the closest near-misses. */}
      {noneEligible && (
        <section className="space-y-4">
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3">
            <h2 className="text-sm font-semibold text-rose-800">No plan matches every hard requirement</h2>
            {nm ? (
              <p className="mt-1 text-sm text-rose-700">
                {nm.requiredProviders.length > 1
                  ? `No single plan in ${nm.regionName} keeps all of these must-keep providers in network: ${nm.requiredProviders.join(", ")}. They don't share a plan network.`
                  : `No plan in ${nm.regionName} keeps ${nm.requiredProviders[0] ?? "the required provider"} in network.`}{" "}
                The closest plans are below — each shows which required provider it would <strong>drop</strong>, so you can decide with the client which requirement can flex.
              </p>
            ) : (
              <p className="mt-1 text-sm text-rose-700">
                Every plan was excluded for this profile (see “Not recommended” below for the specific reason on each). Try widening the market region or relaxing a hard requirement.
              </p>
            )}
          </div>

          {nm && nm.ranked.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Closest plans · if a provider requirement can flex
              </h2>
              {nm.ranked.slice(0, 3).map((item, i) => (
                <TopCard key={item.planId} item={item} rank={i + 1} highlight={false} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Top recommendations */}
      {!noneEligible && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Recommended {top.length > 1 ? `· top ${top.length}` : ""}
          </h2>
          {top.map((item, i) => (
            <TopCard key={item.planId} item={item} rank={i + 1} highlight={i === 0} />
          ))}
        </section>
      )}

      {/* Comparison of the rest (still eligible) */}
      {rest.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Other eligible plans
          </h2>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Plan</th>
                  <th className="px-3 py-2 text-right font-medium">Score</th>
                  <th className="px-3 py-2 text-right font-medium">Meds</th>
                  <th className="px-3 py-2 text-right font-medium">Worst / yr</th>
                  <th className="px-3 py-2 font-medium">Main caveat</th>
                </tr>
              </thead>
              <tbody>
                {rest.map((item) => {
                  const caveat = item.reasons.find((r) => !r.positive);
                  return (
                    <tr key={item.planId} className="border-t border-slate-100 align-top">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-ink">{item.plan.name}</span>
                          {tags(item.plan)}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{item.total}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{pct(item.exposure.medCoverageRate)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">{usd(item.exposure.worst)}</td>
                      <td className="px-3 py-2 text-xs text-amber-700">{caveat?.text ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Stress-test (scenario perturbation) */}
      {scenarios && scenarios.scenarios.length > 0 && <ScenarioPanel data={scenarios} />}

      {/* Not recommended */}
      {data.excluded.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Not recommended for this profile
          </h2>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {data.excluded.map(({ plan, reasons }) => (
              <li key={plan.id} className="flex items-start justify-between gap-3 px-3 py-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-500">{plan.name}</span>
                    {tags(plan)}
                  </div>
                  {reasons.map((r, i) => (
                    <div key={i} className="mt-0.5 text-xs text-rose-600">✗ {r.detail}</div>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex items-center justify-between border-t border-slate-100 pt-4">
        <Link href={`/session/${sessionId}`} className="text-sm text-accent hover:underline">
          ← Back to session facts
        </Link>
        {auditId && (
          <span className="text-xs text-slate-500">
            Audit record saved ·{" "}
            <Link href={`/audit/${auditId}`} className="font-mono text-accent hover:underline">
              {auditId}
            </Link>
          </span>
        )}
      </div>
    </div>
  );
}

function ScenarioPanel({ data }: { data: ScenarioData }) {
  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Stress-test this recommendation
      </h2>
      <p className="mb-2 text-xs text-slate-400">
        How the pick holds up if the client&apos;s situation changes. Baseline top:{" "}
        <span className="font-medium text-ink">{data.baseline.topPlanName ?? "— none eligible"}</span>
      </p>
      <ul className="space-y-2">
        {data.scenarios.map((s) => {
          const bt = s.baselineTop;
          const baselineFate =
            bt.rankUnderScenario == null
              ? `${bt.planName ?? "baseline pick"} becomes ineligible`
              : bt.rankUnderScenario === 1
                ? `${bt.planName ?? "baseline pick"} stays #1`
                : `${bt.planName ?? "baseline pick"} falls to #${bt.rankUnderScenario}`;
          return (
            <li key={s.id} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-ink">{s.label}</div>
                  <div className="mt-0.5 text-xs text-slate-500">{s.description}</div>
                </div>
                {s.changed ? (
                  <span className="shrink-0 rounded bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200">
                    ⚑ top pick changes
                  </span>
                ) : (
                  <span className="shrink-0 rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                    ✓ holds
                  </span>
                )}
              </div>
              <div className="mt-2 text-sm text-slate-700">
                {s.changed ? (
                  <>New top plan: <span className="font-medium text-ink">{s.topPlanName ?? "— none eligible"}</span>. </>
                ) : (
                  <>Top plan unchanged. </>
                )}
                <span className="text-slate-500">{baselineFate}.</span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function TopCard({ item, rank, highlight }: { item: RankedItem; rank: number; highlight: boolean }) {
  const positives = item.reasons.filter((r) => r.positive);
  const caveats = item.reasons.filter((r) => !r.positive);
  const e = item.exposure;
  const keepsProviders = item.reasons.some((r) => r.code === "keeps_required_providers");
  const networkGap = item.reasons.some((r) => r.code === "network_gap_risk");

  return (
    <div className={`rounded-lg border bg-white p-5 ${highlight ? "border-accent ring-1 ring-accent" : "border-slate-200"}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
              {rank}
            </span>
            <h3 className="text-base font-semibold text-ink">{item.plan.name}</h3>
            {tags(item.plan)}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {item.plan.carrier} · {item.plan.planType} · {item.plan.monthlyPremium === 0 ? "$0 premium" : usd(item.plan.monthlyPremium) + "/mo"} · {usd(item.plan.annualOOPMax)} OOP max
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold text-ink">{item.total}</div>
          <div className="text-[11px] uppercase tracking-wide text-slate-400">fit score</div>
        </div>
      </div>

      {item.providerGaps && item.providerGaps.length > 0 && (
        <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          ✗ Drops required provider: <strong>{item.providerGaps.join(", ")}</strong>
        </div>
      )}

      <p className="mt-3 text-sm text-slate-700">{fitSummary(item)}</p>

      {positives.length > 0 && (
        <ul className="mt-3 space-y-1">
          {positives.map((r) => (
            <li key={r.code} className="flex items-start gap-2 text-sm text-slate-700">
              <span className="text-emerald-600">✓</span> {r.text}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Medications">
          {pct(e.medCoverageRate)} covered
          {e.topUncoveredDrugs.length > 0 && (
            <span className="block text-xs text-amber-700">gap: {e.topUncoveredDrugs[0].name}</span>
          )}
        </Stat>
        <Stat label="Network">
          {networkGap ? <span className="text-amber-700">gap risk</span> : keepsProviders ? "keeps required" : "in network"}
        </Stat>
        <Stat label="Worst case">
          {usd(e.worst)}
          <span className="block text-xs text-slate-400">{pct(e.catastrophicRate)} catastrophic</span>
        </Stat>
        <Stat label="Confidence">
          {confLabel(item.confidence)}
          <span className="block text-xs text-slate-400">est. {usd(e.mean)}/yr</span>
        </Stat>
      </div>

      {caveats.length > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Tradeoffs</span>
          {caveats.map((r) => (
            <div key={r.code} className="mt-1 flex items-start gap-2 text-sm text-amber-700">
              <span>⚑</span> {r.text}
            </div>
          ))}
        </div>
      )}
    </div>
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

function Chip({ tone, children }: { tone: "emerald" | "rose"; children: React.ReactNode }) {
  const cls = tone === "emerald" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-rose-50 text-rose-700 ring-rose-200";
  return <span className={`rounded px-1.5 py-0.5 text-[10px] ring-1 ${cls}`}>{children}</span>;
}
