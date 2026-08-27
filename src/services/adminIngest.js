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
  return `https://megaplay.buzz/stream/${source}/${id}/${episode}/${dub ? "dub" : "sub"}`;
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

/** Store a single MAL/AniList episode, merged into the matching anime. */
export function ingestMalEpisode(db, { source, id, episode, sub, dub, embedUrl }) {
  const key = source === "anilist" ? { anilistId: Number(id) } : { malId: Number(id) };
  const animeId = upsertAnime(db, { ...key, title: `${source.toUpperCase()} ${id}` });
  upsertEpisode(db, animeId, {
    number: Number(episode), sub: !!sub, dub: !!dub, embedUrl, source,
  });
  return { animeId };
}
