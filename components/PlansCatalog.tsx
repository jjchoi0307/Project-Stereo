"use client";

import { useMemo, useState } from "react";
import PlanKind from "@/components/ui/PlanKind";

export interface PlanRow {
  id: string;
  name: string;
  carrier: string;
  type: string;
  snpType?: string;
  /** Geography this plan serves — the section it's grouped under. */
  state: string;
  smg: boolean;
  premiumLabel: string;
  oopLabel: string;
  benefits: string[];
  tags: string[];
}

export default function PlansCatalog({ rows }: { rows: PlanRow[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return rows;
    return rows.filter((p) =>
      `${p.name} ${p.carrier} ${p.type} ${p.state} ${p.tags.join(" ")} ${p.benefits.join(" ")}`
        .toLowerCase()
        .includes(q),
    );
  }, [rows, query]);

  // Group by geography so the catalog is organized by state — and so additional
  // states (e.g. New York, Washington) slot in as their own sections as we expand.
  const byState = useMemo(() => {
    const m = new Map<string, PlanRow[]>();
    for (const p of filtered) {
      const list = m.get(p.state);
      if (list) list.push(p);
      else m.set(p.state, [p]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-5">
        <div>
          <div className="eyebrow mb-1.5 text-accent">Plan reference · 2026</div>
          <h1 className="mb-1 font-serif text-[clamp(2rem,3vw,2.5rem)] font-light leading-[1.05] tracking-[-0.01em] text-ink">Plan data</h1>
          <p className="text-[13.5px] leading-[1.5] text-ink2">
            SMG-supported Medicare Advantage plans · 2026, by geography · showing{" "}
            <span className="num">{filtered.length}</span> of <span className="num">{rows.length}</span>. All current
            plans serve <strong className="font-semibold text-ink">California</strong>; other states will appear as separate
            sections as the network expands.
          </p>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter carrier, type, benefit…"
          className="w-[260px] max-w-full rounded-sm border border-line bg-surface px-3.5 py-[9px] text-[13px]"
        />
      </div>

      {byState.map(([state, plans]) => (
        <section key={state} className="mb-8">
          <div className="mb-2.5 flex items-center gap-2.5">
            <h2 className="eyebrow text-accent">{state}</h2>
            <span className="num text-[11px] text-ink2">{plans.length} plans</span>
            <span className="h-px flex-1 bg-line" />
          </div>
          <div className="record overflow-hidden">
            {plans.map((p) => (
              <div
                key={p.id}
                className="grid grid-cols-[1fr_auto] items-start gap-3 border-t border-line px-[18px] py-[15px] first:border-t-0"
              >
                <div>
                  <div className="mb-[3px] flex flex-wrap items-center gap-2.5">
                    <span className="display text-[16px] font-semibold text-ink">{p.name}</span>
                    <PlanKind snpType={p.snpType} />
                    {p.smg && (
                      <span className="border border-accent/40 px-[7px] py-0.5 text-[10px] font-semibold uppercase tracking-[.04em] text-accent">
                        SMG network
                      </span>
                    )}
                  </div>
                  <div className="mb-1.5 text-xs text-ink2">
                    {p.carrier} · {p.type}
                  </div>
                  {p.benefits.length > 0 && (
                    <div className="text-xs leading-[1.45] text-ink2">{p.benefits.join(" · ")}</div>
                  )}
                  {p.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {p.tags.map((t) => (
                        <span key={t} className="border border-line px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[.03em] text-ink2">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="whitespace-nowrap text-right">
                  <div>
                    <span className="num text-[17px] font-semibold text-ink">{p.premiumLabel}</span>
                    <span className="text-[11px] text-ink2">/mo</span>
                  </div>
                  <div className="mt-0.5 text-[11px] uppercase tracking-[.03em] text-ink2">OOP max</div>
                  <div className="num text-[13px] font-semibold text-ink2">{p.oopLabel}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
      {filtered.length === 0 && (
        <div className="record px-6 py-10 text-center text-sm text-ink2">
          No plans match “{query}”.
        </div>
      )}
    </>
  );
}
