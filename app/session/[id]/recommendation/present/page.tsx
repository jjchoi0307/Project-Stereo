import { notFound, redirect } from "next/navigation";
import MemberSummaryView from "@/components/MemberSummaryView";
import { getSessionStore } from "@/lib/session/store";
import { clientRef } from "@/lib/session/ref";

export const dynamic = "force-dynamic";

/**
 * "Present to member" — a clean, chrome-free, printable client-facing summary of
 * the recommendation. Deliberately renders WITHOUT the app header/nav so the
 * printout (Save as PDF) is pristine. Auth is enforced by middleware (/session/*)
 * plus the session guard below; reads the same cached recommendation the broker saw.
 */
export default async function PresentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await (await getSessionStore()).get(id);
  if (!session) notFound();
  if (!session.profile) redirect(`/session/${id}`); // need facts first

  return (
    <div className="min-h-screen bg-paper" data-fade>
      <MemberSummaryView sessionId={id} clientRef={clientRef(id)} />
    </div>
  );
}
