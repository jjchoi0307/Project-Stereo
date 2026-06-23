"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function StartSessionButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    try {
      const res = await fetch("/api/sessions", { method: "POST" });
      const data = await res.json();
      router.push(`/session/${data.session.id}`);
    } catch {
      setBusy(false);
    }
  }

  return (
    <button onClick={start} disabled={busy}
      className="rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
      {busy ? "Starting…" : "+ Start new client session"}
    </button>
  );
}
