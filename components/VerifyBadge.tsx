"use client";

import { useState } from "react";
import RecordSeal from "@/components/ui/RecordSeal";

/**
 * Button-triggered reproducibility check for an audit record. Re-runs the engine
 * with the recorded seed + versions and confirms the ranking reproduces exactly.
 * The verification seal (RecordSeal) is the trust centerpiece — teal ✓ when the
 * re-run reproduces the ranking, rose ✗ on mismatch, slate · while verifying.
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
        className="flex-none border border-accent bg-surface px-[22px] py-3 text-[13.5px] font-semibold text-accent hover:bg-accent hover:text-surface"
      >
        Verify now
      </button>
    );
  }
  if (state === "running") {
    return (
      <RecordSeal
        tone="pending"
        center="SMG"
        caption={<span className="block text-[12px] font-semibold text-ink">Re-running engine…</span>}
      />
    );
  }
  if (state === "ok") {
    return (
      <RecordSeal
        tone="verified"
        center="SMG"
        caption={
          <span className="block text-[12px] font-semibold text-pos">Ranking reproduced exactly</span>
        }
      />
    );
  }
  return (
    <RecordSeal
      tone="broken"
      center="SMG"
      caption={<span className="block text-[12px] font-semibold text-neg">Did not reproduce</span>}
    />
  );
}
