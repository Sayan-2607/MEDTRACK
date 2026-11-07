import { describe, it, expect } from 'vitest';
import { readinessIndex, DEFAULT_WEIGHTS, consistency, streak, weakTopics, realityCheck } from '../domain/analytics';
import type { McqSession } from '../db/schema';

describe('analytics', () => {
  it('readiness excludes missing components and re-normalises', () => {
    const r = readinessIndex({ videoPct: 50, qbankPct: null, revisionPct: null, mockPct: null, consistencyPct: null }, DEFAULT_WEIGHTS);
    expect(r.score).toBe(50); expect(r.parts.find(p => p.key === 'qbank')!.contribution).toBeNull();
  });
  it('readiness with no data is null (not 0)', () => expect(readinessIndex({ videoPct: null, qbankPct: null, revisionPct: null, mockPct: null, consistencyPct: null }, DEFAULT_WEIGHTS).score).toBeNull());
  it('consistency', () => {
    expect(consistency([{ date: 'a', planned: 100, done: 100 }, { date: 'b', planned: 100, done: 50 }, { date: 'c', planned: 0, done: 0 }], 80)).toBe(50);
    expect(consistency([], 80)).toBeNull();
  });
  it('streak with grace day', () => {
    const s = new Set(['2026-11-07', '2026-11-06', '2026-11-04']);
    expect(streak(s, '2026-11-07', 0)).toBe(2); expect(streak(s, '2026-11-07', 1)).toBe(3);
  });
  it('weak topics need evidence', () => {
    const base = { id: 'x', subjectId: 's', source: 'q', sessionDate: '2026-11-01', totalQuestions: 30, skipped: 0, durationSeconds: 0, notes: '', completed: true, flagged: false, mistakes: '', markForRevision: false, origin: 'user', createdAt: 0 } as const;
    const few: McqSession[] = [{ ...base, topic: 'Cornea', attempted: 5, correct: 1, incorrect: 4 }];
    expect(weakTopics(few, new Map())).toEqual([]);
    const many: McqSession[] = [{ ...base, topic: 'Cornea', attempted: 30, correct: 12, incorrect: 18 }];
    expect(weakTopics(many, new Map())[0].reasons[0]).toMatch(/Accuracy 40%/);
  });
  it('reality check needs 7 days and recommends sustainable target', () => {
    expect(realityCheck(14400, [3600, 3600]).enough).toBe(false);
    const r = realityCheck(14400, Array(14).fill(7200)); expect(r.enough && r.recommended).toBe(7200);
  });
});
