import Image from "next/image";
import Link from "next/link";
import NavLink from "@/components/ui/NavLink";
import { signOut } from "@/app/login/actions";
import { getBrokerContext } from "@/lib/supabase/auth";
import { stateStore } from "@/lib/supabase/env";

/**
 * Sticky branded top bar — one nav across the landing, /plans, and the workspace.
 * Auth-aware so the public/authed boundary never leaks:
 *  - Signed-in broker (or no-auth dev/memory mode) → broker nav (Home, Audit log,
 *    Plan data, Settings, Sign out). Sign out shows only with a real session.
 *  - Logged-out visitor → public nav (Plan data, Broker sign in), matching the
 *    landing masthead exactly (plain link + solid-green primary).
 */
export default async function Header() {
  const ctx = await getBrokerContext();
  const isMemory = stateStore() !== "supabase"; // no auth in dev/memory mode
  const broker = !!ctx || isMemory; // show the broker workspace nav
  const isElevated = ctx?.role === "org_admin" || ctx?.role === "security";

  const signInBtn =
    "border border-ink/30 px-4 py-2 text-[13px] font-semibold text-ink transition-colors hover:border-ink hover:bg-ink hover:text-white";

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-[64px] max-w-[1200px] items-center gap-6 px-6 sm:px-10">
        <Link href="/" className="flex items-center">
          <Image src="/smg-logo.png" alt="Seoul Medical Group" width={150} height={29} priority className="h-[29px] w-auto" />
        </Link>
        <span className="hidden font-mono text-[10px] uppercase leading-tight tracking-[.16em] text-ink2 sm:block">
          Health Plan Recommender · 2026
        </span>

        <nav className="ml-auto flex items-center gap-1">
          {broker ? (
            <>
              <NavLink href="/">Home</NavLink>
              <NavLink href="/plans">Plan Library</NavLink>
              <NavLink href="/audit">Audit log</NavLink>
              {isElevated && <NavLink href="/admin/audit">Admin</NavLink>}
              <NavLink href="/settings">Settings</NavLink>
              {ctx && (
                <>
                  <span className="mx-1.5 h-5 w-px bg-line" />
                  <form action={signOut}>
                    <button type="submit" className="rounded-sm px-3 py-2 text-[13px] font-medium text-ink2 hover:bg-paper">
                      Sign out
                    </button>
                  </form>
                </>
              )}
            </>
          ) : (
            <>
              {/* Plan Library is broker-only (confidential plan facts) — no public link. */}
              <Link href="/login" className={signInBtn}>
                Broker sign in
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
