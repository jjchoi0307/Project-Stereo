/**
 * Broker home — start a client session or resume a recent one. The broker owns
 * the session; the recommendation flow lives inside it.
 */

import Link from "next/link";
import Header from "@/components/ui/Header";
import StatusPill from "@/components/ui/StatusPill";
import StartSessionButton from "@/components/StartSessionButton";
import { getSessionStore } from "@/lib/session/store";
import { getBrokerContext } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic"; // per-request; in-memory or RLS-scoped Supabase

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

function sessionLabel(s: { clientLabel?: string; profile?: { age: number } | undefined }): string {
  if (s.clientLabel) return s.clientLabel;
  return s.profile ? `Client — age ${s.profile.age}` : "Client — intake pending";
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
            <div className="grid grid-cols-[1fr_auto_auto] gap-4 border-b border-slate-200 bg-slate-50 px-5 py-3 text-[11px] font-semibold uppercase tracking-[.04em] text-slate-500">
              <div>Client</div>
              <div>Status</div>
              <div className="text-right">Updated</div>
            </div>
            {sessions.map((s) => (
              <Link
                key={s.id}
                href={`/session/${s.id}`}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-slate-100 px-5 py-[15px] last:border-b-0 hover:bg-slate-50"
              >
                <div>
                  <div className="text-sm font-semibold text-ink">{sessionLabel(s)}</div>
                  <div className="num text-xs text-slate-400">{s.id}</div>
                </div>
                <StatusPill status={s.status === "intake_complete" ? "captured" : "awaiting"} />
                <div className="num text-right text-[13px] text-slate-500">{fmtDate(s.createdAt)}</div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
