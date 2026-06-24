/**
 * Version stamps pinned into every audit record so a recommendation can be
 * reproduced against the EXACT reference data + engine that produced it.
 *
 * - DATA_VERSION identifies the bundled plan-year dataset (lib/data/source/).
 *   Bump it whenever plans-2026.json (or a future plan-year file) changes.
 * - ENGINE_VERSION identifies the scoring/config/simulation logic. Bump it when
 *   weights, thresholds, or the pipeline change in a way that alters output.
 *
 * Because reference data is bundled + git-versioned (not in a mutable DB), these
 * strings + the stored profile snapshot are enough to re-run and verify.
 */
// v2: corrected SCAN citation pages (point at the county benefit tables — LA p.46/47,
// Riverside p.50, San Diego p.52, Connections p.24 — not the portfolio title slide p.19).
export const DATA_VERSION = "plans-2026.v2";
// 1.1.0: agent-based correlated simulation (lib/engine/priors.ts), default 500 agents.
// 1.2.0: de-identified seeding (lib/engine/seed.ts) — cohort keyed to clinical facts, not identity.
export const ENGINE_VERSION = "engine-1.2.0";
