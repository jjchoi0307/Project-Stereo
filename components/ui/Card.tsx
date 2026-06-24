/** White rounded card matching the design's section surface. */
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
    <section className={`rounded-xl border border-slate-200 bg-white ${pad} ${className}`}>
      {children}
    </section>
  );
}
