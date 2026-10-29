export interface VisitorLocation {
  country: string;
  region: string;
  city: string;
  status: 'resolved' | 'local' | 'disabled' | 'unavailable';
}
export interface VisitorEvent { path: string; eventId: string; type: 'view' | 'heartbeat' }
export interface VisitorRow extends VisitorLocation {
  ip: string; path: string; firstSeen: number; lastSeen: number;
  views: number; online: boolean;
}
export interface VisitorStats {
  startedAt: number; generatedAt: number; onlineWindowSeconds: number;
  totals: { visits: number; pageviews: number };
  today: { visitors: number; visits: number; pageviews: number };
  online: number; page: number; pages: number; total: number;
  visitors: VisitorRow[];
  daily: { day: string; visitors: number; visits: number; pageviews: number }[];
}
