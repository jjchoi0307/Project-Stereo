/**
 * Org-scoped, admin-configurable settings (app_settings table, migration 0008).
 *
 * Today this backs the input-importance weights the AI health-future projection
 * consumes: family history + hard clinical inputs are PRIMARY, self-reported
 * lifestyle is advisory-only. The defaults live in INPUT_IMPORTANCE (config.ts);
 * an org admin can override them, persisted per-org and read by the projection.
 *
 * SERVER-ONLY (service-role reads/writes; the admin action checks role first).
 */
import "server-only";
import { serviceClient } from "@/lib/supabase/client";
import { stateStore, supabaseConfigured } from "@/lib/supabase/env";
import { INPUT_IMPORTANCE } from "@/lib/engine/config";

export type ImportanceLevel = "high" | "low";
export type ImportanceKey = keyof typeof INPUT_IMPORTANCE;
export type ImportanceConfig = Record<ImportanceKey, ImportanceLevel>;

const SETTING_KEY = "input_importance";

/** The hardcoded defaults as a plain, mutable config object. */
export function defaultImportance(): ImportanceConfig {
  return { ...(INPUT_IMPORTANCE as Record<ImportanceKey, ImportanceLevel>) };
}

/** Coerce arbitrary stored JSON back into a valid config (defaults fill any gaps). */
function coerce(value: unknown): ImportanceConfig {
  const base = defaultImportance();
  if (value && typeof value === "object") {
    for (const k of Object.keys(base) as ImportanceKey[]) {
      const v = (value as Record<string, unknown>)[k];
      if (v === "high" || v === "low") base[k] = v;
    }
  }
  return base;
}

/** The active input-importance config for an org (stored override or defaults). */
export async function getInputImportance(orgId: string | undefined): Promise<ImportanceConfig> {
  if (!orgId || stateStore() !== "supabase" || !supabaseConfigured()) return defaultImportance();
  try {
    const { data } = await serviceClient()
      .from("app_settings")
      .select("value")
      .eq("org_id", orgId)
      .eq("key", SETTING_KEY)
      .maybeSingle();
    return coerce(data?.value);
  } catch {
    return defaultImportance();
  }
}

/** Persist an org's input-importance override (admin action; role checked by caller). */
export async function setInputImportance(
  orgId: string,
  updatedBy: string,
  config: ImportanceConfig,
): Promise<void> {
  await serviceClient()
    .from("app_settings")
    .upsert(
      { org_id: orgId, key: SETTING_KEY, value: coerce(config), updated_by: updatedBy, updated_at: new Date().toISOString() },
      { onConflict: "org_id,key" },
    );
}

/**
 * Build the projection's input-weighting guidance from a resolved config (the
 * org-aware counterpart of config.ts' importanceGuidance(), which uses defaults).
 */
export function guidanceFromConfig(config: ImportanceConfig): string {
  const high = Object.entries(config).filter(([, v]) => v === "high").map(([k]) => k);
  const low = Object.entries(config).filter(([, v]) => v === "low").map(([k]) => k);
  return (
    `INPUT WEIGHTING (configurable): weight HIGH-importance inputs heavily — ${high.join(", ")} — as the primary drivers. ` +
    `Treat LOW-importance, self-reported inputs — ${low.join(", ") || "(none)"} (e.g. steps, sleep, self-rated health) — as light advisory context only: ` +
    `they may add color but a single self-reported value must NOT drive or swing the projection.`
  );
}
