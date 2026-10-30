import { AniKotoError, normalizeAnime, normalizeList } from './anikotoApi.js';
import { CATALOG_VIEWS, isCatalogSource, isAnimeType } from '../../public/assets/catalog-sources.js';

/** @param {NodeJS.ProcessEnv} [env] @returns {import('./seo.types.js').SeoConfiguration} */
export function seoConfiguration(env = process.env) {
  const url = new URL(env.SITE_URL || 'https://aniyear.com');
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('SITE_URL must be an HTTPS origin without credentials, path, query or fragment');
  }
  const name = (env.SITE_NAME || 'Aniyear').trim();
  if (!name || name.length > 80 || /[\x00-\x1f\x7f]/.test(name)) throw new Error('Invalid SITE_NAME');
  return { origin: url.origin, name };
}

/** @param {unknown} value */
export function seoSlug(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,239}$/i.test(value)) throw new AniKotoError('Anime not found', 404);
  return value;
}

/** @param {Record<string, unknown>} query */
export function seoBrowse(query) {
  const page = query.page ?? '1', source = query.source ?? 'latest';
  if (typeof page !== 'string' || !/^[1-9]\d{0,3}$/.test(page) || !isCatalogSource(source)) throw new AniKotoError('Invalid catalog page', 400);
  const params = new URLSearchParams();
  if (source !== 'latest') params.set('source', source);
  for (const key of ['genre', 'type', 'letter']) {
    const value = query[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || (key === 'genre' ? !/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(value)
      : key === 'type' ? !isAnimeType(value) : !/^[a-z0]$/i.test(value))) throw new AniKotoError('Invalid catalog filter', 400);
    params.set(key, value.toLowerCase());
  }
  if (params.has('genre')) { params.delete('type'); params.delete('letter'); }
  else if (params.has('type')) params.delete('letter');
  if (page !== '1') params.set('page', page);
  return { params, page: Number(page), source };
}

/** Store only bounded public metadata in the SEO cache, never arbitrary upstream fields.
 * @param {unknown} value @returns {import('./seo.types.js').SeoAnime | null} */
function seoAnime(value) {
  const row = normalizeAnime(value);
  if (!row) return null;
  const text = (field, limit) => typeof field === 'string' ? field.slice(0, limit) : '';
  return { id:row.slug, slug:row.slug, title:text(row.title,400), japanese_title:text(row.japanese_title,400),
    genres:row.genres.slice(0,30).map(genre=>genre.slice(0,80)),
    poster:text(row.poster,4096), synopsis:text(row.synopsis || row.description,20000),
    type:text(row.type,80), status:text(row.status,100), duration:text(row.duration,100),
    rating:text(row.rating,40), total:Number.isFinite(Number(row.total)) ? Number(row.total) : undefined,
    studios:Array.isArray(row.studios) ? row.studios.filter(item=>typeof item==='string').slice(0,30).map(item=>item.slice(0,100)) : [],
  };
}

/** Bounded TTL cache and deduplication prevent crawlers creating unbounded upstream work.
 * @template T */
class SeoCache {
  /** @type {Map<string, {value: T, expires: number}>} */ entries = new Map();
  /** @type {Map<string, Promise<T>>} */ pending = new Map();
  /** @param {() => number} now */
  constructor(now) { this.now = now; }
  /** @param {string} key @param {() => Promise<T>} loader @returns {Promise<T>} */
  get(key, loader) {
    const hit = this.entries.get(key);
    if (hit && hit.expires > this.now()) return Promise.resolve(hit.value);
    if (this.pending.has(key)) return this.pending.get(key);
    if (this.pending.size >= 8) return Promise.reject(new AniKotoError('Catalog is busy', 503));
    const operation = Promise.resolve().then(loader).then(value => {
      for (const [id, entry] of this.entries) if (entry.expires <= this.now()) this.entries.delete(id);
      this.entries.delete(key);
      if (this.entries.size >= 160) this.entries.delete(this.entries.keys().next().value);
      this.entries.set(key, { value, expires: this.now() + 300000 });
      return value;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, operation);
    return operation;
  }
}

/** @param {ReturnType<import('./anikotoApi.js').createAniKotoClient>} client
 * @param {ReturnType<import('./publishedCatalog.js').createPublishedCatalog> | null} [catalog]
 * @param {{now?: () => number}} [options] */
export function createSeoCatalog(client, catalog = null, { now = Date.now } = {}) {
  /** @type {SeoCache<import('./seo.types.js').SeoPage>} */ const pages = new SeoCache(now);
  /** @type {SeoCache<import('./seo.types.js').SeoDetail>} */ const details = new SeoCache(now);
  return {
    /** @param {URLSearchParams} [params] */
    page(params = new URLSearchParams()) {
      const checked = seoBrowse(Object.fromEntries(params));
      return pages.get(checked.params.toString(), async () => {
        const fields = Object.fromEntries(checked.params), page = String(checked.page);
        let raw;
        if (catalog) raw = await catalog.browse({ ...fields, page, source: checked.source });
        else {
          const endpoint = fields.genre ? '/genre/' + fields.genre : fields.type ? '/type/' + fields.type
            : fields.letter ? '/az-list/' + fields.letter : CATALOG_VIEWS[checked.source].endpoint;
          raw = await client.get(endpoint, { page });
        }
        if (!raw || (!Array.isArray(raw) && !Array.isArray(raw.data))) throw new AniKotoError('Invalid catalog response', 503);
        const totalPages = Number(raw.totalPages ?? raw.pagination?.totalPages ?? 1);
        if (!Number.isSafeInteger(totalPages) || totalPages < 1 || totalPages > 9999) throw new AniKotoError('Invalid catalog pagination', 503);
        if (checked.page > totalPages) throw new AniKotoError('Catalog page not found', 404);
        return { data: normalizeList(raw).slice(0, 500).map(seoAnime).filter(Boolean), totalPages };
      });
    },
    /** @param {string} value */
    detail(value) {
      const slug = seoSlug(value);
      if (catalog) catalog.require(slug);
      return details.get(slug, async () => {
        const [raw, episodes] = await Promise.all([
          catalog ? catalog.description(slug) : client.get('/info', { id: slug }),
          Promise.resolve().then(() => catalog ? catalog.episodes(slug) : client.get('/episodes/' + slug)).catch(() => null),
        ]);
        const anime = seoAnime(raw);
        if (!anime || !raw.title) throw new AniKotoError('Anime not found', 404);
        const seen = new Set();
        return { anime, episodes: (Array.isArray(episodes?.episodes) ? episodes.episodes : []).flatMap(row => {
          const number = Number(row?.episode_no);
          if (!Number.isFinite(number) || number <= 0 || number > 100000 || seen.has(number)) return [];
          seen.add(number);
          return [{ episode_no: number, title: typeof row.title === 'string' ? row.title.slice(0,200) : '' }];
        }).slice(0, 2000) };
      });
    },
  };
}
