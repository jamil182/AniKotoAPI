export interface SubtitleTrack {
  label?: string; language?: string; url?: string; file?: string;
  default?: boolean; translated?: boolean; sourceLanguage?: string;
}
export interface SubtitleCue { start: number; end: number; text: string }
export interface SubtitleProgress { completed: number; total: number }
