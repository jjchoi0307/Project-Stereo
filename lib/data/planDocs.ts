/**
 * Generated map from a plan.sourceFile (verbatim carrier document name) to the
 * URL-safe object name in the PRIVATE Supabase Storage bucket `plan-docs`. These
 * (non-PHI, public) carrier documents are NOT in git or public static; they are
 * served via /api/plan-docs/[file], which mints a short-lived signed URL. This map
 * is also the access ALLOWLIST for that route. Regenerate if the source docs change.
 */
export const PLAN_DOC_FILES: Record<string, string> = {
  "2026_Benefit_Highlights_CA_H3815_008_HMO_016_HMO_POS_EN_508.pdf": "2026_Benefit_Highlights_CA_H3815_008_HMO_016_HMO_POS_EN_508.pdf",
  "2026_Benefit_Highlights_CA_H3815_013_HMO_EN_508 (2).pdf": "2026_Benefit_Highlights_CA_H3815_013_HMO_EN_508-2.pdf",
  "2026_Benefit_Highlights_CA_H3815_031_034_HMO_EN_508.pdf": "2026_Benefit_Highlights_CA_H3815_031_034_HMO_EN_508.pdf",
  "2026_Benefit_Highlights_CA_H3815_047_055_056_HMO_EN_508.pdf": "2026_Benefit_Highlights_CA_H3815_047_055_056_HMO_EN_508.pdf",
  "2026_Benefit_Highlights_CA_H3815_052_053_HMO_EN_508.pdf": "2026_Benefit_Highlights_CA_H3815_052_053_HMO_EN_508.pdf",
  "2026_Benefit_Highlights_CA_H3815_033_048_054_HMO_CSNP_EN_508 (1).pdf": "2026_Benefit_Highlights_CA_H3815_033_048_054_HMO_CSNP_EN_508-1.pdf",
  "2026_Benefit_Highlights_CA_H3815_039_044_045_HMO_CSNP_EN_508.pdf": "2026_Benefit_Highlights_CA_H3815_039_044_045_HMO_CSNP_EN_508.pdf",
  "2026_Benefit_Highlights_CA_H3815_041_042_HMO_CSNP_EN_508.pdf": "2026_Benefit_Highlights_CA_H3815_041_042_HMO_CSNP_EN_508.pdf",
  "CY26_SB_LGV_EN_R091125.pdf": "CY26_SB_LGV_EN_R091125.pdf",
  "CY26_SB_VAL_EN_R091125.pdf": "CY26_SB_VAL_EN_R091125.pdf",
  "CY26_SB_BRP_EN_R011426.pdf": "CY26_SB_BRP_EN_R011426.pdf",
  "CY26_SB_TLP_EN_R011426.pdf": "CY26_SB_TLP_EN_R011426.pdf",
  "1081748CASENABC_0228.pdf": "1081748CASENABC_0228.pdf",
  "1083126CASENABC_0069.pdf": "1083126CASENABC_0069.pdf",
  "2026 MA Benefits UHC.pdf": "2026-MA-Benefits-UHC.pdf",
  "2026-info-kit-uhmap-combined (1).pdf": "2026-info-kit-uhmap-combined-1.pdf",
  "2026 Benefit Rollout Presentation_ Southern CA.pdf": "2026-Benefit-Rollout-Presentation_-Southern-CA.pdf",
  "H5619021000SB26.pdf": "H5619021000SB26.pdf",
  "H5619121000SB26.pdf": "H5619121000SB26.pdf",
  "H5619146000SB26.pdf": "H5619146000SB26.pdf"
};

/**
 * In-app URL for a plan source document, optionally anchored to a page. Points at
 * the signed-URL redirect route (not a public static file); returns null when the
 * document isn't hosted. The page rides as a query param — the route re-attaches it
 * as the PDF `#page=` fragment on the signed URL (fragments never reach the server).
 */
export function planDocUrl(sourceFile: string, page?: number): string | null {
  const f = PLAN_DOC_FILES[sourceFile];
  if (!f) return null;
  const base = `/api/plan-docs/${encodeURIComponent(f)}`;
  return page && page > 0 ? `${base}?page=${page}` : base;
}
