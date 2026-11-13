// Independent regression cases for review/fetch provenance boundaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getRecommendationEligibility, recommendCourses, safeExternalUrl, defaultAnswers } from '../src/domain.ts';

const now = Date.parse('2026-11-01T00:00:00Z');
const approved = {
  id: 'review-test-course', title: 'Synthetic review fixture', summary: 'Not route guidance',
  durationMinutes: 60, difficulty: 'easy', themes: ['nature'], startPoint: 'Test fixture',
  sourceUrl: 'https://example.org/source', sourceEffectiveAt: null,
  fetchedAt: '2026-10-31T01:00:00Z', reviewedAt: '2026-10-31T02:00:00Z', reviewer: null, reviewed: true,
  status: 'published', condition: 'open', conditionValidUntil: '2026-11-02T00:00:00Z',
  translationStatus: 'approved', sourceFingerprint: 'a'.repeat(64), translationSourceFingerprint: 'a'.repeat(64),
  translations: { en: { title: 'Synthetic review fixture', summary: 'Not route guidance', startPoint: 'Test fixture' }, 'zh-TW': { title: '虛構審核範例', summary: '並非實際路線指引', startPoint: '測試起點' } },
  recommendationEligible: true, isFixture: false, version: 1,
};

test('independent review: missing or invalid fetch evidence prevents recommendation', () => {
  for (const fetchedAt of [null, '', 'not-a-date']) {
    const course = { ...approved, fetchedAt };
    assert.equal(getRecommendationEligibility(course, now).eligible, false, `fetchedAt=${fetchedAt}`);
    assert.deepEqual(recommendCourses([course], defaultAnswers, now), []);
  }
});

test('independent review: future collection and review timestamps are not completed verification', () => {
  for (const change of [
    { fetchedAt: '2026-11-01T00:01:00Z' },
    { reviewedAt: '2026-11-01T00:01:00Z' },
    { reviewedAt: '2026-10-31T00:59:00Z' },
  ]) assert.equal(getRecommendationEligibility({ ...approved, ...change }, now).eligible, false, JSON.stringify(change));
  assert.equal(getRecommendationEligibility(approved, now).eligible, true);
});

test('independent review: credentials in external URLs cannot become source links', () => {
  for (const sourceUrl of ['https://user:secret@example.org/evidence', 'https://user@example.org/evidence']) {
    assert.equal(safeExternalUrl(sourceUrl), null);
    assert.equal(getRecommendationEligibility({ ...approved, sourceUrl }, now).eligible, false);
  }
  assert.equal(safeExternalUrl('https://example.org/evidence?q=route'), 'https://example.org/evidence?q=route');
});
