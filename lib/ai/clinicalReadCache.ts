/**
 * Shared cache accessor for the AI clinical read (risk markers + Health Futures).
 *
 * Both the clinical-read route (the Health Futures card) and the horizon
 * recommendation read the SAME clinical read for a session, so they must agree on
 * the cache key and compute it at most once per facts-version. Keeping the key +
 * load logic here prevents the two callers from drifting (which is exactly how the
 * Health Futures card and the recommendation projection diverged before).
 */
import "server-only";
import type { ClientProfileInput } from "@/lib/domain";
import { SIM_MODEL, simConfigured } from "@/lib/sim/env";
import { AI_VERSION, DATA_VERSION } from "@/lib/version";
import { factsSignature } from "@/lib/engine/factsSignature";
import { getHorizonPayload, setHorizonPayload } from "@/lib/engine/horizonCacheStore";
import { guidanceFromConfig, type ImportanceConfig } from "@/lib/config/orgSettings";
import { aiClinicalRead, type ClinicalRead } from "./clinicalRead";

export function clinicalReadCacheKey(id: string, profile: ClientProfileInput, config: ImportanceConfig): string {
  const cfgSig = Object.values(config).map((v) => (v === "high" ? "H" : "L")).join("");
  // DATA_VERSION is part of the key: the clinical read embeds projected drug
  // NAMES resolved from the plan-year dataset, so a data bump must invalidate the
  // cached read (the sibling horizon key already includes DATA_VERSION).
  return `clinicalread:${id}:${factsSignature(profile)}:${SIM_MODEL}:${DATA_VERSION}:${AI_VERSION}:${cfgSig}:h3-5`;
}

/** Cached clinical read for a session. Returns null if AI is unconfigured or fails. */
export async function loadClinicalRead(
  id: string,
  profile: ClientProfileInput,
  config: ImportanceConfig,
): Promise<ClinicalRead | null> {
  const key = clinicalReadCacheKey(id, profile, config);
  const cached = await getHorizonPayload(key);
  if (cached) return cached as ClinicalRead;
  if (!simConfigured()) return null;
  try {
    const result = await aiClinicalRead(profile, guidanceFromConfig(config));
    await setHorizonPayload(key, result);
    return result;
  } catch (e) {
    console.error("clinical read failed:", (e as Error)?.message);
    return null;
  }
}
