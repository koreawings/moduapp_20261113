export type Language = 'ko' | 'en' | 'zh-TW';
export type Page = 'explore' | 'quiz' | 'journey' | 'community' | 'saved' | 'admin';
export type Role = 'member' | 'content' | 'moderator' | 'admin';
export interface CourseText { title: string; summary: string; startPoint: string }
export interface User { id: string; username: string; displayName: string; role: Role; suspended: boolean; version: number }
export interface Course {
  id: string; title: string; summary: string; durationMinutes: number;
  difficulty: 'easy' | 'moderate' | 'hard'; themes: string[]; startPoint: string;
  sourceUrl: string; sourceEffectiveAt: string | null; fetchedAt: string | null;
  reviewedAt: string | null; reviewer: string | null;
  status: 'draft' | 'published' | 'withdrawn'; condition: 'unknown' | 'open' | 'closed';
  conditionValidUntil: string | null; translationStatus: 'pending' | 'approved';
  isFixture: boolean; version: number;
  translations?: Partial<Record<'en' | 'zh-TW', Partial<CourseText>>>;
  sourceFingerprint?: string; translationSourceFingerprint?: string | null;
  reviewed?: boolean; recommendationEligible?: boolean;
}
export interface SavedCourse { course: Course; savedAt: string }
export interface Room { id: string; name: string; description: string; locked: boolean; joined: boolean; version: number }
export interface Message { id: string; roomId: string; authorId: string; authorName: string; body: string; createdAt: string; clientMessageId: string }
export interface Comment { id: string; authorId: string; authorName: string; body: string; createdAt: string }
export interface Post { id: string; title: string; body: string; authorId: string; authorName: string; createdAt: string; version: number; comments: Comment[] }
export interface Report { id: string; targetType: 'message' | 'post' | 'comment'; targetId: string; reason: string; status: string; version: number; createdAt: string; targetPreview?: string; authorName?: string; targetHidden?: boolean }
export interface AuditEntry { id: string; actorId: string; action: string; targetId: string; reason: string; createdAt: string }
export interface Feedback { id: string; category: string; body: string; createdAt: string; authorName?: string; authorId?: string; userId?: string }
export interface QuizAnswers { time: 'short' | 'half' | 'full'; experience: 'beginner' | 'regular' | 'experienced'; interest: 'nature' | 'culture' | 'views' | 'any'; transit: 'public' | 'car' | 'any'; pace: 'relaxed' | 'steady'; company: 'solo' | 'friends' | 'family' }
export interface PendingMessage { clientMessageId: string; roomId: string; body: string; state: 'sending' | 'failed' | 'cancelled'; error?: string }
