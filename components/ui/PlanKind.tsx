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
    ? "border-ai/30 bg-ai/10 text-ai"
    : csnp
      ? "border-warn/30 bg-warn/10 text-warn"
      : "border-prov/30 bg-prov/10 text-prov"; // MA (Medicare Advantage)
  return (
    <span
      className={`eyebrow inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] ${cls}`}
      title={dsnp ? "Dual-eligible: Medicare + Medi-Cal" : csnp ? "Chronic-condition special-needs plan" : "Medicare Advantage"}
    >
      {label}
    </span>
  );
}
