/**
 * Broker workspace — the broker's home base. Not just a list of sessions: a
 * cockpit that surfaces what needs action (members who haven't submitted facts,
 * profiles ready to turn into a recommendation), the recent compliance trail,
 * and quick references. Everything here is real backend data — sessions, audit
 * records, and the plan catalog.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/components/ui/Header";
import StartSessionButton from "@/components/StartSessionButton";
import SessionRow from "@/components/SessionRow";
import { getSessionStore } from "@/lib/session/store";
import { getAuditStore } from "@/lib/audit/store";
import { getDataStore } from "@/lib/data";
import { getBrokerContext } from "@/lib/supabase/auth";
import { stateStore } from "@/lib/supabase/env";
import { clientRef } from "@/lib/session/ref";

export const dynamic = "force-dynamic"; // per-request; in-memory or RLS-scoped Supabase

const sessionIdOf = (profileId: string) => profileId.replace(/^profile-/, "");
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/**
 * The plan the member was actually recommended. The recommendation is AI-powered,
 * so the delivered top pick lives in `aiRecommendation` (preserved verbatim) — NOT
 * `ranking[0]`, which is the deterministic engine order and can differ.
 */
function deliveredTop(
  r: { aiRecommendation?: { topPlanId: string | null; ranked: { planId: string; planName: string }[] } | null; ranking: string[] },
  planName: Map<string, string>,
): string {
  const ai = r.aiRecommendation;
  if (ai) {
    const id = ai.topPlanId ?? ai.ranked[0]?.planId ?? null;
    return ai.ranked.find((p) => p.planId === id)?.planName ?? ai.ranked[0]?.planName ?? (id ? planName.get(id) ?? id : "—");
  }
  const id = r.ranking[0];
  return id ? planName.get(id) ?? id : "—";
}

/** Readable identity: broker-set label if any, else the stable client code. */
function sessionTitle(s: { clientLabel?: string; id: string }): string {
  return s.clientLabel || `Client ${clientRef(s.id)}`;
}

function StatTile({
  value,
  label,
  tone = "ink",
  href,
  active = false,
}: {
  value: number;
  label: string;
  tone?: "ink" | "blue" | "accent";
  /** When set, the tile links here (e.g. to filter the session list). */
  href?: string;
  active?: boolean;
}) {
  const color = value === 0 ? "text-ink2" : tone === "blue" ? "text-blue" : tone === "accent" ? "text-accent" : "text-ink";
  const base = `rounded-xl border bg-surface px-5 py-4 shadow-card ${active ? "border-accent ring-1 ring-accent/30" : "border-line"}`;
  const inner = (
    <>
      <div className={`num text-[30px] font-semibold leading-none ${color}`}>{value}</div>
      <div className="mt-1.5 text-[12px] leading-[1.3] text-ink2">{label}</div>
    </>
  );
  if (!href) return <div className={base}>{inner}</div>;
  return (
    <Link href={href} className={`${base} block transition-colors hover:border-accent/50`}>
      {inner}
    </Link>
  );
}

/** The three-step explainer: Capture facts → Review & recommend → Save the record. */
const HOW_IT_WORKS_STEPS = [
  {
    n: "1",
    title: "Capture the member's facts",
    body: "Enter them yourself, or send a secure link the member fills in. Every field carries its provenance.",
  },
  {
    n: "2",
    title: "Review the read & recommend",
    body: "See the clinical read, then get a ranked, cited recommendation — for today and across future horizons.",
  },
  {
    n: "3",
    title: "Save a reproducible record",
    body: "The recommendation is sealed to an audit record you can re-verify exactly, any time.",
  },
] as const;

