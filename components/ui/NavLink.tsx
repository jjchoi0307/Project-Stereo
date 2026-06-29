"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Header nav link that highlights itself (SMG green) when it's the active route,
 * so the broker always sees where they are. "/" matches exactly; other paths
 * also match their sub-routes (e.g. /audit highlights on /audit/[id]).
 */
export default function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-sm px-3 py-2 text-[13px] font-medium ${
        active ? "bg-accent/10 font-semibold text-accent" : "text-ink2 hover:bg-paper"
      }`}
    >
      {children}
    </Link>
  );
}
