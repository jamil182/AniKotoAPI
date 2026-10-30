export interface ScheduleRow {
  slug: string | null;
  title: string;
  japaneseTitle: string;
  time: string;
  episode_no: number | null;
}
export interface ScheduleDay { date: string; label: string; weekday: string; fullLabel: string }
export interface WeeklyScheduleRow extends ScheduleRow {
  poster: string | null;
  synopsis: string;
  genres: string[];
  language: 'sub' | 'dub' | null;
  airingAt: number | null;
}
