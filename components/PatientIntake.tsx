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
        <div className="mb-[18px] inline-flex h-14 w-14 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-[26px] text-emerald-600">
          ✓
        </div>
        <h1 className="mb-2 text-[22px] font-semibold text-ink">Thank you — sent to your broker</h1>
        <p className="text-sm leading-[1.55] text-slate-500">
          Your facts are with your Seoul Medical Group broker. They&apos;ll review them and walk you through your
          plan options.
        </p>
        <p className="mt-[18px] text-[12.5px] text-slate-400">You can close this window.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[660px] rounded-xl border border-slate-200 bg-white p-[26px]">
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
