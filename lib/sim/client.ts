/**
 * Anthropic client factory. SERVER-ONLY — the API key must never reach the
 * browser, exactly like the Supabase service-role client (lib/supabase/client.ts).
 */

import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_API_KEY } from "./env";

let client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (typeof window !== "undefined") {
    throw new Error("getAnthropic() is server-only — never call it from the browser.");
  }
  if (!ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. The health-future simulation is opt-in; " +
        "set the key in .env.local to enable it.",
    );
  }
  if (!client) client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  return client;
}
