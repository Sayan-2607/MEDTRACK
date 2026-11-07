import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema';
import type { Settings } from '../data/settings';
import { useCatalog } from '../data/hooks';
import { useDays } from '../data/stats';
import { fmtDuration, accuracy } from '../domain/calc';
import { today, addDays, fmtDate, WEEKDAYS, weekday } from '../domain/dates';
import { Icon } from '../ui/components';
import { TaskRow } from './Schedule';

export default function Audit({ s }: { s: Settings }) {
  const [date, setDate] = useState(today()); const c = useCatalog();
  const rows = useDays(date, date); const r = rows?.[0];
  const tasks = useLiveQuery(async () => { const p = await db.plans.where('status').anyOf('active', 'paused').primaryKeys(); return (await db.tasks.where('scheduledDate').equals(date).toArray()).filter(t => t.status !== 'removed' && p.includes(t.planId)); }, [date]);
  const nextDay = useLiveQuery(async () => { const p = (await db.plans.where('status').equals('active').toArray())[0]; if (!p) return []; return (await db.tasks.where('[planId+scheduledDate]').equals([p.id, addDays(date, 1)]).toArray()).filter(t => t.status === 'pending'); }, [date]);
  const overdue = useLiveQuery(async () => { const p = (await db.plans.where('status').equals('active').toArray())[0]; if (!p) return []; return (await db.tasks.where('planId').equals(p.id).toArray()).filter(t => t.status === 'pending' && t.scheduledDate < addDays(date, 1)); }, [date]);
  if (!c || !r || !tasks) return null;
  const missed = tasks.filter(t => t.status === 'pending' && date < today());
  const lec = tasks.filter(t => t.taskType === 'video'); const rev = tasks.filter(t => t.taskType === 'revision');
  return (
    <div className="stack">
      <div className="row between"><button className="iconbtn" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day"><Icon name="back" /></button>
        <div style={{ textAlign: 'center' }}><h1>Daily audit</h1><div className="small muted">{WEEKDAYS[weekday(date)]}, {fmtDate(date, s.dateFormat)}</div></div>
        <button className="iconbtn" disabled={date >= today()} onClick={() => setDate(addDays(date, 1))} aria-label="Next day" style={{ transform: 'scaleX(-1)' }}><Icon name="back" /></button></div>
      <div className="kpis">
        <div className="kpi"><div className="v">{r.doneTasks}/{r.plannedTasks}</div><div className="l">tasks completed</div></div>
        <div className="kpi"><div className="v">{fmtDuration(r.plannedSec, 'hm')}</div><div className="l">scheduled time</div></div>
        <div className="kpi"><div className="v">{fmtDuration(r.actualSec, 'hm')}</div><div className="l">actual study time</div></div>
        <div className="kpi"><div className="v">{missed.length}</div><div className="l">missed tasks</div></div>
        <div className="kpi"><div className="v">{fmtDuration(lec.filter(t => t.status === 'done').reduce((a, t) => a + t.plannedSeconds, 0), 'hm')}</div><div className="l">lecture time done (planned)</div></div>
        <div className="kpi"><div className="v">{r.mcqAttempted}</div><div className="l">QBank attempted{r.mcqAttempted ? ` · ${accuracy(r.mcqCorrect, r.mcqAttempted)!.toFixed(0)}%` : ''}</div></div>
        <div className="kpi"><div className="v">{r.revisionsDone}</div><div className="l">revisions done ({rev.length} scheduled)</div></div>
      </div>
      <div className="small muted">Scheduled time and actual time are tracked separately and never mixed: ticking a task complete doesn't add study time.</div>
      <div className="card"><h3 style={{ marginBottom: 6 }}>Planned tasks</h3>{tasks.length ? <div className="list">{tasks.map(t => <TaskRow key={t.id} t={t} c={c} s={s} />)}</div> : <div className="small muted">No tasks were scheduled on this day.</div>}</div>
      <div className="card"><h3 style={{ marginBottom: 6 }}>Next-day priorities</h3>
        {(overdue?.length ?? 0) > 0 && <div className="banner warn small" style={{ marginBottom: 8 }}>{overdue!.length} pending task(s) carried as backlog. Clear them first or run the recovery plan from Schedule.</div>}
        {nextDay?.length ? <div className="list">{nextDay.slice(0, 8).map(t => <TaskRow key={t.id} t={t} c={c} s={s} />)}</div> : <div className="small muted">Nothing scheduled for the next day.</div>}</div>
    </div>
  );
}
