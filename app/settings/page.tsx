/**
 * Broker account settings — the truthful, real-data account surface.
 *
 * Reads the signed-in broker's identity from `getBrokerContext()` (role) plus
 * the canonical auth email (`ctx.client.auth.getUser()`). In memory/dev mode
 * (no auth) the context is null, so we show a calm "sign in" note rather than
 * fabricating an identity. The only action here is the real `signOut` server
 * action. Everything else is informational and matches the app's privacy posture
 * — no dead toggles.
 */
import Link from "next/link";
import type { BrokerRole } from "@/lib/supabase/client";
import { getBrokerContext } from "@/lib/supabase/auth";
import { signOut } from "@/app/login/actions";
import Header from "@/components/ui/Header";

export const dynamic = "force-dynamic";

/** Plain-language label for the access role (from the brokers table). */
function roleLabel(role: BrokerRole): string {
  switch (role) {
    case "org_admin":
      return "Agency administrator";
    case "security":
      return "Security (read-only monitor)";
    default:
      return "Broker";
  }
}

export default async function SettingsPage() {
  const ctx = await getBrokerContext();
  const authed = ctx !== null;

  // The canonical signed-in identity. getBrokerContext already resolved the auth
  // user (and is request-cached), so this read is cheap and truthful.
  let email: string | null = null;
  if (ctx) {
    const {
      data: { user },
    } = await ctx.client.auth.getUser();
    email = user?.email ?? null;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header authed={authed} />
      <main className="mx-auto w-full max-w-[760px] px-6 pb-16 pt-9" data-fade>
        {/* Masthead */}
        <div className="mb-8">
          <div className="eyebrow mb-1.5 text-accent">Account</div>
          <h1 className="display text-[33px] leading-[1.05] text-ink">Settings</h1>
        </div>

        {/* Your account */}
        <section className="record mb-5 p-6">
          <h2 className="display mb-4 text-[16px] text-ink">Your account</h2>

          {authed && email ? (
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-[120px_1fr]">
              <dt className="text-[13px] font-medium text-ink2">Email</dt>
              <dd className="num text-[14px] text-ink">{email}</dd>

              <dt className="text-[13px] font-medium text-ink2">Role</dt>
              <dd className="text-[14px] text-ink">{roleLabel(ctx!.role)}</dd>
            </dl>
          ) : authed ? (
            // Authed but the email couldn't be read — don't invent one.
            <p className="text-[14px] leading-relaxed text-ink2">
              You're signed in, but we couldn't read your account email just now.
              Try refreshing the page.
            </p>
          ) : (
            <p className="text-[14px] leading-relaxed text-ink2">
              Account settings require a signed-in broker account.{" "}
              <Link href="/login" className="lk">
                Sign in
              </Link>{" "}
              to see your email and role. (You're currently in local mode with no
              account attached.)
            </p>
          )}
        </section>

        {/* Sign out — the real server action, only when there's a session to end. */}
        {authed && (
          <section className="record mb-5 p-6">
            <h2 className="display mb-1 text-[16px] text-ink">Sign out</h2>
            <p className="mb-4 text-[14px] leading-relaxed text-ink2">
              End your session on this device. You'll return to the sign-in screen.
            </p>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-sm bg-accent px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-accent-strong"
              >
                Sign out
              </button>
            </form>
          </section>
        )}

        {/* Privacy & data — truthful statement of the app's posture. */}
        <section className="record mb-5 p-6">
          <h2 className="display mb-3 text-[16px] text-ink">Privacy &amp; data</h2>
          <ul className="space-y-2.5 text-[14px] leading-relaxed text-ink2">
            <li className="flex gap-2.5">
              <span aria-hidden className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
              <span>
                Your clients and audit records are private to your account — visible
                only to you and your agency's administrators.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span aria-hidden className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
              <span>
                Every recommendation is reproducible and logged to a re-verifiable
                audit record — never a black box.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span aria-hidden className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
              <span>
                No protected health information is ever placed in page URLs.
              </span>
            </li>
          </ul>
        </section>

        {/* A single honest "future" line — no dead controls. */}
        <p className="px-1 text-[13px] text-ink2">
          Team &amp; agency settings are coming soon.
        </p>
      </main>
    </div>
  );
}
