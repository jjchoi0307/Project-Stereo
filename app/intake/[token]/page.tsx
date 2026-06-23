import { notFound } from "next/navigation";
import PatientIntake from "@/components/PatientIntake";
import { getIntakeReference } from "@/lib/intake/reference";
import { resolvePatientIntake } from "@/lib/session/patientIntake";

export const dynamic = "force-dynamic";

/**
 * Patient self-entry (the shareable link / handed-over tablet). The URL carries a
 * capability TOKEN, not the raw session id — validated server-side. PUBLIC: not
 * gated by auth middleware; the token is the credential.
 */
export default async function PatientIntakePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolved = await resolvePatientIntake(token);
  if (!resolved) notFound();

  const reference = await getIntakeReference();

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-accent">Seoul Medical Group</p>
        <h1 className="mt-1 text-xl font-semibold text-ink">A few quick facts</h1>
      </header>
      <PatientIntake token={token} reference={reference} />
    </main>
  );
}
