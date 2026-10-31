import type { CommentMedia } from "./comments.types.js";
export interface MediaItem {
  media: CommentMedia;
  preview: string;
  url: string;
  width: number;
  height: number;
}
export interface MediaConfig {
  enabled: boolean;
  publicApiKey: string;
  provider: "klipy";
}
export interface MediaPage {
  items: MediaItem[];
  page: number;
  hasNext: boolean;
}
