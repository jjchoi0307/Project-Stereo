import { requireRole } from "@/lib/supabase/adminGuard";
import type { AuditEventRow } from "@/lib/audit/eventStore";

export const dynamic = "force-dynamic";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const ACTION_LABEL: Record<string, string> = {
  "recommendation.surface": "Recommendation surfaced",
  "intake.submit": "Intake submitted",
  "session.create": "Session created",
  "profile.write": "Facts saved",
  "audit.read": "Audit record viewed",
  "audit.write": "Audit record saved",
  "settings.update": "Scoring settings changed",
  "intake.token_issue": "Patient link issued",
  "intake.resolve": "Patient link opened",
};

/**
 * The org-wide audit trail. org_admin + security read every event in the org
 * (RLS: auth_can_read_org_audit); a broker would only ever see their own — but
 * the layout already restricts this page to elevated roles.
 */
export default async function AdminAuditPage() {
  const ctx = await requireRole(["org_admin", "security"]);

  const { data: rawEvents } = await ctx.client
    .from("access_events")
    .select("id,created_at,actor,broker_id,action,session_id,metadata,outcome")
    .order("created_at", { ascending: false })
    .limit(250);
  const events = (rawEvents as AuditEventRow[] | null) ?? [];

  // Best-effort broker-name map (org_admin can read org brokers; security may not —
  // then we just show the actor id).
  const { data: brokers } = await ctx.client.from("brokers").select("id,name,email");
  const nameById = new Map((brokers ?? []).map((b: { id: string; name: string | null; email: string }) => [b.id, b.name || b.email]));
  const actorLabel = (e: AuditEventRow) =>
    e.broker_id ? nameById.get(e.broker_id) ?? e.broker_id.slice(0, 8) : e.actor;

  const planOf = (m: Record<string, unknown>) =>
    (m?.topPlanName as string) || (m?.planSurfaced as string) || (m?.topPlanId as string) || "";

  return (
    <div>
      <p className="mb-4 text-[13px] text-slate-500">
        Every action across the recommender and the engagement view. Showing the {events.length} most recent.
      </p>
      <div className="overflow-hidden rounded-[11px] border border-slate-200 bg-white">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-[.03em] text-slate-500">
              <th className="px-3.5 py-2.5 font-semibold">When</th>
              <th className="px-3.5 py-2.5 font-semibold">Broker</th>
              <th className="px-3.5 py-2.5 font-semibold">Action</th>
              <th className="px-3.5 py-2.5 font-semibold">Session</th>
              <th className="px-3.5 py-2.5 font-semibold">Plan surfaced</th>
              <th className="px-3.5 py-2.5 font-semibold">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3.5 py-6 text-center text-slate-400">
                  No audit events yet.
                </td>
              </tr>
            ) : (
              events.map((e) => (
                <tr key={e.id} className="border-t border-slate-100">
                  <td className="num whitespace-nowrap px-3.5 py-2.5 text-slate-500">{fmt(e.created_at)}</td>
                  <td className="px-3.5 py-2.5">{actorLabel(e)}</td>
                  <td className="px-3.5 py-2.5 font-medium">{ACTION_LABEL[e.action] ?? e.action}</td>
                  <td className="num px-3.5 py-2.5 text-slate-400">{e.session_id ? e.session_id.slice(0, 8) : "—"}</td>
                  <td className="px-3.5 py-2.5 text-slate-600">{planOf(e.metadata) || "—"}</td>
                  <td className="px-3.5 py-2.5">
                    <span className={e.outcome === "ok" ? "text-emerald-600" : "text-rose-600"}>{e.outcome}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
