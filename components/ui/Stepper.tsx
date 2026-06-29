import Link from "next/link";

/**
 * The broker journey progress indicator (see WORKFLOW.md). A fixed 4-step path —
 * Capture facts → Clinical read → Recommendation → On record — shown across the
 * in-session screens so the broker always knows where they are and what's next.
 *
 * `current` is the 0-based index of the active step. Completed steps render as
 * links (pass an href) so the broker can step back; upcoming steps are muted.
 */
export interface Step {
  label: string;
  href?: string; // only navigated for completed steps
}

export default function Stepper({ steps, current }: { steps: Step[]; current: number }) {
  return (
    <nav aria-label="Progress" className="mb-6">
      <ol className="flex flex-wrap items-center gap-y-2">
        {steps.map((s, i) => {
          const status = i < current ? "done" : i === current ? "current" : "upcoming";
          const circle =
            status === "done"
              ? "border-accent bg-accent text-white"
              : status === "current"
                ? "border-accent bg-surface text-accent"
                : "border-line bg-surface text-ink2";
          const labelCls =
            status === "upcoming" ? "text-ink2" : "text-ink";
          const marker = (
            <span className="flex items-center gap-2">
              <span
                className={`num flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full border text-[11px] font-semibold ${circle}`}
              >
                {status === "done" ? "✓" : i + 1}
              </span>
              <span className={`text-[12.5px] font-semibold ${labelCls}`}>{s.label}</span>
            </span>
          );
          return (
            <li key={s.label} className="flex items-center">
              {status === "done" && s.href ? (
                <Link
                  href={s.href}
                  className="rounded-sm hover:underline"
                  aria-label={`Back to ${s.label}`}
                >
                  {marker}
                </Link>
              ) : (
                <span aria-current={status === "current" ? "step" : undefined}>{marker}</span>
              )}
              {i < steps.length - 1 && (
                <span
                  className={`mx-3 h-px w-7 flex-none ${i < current ? "bg-accent" : "bg-line"}`}
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
