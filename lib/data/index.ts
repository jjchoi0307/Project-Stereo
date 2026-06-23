/**
 * Data-store factory. Everything in the app calls `getDataStore()` and depends
 * only on the `DataStore` interface — never on a concrete source.
 *
 * v1 returns the fixture store. When real data lands, add a SupabaseDataStore
 * and switch on `process.env.DATA_STORE` here; nothing else changes.
 */

import { FixtureDataStore } from "./fixtureStore";
import type { DataStore } from "./store";

let instance: DataStore | null = null;

export function getDataStore(): DataStore {
  if (instance) return instance;

  const which = process.env.DATA_STORE ?? "fixtures";
  switch (which) {
    case "fixtures":
      instance = new FixtureDataStore();
      break;
    // case "supabase":
    //   instance = new SupabaseDataStore();  // added when real data lands
    //   break;
    default:
      throw new Error(`Unknown DATA_STORE: ${which}`);
  }
  return instance;
}

export type { DataStore } from "./store";
