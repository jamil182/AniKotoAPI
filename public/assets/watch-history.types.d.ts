export interface WatchHistoryEntry {
  slug: string;
  episode: number;
  title: string;
  poster: string;
  thumbnail: string;
  time: number;
  duration: number;
  updated: number;
  total: number | null;
  type: string;
}
