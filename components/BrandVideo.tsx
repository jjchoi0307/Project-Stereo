"use client";

import { useEffect, useState } from "react";

/**
 * Seoul Medical Group brand film for the public homepage.
 *
 * PERF: the lightweight poster (~130 KB) paints immediately as the hero image, and
 * the heavy video is mounted only AFTER the page has loaded (idle) — so the video
 * download never competes with the hero's first paint (keeps LCP/FCP fast). Once
 * mounted it autoplays muted + loops with native controls (browsers only allow
 * autoplay when muted). Self-hosted, same-origin under the strict CSP.
 */
export default function BrandVideo() {
  const [showVideo, setShowVideo] = useState(false);

  useEffect(() => {
    let idle: number | undefined;
    const start = () => {
      idle = window.requestIdleCallback
        ? window.requestIdleCallback(() => setShowVideo(true), { timeout: 1500 })
        : (window.setTimeout(() => setShowVideo(true), 300) as unknown as number);
    };
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
    return () => {
      window.removeEventListener("load", start);
      if (idle != null) (window.cancelIdleCallback ?? window.clearTimeout)(idle);
    };
  }, []);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-line bg-ink shadow-card">
      {showVideo ? (
        <video
          className="h-full w-full object-cover"
          src="/smg-brand.mp4"
          poster="/smg-brand-poster.jpg"
          autoPlay
          muted
          loop
          playsInline
          controls
          preload="auto"
        />
      ) : (
        // Poster paints as the hero image (fast LCP); video swaps in after load.
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/smg-brand-poster.jpg" alt="" fetchPriority="high" className="h-full w-full object-cover" />
      )}
    </div>
  );
}
