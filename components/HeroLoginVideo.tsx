"use client";

import { useRef, useState } from "react";

/**
 * Full-bleed self-hosted background film for the broker sign-in. A native muted
 * autoplay-loop <video> — same-origin, so NO third-party player, NO YouTube
 * chrome, and NO play/controls overlay can ever appear (a bare <video> with no
 * `controls` renders none). Autoplay is reliable because it's muted + inline.
 *
 * The clip is a short H.264 loop transcoded from the source film. A poster paints
 * first for a fast first frame; a single custom mute/unmute control sits
 * bottom-left. `object-cover` fills the viewport so nothing letterboxes.
 */
export default function HeroLoginVideo() {
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);

  const toggleMute = () => {
    const v = ref.current;
    if (!v) return;
    v.muted = !v.muted;
    if (!v.muted && v.paused) v.play().catch(() => {});
    setMuted(v.muted);
  };

  return (
    <>
      <div aria-hidden className="absolute inset-0 overflow-hidden bg-ink">
        <video
          ref={ref}
          className="h-full w-full object-cover"
          src="/smg-login.mp4"
          poster="/smg-login-poster.jpg"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          tabIndex={-1}
        />
      </div>

      <button
        type="button"
        onClick={toggleMute}
        aria-label={muted ? "Unmute the film" : "Mute the film"}
        className="absolute bottom-6 left-6 z-20 grid h-11 w-11 place-items-center rounded-full border border-white/30 bg-black/30 text-white backdrop-blur transition-colors hover:bg-black/50"
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
    </>
  );
}
