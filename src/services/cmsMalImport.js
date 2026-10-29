import { AniKotoError } from './anikotoApi.js';
import { ingestMalEpisode, malEmbedUrl } from './adminIngest.js';
import { resolveStreamUrl } from '../extractors/streamResolver.extractor.js';
import { fetchCatalogMeta } from './catalogMeta.js';
import { cmsAnime } from '../db/cms.repo.js';

export async function importMalEpisode(db, options, { resolve = resolveStreamUrl, metadata = fetchCatalogMeta } = {}) {
  const languages = [options.sub && 'sub', options.dub && 'dub'].filter(Boolean);
  const sources = await Promise.all(languages.map(async language => {
    const url = malEmbedUrl({ ...options, dub: language === 'dub' });
    const result = await resolve(url);
    if (!result?.url) throw new AniKotoError(`Video ${language.toUpperCase()} belum tersedia dari provider.`, 502);
    return { language, url, result };
  }));
  const mediaId = sources.find(source => source.result.mediaId)?.result.mediaId;
  const meta = mediaId ? await metadata(mediaId).catch(() => null) : null;
  return db.transaction(() => {
    let animeId;
    for (const item of sources) {
      ({ animeId } = ingestMalEpisode(db, { ...options, dub: item.language === 'dub', embedUrl: item.url, meta }));
    }
    db.prepare('UPDATE anime SET total_episodes = (SELECT COUNT(*) FROM episode WHERE anime_id = ?) WHERE id = ?').run(animeId, animeId);
    return { animeId, anime: cmsAnime(db, animeId) };
  })();
}
