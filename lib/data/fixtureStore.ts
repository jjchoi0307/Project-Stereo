/**
 * In-memory DataStore backed by synthetic fixtures (v1). Implements the same
 * interface a SupabaseDataStore will, so swapping to real data is a one-file
 * change with no UI/engine impact.
 */

import type { DataStore } from "./store";
import {
  drugs,
  exampleProfiles,
  formularies,
  networks,
  plans,
  providers,
  providerSystems,
  regions,
} from "./fixtures";

const byId = <T extends { id: string }>(items: T[], id: string): T | null =>
  items.find((x) => x.id === id) ?? null;

export class FixtureDataStore implements DataStore {
  async listPlans() {
    return plans;
  }
  async getPlan(id: string) {
    return byId(plans, id);
  }

  async getFormulary(id: string) {
    return byId(formularies, id);
  }
  async listFormularies() {
    return formularies;
  }
  async listDrugs() {
    return drugs;
  }
  async getDrug(id: string) {
    return byId(drugs, id);
  }

  async getNetwork(id: string) {
    return byId(networks, id);
  }
  async listNetworks() {
    return networks;
  }
  async listProviders() {
    return providers;
  }
  async getProvider(id: string) {
    return byId(providers, id);
  }
  async listProviderSystems() {
    return providerSystems;
  }
  async getProviderSystem(id: string) {
    return byId(providerSystems, id);
  }

  async listRegions() {
    return regions;
  }
  async getRegion(id: string) {
    return byId(regions, id);
  }

  async listExampleProfiles() {
    return exampleProfiles;
  }
  async getExampleProfile(id: string) {
    return byId(exampleProfiles, id);
  }
}
