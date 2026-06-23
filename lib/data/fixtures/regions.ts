import type { Region, RegionId } from "@/lib/domain";

/**
 * Market regions = the California counties the real 2026 SMG-supported plans
 * actually serve (union across every plan in lib/data/source/plans-2026.json).
 * Southern California is the core market; the NorCal/Central counties appear
 * because several Alignment statewide C-SNP/D-SNP plans extend there.
 */
export const regions: Region[] = [
  // Southern California (core market)
  { id: "reg-la", name: "Los Angeles", counties: ["Los Angeles"] },
  { id: "reg-oc", name: "Orange", counties: ["Orange"] },
  { id: "reg-riverside", name: "Riverside", counties: ["Riverside"] },
  { id: "reg-sanbernardino", name: "San Bernardino", counties: ["San Bernardino"] },
  { id: "reg-sd", name: "San Diego", counties: ["San Diego"] },
  { id: "reg-ventura", name: "Ventura", counties: ["Ventura"] },
  // Bay Area / NorCal / Central (statewide SNP reach)
  { id: "reg-alameda", name: "Alameda", counties: ["Alameda"] },
  { id: "reg-sf", name: "San Francisco", counties: ["San Francisco"] },
  { id: "reg-santaclara", name: "Santa Clara", counties: ["Santa Clara"] },
  { id: "reg-sanmateo", name: "San Mateo", counties: ["San Mateo"] },
  { id: "reg-marin", name: "Marin", counties: ["Marin"] },
  { id: "reg-fresno", name: "Fresno", counties: ["Fresno"] },
  { id: "reg-madera", name: "Madera", counties: ["Madera"] },
  { id: "reg-merced", name: "Merced", counties: ["Merced"] },
  { id: "reg-placer", name: "Placer", counties: ["Placer"] },
  { id: "reg-sacramento", name: "Sacramento", counties: ["Sacramento"] },
  { id: "reg-sanjoaquin", name: "San Joaquin", counties: ["San Joaquin"] },
  { id: "reg-sanluisobispo", name: "San Luis Obispo", counties: ["San Luis Obispo"] },
  { id: "reg-stanislaus", name: "Stanislaus", counties: ["Stanislaus"] },
  { id: "reg-yolo", name: "Yolo", counties: ["Yolo"] },
];

/** Map a verbatim county name (as printed in the PDFs) to its market region id. */
export const COUNTY_TO_REGION: Record<string, RegionId> = Object.fromEntries(
  regions.flatMap((r) => r.counties.map((c) => [c, r.id])),
);

/**
 * Seoul Medical Group's ACTUAL service area — the counties where SMG has
 * affiliated physicians, so the only places an SMG member can be served. This is
 * the SoCal core (Los Angeles + Orange) plus SMG's separate Northern-California
 * division (Santa Clara). SMG has NO providers in San Diego, Riverside, San
 * Bernardino, or Ventura, so plans sold only there are never an SMG option even
 * though they're in the 2026 carrier dataset. (See smg_org_profile research.)
 *
 * The full `regions` list above is kept because plans reference every county they
 * sell in; this set is what the broker intake is restricted to.
 */
export const SMG_SERVICE_AREA_REGION_IDS = new Set<RegionId>(["reg-la", "reg-oc", "reg-santaclara"]);

/** Regions a broker may place an SMG client in (SMG's real footprint). */
export const smgServiceRegions = (): Region[] =>
  regions.filter((r) => SMG_SERVICE_AREA_REGION_IDS.has(r.id));
