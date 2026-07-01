# Real 2026 plan data — source of truth

`plans-2026.json` is the **faithful extraction** of the 2026 SMG-supported Medicare
Advantage plans, transcribed from the carrier PDFs in `SMG Healthplans/`:

| Carrier | Contract | Source document | dataSource tag |
|---|---|---|---|
| Alignment Health Plan | H3815 | `2026_Benefit_Highlights_CA_H3815_*` | `benefit-highlights` |
| Clever Care Health Plan | H7607 | `CY26_SB_{LGV,VAL,BRP,TLP}_*` | `summary-of-benefits` |
| Anthem Blue Cross | H4471 / H0544 | `1081748CASENABC_*`, `1083126CASENABC_*` | `summary-of-benefits` |
| UnitedHealthcare | H0543 / H4647 | `2026 MA Benefits UHC.pdf`, `2026-info-kit-uhmap-combined` | `summary-of-benefits` |
| SCAN Health Plan | (deck) | `2026 Benefit Rollout Presentation_ Southern CA.pdf` | `rollout-deck` |

**Faithfulness rules**
- Dollar amounts and copays are transcribed as printed. String fields hold the
  verbatim plan language; the transformer (`lib/data/fixtures/plans.ts`) derives
  the engine's numeric fields from them with documented assumptions.
- `rollout-deck` SCAN plans only have the deck's per-county comparison numbers
  (premium / MOOP / dental / OTC / flex / transport / vision) plus the deck's
  carrier-level pharmacy slide; their per-plan copays use those carrier defaults
  and are tagged accordingly. Treat them as lower-fidelity than the per-plan SBs.
- Six UHC plans appeared in the compare grid as summary-only stubs with no benefit
  detail (`CA-003P`, `CA-19`, `CA-20`, `CA-021P`, `CA-37P`, `Patriot No-RX`); they
  are intentionally **omitted** rather than fabricated. Add them if/when their SBs
  are provided.

This file is the foundation: nothing else (the prior synthetic SCAN/Astiva/Clever
Care "competitor" fixtures) should be referenced for plan facts.

**v5 corrections — full PDF re-audit (all 20 source docs cross-checked page-by-page
against every transcribed field, via a fan-out of per-PDF reader agents):**
- Anthem Full Dual (`1081748CASENABC_0228`): `sourcePage` 13→14 (13 was the FAQ page;
  benefit detail starts p.14 — note the doc's printed footer lags the PDF index by 1);
  `partDDeductible` "$0"→"$615 Tiers 3-5; $0 with Extra Help" (as-printed; full-duals pay $0).
- SCAN Strive (`scan-strive-csnp`): `partCDeductible` de-conflated — the $615 was the
  Part D **Rx** deductible (already in `partDDeductible`), not a Part C medical deductible → null.
- Alignment: dental ranges corrected (013/031 low end $15 not $20; 039 comprehensive is
  $0 copay + $500/qtr, not the 044/045 "Medicare-covered 20%" language); 044/045 `partCDeductible`
  null→$0; ambulance "(not waived if admitted)" qualifier restored (039/041/042/044/045);
  041/042 inpatient lifetime-reserve bands completed.
- Clever Value: mental-health split into inpatient/outpatient; `sourcePage` 3→5.
- UHC Complete Care Support 1AP/2AP: `partCDeductible` null→$261 (as printed; 1AP premium $0→$12).
- Humana (`H5619*`): the three plans (previously unsourced) verified against their SBs;
  plan 021 corrected — ambulance (air $1,250), mental-health, OTC ($100/qtr), fitness (SilverSneakers).

**NEW field `partBGiveback`** ($/mo Part B premium give-back) added to every plan and
populated for the 11 give-back plans (e.g. LA/SD Premium Giveback $185, SmartSavings $150,
Humana 146 $105, 121 $65). It is netted into the member's annual cost (`lib/ai/costCalc.ts`)
and shown to the ranking model, so give-back plans are no longer undervalued. A sweep of the
Part B Rebate row on the remaining per-plan Alignment SBs (small $0–$5 rebates) is a possible
follow-up; unlisted plans default to 0.

**Known non-PDF modeling assumption:** drug-level formulary coverage
(`lib/data/fixtures/formularies.ts`) is a standard-placement assumption, NOT transcribed —
the SBs give per-tier cost share but not drug-by-drug placement.
