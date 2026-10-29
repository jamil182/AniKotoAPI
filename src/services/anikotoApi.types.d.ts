export interface CatalogAnime {
  id: string;
  slug: string;
  title: string;
  japanese_title: string;
  genres: string[];
  poster?: string;
  sub?: number;
  dub?: number;
  type?: string;
  rating?: string;
}

export interface CatalogEpisode {
  episode_no: number;
  title: string;
  server_ids?: string;
  mal_id?: string;
}

export interface CatalogEmbedSource {
  id: string;
  name: string;
  language: 'sub' | 'dub';
  url?: string;
  linkId?: string;
}

export interface CatalogHome {
  spotlights: CatalogAnime[];
  latest: CatalogAnime[];
  top: CatalogAnime[];
  rankings: Record<'today' | 'week' | 'month', CatalogAnime[]>;
  popular: CatalogAnime[];
  genres: string[];
  fetchedAt: string;
}
