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
