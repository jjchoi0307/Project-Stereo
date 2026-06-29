/** The teal SMG logo tile. */
export default function Brand({ size = 30 }: { size?: number }) {
  return (
    <div
      className="display flex items-center justify-center rounded-sm bg-accent font-bold text-surface"
      style={{ width: size, height: size, fontSize: size * 0.5, letterSpacing: "-.5px" }}
      aria-hidden
    >
      S
    </div>
  );
}
