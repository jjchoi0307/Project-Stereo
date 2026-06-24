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
    <main className="flex min-h-screen items-center justify-center px-5 py-10">
      <div className="w-full max-w-[400px]" data-fade>
        <div className="mb-7 text-center">
          <div className="mb-3.5 inline-flex h-[46px] w-[46px] items-center justify-center rounded-[11px] bg-accent text-[22px] font-bold text-white">
            S
          </div>
          <h1 className="mb-1 text-xl font-semibold text-ink">Seoul Medical Group</h1>
          <p className="text-[13px] text-slate-500">Broker Plan Recommender · 2026</p>
        </div>
        <LoginForm next={dest} allowSignup={process.env.ALLOW_SIGNUP === "true"} />
      </div>
    </main>
  );
}
