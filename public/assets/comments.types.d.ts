export type Mood = 'peak' | 'mid' | 'crying' | 'sus' | 'angry' | 'good' | 'funny' | 'shocked' | 'wholesome';
export interface Comment {
  id: number; animeSlug: string; episode: number; parentId: number | null;
  author: string; body: string; spoiler: boolean; createdAt: number;
  deleted: boolean; likes: number; liked: boolean; canDelete: boolean;
  replyCount: number; replies?: Comment[];
}
export interface CommentPage {
  comments: Comment[]; total: number; page: number; pages: number;
  reactions: Record<Mood, number>; myReaction: Mood | null;
}
export interface CommentDraft {
  slug: string; episode: number; body: string; spoiler: boolean; parentId: number | null; requestId: string;
}
