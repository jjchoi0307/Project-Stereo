import type {
  ConditionFlag,
  Gender,
  ProviderSystemId,
  RegionId,
  YesNoUnknown,
} from "@/lib/domain";

/**
 * Flat, string-keyed form values (what the UI binds to). Numbers are kept as
 * strings while editing and parsed at validation/submit time. The same shape is
 * used by both the patient and broker forms — guaranteeing an identical field
 * set regardless of who enters the facts.
 */
export interface IntakeFormValues {
  age: string;
  gender: Gender | "";
  marketRegion: RegionId | "";
  zip: string;
  county: string;
  medications: string[]; // raw free-text rows
  conditions: ConditionFlag[];
  conditionsFreeText: string;
  heightCm: string;
  weightKg: string;
  familyHistory: { condition: ConditionFlag; status: YesNoUnknown }[];
  mustKeepSystemIds: ProviderSystemId[];
  acupunctureVisits12mo: string;
  specialistVisits12mo: string;
  priorYearInpatientEvents: string;
}

export function emptyIntakeValues(): IntakeFormValues {
  return {
    age: "",
    gender: "",
    marketRegion: "",
    zip: "",
    county: "",
    medications: [""],
    conditions: [],
    conditionsFreeText: "",
    heightCm: "",
    weightKg: "",
    familyHistory: [],
    mustKeepSystemIds: [],
    acupunctureVisits12mo: "",
    specialistVisits12mo: "",
    priorYearInpatientEvents: "",
  };
}

/** Reference data the form needs, sourced from the data layer and passed in. */
export interface IntakeReference {
  regions: { id: RegionId; name: string }[];
  providerSystems: { id: ProviderSystemId; name: string }[];
  conditionOptions: { value: ConditionFlag; label: string }[];
  familyHistoryConditions: { value: ConditionFlag; label: string }[];
  drugNames: string[];
}
