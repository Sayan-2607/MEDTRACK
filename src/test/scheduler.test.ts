import { describe, it, expect } from 'vitest';
import { schedule, subjectRunOrder, dailyCapacity, diffSchedules, forecastScenarios, type SchedConfig, type SchedItem } from '../domain/scheduler';
import { weekday } from '../domain/dates';

const base: SchedConfig = { startDate: '2026-11-07', dailyTargetSeconds: 7200, maxDailySeconds: 36000, offDays: [], allowOffDays: false, targetDate: null, mode: 'balanced', split: false };
const vids = (mins: number[]): SchedItem[] => mins.map((m, i) => ({ key: 'v' + i, kind: 'video', seconds: m * 60, subjectId: 's' }));

describe('scheduler', () => {
  it('reproduces the Crambook rule: a video starts on a day while capacity remains (atomic, may overrun)', () => {
    // PDF Day 1 at 1.8x / 2.00 h: 3.9 + 23.3 + 41.1 + 37.8 + 11.7 + 38.3 = 156.1 min (2.60 h) -> 6 videos
    const at18 = [7, 42, 74, 68, 21, 69, 86, 80].map(m => m / 1.8);
    const r = schedule(vids(at18), [], base);
    expect(r.placements.filter(p => p.date === '2026-11-07').length).toBe(6);
    expect(r.placements[6].date).toBe('2026-11-08');
    expect(r.warnings.some(w => w.includes('run over'))).toBe(true);
  });
  it('preserves order', () => { const r = schedule(vids([30, 30, 30, 30, 30]), [], base); expect(r.placements.map(p => p.key)).toEqual(['v0', 'v1', 'v2', 'v3', 'v4']); });
  it('skips off days', () => {
    const r = schedule(vids(Array(10).fill(120)), [], { ...base, offDays: [0] });
    expect(r.placements.every(p => weekday(p.date) !== 0)).toBe(true);
  });
  it('allows off days when configured', () => { const r = schedule(vids(Array(10).fill(120)), [], { ...base, offDays: [0], allowOffDays: true }); expect(r.placements.some(p => weekday(p.date) === 0)).toBe(true); });
  it('deadline mode computes the needed capacity', () => {
    const r = schedule(vids(Array(10).fill(60)), [], { ...base, mode: 'deadline', dailyTargetSeconds: 0, targetDate: '2026-11-11' }); // 5 days, 600 min -> 120/day
    expect(Math.round(r.dailyCapacitySeconds / 60)).toBe(120);
    expect(r.finishDate! <= '2026-11-11').toBe(true);
  });
  it('impossible deadline is capped at max daily and warned', () => {
    const r = schedule(vids(Array(40).fill(60)), [], { ...base, mode: 'deadline', maxDailySeconds: 4 * 3600, targetDate: '2026-11-08' });
    expect(r.dailyCapacitySeconds).toBe(4 * 3600);
    expect(r.warnings.some(w => w.includes('deadline will be missed'))).toBe(true);
    expect(r.warnings.some(w => w.includes('after the target date'))).toBe(true);
  });
  it('both inputs: daily hours = capacity, deadline = target with warning', () => {
    const r = schedule(vids(Array(20).fill(60)), [], { ...base, targetDate: '2026-11-08' });
    expect(r.dailyCapacitySeconds).toBe(7200);
    expect(r.warnings.some(w => w.includes('cannot be met'))).toBe(true);
  });
  it('never exceeds max daily workload', () => { const { cap } = dailyCapacity(1e6, 0, { ...base, dailyTargetSeconds: 20 * 3600, maxDailySeconds: 6 * 3600 }); expect(cap).toBe(6 * 3600); });
  it('long video longer than a day is placed atomically and flagged', () => {
    const r = schedule(vids([300, 30]), [], base);
    expect(r.placements[0].overrunSeconds).toBe(180 * 60);
    expect(r.placements[1].date).toBe('2026-11-08');
    expect(r.warnings.some(w => w.includes('longer than one day'))).toBe(true);
  });
  it('split mode fills days exactly', () => {
    const r = schedule(vids([300]), [], { ...base, split: true });
    expect(r.placements.map(p => p.seconds / 60)).toEqual([120, 120, 60]);
    expect(r.placements.every(p => p.parts === 3)).toBe(true);
  });
  it('pinned work consumes capacity', () => {
    const r = schedule(vids([60, 60]), [{ date: '2026-11-07', seconds: 7200 }], base);
    expect(r.placements[0].date).toBe('2026-11-08');
  });
  it('revisions are placed inside capacity on/after due date', () => {
    const items: SchedItem[] = [{ key: 'r1', kind: 'revision', seconds: 1200, subjectId: null, fixedDate: '2026-11-08' }, ...vids([100, 100])];
    const r = schedule(items, [], base);
    const rev = r.placements.find(p => p.key === 'r1')!; expect(rev.date).toBe('2026-11-08');
    expect(r.perDay.get('2026-11-08')! <= 7200 + 100 * 60).toBe(true);
  });
  it('is deterministic', () => { const a = schedule(vids([33, 47, 81, 12]), [], base); const b = schedule(vids([33, 47, 81, 12]), [], base); expect(a.placements).toEqual(b.placements); });
  it('priority order: 1 first, blanks last in sortOrder', () => {
    const o = subjectRunOrder([{ id: 'a', name: 'Anatomy', priority: null, sortOrder: 1 }, { id: 'm', name: 'Medicine', priority: 1, sortOrder: 15 }, { id: 'o', name: 'OBGYN', priority: 2, sortOrder: 17 }, { id: 'p', name: 'Phys', priority: null, sortOrder: 2 }]);
    expect(o.map(x => x.id)).toEqual(['m', 'o', 'a', 'p']);
  });
  it('rescheduling diff reports moved tasks', () => {
    const res = schedule(vids([60, 60]), [], { ...base, startDate: '2026-11-10' });
    const d = diffSchedules([{ key: 'v0', date: '2026-11-07', part: 1 }, { key: 'v1', date: '2026-11-07', part: 1 }], res);
    expect(d.moved.length).toBe(2); expect(d.newFinish).toBe('2026-11-10');
  });
  it('speed change shrinks workload and finish date', () => {
    const at1 = schedule(vids(Array(20).fill(60)), [], base); const at2 = schedule(vids(Array(20).fill(30)), [], base);
    expect(at2.finishDate! < at1.finishDate!).toBe(true);
  });
  it('availability change (more hours) moves finish earlier', () => {
    const a = schedule(vids(Array(20).fill(60)), [], base), b = schedule(vids(Array(20).fill(60)), [], { ...base, dailyTargetSeconds: 4 * 3600 });
    expect(b.finishDate! < a.finishDate!).toBe(true);
  });
  it('forecast labels workload-only estimate without history', () => {
    const f = forecastScenarios(10 * 3600, '2026-11-07', [3600, 3600], 7200, { offDays: [], allowOffDays: false });
    expect(f.basis).toBe('workload'); expect(f.expected).toBe('2026-11-11'); expect(f.optimistic).toBeNull();
    const h = forecastScenarios(10 * 3600, '2026-11-07', [1800, 3600, 3600, 5400, 3600, 7200, 3600], 7200, { offDays: [], allowOffDays: false });
    expect(h.basis).toBe('history'); expect(h.optimistic! <= h.expected!).toBe(true); expect(h.expected! <= h.conservative!).toBe(true);
  });
});
