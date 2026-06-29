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

  // Expired / already-used link — branded dead end rather than a raw 404.
  if (!resolved) {
    return (
      <main className="flex min-h-screen items-center justify-center px-5 py-10">
        <div className="max-w-[420px] text-center" data-fade>
          <div className="eyebrow mb-4 inline-flex items-center gap-2 text-ink2">
            <span className="num inline-flex h-[18px] w-[18px] items-center justify-center rounded-sm bg-ink2 text-[11px] text-surface">
              S
            </span>
            Seoul Medical Group
          </div>
          <h1 className="display mb-2 text-[26px] font-semibold leading-[1.15] text-ink">This link is no longer active</h1>
          <p className="text-sm leading-[1.55] text-ink2">
            The intake link you opened has expired or already been used. Please ask your broker to send you a
            fresh link.
          </p>
        </div>
      </main>
    );
  }

  const reference = await getIntakeReference();

  return (
    <main className="mx-auto w-full max-w-[1060px] px-6 pb-16 pt-8" data-fade>
      <div className="mb-6 text-center">
        <div className="eyebrow mb-2.5 inline-flex items-center gap-2 text-accent">
          <span className="num inline-flex h-[18px] w-[18px] items-center justify-center rounded-sm bg-accent text-[11px] text-white">
            S
          </span>
          Seoul Medical Group
        </div>
        <h1 className="display mb-1.5 text-[33px] font-semibold leading-[1.1] text-ink">A few quick facts</h1>
        <p className="mx-auto max-w-[440px] text-[13.5px] leading-[1.5] text-ink2">
          Your broker will use these to find Medicare Advantage plans that fit you. Required items are marked
          with <span className="text-neg">*</span> — everything else is optional.
        </p>
      </div>
      <PatientIntake token={token} reference={reference} />
    </main>
  );
}
