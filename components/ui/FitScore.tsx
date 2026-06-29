/**
 * The fit score as a calibrated instrument readout — not a gradient stat blob.
 *
 * A 0–100 fit is the hero number on a recommended plan. Rather than a bare big
 * number, this renders it as a gauge: the value (serif, the "reading"), a
 * calibrated track with band ticks, and a marker at the value — so a broker can
 * see not just the number but where it sits on the scale, and read confidence
 * alongside it.
 */
const BANDS = [
  { upTo: 45, label: "Weak" },
  { upTo: 65, label: "Fair" },
  { upTo: 80, label: "Strong" },
  { upTo: 100, label: "Excellent" },
];

function bandLabel(v: number): string {
  return (BANDS.find((b) => v <= b.upTo) ?? BANDS[BANDS.length - 1]).label;
}

const confLabel = (c: number) => (c >= 66 ? "High" : c >= 33 ? "Moderate" : "Low");
const confTone = (c: number) =>
  c >= 66 ? "text-pos" : c >= 33 ? "text-warn" : "text-ink2";

export default function FitScore({
  value,
  confidence,
  align = "right",
}: {
  value: number;
  confidence?: number;
  align?: "right" | "left";
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className={align === "right" ? "text-right" : "text-left"}>
      <div className="flex items-baseline gap-1.5" style={{ justifyContent: align === "right" ? "flex-end" : "flex-start" }}>
        <span className="num text-[40px] font-semibold leading-none text-accent-strong">{Math.round(value)}</span>
        <span className="num text-[12px] text-ink2">/100</span>
      </div>
      <div className="mt-1 flex items-center gap-2" style={{ justifyContent: align === "right" ? "flex-end" : "flex-start" }}>
        <span className="eyebrow !tracking-[.06em] text-accent">{bandLabel(clamped)} fit</span>
        {typeof confidence === "number" && (
          <span className={`eyebrow !tracking-[.06em] ${confTone(confidence)}`}>
            · {confLabel(confidence)} conf.
          </span>
        )}
      </div>
      {/* Calibrated track: a filled bar to the value with band-boundary ticks.
          Square ends + paper ticks — an instrument scale, not a pill. */}
      <div className="relative mt-2 h-[5px] w-[168px] overflow-hidden bg-line" style={{ marginLeft: align === "right" ? "auto" : 0 }}>
        <span className="absolute left-0 top-0 h-full bg-accent" style={{ width: `${clamped}%` }} />
        {[45, 65, 80].map((t) => (
          <span key={t} className="absolute top-0 h-full w-px bg-paper" style={{ left: `${t}%` }} />
        ))}
      </div>
    </div>
  );
}
