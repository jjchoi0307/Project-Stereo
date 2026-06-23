import Link from "next/link";
import { notFound } from "next/navigation";
import BrokerSession from "@/components/BrokerSession";
import { getIntakeReference } from "@/lib/intake/reference";
import { getSessionStore } from "@/lib/session/store";

export const dynamic = "force-dynamic";

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionStore().get(id);
  if (!session) notFound();

  const reference = await getIntakeReference();

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-6">
        <Link href="/" className="text-sm text-accent hover:underline">
          ← All sessions
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-ink">Session {session.id}</h1>
        <p className="mt-1 text-sm text-slate-600">
          You own this session. The client supplies facts; you drive the recommendation.
        </p>
      </header>

      <BrokerSession initialSession={session} reference={reference} />
    </main>
  );
}
