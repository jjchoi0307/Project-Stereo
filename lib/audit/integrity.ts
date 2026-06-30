/**
 * Tamper-evidence for audit records. The deterministic engine re-run in /verify
 * proves the *ranking* reproduces, but it can't detect edits to the stored
 * payload that don't change the ranking — a swapped AI recommendation, fabricated
 * citations, or an altered PHI snapshot. An HMAC over the record's content closes
 * that: only a holder of the server-side key can produce a valid signature, so a
 * mismatch means the bytes changed after signing.
 *
 * The HMAC lives inside the record payload (not a separate column): the guarantee
 * comes from the secret key, not from where the digest is stored, and keeping it
 * in the jsonb avoids a schema change. When AUDIT_HMAC_KEY is unset the record is
 * left unsigned and verification degrades to reproducibility only — so enabling
 * signing is a config step, never a code change, and never breaks writes.
 *
 * Node-only (uses node:crypto); audit records are built and verified server-side.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { AuditRecord } from "@/lib/domain";

export function auditHmacKey(): string | null {
  return process.env.AUDIT_HMAC_KEY || null;
}

/**
 * Deterministic JSON with sorted keys, normalized through a JSON round-trip so it
 * matches what Postgres jsonb stores and returns (undefined keys dropped, types
 * preserved). The record's own `contentHmac` is excluded so signing and verifying
 * canonicalize the exact same field set.
 */
function canonical(record: AuditRecord): string {
  const { contentHmac: _omit, ...rest } = record;
  return stableStringify(JSON.parse(JSON.stringify(rest)));
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/**
 * Attach a content HMAC, or leave the record unsigned (contentHmac: null) when no
 * key is configured. Pure: returns a new record, never throws.
 */
export function signAuditRecord(record: AuditRecord): AuditRecord {
  const key = auditHmacKey();
  if (!key) return { ...record, contentHmac: null };
  const contentHmac = createHmac("sha256", key).update(canonical(record)).digest("hex");
  return { ...record, contentHmac };
}

/**
 * Verify a record's stored HMAC against a fresh computation.
 *   true  → signed and intact
 *   false → signed but the content was altered (tamper)
 *   null  → cannot assess (record unsigned, or no key configured)
 */
export function verifyAuditRecordHmac(record: AuditRecord): boolean | null {
  const key = auditHmacKey();
  if (!key || !record.contentHmac) return null;
  const expected = createHmac("sha256", key).update(canonical(record)).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(record.contentHmac);
  return a.length === b.length && timingSafeEqual(a, b);
}
