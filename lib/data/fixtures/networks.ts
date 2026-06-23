import type { Network } from "@/lib/domain";

/**
 * Carrier / plan-family networks for the real 2026 SMG-supported plans. Every
 * network includes Seoul Medical Group (sys-smg) — these are SMG's plans.
 *
 * UCLA access (sys-ucla) is deliberately ONLY in `net-uhc-ucla` (UnitedHealthcare's
 * UCLA Health MA plans), so a "must-keep UCLA" client is steered there and every
 * other plan is correctly excluded. SCAN's provider-specific plans use the
 * partner networks SCAN names (Astrana / Heritage / UCSD).
 */
export const networks: Network[] = [
  {
    id: "net-alignment",
    name: "Alignment Health Network",
    systemIds: ["sys-smg", "sys-cedars", "sys-memorialcare", "sys-scripps"], // no UCLA
    providerIds: ["prov-smg-la", "prov-cedars", "prov-memorialcare-lb", "prov-scripps-lj"],
  },
  {
    id: "net-clevercare",
    name: "Clever Care Network",
    systemIds: ["sys-smg", "sys-cedars"], // community/multilingual, no UCLA
    providerIds: ["prov-smg-la", "prov-cedars"],
  },
  {
    id: "net-anthem",
    name: "Anthem Blue Cross Network",
    systemIds: ["sys-smg", "sys-cedars", "sys-memorialcare"], // no UCLA
    providerIds: ["prov-smg-la", "prov-cedars", "prov-memorialcare-lb"],
  },
  {
    id: "net-uhc-socal",
    name: "UnitedHealthcare SoCal Network",
    systemIds: ["sys-smg", "sys-cedars", "sys-memorialcare", "sys-scripps"], // no UCLA
    providerIds: ["prov-smg-la", "prov-cedars", "prov-memorialcare-lb", "prov-scripps-lj"],
  },
  {
    id: "net-uhc-ucla",
    name: "UnitedHealthcare — UCLA Health MA Network",
    systemIds: ["sys-smg", "sys-ucla", "sys-cedars"], // UCLA in network
    providerIds: ["prov-smg-la", "prov-ucla-rr", "prov-ucla-santa-monica", "prov-cedars"],
  },
  {
    id: "net-scan",
    name: "SCAN Health Plan Network",
    systemIds: ["sys-smg", "sys-memorialcare", "sys-scripps"], // no UCLA
    providerIds: ["prov-smg-la", "prov-memorialcare-lb", "prov-scripps-lj"],
  },
  {
    id: "net-scan-astrana",
    name: "SCAN — Astrana Health Network",
    systemIds: ["sys-smg", "sys-astrana"],
    providerIds: ["prov-smg-la", "prov-astrana-la"],
  },
  {
    id: "net-scan-heritage",
    name: "SCAN — Heritage Provider Network",
    systemIds: ["sys-smg", "sys-heritage"],
    providerIds: ["prov-smg-la", "prov-heritage-riverside"],
  },
  {
    id: "net-scan-ucsd",
    name: "SCAN Select — UC San Diego Network",
    systemIds: ["sys-smg", "sys-ucsd"],
    providerIds: ["prov-smg-la", "prov-ucsd-hillcrest"],
  },
];
