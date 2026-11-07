import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema';
import type { Settings } from '../data/settings';
import { useCatalog, subjectWorkload } from '../data/hooks';
import { useToday, useDebt, useDays, useMcqTotals, last } from '../data/stats';
import { fmtDuration, fmtHours, percent } from '../domain/calc';
import { today, diffDays, fmtDate } from '../domain/dates';
import { readinessIndex, consistency, revisionStats } from '../domain/analytics';
import { Bar, Ring, BarChart, Empty, Info } from '../ui/components';
import { TaskRow } from './Schedule';

export function Home({ s }: { s: Settings }) {
  const c = useCatalog(); const td = useToday(); const debt = useDebt(); const mcq = useMcqTotals();
  const w14 = last(14); const days = useDays(w14.from, w14.to);
  const exams = useLiveQuery(() => db.examTargets.toArray(), []);
  const revs = useLiveQuery(() => db.revisionEvents.toArray(), []);
  const mocks = useLiveQuery(() => db.mocks.toArray(), []);
  const lastBackup = useLiveQuery(() => db.backups.where('status').equals('success').reverse().sortBy('backupTimestamp').then(x => x[0]), []);
  const lastImport = useLiveQuery(() => db.importBatches.orderBy('importedAt').last(), []);
  if (!c) return null;
  if (!c.videos.length) return <div className="card"><Empty title="No lecture catalogue yet">Import the validated Marrow Crambook catalogue to start. <div style={{ marginTop: 10 }}><Link className="btn primary" to="/settings#data">Open import</Link></div></Empty></div>;

  const all = subjectWorkload(c, null, s.globalSpeed);
  const pct = percent(all.completed, all.included);
  const t0 = today();
  const rv = revs ? revisionStats(revs, t0) : null;
  const cons = days ? consistency(days.map(d => ({ date: d.date, planned: d.plannedSec, done: d.doneSec })), s.productiveThresholdPct) : null;
  const mockPct = mocks?.length ? mocks.slice(-3).reduce((a, m) => a + (m.score / m.maxScore) * 100, 0) / Math.min(3, mocks.length) : null;
  const ri = readinessIndex({ videoPct: percent(all.completed, all.included), qbankPct: mcq?.target ? Math.min(100, (mcq.attempted / mcq.target) * 100) : null, revisionPct: rv?.donePct ?? null, mockPct, consistencyPct: cons }, s.readinessWeights);
  const noCoverage = c.subjects.filter(x => x.coverageStatus === 'no_records_in_source');

  const W: Record<string, JSX.Element | null> = {
    countdown: <div className="card"><div className="card-h"><h3>Exam countdown</h3><Link to="/settings#study" className="small">Edit</Link></div>
      <div className="grid-2">{(['NEET PG', 'INI-CET'] as const).map(k => { const e = exams?.find(x => x.examType === k); const d = e?.targetDate ? diffDays(t0, e.targetDate) : null;
        return <div key={k} className="kpi"><div className="l">{k}</div><div className="v">{d == null ? 'Not set' : d >= 0 ? `${d} days` : 'Passed'}</div><div className="tiny muted">{e?.targetDate ? fmtDate(e.targetDate, s.dateFormat) : 'Add a date in settings'}</div></div>; })}</div></div>,
    today: <div className="card"><div className="card-h"><h3>Today · {fmtDate(t0, s.dateFormat)}</h3><Link className="small" to="/schedule">Schedule</Link></div>
      {!td?.plan ? <Empty title="No active study plan"><Link className="btn primary sm" to="/schedule">Create a plan</Link></Empty> : <>
        <div className="kpis" style={{ marginBottom: 8 }}>
          <div className="kpi"><div className="v">{td.tasks.filter(t => t.status === 'done').length}/{td.tasks.length}</div><div className="l">tasks done</div></div>
          <div className="kpi"><div className="v">{fmtDuration(td.tasks.reduce((a, t) => a + t.plannedSeconds, 0), 'hm')}</div><div className="l">planned (@ speed)</div></div>
          <div className="kpi"><div className="v">{fmtDuration(td.actualSec, 'hm')}</div><div className="l">actual logged <Info text="Time from the study timer or manual entries. A completion tick doesn't count as time." /></div></div>
          <div className="kpi"><div className="v">{fmtDuration(td.tasks.filter(t => t.status === 'pending').reduce((a, t) => a + t.plannedSeconds, 0), 'hm')}</div><div className="l">remaining today</div></div>
        </div>
        <div className="list">{td.tasks.slice(0, 6).map(t => <TaskRow key={t.id} t={t} c={c} s={s} />)}</div>
        {td.tasks.length > 6 && <Link className="small" to="/schedule">+{td.tasks.length - 6} more</Link>}
        {!td.tasks.length && <div className="small muted">Nothing scheduled today (off day or plan finished).</div>}</>}
    </div>,
    progress: <div className="card"><div className="card-h"><h3>Lecture progress</h3><Info text="Completion = completed included videos ÷ included videos. Excluded videos are not counted." /></div>
      <div className="row" style={{ alignItems: 'center', gap: 18 }}>
        <Ring pct={pct} sub={pct == null ? 'No videos selected' : `${all.completed}/${all.included}`} />
        <div className="grow stack" style={{ gap: 4 }}>
          <div className="kv small"><span className="muted">Catalogue</span><span className="num">{all.total} videos · {fmtHours(all.catalogueSeconds)}</span></div>
          <div className="kv small"><span className="muted">Included</span><span className="num">{all.included} · {fmtHours(all.includedSeconds)}</span></div>
          <div className="kv small"><span className="muted">Remaining @ speed</span><span className="num">{all.remaining} · {fmtHours(all.remainingEstimatedSeconds)}</span></div>
          <div className="kv small"><span className="muted">Time saved by speed</span><span className="num">{fmtHours(all.savedSeconds)}</span></div>
        </div>
      </div></div>,
    modules: <div className="card"><h3 style={{ marginBottom: 10 }}>By content type</h3><div className="stack">
      {(['Main', 'Revision', 'MCQ'] as const).map(m => { const w = subjectWorkload(c, null, s.globalSpeed, m); const p = percent(w.completed, w.included);
        return <div key={m}><div className="row between small"><span><span className={'chip ' + m}>{m === 'MCQ' ? 'MCQ Discussion' : m}</span></span><span className="num muted">{w.completed}/{w.included} · {p == null ? 'none selected' : p.toFixed(0) + '%'}</span></div><Bar pct={p} /></div>; })}
      <div><div className="row between small"><span className="chip">QBank practice</span><span className="num muted">{mcq?.attempted ?? 0} attempted{mcq?.target ? ` of ${mcq.target}` : ''} · {mcq?.accuracy == null ? 'No attempts yet' : mcq.accuracy.toFixed(0) + '% acc.'}</span></div>{mcq?.target ? <Bar pct={(mcq.attempted / mcq.target) * 100} /> : <div className="tiny muted">Set a QBank target in MCQs to see a percentage.</div>}</div>
    </div></div>,
    debt: <div className="card"><div className="card-h"><h3>Preparation debt</h3><Info text="Planned duration of scheduled tasks you haven't finished. Overdue = scheduled before today." /></div>
      {debt?.unscheduledNote ? <div className="small muted">{debt.unscheduledNote}</div> : <div className="grid-2">
        <div className="kpi"><div className="v" style={{ color: debt && debt.overdueCount ? 'var(--warn)' : undefined }}>{fmtDuration(debt?.overdueSec ?? 0, 'hm')}</div><div className="l">overdue · {debt?.overdueCount ?? 0} tasks</div></div>
        <div className="kpi"><div className="v">{fmtDuration(debt?.futureSec ?? 0, 'hm')}</div><div className="l">future pending · {debt?.futureCount ?? 0} tasks</div></div></div>}
      {!!debt?.overdueCount && <Link to="/schedule?recover=1" className="btn sm" style={{ marginTop: 10 }}>Daily recovery plan</Link>}</div>,
    revision: <div className="card"><div className="card-h"><h3>Revisions</h3><Link to="/revision" className="small">Queue</Link></div>
      <div className="kpis"><div className="kpi"><div className="v">{rv?.today.length ?? 0}</div><div className="l">due today</div></div><div className="kpi"><div className="v" style={{ color: rv?.overdue.length ? 'var(--warn)' : undefined }}>{rv?.overdue.length ?? 0}</div><div className="l">overdue</div></div><div className="kpi"><div className="v">{rv?.upcoming.length ?? 0}</div><div className="l">upcoming</div></div></div></div>,
    readiness: <div className="card"><div className="card-h"><h3>Exam Readiness Index</h3><Link to="/analytics#readiness" className="small">Breakdown</Link></div>
      <div className="row"><Ring pct={ri.score} size={72} /><div className="grow small muted">A personal planning indicator built from your own records. It doesn't predict exam performance or rank. {ri.parts.filter(p => p.value == null).length > 0 && `${ri.parts.filter(p => p.value == null).length} component(s) have no data and are left out.`}</div></div></div>,
    weekly: <div className="card"><div className="card-h"><h3>Last 14 days: actual study hours</h3><Info text="Bars: actual time logged. Dashed outline: planned scheduled time." /></div>
      {days && days.some(d => d.actualSec || d.plannedSec) ? <BarChart data={days.map(d => ({ label: d.date.slice(8), value: d.actualSec / 3600 }))} secondary={days.map(d => d.plannedSec / 3600)} fmt={v => v.toFixed(1) + ' h'} /> : <div className="small muted">No study time logged yet. Use the timer or add time to a lecture.</div>}
      {cons != null && <div className="small muted">Consistency: {cons.toFixed(0)}% of scheduled days hit ≥{s.productiveThresholdPct}% of the plan.</div>}</div>,
    subjects: <div className="card"><div className="card-h"><h3>Subjects</h3><Link to="/lectures" className="small">All</Link></div><div className="stack" style={{ gap: 8 }}>
      {c.subjects.filter(x => !x.hidden && x.active).map(sub => { const w = subjectWorkload(c, sub.id, s.globalSpeed); const p = percent(w.completed, w.included);
        return <Link key={sub.id} to={`/lectures/${sub.id}`} style={{ textDecoration: 'none', color: 'inherit' }}><div className="row between small"><span>{sub.name}</span><span className="muted num">{sub.coverageStatus === 'no_records_in_source' ? 'no catalogue data' : p == null ? 'none selected' : p.toFixed(0) + '%'}</span></div><Bar pct={p} /></Link>; })}</div></div>,
    health: <div className="card"><h3 style={{ marginBottom: 8 }}>Data health</h3><div className="stack small" style={{ gap: 4 }}>
      <div className="row between"><span className="muted">Catalogue version</span><span>{lastImport?.datasetVersion ?? '—'}</span></div>
      <div className="row between"><span className="muted">Last successful backup</span><span>{lastBackup ? new Date(lastBackup.backupTimestamp).toLocaleString() : 'Never'}</span></div>
      {noCoverage.length > 0 && <div className="banner warn">Subjects with no catalogue records: {noCoverage.map(x => x.name).join(', ')}. They're shown as "no data", not 0%.</div>}
      <Link to="/backup" className="small">Backup & data health →</Link></div></div>
  };
  return (
    <div className="stack">
      <div className="grid">{s.dashboardWidgets.filter(w => w.visible).map(w => <div key={w.id} style={w.id === 'today' || w.id === 'subjects' ? { gridColumn: '1 / -1' } : undefined}>{W[w.id]}</div>)}</div>
    </div>
  );
}
