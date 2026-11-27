import axios from 'axios';
import { AniKotoError } from './anikotoApi.js';
import { resolveCatalogStream } from './catalogStream.js';
import { getEpisodeEmbeds } from './episodeEmbeds.js';
import { createMiruroReleases } from './miruroReleases.js';
import { assertProxyableUrl, rememberResolvedHost } from '../helper/streamProxy.helper.js';

/** @typedef {Record<string, unknown>} Data */
/** @param {unknown} value @returns {Data} */
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? /** @type {Data} */(value) : {};
/** @param {unknown} value */
const list = value => Array.isArray(value) ? value : [];
/** @param {unknown} value */
const plain = value => typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';
/** @param {unknown} value */
function image(value) { try { const url = new URL(String(value)); return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined; } catch { return undefined; } }
/** @param {string} value */
export const miruroId = value => /^al-[1-9]\d{0,8}$/.test(value) ? Number(value.slice(3)) : null;
/** @param {unknown} raw */
export function normalizeMiruroAnime(raw) {
  const row = record(raw), id = Number(row.id), title = record(row.title), cover = record(row.coverImage);
  if (!Number.isSafeInteger(id) || id < 1 || id > 999999999 || !plain(title.english || title.romaji)) return null;
  const next = record(row.nextAiringEpisode), date = record(row.startDate);
  const score = Number(row.averageScore || row.meanScore);
  const malId = Number(row.idMal), total = Number(row.episodes);
  return { id: `al-${id}`, slug: `al-${id}`, anilist_id: id, mal_id: Number.isSafeInteger(malId) && malId > 0 ? malId : null,
    title: plain(title.english || title.romaji), japaneseTitle: plain(title.native), japanese_title: plain(title.native),
    alternativeTitles: [...new Set([list(row.synonyms)[0], title.romaji, title.native, ...list(row.synonyms)]
      .map(plain).filter(value => value && value.length <= 120 && !/[\x00-\x1f]/.test(value)))].slice(0, 16),
    poster: image(cover.extraLarge) || image(cover.large),
    backgroundImage: image(row.bannerImage) || image(cover.extraLarge) || image(cover.large),
    synopsis: plain(row.description), genres: list(row.genres).filter(g => typeof g === 'string'),
    type: String(row.format || 'Anime').replaceAll('_', ' '), year: row.seasonYear || date.year || '',
    status: ({ RELEASING: 'Currently Airing', FINISHED: 'Finished Airing', NOT_YET_RELEASED: 'Not Yet Aired' })[String(row.status)] || plain(row.status),
    rating: score > 0 && score <= 100 ? String(score / 10) : '', duration: Number(row.duration) > 0 ? `${Number(row.duration)} min` : '', total: Number.isSafeInteger(total) && total > 0 && total <= 100000 ? total : null,
    aired: date.year ? [date.year, date.month, date.day].filter(Boolean).join('-') : '',
    premiered: [row.season, row.seasonYear].filter(Boolean).join(' '),
    studios: list(record(row.studios).nodes).map(studio => plain(record(studio).name)).filter(Boolean),
    nextEpisodeTimestamp: Number(next.airingAt) || null,
    related: list(Array.isArray(row.relations) ? row.relations : record(row.relations).edges).flatMap(edge => {
      const node = record(record(edge).node);
      if (node.type && node.type !== 'ANIME') return [];
      const related = normalizeMiruroAnime(node); return related ? [{ ...related, relation: String(record(edge).relationType || '').replaceAll('_', ' ') }] : [];
    }),
    recommended: list(Array.isArray(row.recommendations) ? row.recommendations : record(row.recommendations).nodes).map(node => normalizeMiruroAnime(record(node).mediaRecommendation)).filter(Boolean),
    characters: list(Array.isArray(row.characters) ? row.characters : record(row.characters).edges).slice(0, 12),
  };
}

/** Miruro uses AniList IDs. Existing AniKoto slugs continue through their original client.
 * @param {{legacy: ReturnType<import('./anikotoApi.js').createAniKotoClient>, getDatabase?: () => import('better-sqlite3').Database, request?: typeof axios.get, releases?: ReturnType<typeof createMiruroReleases>, port?: number, now?: () => number}} options */
