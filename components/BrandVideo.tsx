"use client";

import { useState } from "react";

/**
 * Seoul Medical Group brand film for the public homepage. Self-hosted (no
 * third-party player, no embedding restrictions, same-origin under the strict
 * CSP) and click-to-play with sound: the poster paints instantly (~130 KB) and
 * nothing downloads until the visitor chooses to watch (preload="none"), so the
 * 30s spot never taxes a first homepage load. The narrative audio is preserved
 * — unlike a muted autoplay loop — which is the point of a brand film.
 */
export default function BrandVideo() {
  const [playing, setPlaying] = useState(false);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-line bg-ink shadow-card">
      {playing ? (
        <video
          className="h-full w-full object-cover"
          src="/smg-brand.mp4"
          poster="/smg-brand-poster.jpg"
          controls
          autoPlay
          loop
          playsInline
          preload="auto"
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label="Play the Seoul Medical Group story"
          className="group relative block h-full w-full"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/smg-brand-poster.jpg" alt="" className="h-full w-full object-cover" />
          <span className="absolute inset-0 bg-ink/15 transition-colors group-hover:bg-ink/25" />
          <span className="absolute inset-0 grid place-items-center">
            <span className="grid h-[60px] w-[60px] place-items-center rounded-full bg-white/95 shadow-card transition-transform group-hover:scale-105">
              <span className="ml-1 h-0 w-0 border-y-[11px] border-l-[18px] border-y-transparent border-l-accent" />
            </span>
          </span>
        </button>
      )}
    </div>
  );
}
