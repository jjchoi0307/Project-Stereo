import type { Episode } from "@/lib/youtube";

/**
 * "Our Heroes / 우리동네 영웅들" showcase for the public login page.
 *
 * Branded thumbnails that open the episode on YouTube in a new tab — avoids
 * inline-embed fragility entirely and works everywhere. Uses hqdefault.jpg, which
 * YouTube always generates for every video (unlike maxresdefault, which 404s on
 * non-HD uploads and caused a broken image until refresh). Plain server component
 * so the thumbnail is in the initial HTML and renders immediately, no hydration.
 */
const watch = (id: string) => `https://www.youtube.com/watch?v=${id}`;
const thumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

function PlayBadge({ size = 54 }: { size?: number }) {
  return (
    <span
      className="grid place-items-center rounded-full bg-white/95 shadow-card transition-transform group-hover:scale-105"
      style={{ width: size, height: size }}
    >
      <span
        style={{
          marginLeft: size * 0.08,
          width: 0,
          height: 0,
          borderTopWidth: size * 0.18,
          borderBottomWidth: size * 0.18,
          borderLeftWidth: size * 0.3,
          borderStyle: "solid",
          borderTopColor: "transparent",
          borderBottomColor: "transparent",
          borderLeftColor: "#047a32",
        }}
      />
    </span>
  );
}

export default function HeroVideos({ episodes }: { episodes: Episode[] }) {
  if (!episodes.length) return null;
  const [featured, ...rest] = episodes;

  return (
    <div data-fade>
      <div className="eyebrow mb-2 text-accent">To whom we serve</div>
      <h2 className="display mb-1.5 text-[26px] font-semibold leading-[1.12] text-ink">
        Our Heroes · 우리동네 영웅들
      </h2>
      <p className="mb-5 max-w-[520px] text-[13.5px] leading-[1.5] text-ink2">
        Stories from the people who make our neighborhoods stronger — a new episode every month from
        Seoul Medical Group.
      </p>

      {/* Featured episode → opens on YouTube */}
      <a
        href={watch(featured.id)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Watch on YouTube: ${featured.title}`}
        className="group relative block aspect-video w-full overflow-hidden rounded-xl border border-line bg-ink shadow-card"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={thumb(featured.id)} alt="" className="h-full w-full object-cover" />
        <span className="absolute inset-0 bg-ink/20 transition-colors group-hover:bg-ink/30" />
        <span className="absolute inset-0 grid place-items-center">
          <PlayBadge />
        </span>
        <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-ink/85 to-transparent px-4 pb-3 pt-10 text-left">
          <span className="text-[13px] font-semibold leading-snug text-white">{featured.title}</span>
          <span className="num shrink-0 text-[10px] font-semibold uppercase tracking-[.06em] text-white/85">
            Watch ↗
          </span>
        </span>
      </a>

      {/* Other episodes */}
      {rest.length > 0 && (
        <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4">
          {rest.map((ep) => (
            <a
              key={ep.id}
              href={watch(ep.id)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Watch on YouTube: ${ep.title}`}
              className="group overflow-hidden rounded-lg border border-line bg-surface text-left transition-colors hover:border-accent/50"
            >
              <span className="relative block aspect-video w-full overflow-hidden bg-ink/5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={thumb(ep.id)}
                  alt=""
                  className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
                  loading="lazy"
                />
                <span className="absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100">
                  <PlayBadge size={34} />
                </span>
              </span>
              <span className="block px-2 py-1.5 text-[11px] leading-[1.3] text-ink2 line-clamp-2">{ep.title}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
