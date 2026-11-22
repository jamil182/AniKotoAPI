import type { CatalogAnime, CatalogEmbedSource, CatalogHome, CatalogEpisode } from './anikotoApi.types.js';

export interface MiruroAnime extends CatalogAnime {
  anilist_id: number;
  mal_id: number | null;
  backgroundImage?: string;
  synopsis: string;
  total: number | null;
  nextEpisodeTimestamp: number | null;
  related: Array<MiruroAnime & {relation: string}>;
  recommended: MiruroAnime[];
  characters: Array<Record<string, unknown>>;
}
export interface MiruroEpisodes {
  episodes: Array<CatalogEpisode & {servers?: Array<{name: string; type: 'sub' | 'dub'; link_id: string}>}>;
  provider: 'miruro' | 'anikoto-fallback';
  legacySlug?: string;
  notice?: string;
}
export interface MiruroCatalog {
  provider: 'miruro';
  get(endpoint: string, params?: Record<string, string>): Promise<unknown>;
  home(): Promise<CatalogHome & {provider: 'miruro'; upcoming: MiruroAnime[]}>;
  embeds(slug: string, episode: string): Promise<{sources: CatalogEmbedSource[]}>;
  resolve(token: string, slug: string): Promise<Record<string, unknown>>;
  canonicalSlug(slug: string): Promise<string>;
  discover(filters: import('../../public/assets/search-filters.types.js').SearchFilters): Promise<{data: unknown[];page:number;totalPages:number;kind:string}>;
}
