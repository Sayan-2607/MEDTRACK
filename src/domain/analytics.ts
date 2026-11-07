/** Derived metrics (spec §13–15, §17). Everything computed from records passed in — no sample data. */
import { accuracy } from './calc';
import { addDays, diffDays } from './dates';
import type { McqSession, RevisionEvent } from '../db/schema';

export interface ReadinessWeights { videos: number; qbank: number; revision: number; mocks: number; consistency: number; }
export const DEFAULT_WEIGHTS: ReadinessWeights = { videos: 35, qbank: 25, revision: 20, mocks: 10, consistency: 10 };
export interface ReadinessInput { videoPct: number | null; qbankPct: number | null; revisionPct: number | null; mockPct: number | null; consistencyPct: number | null; }
/** Exam Readiness Index — a personal planning indicator, NOT a prediction. Components without data are excluded
 *  and the remaining weights are re-normalised; each contribution is returned for transparency. */
export function readinessIndex(i: ReadinessInput, w: ReadinessWeights) {
  const parts = [
    { key: 'videos', label: 'First-pass video coverage', value: i.videoPct, weight: w.videos },
    { key: 'qbank', label: 'QBank practice coverage', value: i.qbankPct, weight: w.qbank },
    { key: 'revision', label: 'Revision completion', value: i.revisionPct, weight: w.revision },
    { key: 'mocks', label: 'Mock test performance', value: i.mockPct, weight: w.mocks },
    { key: 'consistency', label: 'Recent consistency (14 d)', value: i.consistencyPct, weight: w.consistency }
  ];
  const avail = parts.filter(p => p.value != null && p.weight > 0);
  const wsum = avail.reduce((a, p) => a + p.weight, 0);
  if (!wsum) return { score: null, parts: parts.map(p => ({ ...p, contribution: null as number | null })) };
  const out = parts.map(p => ({ ...p, contribution: p.value != null && p.weight > 0 ? (p.value * p.weight) / wsum : null }));
  return { score: out.reduce((a, p) => a + (p.contribution ?? 0), 0), parts: out };
}

/** Consistency = share of scheduled days (in window) where ≥ threshold% of planned work was completed. */
export function consistency(days: { date: string; planned: number; done: number }[], thresholdPct: number) {
  const sched = days.filter(d => d.planned > 0);
  if (!sched.length) return null;
  return (sched.filter(d => (d.done / d.planned) * 100 >= thresholdPct).length / sched.length) * 100;
}

/** Streak of consecutive productive days ending today/yesterday, allowing `grace` missed days. */
export function streak(productive: Set<string>, todayStr: string, grace: number) {
  let d = productive.has(todayStr) ? todayStr : addDays(todayStr, -1), n = 0, misses = 0;
  for (let i = 0; i < 3650; i++) {
    if (productive.has(d)) n++; else if (misses < grace) misses++; else break;
    d = addDays(d, -1);
  }
  return n;
}

export interface WeakTopic { key: string; subjectId: string | null; topic: string; reasons: string[]; accuracy: number | null; attempted: number; }
/** Weak Topic Radar: flagged only with evidence — accuracy < threshold with ≥ minAttempted, recorded mistakes,
 *  explicit flag/mark-for-revision, or overdue revisions. */
export function weakTopics(sessions: McqSession[], overdueByTopic: Map<string, number>, thresholdPct = 60, minAttempted = 20): WeakTopic[] {
  const g = new Map<string, { s: McqSession[] }>();
  for (const s of sessions) { const k = (s.subjectId ?? '') + '|' + s.topic.trim().toLowerCase(); (g.get(k) ?? g.set(k, { s: [] }).get(k)!).s.push(s); }
  const out: WeakTopic[] = [];
  for (const [k, { s }] of g) {
    const att = s.reduce((a, x) => a + x.attempted, 0), cor = s.reduce((a, x) => a + x.correct, 0);
    const acc = accuracy(cor, att); const reasons: string[] = [];
    if (acc != null && att >= minAttempted && acc < thresholdPct) reasons.push(`Accuracy ${acc.toFixed(0)}% over ${att} attempted`);
    const mistakes = s.filter(x => x.mistakes.trim()).length; if (mistakes >= 2) reasons.push(`${mistakes} sessions with recorded mistakes`);
    if (s.some(x => x.flagged)) reasons.push('Flagged as difficult');
    if (s.some(x => x.markForRevision)) reasons.push('Marked for revision');
    const od = overdueByTopic.get(s[0].topic.trim().toLowerCase()); if (od) reasons.push(`${od} overdue revision(s)`);
    if (reasons.length) out.push({ key: k, subjectId: s[0].subjectId, topic: s[0].topic, reasons, accuracy: acc, attempted: att });
  }
  return out.sort((a, b) => b.reasons.length - a.reasons.length || (a.accuracy ?? 100) - (b.accuracy ?? 100));
}

/** Study Reality Check: recommends a sustainable target from actual history. */
export function realityCheck(plannedDailySeconds: number, actualDaily: number[]) {
  const h = actualDaily.slice(-28);
  if (h.length < 7) return { enough: false as const, message: 'Need at least 7 days of logged study time for a reality check.' };
  const mean = h.reduce((a, b) => a + b, 0) / h.length;
  const sorted = [...h].sort((a, b) => a - b); const median = sorted[Math.floor(sorted.length / 2)];
  const ratio = plannedDailySeconds ? mean / plannedDailySeconds : 0;
  const recommended = Math.round((Math.max(median, mean * 0.9) / 60) / 15) * 15 * 60;
  return { enough: true as const, mean, median, ratio, recommended,
    message: ratio >= 0.9 ? 'Your plan matches what you actually study. Keep it.' : `You typically achieve ${(ratio * 100).toFixed(0)}% of your planned time. A sustainable target is about ${Math.round(recommended / 60)} min/day.` };
}

export function revisionStats(events: RevisionEvent[], todayStr: string) {
  const due = events.filter(e => e.status === 'due');
  return { today: due.filter(e => e.dueDate === todayStr), overdue: due.filter(e => e.dueDate < todayStr), upcoming: due.filter(e => e.dueDate > todayStr).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    donePct: events.filter(e => e.dueDate <= todayStr).length ? (events.filter(e => e.status === 'done').length / events.filter(e => e.dueDate <= todayStr || e.status === 'done').length) * 100 : null };
}

export const daysUntil = (from: string, to: string | null) => (to ? diffDays(from, to) : null);
