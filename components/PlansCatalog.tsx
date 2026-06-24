"use client";

import { useMemo, useState } from "react";

export interface PlanRow {
  id: string;
  name: string;
  carrier: string;
  type: string;
  smg: boolean;
  premiumLabel: string;
  oopLabel: string;
  benefits: string[];
  tags: string[];
}

const usd = (s: string) => s;

export default function PlansCatalog({ rows }: { rows: PlanRow[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return rows;
    return rows.filter((p) =>
      `${p.name} ${p.carrier} ${p.type} ${p.tags.join(" ")} ${p.benefits.join(" ")}`.toLowerCase().includes(q),
    );
  }, [rows, query]);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="mb-1 text-2xl font-semibold tracking-[-.01em] text-ink">Plan data</h1>
          <p className="text-[13.5px] text-slate-500">
            SMG-supported Medicare Advantage plans · 2026 · showing{" "}
            <span className="num">{filtered.length}</span> of <span className="num">{rows.length}</span>.
          </p>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter carrier, type, benefit…"
          className="w-[260px] max-w-full rounded-[9px] border border-slate-300 px-3.5 py-[9px] text-[13px]"
        />
      </div>

      <div className="flex flex-col gap-2">
        {filtered.map((p) => (
          <div
            key={p.id}
            className="grid grid-cols-[1fr_auto] items-start gap-3 rounded-[11px] border border-slate-200 bg-white px-[18px] py-[15px]"
          >
            <div>
              <div className="mb-[3px] flex flex-wrap items-center gap-2.5">
                <span className="text-[14.5px] font-semibold">{p.name}</span>
                {p.smg && (
                  <span className="rounded-[5px] bg-emerald-50 px-[7px] py-0.5 text-[10px] font-bold uppercase tracking-[.03em] text-emerald-600">
                    SMG network
                  </span>
                )}
              </div>
              <div className="mb-1.5 text-xs text-slate-500">
                {p.carrier} · {p.type}
              </div>
              {p.benefits.length > 0 && (
                <div className="text-xs leading-[1.45] text-slate-600">{p.benefits.join(" · ")}</div>
              )}
              {p.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {p.tags.map((t) => (
                    <span key={t} className="rounded-[5px] bg-slate-100 px-2 py-0.5 text-[10.5px] font-medium text-slate-600">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="whitespace-nowrap text-right">
              <div>
                <span className="num text-[17px] font-semibold">{p.premiumLabel}</span>
                <span className="text-[11px] text-slate-400">/mo</span>
              </div>
              <div className="mt-0.5 text-[11px] text-slate-400">OOP max</div>
              <div className="num text-[13px] font-semibold text-slate-600">{usd(p.oopLabel)}</div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="rounded-[11px] border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-500">
            No plans match “{query}”.
          </div>
        )}
      </div>
    </>
  );
}
