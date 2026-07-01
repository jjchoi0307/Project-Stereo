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
// v3: SNP eligibility gating (D-SNP requires dual eligibility; C-SNP requires a
// qualifying condition) changes the candidate set — invalidate cached recs.
// v4: inpatient parser now reads ALL per-day bands (worst-case non-zero) instead
// of only the first strict-format band, so several plans' derived inpatient
// cost-share changed from a silent $0 to their real value — changes simulation
// exposure for those plans; invalidate cached recs.
// v5: PDF-audit corrections (17-PDF cross-check) — Anthem full-dual source page
// 13→14 + Part D deductible $615; SCAN Strive partC deductible de-conflated from the
// Rx deductible; Alignment dental ranges / ambulance qualifiers / 044-045 $0
// deductible; Clever Value mental-health + page; Humana (H5619) plans verified &
// corrected (ambulance/mental-health/OTC/fitness). NEW partBGiveback field populated
// for 11 give-back plans and netted into cost. Invalidate cached recs.
export const DATA_VERSION = "plans-2026.v5";
// 1.1.0: agent-based correlated simulation (lib/engine/priors.ts), default 500 agents.
// 1.2.0: de-identified seeding (lib/engine/seed.ts) — cohort keyed to clinical facts, not identity.
export const ENGINE_VERSION = "engine-1.2.0";

/**
 * Version of the AI recommendation/horizon/clinical-read LOGIC (prompts, pipeline,
 * projection, scoring). The AI results are cached in a PERSISTENT store (Supabase
 * horizon_cache), and the cache keys key only on data/model/facts — so without this
 * stamp, changing the AI code would keep serving STALE cached payloads after deploy.
 * BUMP THIS whenever the AI recommendation/horizon/clinical-read behavior changes.
 *
 * 2.0.0: horizons run Today's pipeline on a projected profile; deterministic
 *        projection shared with Health Futures; carrier-cap removed; full ranked
 *        tail at each horizon; lineup-aware "changes vs today".
 * 2.1.0: catastrophic-downside sub-score anchored to actual OOP-max dollars (a
 *        lower-OOP plan now provably scores better on worst-case exposure); plus
 *        the audit-batch changes (de-identified rec prompt, citation grounding).
 * 2.2.0: carrier-blind model input — the ranking/write-up prompts identify plans
 *        only by opaque tokens (no carrier/brand/name/source), so the model cannot
 *        favor a carrier (proven by scripts/test-neutrality.ts).
 * 2.3.0: headline annual cost clamped to the plan's [premium, premium+OOP-max]
 *        envelope (clampAnnualCost), and a degraded run (no grounded deep write-up)
 *        now fails retryable + uncached instead of surfacing ungrounded rows.
 * 2.4.0: the displayed annual cost is now COMPUTED deterministically from grounded
 *        facts + the member's reported utilization (lib/ai/costCalc.ts) — the model
 *        no longer produces any dollar figure. Covered cost-share caps at the
 *        OOP-max; uncovered (off-formulary) exposure is added uncapped.
 * 2.5.0: STABLE ranking — the screen ensemble now returns the five fit sub-scores
 *        per plan and they are AVERAGED across all runs; selection, ordering, and
 *        the displayed fit breakdown all derive from that mean (with a fit-margin
 *        neutral tiebreak). Replaces top-3 vote-banding, which quantized each run
 *        and let a single un-ensembled deep sample decide the shown #1/#2/#3 order
 *        (measured 70–82% order-flip between reruns). The deep write-up now only
 *        NARRATES the averaged scores. Invalidate cached recs.
 */
export const AI_VERSION = "ai-2.5.0";
