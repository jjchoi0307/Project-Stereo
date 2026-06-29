import "server-only";

/**
 * "Our Heroes / 우리동네 영웅들" episodes for the public login showcase.
 *
 * Auto-updates: when YOUTUBE_API_KEY + YOUTUBE_PLAYLIST_ID are set, it pulls the
 * playlist from the YouTube Data API (server-side, cached 1h) so newly published
 * episodes appear automatically — no code changes month to month. Without those
 * env vars (or on any error) it falls back to the pinned latest episode so the
 * page always renders. The API key is read server-side only (server-only import).
 */
export interface Episode {
  id: string;
  title: string;
  publishedAt?: string;
}

// Pinned fallback — the current latest (Ep 6). Used until the playlist is wired.
const FALLBACK: Episode[] = [
  { id: "QhWPqzXJYbc", title: "Ep 6 · 시계는 내 인생의 장난감" },
];

export async function getEpisodes(max = 6): Promise<Episode[]> {
  const key = process.env.YOUTUBE_API_KEY;
  const playlistId = process.env.YOUTUBE_PLAYLIST_ID;
  if (!key || !playlistId) return FALLBACK;

  try {
    const url =
      `https://www.googleapis.com/youtube/v3/playlistItems` +
      `?part=snippet&maxResults=${Math.min(max, 50)}` +
      `&playlistId=${encodeURIComponent(playlistId)}&key=${encodeURIComponent(key)}`;
    // Cache for an hour: new monthly episodes surface within the hour, and we
    // never hammer the API on every page view.
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return FALLBACK;
    const data: {
      items?: { snippet?: { title?: string; publishedAt?: string; resourceId?: { videoId?: string } } }[];
    } = await res.json();

    const episodes = (data.items ?? [])
      .map((it) => ({
        id: it.snippet?.resourceId?.videoId ?? "",
        title: it.snippet?.title ?? "",
        publishedAt: it.snippet?.publishedAt,
      }))
      .filter((e) => e.id && e.title && e.title !== "Private video" && e.title !== "Deleted video")
      // newest first → the latest episode is featured
      .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));

    return episodes.length ? episodes.slice(0, max) : FALLBACK;
  } catch {
    return FALLBACK;
  }
}
