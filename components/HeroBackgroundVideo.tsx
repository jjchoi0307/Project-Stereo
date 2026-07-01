"use client";

import { useEffect, useState } from "react";

/**
 * Full-bleed hero background video (editorial / Goldman-style). The poster paints
 * immediately as the hero image (LCP-safe); the muted autoplay loop mounts only
 * after load so it never blocks first paint. `object-cover` fills the hero. The
 * film plays silently with no on-screen sound control. Self-hosted, same-origin
 * under the strict CSP.
 */
export default function HeroBackgroundVideo() {
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
    <div className="absolute inset-0">
      {showVideo ? (
        <video
          className="h-full w-full object-cover"
          src="/smg-brand.mp4"
          poster="/smg-brand-poster.jpg"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/smg-brand-poster.jpg" alt="" fetchPriority="high" className="h-full w-full object-cover" />
      )}
    </div>
  );
}
