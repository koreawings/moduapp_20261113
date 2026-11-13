import type { Course, QuizAnswers } from './types';
import { isCourseEligible } from './domain.ts';

export const JOURNEY_KEY = 'geumjeongsan.journey.v1';
export const origins = ['busan', 'airport', 'oncheonjang', 'hwamyeong', 'other'] as const;
export const checkKeys = ['weather', 'entry', 'arrival', 'meeting', 'return'] as const;
export type CheckKey = typeof checkKeys[number];
export interface JourneyDraft {
  schema: 1;
  courseId: string;
  courseVersion: number;
  origin: '' | typeof origins[number];
  date: string;
  meeting: string;
  returnBy: string;
  returnNote: string;
  checks: Partial<Record<CheckKey, string>>;
  savedAt: string | null;
}
export function emptyJourney(): JourneyDraft {
  return { schema: 1, courseId: '', courseVersion: 0, origin: '', date: '', meeting: '', returnBy: '', returnNote: '', checks: {}, savedAt: null };
}
export function seoulDay(now: number): string {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function bounded(value: unknown, max: number): string { return typeof value === 'string' ? value.slice(0, max).replace(/[\u0000-\u001f\u007f]/g, '') : ''; }
export function parseJourney(raw: string | null): JourneyDraft {
  try {
    const v: unknown = JSON.parse(raw ?? 'null');
    if (!record(v) || v.schema !== 1) return emptyJourney();
    const checks: JourneyDraft['checks'] = {};
    if (record(v.checks)) for (const key of checkKeys) {
      const stamp = v.checks[key];
      if (typeof stamp === 'string' && Number.isFinite(Date.parse(stamp))) checks[key] = stamp;
    }
    const date = bounded(v.date, 10);
    const returnBy = bounded(v.returnBy, 5);
    return {
      schema: 1, courseId: bounded(v.courseId, 100), courseVersion: Number.isInteger(v.courseVersion) && Number(v.courseVersion) > 0 ? Number(v.courseVersion) : 0,
      origin: origins.includes(v.origin as typeof origins[number]) ? v.origin as JourneyDraft['origin'] : '',
      date: /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().startsWith(date) ? date : '',
      meeting: bounded(v.meeting, 240), returnBy: /^([01]\d|2[0-3]):[0-5]\d$/.test(returnBy) ? returnBy : '', returnNote: bounded(v.returnNote, 240), checks,
      savedAt: typeof v.savedAt === 'string' && Number.isFinite(Date.parse(v.savedAt)) ? v.savedAt : null,
    };
  } catch { return emptyJourney(); }
}
export function loadJourney(): { draft: JourneyDraft; blocked: boolean } {
  try { return { draft: parseJourney(localStorage.getItem(JOURNEY_KEY)), blocked: false }; }
  catch { return { draft: emptyJourney(), blocked: true }; }
}
// A stored plan never grants route eligibility. Always resolve against a fresh API response.
export function resolveJourneyCourse(draft: JourneyDraft, courses: Course[], now = Date.now()): Course | null {
  return courses.find(course => course.id === draft.courseId && course.version === draft.courseVersion && isCourseEligible(course, now)) ?? null;
}
export function currentChecks(draft: JourneyDraft, now = Date.now()): CheckKey[] {
  if (!Number.isFinite(now)) return [];
  return checkKeys.filter(key => {
    const stamp = Date.parse(draft.checks[key] ?? '');
    return Number.isFinite(stamp) && stamp <= now && seoulDay(stamp) === seoulDay(now);
  });
}
// Changing a plan invalidates the user's check notes; these are never operator verification.
export function reviseJourney(draft: JourneyDraft, changes: Partial<Omit<JourneyDraft, 'schema' | 'checks' | 'savedAt'>>): JourneyDraft {
  return { ...draft, ...changes, checks: {}, savedAt: null };
}
export function preferenceLines(answers: QuizAnswers, translate: (key: string) => string): string[] {
  return ['GEUMJEONGSAN WELCOME TRAIL', translate('jPreferenceTitle'), '', ...(['time', 'experience', 'interest', 'pace'] as const).map(key => translate(answers[key])), '', translate('jCardCaution')];
}
