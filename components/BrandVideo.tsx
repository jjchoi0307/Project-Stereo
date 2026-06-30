"use client";

import { useRef, useState } from "react";

/**
 * Seoul Medical Group brand film for the public homepage. Autoplays muted and
 * loops the moment the page loads (browsers only permit autoplay when muted),
 * with an unmute control so visitors can hear the story, and native controls for
 * pause/scrub (accessibility: auto-playing media must be pausable). Self-hosted
 * (same-origin under the strict CSP), poster paints instantly.
 */
export default function BrandVideo() {
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);

  const toggleMute = () => {
    const v = ref.current;
    if (!v) return;
    v.muted = !v.muted;
    // If autoplay was paused for any reason, unmuting is a user gesture — resume.
    if (!v.muted && v.paused) v.play().catch(() => {});
    setMuted(v.muted);
  };

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-line bg-ink shadow-card">
      <video
        ref={ref}
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
      {/* Prominent unmute affordance — muted autoplay means sound is off until
          the visitor opts in. Hidden once unmuted (native controls remain). */}
      {muted && (
        <button
          type="button"
          onClick={toggleMute}
          aria-label="Unmute the video"
          className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-ink/70 px-3 py-1.5 text-[12px] font-semibold text-white backdrop-blur transition-colors hover:bg-ink/85"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 00-2.5-4.03v8.06A4.5 4.5 0 0016.5 12z" />
          </svg>
          Tap for sound
        </button>
      )}
    </div>
  );
}
