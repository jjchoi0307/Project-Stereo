"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type {
  ClientProfileInput,
  ExclusionLogEntry,
  NormalizedProfile,
  RiskBand,
  RiskMarker,
} from "@/lib/domain";

interface PlanLite {
  id: string;
  name: string;
  carrier: string;
  planType: string;
  smgSupported: boolean;
  isScan: boolean;
  isCompetitor: boolean;
}
interface RulesView {
  total: number;
  surviving: { plan: PlanLite; flags: ExclusionLogEntry[] }[];
  excluded: { plan: PlanLite; reasons: ExclusionLogEntry[] }[];
}
interface SimPlanRow {
  planId: string;
  name: string;
  smgSupported: boolean;
  isScan: boolean;
  isCompetitor: boolean;
  meanExposure: number;
  worstExposure: number;
  medCoverageRate: number;
  catastrophicRate: number;
  topUncoveredDrugs: { name: string; rate: number }[];
}
interface SimView {
  seed: number;
  count: number;
  journeyTypeDistribution: Record<string, number>;
  perPlan: SimPlanRow[];
}
interface HealthEventRow { year: number; outcome: string; label: string; detail: string }
interface HealthReplica {
  index: number;
  complexityScore: number;
  acquiredConditions: string[];
  acquiredDrugIds: string[];
  events: HealthEventRow[];
}
interface HealthView {
  seed: number;
  replicas: number;
  horizonYears: number;
  stableRate: number;
  severeRate: number;
  meanComplexity: number;
  perYearIncidence: { year: number; meanNewEvents: number }[];
  outcomeIncidence: { outcome: string; label: string; rate: number }[];
  sampleTrajectories: HealthReplica[];
}
import { CONDITION_OPTIONS } from "@/lib/intake/options";
import { profileToValues } from "@/lib/intake/toValues";
import type { IntakeReference } from "@/lib/intake/types";
import type { BrokerSession as Session } from "@/lib/session/store";
import IntakeForm from "./IntakeForm";

export default function BrokerSession({
  initialSession,
  reference,
}: {
  initialSession: Session;
  reference: IntakeReference;
}) {
  const [session, setSession] = useState<Session>(initialSession);
  const [editing, setEditing] = useState(false);
  const [patientLink, setPatientLink] = useState("");
  const [linkError, setLinkError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [normalized, setNormalized] = useState<NormalizedProfile | null>(null);
  const [rules, setRules] = useState<RulesView | null>(null);
  const [sim, setSim] = useState<SimView | null>(null);
  const [health, setHealth] = useState<HealthView | null>(null);

  // Recompute markers + health futures + screening + simulation when facts change.
  useEffect(() => {
    if (session.status !== "intake_complete") {
      setNormalized(null);
      setRules(null);
      setSim(null);
      setHealth(null);
      return;
    }
    let active = true;
    const load = async (suffix: string) => {
      const r = await fetch(`/api/sessions/${session.id}/${suffix}`, { cache: "no-store" });
      return r.ok ? r.json() : null;
    };
    Promise.all([load("normalized"), load("health-futures"), load("rules"), load("simulation")]).then(
      ([n, hf, ru, s]) => {
        if (!active) return;
        if (n) setNormalized(n.normalized);
        if (hf) setHealth(hf);
        if (ru) setRules(ru);
        if (s) setSim(s);
      },
    );
    return () => {
      active = false;
    };
  }, [session.id, session.status, session.profile?.capturedAt]);

  // Mint (or reuse) the capability token for the patient self-entry link — only
  // while awaiting facts (that's the only state where the link is shown/usable).
  useEffect(() => {
    if (session.status !== "awaiting_intake") return;
    let active = true;
    setLinkError(false);
    fetch(`/api/sessions/${session.id}/intake-token`, { method: "POST" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!active) return;
        if (d?.token) setPatientLink(`${window.location.origin}/intake/${d.token}`);
        else setLinkError(true);
      })
      .catch(() => active && setLinkError(true));
    return () => {
      active = false;
    };
  }, [session.id, session.status]);

  // While awaiting facts, poll so a patient submitting on their own device flows
  // straight into the broker's view.
  useEffect(() => {
    if (session.status !== "awaiting_intake") return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/sessions/${session.id}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (data.session?.status === "intake_complete") setSession(data.session);
    }, 3000);
    return () => clearInterval(t);
  }, [session.id, session.status]);

  const copyLink = async () => {
    await navigator.clipboard.writeText(patientLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const onSubmitted = (s: Session) => {
    setSession(s);
    setEditing(false);
  };

  // ── Completed: show captured facts ───────────────────────────────────────
  if (session.status === "intake_complete" && session.profile && !editing) {
    return (
      <div className="space-y-6">
        <ProfileSummary profile={session.profile} reference={reference} />
        {normalized && <NormalizedPanel normalized={normalized} />}
        {health && <HealthFuturesPanel health={health} />}
        {rules && <RulesPanel rules={rules} />}
        {sim && <SimulationPanel sim={sim} />}
        <div className="flex flex-wrap gap-3">
          <Link
            href={`/session/${session.id}/recommendation`}
            className="rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90"
          >
            Continue to recommendation →
          </Link>
          <button
            onClick={() => setEditing(true)}
            className="rounded-md border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Correct facts
          </button>
        </div>
      </div>
    );
  }

  // ── Editing a completed profile (broker correction) ──────────────────────
  if (editing && session.profile) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <IntakeForm
          sessionId={session.id}
          capturedBy="broker"
          reference={reference}
          variant="broker"
          initialValues={profileToValues(session.profile)}
          submitLabel="Save corrections"
          onSubmitted={onSubmitted}
        />
        <button onClick={() => setEditing(false)} className="mt-4 text-sm text-slate-500 hover:underline">
          Cancel
        </button>
      </div>
    );
  }

  // ── Awaiting facts: broker entry OR patient handoff ──────────────────────
  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <IntakeForm
          sessionId={session.id}
          capturedBy="broker"
          reference={reference}
          variant="broker"
          onSubmitted={onSubmitted}
        />
      </div>

      <aside className="h-fit rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="text-sm font-semibold text-ink">Or have the client enter their own facts</h3>
        <p className="mt-1 text-xs text-slate-500">
          The patient knows their meds and doctors best. Share this link or hand over a tablet — their
          answers flow straight into this session.
        </p>
        <div className="mt-4 flex gap-2">
          <input readOnly value={patientLink || (linkError ? "" : "Generating link…")}
            className="w-full rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-xs text-slate-600" />
          <button onClick={copyLink} disabled={!patientLink}
            className="shrink-0 rounded-md bg-slate-800 px-3 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50">
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        {linkError && (
          <p className="mt-1 text-xs text-rose-600">Couldn&apos;t generate the link. Reload to retry.</p>
        )}
        <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" />
          Waiting for the client to submit…
        </div>
      </aside>
    </div>
  );
}

