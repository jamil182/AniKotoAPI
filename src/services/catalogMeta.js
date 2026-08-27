/*
 * AniKotoAPI — catalogMeta.js
 * Reads the Anikoto catalog (anikotoapi.site) — the metadata + episode source
 * for the CMS. A series' page carries title/poster/synopsis and its episodes,
 * each with a ready-made MegaPlay embed URL (/stream/s-2/{id}/{lang}).
 *
 * @exports fetchCatalogSeries, fetchCatalogMeta
 */

import axios from "axios";
import { headers } from "../configs/header.config.js";

const CATALOG_BASE = "https://anikotoapi.site";

// Pull genre names out of the catalog's terms_by_type, tolerant of shape.
function genresOf(anime) {
  const g = anime.terms_by_type?.genre;
  if (!Array.isArray(g)) return [];
  return g.map((x) => (typeof x === "string" ? x : (x?.name || x?.title))).filter(Boolean);
}

function normalizeAnime(a) {
  const type = Array.isArray(a.terms_by_type?.type) ? a.terms_by_type.type[0] : (a.source || null);
  return {
    title: a.title || null,
    poster: a.poster || null,
    banner: a.background_image || null,
    synopsis: a.description || null,
    status: a.status || null,
    type,
    genres: genresOf(a),
    rating: a.score || a.rating || null,
    malId: a.mal_id ? Number(a.mal_id) : null,
    anilistId: a.ani_id ? Number(a.ani_id) : null,
  };
}

/**
 * Fetch a full catalog series (anime metadata + episodes with embed URLs).
 * @param {string|number} seriesId - Anikoto/catalog series id
 * @returns {Promise<{anime: object, episodes: Array}|null>}
 */
export async function fetchCatalogSeries(seriesId) {
  if (!seriesId) return null;
  try {
    const { data } = await axios.get(`${CATALOG_BASE}/series/${seriesId}`, { headers, timeout: 15000 });
    const a = data?.data?.anime;
    if (!a) return null;
    const rawEps = data?.data?.episodes;
    const list = Array.isArray(rawEps) ? rawEps : (rawEps ? Object.values(rawEps) : []);
    const episodes = list.map((e) => ({
      number: Number(e.number),
      title: e.title && !/^Episode\s/i.test(e.title) ? e.title : null,
      embed: e.embed_url || {},   // { sub?: url, dub?: url }
    }));
    return { anime: normalizeAnime(a), episodes };
  } catch {
    return null;
  }
}

/**
 * Metadata-only helper (used to enrich MAL/AniList fetches by their catalog
 * media id). Best-effort; returns null on failure.
 */
export async function fetchCatalogMeta(mediaId) {
  const s = await fetchCatalogSeries(mediaId);
  return s ? s.anime : null;
}
