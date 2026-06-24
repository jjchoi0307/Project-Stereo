/** Inline spinner matching the design's button/loading affordance. */
export default function Spinner({
  size = 14,
  light = false,
}: {
  size?: number;
  light?: boolean;
}) {
  return (
    <span
      className="inline-block rounded-full"
      style={{
        width: size,
        height: size,
        border: `2px solid ${light ? "#ffffff66" : "#cbd5e1"}`,
        borderTopColor: light ? "#fff" : "#0d6e6e",
        animation: "spin .7s linear infinite",
      }}
      aria-hidden
    />
  );
}
