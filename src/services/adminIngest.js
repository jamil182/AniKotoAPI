/*
 * AniKotoAPI — adminIngest.js
 * Pure CMS ingest logic (no network). The HTTP layer fetches metadata,
 * episodes, and stream resolutions, then hands them here to store.
 *
 * @exports malEmbedUrl, ingestAnikoto, ingestMalEpisode
 */

import { upsertAnime, upsertEpisode } from "../db/library.repo.js";

/** Build the megaplay embed URL for a MAL/AniList episode. */
export function malEmbedUrl({ source, id, episode, dub }) {
  // MegaPlay's AniList path segment is "ani", not "anilist".
  const seg = source === "anilist" ? "ani" : source;
  return `https://megaplay.buzz/stream/${seg}/${id}/${episode}/${dub ? "dub" : "sub"}`;
}

/** Store a full Anikoto series (metadata + every episode). */
export function ingestAnikoto(db, { info, episodes, sub, dub, autoUpdate }) {
  const animeId = upsertAnime(db, {
    anikotoId: info.animeId || null, slug: info.slug, title: info.title,
    japaneseTitle: info.japaneseTitle, poster: info.poster, banner: info.backgroundImage,
    synopsis: info.synopsis, type: info.type, status: info.status,
    genres: info.genres, studios: info.studios, rating: info.rating,
    totalEpisodes: episodes.length, autoUpdate,
  });
  for (const e of episodes) {
    upsertEpisode(db, animeId, {
      number: Number(e.episode_no), title: e.title || null,
      sub: !!sub, dub: !!dub, serverIds: e.server_ids || null, source: "anikoto",
    });
  }
  return { animeId, episodeCount: episodes.length };
}

/**
 * Store a single MAL/AniList episode, merged into the matching anime. When
 * `meta` (from the catalog) is present, the anime gets a real title/poster/
 * synopsis instead of a placeholder.
 */
export function ingestMalEpisode(db, { source, id, episode, sub, dub, embedUrl, meta }) {
  const key = source === "anilist" ? { anilistId: Number(id) } : { malId: Number(id) };
  const animeId = upsertAnime(db, {
    ...key,
    title: meta?.title || `${source.toUpperCase()} ${id}`,
    poster: meta?.poster || null,
    synopsis: meta?.synopsis || null,
    status: meta?.status || null,
    type: meta?.type || null,
  });
  upsertEpisode(db, animeId, {
    number: Number(episode), sub: !!sub, dub: !!dub, embedUrl, source,
  });
  return { animeId };
}
