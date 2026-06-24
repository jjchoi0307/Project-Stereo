/**
 * Plan-data reference — the SMG-supported 2026 Medicare Advantage catalog,
 * rendered from the data-access layer with a client-side filter.
 */

import Header from "@/components/ui/Header";
import PlansCatalog, { type PlanRow } from "@/components/PlansCatalog";
import { getDataStore } from "@/lib/data";
import type { Plan } from "@/lib/domain";

export const dynamic = "force-dynamic";

function toRow(p: Plan): PlanRow {
  const b = p.benefits;

  // Concise benefit bullets derived from the numeric benefit fields (real, short).
  const benefits: string[] = [];
  if (b.pcpCopay === 0) benefits.push("$0 PCP visits");
  if (b.otcAllowanceQuarterly > 0) benefits.push(`$${b.otcAllowanceQuarterly}/qtr OTC card`);
  if (b.dentalAllowanceAnnual > 0) benefits.push("Routine dental");
  if (b.acupunctureVisitsPerYear > 0)
    benefits.push(
      b.acupunctureVisitsPerYear >= 999
        ? "Routine acupuncture"
        : `${b.acupunctureVisitsPerYear} acupuncture visits/yr`,
    );
  if (b.insulinMonthlyCap) benefits.push(`$${b.insulinMonthlyCap} insulin cap`);

  // Tags from supplemental categories actually present on the plan.
  const tags: string[] = [];
  if (p.snpType !== "none") tags.push(p.snpType);
  if (p.supplemental.dental) tags.push("Dental");
  if (p.supplemental.vision) tags.push("Vision");
  if (p.supplemental.otc) tags.push("OTC");
  if (p.supplemental.transportation) tags.push("Transportation");
  if (b.acupunctureVisitsPerYear > 0) tags.push("Acupuncture");
  if (p.supplemental.fitness) tags.push("Fitness");
  if (p.supplemental.hearing) tags.push("Hearing");

  return {
    id: p.id,
    name: p.name,
    carrier: p.carrier,
    type: p.planType,
    snpType: p.snpType,
    // Geography section. Every current plan serves California (all counties are CA);
    // when other-state plans are added, carry an explicit state on the plan data.
    state: "California",
    smg: p.smgSupported,
    premiumLabel: b.monthlyPremium === 0 ? "$0" : `$${b.monthlyPremium}`,
    oopLabel: "$" + b.annualOOPMax.toLocaleString(),
    benefits,
    tags,
  };
}

export default async function PlansPage() {
  const plans = await getDataStore().listPlans();
  const rows = plans.map(toRow);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-[1000px] px-6 pb-14 pt-9" data-fade>
        <PlansCatalog rows={rows} />
      </main>
    </div>
  );
}
