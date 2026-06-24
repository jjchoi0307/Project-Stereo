/**
 * Plan-kind badge: distinguishes a plain Medicare Advantage plan from a
 * dual-eligible "Medi-Medi" (D-SNP) or a chronic-condition (C-SNP) special-needs
 * plan. Driven by the plan's snpType.
 */
export default function PlanKind({ snpType }: { snpType?: string }) {
  const dsnp = snpType === "D-SNP";
  const csnp = snpType === "C-SNP";
  const label = dsnp ? "Medi-Medi (D-SNP)" : csnp ? "C-SNP" : "MA";
  const cls = dsnp
    ? "bg-indigo-50 text-indigo-700"
    : csnp
      ? "bg-amber-50 text-amber-700"
      : "bg-slate-100 text-slate-600";
  return (
    <span className={`rounded-md px-2 py-0.5 text-[10.5px] font-semibold ${cls}`} title={dsnp ? "Dual-eligible: Medicare + Medi-Cal" : csnp ? "Chronic-condition special-needs plan" : "Medicare Advantage"}>
      {label}
    </span>
  );
}
