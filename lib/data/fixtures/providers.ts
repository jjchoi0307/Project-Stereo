import type { Provider, ProviderSystem } from "@/lib/domain";

/**
 * Real provider systems / IPAs referenced by the 2026 SMG-supported plans.
 * - Seoul Medical Group (SMG) is the IPA this tool serves; the plans in the
 *   folder are the ones SMG contracts with.
 * - UCLA Health access is the brief's hard-constraint demo: only the UHC "UCLA
 *   Health MA" plans (net-uhc-ucla) include sys-ucla; nothing else does.
 * - Astrana, Heritage, and UCSD are the provider-specific partners SCAN names
 *   for its Allied / Essential Savings, Desert Choice, and Select plans.
 */
export const providerSystems: ProviderSystem[] = [
  { id: "sys-smg", name: "Seoul Medical Group" },
  { id: "sys-ucla", name: "UCLA Health" },
  { id: "sys-cedars", name: "Cedars-Sinai" },
  { id: "sys-memorialcare", name: "MemorialCare" },
  { id: "sys-scripps", name: "Scripps Health" },
  { id: "sys-ucsd", name: "UC San Diego Health" },
  { id: "sys-astrana", name: "Astrana Health" },
  { id: "sys-heritage", name: "Heritage Provider Network" },
];

export const providers: Provider[] = [
  {
    id: "prov-smg-la",
    name: "Seoul Medical Group (IPA)",
    type: "physician_group",
    systemId: "sys-smg",
    regionIds: ["reg-la", "reg-oc", "reg-riverside", "reg-sanbernardino", "reg-sd"],
  },
  {
    id: "prov-ucla-rr",
    name: "UCLA Ronald Reagan Medical Center",
    type: "hospital",
    systemId: "sys-ucla",
    regionIds: ["reg-la"],
  },
  {
    id: "prov-ucla-santa-monica",
    name: "UCLA Santa Monica Medical Center",
    type: "hospital",
    systemId: "sys-ucla",
    regionIds: ["reg-la"],
  },
  {
    id: "prov-cedars",
    name: "Cedars-Sinai Medical Center",
    type: "hospital",
    systemId: "sys-cedars",
    regionIds: ["reg-la"],
  },
  {
    id: "prov-memorialcare-lb",
    name: "MemorialCare Long Beach Medical Center",
    type: "hospital",
    systemId: "sys-memorialcare",
    regionIds: ["reg-la", "reg-oc"],
  },
  {
    id: "prov-scripps-lj",
    name: "Scripps La Jolla",
    type: "hospital",
    systemId: "sys-scripps",
    regionIds: ["reg-sd"],
  },
  {
    id: "prov-ucsd-hillcrest",
    name: "UC San Diego Health Hillcrest",
    type: "hospital",
    systemId: "sys-ucsd",
    regionIds: ["reg-sd"],
  },
  {
    id: "prov-astrana-la",
    name: "Astrana Health Network",
    type: "physician_group",
    systemId: "sys-astrana",
    regionIds: ["reg-la", "reg-sf", "reg-sanmateo"],
  },
  {
    id: "prov-heritage-riverside",
    name: "Heritage Provider Network — Inland",
    type: "physician_group",
    systemId: "sys-heritage",
    regionIds: ["reg-riverside", "reg-sanbernardino"],
  },
];
