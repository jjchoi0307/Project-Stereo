import Link from "next/link";
import { getAuditStore } from "@/lib/audit/store";
import { getDataStore } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function AuditLogPage() {
  const [records, plans] = await Promise.all([getAuditStore().list(), getDataStore().listPlans()]);
  const planName = new Map(plans.map((p) => [p.id, p.name]));

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-6">
        <Link href="/" className="text-sm text-accent hover:underline">← Home</Link>
        <h1 className="mt-2 text-2xl font-semibold text-ink">Audit log</h1>
        <p className="mt-1 text-sm text-slate-600">
          Every recommendation is stored as a reproducible record.
        </p>
      </header>

      {records.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
          No audit records yet. Generate a recommendation to create one.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
          {records.map((r) => (
            <li key={r.id}>
              <Link href={`/audit/${r.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
                <div>
                  <div className="font-mono text-sm font-medium text-ink">{r.id}</div>
                  <div className="text-xs text-slate-500">
                    {new Date(r.createdAt).toLocaleString()} · top:{" "}
                    {r.ranking[0] ? planName.get(r.ranking[0]) ?? r.ranking[0] : "—"}
                  </div>
                </div>
                {r.preferenceChangedTop && (
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-700">
                    preference changed top
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
