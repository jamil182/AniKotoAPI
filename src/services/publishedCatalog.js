import { catalogAnime, publicRows, publishedAnime, randomPublished, storedEpisodes } from '../db/cms.repo.js';
import { scheduleService } from './schedule.js';

export function createPublishedCatalog(getDatabase, client, { schedule = scheduleService } = {}) {
  const requireAnime = slug => publishedAnime(getDatabase(), slug);
  const list = () => publicRows(getDatabase()).map(row => catalogAnime(getDatabase(), row));
  const streamClient = { get: (path, params = {}) => {
    const anime = params.slug ? requireAnime(params.slug) : null;
    return client.get(path, anime ? { ...params, slug: anime.source_slug || anime.slug } : params);
  } };
  const episodeClient = { get: (path, params) => path.startsWith('/episodes/')
    ? Promise.resolve(storedEpisodes(getDatabase(), requireAnime(path.slice('/episodes/'.length))))
    : streamClient.get(path, params) };
  return {
    require: requireAnime, episodeClient, streamClient,
    home() {
      const latest = list();
      const top = [...latest].sort((a, b) => (Number.parseFloat(b.rating) || 0) - (Number.parseFloat(a.rating) || 0)).slice(0, 12);
      return {
        curated: true, latest, top, popular: top, spotlights: latest.slice(0, 6),
        rankings: { today: top, week: top, month: top },
        genres: [...new Set(latest.flatMap(anime => anime.genres || []))].sort(),
        fetchedAt: new Date().toISOString(),
      };
    },
    search(keyword) { return { data: list().filter(anime => anime.title.toLowerCase().includes(keyword.toLowerCase())), totalPages: 1 }; },
    anime(slug) { return catalogAnime(getDatabase(), requireAnime(slug)); },
    async description(slug) {
      const row = requireAnime(slug);
      const stored = catalogAnime(getDatabase(), row);
      const sourceSlug = row.source_slug || (row.anikoto_id ? row.slug : null);
      if (!sourceSlug) return stored;
      try {
        const source = await client.get('/info', { id: sourceSlug });
        const metadata = {};
        for (const key of ['altNames', 'premiered', 'aired', 'malScore', 'reviewCount']) {
          if (typeof source?.[key] === 'string' || typeof source?.[key] === 'number') metadata[key] = source[key];
        }
        if (Array.isArray(source?.producers)) metadata.producers = source.producers.filter(value => typeof value === 'string');
        return { ...stored, ...metadata };
      } catch {
        return stored;
      }
    },
    episodes(slug) { return storedEpisodes(getDatabase(), requireAnime(slug)); },
    random() { return randomPublished(getDatabase()); },
    browse({ genre, letter, page, source, type }) {
      let rows = list();
      if (genre) rows = rows.filter(anime => anime.genres.some(value => value.toLowerCase().replace(/[^a-z0-9]+/g, '-') === genre));
      if (letter) rows = rows.filter(anime => letter === '0' ? !/^[a-z]/i.test(anime.title) : anime.title.toLowerCase().startsWith(letter.toLowerCase()));
      if (type) rows = rows.filter(anime => (anime.type || '').toLowerCase() === type);
      const statuses = { ongoing: ['currentlyairing', 'ongoing', 'airing'], completed: ['finishedairing', 'completed', 'finished'], upcoming: ['notyetaired', 'upcoming'] };
      if (statuses[source]) rows = rows.filter(anime => statuses[source].includes((anime.status || '').toLowerCase().replace(/[^a-z]/g, '')));
      if (['trending', 'popular'].includes(source)) rows.sort((a, b) => (Number.parseFloat(b.rating) || 0) - (Number.parseFloat(a.rating) || 0));
      if (source === 'added') rows.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      return { data: rows.slice((Number(page) - 1) * 24, Number(page) * 24), totalPages: Math.max(1, Math.ceil(rows.length / 24)) };
    },
    async schedule(date, timezone = 7) {
      const published = list();
      if (!published.length) return [];
      const rows = await schedule.get(date, timezone);
      return rows.flatMap(row => {
        const exact = row.slug ? published.find(item => [item.slug, item.source_slug].includes(row.slug)) : null;
        const matches = published.filter(item => item.title.toLowerCase() === row.title.toLowerCase());
        const anime = exact || (matches.length === 1 ? matches[0] : null);
        return anime ? [{ ...row, slug: anime.slug }] : [];
      });
    },
  };
}
