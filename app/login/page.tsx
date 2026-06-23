import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import { getBrokerContext } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  // Already signed in → skip the form.
  if (await getBrokerContext()) redirect(dest);

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <header className="mb-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-accent">Seoul Medical Group</p>
        <h1 className="mt-1 text-xl font-semibold text-ink">Broker sign in</h1>
        <p className="mt-1 text-sm text-slate-500">Your clients and audit records are private to your account.</p>
      </header>
      <LoginForm next={dest} allowSignup={process.env.ALLOW_SIGNUP === "true"} />
    </main>
  );
}
