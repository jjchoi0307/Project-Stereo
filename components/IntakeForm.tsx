"use client";

import { useMemo, useRef, useState } from "react";
import { computeBmi, type CaptureSource, type ConditionFlag, type Gender, type YesNoUnknown } from "@/lib/domain";
import { emptyIntakeValues, type IntakeFormValues, type IntakeReference } from "@/lib/intake/types";
import { validateIntake, type IntakeValidation } from "@/lib/intake/validate";
import { SELF_RATED_HEALTH_OPTIONS, SLEEP_QUALITY_OPTIONS } from "@/lib/intake/options";
import type { BrokerSession } from "@/lib/session/store";
import { StepLabel } from "@/components/ui/SectionLabel";
import Spinner from "@/components/ui/Spinner";

const inputCls =
  "w-full rounded-sm border border-line bg-surface px-[11px] py-[9px] text-[13.5px] focus:border-accent";
const labelCls = "mb-1.5 block text-xs font-medium text-ink";
const errCls = "mt-1 text-[11.5px] text-neg";
const divider = <div className="my-[22px] border-t border-line" />;

function bmiCategory(bmi: number): { label: string; cls: string } {
  if (bmi < 18.5) return { label: "Underweight", cls: "text-warn" };
  if (bmi < 25) return { label: "Normal range", cls: "text-pos" };
  if (bmi < 30) return { label: "Overweight", cls: "text-warn" };
  return { label: "Obese", cls: "text-neg" };
}

