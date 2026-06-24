import Image from "next/image";
import Link from "next/link";
import { signOut } from "@/app/login/actions";

/**
 * Sticky branded top bar for the authed broker routes (dashboard, session,
 * recommendation, audit, plans). Replaces the per-page inline headers.
 *
 * `authed` controls whether the sign-out / nav actions show — pass false on
 * memory-mode renders where there's no broker to sign out.
 */
export default function Header({ authed = true }: { authed?: boolean }) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
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
          <span className="hidden border-l border-slate-200 pl-3 text-[11px] leading-tight tracking-[.02em] text-slate-500 sm:block">
            Plan Recommender
            <br />
            2026
          </span>
        </Link>
        <nav className="ml-auto flex items-center gap-1">
          <Link
            href="/audit"
            className="rounded-[7px] px-3 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-50"
          >
            Audit log
          </Link>
          <Link
            href="/plans"
            className="rounded-[7px] px-3 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-50"
          >
            Plan data
          </Link>
          {authed && (
            <>
              <span className="mx-1.5 h-5 w-px bg-slate-200" />
              <form action={signOut}>
                <button
                  type="submit"
                  className="rounded-[7px] px-3 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-50"
                >
                  Sign out
                </button>
              </form>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
