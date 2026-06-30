/**
 * Builds the reproducible audit record for a recommendation. It captures
 * everything needed to reproduce and review a single recommendation: the exact
 * inputs (profile snapshot), the normalized profile, the full exclusion log, the
 * scenario seed + count, every per-plan score (including the bounded, visible
 * `preferenceContribution`), the final ranking, and whether preference weighting
 * changed the top pick. Nothing here is fabricated — every value traces back to
 * the seeded plan data through the shared engine pipeline.
 */

import type { AuditAiRecommendation, AuditRecord, ClientProfileInput } from "@/lib/domain";
import type { EngineRun } from "@/lib/engine/pipeline";
import { DATA_VERSION, ENGINE_VERSION } from "@/lib/version";
import { signAuditRecord } from "./integrity";

/** Stable id per facts-version so re-viewing the same recommendation upserts
 *  rather than duplicating, while a correction (new capturedAt) makes a new one. */
export function auditIdFor(profile: ClientProfileInput): string {
  const stamp = profile.capturedAt.replace(/\D/g, "").slice(0, 14);
  return `aud-${profile.id.replace("profile-", "")}-${stamp}`;
}

export function buildAuditRecord(
  profile: ClientProfileInput,
  run: EngineRun,
  ai?: AuditAiRecommendation | null,
): AuditRecord {
  const record: AuditRecord = {
    id: auditIdFor(profile),
    createdAt: new Date().toISOString(),
    dataVersion: DATA_VERSION,
    engineVersion: ENGINE_VERSION,
    profileSnapshot: profile,
    normalizedProfile: run.normalized,
    exclusionLog: run.rules.log,
    scenarioSeed: run.sim.seed,
    scenarioCount: run.sim.count,
    perPlanScores: run.scoring.ranked,
    ranking: run.scoring.ranked.map((s) => s.planId),
    preferenceWeightingEnabled: run.scoring.preferenceWeightingEnabled,
    preferenceChangedTop: run.scoring.preferenceChangedTop,
    aiRecommendation: ai ?? null,
  };
  // Sign last, over the complete content, so the stored payload is tamper-evident
  // (no-op when no key is configured — see lib/audit/integrity.ts).
  return signAuditRecord(record);
}
