/**
 * AI patient health-future simulation — environment + config gate.
 *
 * This is the ONLY part of the app that calls an LLM, and it sits OUTSIDE the
 * recommendation data path (ARCHITECTURE.md invariant #6). The deterministic
 * engine + audit never depend on anything here; the app runs fully without a key.
 */

/** Server-only. Never referenced from a client component. */
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";

/** Model used for the health-future narrative. Override via env for testing. */
export const SIM_MODEL = process.env.SIM_MODEL ?? "claude-opus-4-8";

/** True once an Anthropic key is present. The sim feature is opt-in on this. */
export function simConfigured(): boolean {
  return Boolean(ANTHROPIC_API_KEY);
}
