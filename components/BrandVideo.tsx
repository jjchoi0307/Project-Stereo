/**
 * Seoul Medical Group brand film for the public homepage. Autoplays muted and
 * loops on load (browsers only permit autoplay when muted); the native controls
 * let visitors unmute and pause. Self-hosted (same-origin under the strict CSP),
 * poster paints instantly.
 */
export default function BrandVideo() {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-line bg-ink shadow-card">
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
    </div>
  );
}
