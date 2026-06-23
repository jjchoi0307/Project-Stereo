"use client";

import { useEffect, useState } from "react";

export default function VerifyBadge({ auditId }: { auditId: string }) {
  const [state, setState] = useState<"checking" | "ok" | "fail">("checking");

  useEffect(() => {
    let active = true;
    fetch(`/api/audit/${auditId}/verify`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => active && setState(d.reproduced ? "ok" : "fail"))
      .catch(() => active && setState("fail"));
    return () => { active = false; };
  }, [auditId]);

  const map = {
    checking: { cls: "bg-slate-100 text-slate-500", text: "Reproducing…" },
    ok: { cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200", text: "✓ Reproduced exactly" },
    fail: { cls: "bg-rose-50 text-rose-700 ring-1 ring-rose-200", text: "✗ Did not reproduce" },
  }[state];

  return <span className={`rounded px-2 py-1 text-xs ${map.cls}`}>{map.text}</span>;
}
