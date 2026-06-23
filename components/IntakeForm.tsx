"use client";

import { useMemo, useState } from "react";
import { computeBmi, type CaptureSource, type ConditionFlag, type Gender, type YesNoUnknown } from "@/lib/domain";
import { emptyIntakeValues, type IntakeFormValues, type IntakeReference } from "@/lib/intake/types";
import { validateIntake, type IntakeValidation } from "@/lib/intake/validate";
import type { BrokerSession } from "@/lib/session/store";

const labelCls = "block text-sm font-medium text-slate-700";
const inputCls =
  "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";
const errCls = "mt-1 text-xs text-rose-600";

const COPY = {
  broker: {
    title: "Client intake",
    intro: "Capture the client's facts. Only age, region, and one medication or condition are required.",
  },
  patient: {
    title: "Your health facts",
    intro:
      "Please share a few facts so your broker can match you to the right plan. There are no right or wrong answers — just what's true for you.",
  },
};

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

  const setMed = (i: number, val: string) =>
    update({ medications: v.medications.map((m, idx) => (idx === i ? val : m)) });
  const addMed = () => update({ medications: [...v.medications, ""] });
  const removeMed = (i: number) =>
    update({ medications: v.medications.filter((_, idx) => idx !== i) });

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

  const copy = COPY[variant];

  return (
    <form onSubmit={submit} className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-ink">{copy.title}</h2>
        <p className="mt-1 text-sm text-slate-600">{copy.intro}</p>
      </div>

      {/* Basics */}
      <Section title="Basics">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Age <Req /></label>
            <input className={inputCls} inputMode="numeric" value={v.age}
              onChange={(e) => update({ age: e.target.value })} placeholder="e.g. 67" />
            {errors.fields.age && <p className={errCls}>{errors.fields.age}</p>}
          </div>
          <div>
            <label className={labelCls}>Gender</label>
            <select className={inputCls} value={v.gender}
              onChange={(e) => update({ gender: e.target.value as Gender })}>
              <option value="">—</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Market region <Req /></label>
            <select className={inputCls} value={v.marketRegion}
              onChange={(e) => update({ marketRegion: e.target.value })}>
              <option value="">Select region…</option>
              {reference.regions.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            {errors.fields.marketRegion && <p className={errCls}>{errors.fields.marketRegion}</p>}
            <p className="mt-1 text-xs text-slate-400">SMG service area only (Los Angeles, Orange, Santa Clara).</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>ZIP</label>
              <input className={inputCls} value={v.zip} onChange={(e) => update({ zip: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>County</label>
              <input className={inputCls} value={v.county} onChange={(e) => update({ county: e.target.value })} />
            </div>
          </div>
        </div>
      </Section>

      {/* Medications */}
      <Section title="Current medications" hint="Include the strength if known. We'll match each to its plan formulary.">
        <datalist id="drug-suggestions">
          {reference.drugNames.map((n) => <option key={n} value={n} />)}
        </datalist>
        <div className="space-y-2">
          {v.medications.map((m, i) => (
            <div key={i} className="flex gap-2">
              <input className={inputCls} list="drug-suggestions" value={m}
                onChange={(e) => setMed(i, e.target.value)} placeholder="e.g. Metformin 1000mg" />
              {v.medications.length > 1 && (
                <button type="button" onClick={() => removeMed(i)}
                  className="shrink-0 rounded-md border border-slate-300 px-3 text-sm text-slate-500 hover:bg-slate-50">
                  Remove
                </button>
              )}
            </div>
          ))}
          <button type="button" onClick={addMed} className="text-sm font-medium text-accent hover:underline">
            + Add medication
          </button>
        </div>
      </Section>

      {/* Conditions */}
      <Section title="Diagnosed conditions">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {reference.conditionOptions.map((c) => (
            <label key={c.value} className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={v.conditions.includes(c.value)}
                onChange={() => toggleCondition(c.value)} className="rounded border-slate-300 text-accent focus:ring-accent" />
              {c.label}
            </label>
          ))}
        </div>
        <div className="mt-3">
          <label className={labelCls}>Other conditions</label>
          <textarea className={inputCls} rows={2} value={v.conditionsFreeText}
            onChange={(e) => update({ conditionsFreeText: e.target.value })}
            placeholder="Anything not listed above (comma-separated)" />
        </div>
      </Section>

      {/* Vitals */}
      <Section title="Height & weight" hint="Optional — used to estimate BMI.">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className={labelCls}>Height (cm)</label>
            <input className={inputCls} inputMode="numeric" value={v.heightCm}
              onChange={(e) => update({ heightCm: e.target.value })} />
            {errors.fields.heightCm && <p className={errCls}>{errors.fields.heightCm}</p>}
          </div>
          <div>
            <label className={labelCls}>Weight (kg)</label>
            <input className={inputCls} inputMode="numeric" value={v.weightKg}
              onChange={(e) => update({ weightKg: e.target.value })} />
            {errors.fields.weightKg && <p className={errCls}>{errors.fields.weightKg}</p>}
          </div>
          {bmi !== null && <div className="pb-2 text-sm text-slate-600">BMI: <span className="font-semibold text-ink">{bmi}</span></div>}
        </div>
      </Section>

      {/* Family history */}
      <Section title="Family history">
        <div className="grid gap-3 sm:grid-cols-2">
          {reference.familyHistoryConditions.map((c) => (
            <div key={c.value} className="flex items-center justify-between gap-3">
              <span className="text-sm text-slate-700">{c.label}</span>
              <select className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                value={familyStatus(c.value)}
                onChange={(e) => setFamily(c.value, e.target.value as YesNoUnknown | "")}>
                <option value="">—</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>
          ))}
        </div>
      </Section>

      {/* Providers to keep */}
      <Section title="Doctors or hospitals to keep" hint="Hard requirements only — a plan that drops these is excluded.">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {reference.providerSystems.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={v.mustKeepSystemIds.includes(s.id)}
                onChange={() => toggleSystem(s.id)} className="rounded border-slate-300 text-accent focus:ring-accent" />
              {s.name}
            </label>
          ))}
        </div>
      </Section>

      {/* Utilization */}
      <Section title="Recent care (last 12 months)" hint="Optional — counts where known.">
        <div className="grid gap-4 sm:grid-cols-3">
          <NumField label="Acupuncture visits" value={v.acupunctureVisits12mo} err={errors.fields.acupunctureVisits12mo}
            onChange={(x) => update({ acupunctureVisits12mo: x })} />
          <NumField label="Specialist visits" value={v.specialistVisits12mo} err={errors.fields.specialistVisits12mo}
            onChange={(x) => update({ specialistVisits12mo: x })} />
          <NumField label="Hospital stays (prior year)" value={v.priorYearInpatientEvents} err={errors.fields.priorYearInpatientEvents}
            onChange={(x) => update({ priorYearInpatientEvents: x })} />
        </div>
      </Section>

      {errors.form && <p className="text-sm text-rose-600">{errors.form}</p>}
      {serverError && <p className="text-sm text-rose-600">{serverError}</p>}

      <button type="submit" disabled={submitting}
        className="rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
        {submitting ? "Saving…" : submitLabel ?? "Save facts"}
      </button>
    </form>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="border-t border-slate-100 pt-5">
      <legend className="-mt-8 mb-2 bg-white pr-3 text-sm font-semibold text-ink">{title}</legend>
      {hint && <p className="mb-3 text-xs text-slate-500">{hint}</p>}
      {children}
    </fieldset>
  );
}

function Req() {
  return <span className="text-rose-500">*</span>;
}

function NumField({ label, value, err, onChange }: { label: string; value: string; err?: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <input className={inputCls} inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)} />
      {err && <p className={errCls}>{err}</p>}
    </div>
  );
}
