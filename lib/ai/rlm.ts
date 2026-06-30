/**
 * RLM orchestrator — the shared decompose → delegate → synthesize structure that
 * EVERY AI system in this product runs on (recommendation, horizons, clinical read).
 *
 * This is the Recursive-Language-Model *method* adapted to a bounded, grounded,
 * HIPAA-regulated domain: a root task is decomposed into focused sub-LM calls,
 * the sub-calls run in parallel, and the results are synthesized by deterministic
 * code (where grounding/guardrails live). A sub-call (`rlmLeaf`) may itself
 * decompose into further `rlmParallel` sub-calls, so the structure is genuinely
 * recursive-capable.
 *
 * What this deliberately does NOT do — and why: the literal RLM paper offloads a
 * NEAR-INFINITE context into a code REPL the model programmatically drives. Our
 * contexts are small and bounded (a compact plan-facts pack), and an LLM executing
 * generated code over PHI in a Medicare tool is a security/auditability/latency
 * loss, not a win. So we keep the RLM *structure* (decompose/sub-calls/synthesize)
 * and the trajectory logging, and skip the REPL/code-execution layer.
 *
 * Every leaf is: no extended thinking + temperature 0 + structured JSON output
 * (stable, fast, parseable). Every run records a PHI-FREE trajectory (labels,
 * model, timings) for audit + latency observability.
 *
 * SERVER-ONLY.
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getAnthropic } from "@/lib/sim/client";
import { SIM_MODEL } from "@/lib/sim/env";

export interface RlmStep {
  label: string;
  kind: "leaf" | "parallel";
  model?: string;
  ms: number;
  ok: boolean;
  count?: number; // for parallel: how many sub-calls
}

export interface RlmTrajectory {
  task: string;
  steps: RlmStep[];
  t0: number;
}

export function newTrajectory(task: string): RlmTrajectory {
  return { task, steps: [], t0: Date.now() };
}

export interface RlmLeafOptions {
  label: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  effort?: "low" | "medium";
  /** Hard wall-clock cap for this sub-call; aborts a stalled stream. Default 90s. */
  timeoutMs?: number;
}

// A grounded sub-call should finish in ~10–40s. A stalled Anthropic stream (network
// blip, provider overload, rate-limit backoff) would otherwise hang finalMessage()
// indefinitely → the UI spins forever. This hard cap converts a hang into a fast,
// caught failure so the route can degrade gracefully instead of loading for minutes.
const DEFAULT_LEAF_TIMEOUT_MS = 90_000;

/**
 * Process-wide (per serverless instance) cap on CONCURRENT Anthropic calls.
 *
 * rlmParallel bounds concurrency only WITHIN a single request, so without this a
 * burst of cold loads — each firing Today + both horizon ensembles on mount —
 * would put dozens of calls per member in flight at once and trip provider rate
 * limits (429s) under load. Every leaf acquires a slot before its call and
 * releases after, so a burst QUEUES (FIFO) instead of stampeding. Tune to the
 * Anthropic account rate limit via RLM_MAX_CONCURRENCY. (Per-instance; Vercel runs
 * several instances, and the Anthropic account limit is the cross-instance
 * backstop — see README/DEPLOY for the rate-limit + Supabase tier guidance.)
 */
const MAX_CONCURRENT = Math.max(1, Number(process.env.RLM_MAX_CONCURRENCY) || 6);
let inFlight = 0;
const slotQueue: Array<() => void> = [];
function acquireSlot(): Promise<void> {
  if (inFlight < MAX_CONCURRENT) {
    inFlight++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => slotQueue.push(resolve));
}
function releaseSlot(): void {
  const next = slotQueue.shift();
  if (next) next(); // transfer the slot directly to the next waiter (inFlight unchanged)
  else inFlight--;
}

/**
 * A single grounded sub-LM call — the RLM completion primitive ("leaf"). Structured
 * JSON output, no extended thinking, temperature 0, hard timeout. Throws on
 * refusal / truncation / empty / invalid JSON / timeout; the caller's synthesize
 * step enforces grounding. Records a step on the trajectory either way.
 */
export async function rlmLeaf<T>(traj: RlmTrajectory, opts: RlmLeafOptions): Promise<T> {
  // Acquire a global concurrency slot BEFORE the call (queue wait is excluded from
  // the per-call timeout below, which only times the actual request).
  await acquireSlot();
  const start = Date.now();
  let ok = false;
  let model = SIM_MODEL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_LEAF_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const client = getAnthropic();
    const stream = client.messages.stream(
      {
        model: SIM_MODEL,
        max_tokens: opts.maxTokens ?? 16000,
        temperature: 0,
        output_config: { effort: opts.effort ?? "low", format: { type: "json_schema", schema: opts.schema } },
        system: opts.system,
        messages: [{ role: "user", content: opts.user }],
      },
      { maxRetries: 1 },
    );
    // Hard wall-clock cap via Promise.race + stream.abort(). Relying on the SDK
    // signal/timeout alone proved insufficient for a stalled STREAM (the spinner
    // hung for minutes); racing finalMessage() against a timer that aborts the
    // stream guarantees this leaf resolves or rejects within timeoutMs.
    const res = await Promise.race([
      stream.finalMessage(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          try {
            stream.abort();
          } catch {
            /* ignore */
          }
          reject(new Error(`${opts.label}: timed out after ${Math.round(timeoutMs / 1000)}s`));
        }, timeoutMs);
      }),
    ]);
    model = res.model;
    if (res.stop_reason === "refusal") {
      throw new Error(`${opts.label}: refused — ${res.stop_details?.explanation ?? "no detail"}`);
    }
    if (res.stop_reason === "max_tokens") throw new Error(`${opts.label}: truncated (max_tokens)`);
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (!text.trim()) throw new Error(`${opts.label}: empty (stop_reason=${res.stop_reason})`);
    let parsed: T;
    try {
      parsed = JSON.parse(text) as T;
    } catch (e) {
      throw new Error(`${opts.label}: invalid JSON — ${(e as Error).message}`);
    }
    ok = true;
    return parsed;
  } finally {
    clearTimeout(timer);
    releaseSlot();
    traj.steps.push({ label: opts.label, kind: "leaf", model, ms: Date.now() - start, ok });
  }
}

/**
 * Delegate: run sub-tasks in PARALLEL with bounded concurrency (the RLM "map").
 * Records one rolled-up parallel step. The fn is the sub-call body — typically an
 * rlmLeaf, which is what makes this a recursive structure.
 */
export async function rlmParallel<TItem, R>(
  traj: RlmTrajectory,
  label: string,
  items: TItem[],
  concurrency: number,
  fn: (item: TItem, index: number) => Promise<R>,
): Promise<R[]> {
  const start = Date.now();
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length || 1) }, () => worker()));
  traj.steps.push({ label, kind: "parallel", ms: Date.now() - start, ok: true, count: items.length });
  return out;
}

/**
 * Emit the trajectory for audit + observability. PHI-FREE by construction: only
 * step labels, the model, and timings — never prompts or patient facts. Ship stdout
 * to the SIEM/log drain (same path as accessLog).
 */
export function logTrajectory(traj: RlmTrajectory): void {
  try {
    console.info(
      JSON.stringify({
        ts: new Date().toISOString(),
        kind: "rlm_trajectory",
        task: traj.task,
        totalMs: Date.now() - traj.t0,
        steps: traj.steps,
      }),
    );
  } catch {
    /* logging is best-effort, never throws into a request */
  }
}
