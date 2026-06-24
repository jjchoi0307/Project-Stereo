# SCAN fit to patients — simulation report

**Method.** 12 realistic SoCal Medicare archetypes × 60 sampled patients = **720 patients per run, run on two independent random seeds (1,440 patients total)**, each scored through the production engine (`runEngine`). Patients vary by age, region, conditions, medications, utilization, and provider must-keeps consistent with each archetype. Results are reported on **pure fit** (preference weighting OFF) and with the product's **bounded preference weighting** (+4 SMG / +1 SCAN, capped at 5, logged to every audit record). Reproduce with `npx tsx scripts/sim-scan-segments.ts`.

> This is an honest read, not a sales number. Nothing is tuned to favor SCAN; the pure-fit figures are the engine's objective ranking.

## Headline (all patients)

| Metric (pure fit) | SCAN |
|---|---|
| Eligible (any rank) | **~55%** |
| In top 3 | **~50%** |
| #1 recommendation | **~23–27%** |
| #1 **with** preference weighting | **~50%** |

SCAN is a **top-tier carrier**: eligible for over half of patients and a top-3 recommendation for half — on facts alone. For the **#1 slot on pure fit it co-leads** with Alignment and Anthem (all three cluster in the ~25–45% range within a segment); the exact leader shifts patient-to-patient. Once the disclosed preference weighting is applied, SCAN is the single most-recommended carrier (~50%).

## Where SCAN is strongest (stable across both seeds)

SCAN lands in the **top 3 on pure fit** for essentially every member without a Cedars/UCLA lock:

| Segment | SCAN in top 3 (pure fit) |
|---|---|
| Well-controlled T2 diabetes | **75%** |
| Cardiac (CHF / CAD) | 63–70% |
| Healthy active senior | 68–73% |
| Active cancer treatment | 60–73% |
| Frail multimorbid 80+ | 62–70% |
| Complex diabetes (insulin/CKD) | 57–68% |
| COPD / respiratory | 57–67% |
| Behavioral health | 63–65% |
| Cost-sensitive, minimal needs | 63–68% |

**Why, from the data:** SCAN Classic carries a **$0 premium and a $199 out-of-pocket max** — the lowest MOOP in the catalog — and the SCAN network includes Seoul Medical Group, so it clears the hard rules and scores high on downside protection for exactly the chronic, higher-utilization members where plan fit matters most (diabetes, cardiac, frail multimorbid). SCAN's C-SNP / D-SNP plans add diabetes- and dual-eligible-specific coverage that reinforces this in the chronic segments.

## Where SCAN does not win (equally factual)

- **Members who must keep Cedars-Sinai or UCLA Health: SCAN 0%.** SCAN's networks don't contract those systems, so the engine correctly excludes every SCAN plan. (UCLA members are served almost only by the UnitedHealthcare–UCLA plan; Cedars members go to Alignment/Anthem.) *Note: the Humana network mapping is currently a placeholder pending the real provider directory.*
- **Acupuncture-oriented members: SCAN 0% top-3.** The newly added **Humana Gold Plus H5619-021** ($0 premium, $410 MOOP, 20 acupuncture visits) wins this niche (~37%). SCAN is eligible but out-scored on the acupuncture-fit term.
- **Co-leader, not a runaway.** In complex-diabetes, cardiac, behavioral-health, and COPD segments, **Alignment** (broad network incl. Cedars, $0/$499 MOOP) and **Anthem** edge SCAN for the #1 slot on some seeds.

## Bottom line — what is defensible to claim

1. **"SCAN is eligible for the majority of clients and a top-3 fit for half — on objective fit."** ✅ Stable across seeds.
2. **"SCAN is a co-leading carrier for the #1 recommendation, and the single most-recommended plan family in the tool once SMG's disclosed plan preference is applied."** ✅ — must state the preference is on and is logged.
3. **"SCAN's sweet spot is chronic / high-acuity members (diabetes, cardiac, frail multimorbid) without a Cedars/UCLA requirement, driven by its $0-premium / $199-MOOP design and SMG-network inclusion."** ✅ The strongest, most specific, fully fact-based partnership story.

What is **not** supportable: that SCAN wins outright for most patients on pure fit (it co-leads, and loses members locked to Cedars/UCLA). Leading with the segment story above is both more credible and more useful to brokers.
