import type { ClientProfileInput } from "@/lib/domain";

/**
 * Defensive parse of a `profiles.data` jsonb row read from Supabase.
 *
 * The live write path always produces a well-formed profile (via toProfileInput),
 * so normal rows are fine. But the downstream engine/AI dereference the required
 * array fields without guards (e.g. `profile.medications.map(...)`), so a
 * malformed or older-shape row — written by a manual SQL fix, a migration, or any
 * future writer — would throw a TypeError and 500 that one member's request. This
 * guard coerces the required arrays to `[]` so a bad row degrades gracefully
 * instead of crashing. Returns undefined for a null/non-object payload.
 */
export function parseProfileRow(data: unknown): ClientProfileInput | undefined {
  if (!data || typeof data !== "object") return undefined;
  const p = data as Record<string, unknown>;
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    ...(p as unknown as ClientProfileInput),
    conditions: arr<ClientProfileInput["conditions"][number]>(p.conditions),
    medications: arr<ClientProfileInput["medications"][number]>(p.medications),
    familyHistory: arr<ClientProfileInput["familyHistory"][number]>(p.familyHistory),
    providerConstraints: arr<ClientProfileInput["providerConstraints"][number]>(p.providerConstraints),
  };
}
