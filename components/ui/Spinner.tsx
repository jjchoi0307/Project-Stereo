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
        border: `2px solid ${light ? "#fbfcfb66" : "#e4e9f0"}`,
        borderTopColor: light ? "#fbfcfb" : "#047a32",
        animation: "spin .7s linear infinite",
      }}
      aria-hidden
    />
  );
}
