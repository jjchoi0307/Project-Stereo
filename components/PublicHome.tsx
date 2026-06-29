import Image from "next/image";
import Link from "next/link";

/**
 * Public landing page (logged-out front door). Introduces the tool and explains
 * *how it works* and *why it can be trusted* — transparency of methodology and
 * principles, NOT implementation/architecture (which stays internal per the
 * stealth/low-disclosure security posture). No PHI, no internals.
 */

const STEPS = [
  {
    n: "1",
    title: "Capture the member's facts",
    body: "Diagnosed conditions, medications, providers to keep, region — entered by the broker or by the member via a secure link. Facts only, never sentiment.",
  },
  {
    n: "2",
    title: "Screen on the hard rules",
    body: "Plans that aren't sold in the member's region, drop a must-keep provider, or omit a critical medication are excluded before anything is ranked.",
  },
  {
    n: "3",
    title: "Score fit — grounded in the plan files",
    body: "Eligible plans are scored on the member's facts against the official 2026 plan documents, with every figure cited to its source page.",
  },
  {
    n: "4",
    title: "Save a reproducible record",
    body: "The recommendation is sealed to an audit record that can be re-verified exactly — the same facts always produce the same result.",
  },
];

const PRINCIPLES = [
  ["Facts, not sentiment", "Intake captures diagnosed conditions, medications, and utilization — never opinions about how a member feels."],
  ["Grounded & cited", "Every recommendation is reasoned over the real 2026 SMG-supported plan files, and each figure is traceable to a source page."],
  ["Carrier-neutral by construction", "Plans are ranked purely on fit for the member. The tool applies no carrier or plan preference of any kind."],
  ["AI assists, it never decides", "The recommendation and every number are deterministic and auditable. AI helps explain — clearly marked — and never changes the ranking."],
  ["Reproducible & re-verifiable", "Each delivered recommendation becomes an immutable record you can re-run to confirm it reproduces, exactly."],
  ["Private by design", "Member information is kept private to the broker's account; no patient data is ever placed in a link or URL."],
];

export default function PublicHome() {
  return (
    <div className="flex min-h-screen flex-col bg-ground">
      {/* Masthead */}
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-[60px] max-w-[1120px] items-center gap-5 px-7">
          <Image src="/smg-logo.png" alt="Seoul Medical Group" width={156} height={30} priority className="h-[30px] w-auto" />
          <span className="hidden border-l border-line pl-3 font-mono text-[10px] uppercase leading-tight tracking-[.14em] text-ink2 sm:block">
            Plan Recommender
            <br />
            2026
          </span>
          <nav className="ml-auto flex items-center gap-1">
            <Link href="/plans" className="rounded-sm px-3 py-2 text-[13px] font-medium text-ink2 hover:bg-paper">
              Plan data
            </Link>
            <Link
              href="/login"
              className="rounded-sm bg-accent px-4 py-2 text-[13px] font-semibold text-white hover:bg-accent-strong"
            >
              Broker sign in
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1120px] flex-1 px-7 py-14" data-fade>
        {/* Hero */}
        <section className="mb-16 max-w-[760px]">
          <div className="eyebrow mb-3 text-accent">Seoul Medical Group · Broker Plan Recommender</div>
          <h1 className="display text-[40px] leading-[1.08] text-ink sm:text-[46px]">
            A fact-driven Medicare Advantage recommendation you can trace, line by line.
          </h1>
          <p className="mt-4 max-w-[620px] text-[15px] leading-[1.6] text-ink2">
            Built for SMG brokers and the members they serve. Capture a member's facts, get a ranked and
            cited plan recommendation across the 2026 SMG-supported plans — and a reproducible record of
            exactly how it was reached. Nothing is a black box.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              href="/login"
              className="rounded-sm bg-accent px-5 py-2.5 text-[14px] font-semibold text-white hover:bg-accent-strong"
            >
              Broker sign in →
            </Link>
            <a href="#how-it-works" className="px-2 py-2.5 text-[14px] font-semibold text-accent hover:underline">
              See how it works
            </a>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="mb-16 scroll-mt-8">
          <div className="eyebrow mb-1.5 text-ink2">How a recommendation is made</div>
          <h2 className="display mb-6 text-[26px] leading-[1.12] text-ink">Four steps, every figure traceable</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <div key={s.n} className="rounded-xl border border-line bg-surface p-5 shadow-card">
                <div className="num flex h-7 w-7 items-center justify-center rounded-full bg-accent text-[13px] font-semibold text-white">
                  {s.n}
                </div>
                <div className="mt-3 text-[14px] font-semibold text-ink">{s.title}</div>
                <p className="mt-1.5 text-[12.5px] leading-[1.5] text-ink2">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Why you can trust it */}
        <section className="mb-4">
          <div className="eyebrow mb-1.5 text-ink2">Why you can trust it</div>
          <h2 className="display mb-6 text-[26px] leading-[1.12] text-ink">Transparent by principle</h2>
          <div className="grid grid-cols-1 gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
            {PRINCIPLES.map(([title, body]) => (
              <div key={title} className="border-l-2 border-accent pl-4">
                <div className="text-[14px] font-semibold text-ink">{title}</div>
                <p className="mt-1 text-[12.5px] leading-[1.5] text-ink2">{body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* Footer CTA */}
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-4 px-7 py-8">
          <div>
            <div className="display text-[18px] font-semibold text-ink">Ready to find a member's best-fit plan?</div>
            <p className="text-[13px] text-ink2">Your clients and audit records are private to your account.</p>
          </div>
          <Link
            href="/login"
            className="rounded-sm bg-accent px-5 py-2.5 text-[14px] font-semibold text-white hover:bg-accent-strong"
          >
            Broker sign in →
          </Link>
        </div>
      </footer>
    </div>
  );
}
