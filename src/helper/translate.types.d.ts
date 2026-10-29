export interface TranslationResult { vtt: string; provider: string; translated: number; failed: number }
export interface TranslationRequests {
  mymemory(text: string, target: string, source: string, signal?: AbortSignal): Promise<string>;
  deepl(texts: string[], target: string, source: string, signal?: AbortSignal): Promise<string[]>;
  libretranslate(texts: string[], target: string, source: string, signal?: AbortSignal): Promise<string[]>;
}
export interface TranslationOptions {
  source?: string;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
  request?: TranslationRequests;
}
