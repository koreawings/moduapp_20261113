import test from 'node:test';
import assert from 'node:assert/strict';
import { checkKeys, currentChecks, emptyJourney, parseJourney, preferenceLines, resolveJourneyCourse, reviseJourney, seoulDay } from '../src/journey.ts';

const now = Date.parse('2026-11-12T04:00:00Z');
const course = {
  id: 'synthetic-only', version: 3, title: 'Test only', summary: 'Not route guidance', startPoint: 'Test only', durationMinutes: 60, difficulty: 'easy', themes: [],
  sourceUrl: 'https://example.org/test', sourceEffectiveAt: null, fetchedAt: '2026-11-12T00:00:00Z', reviewedAt: '2026-11-12T01:00:00Z', reviewer: null,
  reviewed: true, recommendationEligible: true, status: 'published', condition: 'open', conditionValidUntil: '2026-11-12T12:00:00Z', translationStatus: 'approved',
  sourceFingerprint: 'a'.repeat(64), translationSourceFingerprint: 'a'.repeat(64), isFixture: false,
  translations: { en: { title: 'Test', summary: 'Test', startPoint: 'Test' }, 'zh-TW': { title: '測試', summary: '測試', startPoint: '測試' } },
};

test('journey: corrupt storage and unsupported schemas produce an empty plan', () => {
  for (const raw of [null, 'broken', 'null', '[]', '42', '{"schema":2,"meeting":"old"}']) assert.deepEqual(parseJourney(raw), emptyJourney());
});

test('journey: restore only known bounded fields; reject invalid dates, clock values and origins', () => {
  const restored = parseJourney(JSON.stringify({ schema: 1, origin: 'injected', date: '2026-02-30', returnBy: '29:99', meeting: 'x'.repeat(500), returnNote: { body: 'bad' }, checks: { weather: 'invalid', admin: '2026-11-12T01:00:00Z' }, savedAt: 'invalid', isApproved: true }));
  assert.equal(restored.origin, ''); assert.equal(restored.date, ''); assert.equal(restored.returnBy, '');
  assert.equal(restored.meeting.length, 240); assert.equal(restored.returnNote, ''); assert.equal(restored.savedAt, null);
  assert.deepEqual(restored.checks, {}); assert.equal('isApproved' in restored, false);
});

test('journey: saved plan roundtrips without a route snapshot or approval flag', () => {
  const draft = { ...emptyJourney(), origin: 'busan', date: '2026-11-14', meeting: 'Fictional test sign', returnBy: '15:30', returnNote: 'Test return note', savedAt: new Date(now).toISOString(), checks: { weather: new Date(now).toISOString() } };
  assert.deepEqual(parseJourney(JSON.stringify(draft)), draft);
});

test('journey: saved route ID cannot resurrect absent, changed, expired, closed or fixture content', () => {
  const draft = { ...emptyJourney(), courseId: course.id, courseVersion: course.version };
  assert.equal(resolveJourneyCourse(draft, [course], now), course);
  assert.equal(resolveJourneyCourse(draft, [], now), null);
  for (const changes of [{ version: 4 }, { condition: 'closed' }, { conditionValidUntil: new Date(now).toISOString() }, { isFixture: true }, { reviewed: false }, { translationStatus: 'pending' }, { recommendationEligible: false }]) {
    assert.equal(resolveJourneyCourse(draft, [{ ...course, ...changes }], now), null, JSON.stringify(changes));
  }
});

test('journey: a new Korea calendar day and future timestamps invalidate personal checks', () => {
  const midnight = Date.parse('2026-11-12T15:00:00Z');
  const draft = { ...emptyJourney(), checks: { weather: new Date(midnight - 1).toISOString(), entry: new Date(midnight).toISOString(), arrival: new Date(midnight + 1).toISOString() } };
  assert.equal(seoulDay(midnight), '2026-11-13');
  assert.deepEqual(currentChecks(draft, midnight), ['entry']);
  assert.deepEqual(currentChecks(draft, NaN), []);
});

test('journey: every itinerary change clears old check notes without mutating the prior draft', () => {
  const draft = { ...emptyJourney(), checks: Object.fromEntries(checkKeys.map(key => [key, new Date(now).toISOString()])), savedAt: new Date(now).toISOString() };
  for (const changes of [{ courseId: 'next' }, { courseVersion: 4 }, { origin: 'airport' }, { date: '2026-11-15' }, { meeting: 'A different test meeting' }, { returnBy: '14:00' }, { returnNote: 'A different return' }]) {
    const revised = reviseJourney(draft, changes);
    assert.deepEqual(revised.checks, {}); assert.equal(revised.savedAt, null); assert.equal(currentChecks(draft, now).length, 5);
  }
});

test('journey: complete personal checklist does not make an unapproved route eligible', () => {
  const draft = { ...emptyJourney(), checks: Object.fromEntries(checkKeys.map(key => [key, new Date(now).toISOString()])) };
  assert.equal(currentChecks(draft, now).length, 5);
  assert.equal(resolveJourneyCourse(draft, [course], now), null);
});

test('preference export: allowlist excludes precise plans, account data, route state and local URLs', () => {
  const answers = { time: 'short', experience: 'beginner', interest: 'nature', pace: 'relaxed', company: 'solo', transit: 'public', meeting: 'SECRET MEETING', origin: 'PRIVATE ORIGIN', date: 'PRIVATE DATE', sourceUrl: 'http://localhost:5173', condition: 'open', email: 'PRIVATE EMAIL' };
  const text = preferenceLines(answers, key => key).join('\n');
  for (const secret of ['SECRET MEETING', 'PRIVATE ORIGIN', 'PRIVATE DATE', 'localhost', 'PRIVATE EMAIL', 'open']) assert.equal(text.includes(secret), false);
  assert.ok(text.includes('short')); assert.ok(text.includes('jCardCaution'));
});
