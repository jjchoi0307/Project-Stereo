# DESIGN.md — "SMG" (locked DNA)

The governing design contract for the SMG Broker Engagement Tool UI. Re-read at
every checkpoint; edit this file *before* deviating; audit against it in polish
passes. Derived via the `frontend-design` + `design-for-ai` methods and grounded
in **Seoul Medical Group's real brand** (logo + seoulmedicalgroup.com).

> A prior "Ledger" pass (grey ground, hard hairline rectangles, editorial serif)
> read as generic-AI-designer and was rejected. This DNA is grounded in SMG's
> actual identity instead of an invented aesthetic.

## Direction
A broker-facing Medicare Advantage recommender that looks and feels like **Seoul
Medical Group**: clean white, vivid SMG green + trustworthy blue, a friendly
professional sans, soft rounded forms, warm and accessible — built for the
Korean-American seniors (and their families) SMG serves. Approachable and
trustworthy, never cold or austere. Still data-honest: every figure is mono and
traceable; the recommendation is reproducible and re-verifiable.

## Signature move
The **verification seal** — a notary-style engraved ring (SMG green) that fires
on the audit record's Verify ("✓ Ranking reproduced exactly") and marks the
delivered recommendation as on-record. Paired with a mono provenance line
(engine · data version · seed · audit id). It embodies the product thesis:
provable, re-verifiable, not a black box.

## Type
- **Display + Body** (`--font-sans`, **Plus Jakarta Sans**, fallback system-ui):
  a friendly, professional humanist sans for all headings and UI. `.display` sets
  it heavy (700) and tight. NOT Inter/Roboto; NOT a serif.
- **Data** (`--font-mono`, IBM Plex Mono): every figure, id, money, percent,
  provenance. `font-variant-numeric: tabular-nums`.
- Self-hosted via `next/font` (no Google beacon; satisfies the strict CSP).

## Color tokens (WCAG AA verified by construction)
| token | hex | use |
|---|---|---|
| `ground` | `#f5f8fc` | app background (clean, faint cool blue — NOT grey/cream) |
| `paper` | `#eef3fb` | faint tint for sub-surfaces / hovers / table headers |
| `surface` | `#ffffff` | white cards |
| `ink` | `#142433` | primary text (15.8 on white) |
| `ink2` | `#5b6b7a` | secondary text (5.5 on white) |
| `line` | `#e4e9f0` | soft cool borders |
| `accent` | `#047a32` | interactive green — AA-safe as fill+white-text & as text-on-white (5.5) |
| `accent-strong` | `#036628` | hover / pressed / seal engraving |
| `brand` | `#00a840` | SMG vivid identity green — marks, bars, active dots, accents |
| `blue` | `#005098` | SMG secondary blue — links, trust accents (8.1 on white) |
Semantics: `pos #00a840` (positive/eligible), `warn #b07514` (tradeoff/awaiting),
`neg #c23b3b` (exclusion/error), `ai #6b46c1` (AI/interpretive layer), `prov #005098`
(patient provenance).

## Space, shape, depth
- **Radius: soft.** sm 6 · DEFAULT/md 8 · lg 10 · xl 12 · 2xl 16px. The seal is
  the only full circle. (Hard 2px rectangles were the rejected "boxy" look.)
- **Cards: white, rounded-xl, 1px `line` border + soft `shadow-card`.** Clean
  cards with gentle elevation — approachable, not hairline boxes.
- **Shadow:** one soft brand-tinted elevation (`shadow-card`); never harsh.
- Generous whitespace; tight within a group, generous between sections.

## Motion
- ~150ms, `ease-out`, opacity + small transform. State-change only.
- No bounce/elastic. `prefers-reduced-motion`: disable all.

## Never (kill list)
- ❌ Grey/grey-green or cream app grounds. The ground is clean white / faint cool blue.
- ❌ Hard hairline rectangles as the dominant surface (the rejected "boxy" look).
- ❌ Serif display faces (the editorial-AI tell) or Inter/Roboto.
- ❌ Muted teal — SMG's green is the brand color; use it.
- ❌ Pure black `#000`; cyan-on-dark; purple→blue or any decorative gradients;
  gradient text on headings/metrics; monospace used decoratively (mono = data).

## Implementation order
1. Tokens (`tailwind.config.ts`, `app/globals.css`) + retire shadows/radius.
2. Shared primitives: `Card`→ruled record surface, `RecordSeal`, `FitScore`,
   `Header` masthead, hairline `Rule`/section-label helpers.
3. Flagship: recommendation (`RecommendationView`, page) as the certificate of
   record. Other screens inherit tokens + reskin in later passes.
Preserve every endpoint/data contract — presentation only.
