import type { Course, CourseText, Language, QuizAnswers, SavedCourse } from './types';

export const SAVED_KEY = 'kj-trail.saved-public-courses.v1';
export const defaultAnswers: QuizAnswers = { time: 'half', experience: 'beginner', interest: 'any', transit: 'public', pace: 'relaxed', company: 'solo' };

export function getRecommendationEligibility(course: Course, now: number = Date.now()): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!Number.isFinite(now)) reasons.push('invalidTime');
  if (course.isFixture) reasons.push('fixture');
  if (course.status !== 'published') reasons.push('unpublished');
  if (course.condition !== 'open') reasons.push(course.condition === 'closed' ? 'closed' : 'unknown');
  const expiry = course.conditionValidUntil ? Date.parse(course.conditionValidUntil) : NaN;
  if (!Number.isFinite(expiry) || expiry <= now) reasons.push('expired');
  const reviewed = course.reviewedAt ? Date.parse(course.reviewedAt) : NaN;
  const fetched = course.fetchedAt ? Date.parse(course.fetchedAt) : NaN;
  if (!Number.isFinite(reviewed) || reviewed > now || reviewed < fetched || course.reviewed !== true) reasons.push('unreviewed');
  if (!Number.isFinite(fetched) || fetched > now) reasons.push('unfetched');
  if (!safeExternalUrl(course.sourceUrl)) reasons.push('missingSource');
  if (!hasApprovedTranslations(course)) reasons.push('translation');
  if (course.recommendationEligible === false) reasons.push('serverIneligible');
  return { eligible: reasons.length === 0, reasons };
}

export function isCourseEligible(course: Course, now: number = Date.now()): boolean {
  return getRecommendationEligibility(course, now).eligible;
}

export function hasApprovedTranslations(course: Course): boolean {
  return course.translationStatus === 'approved' && !!course.sourceFingerprint && course.translationSourceFingerprint === course.sourceFingerprint && ['en', 'zh-TW'].every(locale => {
    const text = course.translations?.[locale as 'en' | 'zh-TW'];
    return text && ['title', 'summary', 'startPoint'].every(key => typeof text[key as keyof CourseText] === 'string' && !!text[key as keyof CourseText]?.trim());
  });
}

export function getCourseText(course: Course, lang: Language): CourseText {
  if (lang !== 'ko' && (course.isFixture || hasApprovedTranslations(course))) {
    const text = course.translations?.[lang];
    if (text?.title?.trim() && text.summary?.trim() && text.startPoint?.trim()) return { title: text.title, summary: text.summary, startPoint: text.startPoint };
  }
  return { title: course.title, summary: course.summary, startPoint: course.startPoint };
}

export function recommendCourses(courses: Course[], answers: QuizAnswers, now: number = Date.now()): { course: Course; score: number; reasons: string[] }[] {
  const maxMinutes = answers.time === 'short' ? 120 : answers.time === 'half' ? 240 : 480;
  const maxDifficulty = answers.experience === 'beginner' ? 0 : answers.experience === 'regular' ? 1 : 2;
  const ranks = { easy: 0, moderate: 1, hard: 2 };
  return courses.filter(course => isCourseEligible(course, now))
    .filter(course => course.durationMinutes > 0 && course.durationMinutes * (answers.pace === 'relaxed' ? 1.25 : 1) <= maxMinutes && ranks[course.difficulty] <= maxDifficulty)
    .map(course => {
      const matchedTheme = answers.interest !== 'any' && course.themes.some(theme => theme.toLowerCase() === answers.interest);
      const reasons = ['timeMatch', 'experienceMatch'];
      if (matchedTheme) reasons.push('interestMatch');
      if (answers.pace === 'relaxed') reasons.push('paceBuffer');
      return { course, score: (matchedTheme ? 20 : 0) + (maxDifficulty - ranks[course.difficulty] + 1) * 2, reasons };
    }).sort((a, b) => b.score - a.score || a.course.durationMinutes - b.course.durationMinutes || a.course.id.localeCompare(b.course.id)).slice(0, 3);
}

export function safeExternalUrl(input: string | null | undefined): string | null {
  try { const url = new URL(input ?? ''); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.toString() : null; } catch { return null; }
}

export function filterCourses(courses: Course[], filters: { search: string; difficulty: string; theme: string; maxMinutes: number }): Course[] {
  const search = filters.search.trim().toLocaleLowerCase();
  return courses.filter(course => (!search || `${course.title} ${course.summary} ${course.startPoint} ${Object.values(course.translations ?? {}).map(text => `${text.title ?? ''} ${text.summary ?? ''} ${text.startPoint ?? ''}`).join(' ')}`.toLocaleLowerCase().includes(search)) &&
    (filters.difficulty === 'all' || course.difficulty === filters.difficulty) &&
    (filters.theme === 'all' || course.themes.includes(filters.theme)) &&
    (!filters.maxMinutes || course.durationMinutes <= filters.maxMinutes));
}

export function loadSavedCourses(): SavedCourse[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is SavedCourse => !!entry && typeof entry === 'object' && typeof entry.savedAt === 'string' && !!entry.course && typeof entry.course.id === 'string' && typeof entry.course.title === 'string' && Array.isArray(entry.course.themes) && ['easy', 'moderate', 'hard'].includes(entry.course.difficulty));
  } catch { return []; }
}

export function persistSavedCourses(value: SavedCourse[]): void {
  localStorage.setItem(SAVED_KEY, JSON.stringify(value));
}
