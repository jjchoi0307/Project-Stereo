"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import StatusPill from "@/components/ui/StatusPill";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/**
 * One session row on the broker dashboard. The main area links into the session;
 * a separate Remove control soft-deletes it (audit trail retained) and refreshes.
 */
export default function SessionRow({
  id,
  title,
  code,
  captured,
  createdAt,
}: {
  id: string;
  title: string;
  code: string;
  captured: boolean;
  createdAt: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm("Remove this client session from your list? Its audit record is kept.")) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/sessions/${id}`, { method: "DELETE" });
      if (r.ok) router.refresh();
      else {
        setBusy(false);
        window.alert("Could not remove the session. Please try again.");
      }
    } catch {
      setBusy(false);
      window.alert("Network error removing the session.");
    }
  }

  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 border-b border-line px-5 py-[15px] last:border-b-0 hover:bg-paper">
      <Link href={`/session/${id}`} className="contents">
        <div>
          <div className="text-sm font-semibold text-ink">{title}</div>
          <div className="num text-xs text-ink2">{code}</div>
        </div>
        <StatusPill status={captured ? "captured" : "awaiting"} />
        <div className="num text-[13px] text-ink2">{fmtDate(createdAt)}</div>
      </Link>
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        aria-label="Remove session"
        title="Remove session"
        className="rounded-sm px-2 py-1 text-[12.5px] font-medium text-ink2 hover:bg-neg/10 hover:text-neg disabled:opacity-50"
      >
        {busy ? "…" : "Remove"}
      </button>
    </div>
  );
}
