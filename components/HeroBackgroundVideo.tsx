"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Full-bleed hero background video (editorial / Goldman-style). The poster paints
 * immediately as the hero image (LCP-safe); the muted autoplay loop mounts only
 * after load so it never blocks first paint. `object-cover` fills the hero; a
 * discreet mute toggle sits bottom-right (the film has a voiceover). Self-hosted,
 * same-origin under the strict CSP.
 */
export default function HeroBackgroundVideo() {
  const ref = useRef<HTMLVideoElement>(null);
  const [showVideo, setShowVideo] = useState(false);
  const [muted, setMuted] = useState(true);

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

  const toggleMute = () => {
    const v = ref.current;
    if (!v) return;
    v.muted = !v.muted;
    if (!v.muted && v.paused) v.play().catch(() => {});
    setMuted(v.muted);
  };

  return (
    <>
      <div className="absolute inset-0">
        {showVideo ? (
          <video
            ref={ref}
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
      {showVideo && (
        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? "Unmute the film" : "Mute the film"}
          className="absolute bottom-6 right-6 z-20 grid h-11 w-11 place-items-center rounded-full border border-white/30 bg-black/30 text-white backdrop-blur transition-colors hover:bg-black/50"
        >
          {muted ? (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M3 9v6h4l5 5V4L7 9H3z" />
              <path d="M16 8l5 5m0-5l-5 5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 00-2.5-4.03v8.06A4.5 4.5 0 0016.5 12z" />
            </svg>
          )}
        </button>
      )}
    </>
  );
}