function ProfileSummary({ profile, reference }: { profile: ClientProfileInput; reference: IntakeReference }) {
  const regionName = reference.regions.find((r) => r.id === profile.marketRegion)?.name ?? profile.marketRegion;
  const condLabel = (c: string) => CONDITION_OPTIONS.find((o) => o.value === c)?.label ?? c;
  const prov = (field: keyof ClientProfileInput) => profile.fieldProvenance?.[field];

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">Captured facts</h2>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
          origin: <span className="font-medium">{profile.capturedBy}</span>
        </span>
      </div>
      <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
        <Item label="Age" prov={prov("age")}>{profile.age}</Item>
        <Item label="Region" prov={prov("marketRegion")}>{regionName}</Item>
        <Item label="BMI" prov={prov("bmi")}>{profile.bmi ?? "—"}</Item>
        <Item label="Gender" prov={prov("gender")}>{profile.gender ?? "—"}</Item>
        <Item label="Medications" prov={prov("medications")} full>
          {profile.medications.length
            ? profile.medications.map((m, i) => (
                <span key={`${m.raw}-${i}`} className="mr-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                  {m.raw}{m.drugId ? "" : " (unmatched)"}
                </span>
              ))
            : "—"}
        </Item>
        <Item label="Conditions" prov={prov("conditions")} full>
          {profile.conditions.length ? profile.conditions.map(condLabel).join(", ") : "—"}
          {profile.conditionsFreeText?.length ? `, ${profile.conditionsFreeText.join(", ")}` : ""}
        </Item>
        <Item label="Must keep" prov={prov("providerConstraints")} full>
          {profile.providerConstraints.length
            ? profile.providerConstraints.map((c) => c.label).join("; ")
            : "—"}
        </Item>
        <Item label="Recent care" prov={prov("utilization")} full>
          {profile.utilization
            ? [
                profile.utilization.acupunctureVisits12mo != null && `${profile.utilization.acupunctureVisits12mo} acupuncture`,
                profile.utilization.specialistVisits12mo != null && `${profile.utilization.specialistVisits12mo} specialist`,
                profile.utilization.priorYearInpatientEvents != null && `${profile.utilization.priorYearInpatientEvents} hospital stays`,
              ].filter(Boolean).join(" · ") || "—"
            : "—"}
        </Item>
      </dl>
    </div>
  );
}

