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
  const [state, setState] = useState<"idle" | "running" | "ok" | "fail" | "version" | "tampered">("idle");

  const run = () => {
    setState("running");
    fetch(`/api/audit/${auditId}/verify`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        // Content HMAC mismatch = the stored record was altered after signing.
        // This is the strongest negative signal — surface it as tampering, not a
        // mere reproduction miss.
        if (d.contentIntact === false) return setState("tampered");
        if (d.reproduced) return setState("ok");
        // A version difference is not a tamper signal — the record was created
        // under an earlier dataset/engine, so a live re-run can legitimately
        // differ. Surface it distinctly rather than as "did not reproduce".
        if (d.dataVersionMatch === false || d.engineVersionMatch === false) return setState("version");
        setState("fail");
      })
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
          <span className="block text-[12px] font-semibold text-pos">Verified — record intact, backbone reproduced</span>
        }
      />
    );
  }
  if (state === "tampered") {
    return (
      <RecordSeal
        tone="broken"
        center="SMG"
        caption={
          <span className="block text-[12px] font-semibold text-neg">Integrity check failed — record altered</span>
        }
      />
    );
  }
  if (state === "version") {
    return (
      <RecordSeal
        tone="pending"
        center="SMG"
        caption={
          <span className="block text-[12px] font-semibold text-ink">
            Created under an earlier data/engine version
          </span>
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
