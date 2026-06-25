import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/supabase/adminGuard";
import { recordEvent } from "@/lib/audit/eventStore";
import {
  getInputImportance,
  setInputImportance,
  type ImportanceConfig,
  type ImportanceKey,
  type ImportanceLevel,
} from "@/lib/config/orgSettings";

export const dynamic = "force-dynamic";

const LABELS: Record<ImportanceKey, { label: string; help: string }> = {
  familyHistory: { label: "Family history", help: "Genetic risk signal — drives the 5/10-year projection." },
  diagnosedConditions: { label: "Diagnosed conditions", help: "Hard clinical fact." },
  medications: { label: "Medications", help: "Hard clinical fact." },
  dualEligibility: { label: "Dual eligibility (Medi-Cal)", help: "Gates D-SNP plans." },
  providerRequirements: { label: "Provider requirements", help: "Must-keep providers." },
  lifestyle: { label: "Lifestyle / well-being (self-reported)", help: "Advisory only — kept low so a misreport can't swing the projection." },
};

/**
 * Scoring settings — admin-configurable input importance for the AI health-future
 * projection. org_admin only (the security role is read-only and never reaches here).
 */
export default async function AdminSettingsPage() {
  const ctx = await requireRole(["org_admin"]);
  const config = await getInputImportance(ctx.orgId);

  async function save(formData: FormData) {
    "use server";
    const actx = await requireRole(["org_admin"]);
    const next = {} as ImportanceConfig;
    for (const key of Object.keys(config) as ImportanceKey[]) {
      next[key] = (formData.get(key) === "high" ? "high" : "low") as ImportanceLevel;
    }
    await setInputImportance(actx.orgId, actx.brokerId, next);
    await recordEvent(actx, { action: "settings.update", metadata: { setting: "input_importance", ...next } });
    revalidatePath("/admin/settings");
  }

  return (
    <div>
      <p className="mb-1 text-[13px] text-slate-500">
        How heavily each intake input weighs in the <strong>AI health-future projection</strong>. Family history and
        hard clinical inputs are primary; self-reported lifestyle is advisory only.
      </p>
      <p className="mb-5 text-[12px] text-slate-400">
        These do not change today&apos;s plan-fit, which stays grounded in the 2026 plan files + hard clinical needs.
      </p>

      <form action={save} className="rounded-[11px] border border-slate-200 bg-white">
        {(Object.keys(LABELS) as ImportanceKey[]).map((key, i) => (
          <div
            key={key}
            className={`flex items-center gap-4 px-[18px] py-3.5 ${i > 0 ? "border-t border-slate-100" : ""}`}
          >
            <div className="flex-1">
              <div className="text-[13.5px] font-medium text-ink">{LABELS[key].label}</div>
              <div className="text-[12px] text-slate-400">{LABELS[key].help}</div>
            </div>
            <select
              name={key}
              defaultValue={config[key]}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[13px] focus:border-accent"
            >
              <option value="high">High</option>
              <option value="low">Low</option>
            </select>
          </div>
        ))}
        <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-[18px] py-3.5">
          <button
            type="submit"
            className="rounded-[9px] bg-accent px-[22px] py-2.5 text-[13.5px] font-semibold text-white hover:opacity-90"
          >
            Save settings
          </button>
        </div>
      </form>
    </div>
  );
}
