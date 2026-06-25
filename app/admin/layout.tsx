import Link from "next/link";
import Header from "@/components/ui/Header";
import { requireRole } from "@/lib/supabase/adminGuard";

export const dynamic = "force-dynamic";

/**
 * Admin area shell. Gated to elevated roles: org_admin (full) and security
 * (read-only monitoring). Plain brokers are redirected away by requireRole.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireRole(["org_admin", "security"]);
  const isAdmin = ctx.role === "org_admin";

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-[1000px] px-6 pb-14 pt-7" data-fade>
        <div className="mb-5 flex items-center gap-3">
          <h1 className="m-0 text-[21px] font-semibold text-ink">Admin</h1>
          <span className="rounded-md bg-slate-100 px-2.5 py-[3px] text-[10.5px] font-semibold uppercase tracking-[.03em] text-slate-600">
            {ctx.role === "security" ? "Security · read-only" : "Org admin"}
          </span>
        </div>
        <nav className="mb-6 flex gap-1 border-b border-slate-200">
          <AdminTab href="/admin/audit" label="Audit log" />
          {isAdmin && <AdminTab href="/admin/settings" label="Scoring settings" />}
        </nav>
        {children}
      </main>
    </div>
  );
}

function AdminTab({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-t-lg px-4 py-2 text-[13.5px] font-medium text-slate-600 hover:bg-slate-50 hover:text-accent"
    >
      {label}
    </Link>
  );
}
