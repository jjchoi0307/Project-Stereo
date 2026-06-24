/** The teal SMG logo tile. */
export default function Brand({ size = 30 }: { size?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-[7px] bg-accent font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.47, letterSpacing: "-.5px" }}
      aria-hidden
    >
      S
    </div>
  );
}
