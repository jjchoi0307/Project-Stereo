/**
 * Broker home — start a client session or resume a recent one. The broker owns
 * the session; the recommendation flow lives inside it.
 */

import Header from "@/components/ui/Header";
import StartSessionButton from "@/components/StartSessionButton";
import SessionRow from "@/components/SessionRow";
import { getSessionStore } from "@/lib/session/store";
import { getBrokerContext } from "@/lib/supabase/auth";
import { clientRef } from "@/lib/session/ref";

export const dynamic = "force-dynamic"; // per-request; in-memory or RLS-scoped Supabase

/** Readable identity: broker-set label if any, else the stable client code. */
function sessionTitle(s: { clientLabel?: string; id: string }): string {
  return s.clientLabel || `Client ${clientRef(s.id)}`;
}

export default async function Home() {
  // Resolve the broker once (null in memory mode) and reuse it for the store,
  // so we don't resolve auth twice per render.
  const ctx = await getBrokerContext();
  const sessions = await (await getSessionStore(ctx ?? undefined)).list();

  return (
    <div className="flex min-h-screen flex-col">
      <Header authed={!!ctx} />
      <main className="mx-auto w-full max-w-[1120px] px-7 pb-16 pt-9" data-fade>
        <div className="mb-7 flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-.01em] text-ink">Your sessions</h1>
            <p className="mt-1 text-[13.5px] text-slate-500">
              Start a client session to capture facts and generate a ranked recommendation.
            </p>
          </div>
          <StartSessionButton />
        </div>

        {sessions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-[54px] text-center">
            <div className="mb-1.5 text-[15px] font-semibold text-ink">No sessions yet</div>
            <p className="mx-auto mb-5 max-w-[340px] text-[13.5px] leading-[1.5] text-slate-500">
              Start a new client session to capture a health profile and produce a ranked plan
              recommendation.
            </p>
            <StartSessionButton />
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 border-b border-slate-200 bg-slate-50 px-5 py-3 text-[11px] font-semibold uppercase tracking-[.04em] text-slate-500">
              <div>Client</div>
              <div>Status</div>
              <div>Started</div>
              <div className="sr-only">Actions</div>
            </div>
            {sessions.map((s) => (
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
      </main>
    </div>
  );
}
