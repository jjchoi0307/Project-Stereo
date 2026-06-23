"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function StartSessionButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sessions", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.session?.id) {
        setError("Couldn't start a session. Please try again.");
        setBusy(false);
        return;
      }
      router.push(`/session/${data.session.id}`);
    } catch {
      setError("Network error. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div>
      <button onClick={start} disabled={busy}
        className="rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
        {busy ? "Starting…" : "+ Start new client session"}
      </button>
      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
    </div>
  );
}
