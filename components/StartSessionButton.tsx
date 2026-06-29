"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Spinner from "@/components/ui/Spinner";

export default function StartSessionButton({ compact = false }: { compact?: boolean }) {
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
      <button
        onClick={start}
        disabled={busy}
        className="flex items-center gap-2.5 whitespace-nowrap rounded-sm bg-accent px-[18px] py-2.5 text-sm font-semibold text-white hover:bg-accent-strong disabled:opacity-50"
      >
        {busy ? <Spinner light /> : <span className="-mt-px text-[17px] leading-none">+</span>}
        Start new client session
      </button>
      {error && <p className="mt-2 text-sm text-neg">{error}</p>}
    </div>
  );
}
