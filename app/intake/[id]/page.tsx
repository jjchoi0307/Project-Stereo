import { notFound } from "next/navigation";
import PatientIntake from "@/components/PatientIntake";
import { getIntakeReference } from "@/lib/intake/reference";
import { getSessionStore } from "@/lib/session/store";

export const dynamic = "force-dynamic";

/** Patient self-entry page (the shareable link / handed-over tablet). */
export default async function PatientIntakePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionStore().get(id);
  if (!session) notFound();

  const reference = await getIntakeReference();

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-accent">Seoul Medical Group</p>
        <h1 className="mt-1 text-xl font-semibold text-ink">A few quick facts</h1>
      </header>
      <PatientIntake sessionId={session.id} reference={reference} />
    </main>
  );
}
