"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  ClientProfileInput,
  ExclusionLogEntry,
  NormalizedProfile,
  RiskBand,
  RiskMarker,
} from "@/lib/domain";
import { CONDITION_OPTIONS } from "@/lib/intake/options";
import { profileToValues } from "@/lib/intake/toValues";
import { clientRef } from "@/lib/session/ref";
import type { IntakeReference } from "@/lib/intake/types";
import type { AiMarker, AiOutcome, ClinicalRead } from "@/lib/ai/clinicalRead";
import type { BrokerSession as Session } from "@/lib/session/store";
import IntakeForm from "./IntakeForm";
import Card from "@/components/ui/Card";
import StatusPill from "@/components/ui/StatusPill";
import { ReadLabel } from "@/components/ui/SectionLabel";
import SmgLoader from "@/components/ui/SmgLoader";
import Stepper from "@/components/ui/Stepper";

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

// The shared 4-step broker journey (see WORKFLOW.md). Same steps everywhere; the
// Stepper only links completed steps, so unfinished hrefs are harmless.
const journeySteps = (id: string) => [
  { label: "Capture facts", href: `/session/${id}` },
  { label: "Clinical read", href: `/session/${id}` },
  { label: "Recommendation", href: `/session/${id}/recommendation` },
  { label: "On record" },
];

const usd = (n: number) => "$" + n.toLocaleString();
const pct = (n: number) => Math.round(n * 100) + "%";
/** Plain-language stand-in for the model's "acuity"/complexity score (0..1+). */
const careLevel = (score: number) => (score >= 0.5 ? "high" : score >= 0.25 ? "moderate" : "low");

