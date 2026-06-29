/** SMG card surface — a clean white card with soft elevation and rounded
 *  corners (see DESIGN.md). Approachable, not boxy. */
export default function Card({
  children,
  className = "",
  pad = "p-[22px]",
}: {
  children: React.ReactNode;
  className?: string;
  pad?: string;
}) {
  return (
    <section className={`rounded-xl border border-line bg-surface shadow-card ${pad} ${className}`}>
      {children}
    </section>
  );
}
