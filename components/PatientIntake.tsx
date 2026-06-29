"use client";

import { useState } from "react";
import type { IntakeReference } from "@/lib/intake/types";
import IntakeForm from "./IntakeForm";

export default function PatientIntake({
  token,
  reference,
}: {
  token: string;
  reference: IntakeReference;
}) {
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div className="mx-auto max-w-[440px] text-center" data-fade>
        <div className="mb-[18px] inline-flex h-14 w-14 items-center justify-center rounded-full border border-pos/40 bg-pos/10 text-[26px] text-pos">
          ✓
        </div>
        <h1 className="display mb-2 text-[26px] font-semibold leading-[1.15] text-ink">Thank you — sent to your broker</h1>
        <p className="text-sm leading-[1.55] text-ink2">
          Your facts are with your Seoul Medical Group broker. They&apos;ll review them and walk you through your
          plan options.
        </p>
        <p className="mt-[18px] text-[12.5px] text-ink2">You can close this window.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[660px] rounded-sm border border-line bg-surface p-[26px]">
      <IntakeForm
        submitUrl={`/api/intake/${token}`}
        capturedBy="patient"
        reference={reference}
        variant="patient"
        submitLabel="Send to my broker"
        onSubmitted={() => setDone(true)}
      />
    </div>
  );
}
