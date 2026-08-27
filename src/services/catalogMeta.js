/*
 * AniKotoAPI — catalogMeta.js
 * Enriches MAL/AniList fetches with real metadata. The megaplay embed page
 * exposes a catalog media id (resolver `mediaId`); the Anikoto catalog at
 * anikotoapi.site serves that series' title, poster, and synopsis — which the
 * bare MAL/AniList embed page does not carry.
 *
 * @exports fetchCatalogMeta
 */

import axios from "axios";
import { headers } from "../configs/header.config.js";

const CATALOG_BASE = "https://anikotoapi.site";

/**
 * Fetch normalized metadata for a catalog media id. Best-effort: returns null
 * on any failure so ingest can fall back to a placeholder.
 * @param {string|number} mediaId
 */
export async function fetchCatalogMeta(mediaId) {
  if (!mediaId) return null;
  try {
    const { data } = await axios.get(`${CATALOG_BASE}/series/${mediaId}`, { headers, timeout: 10000 });
    const a = data?.data?.anime;
    if (!a) return null;
    const type = Array.isArray(a.terms_by_type?.type) ? a.terms_by_type.type[0] : (a.source || null);
    return {
      title: a.title || null,
      poster: a.poster || null,
      synopsis: a.description || null,
      status: a.status || null,
      type,
      malId: a.mal_id ? Number(a.mal_id) : null,
      anilistId: a.ani_id ? Number(a.ani_id) : null,
    };
  } catch {
    return null;
  }
}
