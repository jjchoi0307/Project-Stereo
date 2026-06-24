"use client";

import { useState } from "react";

/**
 * Button-triggered reproducibility check for an audit record. Re-runs the engine
 * with the recorded seed + versions and confirms the ranking reproduces exactly.
 */
export default function VerifyBadge({ auditId }: { auditId: string }) {
  const [state, setState] = useState<"idle" | "running" | "ok" | "fail">("idle");

  const run = () => {
    setState("running");
    fetch(`/api/audit/${auditId}/verify`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setState(d.reproduced ? "ok" : "fail"))
      .catch(() => setState("fail"));
  };

  if (state === "idle") {
    return (
      <button
        onClick={run}
        className="flex-none rounded-[9px] bg-accent px-[22px] py-3 text-[13.5px] font-semibold text-white hover:opacity-90"
      >
        Verify now
      </button>
    );
  }
  if (state === "running") {
    return (
      <div className="flex flex-none items-center gap-2.5 text-[13.5px] font-medium text-slate-300">
        <span
          className="inline-block h-[15px] w-[15px] rounded-full"
          style={{ border: "2px solid #ffffff33", borderTopColor: "#fff", animation: "spin .7s linear infinite" }}
        />
        Re-running engine…
      </div>
    );
  }
  if (state === "ok") {
    return (
      <div className="flex flex-none items-center gap-2.5 rounded-[9px] border border-emerald-600 bg-emerald-950 px-[18px] py-[11px] text-[13.5px] font-semibold text-emerald-300">
        ✓ Ranking reproduced exactly
      </div>
    );
  }
  return (
    <div className="flex flex-none items-center gap-2.5 rounded-[9px] border border-rose-500 bg-rose-950 px-[18px] py-[11px] text-[13.5px] font-semibold text-rose-300">
      ✗ Did not reproduce
    </div>
  );
}
