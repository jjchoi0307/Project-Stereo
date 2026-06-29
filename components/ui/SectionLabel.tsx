/**
 * Numbered teal section eyebrow used on intake (filled tile) and the clinical
 * read (plain "n · Title"). Pass `step` for the filled-circle intake variant, or
 * `index` for the plain numbered-divider clinical-read variant.
 */
export function StepLabel({ step, children }: { step: number | string; children: React.ReactNode }) {
  return (
    <div className="eyebrow mb-3.5 flex items-center gap-2 text-accent">
      <span className="num inline-flex h-[18px] w-[18px] items-center justify-center rounded-sm bg-accent text-[11px] text-surface">
        {step}
      </span>
      {children}
    </div>
  );
}

export function ReadLabel({ children }: { children: React.ReactNode }) {
  return <div className="eyebrow text-ink2">{children}</div>;
}