export default function IntakeForm({
  sessionId,
  submitUrl,
  capturedBy,
  reference,
  initialValues,
  variant,
  submitLabel,
  onSubmitted,
}: {
  /** Broker path: the session id (used to build the default submit URL). */
  sessionId?: string;
  /** Patient path: the capability-token submit URL (`/api/intake/[token]`). */
  submitUrl?: string;
  capturedBy: CaptureSource;
  reference: IntakeReference;
  initialValues?: IntakeFormValues;
  variant: "broker" | "patient";
  submitLabel?: string;
  onSubmitted: (session: BrokerSession) => void;
}) {
  const [v, setV] = useState<IntakeFormValues>(initialValues ?? emptyIntakeValues());
  const [errors, setErrors] = useState<IntakeValidation>({ ok: true, fields: {} });
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (patch: Partial<IntakeFormValues>) => setV((prev) => ({ ...prev, ...patch }));

  const bmi = useMemo(() => {
    const h = Number(v.heightCm), w = Number(v.weightKg);
    return h > 0 && w > 0 ? computeBmi(h, w) : null;
  }, [v.heightCm, v.weightKg]);

  // Stable per-row keys: medications is a string[] (rows can be empty/duplicate),
  // so keying by array index would carry transient DOM state (focus, the datalist
  // popup, IME composition) to the wrong row when a non-last row is removed. We
  // keep a parallel id list mutated in lockstep with the array in add/remove, and
  // backfill it if the parent ever replaces the array wholesale (e.g. prior-profile load).
  const medKeys = useRef<number[]>(v.medications.map((_, i) => i));
  const medSeq = useRef(v.medications.length);
  if (medKeys.current.length !== v.medications.length) {
    medKeys.current = v.medications.map((_, i) => medKeys.current[i] ?? medSeq.current++);
  }

  const setMed = (i: number, val: string) =>
    update({ medications: v.medications.map((m, idx) => (idx === i ? val : m)) });
  const addMed = () => {
    medKeys.current = [...medKeys.current, medSeq.current++];
    update({ medications: [...v.medications, ""] });
  };
  const removeMed = (i: number) => {
    medKeys.current = medKeys.current.filter((_, idx) => idx !== i);
    update({ medications: v.medications.filter((_, idx) => idx !== i) });
  };

  const toggleCondition = (c: ConditionFlag) =>
    update({
      conditions: v.conditions.includes(c)
        ? v.conditions.filter((x) => x !== c)
        : [...v.conditions, c],
    });

  const setFamily = (condition: ConditionFlag, status: YesNoUnknown | "") =>
    update({
      familyHistory:
        status === ""
          ? v.familyHistory.filter((f) => f.condition !== condition)
          : [...v.familyHistory.filter((f) => f.condition !== condition), { condition, status }],
    });
  const familyStatus = (c: ConditionFlag): YesNoUnknown | "" =>
    v.familyHistory.find((f) => f.condition === c)?.status ?? "";

  const toggleSystem = (id: string) =>
    update({
      mustKeepSystemIds: v.mustKeepSystemIds.includes(id)
        ? v.mustKeepSystemIds.filter((x) => x !== id)
        : [...v.mustKeepSystemIds, id],
    });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    const result = validateIntake(v);
    setErrors(result);
    if (!result.ok) return;

    setSubmitting(true);
    try {
      const url = submitUrl ?? `/api/sessions/${sessionId}/intake`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capturedBy, values: v }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.validation) setErrors(data.validation);
        else setServerError(data?.error ?? "Submission failed.");
        return;
      }
      onSubmitted(data.session as BrokerSession);
    } catch {
      setServerError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const defaultLabel = variant === "patient" ? "Send to my broker" : "Save facts & continue →";

  return (
    <form onSubmit={submit}>
      {(errors.form || serverError) && (
        <div className="mb-5 block rounded-sm border border-neg/30 bg-neg/10 px-3.5 py-[11px] text-[13px] text-neg">
          {serverError ?? errors.form}
        </div>
      )}

      {/* 1 Basics */}
      <StepLabel step={1}>Basics</StepLabel>
      <div className="grid grid-cols-2 gap-3.5">
        <div>
          <label className={labelCls}>Age <Req /></label>
          <input className={inputCls} type="number" min={18} max={120} inputMode="numeric" placeholder="e.g. 68"
            value={v.age} onChange={(e) => update({ age: e.target.value })} />
          {errors.fields.age && <div className={errCls}>{errors.fields.age}</div>}
        </div>
        <div>
          <label className={labelCls}>Gender</label>
          <select className={`${inputCls}`} value={v.gender}
            onChange={(e) => update({ gender: e.target.value as Gender })}>
            <option value="">Select…</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Market region <Req /></label>
          <select className={`${inputCls}`} value={v.marketRegion}
            onChange={(e) => update({ marketRegion: e.target.value })}>
            <option value="">SMG service area…</option>
            {reference.regions.map((r) => (
              <option key={r.id} value={r.id}>{r.name} County</option>
            ))}
          </select>
          {errors.fields.marketRegion && <div className={errCls}>{errors.fields.marketRegion}</div>}
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className={labelCls}>ZIP</label>
            <input className={inputCls} inputMode="numeric" placeholder="90048"
              value={v.zip} onChange={(e) => update({ zip: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>County</label>
            <input className={inputCls} placeholder="Los Angeles"
              value={v.county} onChange={(e) => update({ county: e.target.value })} />
          </div>
        </div>
      </div>

      {divider}

      {/* 2 Medications */}
      <StepLabel step={2}>Current medications</StepLabel>
      <p className="-mt-1.5 mb-3 text-xs text-ink2">
        Add each medication the client takes. Start typing for suggestions.
      </p>
      <datalist id="drug-suggestions">
        {reference.drugNames.map((n) => <option key={n} value={n} />)}
      </datalist>
      <div className="mb-2.5 flex flex-col gap-2">
        {v.medications.map((m, i) => (
          <div key={medKeys.current[i] ?? i} className="flex items-center gap-2">
            <input className={`${inputCls} flex-1`} list="drug-suggestions" placeholder="e.g. Metformin 1000mg"
              value={m} onChange={(e) => setMed(i, e.target.value)} />
            <button type="button" onClick={() => removeMed(i)} disabled={v.medications.length <= 1}
              className="h-9 w-9 flex-none rounded-sm border border-line bg-surface text-base text-ink2 disabled:opacity-40 hover:bg-paper">
              −
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={addMed} className="py-1 text-[13px] font-medium text-accent">
        + Add medication
      </button>

      {divider}

      {/* 3 Conditions */}
      <StepLabel step={3}>Diagnosed conditions</StepLabel>
      <div className="mb-3 grid grid-cols-2 gap-x-3.5 gap-y-[7px]">
        {reference.conditionOptions.map((c) => (
          <label key={c.value} className="flex cursor-pointer items-center gap-2.5 py-[3px] text-[13px] text-ink">
            <input type="checkbox" checked={v.conditions.includes(c.value)} onChange={() => toggleCondition(c.value)}
              className="h-4 w-4 flex-none accent-accent" />
            {c.label}
          </label>
        ))}
      </div>
      <input className={inputCls} placeholder="Other conditions (free text)"
        value={v.conditionsFreeText} onChange={(e) => update({ conditionsFreeText: e.target.value })} />

      {divider}

      {/* 4 Height & weight */}
      <StepLabel step={4}>Height &amp; weight</StepLabel>
      <div className="flex flex-wrap items-end gap-3.5">
        <div>
          <label className={labelCls}>Height (cm)</label>
          <input className={`${inputCls} w-[110px]`} type="number" inputMode="numeric" placeholder="163"
            value={v.heightCm} onChange={(e) => update({ heightCm: e.target.value })} />
          {errors.fields.heightCm && <div className={errCls}>{errors.fields.heightCm}</div>}
        </div>
        <div>
          <label className={labelCls}>Weight (kg)</label>
          <input className={`${inputCls} w-[110px]`} type="number" inputMode="numeric" placeholder="75"
            value={v.weightKg} onChange={(e) => update({ weightKg: e.target.value })} />
          {errors.fields.weightKg && <div className={errCls}>{errors.fields.weightKg}</div>}
        </div>
        {bmi !== null && (() => {
          const cat = bmiCategory(bmi);
          return (
            <div className="rounded-sm border border-line bg-paper px-3.5 py-2">
              <div className="eyebrow text-ink2">BMI</div>
              <div className="flex items-baseline gap-2">
                <span className="num text-lg font-semibold text-ink">{bmi}</span>
                <span className={`text-xs font-semibold ${cat.cls}`}>{cat.label}</span>
              </div>
            </div>
          );
        })()}
      </div>

      {divider}

      {/* 5 Family history */}
      <StepLabel step={5}>Family history</StepLabel>
      <div className="flex flex-col gap-2">
        {reference.familyHistoryConditions.map((c) => {
          const cur = familyStatus(c.value);
          return (
            <div key={c.value} className="flex items-center justify-between gap-3">
              <span className="text-[13px] text-ink">{c.label}</span>
              <div className="flex gap-1.5">
                {(["yes", "no", "unknown"] as const).map((opt) => (
                  <FamilyButton key={opt} active={cur === opt}
                    label={opt === "unknown" ? "Unknown" : opt === "yes" ? "Yes" : "No"}
                    onClick={() => setFamily(c.value, cur === opt ? "" : opt)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {divider}

      {/* 6 Providers */}
      <StepLabel step={6}>Doctors / hospitals to keep</StepLabel>
      <p className="-mt-1.5 mb-3 text-xs text-ink2">
        Selected systems become <strong className="text-ink">hard requirements</strong> — plans not
        contracting them are excluded.
      </p>
      <div className="grid grid-cols-2 gap-x-3.5 gap-y-[7px]">
        {reference.providerSystems.map((s) => (
          <label key={s.id} className="flex cursor-pointer items-center gap-2.5 py-[3px] text-[13px] text-ink">
            <input type="checkbox" checked={v.mustKeepSystemIds.includes(s.id)} onChange={() => toggleSystem(s.id)}
              className="h-4 w-4 flex-none accent-accent" />
            {s.name}
          </label>
        ))}
      </div>

      {divider}

      {/* 7 Recent care */}
      <StepLabel step={7}>Recent care · last 12 months</StepLabel>
      <div className="grid grid-cols-3 gap-3.5">
        <NumField label="Acupuncture" value={v.acupunctureVisits12mo} err={errors.fields.acupunctureVisits12mo}
          onChange={(x) => update({ acupunctureVisits12mo: x })} />
        <NumField label="Specialist" value={v.specialistVisits12mo} err={errors.fields.specialistVisits12mo}
          onChange={(x) => update({ specialistVisits12mo: x })} />
        <NumField label="Inpatient" value={v.priorYearInpatientEvents} err={errors.fields.priorYearInpatientEvents}
          onChange={(x) => update({ priorYearInpatientEvents: x })} />
      </div>

      {divider}

      {/* 8 Lifestyle & well-being */}
      <StepLabel step={8}>Lifestyle &amp; well-being</StepLabel>
      <p className="-mt-1.5 mb-3 text-xs text-ink2">
        All optional and self-reported — these add light context and are not weighted heavily.
      </p>
      <div className="grid grid-cols-2 gap-3.5">
        <NumField label="Average daily steps" value={v.avgDailySteps} err={errors.fields.avgDailySteps}
          onChange={(x) => update({ avgDailySteps: x })} />
        <NumField label="Sleep (hours/night)" value={v.sleepHoursPerNight} err={errors.fields.sleepHoursPerNight}
          onChange={(x) => update({ sleepHoursPerNight: x })} />
        <div>
          <label className={labelCls}>Sleep quality</label>
          <select className={`${inputCls}`} value={v.sleepQuality}
            onChange={(e) => update({ sleepQuality: e.target.value as IntakeFormValues["sleepQuality"] })}>
            <option value="">Select…</option>
            {SLEEP_QUALITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {errors.fields.sleepQuality && <div className={errCls}>{errors.fields.sleepQuality}</div>}
        </div>
        <div>
          <label className={labelCls}>Overall health, self-rated</label>
          <select className={`${inputCls}`} value={v.selfRatedHealth}
            onChange={(e) => update({ selfRatedHealth: e.target.value as IntakeFormValues["selfRatedHealth"] })}>
            <option value="">Select…</option>
            {SELF_RATED_HEALTH_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {errors.fields.selfRatedHealth && <div className={errCls}>{errors.fields.selfRatedHealth}</div>}
        </div>
      </div>

      {divider}

      {/* 9 Dual eligibility — gates D-SNP plans */}
      <StepLabel step={9}>Dual eligibility</StepLabel>
      <label className="flex cursor-pointer items-start gap-3 rounded-sm border border-line bg-surface px-3.5 py-3">
        <input
          type="checkbox"
          className="mt-0.5 accent-accent"
          checked={v.dualEligible}
          onChange={(e) => update({ dualEligible: e.target.checked })}
        />
        <span className="text-[13px] leading-[1.5] text-ink">
          <span className="font-semibold">Dual-eligible (Medicare + Medi-Cal)</span>
          <span className="block text-[12px] text-ink2">
            Check only if the client is confirmed dual-eligible. Dual-eligible Special Needs Plans (D-SNPs) are
            shown only when this is checked.
          </span>
        </span>
      </label>

      {divider}

      {/* Consent — required to submit (enforced in validateIntake) */}
      <label className="flex cursor-pointer items-start gap-3 rounded-sm border border-line bg-surface px-3.5 py-3">
        <input
          type="checkbox"
          className="mt-0.5 accent-accent"
          checked={v.consentAcknowledged}
          onChange={(e) => update({ consentAcknowledged: e.target.checked })}
        />
        <span className="text-[13px] leading-[1.5] text-ink">
          I confirm the member consents to using this information to recommend a Medicare plan.{" "}
          <span className="text-ink2">This is not medical advice.</span>
        </span>
      </label>
      {errors.fields.consentAcknowledged && <div className={errCls}>{errors.fields.consentAcknowledged}</div>}

      <button type="submit" disabled={submitting}
        className="mt-[26px] flex w-full items-center justify-center gap-2.5 rounded-sm bg-accent py-[13px] text-[14.5px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
        {submitting && <Spinner light size={15} />}
        {submitting ? "Saving…" : submitLabel ?? defaultLabel}
      </button>
    </form>
  );
}

function FamilyButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      aria-pressed={active}
      className={`rounded-sm border px-[13px] py-[5px] text-[10.5px] font-semibold uppercase tracking-[.04em] ${
        active
          ? "border-accent bg-accent text-white"
          : "border-line bg-surface text-ink2 hover:bg-paper"
      }`}>
      {label}
    </button>
  );
}

function Req() {
  return <span className="text-neg">*</span>;
}

function NumField({ label, value, err, onChange }: { label: string; value: string; err?: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <input className={inputCls} type="number" min={0} inputMode="numeric" placeholder="0"
        value={value} onChange={(e) => onChange(e.target.value)} />
      {err && <div className={errCls}>{err}</div>}
    </div>
  );
}
