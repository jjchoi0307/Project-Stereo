/**
 * Session status pill. `awaiting` = SMG blue with a pulsing dot (pending —
 * waiting on the member's facts); `captured` = green (facts in).
 */
export default function StatusPill({
  status,
  pulse = false,
}: {
  status: "awaiting" | "captured";
  pulse?: boolean;
}) {
  const captured = status === "captured";
  const label = captured ? "Facts captured" : "Awaiting facts";
  const tag = captured
    ? "border-pos/30 bg-pos/10 text-pos"
    : "border-blue/30 bg-blue/10 text-blue";
  const dot = captured ? "bg-pos" : "bg-blue";
  return (
    <span
      className={`eyebrow inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px] ${tag}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${dot}`}
        style={{ animation: pulse && !captured ? "pulseDot 1.4s ease-in-out infinite" : undefined }}
      />
      {label}
    </span>
  );
}
