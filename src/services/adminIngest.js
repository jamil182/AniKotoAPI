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

/**
 * Store a full Anikoto series from the catalog. `series` is the shape returned
 * by fetchCatalogSeries: `{ anime, episodes:[{number, title, embed:{sub?,dub?}}] }`.
 * Each episode's embed URLs are stored as JSON in `embed_url`; the sub/dub
 * checkboxes filter which languages to store (falling back to whatever exists
 * so no episode is left unplayable). The catalog's mal_id/ani_id are stored so
 * a later MAL/AniList fetch merges into this same anime.
 */
export function ingestAnikoto(db, { series, anikotoId, sub, dub, autoUpdate }) {
  const { anime, episodes } = series;
  const animeId = upsertAnime(db, {
    ...anime, anikotoId: anikotoId || null,
    totalEpisodes: episodes.length, autoUpdate,
  });
  let stored = 0;
  for (const e of episodes) {
    const embed = {};
    if (sub !== false && e.embed.sub) embed.sub = e.embed.sub;
    if (dub && e.embed.dub) embed.dub = e.embed.dub;
    if (!embed.sub && !embed.dub) {  // requested language missing → keep what exists
      if (e.embed.sub) embed.sub = e.embed.sub;
      if (e.embed.dub) embed.dub = e.embed.dub;
    }
    if (!embed.sub && !embed.dub) continue;  // no playable embed at all
    upsertEpisode(db, animeId, {
      number: e.number, title: e.title,
      sub: !!embed.sub, dub: !!embed.dub,
      embedUrl: JSON.stringify(embed), source: "anikoto",
    });
    stored++;
  }
  return { animeId, episodeCount: stored };
}

/**
 * Store a single MAL/AniList episode, merged into the matching anime. The id
 * (MAL or AniList) stays the anime's identity; `meta` (from the catalog by the
 * embed's media id) supplies a real title/poster only. The embed URL is stored
 * as JSON keyed by language.
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
  const embed = dub ? { dub: embedUrl } : { sub: embedUrl };
  upsertEpisode(db, animeId, {
    number: Number(episode), sub: !dub, dub: !!dub,
    embedUrl: JSON.stringify(embed), source,
  });
  return { animeId };
}
