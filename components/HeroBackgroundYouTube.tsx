"use client";

/**
 * Full-bleed YouTube background (broker sign-in). Uses the privacy-preserving
 * youtube-nocookie player — the only frame origin allowed by the CSP. The player
 * autoplays muted and loops with NO visible YouTube chrome:
 *   - controls=0 / disablekb / fs=0 / iv_load_policy=3 hide the control bar,
 *     keyboard, fullscreen and annotations;
 *   - loop needs playlist=<same id> to actually repeat;
 *   - the wrapper is pointer-events:none, so hovering/clicking can never surface
 *     the title, share, or the hover watermark — and clicks fall through to the
 *     form above.
 * The iframe is scaled to COVER the viewport (16:9 sized to ≥100vw×100vh, centered)
 * so any residual corner branding is cropped off-screen, matching object-cover.
 */
const VIDEO_ID = "nrknp1DIa0E";

const SRC =
  `https://www.youtube-nocookie.com/embed/${VIDEO_ID}` +
  `?autoplay=1&mute=1&controls=0&loop=1&playlist=${VIDEO_ID}` +
  `&modestbranding=1&rel=0&iv_load_policy=3&disablekb=1&fs=0&playsinline=1&showinfo=0`;

export default function HeroBackgroundYouTube() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden bg-ink">
      <iframe
        src={SRC}
        title=""
        tabIndex={-1}
        allow="autoplay; encrypted-media; picture-in-picture"
        referrerPolicy="strict-origin-when-cross-origin"
        className="absolute left-1/2 top-1/2 h-[56.25vw] min-h-full w-[177.78vh] min-w-full -translate-x-1/2 -translate-y-1/2 border-0"
      />
    </div>
  );
}