function HowItWorks() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {HOW_IT_WORKS_STEPS.map((step) => (
        <div key={step.n} className="rounded-xl border border-line bg-surface px-5 py-4 shadow-card">
          <div className="num flex h-7 w-7 items-center justify-center rounded-full bg-accent text-[13px] font-semibold text-white">
            {step.n}
          </div>
          <div className="mt-3 text-[14px] font-semibold text-ink">{step.title}</div>
          <p className="mt-1 text-[12.5px] leading-[1.5] text-ink2">{step.body}</p>
        </div>
      ))}
    </div>
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter } = await searchParams; // "awaiting" | "ready" | undefined — filters the session list
  // Resolve the broker once (null in memory mode) and reuse it for the store.
  const ctx = await getBrokerContext();

  // Logged-out visitors (Supabase mode) get the public landing, not the workspace.
  // Memory/dev mode has no auth, so it always renders the workspace here.
  if (!ctx && stateStore() === "supabase") redirect("/home");

  // Personalize the workspace heading with the broker's first name (from their
  // signup full name, else the email's local part). Null in memory/dev mode.
  const user = ctx ? (await ctx.client.auth.getUser()).data.user : null;
  const fullName = (user?.user_metadata?.full_name as string | undefined)?.trim();
  const emailLocal = user?.email?.split("@")[0]?.split(/[._-]+/)[0];
  const firstName =
    fullName?.split(/\s+/)[0] ||
    (emailLocal ? emailLocal.charAt(0).toUpperCase() + emailLocal.slice(1) : null);
  const [sessions, records, plans] = await Promise.all([
    (await getSessionStore(ctx ?? undefined)).list(),
    (await getAuditStore()).list(),
    getDataStore().listPlans(),
  ]);

  const planName = new Map(plans.map((p) => [p.id, p.name]));
  const auditedSessionIds = new Set(records.map((r) => sessionIdOf(r.profileSnapshot.id)));

  const byNewest = <T extends { createdAt: string }>(a: T, b: T) => b.createdAt.localeCompare(a.createdAt);
  const sorted = [...sessions].sort(byNewest);
  const awaiting = sorted.filter((s) => s.status !== "intake_complete");
  const captured = sorted.filter((s) => s.status === "intake_complete");
  // "Ready to recommend": facts are in, but no recommendation has been delivered (no audit record yet).
  const ready = captured.filter((s) => !auditedSessionIds.has(s.id));
  const recentRecs = [...records].sort(byNewest).slice(0, 5);

  // The session list can be filtered by clicking a stat tile.
  const filtered = filter === "awaiting" ? awaiting : filter === "ready" ? ready : sorted;
  const filterLabel = filter === "awaiting" ? "Awaiting member facts" : filter === "ready" ? "Ready to recommend" : null;

  // The action queue: members we're waiting on, then profiles ready to convert.
  const attention = [
    ...awaiting.map((s) => ({ s, kind: "awaiting" as const })),
    ...ready.map((s) => ({ s, kind: "ready" as const })),
  ];

  // First run: no sessions yet. Lead with a welcome + the 3-step explainer instead
  // of empty stat tiles / empty attention / empty recent sections (presentation only).
  if (sessions.length === 0) {
    return (
      <div className="flex min-h-screen flex-col">
        <Header />
        <main className="mx-auto w-full max-w-[1120px] px-7 pb-16 pt-9" data-fade>
          <div className="mb-8 rounded-xl border border-line bg-surface px-7 py-8 shadow-card sm:px-9 sm:py-10">
            <div className="eyebrow mb-2 text-accent">
              {firstName ? `Welcome, ${firstName}` : "Welcome to your workspace"}
            </div>
            <h1 className="display text-[33px] leading-[1.05] text-ink">Start your first client session</h1>
            <p className="mt-2.5 max-w-[560px] text-[14px] leading-[1.55] text-ink2">
              Capture a member&apos;s health profile, get a ranked and cited plan recommendation, and
              keep a reproducible record of every decision — all in one place.
            </p>
            <div className="mt-6">
              <StartSessionButton />
            </div>
          </div>

          <div className="eyebrow mb-3 text-ink2">How it works</div>
          <HowItWorks />
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-[1120px] px-7 pb-16 pt-9" data-fade>
        <div className="mb-7 flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="eyebrow mb-1.5 text-accent">Broker workspace</div>
            <h1 className="display text-[33px] leading-[1.05] text-ink">
              {firstName ? `${firstName}’s workspace` : "Your workspace"}
            </h1>
            <p className="mt-1.5 text-[13.5px] text-ink2">
              Start a client session, follow up on members, and review delivered recommendations.
            </p>
          </div>
          <StartSessionButton />
        </div>

        {/* Pipeline at a glance — real counts; click a tile to filter the list. */}
        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile value={sessions.length} label="Client sessions" href="/" active={!filter} />
          <StatTile value={awaiting.length} label="Awaiting member facts" tone="blue" href="/?filter=awaiting" active={filter === "awaiting"} />
          <StatTile value={ready.length} label="Ready to recommend" tone="accent" href="/?filter=ready" active={filter === "ready"} />
          <StatTile value={records.length} label="Recommendations delivered" href="/audit" />
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.4fr_1fr]">
          {/* Needs your attention */}
          <section>
            <div className="eyebrow mb-2.5 text-ink2">Needs your attention</div>
            {attention.length === 0 ? (
              <div className="rounded-xl border border-line bg-surface px-6 py-10 text-center shadow-card">
                <div className="mb-1 text-[14px] font-semibold text-ink">You&apos;re all caught up</div>
                <p className="mx-auto max-w-[320px] text-[13px] leading-[1.5] text-ink2">
                  No members are waiting and nothing is pending a recommendation. Start a new client session above.
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
                {attention.map(({ s, kind }) => (
                  <div
                    key={`${kind}-${s.id}`}
                    className="flex items-center gap-3 border-t border-line px-5 py-3.5 first:border-t-0"
                  >
                    <span
                      className={`h-2 w-2 flex-none rounded-full ${kind === "awaiting" ? "bg-blue" : "bg-accent"}`}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-semibold text-ink">{sessionTitle(s)}</div>
                      <div className="text-[12px] text-ink2">
                        {kind === "awaiting" ? "Waiting on the member to submit facts" : "Facts captured · ready for a recommendation"}
                      </div>
                    </div>
                    <Link
                      href={kind === "awaiting" ? `/session/${s.id}` : `/session/${s.id}/recommendation`}
                      className="flex-none text-[12.5px] font-semibold text-accent hover:underline"
                    >
                      {kind === "awaiting" ? "Open session →" : "Continue to recommendation →"}
                    </Link>
                  </div>
                ))}
              </div>
            )}

            {/* Client sessions — filtered by the active stat tile, if any. */}
            <div className="mb-2.5 mt-8 flex items-center gap-3">
              <span className="eyebrow text-ink2">{filterLabel ?? "All client sessions"}</span>
              {filterLabel && (
                <Link href="/" className="text-[11.5px] font-semibold text-accent hover:underline">
                  Show all
                </Link>
              )}
            </div>
            {filtered.length === 0 ? (
              <div className="rounded-xl border border-line bg-surface px-6 py-10 text-center shadow-card">
                <div className="mb-1 text-[14px] font-semibold text-ink">
                  {filterLabel ? `Nothing ${filter === "awaiting" ? "awaiting facts" : "ready to recommend"}` : "No sessions yet"}
                </div>
                <p className="mx-auto mb-5 max-w-[340px] text-[13px] leading-[1.5] text-ink2">
                  {filterLabel
                    ? "Clear the filter to see all client sessions."
                    : "Start a new client session to capture a health profile and produce a ranked recommendation."}
                </p>
                {!filterLabel && <StartSessionButton />}
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 border-b border-line bg-paper px-5 py-3 text-[11px] font-semibold uppercase tracking-[.04em] text-ink2">
                  <div>Client</div>
                  <div>Status</div>
                  <div>Started</div>
                  <div className="sr-only">Actions</div>
                </div>
                {filtered.map((s) => (
                  <SessionRow
                    key={s.id}
                    id={s.id}
                    title={sessionTitle(s)}
                    code={clientRef(s.id)}
                    captured={s.status === "intake_complete"}
                    createdAt={s.createdAt}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Right rail: recent recommendations (only once any exist) + references */}
          <aside className="flex flex-col gap-8">
            {recentRecs.length > 0 && (
              <section>
                <div className="eyebrow mb-2.5 text-ink2">Recent recommendations</div>
                <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
                  {recentRecs.map((r) => {
                    return (
                      <Link
                        key={r.id}
                        href={`/audit/${r.id}`}
                        className="block border-t border-line px-5 py-3.5 first:border-t-0 hover:bg-paper"
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <div className="display text-[14px] font-semibold text-ink">
                            {deliveredTop(r, planName)}
                          </div>
                          <div className="num flex-none text-[12px] text-ink2">{fmtDate(r.createdAt)}</div>
                        </div>
                        <div className="num mt-0.5 text-[11.5px] text-ink2">
                          {clientRef(sessionIdOf(r.profileSnapshot.id))} · {r.id}
                        </div>
                      </Link>
                    );
                  })}
                  <Link
                    href="/audit"
                    className="block border-t border-line px-5 py-3 text-[12.5px] font-semibold text-accent hover:bg-paper"
                  >
                    View all in the audit log →
                  </Link>
                </div>
              </section>
            )}

            <section>
              <div className="eyebrow mb-2.5 text-ink2">References</div>
              <div className="flex flex-col gap-3">
                <Link
                  href="/plans"
                  className="flex items-center justify-between rounded-xl border border-line bg-surface px-5 py-4 shadow-card hover:border-accent/40"
                >
                  <div>
                    <div className="text-[14px] font-semibold text-ink">Plan data</div>
                    <div className="text-[12px] text-ink2">Browse the 2026 SMG-supported plans</div>
                  </div>
                  <span className="num text-[13px] font-semibold text-accent">{plans.length} →</span>
                </Link>
                <Link
                  href="/audit"
                  className="flex items-center justify-between rounded-xl border border-line bg-surface px-5 py-4 shadow-card hover:border-accent/40"
                >
                  <div>
                    <div className="text-[14px] font-semibold text-ink">Audit log</div>
                    <div className="text-[12px] text-ink2">Reproducible record of recommendations</div>
                  </div>
                  <span className="num text-[13px] font-semibold text-accent">{records.length} →</span>
                </Link>
              </div>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
