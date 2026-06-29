/**
 * The verification seal — the product's signature mark.
 *
 * Every recommendation this tool produces is reproducible: the same captured
 * facts and engine version always yield the same ranking. The seal makes that
 * promise visible — a notary-style engraved mark that carries the reproducibility
 * metadata. It appears on the lead recommendation ("on record") and is the trust
 * centerpiece of the audit record ("verified" / "mismatch").
 *
 *  tone="recorded" — teal, the recommendation has been snapshotted to an audit record
 *  tone="verified" — teal ✓, the audit re-ran and the ranking reproduced exactly
 *  tone="pending"  — slate, the record is being generated
 *  tone="broken"   — rose ✗, re-running the engine did not reproduce the ranking
 */
type Tone = "recorded" | "verified" | "pending" | "broken";

const GLYPH: Record<Tone, string> = {
  recorded: "✓",
  verified: "✓",
  pending: "·",
  broken: "✗",
};

const SEAL_CLASS: Record<Tone, string> = {
  recorded: "seal",
  verified: "seal",
  pending: "seal seal--pending",
  broken: "seal seal--broken",
};

export default function RecordSeal({
  tone = "recorded",
  size = 56,
  center = "SMG",
  caption,
}: {
  tone?: Tone;
  size?: number;
  /** Word stamped through the seal's middle band. */
  center?: string;
  /** Reproducibility metadata rendered beside the mark. */
  caption?: React.ReactNode;
}) {
  const mark = (
    <span
      className={SEAL_CLASS[tone]}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${tone} seal`}
    >
      <span className="flex flex-col items-center justify-center leading-none">
        <span style={{ fontSize: size * 0.3 }} className="num font-semibold">
          {GLYPH[tone]}
        </span>
        <span
          style={{ fontSize: size * 0.13, letterSpacing: ".08em" }}
          className="mt-[2px] font-semibold uppercase"
        >
          {center}
        </span>
      </span>
    </span>
  );

  if (!caption) return mark;
  return (
    <div className="flex items-center gap-3">
      {mark}
      <div className="text-[11px] leading-[1.45] text-ink2">{caption}</div>
    </div>
  );
}
