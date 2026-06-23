/**
 * Data-access interface. ALL data flows through this so the UI and engine never
 * touch a concrete source. v1 ships an in-memory fixture implementation; a
 * SupabaseDataStore implementing the same interface drops in later with no UI
 * or engine changes.
 *
 * All methods are async so the fixture and Supabase implementations are
 * interchangeable.
 */

import type {
  ClientProfileInput,
  Drug,
  Formulary,
  FormularyId,
  Network,
  NetworkId,
  Plan,
  PlanId,
  Provider,
  ProviderId,
  ProviderSystem,
  ProviderSystemId,
  Region,
  RegionId,
  ProfileId,
} from "@/lib/domain";

export interface DataStore {
  // Plans
  listPlans(): Promise<Plan[]>;
  getPlan(id: PlanId): Promise<Plan | null>;

  // Clinical reference data
  getFormulary(id: FormularyId): Promise<Formulary | null>;
  listFormularies(): Promise<Formulary[]>;
  listDrugs(): Promise<Drug[]>;
  getDrug(id: string): Promise<Drug | null>;

  // Network
  getNetwork(id: NetworkId): Promise<Network | null>;
  listNetworks(): Promise<Network[]>;
  listProviders(): Promise<Provider[]>;
  getProvider(id: ProviderId): Promise<Provider | null>;
  listProviderSystems(): Promise<ProviderSystem[]>;
  getProviderSystem(id: ProviderSystemId): Promise<ProviderSystem | null>;

  // Geography
  listRegions(): Promise<Region[]>;
  getRegion(id: RegionId): Promise<Region | null>;

  // Example/test profiles (saving real profiles is out of scope for v1)
  listExampleProfiles(): Promise<ClientProfileInput[]>;
  getExampleProfile(id: ProfileId): Promise<ClientProfileInput | null>;
}