export default function BrokerSession({
  initialSession,
  reference,
}: {
  initialSession: Session;
  reference: IntakeReference;
}) {
  const router = useRouter();
  const [session, setSession] = useState<Session>(initialSession);
  const [editing, setEditing] = useState(false);
  const [patientLink, setPatientLink] = useState("");
  const [linkError, setLinkError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [normalized, setNormalized] = useState<NormalizedProfile | null>(null);
  const [rules, setRules] = useState<RulesView | null>(null);
  const [sim, setSim] = useState<SimView | null>(null);
  const [health, setHealth] = useState<HealthView | null>(null);
  const [clinical, setClinical] = useState<ClinicalRead | null>(null);

  // Recompute markers + health futures + screening + simulation when facts change.
  // The AI clinical read powers cards 2 & 3; the deterministic `normalized` /
  // `health-futures` fetches are kept as a graceful fallback when the AI is
  // unconfigured (503) — see the render switch below.
  useEffect(() => {
    if (session.status !== "intake_complete") {
      setNormalized(null);
      setRules(null);
      setSim(null);
      setHealth(null);
      setClinical(null);
      return;
    }
    let active = true;
    const load = async (suffix: string) => {
      const r = await fetch(`/api/sessions/${session.id}/${suffix}`, { cache: "no-store" });
      return r.ok ? r.json() : null;
    };
    Promise.all([
      load("normalized"),
      load("health-futures"),
      load("rules"),
      load("simulation"),
      load("clinical-read"),
    ]).then(([n, hf, ru, s, c]) => {
      if (!active) return;
      if (n) setNormalized(n.normalized);
      if (hf) setHealth(hf);
      if (ru) setRules(ru);
      if (s) setSim(s);
      if (c) setClinical(c);
    });
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
    // Bust the App Router client cache so downstream server components (the
    // recommendation route) re-render against the just-saved facts instead of a
    // cached pre-edit render. The local fetch effects above already re-run on the
    // new capturedAt; this covers navigation to sibling routes.
    router.refresh();
  };

  // ── Completed: the clinical read ─────────────────────────────────────────
  if (session.status === "intake_complete" && session.profile && !editing) {
    return (
      <div data-fade className="mx-auto max-w-[880px]">
        <Stepper steps={journeySteps(session.id)} current={1} />
        <div className="mb-2 flex items-center gap-2.5">
          <span className="num text-xs font-semibold text-ink2" title={session.id}>{clientRef(session.id)}</span>
          <StatusPill status="captured" />
        </div>
        <h1 className="display mb-1 text-[26px] font-semibold text-ink">Clinical read</h1>
        <p className="mb-6 text-[13.5px] text-ink2">
          Risk markers and health futures are AI-read from the captured facts; plan screening and
          simulation are deterministic and expandable to their trace.
        </p>

        <div className="space-y-4">
          <CapturedFacts profile={session.profile} reference={reference} />
          {clinical ? (
            <MarkersCard clinical={clinical} />
          ) : normalized ? (
            <MarkersCardDeterministic normalized={normalized} />
          ) : (
            <LoadingCard label="risk markers" />
          )}
          {clinical ? (
            <HealthFuturesCard clinical={clinical} />
          ) : health ? (
            <HealthFuturesCardDeterministic health={health} />
          ) : (
            <LoadingCard label="health futures" />
          )}
          {rules ? <ScreeningCard rules={rules} /> : <LoadingCard label="plan screening" />}
          {sim ? <SimulationCard sim={sim} /> : <LoadingCard label="simulation" />}
        </div>

        <div className="mt-7 border-t border-line pt-5">
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={`/session/${session.id}/recommendation`}
              className="rounded-sm bg-accent px-[22px] py-[13px] text-[14.5px] font-semibold text-surface hover:bg-accent-strong"
            >
              Continue to recommendation →
            </Link>
            <button
              onClick={() => setEditing(true)}
              className="rounded-sm border border-line bg-surface px-[18px] py-[13px] text-sm font-medium text-ink hover:bg-paper"
            >
              Correct facts
            </button>
          </div>
          <p className="mt-2.5 text-[12px] leading-[1.5] text-ink2">
            Facts look right? Continue to the ranked recommendation. Need a change? <span className="font-medium text-ink">Correct facts</span> reopens the prefilled form — resubmitting updates the saved facts, attributing any edits to you while preserving the member&apos;s original entries.
          </p>
        </div>
      </div>
    );
  }

  // ── Editing a completed profile (broker correction) ──────────────────────
  if (editing && session.profile) {
    return (
      <div data-fade className="mx-auto max-w-[880px]">
        <Stepper steps={journeySteps(session.id)} current={1} />
        <h1 className="display mb-1 text-[26px] font-semibold text-ink">Correct facts</h1>
        <p className="mb-5 max-w-[660px] text-[13.5px] leading-[1.5] text-ink2">
          The form is prefilled with the saved facts. Saving updates this session in place — your
          edits are attributed to you, the member&apos;s original entries are preserved, and the
          clinical read recomputes.
        </p>
        <div className="max-w-[660px] border border-line bg-surface p-[26px]">
          <IntakeForm
            sessionId={session.id}
            capturedBy="broker"
            reference={reference}
            variant="broker"
            initialValues={profileToValues(session.profile)}
            submitLabel="Save corrections"
            onSubmitted={onSubmitted}
          />
          <button onClick={() => setEditing(false)} className="mt-4 text-sm text-ink2 hover:underline">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── Awaiting facts: broker entry + patient handoff ───────────────────────
  return (
    <div data-fade>
      <Stepper steps={journeySteps(session.id)} current={0} />
      <div className="mb-2 flex items-center gap-2.5">
        <span className="num text-xs text-ink2" title={session.id}>{clientRef(session.id)}</span>
        <StatusPill status="awaiting" pulse />
      </div>
      <h1 className="display mb-1 text-[26px] font-semibold text-ink">Capture facts</h1>
      <p className="mb-6 text-[13.5px] leading-[1.5] text-ink2">
        Two ways to get this member&apos;s facts on the record — pick whichever fits the conversation.
        Either path lands in the same place and flips this page to the clinical read.
      </p>

      <div className="grid items-start gap-5 lg:grid-cols-[1fr_340px]">
        {/* Path A — broker enters the facts directly */}
        <section className="min-w-0 rounded-xl border border-line bg-surface shadow-card">
          <div className="border-b border-line px-[26px] py-4">
            <div className="eyebrow mb-1 text-accent">Path A</div>
            <h2 className="text-[15px] font-semibold text-ink">Enter the facts yourself</h2>
            <p className="mt-1 text-[12.5px] leading-[1.5] text-ink2">
              You have the details in front of you — fill them in here. Submitting saves the facts to
              this session.
            </p>
          </div>
          <div className="p-[26px]">
            <IntakeForm
              sessionId={session.id}
              capturedBy="broker"
              reference={reference}
              variant="broker"
              onSubmitted={onSubmitted}
            />
          </div>
        </section>

        {/* Path B — hand off a secure link to the member */}
        <aside className="sticky top-[80px] flex flex-col gap-4">
          <div className="rounded-xl border border-line bg-surface shadow-card p-5">
            <div className="eyebrow mb-1 text-blue">Path B</div>
            <h3 className="mb-1.5 text-[15px] font-semibold text-ink">Send the member a secure link</h3>
            <p className="mb-3.5 text-[12.5px] leading-[1.5] text-ink2">
              Share this single-use link. The member fills the same form on their own device; this
              session updates automatically.
            </p>
            <div className="flex gap-2">
              <input
                readOnly
                value={patientLink || (linkError ? "" : "Generating link…")}
                className="num min-w-0 flex-1 rounded-sm border border-line bg-paper px-[11px] py-[9px] text-xs text-ink2"
              />
              <button
                type="button"
                onClick={copyLink}
                disabled={!patientLink}
                className={`flex-none rounded-sm border px-3.5 py-[9px] text-[12.5px] font-semibold disabled:opacity-50 ${
                  copied
                    ? "border-pos/30 bg-pos/10 text-pos"
                    : "border-accent bg-accent text-surface hover:bg-accent-strong"
                }`}
              >
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>
            {linkError && (
              <p className="mt-1.5 text-xs text-neg">Couldn&apos;t generate the link. Reload to retry.</p>
            )}
          </div>

          <div className="rounded-xl border border-neg/30 bg-neg/10 px-5 py-[18px]">
            <div className="mb-2 flex items-center gap-2.5">
              <span
                className="h-1.5 w-1.5 flex-none rounded-full bg-neg"
                style={{ animation: "pulseDot 1.4s ease-in-out infinite" }}
              />
              <span className="text-[13px] font-semibold text-neg">
                Waiting for the member to submit their facts…
              </span>
            </div>
            <p className="text-xs leading-[1.5] text-neg">
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
      <div className="flex items-center gap-2.5 text-[13px] text-ink2">
        <SmgLoader size={22} /> Computing {label}…
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
    { label: "Dual-eligible (Medi-Cal)", value: profile.dualEligible ? "Yes" : "No", field: "dualEligible" },
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
              className="grid grid-cols-[160px_1fr_auto] items-center gap-3.5 border-b border-line py-[9px] last:border-b-0"
            >
              <div className="text-[12.5px] text-ink2">{r.label}</div>
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
      className={`eyebrow whitespace-nowrap rounded-sm border px-2 py-0.5 text-[10.5px] ${
        patient ? "border-prov/30 bg-prov/10 text-prov" : "border-ai/30 bg-ai/10 text-ai"
      }`}
    >
      {patient ? "Patient-entered" : "Broker-entered"}
    </span>
  );
}

// ── 2 · Risk markers ─────────────────────────────────────────────────────────
// Risk-band tints map to the data-only semantics (DESIGN.md): low reads as
// neutral ink2, moderate/high escalate through warn, very_high lands on neg.
// `chip` is a square bordered token chip; `bar` is the marker fill color.
const BAND_STYLE: Record<RiskBand, { chip: string; bar: string; label: string }> = {
  low: { chip: "border-line bg-paper text-ink2", bar: "bg-ink2", label: "Low" },
  moderate: { chip: "border-warn/30 bg-warn/10 text-warn", bar: "bg-warn", label: "Moderate" },
  high: { chip: "border-warn/30 bg-warn/10 text-warn", bar: "bg-warn", label: "High" },
  very_high: { chip: "border-neg/30 bg-neg/10 text-neg", bar: "bg-neg", label: "Very high" },
};
// The bar shows the BAND, not a raw 0–100 score. A precise number (e.g. "70")
// reads as a false-precise measurement to brokers/members and is confusing; the
// honest unit here is the band. Each band fills a fixed, representative width so
// the bar communicates magnitude qualitatively without inventing precision.
const BAND_FILL: Record<RiskBand, number> = { low: 28, moderate: 52, high: 76, very_high: 100 };
const MARKERS: { key: keyof Omit<NormalizedProfile, "profileId">; label: string }[] = [
  { key: "diabetes", label: "Diabetes / metabolic" },
  { key: "networkSensitivity", label: "Network sensitivity" },
  { key: "specialistNeed", label: "Specialist need" },
  { key: "drugUtilizationIntensity", label: "Drug utilization" },
  { key: "mentalHealthUtilization", label: "Mental health" },
  { key: "oncologyRisk", label: "Oncology" },
];

// AI-powered risk markers, grounded in the captured de-identified facts.
function MarkersCard({ clinical }: { clinical: ClinicalRead }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <Card>
      <div className="mb-1.5">
        <ReadLabel>
          2 · Risk markers{" "}
          <span className="font-medium normal-case tracking-normal text-ai">· AI read</span>
        </ReadLabel>
      </div>
      <p className="mb-[18px] text-[12.5px] text-ink2">
        Each marker is rated Low → Very high from the captured facts. Click any to read why.
      </p>
      <div className="flex flex-col gap-3.5">
        {clinical.markers.map((m) => {
          const st = BAND_STYLE[m.band];
          const p = BAND_FILL[m.band];
          const isOpen = !!open[m.key];
          return (
            <div key={m.key}>
              <button
                type="button"
                onClick={() => setOpen((o) => ({ ...o, [m.key]: !o[m.key] }))}
                aria-expanded={isOpen}
                className="flex w-full cursor-pointer items-center gap-3 text-left"
              >
                <div className="flex flex-[0_0_168px] items-center gap-1.5 text-[13px] font-medium text-ink">
                  <span className="text-[10px] text-accent">{isOpen ? "▾" : "▸"}</span>
                  {m.label}
                </div>
                <div className="h-[5px] flex-1 overflow-hidden bg-line">
                  <span className={`block h-full ${st.bar}`} style={{ width: `${p}%` }} />
                </div>
                <span
                  className={`eyebrow flex-[0_0_92px] rounded-sm border py-0.5 text-center text-[11px] ${st.chip}`}
                >
                  {st.label}
                </span>
              </button>
              {isOpen && (
                <div className="ml-[180px] mt-2.5 border-l-2 border-line bg-paper px-3.5 py-[11px] text-[12.5px] leading-[1.55] text-ink2">
                  {m.why}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function MarkersCardDeterministic({ normalized }: { normalized: NormalizedProfile }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <Card>
      <div className="mb-1.5">
        <ReadLabel>2 · Risk markers</ReadLabel>
      </div>
      <p className="mb-[18px] text-[12.5px] text-ink2">
        Six markers from the captured profile, each rated Low → Very high. Click any to read its trace.
      </p>
      <div className="flex flex-col gap-3.5">
        {MARKERS.map((m) => {
          const marker = normalized[m.key] as RiskMarker;
          const st = BAND_STYLE[marker.band];
          const p = BAND_FILL[marker.band];
          const isOpen = !!open[m.key];
          return (
            <div key={m.key}>
              <button
                type="button"
                onClick={() => setOpen((o) => ({ ...o, [m.key]: !o[m.key] }))}
                aria-expanded={isOpen}
                className="flex w-full cursor-pointer items-center gap-3 text-left"
              >
                <div className="flex flex-[0_0_168px] items-center gap-1.5 text-[13px] font-medium text-ink">
                  <span className="text-[10px] text-accent">{isOpen ? "▾" : "▸"}</span>
                  {m.label}
                </div>
                <div className="h-[5px] flex-1 overflow-hidden bg-line">
                  <span className={`block h-full ${st.bar}`} style={{ width: `${p}%` }} />
                </div>
                <span
                  className={`eyebrow flex-[0_0_92px] rounded-sm border py-0.5 text-center text-[11px] ${st.chip}`}
                >
                  {st.label}
                </span>
              </button>
              {isOpen && (
                <div className="ml-[180px] mt-2.5 border-l-2 border-line bg-paper px-3.5 py-[11px] text-[12.5px] leading-[1.55] text-ink2">
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
const OUTLOOK_STYLE: Record<"stable" | "watch" | "elevated", { chip: string; label: string }> = {
  stable: { chip: "border-pos/30 bg-pos/10 text-pos", label: "Stable" },
  watch: { chip: "border-warn/30 bg-warn/10 text-warn", label: "Watch" },
  elevated: { chip: "border-neg/30 bg-neg/10 text-neg", label: "Elevated" },
};
const LIKELIHOOD_STYLE: Record<"unlikely" | "possible" | "likely", { chip: string; label: string }> = {
  unlikely: { chip: "border-line bg-paper text-ink2", label: "Unlikely" },
  possible: { chip: "border-warn/30 bg-warn/10 text-warn", label: "Possible" },
  likely: { chip: "border-warn/30 bg-warn/10 text-warn", label: "Likely" },
};

// AI-powered health futures, grounded in the captured de-identified facts.
// Progressive disclosure: the front face is just the outlook + one-line headline
// per horizon; the summaries, the possible-outcomes list, and the caveat live
// behind a single "See the detail" toggle so the surface stays simple.
function HealthFuturesCard({ clinical }: { clinical: ClinicalRead }) {
  const { horizons, outcomes, caveat } = clinical.futures;
  const ordered = [...horizons].sort((a, b) => a.years - b.years);
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <div className="mb-1.5">
        <ReadLabel>
          3 · Health futures{" "}
          <span className="font-medium normal-case tracking-normal text-ai">· AI read</span>
        </ReadLabel>
      </div>
      <p className="mb-[18px] text-[12.5px] text-ink2">
        Where this person&apos;s health is most likely headed, read from the captured facts.
      </p>

      {/* Front face: outlook + headline only — the simple read at a glance. */}
      <div className="grid grid-cols-2 gap-3">
        {ordered.map((h) => {
          const st = OUTLOOK_STYLE[h.outlook];
          return (
            <div key={h.years} className="border border-line bg-paper p-3.5">
              <div className="mb-2 flex items-center justify-between">
                <span className="num text-[13px] font-semibold text-ink">{h.years}-year</span>
                <span className={`eyebrow rounded-sm border px-2 py-0.5 text-[11px] ${st.chip}`}>
                  {st.label}
                </span>
              </div>
              <div className="text-[13.5px] font-semibold text-ink">{h.headline}</div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-3.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-accent"
      >
        <span className="text-[10px]">{open ? "▾" : "▸"}</span>
        {open ? "Hide the detail" : "See what could change & why"}
      </button>

      {open && (
        <div className="mt-3.5 border-t border-line pt-4">
          {/* Per-horizon summaries */}
          <div className="mb-4 flex flex-col gap-3">
            {ordered.map((h) => (
              <div key={h.years}>
                <div className="num mb-0.5 text-[11px] font-bold uppercase tracking-[.04em] text-ink2">
                  {h.years}-year
                </div>
                <p className="text-[12.5px] leading-[1.5] text-ink2">{h.summary}</p>
              </div>
            ))}
          </div>

          <div className="eyebrow mb-2.5 text-ink2">Possible outcomes</div>
          <div className="mb-[18px] flex flex-col gap-2.5">
            {outcomes.map((o, i) => {
              const st = LIKELIHOOD_STYLE[o.likelihood];
              return (
                <div key={i} className="border border-line bg-surface px-3.5 py-[11px]">
                  <div className="flex items-center gap-2.5">
                    <span className="flex-1 text-[13px] font-medium text-ink">{o.label}</span>
                    <span className={`eyebrow flex-none rounded-sm border px-2 py-0.5 text-[11px] ${st.chip}`}>
                      {st.label}
                    </span>
                  </div>
                  <p className="mt-1 text-[12.5px] leading-[1.5] text-ink2">{o.why}</p>
                </div>
              );
            })}
          </div>

          <p className="text-[11.5px] italic leading-[1.5] text-ink2">{caveat}</p>
        </div>
      )}
    </Card>
  );
}

function HealthFuturesCardDeterministic({ health }: { health: HealthView }) {
  const [open, setOpen] = useState(false);
  // Outcome incidence bar fill: rarer events stay neutral ink2, common ones
  // escalate to warn — the data-only semantics, no raw hue.
  const outcomeColor = (rate: number) => (rate >= 0.1 ? "bg-warn" : "bg-ink2");
  return (
    <Card>
      <div className="mb-1.5">
        <ReadLabel>
          3 · Health futures{" "}
          <span className="font-medium normal-case tracking-normal text-ink2">
            · {health.replicas} simulated futures
          </span>
        </ReadLabel>
      </div>
      <p className="mb-[18px] text-[12.5px] text-ink2">
        Deterministic projection over the captured profile · {health.horizonYears}-year horizon · seed{" "}
        <span className="num">{health.seed}</span>.
      </p>

      <div className="mb-5 grid grid-cols-3 gap-3">
        <div className="border border-pos/30 bg-pos/10 p-3.5">
          <div className="num text-[26px] font-semibold text-pos">{pct(health.stableRate)}</div>
          <div className="mt-0.5 text-xs text-ink2">remain stable</div>
        </div>
        <div className="border border-warn/30 bg-warn/10 p-3.5">
          <div className="num text-[26px] font-semibold text-warn">{pct(health.severeRate)}</div>
          <div className="mt-0.5 text-xs text-ink2">need more care</div>
        </div>
        <div className="border border-line bg-paper p-3.5">
          <div className="display text-[22px] font-semibold capitalize text-ink">{careLevel(health.meanComplexity)}</div>
          <div className="mt-0.5 text-xs text-ink2">typical care needs</div>
        </div>
      </div>

      <div className="eyebrow mb-2.5 text-ink2">
        Outcome incidence over {health.horizonYears} years
      </div>
      <div className="mb-[18px] flex flex-col gap-2.5">
        {health.outcomeIncidence.map((o) => (
          <div key={o.outcome} className="flex items-center gap-3">
            <span className="flex-[0_0_188px] text-[12.5px] text-ink">{o.label}</span>
            <span className="h-[5px] flex-1 overflow-hidden bg-line">
              <span
                className={`block h-full ${outcomeColor(o.rate)}`}
                style={{ width: `${Math.round(o.rate * 100)}%` }}
              />
            </span>
            <span className="num flex-[0_0_34px] text-right text-[12.5px] font-semibold text-ink2">
              {pct(o.rate)}
            </span>
          </div>
        ))}
      </div>

      {health.sampleTrajectories.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen((x) => !x)}
            aria-expanded={open}
            className="cursor-pointer text-[12.5px] font-medium text-accent"
          >
            {open ? "▾" : "▸"} See example futures
          </button>
          {open && (
            <div className="mt-3 flex flex-col gap-2">
              {health.sampleTrajectories.map((r) => (
                <div
                  key={r.index}
                  className="border border-line bg-paper px-3.5 py-[11px] text-[12.5px] leading-[1.5] text-ink2"
                >
                  <span className="font-semibold text-ink">Example #{r.index}</span> · ends with{" "}
                  {careLevel(r.complexityScore)} care needs —{" "}
                  {r.events.length
                    ? r.events.map((e) => `Yr ${e.year}: ${e.label}`).join("; ")
                    : "stayed healthy, no major changes"}
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
        <div className="text-[13px] text-ink2">
          <span className="num font-semibold text-pos">{rules.surviving.length}</span> of{" "}
          <span className="num font-semibold text-ink">{rules.total}</span> plans pass
        </div>
      </div>

      <div className="eyebrow mb-2.5 text-pos">Eligible</div>
      <div className="mb-5 flex flex-col gap-2">
        {rules.surviving.map(({ plan, flags }) => (
          <div
            key={plan.id}
            className="flex items-center gap-3 border border-pos/30 bg-pos/10 px-3.5 py-2.5"
          >
            <span className="flex-none text-sm font-bold text-pos">✓</span>
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold text-ink">{plan.name}</div>
              <div className="text-xs text-ink2">
                {plan.carrier} · {plan.planType}
              </div>
            </div>
            {flags.map((f, i) => (
              <span
                key={i}
                className="eyebrow whitespace-nowrap rounded-sm border border-warn/30 bg-warn/10 px-2.5 py-0.5 text-[11px] text-warn"
              >
                ⚑ {f.detail}
              </span>
            ))}
          </div>
        ))}
      </div>

      {rules.excluded.length > 0 && (
        <>
          <div className="eyebrow mb-2.5 text-neg">Not recommended</div>
          <div className="flex flex-col gap-2">
            {rules.excluded.map(({ plan, reasons }) => (
              <div
                key={plan.id}
                className="flex items-start gap-3 border border-neg/30 bg-neg/10 px-3.5 py-2.5"
              >
                <span className="flex-none text-sm font-bold text-neg">✗</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold text-ink">
                    {plan.name} <span className="text-xs font-normal text-ink2">· {plan.carrier}</span>
                  </div>
                  <div className="mt-0.5 text-xs leading-[1.45] text-neg">
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
  // Catastrophic rate: low stays neutral ink2, elevated reads as warn — the
  // data-only semantics, no raw orange/amber hue.
  const catColor = (r: number) => (r >= 0.03 ? "text-warn" : "text-ink2");
  return (
    <Card>
      <div className="mb-1.5">
        <ReadLabel>5 · Simulation · projected exposure</ReadLabel>
      </div>
      <p className="mb-4 text-[12.5px] text-ink2">
        Per-plan annual out-of-pocket across the <span className="num">{sim.count}</span> simulated futures · seed{" "}
        <span className="num">{sim.seed}</span>.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-[.03em] text-ink2">
              <th className="px-2.5 py-2 font-semibold">Plan</th>
              <th className="px-2.5 py-2 text-right font-semibold">Mean / yr</th>
              <th className="px-2.5 py-2 text-right font-semibold">Worst / yr</th>
              <th className="px-2.5 py-2 text-right font-semibold">Meds covered</th>
              <th className="px-2.5 py-2 text-right font-semibold">Catastrophic</th>
            </tr>
          </thead>
          <tbody>
            {sim.perPlan.map((s) => (
              <tr key={s.planId} className="border-t border-line">
                <td className="px-2.5 py-[9px] font-medium text-ink">{s.name}</td>
                <td className="num px-2.5 py-[9px] text-right text-ink">{usd(s.meanExposure)}</td>
                <td className="num px-2.5 py-[9px] text-right text-ink2">{usd(s.worstExposure)}</td>
                <td className="num px-2.5 py-[9px] text-right text-ink">{Math.round(s.medCoverageRate * 100)}%</td>
                <td className="px-2.5 py-[9px] text-right">
                  <span className={`num font-semibold ${catColor(s.catastrophicRate)}`}>
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
