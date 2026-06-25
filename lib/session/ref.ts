/**
 * Human-readable client reference code derived from a session id.
 *
 * Sessions are identified by a UUID — unreadable and awkward to talk about. This
 * maps the UUID to a short, stable, privacy-friendly code (e.g. "C-7K2Q9P") that
 * brokers and admins can scan, say aloud, and organize by — without exposing the
 * member's name. Deterministic (same session → same code), no storage needed.
 */

// Crockford-style alphabet: no 0/O, 1/I/L ambiguity.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function clientRef(sessionId: string): string {
  // FNV-1a over the id → spread into a few base-31 chars.
  let h = 2166136261 >>> 0;
  for (let i = 0; i < sessionId.length; i++) {
    h ^= sessionId.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  let code = "";
  for (let i = 0; i < 6; i++) {
    code = ALPHABET[h % ALPHABET.length] + code;
    h = Math.floor(h / ALPHABET.length);
  }
  return `C-${code}`;
}
