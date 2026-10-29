import { AniKotoError } from './anikotoApi.js';
import { malEmbedSources, parseEmbedUrl } from '../../public/assets/embed-policy.js';

/**
 * IDs come from the requested episode's catalog record, never a caller's MAL ID.
 * @param {{get: (endpoint: string, params?: Record<string, string>) => Promise<unknown>}} client
 * @param {string} slug
 * @param {string} episode
 * @returns {Promise<{sources: import('./anikotoApi.types.js').CatalogEmbedSource[]}>}
 */
export async function getEpisodeEmbeds(client, slug, episode) {
  const data = await client.get(`/episodes/${slug}`);
  if (!Array.isArray(data?.episodes)) throw new AniKotoError('Invalid episode response from AniKotoAPI');
  const row = data.episodes.find(item => Number(item?.episode_no) === Number(episode));
  if (!row) throw new AniKotoError('Episode not available from AniKotoAPI', 404);
  let stored = {};
  try { stored = JSON.parse(row.embed_url || '{}'); } catch { /* Legacy rows may not have stored embeds. */ }
  const saved = ['sub', 'dub'].filter(language => parseEmbedUrl(stored?.[language])).map(language => ({
    id: `stored-${language}`, name: 'MegaPlay', language, url: stored[language],
  }));
  const fallback = saved.length ? saved : malEmbedSources(row.mal_id, row.episode_no);
  if (typeof row.server_ids === 'string' && row.server_ids) {
    try {
      const servers = await client.get('/servers', { ids: row.server_ids, slug });
      if (!Array.isArray(servers)) throw new AniKotoError('Invalid server response from AniKotoAPI');
      const seen = new Set();
      const sources = servers.filter(server => {
        if (typeof server?.link_id !== 'string' || !server.link_id.trim() || !['sub', 'dub'].includes(server.type)) return false;
        // HD-1 and HD-2 can share a provider ID but carry different link tokens.
        const key = `${server.type}:${server.link_id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).map(server => ({
        id: `${server.type}:${server.link_id}`, linkId: server.link_id,
        name: typeof server.name === 'string' && server.name.trim() ? server.name.trim() : 'Video server',
        language: server.type,
      }));
      if (sources.length) return { sources };
    } catch (error) {
      if (!fallback.length) throw error;
    }
  }
  if (fallback.length) return { sources: fallback };
  throw new AniKotoError('No embed source available for this episode', 404);
}
