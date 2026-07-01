import Image from "next/image";
import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import { safeNext } from "@/app/login/actions";
import { getBrokerContext } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const dest = await safeNext(next ?? null);

  // Already signed in → skip the form.
  if (await getBrokerContext()) redirect(dest);
  // Self-signup is gated (HIPAA access control). If it's off, send to sign in.
  if (process.env.ALLOW_SIGNUP !== "true") redirect(`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-5 py-10">
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
          <div className="eyebrow mb-2 text-accent">Seoul Medical Group</div>
          <h1 className="display mb-1.5 text-[26px] font-semibold leading-[1.15] text-ink">Set up your workspace</h1>
          <p className="num text-[12.5px] text-ink2">Health Plan Recommender · 2026</p>
        </div>
        <LoginForm next={dest} allowSignup initialMode="signup" />
      </div>
    </main>
  );
}