export function createMiruroCatalog({ legacy, getDatabase, request = axios.get, port = Number(process.env.MIRURO_PORT || 4466), now = Date.now, releases = createMiruroReleases({ getDatabase, now }) }) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || [4444, 4455].includes(port)) throw new Error('Invalid Miruro port');
  const cache = new Map(), pending = new Map(), matches = new Map(), issued = new Map();
  let aliases, persistent, streamingRetryAt = 0, metadataRetryAt = 0;
  function metadataStore() {
    if (!getDatabase) return null;
    if (!persistent) {
      const db = getDatabase();
      db.exec('CREATE TABLE IF NOT EXISTS provider_metadata_cache (key TEXT PRIMARY KEY, payload TEXT NOT NULL, expires INTEGER NOT NULL, stale_until INTEGER NOT NULL, updated INTEGER NOT NULL)');
      persistent = {
        read: db.prepare('SELECT payload,expires,stale_until FROM provider_metadata_cache WHERE key=?'),
        write: db.prepare('INSERT OR REPLACE INTO provider_metadata_cache (key,payload,expires,stale_until,updated) VALUES (?,?,?,?,?)'),
        prune: db.prepare('DELETE FROM provider_metadata_cache WHERE key NOT IN (SELECT key FROM provider_metadata_cache ORDER BY updated DESC LIMIT 64)'),
      };
    }
    return persistent;
  }
  function identityStore() {
    if (!getDatabase) return null;
    if (!aliases) {
      const db = getDatabase();
      db.exec('CREATE TABLE IF NOT EXISTS catalog_aliases (alias TEXT PRIMARY KEY, canonical TEXT NOT NULL)');
      aliases = { read: db.prepare('SELECT canonical FROM catalog_aliases WHERE alias=?'), write: db.prepare('INSERT OR IGNORE INTO catalog_aliases (alias,canonical) VALUES (?,?)') };
    }
    return aliases;
  }
  async function raw(endpoint, params = {}) {
    if (!/^\/(?:discovery|spotlight|trending|popular|recent|upcoming|random|filter|search|info\/\d+|episodes\/\d+|watch\/[a-z0-9_-]+\/\d+\/(?:sub|dub)\/[a-z0-9_-]+)$/i.test(endpoint)) throw new AniKotoError('Invalid Miruro endpoint', 400);
    const query = new URLSearchParams(params); query.sort(); const key = endpoint + '?' + query;
    const metadata = !endpoint.startsWith('/episodes/') && !endpoint.startsWith('/watch/');
    const cacheable = endpoint !== '/random';
    let hit = cacheable ? cache.get(key) : null;
    if (!hit && metadata && cacheable) {
      const saved = metadataStore()?.read.get(key);
      if (saved && saved.stale_until > now()) {
        try { hit = { value: JSON.parse(saved.payload), expires: saved.expires, staleUntil: saved.stale_until }; cache.set(key,hit); } catch { /* Corrupt cache entries are replaced by a fresh provider response. */ }
      }
    }
    if (hit?.expires > now()) return hit.value;
    if (pending.has(key)) return pending.get(key);
    if (metadata && metadataRetryAt > now()) {
      if (hit?.staleUntil > now()) return hit.value;
      throw new AniKotoError('Miruro metadata is busy. Please retry shortly.', 503, '60');
    }
    if (endpoint.startsWith('/episodes/') && streamingRetryAt > now()) throw new AniKotoError('Miruro source is temporarily unavailable', 503);
    if (pending.size >= 8) throw new AniKotoError('Miruro is busy. Please retry shortly.', 503);
    const operation = (async () => {
      try {
        const { data } = await request(`http://127.0.0.1:${port}/api${key}`, { timeout: 18000, maxRedirects: 0, maxContentLength: 6 * 1024 * 1024, proxy: false });
        if (data?.success !== true || data.results == null) throw new AniKotoError('Miruro returned an invalid response');
        const entry = { value: data.results, expires: now() + (endpoint.startsWith('/info/') ? 900000 : 120000), staleUntil: now() + 7 * 86400000 };
        if (cacheable) {
          if (cache.size >= 240) cache.delete(cache.keys().next().value);
          cache.set(key, entry);
        }
        if (metadata && cacheable) {
          const payload = JSON.stringify(data.results), store = metadataStore();
          if (store && Buffer.byteLength(payload) <= 1024 * 1024) { store.write.run(key,payload,entry.expires,entry.staleUntil,now()); store.prune.run(); }
        }
        return data.results;
      } catch (error) {
        if (endpoint.startsWith('/episodes/')) streamingRetryAt = now() + 60000;
        if (metadata && (error?.response?.status === 429 || /\b429\b/.test(error?.response?.data?.message || ''))) metadataRetryAt = now() + 60000;
        if (hit?.staleUntil > now() && !endpoint.startsWith('/watch/')) return hit.value;
        throw new AniKotoError(error?.response?.status === 404 ? 'Anime not found' : 'Miruro is temporarily unavailable', error?.response?.status === 404 ? 404 : 503);
      } finally { pending.delete(key); }
    })(); pending.set(key, operation); return operation;
  }
  async function info(id) {
    try {
      const anime = normalizeMiruroAnime(await raw('/info/' + id));
      if (!anime) throw new AniKotoError('Anime not found', 404);
      return anime;
    } catch (error) {
      const saved = identityStore()?.read.get(`al-${id}`);
      if (!saved || error.status === 404) throw error;
      const anime = await legacy.get('/info',{id:saved.canonical});
      return { ...anime, id:`al-${id}`, slug:`al-${id}`, related:anime.related || [], recommended:anime.recommended || [] };
    }
  }
  // A title search alone is never an identity match: confirm the episode's MAL ID.
  async function legacyMatch(id) {
    const identities = identityStore(), saved = identities?.read.get(`al-${id}`);
    if (saved) return saved.canonical;
    const previous = matches.get(id);
    if (previous?.expires > now()) return previous.slug;
    const anime = await info(id);
    if (!anime.mal_id) return null;
    let found = null;
    const keywords = [...new Set([anime.title, ...list(anime.alternativeTitles)].map(plain)
      .filter(value => value && value.length <= 120 && !/[\x00-\x1f]/.test(value)))].slice(0, 4);
    /** @param {unknown} value */
    const comparable = value => plain(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const names = new Set(keywords.map(comparable)), checked = new Set(), deferred = new Map();
    // Try exact title/alias candidates first, then a bounded fallback pool. Every match still requires a MAL ID.
    /** @param {unknown} candidate @returns {Promise<string|null>} */
    async function verify(candidate) {
      const slug = String(record(candidate).slug || '').split('/')[0];
      if (!/^[a-z0-9][a-z0-9_-]{0,239}$/i.test(slug) || checked.has(slug) || checked.size >= 4) return null;
      checked.add(slug);
      try {
        const episodes = await legacy.get('/episodes/' + slug);
        return list(episodes?.episodes).some(row => Number(row.mal_id) === Number(anime.mal_id)) ? slug : null;
      } catch { return null; }
    }
    for (const keyword of keywords) {
      let results;
      try { results = await legacy.get('/search', { keyword }); }
      catch { continue; }
      const rows = list(results?.data).slice(0, 30);
      for (const candidate of rows) {
        const row = record(candidate);
        if (names.has(comparable(row.title || row.name)) || names.has(comparable(row.japaneseTitle))) {
          found = await verify(row);
          if (found) break;
        } else if (deferred.size < 40) deferred.set(String(row.slug || ''), row);
      }
      if (found || checked.size >= 4) break;
    }
    if (!found) {
      for (const candidate of deferred.values()) {
        found = await verify(candidate);
        if (found || checked.size >= 4) break;
      }
    }
    if (matches.size >= 300) matches.delete(matches.keys().next().value);
    matches.set(id, { slug: found, expires: now() + (found ? 86400000 : 60000) });
    if (found) identities?.write.run(`al-${id}`, found);
    return found;
  }
  async function episodeData(id) {
    try {
      const data = await raw('/episodes/' + id), rows = new Map();
      for (const [provider, value] of Object.entries(record(data.providers))) {
        if (!/^[a-z0-9_-]{1,32}$/i.test(provider)) continue;
        for (const language of ['sub', 'dub']) {
          for (const ep of list(record(record(value).episodes)[language])) {
            const number = Number(ep.number), path = String(ep.id || '');
            if (!Number.isFinite(number) || number <= 0 || number > 100000 || !new RegExp(`^watch/${provider}/${id}/${language}/[a-z0-9_-]+$`, 'i').test(path)) continue;
            if (!rows.has(number)) rows.set(number, { episode_no: number, title: plain(ep.title), server_ids: `mr-${id}-${number}`, servers: [] });
            rows.get(number).servers.push({ name: provider, type: language, link_id: path });
          }
        }
      }
      if (rows.size) return { episodes: [...rows.values()].sort((a, b) => a.episode_no - b.episode_no), provider: 'miruro' };
    } catch { /* Use a catalog-verified AniKoto mapping when Miruro's source is unavailable. */ }
    const slug = await legacyMatch(id);
    if (!slug) return { episodes: [], provider: 'miruro', notice: 'Episode sources are temporarily unavailable.' };
    return { ...await legacy.get('/episodes/' + slug), legacySlug: slug, provider: 'anikoto-fallback' };
  }
  async function verifiedServers(id, token) {
    const data = await episodeData(id), ep = data.episodes.find(row => row.server_ids === token);
    if (!ep) throw new AniKotoError('Episode server not found', 404);
    const servers = data.legacySlug ? await legacy.get('/servers', { ids: token, slug: data.legacySlug }) : ep.servers;
    for (const server of list(servers)) {
      if (issued.size >= 3000) issued.delete(issued.keys().next().value);
      issued.set(`${id}:${server.link_id}`, { slug: data.legacySlug, expires: now() + 600000 });
    }
    return servers;
  }
  async function get(endpoint, params = {}) {
    const identifier = endpoint.startsWith('/episodes/') ? endpoint.slice(10) : String(endpoint === '/info' ? params.id || '' : params.slug || '');
    const id = miruroId(identifier);
    if (endpoint === '/info' && id) return info(id);
    if (endpoint.startsWith('/episodes/') && id) { const data = await episodeData(id); return { ...data, slug: identifier, totalEpisodes: data.episodes.length }; }
    if (endpoint === '/watch' && id) { const anime = await info(id); return { nextEpisodeTimestamp: anime.nextEpisodeTimestamp, related: anime.related, recommended: anime.recommended }; }
    if (endpoint === '/servers' && id) return verifiedServers(id, params.ids);
    if (endpoint === '/stream' && id) {
      const source = issued.get(`${id}:${params.id}`);
      if (source?.slug && source.expires > now()) return legacy.get('/stream', { id: params.id, slug: source.slug });
      throw new AniKotoError('Video server not found', 404);
    }
    if (id || endpoint.startsWith('/episodes/') || ['/info','/watch','/servers','/stream'].includes(endpoint)) return legacy.get(endpoint, params);
    if (endpoint === '/search') return page(await raw('/search', { query: params.keyword, per_page: '24' }));
    if (endpoint === '/random') return normalizeMiruroAnime(await raw('/random'));
    if (endpoint === '/latest-updated') return releases.page(params);
    if (endpoint === '/newly-added') return legacy.get(endpoint, params);
    const collections = { '/trending': '/trending', '/most-popular': '/popular', '/status/upcoming': '/upcoming', '/status/ongoing': '/recent' };
    if (collections[endpoint]) {
      try { return page(await raw(collections[endpoint], { page: String(params.page || 1), per_page: '24' })); }
      catch (error) { if (error.status !== 503) throw error; return legacy.get(endpoint,params); }
    }
    const filter = { page: String(params.page || 1), per_page: '24', sort: 'POPULARITY_DESC' };
    if (endpoint === '/status/completed') filter.status = 'FINISHED';
    else if (endpoint.startsWith('/type/')) filter.format = endpoint.slice(6).toUpperCase();
    else if (endpoint.startsWith('/genre/')) filter.genre = endpoint.slice(7).replaceAll('-', ' ').replace(/\b\w/g, char => char.toUpperCase());
    else if (endpoint.startsWith('/az-list/')) return legacy.get(endpoint, params);
    else return legacy.get(endpoint, params);
    return page(await raw('/filter', filter));
  }
  function page(data) { return { data: list(data.results).map(normalizeMiruroAnime).filter(Boolean), totalPages: Math.max(1, Math.min(9999, Math.ceil(Number(data.total || 1) / Number(data.perPage || 24)))) }; }
  async function home() {
    const [featured, trending, upcoming, native, popular, latest] = await Promise.allSettled([
      raw('/spotlight'), raw('/filter', { status: 'RELEASING', sort: 'POPULARITY_DESC', per_page: '10' }), raw('/upcoming', { per_page: '8' }), legacy.home(), raw('/popular', { per_page: '12' }),
      releases.page(),
    ]);
    const nativeHome = native.status === 'fulfilled' ? native.value : null;
    const convert = result => result.status === 'fulfilled' ? list(result.value.results || result.value).map(normalizeMiruroAnime).filter(Boolean) : [];
    const spotlights = convert(featured), top = convert(trending);
    if (!spotlights.length && !top.length && !nativeHome) throw new AniKotoError('Catalog is temporarily unavailable', 503);
    return { ...nativeHome, provider: 'miruro', spotlights: spotlights.length ? spotlights : nativeHome?.spotlights || [],
      latest: latest.status === 'fulfilled' ? latest.value.data : [], top: top.length ? top : nativeHome?.top || [],
      rankings: { today: top, week: top, month: top }, popular: convert(popular), upcoming: convert(upcoming),
      genres: [...new Set([...spotlights, ...top].flatMap(anime => anime.genres))].sort(), fetchedAt: new Date(now()).toISOString() };
  }
  async function embeds(slug, episode) {
    const id = miruroId(slug);
    if (!id) return getEpisodeEmbeds(legacy, slug, episode);
    const data = await episodeData(id);
    if (!data.episodes.some(row => Number(row.episode_no) === Number(episode))) throw new AniKotoError('Episode not available', 404);
    if (data.legacySlug) {
      const sources = await getEpisodeEmbeds(legacy, data.legacySlug, episode);
      for (const source of sources.sources) {
        if (source.linkId) issued.set(`${id}:${source.linkId}`, { slug: data.legacySlug, expires: now() + 600000 });
      }
      return sources;
    }
    return { sources: ['sub','dub'].flatMap(language => {
      const ep = data.episodes.find(row => Number(row.episode_no) === Number(episode));
      if (!ep.servers.some(server => server.type === language)) return [];
      return [{ id: `anixo-${language}`, name: 'AniXo', language, url: `https://anixo.buzz/embed/ani/${id}/${episode}/${language}?autoplay=true` },
        { id: `megavid-${language}`, name: 'Megavid', language, url: `https://megavid.buzz/ani/${id}/${episode}/${language}?autoplay=true` }];
    }) };
  }
  async function resolve(token, slug) {
    const id = miruroId(slug);
    if (!id) return resolveCatalogStream(legacy, token, slug);
    if (!/^watch\/[a-z0-9_-]+\/\d+\/(?:sub|dub)\/[a-z0-9_-]+$/i.test(token)) return resolveCatalogStream({ get: async () => get('/stream', { id: token, slug }) }, token, slug);
    const data = await episodeData(id);
    if (!data.episodes.some(ep => ep.servers?.some(server => server.link_id === token))) throw new AniKotoError('Video server not found', 404);
    const sources = await raw('/' + token), streams = list(sources.streams);
    const stream = streams.find(row => row.type === 'hls') || streams[0];
    const validate = value => {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password) throw new AniKotoError('Invalid media URL');
      rememberResolvedHost(url.hostname);
      if (!assertProxyableUrl(url.href).ok) throw new AniKotoError('Invalid media destination');
      return url.href;
    };
    if (!stream?.url) throw new AniKotoError('No playable stream returned', 503);
    const subtitles = list(sources.subtitles).flatMap(track => {
      try {
        let value = track.url || track.file;
        if (value?.startsWith('/api/proxy?')) value = new URL(value, 'https://unused.invalid').searchParams.get('url');
        return [{ ...track, url: validate(value) }];
      } catch { return []; }
    });
    return { url: validate(stream.url), type: stream.type || 'hls', subtitles, skipData: sources.skipTimes || null, linkId: token };
  }
  async function canonicalSlug(slug) { const id = miruroId(slug); return id ? await legacyMatch(id) || slug : slug; }
  async function discover(filters) {
    const result = await raw('/discovery',filters), kind = filters.kind || 'anime';
    const rows = list(result.results);
    const data = kind === 'anime' ? rows.map(normalizeMiruroAnime).filter(Boolean) : rows.flatMap(row => {
      const id = Number(row.id); if (!Number.isSafeInteger(id) || id<=0) return [];
      const title = kind === 'studios' ? plain(row.name) : plain(record(row.name).full);
      if (!title) return [];
      const poster = kind === 'studios' ? image(record(record(list(record(row.media).nodes)[0]).coverImage).large) : image(record(row.image).large);
      return [{id:String(id),title,poster,kind,href:kind === 'studios' ? '/search?' + new URLSearchParams({kind:'anime',studio:title}) : `https://anilist.co/${kind === 'staff' ? 'staff' : 'character'}/${id}/`,external:kind !== 'studios'}];
    });
    const current = Number(result.page || filters.page || 1), totalPages = result.hasNextPage === false ? current : Math.max(current,Math.ceil(Number(result.total || current*28)/28));
    return {data,page:current,totalPages:Math.min(999,totalPages),kind};
  }
  return { get, home, embeds, resolve, canonicalSlug, discover, provider: 'miruro' };
}
