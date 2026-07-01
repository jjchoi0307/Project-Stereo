import Link from "next/link";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import Header from "@/components/ui/Header";
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
      <Header />

      {/* Full-bleed hero film. A strong LEFT scrim darkens only the left third for
          the headline, leaving the film's center + right content (incl. its own
          on-screen text) clear — so nothing is cropped or overlapped. */}
      <section className="relative isolate flex min-h-[calc(100vh-64px)] items-end overflow-hidden bg-ink text-white">
        <HeroBackgroundVideo />
        {/* Bottom-anchored scrim only — darkens the lower band where the headline
            sits, while the top of the film stays clear (no color cast over it). */}
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />
        <div className="relative z-10 w-full pb-16 pt-28 sm:pb-24" data-fade>
          <div className={CONTAINER}>
            <div className="max-w-[560px]">
              <h1 className="font-serif text-[clamp(2.6rem,5.5vw,4.25rem)] font-light leading-[1.12] tracking-[-0.015em] text-white [text-wrap:balance]">
                The right plan,<br />line by line.
              </h1>
              <Link
                href="/login"
                className="mt-9 inline-flex items-center gap-2 border border-white/50 px-6 py-3 text-[14px] font-semibold text-white transition-colors hover:bg-white hover:text-ink"
              >
                Broker sign in <span aria-hidden>→</span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Lead standfirst — title + plain-language description, set below the film */}
      <section className="border-b border-line py-12 sm:py-16">
        <div className={CONTAINER}>
          <h2 className="font-serif text-[clamp(1.8rem,3vw,2.75rem)] font-light leading-[1.1] tracking-[-0.01em] text-ink">
            A Health Plan Recommender
          </h2>
          <p className="mt-6 max-w-[860px] text-[19px] leading-[1.6] text-ink2 sm:text-[21px]">
            Built for SMG brokers and the members they serve. It begins with a member's real needs — their
            health conditions, the medications they take, and the doctors they'd like to keep — then returns a
            clear, ranked shortlist of the 2026 SMG-supported plans that fit best. Every figure comes straight
            from the official plan documents, so you can always see exactly how a recommendation was reached.
          </p>
        </div>
      </section>

      {/* How a recommendation is made — editorial, aligned, de-boxed */}
      <section className="border-b border-line py-16 sm:py-20">
        <div className={CONTAINER}>
          <div className="eyebrow mb-3 text-accent">How a recommendation is made</div>
          <h2 className="font-serif text-[clamp(1.6rem,3vw,2.5rem)] font-light leading-[1.12] text-ink">
            Four steps, every figure traceable
          </h2>
          <div className="mt-10 grid grid-cols-1 gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
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
      <section className="py-16 sm:py-20">
        <div className={CONTAINER}>
          <div className="eyebrow mb-3 text-accent">Why you can trust it</div>
          <h2 className="font-serif text-[clamp(1.6rem,3vw,2.5rem)] font-light leading-[1.12] text-ink">
            Transparent by principle
          </h2>
          <div className="mt-10 grid grid-cols-1 gap-x-14 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
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
            className="inline-flex items-center gap-2 border border-ink/30 px-6 py-3 text-[14px] font-semibold text-ink transition-colors hover:border-ink hover:bg-ink hover:text-white"
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
