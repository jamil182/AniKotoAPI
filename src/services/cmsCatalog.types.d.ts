export type PublicationState = 'draft' | 'published';
export interface CmsAnime {
  id: number;
  public_slug: string;
  source_slug: string | null;
  title: string;
  synopsis: string | null;
  poster: string | null;
  genres: string[];
  publication_state: PublicationState;
  episode_count: number;
  allow_sub: 0 | 1;
  allow_dub: 0 | 1;
  auto_update: 0 | 1;
  last_synced_at: string | null;
}
export interface CmsSyncStatus {
  running: boolean;
  total: number;
  checked: number;
  added: number;
  failures: Array<{ animeId: number; title: string; message: string }>;
}
