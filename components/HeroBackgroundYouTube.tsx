"use client";

import { useState } from "react";

/**
 * Full-bleed YouTube background (broker sign-in). Uses the privacy-preserving
 * youtube-nocookie player — the only frame origin the CSP allows.
 *
 * No YouTube chrome ever shows:
 *   - controls=0 / disablekb / fs=0 / iv_load_policy=3 / modestbranding strip the
 *     control bar, keyboard, fullscreen and annotations;
 *   - the iframe is pointer-events:none, so the mouse passes THROUGH it — the
 *     player never receives hover/click, so its play/pause/next overlay can never
 *     appear (clicks fall through to the form);
 *   - loop needs playlist=<same id> to actually repeat.
 *
 * Mute/unmute: a single custom control swaps the iframe `src` between mute=1 and
 * mute=0. Autoplay must start muted (browser policy), but the toggle click is a
 * user gesture, so re-loading with sound is allowed. Swapping src (via the mute
 * `key`) is deliberately simple and reliable — no enablejsapi/postMessage, which
 * suppresses muted-autoplay in some browsers.
 * The iframe is scaled to COVER the viewport so any residual corner mark is
 * cropped off-screen.
 */
const VIDEO_ID = "nrknp1DIa0E";
const PLAYER_ORIGIN = "https://www.youtube-nocookie.com";

const src = (muted: boolean) =>
  `${PLAYER_ORIGIN}/embed/${VIDEO_ID}` +
  `?autoplay=1&mute=${muted ? 1 : 0}&controls=0&loop=1&playlist=${VIDEO_ID}` +
  `&modestbranding=1&rel=0&iv_load_policy=3&disablekb=1&fs=0&playsinline=1&showinfo=0`;

export default function HeroBackgroundYouTube() {
  const [muted, setMuted] = useState(true);

  return (
    <>
      <div aria-hidden className="absolute inset-0 overflow-hidden bg-ink">
        <iframe
          key={muted ? "muted" : "unmuted"}
          src={src(muted)}
          title=""
          tabIndex={-1}
          allow="autoplay; encrypted-media; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          className="pointer-events-none absolute left-1/2 top-1/2 h-[56.25vw] min-h-full w-[177.78vh] min-w-full -translate-x-1/2 -translate-y-1/2 border-0"
        />
        {/* Transparent shield: intercepts EVERY pointer event so the YouTube
            player never receives a hover or click — its control bar, play/pause
            and next buttons can't appear. (pointer-events:none on the iframe
            alone is unreliable across browsers for cross-origin frames.) The
            sign-in card (z-10) and the mute button (z-20) sit above this layer,
            so they stay fully interactive. */}
        <div className="absolute inset-0" />
      </div>

      <button
        type="button"
        onClick={() => setMuted((m) => !m)}
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
