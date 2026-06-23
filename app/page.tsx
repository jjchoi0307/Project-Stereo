/**
 * Broker home — start a client session or resume a recent one. The broker owns
 * the session; the recommendation flow lives inside it.
 */

import Link from "next/link";
import StartSessionButton from "@/components/StartSessionButton";
import { getSessionStore } from "@/lib/session/store";

export const dynamic = "force-dynamic"; // sessions are in-memory + per-request

export default async function Home() {
  const sessions = await getSessionStore().list();

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">SMG Broker Engagement Tool</h1>
          <p className="mt-1 text-sm text-slate-600">
            Fact-driven plan recommendations. Start a session, capture the client's facts (you or the
            client), and get a ranked recommendation.
          </p>
        </div>
        <div className="flex shrink-0 gap-4 text-sm">
          <Link href="/audit" className="text-accent hover:underline">Audit log →</Link>
          <Link href="/plans" className="text-accent hover:underline">Plan data →</Link>
        </div>
      </header>

      <div className="mb-10">
        <StartSessionButton />
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Recent sessions
        </h2>
        {sessions.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
            No sessions yet. Start one above.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
            {sessions.map((s) => (
              <li key={s.id}>
                <Link href={`/session/${s.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
                  <div>
                    <div className="font-medium text-ink">
                      Session {s.id}
                      {s.profile ? ` · age ${s.profile.age}` : ""}
                    </div>
                    <div className="text-xs text-slate-500">{new Date(s.createdAt).toLocaleString()}</div>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs ${
                      s.status === "intake_complete"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {s.status === "intake_complete" ? "facts captured" : "awaiting facts"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
