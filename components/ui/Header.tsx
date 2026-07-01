import Image from "next/image";
import Link from "next/link";
import NavLink from "@/components/ui/NavLink";
import { signOut } from "@/app/login/actions";
import { getBrokerContext } from "@/lib/supabase/auth";
import { stateStore } from "@/lib/supabase/env";

/**
 * Sticky branded top bar. Auth-aware so the public/authed boundary never leaks:
 *  - Signed-in broker (or no-auth dev/memory mode) → broker nav (Home, Audit log,
 *    Plan data, Settings, Sign out). Sign out shows only with a real session.
 *  - Logged-out visitor (Supabase mode) → public nav (Plan data, Broker sign in),
 *    logo → /home. No broker-internal links are exposed.
 *
 * It resolves its own auth state, so callers just render <Header />.
 */
export default async function Header() {
  const ctx = await getBrokerContext();
  const isMemory = stateStore() !== "supabase"; // no auth in dev/memory mode
  const broker = !!ctx || isMemory; // show the broker workspace nav
  const isElevated = ctx?.role === "org_admin" || ctx?.role === "security";

  const navLink = "rounded-sm px-3 py-2 text-[13px] font-medium text-ink2 hover:bg-paper";

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface">
      <div className="mx-auto flex h-[60px] max-w-[1120px] items-center gap-5 px-7">
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/smg-logo.png"
            alt="Seoul Medical Group"
            width={156}
            height={30}
            priority
            className="h-[30px] w-auto"
          />
          <span className="hidden border-l border-line pl-3 font-mono text-[10px] uppercase leading-tight tracking-[.14em] text-ink2 sm:block">
            Plan Recommender
            <br />
            2026
          </span>
        </Link>

        <nav className="ml-auto flex items-center gap-1">
          {broker ? (
            <>
              <NavLink href="/">Home</NavLink>
              <NavLink href="/audit">Audit log</NavLink>
              <NavLink href="/plans">Plan data</NavLink>
              {isElevated && <NavLink href="/admin/audit">Admin</NavLink>}
              <NavLink href="/settings">Settings</NavLink>
              {ctx && (
                <>
                  <span className="mx-1.5 h-5 w-px bg-line" />
                  <form action={signOut}>
                    <button type="submit" className={navLink}>
                      Sign out
                    </button>
                  </form>
                </>
              )}
            </>
          ) : (
            <>
              <NavLink href="/plans">Plan data</NavLink>
              <Link
                href="/login"
                className="rounded-sm bg-accent px-4 py-2 text-[13px] font-semibold text-white hover:bg-accent-strong"
              >
                Broker sign in
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
