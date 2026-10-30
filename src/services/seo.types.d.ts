import type { CatalogAnime } from './anikotoApi.types.js';

export interface SeoConfiguration { origin: string; name: string }
export interface SeoAnime extends CatalogAnime {
  synopsis?: string; description?: string; duration?: string; status?: string;
  total?: number; japaneseTitle?: string; studios?: string[];
}
export interface SeoPage { data: SeoAnime[]; totalPages: number }
export interface SeoEpisode { episode_no: number; title?: string }
export interface SeoDetail { anime: SeoAnime; episodes: SeoEpisode[] }
export interface SeoMetadata {
  title: string; description: string; path: string; image?: string;
  schema?: Record<string, unknown>[];
}
