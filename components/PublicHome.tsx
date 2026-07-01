import Image from "next/image";
import Link from "next/link";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import HeroBackgroundVideo from "@/components/HeroBackgroundVideo";

/**
 * Public landing (logged-out front door), editorial register: a full-bleed hero
 * film with a serif headline set bottom-left over a scrim, then quiet,
 * left-aligned content sections — premium and restrained, not a card grid.
 * Transparency of METHOD and PRINCIPLES only, never architecture (stealth posture).
 */

const STEPS = [
  ["01", "Capture the member's facts", "Diagnosed conditions, medications, providers to keep, region — entered by the broker or by the member via a secure link. Facts only, never sentiment."],
  ["02", "Screen on the hard rules", "Plans not sold in the member's region, that drop a must-keep provider, or omit a critical medication are excluded before anything is ranked."],
  ["03", "Score fit — grounded in the plan files", "Eligible plans are scored on the member's facts against the official 2026 plan documents, with every figure cited to its source page."],
  ["04", "Save a reproducible record", "The recommendation is sealed to an audit record that can be re-verified exactly — the same facts always produce the same result."],
];

const PRINCIPLES: [string, string][] = [
  ["Facts, not sentiment", "Intake captures diagnosed conditions, medications, and utilization — never opinions about how a member feels."],
  ["Grounded & cited", "Every recommendation is reasoned over the real 2026 SMG-supported plan files, and each figure is traceable to a source page."],
  ["Carrier-neutral by construction", "Plans are ranked purely on fit for the member. The tool applies no carrier or plan preference of any kind."],
  ["AI assists, it never decides eligibility", "The eligibility gate and every figure are grounded and reproducible. AI helps explain — clearly marked — and can't surface an ineligible plan."],
  ["Reproducible & re-verifiable", "Each delivered recommendation becomes an immutable record you can re-run to confirm it reproduces, exactly."],
  ["Private by design", "Member information is kept private to the broker's account; no patient data is ever placed in a link or URL."],
];

const CONTAINER = "mx-auto w-full max-w-[1200px] px-6 sm:px-10";

export default function PublicHome() {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      {/* Masthead — thin, quiet, dark logo on white */}
      <header className="border-b border-line bg-surface/95 backdrop-blur">
        <div className={`${CONTAINER} flex h-[64px] items-center gap-6`}>
          <Link href="/" className="flex items-center">
            <Image src="/smg-logo.png" alt="Seoul Medical Group" width={150} height={29} priority className="h-[29px] w-auto" />
          </Link>
          <span className="hidden font-mono text-[10px] uppercase leading-tight tracking-[.16em] text-ink2 sm:block">
            Plan Recommender · 2026
          </span>
          <nav className="ml-auto flex items-center gap-2">
            <Link href="/plans" className="rounded-sm px-3 py-2 text-[13px] font-medium text-ink2 hover:text-ink">
              Plan data
            </Link>
            <Link
              href="/login"
              className="rounded-sm border border-ink/25 px-4 py-2 text-[13px] font-semibold text-ink transition-colors hover:border-ink hover:bg-ink hover:text-white"
            >
              Broker sign in
            </Link>
          </nav>
        </div>
      </header>

      {/* Full-bleed hero film with a serif headline set bottom-left */}
      <section className="relative isolate flex min-h-[calc(100vh-64px)] flex-col overflow-hidden bg-ink text-white">
        <HeroBackgroundVideo />
        {/* Scrim for legibility — heaviest bottom-left where the text sits */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/45"
        />
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/55 to-transparent" />

        <div className="relative z-10 mt-auto w-full" data-fade>
          <div className={`${CONTAINER} pb-16 pt-24 sm:pb-24`}>
            <div className="max-w-[760px]">
              <div className="eyebrow mb-5 text-white/70">Seoul Medical Group · Broker Plan Recommender</div>
              <h1 className="font-serif text-[clamp(2rem,5vw,3.75rem)] font-light leading-[1.05] tracking-[-0.015em] text-white">
                A fact-driven health plan recommendation you can trace, line by line.
              </h1>
              <p className="mt-6 max-w-[540px] text-[15px] leading-[1.65] text-white/80">
                Built for SMG brokers and the members they serve. Capture a member's facts, get a ranked and
                cited recommendation across the 2026 SMG-supported plans — and a reproducible record of exactly
                how it was reached. Nothing is a black box.
              </p>
              <Link
                href="/login"
                className="mt-9 inline-flex items-center gap-2 border border-white/60 px-6 py-3 text-[14px] font-semibold text-white transition-colors hover:bg-white hover:text-ink"
              >
                Broker sign in <span aria-hidden>→</span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* How a recommendation is made — editorial, aligned, de-boxed */}
      <section className="border-b border-line py-20 sm:py-28">
        <div className={CONTAINER}>
          <div className="eyebrow mb-3 text-accent">How a recommendation is made</div>
          <h2 className="font-serif text-[clamp(1.6rem,3vw,2.5rem)] font-light leading-[1.12] text-ink">
            Four steps, every figure traceable
          </h2>
          <div className="mt-14 grid grid-cols-1 gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(([n, title, body]) => (
              <div key={n} className="border-t border-line pt-5">
                <div className="num mb-4 text-[13px] font-semibold tracking-[.1em] text-accent">{n}</div>
                <div className="mb-2 text-[15px] font-semibold leading-snug text-ink">{title}</div>
                <p className="text-[13px] leading-[1.6] text-ink2">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why you can trust it — principles */}
      <section className="py-20 sm:py-28">
        <div className={CONTAINER}>
          <div className="eyebrow mb-3 text-accent">Why you can trust it</div>
          <h2 className="font-serif text-[clamp(1.6rem,3vw,2.5rem)] font-light leading-[1.12] text-ink">
            Transparent by principle
          </h2>
          <div className="mt-14 grid grid-cols-1 gap-x-14 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {PRINCIPLES.map(([title, body]) => (
              <div key={title} className="border-l border-accent/40 pl-5">
                <div className="mb-1.5 text-[14px] font-semibold text-ink">{title}</div>
                <p className="text-[13px] leading-[1.6] text-ink2">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer CTA */}
      <footer className="border-t border-line bg-ground">
        <div className={`${CONTAINER} flex flex-wrap items-center justify-between gap-5 py-12`}>
          <div>
            <div className="font-serif text-[22px] font-light text-ink">Find a member's best-fit plan.</div>
            <p className="mt-1 text-[13px] text-ink2">Your clients and audit records are private to your account.</p>
          </div>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 bg-accent px-6 py-3 text-[14px] font-semibold text-white transition-colors hover:bg-accent-strong"
          >
            Broker sign in <span aria-hidden>→</span>
          </Link>
        </div>
      </footer>

      {/* Analytics live here (not the layout): "/" also serves the PHI workspace,
          so this renders only when the public landing renders. */}
      <Analytics />
      <SpeedInsights />
    </div>
  );
}
