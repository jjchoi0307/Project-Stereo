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
import { CONDITION_OPTIONS } from "@/lib/intake/options";
import { profileToValues } from "@/lib/intake/toValues";
import type { IntakeReference } from "@/lib/intake/types";
import type { BrokerSession as Session } from "@/lib/session/store";
import IntakeForm from "./IntakeForm";
import Card from "@/components/ui/Card";
import StatusPill from "@/components/ui/StatusPill";
import { ReadLabel } from "@/components/ui/SectionLabel";
import Spinner from "@/components/ui/Spinner";

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

const usd = (n: number) => "$" + n.toLocaleString();
const pct = (n: number) => Math.round(n * 100) + "%";

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
    try {
      await navigator.clipboard.writeText(patientLink);
    } catch {
      /* clipboard may be blocked; the link is selectable in the field */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  };

  const onSubmitted = (s: Session) => {
    setSession(s);
    setEditing(false);
  };

  // ── Completed: the clinical read ─────────────────────────────────────────
  if (session.status === "intake_complete" && session.profile && !editing) {
    return (
      <div data-fade className="mx-auto max-w-[880px]">
        <div className="mb-2 flex items-center gap-2.5">
          <span className="num text-xs text-slate-400">{session.id}</span>
          <StatusPill status="captured" />
        </div>
        <h1 className="mb-1 text-2xl font-semibold tracking-[-.01em] text-ink">Clinical read</h1>
        <p className="mb-6 text-[13.5px] text-slate-500">
          Every marker, outcome, and exclusion below is deterministic and expandable to its trace.
        </p>

        <div className="space-y-4">
          <CapturedFacts profile={session.profile} reference={reference} />
          {normalized ? <MarkersCard normalized={normalized} /> : <LoadingCard label="risk markers" />}
          {health ? <HealthFuturesCard health={health} /> : <LoadingCard label="health futures" />}
          {rules ? <ScreeningCard rules={rules} /> : <LoadingCard label="plan screening" />}
          {sim ? <SimulationCard sim={sim} /> : <LoadingCard label="simulation" />}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            href={`/session/${session.id}/recommendation`}
            className="rounded-[9px] bg-accent px-[22px] py-[13px] text-[14.5px] font-semibold text-white hover:opacity-90"
          >
            Continue to recommendation →
          </Link>
          <button
            onClick={() => setEditing(true)}
            className="rounded-[9px] border border-slate-300 bg-white px-[18px] py-[13px] text-sm font-medium text-slate-700 hover:bg-slate-50"
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
      <div data-fade className="mx-auto max-w-[880px]">
        <h1 className="mb-4 text-2xl font-semibold tracking-[-.01em] text-ink">Correct facts</h1>
        <div className="max-w-[660px] rounded-xl border border-slate-200 bg-white p-[26px]">
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
      </div>
    );
  }

  // ── Awaiting facts: broker entry + patient handoff ───────────────────────
  return (
    <div data-fade>
      <div className="mb-[18px] flex items-center gap-2.5">
        <span className="num text-xs text-slate-400">{session.id}</span>
        <StatusPill status="awaiting" pulse />
      </div>
      <h1 className="mb-[18px] text-2xl font-semibold tracking-[-.01em] text-ink">Client session</h1>

      <div className="flex flex-wrap items-start gap-6">
        <div className="min-w-0 flex-1 basis-[560px] rounded-xl border border-slate-200 bg-white p-[26px]">
          <IntakeForm
            sessionId={session.id}
            capturedBy="broker"
            reference={reference}
            variant="broker"
            onSubmitted={onSubmitted}
          />
        </div>

        <aside className="sticky top-[80px] flex flex-none basis-[312px] flex-col gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="mb-1.5 text-sm font-semibold text-ink">Have the client enter their own facts</h3>
            <p className="mb-3.5 text-[12.5px] leading-[1.5] text-slate-500">
              Share this single-use link. The client fills the same form; this session updates
              automatically.
            </p>
            <div className="flex gap-2">
              <input
                readOnly
                value={patientLink || (linkError ? "" : "Generating link…")}
                className="num min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-[11px] py-[9px] text-xs text-slate-600"
              />
              <button
                type="button"
                onClick={copyLink}
                disabled={!patientLink}
                className="flex-none rounded-lg px-3.5 py-[9px] text-[12.5px] font-semibold disabled:opacity-50"
                style={{
                  background: copied ? "#ecfdf5" : "#0d6e6e",
                  color: copied ? "#059669" : "#ffffff",
                  border: `1px solid ${copied ? "#a7f3d0" : "#0d6e6e"}`,
                }}
              >
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>
            {linkError && (
              <p className="mt-1.5 text-xs text-rose-600">Couldn&apos;t generate the link. Reload to retry.</p>
            )}
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-[18px]">
            <div className="mb-2 flex items-center gap-2.5">
              <span
                className="h-[9px] w-[9px] rounded-full"
                style={{ background: "#d97706", animation: "pulseDot 1.4s ease-in-out infinite" }}
              />
              <span className="text-[13px] font-semibold text-amber-800">Waiting for the client to submit…</span>
            </div>
            <p className="text-xs leading-[1.5] text-amber-700">
              This page checks for new facts every few seconds. It will switch to the clinical read
              automatically.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function LoadingCard({ label }: { label: string }) {
  return (
    <Card>
      <div className="flex items-center gap-2.5 text-[13px] text-slate-400">
        <Spinner size={14} /> Computing {label}…
      </div>
    </Card>
  );
}

// ── 1 · Captured facts ───────────────────────────────────────────────────────
function CapturedFacts({ profile, reference }: { profile: ClientProfileInput; reference: IntakeReference }) {
  const regionName = reference.regions.find((r) => r.id === profile.marketRegion)?.name ?? profile.marketRegion;
  const condLabel = (c: string) => CONDITION_OPTIONS.find((o) => o.value === c)?.label ?? c;
  const prov = (field: keyof ClientProfileInput): "patient" | "broker" =>
    (profile.fieldProvenance?.[field] as "patient" | "broker") ?? profile.capturedBy;

  const conditions = [
    ...profile.conditions.map(condLabel),
    ...(profile.conditionsFreeText ?? []),
  ];
  const fam = (profile.familyHistory ?? [])
    .filter((f) => f.status === "yes")
    .map((f) => condLabel(f.condition));

  const rows: { label: string; value: React.ReactNode; field: keyof ClientProfileInput }[] = [
    { label: "Age", value: profile.age, field: "age" },
    { label: "Gender", value: profile.gender ?? "—", field: "gender" },
    { label: "Region", value: regionName, field: "marketRegion" },
    {
      label: "Medications",
      value: profile.medications.length ? profile.medications.map((m) => m.raw).join(", ") : "—",
      field: "medications",
    },
    { label: "Diagnosed conditions", value: conditions.length ? conditions.join(", ") : "—", field: "conditions" },
    { label: "BMI", value: profile.bmi ?? "—", field: "bmi" },
    {
      label: "Providers to keep",
      value: profile.providerConstraints.length
        ? profile.providerConstraints.map((c) => c.label).join(", ")
        : "None specified",
      field: "providerConstraints",
    },
    { label: "Family history (yes)", value: fam.length ? fam.join(", ") : "—", field: "familyHistory" },
    {
      label: "Recent care (12mo)",
      value: profile.utilization
        ? `Acupuncture ${profile.utilization.acupunctureVisits12mo ?? 0} · Specialist ${
            profile.utilization.specialistVisits12mo ?? 0
          } · Inpatient ${profile.utilization.priorYearInpatientEvents ?? 0}`
        : "—",
      field: "utilization",
    },
  ];

  return (
    <Card>
      <div className="mb-4">
        <ReadLabel>1 · Captured facts</ReadLabel>
      </div>
      <div className="flex flex-col">
        {rows.map((r) => {
          const p = prov(r.field);
          return (
            <div
              key={r.label}
              className="grid grid-cols-[160px_1fr_auto] items-center gap-3.5 border-b border-slate-100 py-[9px] last:border-b-0"
            >
              <div className="text-[12.5px] text-slate-500">{r.label}</div>
              <div className="text-[13.5px] text-ink">{r.value}</div>
              <ProvChip source={p} />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ProvChip({ source }: { source: "patient" | "broker" }) {
  const patient = source === "patient";
  return (
    <span
      className="whitespace-nowrap rounded px-2 py-[3px] text-[10.5px] font-semibold"
      style={{
        background: patient ? "#eff6ff" : "#f1f5f9",
        color: patient ? "#1d4ed8" : "#475569",
      }}
    >
      {patient ? "Patient-entered" : "Broker-entered"}
    </span>
  );
}

// ── 2 · Risk markers ─────────────────────────────────────────────────────────
const BAND_STYLE: Record<RiskBand, { bg: string; fg: string; bar: string; label: string }> = {
  low: { bg: "#f1f5f9", fg: "#475569", bar: "#94a3b8", label: "Low" },
  moderate: { bg: "#fffbeb", fg: "#92400e", bar: "#f59e0b", label: "Moderate" },
  high: { bg: "#fff7ed", fg: "#9a3412", bar: "#f97316", label: "High" },
  very_high: { bg: "#fff1f2", fg: "#9f1239", bar: "#f43f5e", label: "Very high" },
};
const MARKERS: { key: keyof Omit<NormalizedProfile, "profileId">; label: string }[] = [
  { key: "diabetes", label: "Diabetes / metabolic" },
  { key: "networkSensitivity", label: "Network sensitivity" },
  { key: "specialistNeed", label: "Specialist need" },
  { key: "drugUtilizationIntensity", label: "Drug utilization" },
  { key: "mentalHealthUtilization", label: "Mental health" },
  { key: "oncologyRisk", label: "Oncology" },
];

function MarkersCard({ normalized }: { normalized: NormalizedProfile }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <Card>
      <div className="mb-1.5">
        <ReadLabel>2 · Risk markers</ReadLabel>
      </div>
      <p className="mb-[18px] text-[12.5px] text-slate-400">
        Six normalized markers from the captured profile. Click any to read its trace.
      </p>
      <div className="flex flex-col gap-3.5">
        {MARKERS.map((m) => {
          const marker = normalized[m.key] as RiskMarker;
          const st = BAND_STYLE[marker.band];
          const p = Math.round(marker.value * 100);
          const isOpen = !!open[m.key];
          return (
            <div key={m.key}>
              <div
                onClick={() => setOpen((o) => ({ ...o, [m.key]: !o[m.key] }))}
                className="flex cursor-pointer items-center gap-3"
              >
                <div className="flex flex-[0_0_168px] items-center gap-1.5 text-[13px] font-medium text-slate-700">
                  <span className="text-[10px] text-slate-400">{isOpen ? "▾" : "▸"}</span>
                  {m.label}
                </div>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <span className="block h-full rounded-full" style={{ width: `${p}%`, background: st.bar }} />
                </div>
                <span className="num flex-[0_0_40px] text-right text-[13px] font-semibold text-slate-600">{p}</span>
                <span
                  className="flex-[0_0_86px] rounded-md py-[3px] text-center text-[11px] font-semibold"
                  style={{ background: st.bg, color: st.fg }}
                >
                  {st.label}
                </span>
              </div>
              {isOpen && (
                <div className="ml-[180px] mt-2.5 rounded-r-lg border-l-2 border-slate-300 bg-slate-50 px-3.5 py-[11px] text-[12.5px] leading-[1.55] text-slate-600">
                  {marker.trace.map((t, i) => (
                    <div key={i}>· {t}</div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── 3 · Health futures ─────────────────────────────────────────────────────
function HealthFuturesCard({ health }: { health: HealthView }) {
  const [open, setOpen] = useState(false);
  const outcomeColor = (rate: number) => (rate >= 0.2 ? "#f97316" : rate >= 0.1 ? "#f59e0b" : "#94a3b8");
  return (
    <Card>
      <div className="mb-1.5">
        <ReadLabel>
          3 · Health futures{" "}
          <span className="font-medium normal-case tracking-normal text-slate-400">
            · simulated, {health.replicas} trajectories
          </span>
        </ReadLabel>
      </div>
      <p className="mb-[18px] text-[12.5px] text-slate-400">
        Deterministic projection over the captured profile · {health.horizonYears}-year horizon · seed{" "}
        {health.seed}.
      </p>

      <div className="mb-5 grid grid-cols-3 gap-3">
        <div className="rounded-[10px] border border-emerald-200 bg-emerald-50 p-3.5">
          <div className="num text-[26px] font-semibold text-emerald-900">{pct(health.stableRate)}</div>
          <div className="mt-0.5 text-xs text-emerald-700">remain stable</div>
        </div>
        <div className="rounded-[10px] border border-orange-200 bg-orange-50 p-3.5">
          <div className="num text-[26px] font-semibold text-orange-900">{pct(health.severeRate)}</div>
          <div className="mt-0.5 text-xs text-orange-700">high-complexity</div>
        </div>
        <div className="rounded-[10px] border border-slate-200 bg-slate-50 p-3.5">
          <div className="num text-[26px] font-semibold text-ink">{health.meanComplexity.toFixed(1)}</div>
          <div className="mt-0.5 text-xs text-slate-500">mean acuity</div>
        </div>
      </div>

      <div className="mb-2.5 text-xs font-semibold text-slate-600">
        Outcome incidence over {health.horizonYears} years
      </div>
      <div className="mb-[18px] flex flex-col gap-2.5">
        {health.outcomeIncidence.map((o) => (
          <div key={o.outcome} className="flex items-center gap-3">
            <span className="flex-[0_0_188px] text-[12.5px] text-slate-700">{o.label}</span>
            <span className="h-[7px] flex-1 overflow-hidden rounded-full bg-slate-100">
              <span
                className="block h-full rounded-full"
                style={{ width: `${Math.round(o.rate * 100)}%`, background: outcomeColor(o.rate) }}
              />
            </span>
            <span className="num flex-[0_0_34px] text-right text-[12.5px] font-semibold text-slate-600">
              {pct(o.rate)}
            </span>
          </div>
        ))}
      </div>

      {health.sampleTrajectories.length > 0 && (
        <>
          <div onClick={() => setOpen((x) => !x)} className="cursor-pointer text-[12.5px] font-medium text-accent">
            {open ? "▾" : "▸"} Sample trajectories
          </div>
          {open && (
            <div className="mt-3 flex flex-col gap-2">
              {health.sampleTrajectories.map((r) => (
                <div
                  key={r.index}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-[11px] text-[12.5px] leading-[1.5] text-slate-600"
                >
                  <span className="font-semibold text-slate-700">Replica #{r.index}</span> · end acuity{" "}
                  {r.complexityScore.toFixed(1)} —{" "}
                  {r.events.length
                    ? r.events.map((e) => `Yr ${e.year}: ${e.label}`).join("; ")
                    : "remained stable, no major events"}
                  .
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// ── 4 · Plan screening ───────────────────────────────────────────────────────
function ScreeningCard({ rules }: { rules: RulesView }) {
  return (
    <Card>
      <div className="mb-4 flex items-baseline justify-between">
        <ReadLabel>4 · Plan screening</ReadLabel>
        <div className="text-[13px] text-slate-600">
          <span className="num font-semibold text-emerald-600">{rules.surviving.length}</span> of{" "}
          <span className="num font-semibold">{rules.total}</span> plans pass
        </div>
      </div>

      <div className="mb-2.5 text-xs font-semibold text-emerald-600">Eligible</div>
      <div className="mb-5 flex flex-col gap-2">
        {rules.surviving.map(({ plan, flags }) => (
          <div
            key={plan.id}
            className="flex items-center gap-3 rounded-[9px] border border-[#ccebe6] bg-[#f6fdfb] px-3.5 py-2.5"
          >
            <span className="flex-none text-sm font-bold text-emerald-600">✓</span>
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold">{plan.name}</div>
              <div className="text-xs text-slate-500">
                {plan.carrier} · {plan.planType}
              </div>
            </div>
            {flags.map((f, i) => (
              <span
                key={i}
                className="whitespace-nowrap rounded-md bg-amber-50 px-2.5 py-[3px] text-[11px] font-medium text-amber-800"
              >
                ⚑ {f.detail}
              </span>
            ))}
          </div>
        ))}
      </div>

      {rules.excluded.length > 0 && (
        <>
          <div className="mb-2.5 text-xs font-semibold text-rose-700">Not recommended</div>
          <div className="flex flex-col gap-2">
            {rules.excluded.map(({ plan, reasons }) => (
              <div
                key={plan.id}
                className="flex items-start gap-3 rounded-[9px] border border-[#fbd5da] bg-[#fff7f8] px-3.5 py-2.5"
              >
                <span className="flex-none text-sm font-bold text-rose-600">✗</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold">
                    {plan.name} <span className="text-xs font-normal text-slate-400">· {plan.carrier}</span>
                  </div>
                  <div className="mt-0.5 text-xs leading-[1.45] text-rose-800">
                    {reasons.map((r) => r.detail).join(" ")}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

// ── 5 · Simulation ───────────────────────────────────────────────────────────
function SimulationCard({ sim }: { sim: SimView }) {
  const catColor = (r: number) => (r >= 0.05 ? "#f97316" : r >= 0.03 ? "#f59e0b" : "#94a3b8");
  return (
    <Card>
      <div className="mb-1.5">
        <ReadLabel>5 · Simulation · projected exposure</ReadLabel>
      </div>
      <p className="mb-4 text-[12.5px] text-slate-400">
        Per-plan annual out-of-pocket across the {sim.count} simulated futures · seed {sim.seed}.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-[.03em] text-slate-500">
              <th className="px-2.5 py-2 font-semibold">Plan</th>
              <th className="px-2.5 py-2 text-right font-semibold">Mean / yr</th>
              <th className="px-2.5 py-2 text-right font-semibold">Worst / yr</th>
              <th className="px-2.5 py-2 text-right font-semibold">Meds covered</th>
              <th className="px-2.5 py-2 text-right font-semibold">Catastrophic</th>
            </tr>
          </thead>
          <tbody>
            {sim.perPlan.map((s) => (
              <tr key={s.planId} className="border-t border-slate-100">
                <td className="px-2.5 py-[9px] font-medium">{s.name}</td>
                <td className="num px-2.5 py-[9px] text-right">{usd(s.meanExposure)}</td>
                <td className="num px-2.5 py-[9px] text-right text-slate-500">{usd(s.worstExposure)}</td>
                <td className="num px-2.5 py-[9px] text-right">{Math.round(s.medCoverageRate * 100)}%</td>
                <td className="px-2.5 py-[9px] text-right">
                  <span className="num font-semibold" style={{ color: catColor(s.catastrophicRate) }}>
                    {Math.round(s.catastrophicRate * 100)}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
