/**
 * Deterministic local scheduling engine (spec §11, §12). Pure functions — no I/O, no randomness, no clock reads
 * except through the `today` argument. See docs/SCHEDULING.md for pseudocode and examples.
 */
import { addDays, diffDays, weekday } from './dates';
import type { PlanMode } from '../db/schema';

export interface SchedItem {
  key: string;                 // videoId or revisionEventId
  kind: 'video' | 'revision';
  seconds: number;             // at effective speed
  subjectId: string | null;
  fixedDate?: string;          // revisions: due date (cannot be scheduled before)
}
export interface PinnedBlock { date: string; seconds: number; }
export interface SchedConfig {
  startDate: string;
  dailyTargetSeconds: number;
  maxDailySeconds: number;
  offDays: number[];           // weekday numbers 0..6
  allowOffDays: boolean;
  targetDate: string | null;
  mode: PlanMode;
  split: boolean;              // split long videos instead of atomic placement
  recentDailyActualSeconds?: number | null; // flexible mode input (history)
  horizonDays?: number;        // safety stop
}
export interface Placement { key: string; kind: 'video' | 'revision'; date: string; seconds: number; part: number; parts: number; overrunSeconds: number; }
export interface SchedResult {
  placements: Placement[]; finishDate: string | null; daysUsed: number; capacityUsedSeconds: number;
  dailyCapacitySeconds: number; warnings: string[]; perDay: Map<string, number>;
}

/** Subject run order: priority ascending (1 first), blanks last; ties broken by sortOrder then name. */
export function subjectRunOrder<T extends { id: string; priority: number | null; sortOrder: number; name: string }>(subs: T[]): T[] {
  return [...subs].sort((a, b) => {
    const pa = a.priority ?? Infinity, pb = b.priority ?? Infinity;
    if (pa !== pb) return pa - pb;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.name.localeCompare(b.name);
  });
}

export function isStudyDay(date: string, c: Pick<SchedConfig, 'offDays' | 'allowOffDays'>) { return c.allowOffDays || !c.offDays.includes(weekday(date)); }

export function countStudyDays(from: string, to: string, c: Pick<SchedConfig, 'offDays' | 'allowOffDays'>) {
  let n = 0; for (let d = from; d <= to; d = addDays(d, 1)) if (isStudyDay(d, c)) n++; return n;
}

/** Working daily capacity by mode. Never exceeds maxDailySeconds (no unsafe compensation). */
export function dailyCapacity(totalSeconds: number, pinnedSeconds: number, c: SchedConfig): { cap: number; warnings: string[] } {
  const w: string[] = [];
  let cap = c.dailyTargetSeconds;
  const max = c.maxDailySeconds > 0 ? c.maxDailySeconds : Infinity;
  if (c.mode === 'flexible' && c.recentDailyActualSeconds && c.recentDailyActualSeconds > 0) {
    // adapt toward demonstrated pace: blend target with history (never above target)
    cap = Math.min(cap || Infinity, Math.max(c.recentDailyActualSeconds * 1.1, 15 * 60));
    w.push(`Flexible mode: daily capacity adapted to your recent pace (${Math.round(cap / 60)} min/day).`);
  }
  if (c.targetDate) {
    const days = countStudyDays(c.startDate, c.targetDate, c);
    if (days <= 0) { w.push('Target date is before the start date or has no study days.'); }
    else {
      const needed = (totalSeconds + pinnedSeconds) / days;
      if (c.mode === 'deadline' || !cap) {
        cap = needed;
        if (needed > max) { w.push(`Deadline needs ${Math.round(needed / 60)} min/day, above your maximum of ${Math.round(max / 60)} min/day. Capped — the deadline will be missed.`); cap = max; }
      } else if (c.mode === 'balanced') {
        // spread evenly up to the target, without exceeding the working target
        cap = Math.min(cap, Math.max(needed, 1));
        if (needed > c.dailyTargetSeconds) w.push(`Target date cannot be met at ${Math.round(c.dailyTargetSeconds / 60)} min/day (needs ${Math.round(needed / 60)} min/day).`);
      } else if (needed > cap) {
        w.push(`Target date cannot be met at the current capacity (needs ${Math.round(needed / 60)} min/day).`);
      }
    }
  }
  if (!cap || !isFinite(cap)) { w.push('No daily study time configured.'); cap = 0; }
  if (cap > max) cap = max;
  return { cap, warnings: w };
}

/**
 * Greedy, order-preserving placement.
 * Atomic rule: a video starts on day D if D still has remaining capacity (> 0); it is assigned wholly to D even
 * if it overruns, and the overrun is disclosed. Split rule: fill D exactly, carry the remainder to D+1.
 * Revisions are placed no earlier than their due date and consume the same capacity (not stacked on top).
 */
