"use client";

import { useEffect, useState } from "react";
import type { Episode } from "@/lib/youtube";

/**
 * "Our Heroes / 우리동네 영웅들" showcase for the public login page.
 *
 * On a real domain the player loads eagerly so it's ready right away. On
 * localhost — where YouTube refuses to embed (Error 153) — it stays a branded
 * thumbnail (click to attempt play) so dev never shows an error box. Either way
 * the latest episode is featured and the strip swaps the active one. Uses the
 * youtube-nocookie player + i.ytimg.com thumbnails, allowed by the CSP only on
 * the auth pages (see middleware.ts).
 */
function thumb(id: string) {
  return `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
}
function thumbFallback(id: string) {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

export default function HeroVideos({ episodes }: { episodes: Episode[] }) {
  const [activeId, setActiveId] = useState(episodes[0]?.id ?? "");
  // Load the player immediately on real domains; keep the thumbnail on localhost
  // (YouTube blocks localhost embeds). Decided after mount to avoid hydration drift.
  const [eager, setEager] = useState(false);
  useEffect(() => {
    const h = window.location.hostname;
    const isLocal = h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" || h === "[::1]";
    if (!isLocal) setEager(true);
  }, []);

  if (!episodes.length) return null;
  const active = episodes.find((e) => e.id === activeId) ?? episodes[0];

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

      {/* Featured player */}
      <div className="aspect-video w-full overflow-hidden rounded-xl border border-line bg-ink shadow-card">
        {eager ? (
          <iframe
            key={activeId}
            className="h-full w-full"
            src={`https://www.youtube-nocookie.com/embed/${activeId}?rel=0&modestbranding=1`}
            title={active.title}
            referrerPolicy="strict-origin-when-cross-origin"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        ) : (
          <button
            type="button"
            onClick={() => setEager(true)}
            aria-label={`Play: ${active.title}`}
            className="group relative block h-full w-full"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumb(active.id)}
              onError={(e) => {
                const img = e.currentTarget;
                if (!img.src.includes("hqdefault")) img.src = thumbFallback(active.id);
              }}
              alt=""
              className="h-full w-full object-cover"
            />
            <span className="absolute inset-0 bg-ink/20 transition-colors group-hover:bg-ink/30" />
            <span className="absolute inset-0 grid place-items-center">
              <span className="grid h-[54px] w-[54px] place-items-center rounded-full bg-white/95 shadow-card transition-transform group-hover:scale-105">
                <span className="ml-1 h-0 w-0 border-y-[10px] border-l-[16px] border-y-transparent border-l-accent" />
              </span>
            </span>
            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/80 to-transparent px-4 pb-3 pt-8 text-left text-[13px] font-semibold leading-snug text-white">
              {active.title}
            </span>
          </button>
        )}
      </div>

      {/* Episode strip */}
      {episodes.length > 1 && (
        <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4">
          {episodes.map((ep) => {
            const isActive = ep.id === activeId;
            return (
              <button
                key={ep.id}
                type="button"
                onClick={() => {
                  setActiveId(ep.id);
                  setEager(true);
                }}
                aria-label={`Play: ${ep.title}`}
                className={`group overflow-hidden rounded-lg border bg-surface text-left transition-colors ${
                  isActive ? "border-accent ring-1 ring-accent/30" : "border-line hover:border-accent/50"
                }`}
              >
                <span className="relative block aspect-video w-full overflow-hidden bg-ink/5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://i.ytimg.com/vi/${ep.id}/hqdefault.jpg`}
                    alt=""
                    className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
                    loading="lazy"
                  />
                </span>
                <span className="block px-2 py-1.5 text-[11px] leading-[1.3] text-ink2 line-clamp-2">
                  {ep.title}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
