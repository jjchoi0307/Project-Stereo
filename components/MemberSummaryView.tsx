"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Spinner from "@/components/ui/Spinner";
import PlanKind from "@/components/ui/PlanKind";
import type { RankedItem } from "./RecommendationView";

/**
 * MEMBER-FACING summary — the clean, plain-language, printable view a broker shows
 * or hands the prospective member. Progressive disclosure: this is the simple
 * surface; the broker keeps the full analyst view (fit scores, sub-scores,
 * citations, cost basis) on the recommendation page. Reads the SAME recommendation
 * the broker saw (one cached compute) — no jargon, no scores, no sources here.
 */
interface RecResponse {
  topPlanId: string | null;
  aiPowered?: boolean;
  ranked?: RankedItem[];
  error?: string;
  detail?: string;
}

const usd = (n: number) => "$" + n.toLocaleString();
const premium = (n: number) => (n === 0 ? "$0 monthly premium" : `$${n}/month premium`);

/** Supplemental extras to surface as friendly chips (skip the cost/med rows we show explicitly). */
const EXTRA_LABELS = new Set(["Dental", "Vision", "Hearing", "OTC / flex allowance", "Transportation", "Fitness"]);

function PlanBlock({ item, lead }: { item: RankedItem; lead: boolean }) {
  const keepsDoctors = item.networkStatus === "keeps" || item.networkStatus === "in";
  const medRate = item.exposure?.medCoverageRate ?? 1;
  const allMeds = medRate >= 0.999;
  const extras = (item.features ?? []).filter((f) => f.included && EXTRA_LABELS.has(f.label));
  const positives = item.reasons.filter((r) => r.positive).slice(0, lead ? 4 : 1);

  return (
    <section
      className={`rounded-[14px] border bg-white p-6 ${lead ? "border-accent shadow-[0_8px_24px_-12px_rgba(13,110,110,.35)]" : "border-slate-200"}`}
    >
      {lead && (
        <div className="mb-2 text-[11px] font-bold uppercase tracking-[.06em] text-accent">Your best-fit plan</div>
      )}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className={`m-0 font-semibold text-ink ${lead ? "text-[24px]" : "text-[18px]"}`}>{item.plan.name}</h2>
        <PlanKind snpType={item.plan.snpType} />
      </div>
      <div className="mt-1 text-[14px] text-slate-500">{item.plan.carrier}</div>

      <div className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
        <div>
          <div className="text-[12px] uppercase tracking-[.03em] text-slate-400">Premium</div>
          <div className="num text-[18px] font-semibold text-ink">{premium(item.plan.monthlyPremium)}</div>
        </div>
        <div>
          <div className="text-[12px] uppercase tracking-[.03em] text-slate-400">Most you'd pay in a year</div>
          <div className="num text-[18px] font-semibold text-ink">{usd(item.plan.annualOOPMax)}</div>
        </div>
      </div>

      <ul className="mt-4 flex flex-col gap-2">
        {keepsDoctors && (
          <li className="flex items-start gap-2 text-[14px] leading-[1.5] text-slate-700">
            <span className="mt-0.5 text-emerald-600">✓</span> Keeps your current doctors in network
          </li>
        )}
        <li className="flex items-start gap-2 text-[14px] leading-[1.5] text-slate-700">
          <span className="mt-0.5 text-emerald-600">✓</span>
          {allMeds ? "All of your medications are covered" : `${Math.round(medRate * 100)}% of your medications are covered`}
        </li>
        {extras.length > 0 && (
          <li className="flex items-start gap-2 text-[14px] leading-[1.5] text-slate-700">
            <span className="mt-0.5 text-emerald-600">✓</span> Includes {extras.map((e) => e.label.replace(" / flex allowance", "")).join(", ").toLowerCase()}
          </li>
        )}
      </ul>

      {positives.length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          {lead && <div className="mb-2 text-[13px] font-semibold text-slate-600">Why this fits you</div>}
          <ul className="flex flex-col gap-1.5">
            {positives.map((r) => (
              <li key={r.code} className="text-[13.5px] leading-[1.55] text-slate-600">
                · {r.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default function MemberSummaryView({ sessionId, clientRef }: { sessionId: string; clientRef: string }) {
  const [data, setData] = useState<RecResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let active = true;
    fetch(`/api/sessions/${sessionId}/recommendation`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: RecResponse) => {
        if (!active) return;
        if (d && Array.isArray(d.ranked)) (setData(d), setStatus("ready"));
        else setStatus("error");
      })
      .catch(() => active && setStatus("error"));
    return () => {
      active = false;
    };
  }, [sessionId]);

  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const top = (data?.ranked ?? []).filter((r) => r.deepWritten);
  const picks = top.length > 0 ? top : (data?.ranked ?? []).slice(0, 3);
  const lead = picks[0];
  const alternatives = picks.slice(1, 3);

  return (
    <div className="mx-auto w-full max-w-[760px] px-6 pb-16 pt-6">
      {/* Toolbar — not part of the printout */}
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link href={`/session/${sessionId}/recommendation`} className="lk text-[13px]">
          ← Back to recommendation
        </Link>
        {status === "ready" && (
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90"
          >
            Print / Save as PDF
          </button>
        )}
      </div>

      {/* Branded header */}
      <div className="mb-6 flex items-center justify-between border-b border-slate-200 pb-4">
        <div>
          <div className="text-[13px] font-bold uppercase tracking-[.06em] text-accent">Seoul Medical Group</div>
          <h1 className="m-0 mt-1 text-[22px] font-semibold text-ink">Your plan recommendation</h1>
        </div>
        <div className="text-right text-[12px] text-slate-400">
          <div>{today}</div>
          <div className="num">Ref {clientRef}</div>
        </div>
      </div>

      {status === "loading" && (
        <div className="flex items-center gap-2.5 py-12 text-sm text-slate-500">
          <Spinner /> Preparing the summary…
        </div>
      )}
      {status === "error" && (
        <p className="py-12 text-sm text-slate-500">
          The recommendation isn&apos;t ready yet. Open it on the recommendation page first, then come back.
        </p>
      )}

      {status === "ready" && !lead && (
        <p className="py-12 text-sm text-slate-600">No eligible plan was found for this member&apos;s requirements.</p>
      )}

      {status === "ready" && lead && (
        <div className="flex flex-col gap-5">
          <PlanBlock item={lead} lead />
          {alternatives.length > 0 && (
            <>
              <div className="mt-2 text-[13px] font-semibold uppercase tracking-[.04em] text-slate-500">
                Other strong options
              </div>
              {alternatives.map((a) => (
                <PlanBlock key={a.planId} item={a} lead={false} />
              ))}
            </>
          )}
          <p className="mt-3 text-[12px] leading-[1.6] text-slate-400">
            Prepared by your Seoul Medical Group broker on {today}. This summary is to help you compare and choose a
            Medicare Advantage plan — enrolling is your decision. It is not medical or financial advice. Plan benefits
            are drawn from the carriers&apos; 2026 plan documents.
          </p>
        </div>
      )}
    </div>
  );
}
