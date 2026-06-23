/**
 * De-identified simulation seeding — the "no bias for any patient" guarantee.
 *
 * The agent cohort must be reproducible (for audit) WITHOUT being keyed to who
 * the patient is. So the seed is derived only from the client's CLINICAL FACTS —
 * age, conditions, medications, BMI, family history, recorded utilization, and
 * any hard provider requirements — and NEVER from identity fields (profile/session
 * id, name/label, ZIP, county, gender, capture source/timestamp).
 *
 * Consequences:
 *  - Two patients with identical clinical facts get the identical cohort → no one
 *    is advantaged or disadvantaged by their identity.
 *  - The same patient re-run later reproduces exactly (facts unchanged) → audit
 *    "reproduced exactly" still holds.
 *  - Nothing about identity leaks into the randomness.
 */

import type { ClientProfileInput } from "@/lib/domain";
import { hashSeed } from "./rng";

/** A stable, order-independent string of de-identified clinical facts only. */
export function clinicalSeedKey(profile: ClientProfileInput): string {
  const meds = profile.medications
    .map((m) => m.drugId ?? m.name ?? "")
    .filter(Boolean)
    .sort();
  const fam = profile.familyHistory.map((f) => `${f.condition}=${f.status}`).sort();
  const providers = profile.providerConstraints
    .filter((c) => c.hardRequirement)
    .map((c) => c.systemId ?? c.providerId ?? "")
    .filter(Boolean)
    .sort();
  const u = profile.utilization;

  return [
    `age:${profile.age}`,
    `cond:${[...profile.conditions].sort().join(",")}`,
    `meds:${meds.join(",")}`,
    `bmi:${profile.bmi != null ? Math.round(profile.bmi) : ""}`,
    `fam:${fam.join(",")}`,
    `util:${[u?.acupunctureVisits12mo, u?.specialistVisits12mo, u?.priorYearInpatientEvents]
      .map((x) => x ?? "")
      .join("/")}`,
    `prov:${providers.join(",")}`,
  ].join("|");
}

/** Deterministic seed from clinical facts only. `salt` separates parallel sims. */
export function clinicalSeed(profile: ClientProfileInput, salt = ""): number {
  return hashSeed(clinicalSeedKey(profile) + salt);
}
