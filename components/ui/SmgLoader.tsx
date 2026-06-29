/**
 * SMG-branded loader — the real logo symbol (no "SMG" wordmark) with a loading
 * sweep that travels down the mark: a bright band passes from the blue top to the
 * green bottom over a dim track copy, looping like a spinner that follows the
 * logo's own shape. Reduced-motion shows the solid mark.
 */
export default function SmgLoader({
  size = 48,
  label,
}: {
  size?: number;
  /** Optional caption rendered under the mark. */
  label?: string;
}) {
  const w = Math.round(size * 0.52); // mark aspect (84×161)
  const mark = (
    <span className="relative inline-block align-middle" style={{ width: w, height: size }} aria-hidden>
      {/* Dim track — the full mark, always faintly visible */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/smg-mark.png" alt="" className="absolute inset-0 h-full w-full opacity-[0.18]" />
      {/* Bright sweep — same mark, revealed by the traveling mask band */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/smg-mark.png" alt="" className="smg-sweep absolute inset-0 h-full w-full" />
    </span>
  );
  // Inline (no label): render just the mark so it sits alongside text.
  if (!label) {
    return (
      <span role="status" aria-label="Loading" className="inline-flex">
        {mark}
      </span>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3" role="status" aria-label={label}>
      {mark}
      <span className="text-[12.5px] text-ink2">{label}</span>
    </div>
  );
}
