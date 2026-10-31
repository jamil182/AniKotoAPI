export interface WatchSuggestion { slug: string; title: string; poster: string; type: string; relation: string }
export interface WatchSuggestionGroups { related: WatchSuggestion[]; recommended: WatchSuggestion[] }
export interface WatchSuggestions { update(data: unknown): void; error(): void }
