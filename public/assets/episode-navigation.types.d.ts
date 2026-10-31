export interface EpisodeSummary { episode_no: number | string; title?: string }
export interface EpisodeRange { start: number; end: number; label: string }
export interface EpisodeNavigation {
  update(episodes: EpisodeSummary[], currentEpisode: number | string): void;
  destroy(): void;
}
