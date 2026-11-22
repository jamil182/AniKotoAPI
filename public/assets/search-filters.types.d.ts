export interface SearchFilters {
  kind: 'anime' | 'studios' | 'staff' | 'characters';
  page: string;
  sort: 'POPULARITY_DESC' | 'SCORE_DESC' | 'TRENDING_DESC' | 'START_DATE_DESC' | 'FAVOURITES_DESC';
  q?: string;
  genre?: string;
  format?: string;
  status?: string;
  year?: string;
  studio?: string;
}
