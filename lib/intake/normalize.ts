import type { Drug, Medication } from "@/lib/domain";

/**
 * Best-effort normalization of free-text medications to a known drug code.
 * v1 uses simple name containment against the synthetic drug list; a real
 * RxNorm mapping service plugs in here later. Unmatched rows keep just the raw
 * text — we never drop a fact we couldn't normalize.
 */
export function normalizeMedications(raws: string[], drugs: Drug[]): Medication[] {
  return raws
    .map((r) => r.trim())
    .filter((r) => r.length > 0)
    .map((raw) => {
      const lower = raw.toLowerCase();
      const match = drugs.find((d) => lower.includes(d.name.toLowerCase()));
      return match ? { raw, drugId: match.id, name: match.name } : { raw };
    });
}
