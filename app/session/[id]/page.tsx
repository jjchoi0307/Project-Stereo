import { notFound } from "next/navigation";
import BrokerSession from "@/components/BrokerSession";
import Header from "@/components/ui/Header";
import { getIntakeReference } from "@/lib/intake/reference";
import { getSessionStore } from "@/lib/session/store";

export const dynamic = "force-dynamic";

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await (await getSessionStore()).get(id);
  if (!session) notFound();

  const reference = await getIntakeReference();

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-[1060px] px-6 pb-16 pt-8" data-fade>
        <BrokerSession initialSession={session} reference={reference} />
      </main>
    </div>
  );
}
