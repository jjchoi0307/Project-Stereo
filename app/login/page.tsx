import Image from "next/image";
import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import { safeNext } from "@/app/login/actions";
import { getBrokerContext } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const dest = await safeNext(next ?? null);

  // Already signed in → skip the form.
  if (await getBrokerContext()) redirect(dest);

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-10">
      <div className="w-full max-w-[400px]" data-fade>
        <div className="mb-7 text-center">
          <Image
            src="/smg-logo.png"
            alt="Seoul Medical Group"
            width={229}
            height={44}
            priority
            className="mx-auto mb-4 h-[44px] w-auto"
          />
          <p className="text-[13px] text-slate-500">Broker Plan Recommender · 2026</p>
        </div>
        <LoginForm next={dest} allowSignup={process.env.ALLOW_SIGNUP === "true"} />
      </div>
    </main>
  );
}