const BAND_STYLE: Record<RiskBand, string> = {
  low: "bg-slate-100 text-slate-600",
  moderate: "bg-amber-100 text-amber-700",
  high: "bg-orange-100 text-orange-700",
  very_high: "bg-rose-100 text-rose-700",
};
const BAND_BAR: Record<RiskBand, string> = {
  low: "bg-slate-300",
  moderate: "bg-amber-400",
  high: "bg-orange-500",
  very_high: "bg-rose-500",
};

const MARKERS: { key: keyof Omit<NormalizedProfile, "profileId">; label: string }[] = [
  { key: "diabetes", label: "Diabetes" },
  { key: "oncologyRisk", label: "Oncology risk" },
  { key: "specialistNeed", label: "Specialist need" },
  { key: "drugUtilizationIntensity", label: "Drug utilization" },
  { key: "mentalHealthUtilization", label: "Mental-health utilization" },
  { key: "networkSensitivity", label: "Network sensitivity" },
];

function NormalizedPanel({ normalized }: { normalized: NormalizedProfile }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-ink">Clinical read (inferred)</h2>
        <span className="text-xs text-slate-400">derived from facts · not member-entered opinion</span>
      </div>
      <p className="mb-4 text-xs text-slate-500">
        Likely future utilization inferred from the captured facts. Expand any marker to see exactly which
        inputs produced it.
      </p>
      <div className="space-y-3">
        {MARKERS.map((m) => (
          <MarkerRow key={m.key} label={m.label} marker={normalized[m.key]} />
        ))}
      </div>
    </div>
  );
}

function MarkerRow({ label, marker }: { label: string; marker: RiskMarker }) {
  return (
    <details className="group rounded-md border border-slate-100 px-3 py-2">
      <summary className="flex cursor-pointer items-center gap-3 list-none">
        <span className="w-44 shrink-0 text-sm font-medium text-slate-700">{label}</span>
        <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
          <span className={`block h-full ${BAND_BAR[marker.band]}`} style={{ width: `${Math.round(marker.value * 100)}%` }} />
        </span>
        <span className={`w-20 shrink-0 rounded px-1.5 py-0.5 text-center text-xs ${BAND_STYLE[marker.band]}`}>
          {marker.band.replace("_", " ")}
        </span>
        <span className="w-8 shrink-0 text-right text-xs tabular-nums text-slate-400">
          {Math.round(marker.value * 100)}
        </span>
      </summary>
      <ul className="mt-2 space-y-0.5 pl-2 text-xs text-slate-500">
        {marker.trace.map((t, i) => (
          <li key={i}>· {t}</li>
        ))}
      </ul>
    </details>
  );
}