export function schedule(items: SchedItem[], pinned: PinnedBlock[], c: SchedConfig): SchedResult {
  const warnings: string[] = [];
  const total = items.reduce((a, i) => a + i.seconds, 0);
  const pinnedTotal = pinned.reduce((a, p) => a + p.seconds, 0);
  const { cap, warnings: cw } = dailyCapacity(total, pinnedTotal, c);
  warnings.push(...cw);
  const perDay = new Map<string, number>();
  for (const p of pinned) perDay.set(p.date, (perDay.get(p.date) ?? 0) + p.seconds);
  const placements: Placement[] = [];
  const horizon = c.horizonDays ?? 3650;
  if (cap <= 0 || items.length === 0) return { placements, finishDate: null, daysUsed: 0, capacityUsedSeconds: 0, dailyCapacitySeconds: cap, warnings, perDay };

  // Revisions are placed first on/after their due date in queue order; then videos fill remaining capacity in order.
  const revs = items.filter(i => i.kind === 'revision').sort((a, b) => (a.fixedDate ?? '').localeCompare(b.fixedDate ?? '') || a.key.localeCompare(b.key));
  const vids = items.filter(i => i.kind === 'video');

  const nextStudyDay = (d: string) => { let x = d, g = 0; while (!isStudyDay(x, c)) { x = addDays(x, 1); if (++g > 14) break; } return x; };
  const used = (d: string) => perDay.get(d) ?? 0;
  const add = (d: string, s: number) => perDay.set(d, used(d) + s);

  for (const r of revs) {
    let d = nextStudyDay(r.fixedDate && r.fixedDate > c.startDate ? r.fixedDate : c.startDate);
    let guard = 0;
    while (used(d) >= cap && guard++ < horizon) d = nextStudyDay(addDays(d, 1));
    const over = Math.max(0, used(d) + r.seconds - cap);
    placements.push({ key: r.key, kind: 'revision', date: d, seconds: r.seconds, part: 1, parts: 1, overrunSeconds: over });
    add(d, r.seconds);
  }

  let d = nextStudyDay(c.startDate);
  let guard = 0;
  for (const v of vids) {
    if (c.split) {
      let left = v.seconds; const parts: { date: string; s: number }[] = [];
      while (left > 1e-6 && guard < horizon) {
        const free = cap - used(d);
        if (free <= 1e-6) { d = nextStudyDay(addDays(d, 1)); guard++; continue; }
        const s = Math.min(free, left); parts.push({ date: d, s }); add(d, s); left -= s;
      }
      parts.forEach((p, i) => placements.push({ key: v.key, kind: 'video', date: p.date, seconds: p.s, part: i + 1, parts: parts.length, overrunSeconds: 0 }));
    } else {
      while (used(d) >= cap - 1e-6 && guard < horizon) { d = nextStudyDay(addDays(d, 1)); guard++; }
      const over = Math.max(0, used(d) + v.seconds - cap);
      placements.push({ key: v.key, kind: 'video', date: d, seconds: v.seconds, part: 1, parts: 1, overrunSeconds: over });
      add(d, v.seconds);
    }
    if (guard >= horizon) { warnings.push('Schedule horizon exceeded (10 years). Increase daily time.'); break; }
  }
  const dates = placements.map(p => p.date).sort();
  const finishDate = dates.length ? dates[dates.length - 1] : null;
  const overruns = placements.filter(p => p.overrunSeconds > 0);
  if (overruns.length) warnings.push(`${overruns.length} day(s) run over the daily target because a whole video starts before the limit (max overrun ${Math.round(Math.max(...overruns.map(o => o.overrunSeconds)) / 60)} min).`);
  const longOnes = vids.filter(v => v.seconds > cap);
  if (longOnes.length && !c.split) warnings.push(`${longOnes.length} video(s) are longer than one day's capacity. Consider enabling split sessions.`);
  if (c.targetDate && finishDate && finishDate > c.targetDate) warnings.push(`Forecast finish ${finishDate} is after the target date ${c.targetDate} (${diffDays(c.targetDate, finishDate)} days late).`);
  return { placements, finishDate, daysUsed: new Set(dates).size, capacityUsedSeconds: total, dailyCapacitySeconds: cap, warnings, perDay };
}

export interface RescheduleDiff { moved: { key: string; from: string; to: string }[]; unchanged: number; newFinish: string | null; oldFinish: string | null; perDay: Map<string, number>; warnings: string[]; }
/** Compare an existing pending task set against a fresh placement (keyed by item key + part). */
export function diffSchedules(oldTasks: { key: string; date: string; part: number }[], res: SchedResult): RescheduleDiff {
  const oldMap = new Map(oldTasks.map(t => [t.key + '#' + t.part, t.date]));
  const moved: RescheduleDiff['moved'] = []; let unchanged = 0;
  for (const p of res.placements) {
    const prev = oldMap.get(p.key + '#' + p.part);
    if (prev && prev !== p.date) moved.push({ key: p.key, from: prev, to: p.date }); else if (prev) unchanged++;
  }
  const od = oldTasks.map(t => t.date).sort();
  return { moved, unchanged, newFinish: res.finishDate, oldFinish: od.length ? od[od.length - 1] : null, perDay: res.perDay, warnings: res.warnings };
}

/** Finish-date forecast scenarios from remaining workload & history (spec §14). */
export function forecastScenarios(remainingSeconds: number, startDate: string, dailyHistorySeconds: number[], plannedDailySeconds: number, c: Pick<SchedConfig, 'offDays' | 'allowOffDays'>) {
  const studyDaysFor = (perDay: number) => {
    if (perDay <= 0) return null;
    let need = Math.ceil(remainingSeconds / perDay), d = startDate, g = 0;
    while (need > 0 && g++ < 5000) { if (isStudyDay(d, c)) need--; if (need > 0) d = addDays(d, 1); }
    return d;
  };
  const hist = dailyHistorySeconds.filter(x => x >= 0);
  if (hist.length < 7) return { basis: 'workload' as const, expected: studyDaysFor(plannedDailySeconds), optimistic: null, conservative: null, note: 'Fewer than 7 days of history — simple workload estimate at your planned daily time.' };
  const sorted = [...hist].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
  const mean = hist.reduce((a, b) => a + b, 0) / hist.length;
  // optimistic = your better days (≥ mean), conservative = your weaker days (≤ mean); ordering is guaranteed
  return { basis: 'history' as const, expected: studyDaysFor(mean), optimistic: studyDaysFor(Math.max(mean, q(0.75))), conservative: studyDaysFor(Math.min(mean, q(0.25)) || mean * 0.5), note: `Based on your last ${hist.length} days of actual study time (mean ${Math.round(mean / 60)} min/day).` };
}
