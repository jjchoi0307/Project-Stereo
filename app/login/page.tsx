import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import HeroLoginVideo from "@/components/HeroLoginVideo";
import { safeNext } from "@/app/login/actions";
import { getBrokerContext } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const dest = await safeNext(next ?? null);

  // Already signed in → skip the form.
  if (await getBrokerContext()) redirect(dest);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-ink px-5 py-12 sm:justify-end sm:px-10 lg:px-20">
      {/* Full-bleed self-hosted background film — true color, no scrim. The
          sign-in card is opaque, so no darkening is needed. */}
      <HeroLoginVideo />

      <Link
        href="/"
        className="absolute left-6 top-6 z-20 inline-flex items-center gap-1.5 text-[13px] font-medium text-white/90 [text-shadow:0_1px_4px_rgba(0,0,0,0.55)] transition-colors hover:text-white"
      >
        ← Home
      </Link>

      {/* Sign-in card — solid, over the darkened film */}
      <section className="relative z-10 w-full max-w-[420px] border border-line bg-surface p-8 shadow-card sm:p-10" data-fade>
        <div className="mb-7">
          <Image src="/smg-logo.png" alt="Seoul Medical Group" width={150} height={29} priority className="h-[29px] w-auto" />
          <div className="eyebrow mt-6 mb-2.5 text-accent">Seoul Medical Group</div>
          <h1 className="font-serif text-[30px] font-light leading-[1.1] text-ink">Broker sign in</h1>
          <p className="num mt-1.5 text-[12.5px] text-ink2">Health Plan Recommender · 2026</p>
        </div>
        <LoginForm next={dest} allowSignup={process.env.ALLOW_SIGNUP !== "false"} />
      </section>
    </main>
  );
}
