import { useLiveQuery } from 'dexie-react-hooks';
import { db, type ScheduledTask } from '../db/schema';
import { today, addDays, rangeDates, toISODate } from '../domain/dates';
import { accuracy } from '../domain/calc';

export const dayOf = (ms: number) => toISODate(new Date(ms));

export interface DayRow { date: string; plannedSec: number; doneSec: number; plannedTasks: number; doneTasks: number; missedTasks: number; actualSec: number; mcqAttempted: number; mcqCorrect: number; revisionsDone: number; }

/** Per-day audit rows computed from records (tasks, study sessions, MCQ sessions, revision events). */
export async function dayRows(from: string, to: string): Promise<DayRow[]> {
  const t0 = today();
  const [tasks, sessions, mcq, revs] = await Promise.all([
    db.tasks.where('scheduledDate').between(from, to, true, true).toArray(),
    db.studySessions.where('startTime').between(new Date(from + 'T00:00').getTime(), new Date(to + 'T23:59:59').getTime()).toArray(),
    db.mcqSessions.where('sessionDate').between(from, to, true, true).toArray(),
    db.revisionEvents.where('status').equals('done').toArray()]);
  const m = new Map<string, DayRow>(rangeDates(from, to).map(d => [d, { date: d, plannedSec: 0, doneSec: 0, plannedTasks: 0, doneTasks: 0, missedTasks: 0, actualSec: 0, mcqAttempted: 0, mcqCorrect: 0, revisionsDone: 0 }]));
  const activePlans = new Set((await db.plans.where('status').anyOf('active', 'paused').toArray()).map(p => p.id));
  for (const t of tasks) {
    if (t.status === 'removed' || !activePlans.has(t.planId)) continue; const r = m.get(t.scheduledDate); if (!r) continue;
    r.plannedSec += t.plannedSeconds; r.plannedTasks++;
    if (t.status === 'done') { r.doneTasks++; r.doneSec += t.plannedSeconds; }
    else if (t.status === 'pending' && t.scheduledDate < t0) r.missedTasks++;
  }
  for (const s of sessions) { const r = m.get(dayOf(s.startTime)); if (r) r.actualSec += s.durationSeconds; }
  for (const s of mcq) { const r = m.get(s.sessionDate); if (r) { r.mcqAttempted += s.attempted; r.mcqCorrect += s.correct; } }
  for (const e of revs) if (e.completedAt) { const r = m.get(dayOf(e.completedAt)); if (r) r.revisionsDone++; }
  return [...m.values()];
}

export function useDays(from: string, to: string) { return useLiveQuery(() => dayRows(from, to), [from, to]); }

export interface Debt { overdueSec: number; overdueCount: number; futureSec: number; futureCount: number; unscheduledNote: string | null; }
export async function preparationDebt(): Promise<Debt> {
  const t0 = today(); const plan = (await db.plans.where('status').equals('active').toArray())[0];
  if (!plan) return { overdueSec: 0, overdueCount: 0, futureSec: 0, futureCount: 0, unscheduledNote: 'No active plan.' };
  const pend = (await db.tasks.where('planId').equals(plan.id).toArray()).filter(t => t.status === 'pending');
  const od = pend.filter(t => t.scheduledDate < t0), fu = pend.filter(t => t.scheduledDate >= t0);
  return { overdueSec: od.reduce((a, t) => a + t.plannedSeconds, 0), overdueCount: od.length, futureSec: fu.reduce((a, t) => a + t.plannedSeconds, 0), futureCount: fu.length, unscheduledNote: null };
}
export const useDebt = () => useLiveQuery(preparationDebt, []);

export function useToday() {
  return useLiveQuery(async () => {
    const t = today(); const plan = (await db.plans.where('status').equals('active').toArray())[0];
    const tasks: ScheduledTask[] = plan ? (await db.tasks.where('[planId+scheduledDate]').equals([plan.id, t]).toArray()).filter(x => x.status !== 'removed').sort((a, b) => a.orderIndex - b.orderIndex) : [];
    const ses = await db.studySessions.where('startTime').above(new Date(t + 'T00:00').getTime()).toArray();
    return { plan, tasks, actualSec: ses.reduce((a, s) => a + s.durationSeconds, 0) };
  }, []);
}

export function useMcqTotals() {
  return useLiveQuery(async () => {
    const all = await db.mcqSessions.toArray(); const targets = await db.mcqTargets.toArray();
    const att = all.reduce((a, s) => a + s.attempted, 0), cor = all.reduce((a, s) => a + s.correct, 0);
    const target = targets.reduce((a, t) => a + t.targetQuestions, 0);
    return { sessions: all.length, attempted: att, correct: cor, accuracy: accuracy(cor, att), target: target || null, totalQ: all.reduce((a, s) => a + s.totalQuestions, 0) };
  }, []);
}
export const last = (n: number) => ({ from: addDays(today(), -(n - 1)), to: today() });
