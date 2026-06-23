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
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-600">
          ✓
        </div>
        <h2 className="text-lg font-semibold text-ink">Thank you</h2>
        <p className="mt-1 text-sm text-slate-600">
          Your facts have been sent to your broker. You can hand the device back now.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 sm:p-8">
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
