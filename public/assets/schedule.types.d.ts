export interface ScheduleRow {
  slug: string | null;
  title: string;
  japaneseTitle: string;
  time: string;
  episode_no: number | null;
}
export interface ScheduleDay { date: string; label: string; weekday: string; fullLabel: string }
