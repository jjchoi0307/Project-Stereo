/**
 * Footnote citations for recommendation bullets — book-style: each cited bullet
 * gets a superscript reference number, and a per-plan "Sources" list maps each
 * number to the source health-plan PDF + the exact figure behind it.
 *
 * Two kinds (intellectually honest):
 *  - document: the figure is stated directly in the plan PDF (verbatim line).
 *  - computed: the bullet is a simulation result; we cite the documented INPUTS
 *    it was computed from, never a single PDF line.
 */
export interface Citation {
  sourceFile: string;
  quote: string;
  kind: "document" | "computed";
  /** Page in the source PDF, when known (book-style footnote). */
  page?: number | null;
}

export interface CitedReason {
  code: string;
  text: string;
  positive: boolean;
  citation?: Citation | null;
}

/** Base URL where the plan PDFs are hosted; enables a "view source" link. */
const DOC_BASE = process.env.NEXT_PUBLIC_PLAN_DOC_BASE_URL?.replace(/\/$/, "") ?? "";

function sourceHref(c: Citation): string | null {
  if (!DOC_BASE) return null;
  const url = `${DOC_BASE}/${encodeURIComponent(c.sourceFile)}`;
  return c.page ? `${url}#page=${c.page}` : url;
}

/** Superscript footnote reference, like a book citation. */
export function Ref({ n }: { n: number | null }) {
  if (!n) return null;
  return <sup className="num ml-0.5 text-[9px] font-bold text-accent">{n}</sup>;
}

/** Per-plan footnote list: each bullet's source PDF (+ page) and the exact figure. */
export function Sources({ cited }: { cited: CitedReason[] }) {
  return (
    <div className="mb-1 mt-1 rounded-sm border border-line bg-paper px-3.5 py-2.5">
      <div className="eyebrow mb-1.5 text-ink2">Sources</div>
      <ol className="space-y-1">
        {cited.map((r, i) => {
          const c = r.citation!;
          const href = sourceHref(c);
          const fileLabel = c.page ? `${c.sourceFile} · p.${c.page}` : c.sourceFile;
          return (
            <li key={r.code} className="flex gap-2 text-[11px] leading-[1.45] text-ink2">
              <span className="num flex-none font-bold text-accent">{i + 1}.</span>
              <span>
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="num lk text-ink2">
                    {fileLabel}
                  </a>
                ) : (
                  <span className="num text-ink2">{fileLabel}</span>
                )}
                {c.kind === "computed" && (
                  <span className="eyebrow ml-1 rounded-sm border border-ai/30 bg-ai/10 px-1 py-px text-[9px] text-ai">
                    computed
                  </span>
                )}
                {" — "}
                <span className="italic">“{c.quote}”</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
