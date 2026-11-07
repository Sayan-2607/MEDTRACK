import { describe, it, expect } from 'vitest';
import { estimatedSeconds, timeSavedSeconds, fmtDuration, accuracy, validateMcq, workload, effectiveSpeed, percent } from '../domain/calc';
import type { Video, VideoProgress, Subject } from '../db/schema';

describe('playback-speed calculations (Appendix C)', () => {
  const cases: [number, number][] = [[1, 3600], [1.2, 3000], [1.5, 2400], [1.8, 2000], [2, 1800]];
  for (const [sp, exp] of cases) it(`60 min at ${sp}x = ${exp / 60} min`, () => expect(estimatedSeconds(3600, sp)).toBeCloseTo(exp, 9));
  it('1.8x displays 33 min 20 s', () => expect(fmtDuration(estimatedSeconds(3600, 1.8), 'precise')).toBe('33 min 20 s'));
  it('zero duration', () => { expect(estimatedSeconds(0, 1.8)).toBe(0); expect(timeSavedSeconds(0, 2)).toBe(0); });
  it('large durations keep precision', () => expect(estimatedSeconds(1_000_000 * 60, 1.8) * 1.8).toBeCloseTo(60_000_000, 3));
  it('time saved', () => expect(timeSavedSeconds(3600, 2)).toBe(1800));
  it('rejects non-positive speed', () => expect(() => estimatedSeconds(60, 0)).toThrow());
  it('no cumulative rounding error across many videos', () => {
    const total = Array.from({ length: 1733 }, () => estimatedSeconds(47 * 60, 1.8)).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo((1733 * 47 * 60) / 1.8, 6);
  });
});

describe('effective speed precedence', () => {
  const sub = { defaultSpeed: 1.5 } as Subject;
  it('override > subject > global', () => {
    expect(effectiveSpeed({ speedOverride: 2 } as VideoProgress, sub, 1)).toBe(2);
    expect(effectiveSpeed({ speedOverride: null } as VideoProgress, sub, 1)).toBe(1.5);
    expect(effectiveSpeed(undefined, { defaultSpeed: null } as Subject, 1.2)).toBe(1.2);
  });
});

describe('MCQ rules', () => {
  it('accuracy excludes skipped; null with no attempts', () => { expect(accuracy(30, 40)).toBe(75); expect(accuracy(0, 0)).toBeNull(); });
  it('validation', () => {
    expect(validateMcq({ totalQuestions: 50, attempted: 40, correct: 30, incorrect: 10, skipped: 10 })).toEqual([]);
    expect(validateMcq({ totalQuestions: 50, attempted: 40, correct: 30, incorrect: 5, skipped: 0 }).length).toBe(1);
    expect(validateMcq({ totalQuestions: 30, attempted: 40, correct: 30, incorrect: 10, skipped: 0 }).length).toBe(1);
    expect(validateMcq({ totalQuestions: 10, attempted: 1.5 as any, correct: 1, incorrect: 0, skipped: 0 }).length).toBeGreaterThan(0);
  });
  it('percentage requires a denominator', () => expect(percent(3, 0)).toBeNull());
});

describe('inclusion vs completion', () => {
  const mk = (id: string, inc: boolean, min = 60): Video => ({ id, subjectId: 's', moduleType: 'Main', title: id, originalDurationSeconds: min * 60, sourcePage: 1, sourceRow: 1, sourceRowId: id, sourceOrder: 1, manualOrder: null, datasetVersion: 'v', includedInPlan: inc, active: true, tags: [], examTags: [], topic: null, createdAt: 0, updatedAt: 0 });
  const vids = [mk('a', true), mk('b', true), mk('c', false), mk('d', true)];
  const prog = new Map<string, VideoProgress>([
    ['a', { videoId: 'a', status: 'completed' } as VideoProgress], ['c', { videoId: 'c', status: 'completed' } as VideoProgress], ['d', { videoId: 'd', status: 'skipped' } as VideoProgress]]);
  const w = workload(vids, prog, new Map(), 2);
  it('excluded videos are neither completed nor remaining', () => { expect(w.included).toBe(3); expect(w.completed).toBe(1); expect(w.remaining).toBe(1); expect(w.skipped).toBe(1); });
  it('remaining estimate uses speed', () => { expect(w.remainingEstimatedSeconds).toBe(1800); expect(w.savedSeconds).toBe(1800); });
  it('catalogue counts everything active', () => expect(w.catalogueSeconds).toBe(4 * 3600));
});
