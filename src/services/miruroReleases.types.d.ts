export interface EpisodeRelease {
  id: string;
  slug: string;
  anilist_id: number;
  mal_id: number | null;
  title: string;
  japaneseTitle: string;
  poster?: string;
  type: string;
  year: number | null;
  total: number | null;
  sub: number | null;
  dub: number | null;
  latestEpisode: number;
  releasedAt: string;
  releaseLanguage: 'sub' | 'dub';
}
export interface ReleaseFeed { sub: EpisodeRelease[]; dub: EpisodeRelease[]; }
