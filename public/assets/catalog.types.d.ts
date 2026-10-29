export interface CatalogParams {
  source: 'latest' | 'trending' | 'added' | 'popular' | 'upcoming' | 'ongoing' | 'completed';
  page: number;
  genre?: string;
  letter?: string;
  type?: 'tv' | 'movie' | 'ova' | 'ona' | 'special';
}
export interface CatalogGridOptions {
  grid: HTMLElement;
  pager: HTMLElement | HTMLElement[];
  viewMore?: HTMLAnchorElement | null;
  initial?: CatalogParams;
  fillRows?: boolean;
  getMetadata?: () => { id: string; type?: string }[];
  onNavigate?: (params: CatalogParams, options?: { replace?: boolean }) => void;
}
