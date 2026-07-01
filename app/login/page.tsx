import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import HeroVideos from "@/components/HeroVideos";
import { safeNext } from "@/app/login/actions";
import { getBrokerContext } from "@/lib/supabase/auth";
import { getEpisodes } from "@/lib/youtube";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const dest = await safeNext(next ?? null);

  // Already signed in → skip the form.
  if (await getBrokerContext()) redirect(dest);

  const episodes = await getEpisodes();

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-paper px-5 py-10">
      <Link
        href="/"
        className="absolute left-5 top-5 inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-[13px] font-medium text-ink2 hover:bg-surface hover:text-ink"
      >
        ← Home
      </Link>
      <div className="grid w-full max-w-[1120px] items-end gap-10 lg:grid-cols-[1.05fr_minmax(400px,0.95fr)] lg:gap-12">
        {/* Showcase — left on desktop, below the form on mobile (sign-in stays first).
            Bottom-aligned to the sign-in column; the pad lifts the video so its
            bottom edge meets the card's bottom (the sign-up link + footer note hang
            below the card on the right). */}
        <section className="order-2 lg:order-1 lg:pb-[94px]">
          <HeroVideos episodes={episodes} />
        </section>

        {/* Sign in — right on desktop, first on mobile; header centered over the card */}
        <section className="order-1 mx-auto w-full max-w-[420px] lg:order-2" data-fade>
          <div className="mb-7 text-center">
            <Link href="/" className="mx-auto mb-4 inline-block">
              <Image
                src="/smg-logo.png"
                alt="Seoul Medical Group — back to home"
                width={229}
                height={44}
                priority
                className="h-[44px] w-auto"
              />
            </Link>
            <div className="eyebrow mb-2 text-accent">Seoul Medical Group</div>
            <h1 className="display mb-1.5 text-[26px] font-semibold leading-[1.15] text-ink">Broker sign in</h1>
            <p className="num text-[12.5px] text-ink2">Broker Plan Recommender · 2026</p>
          </div>
          <LoginForm next={dest} allowSignup={process.env.ALLOW_SIGNUP === "true"} />
        </section>
      </div>
    </main>
  );
}