function PlanTags({ plan }: { plan: { isScan: boolean; smgSupported: boolean; isCompetitor: boolean } }) {
  return (
    <span className="flex gap-1">
      {plan.isScan && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700 ring-1 ring-emerald-200">SCAN</span>}
      {plan.smgSupported && !plan.isScan && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700 ring-1 ring-emerald-200">SMG</span>}
      {plan.isCompetitor && <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-700 ring-1 ring-rose-200">competitor</span>}
    </span>
  );
}

function RulesPanel({ rules }: { rules: RulesView }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-ink">Plan screening</h2>
        <span className="text-sm text-slate-500">
          <span className="font-semibold text-ink">{rules.surviving.length}</span> of {rules.total} plans pass the hard rules
        </span>
      </div>
      <p className="mb-4 text-xs text-slate-500">
        Hard exclusions run before any scoring. Flags stay with a plan and will weigh on its score later.
      </p>

      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">Eligible</h3>
      <ul className="mb-5 divide-y divide-slate-100 rounded-md border border-slate-100">
        {rules.surviving.map(({ plan, flags }) => (
          <li key={plan.id} className="flex items-start justify-between gap-3 px-3 py-2">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-ink">{plan.name}</span>
                <PlanTags plan={plan} />
              </div>
              {flags.map((f, i) => (
                <div key={i} className="mt-0.5 text-xs text-amber-700">⚑ {f.detail}</div>
              ))}
            </div>
          </li>
        ))}
      </ul>

      {rules.excluded.length > 0 && (
        <>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Not recommended for this profile
          </h3>
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-100">
            {rules.excluded.map(({ plan, reasons }) => (
              <li key={plan.id} className="flex items-start justify-between gap-3 px-3 py-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-500">{plan.name}</span>
                    <PlanTags plan={plan} />
                  </div>
                  {reasons.map((r, i) => (
                    <div key={i} className="mt-0.5 text-xs text-rose-600">✗ {r.detail}</div>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function HealthFuturesPanel({ health }: { health: HealthView }) {
  const pct = (n: number) => Math.round(n * 100) + "%";
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-ink">Health futures (simulated)</h2>
        <span className="text-xs text-slate-400">
          {health.replicas} replicas · {health.horizonYears}-yr horizon · seed {health.seed} · reproducible
        </span>
      </div>
      <p className="mb-4 text-xs text-slate-500">
        We replicate this client {health.replicas} times and project what could happen over the next{" "}
        {health.horizonYears} years given their conditions — disease progression, complications, new diagnoses.
      </p>

      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat3 label="No major change" value={pct(health.stableRate)} />
        <Stat3 label="High complexity" value={pct(health.severeRate)} tone={health.severeRate > 0.25 ? "warn" : undefined} />
        <Stat3 label="Mean acuity" value={health.meanComplexity.toFixed(2)} />
      </div>

      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        What could happen ({health.horizonYears}-yr)
      </h3>
      <div className="space-y-2">
        {health.outcomeIncidence.map((o) => (
          <div key={o.outcome} className="flex items-center gap-3">
            <span className="w-52 shrink-0 text-sm text-slate-700">{o.label}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
              <span className="block h-full bg-accent" style={{ width: `${Math.round(o.rate * 100)}%` }} />
            </span>
            <span className="w-10 shrink-0 text-right text-xs tabular-nums text-slate-500">{pct(o.rate)}</span>
          </div>
        ))}
      </div>

      {health.sampleTrajectories.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-accent">Sample trajectories</summary>
          <div className="mt-2 space-y-3">
            {health.sampleTrajectories.map((r) => (
              <div key={r.index} className="rounded-md border border-slate-100 p-3">
                <div className="mb-1 text-xs text-slate-500">
                  replica #{r.index} · end acuity {r.complexityScore.toFixed(2)}
                  {r.events.length === 0 && " · remained stable"}
                </div>
                <ul className="space-y-0.5 text-sm text-slate-700">
                  {r.events.map((e, i) => (
                    <li key={i}>
                      <span className="font-medium text-slate-500">Yr {e.year}:</span> {e.label}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function Stat3({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold ${tone === "warn" ? "text-amber-700" : "text-ink"}`}>{value}</div>
    </div>
  );
}

function SimulationPanel({ sim }: { sim: SimView }) {
  const usd = (n: number) => "$" + n.toLocaleString();
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-ink">Simulation</h2>
        <span className="text-xs text-slate-400">
          {sim.count} seeded scenarios · seed {sim.seed} · reproducible
        </span>
      </div>
      <p className="mb-4 text-xs text-slate-500">
        Each eligible plan scored across {sim.count} plausible futures (not just today). Estimated annual
        member exposure, drug coverage, and catastrophic-risk rate. Provisional order — final ranking in step 6.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="py-1 pr-3 font-medium">Plan</th>
              <th className="py-1 pr-3 text-right font-medium">Mean / yr</th>
              <th className="py-1 pr-3 text-right font-medium">Worst / yr</th>
              <th className="py-1 pr-3 text-right font-medium">Meds covered</th>
              <th className="py-1 text-right font-medium">Catastrophic</th>
            </tr>
          </thead>
          <tbody>
            {sim.perPlan.map((s) => (
              <tr key={s.planId} className="border-t border-slate-100 align-top">
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink">{s.name}</span>
                    <PlanTags plan={s} />
                  </div>
                  {s.topUncoveredDrugs.length > 0 && (
                    <div className="mt-0.5 text-xs text-amber-700">
                      gap: {s.topUncoveredDrugs.map((d) => `${d.name} (${Math.round(d.rate * 100)}%)`).join(", ")}
                    </div>
                  )}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{usd(s.meanExposure)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-500">{usd(s.worstExposure)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{Math.round(s.medCoverageRate * 100)}%</td>
                <td className={`py-2 text-right tabular-nums ${s.catastrophicRate > 0.1 ? "text-rose-600" : "text-slate-500"}`}>
                  {Math.round(s.catastrophicRate * 100)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Item({ label, prov, full, children }: { label: string; prov?: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <dt className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-400">
        {label}
        {prov && (
          <span className={`rounded px-1 text-[10px] ${prov === "patient" ? "bg-sky-100 text-sky-700" : "bg-violet-100 text-violet-700"}`}>
            {prov}
          </span>
        )}
      </dt>
      <dd className="mt-0.5 text-sm text-slate-800">{children}</dd>
    </div>
  );
}
