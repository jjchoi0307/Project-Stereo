/**
 * Session status pill. `awaiting` = amber with a pulsing dot (live-waiting);
 * `captured` = emerald (facts in).
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
  const fg = captured ? "#059669" : "#d97706";
  const bg = captured ? "#ecfdf5" : "#fffbeb";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{ background: bg, color: fg }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: fg, animation: pulse && !captured ? "pulseDot 1.4s ease-in-out infinite" : undefined }}
      />
      {label}
    </span>
  );
}
