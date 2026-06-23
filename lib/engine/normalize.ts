/**
 * Layer 2 — profile normalization. Converts raw intake facts into a structured
 * risk/need profile. Each marker is a deterministic, additive function of facts,
 * and carries a `trace` of exactly which inputs produced it so the eventual
 * recommendation can explain itself and the audit record can reproduce it.
 *
 * No opinions are read — only diagnosed conditions, medications (by drug class),
 * family history, BMI, age, and recorded utilization.
 */

import type {
  ClientProfileInput,
  ConditionFlag,
  Drug,
  NormalizedProfile,
  RiskBand,
  RiskMarker,
} from "@/lib/domain";

function bandFor(value: number): RiskBand {
  if (value >= 0.75) return "very_high";
  if (value >= 0.5) return "high";
  if (value >= 0.25) return "moderate";
  return "low";
}

/** Accumulates weighted contributions and records each as a trace line. */
class Marker {
  private v = 0;
  private readonly traceLines: string[] = [];

  add(amount: number, reason: string): void {
    if (amount <= 0) return;
    this.v += amount;
    this.traceLines.push(`${reason} (+${amount.toFixed(2)})`);
  }

  build(): RiskMarker {
    const value = Math.min(1, Math.max(0, Math.round(this.v * 100) / 100));
    return {
      value,
      band: bandFor(value),
      trace: this.traceLines.length ? this.traceLines : ["no contributing factors"],
    };
  }
}

export function normalizeProfile(profile: ClientProfileInput, drugs: Drug[]): NormalizedProfile {
  const cond = new Set<ConditionFlag>(profile.conditions);
  const drugIndex = new Map(drugs.map((d) => [d.id, d]));
  const medClasses = new Set<string>();
  for (const m of profile.medications) {
    if (m.drugId) {
      const d = drugIndex.get(m.drugId);
      if (d) medClasses.add(d.therapeuticClass);
    }
  }
  const family = (c: ConditionFlag) => profile.familyHistory.find((f) => f.condition === c);
  const bmi = profile.bmi;
  const util = profile.utilization;

  // ── Diabetes (likelihood & severity) ──────────────────────────────────────
  const diabetes = new Marker();
  if (cond.has("diabetes")) diabetes.add(0.55, "diagnosed Type 2 diabetes");
  else if (cond.has("prediabetes")) diabetes.add(0.3, "prediabetes");
  if (medClasses.has("long-acting insulin")) diabetes.add(0.25, "insulin therapy (higher severity)");
  if (medClasses.has("biguanide")) diabetes.add(0.12, "metformin");
  if (medClasses.has("SGLT2 inhibitor")) diabetes.add(0.12, "SGLT2 inhibitor");
  if (cond.has("obesity") || (bmi != null && bmi >= 30))
    diabetes.add(0.12, bmi != null ? `BMI ${bmi} (obese)` : "obesity");
  if (family("diabetes")?.status === "yes") diabetes.add(0.08, "family history of diabetes");

  // ── Oncology risk ─────────────────────────────────────────────────────────
  const oncologyRisk = new Marker();
  if (cond.has("cancer_active")) oncologyRisk.add(0.7, "active cancer diagnosis");
  else if (cond.has("cancer_history")) oncologyRisk.add(0.4, "cancer history");
  if (medClasses.has("oncology immunotherapy")) oncologyRisk.add(0.45, "oncology drug in regimen");
  const famCancer = family("cancer_history");
  if (famCancer?.status === "yes") {
    const rel = famCancer.affectedRelativesCount ?? 1;
    oncologyRisk.add(Math.min(0.15, 0.05 * rel), `family history of cancer (${rel} relative${rel > 1 ? "s" : ""})`);
  }
  if (profile.age >= 70) oncologyRisk.add(0.05, "age ≥ 70");

  // ── Mental-health utilization ─────────────────────────────────────────────
  const mentalHealthUtilization = new Marker();
  if (cond.has("depression")) mentalHealthUtilization.add(0.4, "diagnosed depression");
  if (cond.has("anxiety")) mentalHealthUtilization.add(0.3, "diagnosed anxiety");
  if (medClasses.has("SSRI")) mentalHealthUtilization.add(0.3, "SSRI therapy");
  if (family("depression")?.status === "yes")
    mentalHealthUtilization.add(0.1, "family history of mental-health condition");

  // ── Specialist need ───────────────────────────────────────────────────────
  const specialistNeed = new Marker();
  const chronic: ConditionFlag[] = ["diabetes", "cad", "ckd", "copd", "chf", "cancer_active"];
  for (const c of chronic) if (cond.has(c)) specialistNeed.add(0.1, `chronic condition: ${c}`);
  if (cond.has("cancer_active")) specialistNeed.add(0.2, "oncology follow-up");
  if (util?.specialistVisits12mo != null) {
    const n = util.specialistVisits12mo;
    specialistNeed.add(Math.min(0.5, n * 0.08), `${n} specialist visit(s) in last 12 mo`);
  }
  if (profile.age >= 75) specialistNeed.add(0.05, "age ≥ 75");

  // ── Drug-utilization intensity ────────────────────────────────────────────
  const drugUtilizationIntensity = new Marker();
  const medCount = profile.medications.length;
  if (medCount) drugUtilizationIntensity.add(Math.min(0.5, medCount * 0.12), `${medCount} current medication(s)`);
  if (medClasses.has("long-acting insulin")) drugUtilizationIntensity.add(0.15, "insulin (specialty handling)");
  if (medClasses.has("oncology immunotherapy")) drugUtilizationIntensity.add(0.25, "specialty oncology drug");
  if (medCount >= 5) drugUtilizationIntensity.add(0.1, "polypharmacy (≥ 5 meds)");

  // ── Network sensitivity (driven by hard provider constraints) ─────────────
  const networkSensitivity = new Marker();
  const hard = profile.providerConstraints.filter((c) => c.hardRequirement);
  if (hard.length) {
    networkSensitivity.add(0.7, `hard provider requirement: ${hard[0].label}`);
    if (hard.length > 1)
      networkSensitivity.add(Math.min(0.2, (hard.length - 1) * 0.1), `${hard.length - 1} additional required provider(s)`);
  }
  if (cond.has("cancer_active")) networkSensitivity.add(0.1, "established active-treatment relationships");

  return {
    profileId: profile.id,
    diabetes: diabetes.build(),
    oncologyRisk: oncologyRisk.build(),
    mentalHealthUtilization: mentalHealthUtilization.build(),
    specialistNeed: specialistNeed.build(),
    drugUtilizationIntensity: drugUtilizationIntensity.build(),
    networkSensitivity: networkSensitivity.build(),
  };
}
