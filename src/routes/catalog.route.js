import { Router } from "express";
import { randomInt } from "node:crypto";
import { AniKotoError, createAniKotoClient, normalizeAnime, normalizeList } from "../services/anikotoApi.js";
import { getEpisodeEmbeds } from "../services/episodeEmbeds.js";
import { resolveCatalogStream } from "../services/catalogStream.js";
import { parseEmbedUrl } from "../../public/assets/embed-policy.js";
import { CATALOG_VIEWS, isCatalogSource, isAnimeType } from '../../public/assets/catalog-sources.js';
import { scheduleQuery, scheduleService } from '../services/schedule.js';

function text(value, label, max = 240) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f]/.test(value)) {
    throw new AniKotoError(`Invalid ${label}`, 400);
  }
  return value.trim();
}

function slug(value) {
  const result = text(value, "anime slug");
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(result)) throw new AniKotoError("Invalid anime slug", 400);
  return result;
}

function episode(value) {
  const result = text(value, "episode", 10);
  if (!/^\d+(?:\.\d+)?$/.test(result) || Number(result) <= 0) throw new AniKotoError("Invalid episode", 400);
  return result;
}

export function createCatalogRouter(client = createAniKotoClient(), catalog = null, { resolve = resolveCatalogStream, schedule = scheduleService } = {}) {
  const router = Router();
  const route = (path, handler) => router.get(path, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      if (catalog && ['/watch', '/embeds', '/embed', '/servers', '/resolve', '/resolve-stored'].includes(path)) catalog.require(slug(req.query.slug));
      res.json({ success: true, results: await handler(req) });
    } catch (error) {
      if (error.retryAfter) res.setHeader("Retry-After", error.retryAfter);
      res.status(error instanceof AniKotoError ? error.status : 502).json({
        success: false, message: error instanceof AniKotoError ? error.message : "AniKotoAPI returned unexpected data",
      });
    }
  });
  route('/status', () => ({ mode: catalog ? 'managed' : 'live', refreshIntervalMs: 30000 }));
  route("/home", () => catalog ? catalog.home() : client.home());
  route("/search", async req => {
    const keyword = text(req.query.keyword, "keyword", 120);
    if (catalog) return catalog.search(keyword);
    const data = await client.get("/search", { keyword });
    if (!data || !Array.isArray(data.data)) throw new AniKotoError("Invalid search response from AniKotoAPI");
    return { ...data, data: normalizeList(data) };
  });
  route("/anime/:slug", async req => {
    if (catalog) return catalog.description ? catalog.description(slug(req.params.slug)) : catalog.anime(slug(req.params.slug));
    const data = await client.get("/info", { id: slug(req.params.slug) });
    const anime = normalizeAnime(data);
    if (!anime || !data.title) throw new AniKotoError("Anime not found", 404);
    return anime;
  });
  route("/episodes/:slug", async req => {
    if (catalog) return catalog.episodes(slug(req.params.slug));
    const data = await client.get(`/episodes/${slug(req.params.slug)}`);
    if (!Array.isArray(data.episodes)) throw new AniKotoError("Invalid episode list from AniKotoAPI");
    const episodes = data.episodes.filter(ep => Number.isFinite(Number(ep.episode_no)) && Number(ep.episode_no) > 0);
    return { ...data, episodes, totalEpisodes: episodes.length };
  });
  route("/browse", async req => {
    const page = req.query.page || "1";
    if (typeof page !== "string" || !/^[1-9]\d{0,3}$/.test(page)) throw new AniKotoError("Invalid page", 400);
    const source = req.query.source || 'latest';
    if (!isCatalogSource(source)) throw new AniKotoError('Invalid catalog source', 400);
    const type = req.query.type;
    if (type !== undefined && !isAnimeType(type)) throw new AniKotoError('Invalid anime type', 400);
    if (catalog) {
      const genre = req.query.genre ? slug(req.query.genre) : null;
      const letter = req.query.letter || null;
      if (letter && (typeof letter !== 'string' || !/^[a-z0]$/i.test(letter))) throw new AniKotoError('Invalid letter', 400);
      return catalog.browse({ page, genre, letter, source, type });
    }
    let endpoint = CATALOG_VIEWS[source].endpoint;
    if (req.query.genre) endpoint = `/genre/${slug(req.query.genre)}`;
    else if (type) endpoint = `/type/${type}`;
    else if (req.query.letter) {
      if (typeof req.query.letter !== "string" || !/^[a-z0]$/i.test(req.query.letter)) throw new AniKotoError("Invalid letter", 400);
      endpoint = `/az-list/${req.query.letter.toLowerCase()}`;
    }
    const data = await client.get(endpoint, { page });
    if (!Array.isArray(data) && !Array.isArray(data?.data)) throw new AniKotoError('Invalid catalog page from AniKotoAPI');
    const totalPages = Number(data.totalPages ?? data.pagination?.totalPages ?? 1);
    if (!Number.isSafeInteger(totalPages) || totalPages < 1 || totalPages > 9999) throw new AniKotoError('Invalid page count from AniKotoAPI');
    return { data: normalizeList(data), totalPages };
  });
  route("/random", async () => {
    if (catalog) return catalog.random();
    const anime = normalizeAnime(await client.get("/random").catch(() => null));
    if (anime) return anime;
    // Some deployments return /random itself as the slug after a redirect.
    const home = await client.home();
    const pool = normalizeList([...home.latest, ...(home.popular || []), ...(home.top || [])]);
    if (!pool.length) throw new AniKotoError("No anime available from AniKotoAPI");
    return pool[randomInt(pool.length)];
  });
  route("/schedule", req => {
    const { date, timezone } = scheduleQuery(req.query);
    return catalog ? catalog.schedule(date, timezone) : schedule.get(date, timezone);
  });
  router.get('/schedule-watch', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    let requestedSlug, requestedEpisode;
    try {
      requestedSlug = slug(req.query.slug);
      requestedEpisode = episode(req.query.ep);
      if (catalog) catalog.require(requestedSlug);
    } catch (error) {
      return res.status(error instanceof AniKotoError ? error.status : 400).json({ success: false, message: 'Anime atau episode tidak valid.' });
    }
    const details = '/anime/' + encodeURIComponent(requestedSlug);
    try {
      const data = await (catalog?.episodeClient || client).get('/episodes/' + requestedSlug);
      const available = Array.isArray(data?.episodes) && data.episodes.some(row => Number(row.episode_no) === Number(requestedEpisode));
      return res.redirect(303, available ? '/watch/' + encodeURIComponent(requestedSlug) + '/' + encodeURIComponent(requestedEpisode) : details);
    } catch { return res.redirect(303, details); }
  });
  route("/watch", req => {
    const ep = text(req.query.ep, "episode", 10);
    if (!/^\d+(?:\.\d+)?$/.test(ep) || Number(ep) <= 0) throw new AniKotoError("Invalid episode", 400);
    const anime = catalog?.require(slug(req.query.slug));
    if (anime && !anime.source_slug && !anime.anikoto_id) return { nextEpisodeTimestamp: null };
    return (catalog?.streamClient || client).get("/watch", { slug: slug(req.query.slug), ep });
  });
  route("/embeds", async req => {
    const requestedSlug = slug(req.query.slug);
    const result = await getEpisodeEmbeds(catalog?.episodeClient || client, requestedSlug, episode(req.query.ep));
    if (!catalog) return result;
    const anime = catalog.require(requestedSlug);
    return { sources: result.sources.filter(source => source.language === 'sub' ? anime.allow_sub : anime.allow_dub) };
  });
  route("/embed", async req => {
    const result = await (catalog?.streamClient || client).get("/stream", {
      id: text(req.query.id, "server id", 4096), slug: slug(req.query.slug),
    });
    const url = parseEmbedUrl(result?.url);
    if (!url) throw new AniKotoError("AniKotoAPI did not return a supported video embed");
    return { url: url.href };
  });
  route("/servers", async req => {
    const requestedSlug = slug(req.query.slug);
    const result = await (catalog?.streamClient || client).get('/servers', { ids: text(req.query.ids, 'server ids', 4096), slug: requestedSlug });
    if (!catalog || !Array.isArray(result)) return result;
    const anime = catalog.require(requestedSlug);
    return result.filter(server => server.type === 'sub' ? anime.allow_sub : server.type === 'dub' && anime.allow_dub);
  });
  route("/resolve", req => resolve(catalog?.streamClient || client, text(req.query.id, "server id", 4096), slug(req.query.slug)));
  route('/resolve-stored', async req => {
    const requestedSlug = slug(req.query.slug);
    const language = req.query.language;
    if (!['sub', 'dub'].includes(language)) throw new AniKotoError('Invalid language', 400);
    const data = await getEpisodeEmbeds(catalog?.episodeClient || client, requestedSlug, episode(req.query.ep));
    const anime = catalog?.require(requestedSlug);
    if (anime && (language === 'sub' ? !anime.allow_sub : !anime.allow_dub)) throw new AniKotoError('Language not available', 404);
    const source = data.sources.find(item => item.language === language && item.url);
    if (!source) throw new AniKotoError('Stored video embed not available', 404);
    return resolve({ get: async () => ({ url: source.url }) }, source.id, requestedSlug);
  });
  return router;
}
