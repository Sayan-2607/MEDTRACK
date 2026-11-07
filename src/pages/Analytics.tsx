import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid, SPEEDS } from '../db/schema';
import { patchSettings, type Settings } from '../data/settings';
import { useCatalog, subjectWorkload } from '../data/hooks';
import { useDays, useMcqTotals, useDebt } from '../data/stats';
import { fmtDuration, fmtHours, percent, accuracy, estimatedSeconds } from '../domain/calc';
import { forecastScenarios } from '../domain/scheduler';
import { readinessIndex, consistency, streak, weakTopics, realityCheck, revisionStats } from '../domain/analytics';
import { today, addDays, fmtDate, startOfWeek, rangeDates } from '../domain/dates';
import { Bar, BarChart, LineChart, Heatmap, Ring, Seg, Info, Modal, Empty, Icon } from '../ui/components';

export default function Analytics({ s }: { s: Settings }) {
  const c = useCatalog(); const mcq = useMcqTotals(); const debt = useDebt();
  const [range, setRange] = useState<7 | 14 | 30 | 90>(30);
  const [from, setFrom] = useState(addDays(today(), -29)); const [to, setTo] = useState(today());
  const days = useDays(from, to);
  const yr = useDays(addDays(today(), -181), today());
  const hist28 = useDays(addDays(today(), -28), addDays(today(), -1));
  const sessions = useLiveQuery(() => db.mcqSessions.toArray(), []);
  const revs = useLiveQuery(() => db.revisionEvents.toArray(), []);
  const revItems = useLiveQuery(() => db.revisionItems.toArray(), []);
  const mocks = useLiveQuery(() => db.mocks.orderBy('date').toArray(), []);
  const milestones = useLiveQuery(() => db.milestones.toArray(), []);
  const [drill, setDrill] = useState<string | null>(null);
  const [mockOpen, setMockOpen] = useState(false); const [mk, setMk] = useState({ date: today(), name: '', score: '', max: '' });
  const [msOpen, setMsOpen] = useState(false); const [ms, setMs] = useState({ kind: 'subject', label: '', target: '', subjectId: '', due: '' });
  if (!c || !days || !yr || !hist28 || !sessions || !revs || !mocks || !milestones || !revItems) return null;
  const setR = (n: 7 | 14 | 30 | 90) => { setRange(n); setFrom(addDays(today(), -(n - 1))); setTo(today()); };

  const all = subjectWorkload(c, null, s.globalSpeed);
  const sum = (k: 'plannedSec' | 'actualSec' | 'doneTasks' | 'plannedTasks' | 'missedTasks' | 'mcqAttempted' | 'mcqCorrect') => days.reduce((a, d) => a + d[k], 0);
  const cons = consistency(days.map(d => ({ date: d.date, planned: d.plannedSec, done: d.doneSec })), s.productiveThresholdPct);
  const productive = new Set(yr.filter(d => d.plannedSec > 0 ? (d.doneSec / d.plannedSec) * 100 >= s.productiveThresholdPct : d.actualSec >= 30 * 60).map(d => d.date));
  const strk = streak(productive, today(), s.graceDays);
  const rv = revisionStats(revs, today());
  const overdueByTopic = new Map<string, number>(); for (const e of rv.overdue) { const it = revItems.find(i => i.id === e.itemId); if (it?.topic) overdueByTopic.set(it.topic.toLowerCase(), (overdueByTopic.get(it.topic.toLowerCase()) ?? 0) + 1); }
  const weak = weakTopics(sessions, overdueByTopic, s.weakAccuracyPct);
  const actualHist = hist28.map(d => d.actualSec);
  const reality = realityCheck(s.dailyHours * 3600, actualHist);
  const fc = forecastScenarios(all.remainingEstimatedSeconds, today(), actualHist.filter((_, i) => i >= actualHist.length - 14), s.dailyHours * 3600, { offDays: s.offDays, allowOffDays: false });
  const mockPct = mocks.length ? mocks.slice(-3).reduce((a, m) => a + (m.score / m.maxScore) * 100, 0) / Math.min(3, mocks.length) : null;
  const cons14 = consistency(hist28.slice(-14).map(d => ({ date: d.date, planned: d.plannedSec, done: d.doneSec })), s.productiveThresholdPct);
  const ri = readinessIndex({ videoPct: percent(all.completed, all.included), qbankPct: mcq?.target ? Math.min(100, (mcq.attempted / mcq.target) * 100) : null, revisionPct: rv.donePct, mockPct, consistencyPct: cons14 }, s.readinessWeights);

  // weekly buckets
  const weeks = new Map<string, { actual: number; planned: number; tasks: number; mcq: number }>();
  for (const d of days) { const w = startOfWeek(d.date, s.weekStart); const b = weeks.get(w) ?? { actual: 0, planned: 0, tasks: 0, mcq: 0 }; b.actual += d.actualSec; b.planned += d.plannedSec; b.tasks += d.doneTasks; b.mcq += d.mcqAttempted; weeks.set(w, b); }
  // speed simulator: respects per-video overrides, applies simulated speed to everything else
  const remainingVids = c.videos.filter(v => v.active && v.includedInPlan && !['completed', 'skipped'].includes(c.progress.get(v.id)?.status ?? ''));
  const sim = SPEEDS.map(sp => { const sec = remainingVids.reduce((a, v) => a + estimatedSeconds(v.originalDurationSeconds, c.progress.get(v.id)?.speedOverride ?? sp), 0);
    const f = forecastScenarios(sec, today(), [], s.dailyHours * 3600, { offDays: s.offDays, allowOffDays: false }); return { sp, sec, finish: f.expected }; });
  const overrides = remainingVids.filter(v => c.progress.get(v.id)?.speedOverride).length;
  // subject completion forecast: recent pace per subject (completed seconds in last 28 days)
  const since = Date.now() - 28 * 86400000;

  return (
    <div className="stack">
      <h1>Analytics</h1>
      <div className="row"><Seg value={range} onChange={setR} options={[{ v: 7, l: '7d' }, { v: 14, l: '14d' }, { v: 30, l: '30d' }, { v: 90, l: '90d' }]} />
        <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} style={{ width: 'auto' }} aria-label="From" /><input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} style={{ width: 'auto' }} aria-label="To" /></div>

      <div className="card"><h3 style={{ marginBottom: 8 }}>Period summary · {fmtDate(from, s.dateFormat)} – {fmtDate(to, s.dateFormat)}</h3>
        <div className="kpis">
          <div className="kpi"><div className="v">{fmtHours(sum('actualSec'))}</div><div className="l">actual study</div></div>
          <div className="kpi"><div className="v">{fmtHours(sum('plannedSec'))}</div><div className="l">scheduled</div></div>
          <div className="kpi"><div className="v">{sum('doneTasks')}/{sum('plannedTasks')}</div><div className="l">tasks done</div></div>
          <div className="kpi"><div className="v">{sum('missedTasks')}</div><div className="l">missed tasks</div></div>
          <div className="kpi"><div className="v">{sum('mcqAttempted')}</div><div className="l">MCQs attempted</div></div>
          <div className="kpi"><div className="v">{(() => { const a = accuracy(sum('mcqCorrect'), sum('mcqAttempted')); return a == null ? '—' : a.toFixed(0) + '%'; })()}</div><div className="l">MCQ accuracy</div></div>
          <div className="kpi"><div className="v">{cons == null ? '—' : cons.toFixed(0) + '%'}</div><div className="l">consistency <Info text={`Share of scheduled days where at least ${s.productiveThresholdPct}% of planned work was done (change this in Settings).`} /></div></div>
          <div className="kpi"><div className="v">{strk} d</div><div className="l">productive streak ({s.graceDays} grace)</div></div>
        </div></div>

      <div className="card"><div className="card-h"><h3>Daily study time</h3><span className="tiny muted">bars = actual · dashed = scheduled</span></div>
        {days.some(d => d.actualSec || d.plannedSec) ? <BarChart data={days.slice(-31).map(d => ({ label: d.date.slice(8), value: d.actualSec / 3600 }))} secondary={days.slice(-31).map(d => d.plannedSec / 3600)} fmt={v => v.toFixed(2) + ' h'} /> : <Empty title="No study data in this period" />}</div>

      <div className="card scroll-x"><h3 style={{ marginBottom: 8 }}>Weekly reports</h3>{weeks.size ? <table className="t"><thead><tr><th>Week of</th><th className="r">Actual</th><th className="r">Scheduled</th><th className="r">Tasks</th><th className="r">MCQs</th></tr></thead>
        <tbody>{[...weeks].reverse().map(([w, b]) => <tr key={w}><td>{fmtDate(w, s.dateFormat)}</td><td className="r">{fmtHours(b.actual)}</td><td className="r">{fmtHours(b.planned)}</td><td className="r">{b.tasks}</td><td className="r">{b.mcq}</td></tr>)}</tbody></table> : null}</div>

      <div className="card"><h3 style={{ marginBottom: 8 }}>Study calendar (26 weeks)</h3><Heatmap days={yr.map(d => ({ date: d.date, value: d.actualSec }))} /></div>

      <div className="card" id="readiness"><div className="card-h"><h3>Exam Readiness Index</h3><Ring pct={ri.score} size={64} /></div>
        <div className="banner info small" style={{ marginBottom: 10 }}>A personal planning indicator, not a validated prediction. It doesn't estimate rank, chance of selection or clinical competence. Components without data are left out and the remaining weights rescaled.</div>
        <table className="t"><thead><tr><th>Component</th><th className="r">Value</th><th className="r">Weight</th><th className="r">Contribution</th></tr></thead>
          <tbody>{ri.parts.map(p => <tr key={p.key}><td>{p.label}</td><td className="r">{p.value == null ? 'no data' : p.value.toFixed(0) + '%'}</td>
            <td className="r"><input type="number" min={0} max={100} aria-label={'Weight ' + p.label} style={{ width: 64, minHeight: 30 }} value={p.weight} onChange={e => patchSettings({ readinessWeights: { ...s.readinessWeights, [p.key]: Math.max(0, Number(e.target.value)) } })} /></td>
            <td className="r">{p.contribution == null ? '—' : p.contribution.toFixed(1)}</td></tr>)}</tbody></table></div>

      <div className="card"><h3 style={{ marginBottom: 8 }}>Finish-date forecast (all included lectures)</h3>
        <div className="kpis">{fc.basis === 'history' ? <><div className="kpi"><div className="v">{fmtDate(fc.optimistic, s.dateFormat)}</div><div className="l">optimistic (75th pct pace)</div></div><div className="kpi"><div className="v">{fmtDate(fc.expected, s.dateFormat)}</div><div className="l">expected (mean pace)</div></div><div className="kpi"><div className="v">{fmtDate(fc.conservative, s.dateFormat)}</div><div className="l">conservative (25th pct)</div></div></>
          : <div className="kpi"><div className="v">{fmtDate(fc.expected, s.dateFormat)}</div><div className="l">workload-based estimate</div></div>}
          <div className="kpi"><div className="v">{fmtHours(all.remainingEstimatedSeconds)}</div><div className="l">remaining @ speed</div></div></div>
        <p className="tiny muted">{fc.note} Assumes your configured off days and that every study day hits that pace.</p></div>

      <div className="card scroll-x"><h3 style={{ marginBottom: 8 }}>What-if speed simulator</h3>
        <table className="t"><thead><tr><th>Speed</th><th className="r">Remaining time</th><th className="r">Saved vs 1x</th><th className="r">Finish @ {s.dailyHours} h/day</th></tr></thead>
          <tbody>{sim.map(r => <tr key={r.sp} style={{ fontWeight: r.sp === s.globalSpeed ? 650 : 400 }}><td>{r.sp.toFixed(1)}x{r.sp === s.globalSpeed ? ' (current)' : ''}</td><td className="r">{fmtHours(r.sec)}</td><td className="r">{fmtHours(sim[0].sec - r.sec)}</td><td className="r">{fmtDate(r.finish, s.dateFormat)}</td></tr>)}</tbody></table>
        <p className="tiny muted">{overrides} lecture(s) with their own speed override keep that speed in every row.</p></div>

      <div className="card"><h3 style={{ marginBottom: 8 }}>Study reality check</h3>
        {reality.enough ? <><div className="kpis"><div className="kpi"><div className="v">{fmtDuration(s.dailyHours * 3600, 'hm')}</div><div className="l">planned / day</div></div><div className="kpi"><div className="v">{fmtDuration(reality.mean, 'hm')}</div><div className="l">actual mean (28 d)</div></div><div className="kpi"><div className="v">{fmtDuration(reality.recommended, 'hm')}</div><div className="l">sustainable target</div></div></div>
          <p className="small">{reality.message}</p>{reality.ratio < 0.9 && <button className="btn sm" onClick={() => patchSettings({ dailyHours: reality.recommended / 3600 })}>Use {fmtDuration(reality.recommended, 'hm')} as my daily target</button>}</> : <p className="small muted">{reality.message}</p>}</div>

      <div className="card"><div className="card-h"><h3>Weak topic radar</h3><Info text={`Flagged only with evidence: accuracy under ${s.weakAccuracyPct}% across 20+ attempts, recorded mistakes in 2+ sessions, a difficult flag, mark-for-revision, or overdue revisions.`} /></div>
        {weak.length ? <div className="list">{weak.slice(0, 15).map(w => <div key={w.key} className="li"><div className="grow"><div className="title">{w.topic || 'Untitled topic'} <span className="muted small">· {w.subjectId ? c.subjectMap.get(w.subjectId)?.name : 'General'}</span></div><div className="small muted">{w.reasons.join(' · ')}</div></div></div>)}</div> : <p className="small muted">No topic has enough evidence to be called weak yet.</p>}</div>

      <div className="card"><h3 style={{ marginBottom: 8 }}>Subjects: progress & completion forecast</h3>
        <div className="stack">{c.subjects.filter(x => x.active).map(sub => {
          const w = subjectWorkload(c, sub.id, s.globalSpeed); const p = percent(w.completed, w.included);
          const recent = c.videos.filter(v => v.subjectId === sub.id && (c.progress.get(v.id)?.completedAt ?? 0) > since).reduce((a, v) => a + estimatedSeconds(v.originalDurationSeconds, c.progress.get(v.id)?.completedSpeed ?? s.globalSpeed), 0);
          const perDay = recent / 28; const eta = perDay > 0 && w.remaining ? addDays(today(), Math.ceil(w.remainingEstimatedSeconds / perDay)) : null;
          return <div key={sub.id}><button onClick={() => setDrill(drill === sub.id ? null : sub.id)} style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }} aria-expanded={drill === sub.id}>
            <div className="row between small"><span>{sub.name}</span><span className="muted num">{sub.coverageStatus === 'no_records_in_source' ? 'no catalogue data' : `${p == null ? 'none selected' : p.toFixed(0) + '%'} · ${w.remaining ? (eta ? 'ETA ' + fmtDate(eta, s.dateFormat) : 'no recent pace') : w.included ? 'done' : ''}`}</span></div><Bar pct={p} /></button>
            {drill === sub.id && <div className="stack small" style={{ padding: '8px 0 4px 10px' }}>{(['Main', 'Revision', 'MCQ'] as const).map(m => { const mw = subjectWorkload(c, sub.id, s.globalSpeed, m); const mp = percent(mw.completed, mw.included);
              return <div key={m}><div className="row between"><span className={'chip ' + m}>{m}</span><span className="muted num">{mw.completed}/{mw.included} · {fmtHours(mw.remainingEstimatedSeconds)} left</span></div><Bar pct={mp} /></div>; })}
              <Link to={`/lectures/${sub.id}`}>Open subject →</Link></div>}
          </div>; })}</div>
        <p className="tiny muted">The ETA uses this subject's completed lecture time over the last 28 days. Subjects with no recent completions show "no recent pace" instead of a guess.</p></div>

      <div className="card"><div className="card-h"><h3>Milestones</h3><button className="btn sm" onClick={() => setMsOpen(true)}>Add</button></div>
        {milestones.length ? <div className="stack">{milestones.map(m => {
          let cur = 0; if (m.kind === 'subject' && m.subjectId) cur = subjectWorkload(c, m.subjectId, s.globalSpeed).completed; else if (m.kind === 'mcq') cur = mcq?.attempted ?? 0; else if (m.kind === 'revision') cur = revs.filter(e => e.status === 'done').length; else if (m.kind === 'mock') cur = mocks.length;
          return <div key={m.id}><div className="row between small"><span>{m.label}{m.dueDate ? ` · by ${fmtDate(m.dueDate, s.dateFormat)}` : ''}</span><span className="num">{cur}/{m.target} <button className="btn ghost sm" aria-label="Delete milestone" onClick={() => db.milestones.delete(m.id)}><Icon name="x" size={12} /></button></span></div><Bar pct={(cur / m.target) * 100} /></div>; })}</div> : <p className="small muted">Set milestones for subject completion, MCQ counts, revision cycles or mock tests.</p>}</div>

      <div className="card"><div className="card-h"><h3>Mock tests</h3><button className="btn sm" onClick={() => setMockOpen(true)}>Add result</button></div>
        {mocks.length ? <><LineChart points={mocks.map(m => ({ label: m.date, value: (m.score / m.maxScore) * 100 }))} /><div className="list">{mocks.slice().reverse().map(m => <div className="li small" key={m.id}><span className="grow">{fmtDate(m.date, s.dateFormat)} · {m.name}</span><b className="num">{m.score}/{m.maxScore} ({((m.score / m.maxScore) * 100).toFixed(0)}%)</b><button className="iconbtn" aria-label="Delete" onClick={() => db.mocks.delete(m.id)}><Icon name="x" size={14} /></button></div>)}</div></> : <p className="small muted">No mock results entered. Mocks only count towards the readiness index once you add them.</p>}</div>

      <div className="card"><h3 style={{ marginBottom: 8 }}>Preparation debt</h3><div className="kpis"><div className="kpi"><div className="v">{fmtDuration(debt?.overdueSec ?? 0, 'hm')}</div><div className="l">overdue · {debt?.overdueCount ?? 0} tasks</div></div><div className="kpi"><div className="v">{fmtDuration(debt?.futureSec ?? 0, 'hm')}</div><div className="l">future pending · {debt?.futureCount ?? 0}</div></div><div className="kpi"><div className="v">{all.remaining - (debt ? debt.overdueCount + debt.futureCount : 0) > 0 ? all.remaining - (debt!.overdueCount + debt!.futureCount) : 0}</div><div className="l">included but unscheduled videos</div></div></div></div>

      <Modal open={mockOpen} onClose={() => setMockOpen(false)} title="Mock test result"><div className="stack">
        <label className="field">Date<input type="date" value={mk.date} onChange={e => setMk({ ...mk, date: e.target.value })} /></label>
        <label className="field">Name<input type="text" value={mk.name} onChange={e => setMk({ ...mk, name: e.target.value })} /></label>
        <div className="grid-2"><label className="field">Score<input type="number" value={mk.score} onChange={e => setMk({ ...mk, score: e.target.value })} /></label><label className="field">Max score<input type="number" min={1} value={mk.max} onChange={e => setMk({ ...mk, max: e.target.value })} /></label></div>
        <button className="btn primary" disabled={!(Number(mk.max) > 0) || mk.score === '' || Number(mk.score) > Number(mk.max)} onClick={async () => { await db.mocks.add({ id: uid('mk_'), date: mk.date, name: mk.name || 'Mock', score: Number(mk.score), maxScore: Number(mk.max), percentile: null, notes: '' }); setMockOpen(false); }}>Save</button></div></Modal>
      <Modal open={msOpen} onClose={() => setMsOpen(false)} title="New milestone"><div className="stack">
        <label className="field">Type<select value={ms.kind} onChange={e => setMs({ ...ms, kind: e.target.value })}><option value="subject">Subject videos completed</option><option value="mcq">QBank questions attempted</option><option value="revision">Revisions completed</option><option value="mock">Mock tests taken</option></select></label>
        {ms.kind === 'subject' && <label className="field">Subject<select value={ms.subjectId} onChange={e => setMs({ ...ms, subjectId: e.target.value })}><option value="">Choose…</option>{c.subjects.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
        <label className="field">Label<input type="text" value={ms.label} onChange={e => setMs({ ...ms, label: e.target.value })} /></label>
        <label className="field">Target count<input type="number" min={1} value={ms.target} onChange={e => setMs({ ...ms, target: e.target.value })} /></label>
        <label className="field">Due (optional)<input type="date" value={ms.due} onChange={e => setMs({ ...ms, due: e.target.value })} /></label>
        <button className="btn primary" disabled={!(Number(ms.target) > 0) || (ms.kind === 'subject' && !ms.subjectId)} onClick={async () => { await db.milestones.add({ id: uid('ms_'), kind: ms.kind as any, label: ms.label || ms.kind, target: Number(ms.target), subjectId: ms.subjectId || null, dueDate: ms.due || null, createdAt: Date.now() }); setMsOpen(false); }}>Save</button></div></Modal>
    </div>
  );
}
