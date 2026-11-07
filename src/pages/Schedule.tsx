import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid, type ScheduledTask, type StudyPlan, type ModuleType } from '../db/schema';
import type { Settings } from '../data/settings';
import { useCatalog, type Catalog } from '../data/hooks';
import { previewPlan, createPlan, previewReschedule, applyReschedule, setTaskStatus, moveTask } from '../data/repo';
import { subjectRunOrder } from '../domain/scheduler';
import { fmtDuration, fmtHours } from '../domain/calc';
import { today, addDays, fmtDate, WEEKDAYS, startOfWeek, weekday } from '../domain/dates';
import { Icon, Seg, Modal, Empty, Confirm, useToast } from '../ui/components';

export function TaskRow({ t, c, s, showDate }: { t: ScheduledTask; c: Catalog; s: Settings; showDate?: boolean }) {
  const v = t.videoId ? c.videos.find(x => x.id === t.videoId) : null;
  const ev = useLiveQuery(() => (t.revisionEventId ? db.revisionEvents.get(t.revisionEventId) : undefined), [t.revisionEventId]);
  const item = useLiveQuery(() => (ev ? db.revisionItems.get(ev.itemId) : undefined), [ev?.itemId]);
  const revVideo = item?.videoId ? c.videos.find(x => x.id === item.videoId) : null;
  const [move, setMove] = useState(false); const [date, setDate] = useState(t.scheduledDate);
  const sub = v ? c.subjectMap.get(v.subjectId) : null;
  const done = t.status === 'done'; const overdue = t.status === 'pending' && t.scheduledDate < today();
  return (
    <div className="li">
      <button className={'status-btn ' + (done ? 'completed' : '')} aria-label={done ? 'Mark not done' : 'Mark done'} onClick={() => setTaskStatus(t.id, done ? 'pending' : 'done')}>{done && <Icon name="check" size={16} />}</button>
      <div className="grow">
        <div className="title" style={{ textDecoration: done ? 'line-through' : undefined, opacity: t.status === 'skipped' ? .55 : 1 }}>
          {v ? <Link className="title" to={`/video/${v.id}`}>{v.title}</Link> : <span>Revision: {revVideo?.title ?? item?.topic ?? '…'}{ev ? ` (cycle ${ev.cycle})` : ''}</span>}
          {t.partCount > 1 && <span className="chip" style={{ marginLeft: 6 }}>part {t.partIndex}/{t.partCount}</span>}
        </div>
        <div className="row small muted" style={{ gap: 6 }}>
          {v && <span className={'chip ' + v.moduleType}>{v.moduleType}</span>}{sub && <span>{sub.name}</span>}
          <span className="num">{fmtDuration(t.plannedSeconds)}</span>
          {showDate && <span>{fmtDate(t.scheduledDate, s.dateFormat)}</span>}
          {overdue && <span className="chip warn">overdue</span>}{t.pinned && <span className="chip">pinned</span>}{t.manual && !t.pinned && <span className="chip">moved</span>}
          {t.overrunSeconds > 60 && <span className="chip warn" title="This whole video starts before the daily limit and runs past it">+{Math.round(t.overrunSeconds / 60)} min over</span>}
          {t.status === 'skipped' && <span className="chip">skipped</span>}
        </div>
      </div>
      <button className="iconbtn" aria-label={t.pinned ? 'Unpin' : 'Pin to this date'} title={t.pinned ? 'Unpin' : 'Pin (never moved automatically)'} onClick={() => db.tasks.update(t.id, { pinned: !t.pinned })} style={{ color: t.pinned ? 'var(--accent)' : 'var(--muted)' }}><Icon name="pin" size={18} /></button>
      <button className="iconbtn" aria-label="Move or skip" onClick={() => setMove(true)}><Icon name="more" size={18} /></button>
      <Modal open={move} onClose={() => setMove(false)} title="Task options">
        <div className="stack">
          <label className="field">Move to date (marks the task as manually edited, so it won't be moved automatically)<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
          <div className="row"><button className="btn primary" onClick={() => { moveTask(t.id, date); setMove(false); }}>Move</button>
            <button className="btn" onClick={() => { setTaskStatus(t.id, 'skipped'); setMove(false); }}>Skip explicitly</button>
            <button className="btn danger" onClick={() => { setTaskStatus(t.id, 'removed'); setMove(false); }}>Remove from plan</button></div>
          <p className="tiny muted">You can only clear backlog by completing, explicitly skipping or removing a task. Every change is written to the audit log.</p>
        </div>
      </Modal>
    </div>
  );
}

const MODS: ModuleType[] = ['Main', 'Revision', 'MCQ'];

function PlanEditor({ s, c, base, onClose }: { s: Settings; c: Catalog; base?: StudyPlan; onClose: () => void }) {
  const toast = useToast();
  const [p, setP] = useState<StudyPlan>(() => base ? { ...base, id: uid('plan_'), name: base.name + ' (copy)', startDate: today() } : {
    id: uid('plan_'), name: 'First pass', mode: s.scheduleMode, startDate: today(), targetDate: null, dailyTargetMinutes: Math.round(s.dailyHours * 60),
    maxDailyMinutes: Math.round(s.maxDailyHours * 60), offDays: s.offDays, allowOffDays: false, splitLongVideos: s.splitLongVideos,
    subjectIds: c.subjects.filter(x => x.active && !x.hidden).map(x => x.id), modules: ['Main'], includeRevisions: true, status: 'active', createdAt: 0, updatedAt: 0 });
  const [prio, setPrio] = useState<Record<string, string>>(() => Object.fromEntries(c.subjects.map(x => [x.id, x.priority?.toString() ?? ''])));
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewPlan>> | null>(null);
  const [busy, setBusy] = useState(false);
  const upd = (x: Partial<StudyPlan>) => { setP({ ...p, ...x }); setPreview(null); };
  async function savePrio() { await db.transaction('rw', db.subjects, async () => { for (const [id, v] of Object.entries(prio)) await db.subjects.update(id, { priority: v.trim() === '' ? null : Math.max(1, Math.round(Number(v))) }); }); }
  async function doPreview() { setBusy(true); await savePrio(); setPreview(await previewPlan(p)); setBusy(false); }
  const order = useMemo(() => subjectRunOrder(c.subjects.filter(x => p.subjectIds.includes(x.id)).map(x => ({ ...x, priority: prio[x.id]?.trim() ? Number(prio[x.id]) : null }))), [c.subjects, p.subjectIds, prio]);
  return (
    <div className="stack">
      <div className="grid-2">
        <label className="field">Plan name<input type="text" value={p.name} onChange={e => upd({ name: e.target.value })} /></label>
        <label className="field">Start date<input type="date" value={p.startDate} onChange={e => upd({ startDate: e.target.value })} /></label>
        <label className="field">Daily study target (min)<input type="number" min={0} value={p.dailyTargetMinutes} onChange={e => upd({ dailyTargetMinutes: Number(e.target.value) })} /></label>
        <label className="field">Target finish date (optional)<input type="date" value={p.targetDate ?? ''} onChange={e => upd({ targetDate: e.target.value || null })} /></label>
        <label className="field">Max daily workload (min)<input type="number" min={0} value={p.maxDailyMinutes} onChange={e => upd({ maxDailyMinutes: Number(e.target.value) })} /></label>
        <div className="field"><span>Mode</span><Seg value={p.mode} onChange={m => upd({ mode: m })} options={[{ v: 'balanced', l: 'Balanced' }, { v: 'deadline', l: 'Deadline' }, { v: 'flexible', l: 'Flexible' }]} /></div>
      </div>
      <div className="tiny muted">{p.mode === 'balanced' ? 'Balanced spreads work evenly. With a target date, it uses the lower of your daily target and the pace the deadline needs.' : p.mode === 'deadline' ? 'Deadline works out the daily time needed to finish by the target date, capped at your maximum. It warns you if that cap means missing the deadline.' : 'Flexible adjusts daily capacity to your actual study time over the last 14 days, once at least 7 days are logged.'}</div>
      <div><div className="small muted" style={{ marginBottom: 6 }}>Content types</div><div className="row">{MODS.map(m => <label key={m} className="row small" style={{ gap: 4 }}><input type="checkbox" checked={p.modules.includes(m)} onChange={e => upd({ modules: e.target.checked ? [...p.modules, m] : p.modules.filter(x => x !== m) })} /><span className={'chip ' + m}>{m === 'MCQ' ? 'MCQ Discussion' : m}</span></label>)}
        <label className="row small" style={{ gap: 4 }}><input type="checkbox" checked={p.includeRevisions} onChange={e => upd({ includeRevisions: e.target.checked })} />Due revision cycles (inside daily capacity)</label></div></div>
      <div><div className="small muted" style={{ marginBottom: 6 }}>Off days</div><div className="row">{WEEKDAYS.map((d, i) => <label key={d} className="row small" style={{ gap: 4 }}><input type="checkbox" checked={p.offDays.includes(i)} onChange={e => upd({ offDays: e.target.checked ? [...p.offDays, i] : p.offDays.filter(x => x !== i) })} />{d}</label>)}
        <label className="row small" style={{ gap: 4 }}><input type="checkbox" checked={p.splitLongVideos} onChange={e => upd({ splitLongVideos: e.target.checked })} />Split long videos across days</label></div></div>
      <details open><summary>Subjects & priority ({p.subjectIds.length} selected). 1 = study first; blanks go last in source order</summary>
        <div className="list">{c.subjects.filter(x => x.active).map(x => <div key={x.id} className="li small" style={{ minHeight: 44, padding: '6px 2px' }}>
          <input type="checkbox" aria-label={'Include ' + x.name} checked={p.subjectIds.includes(x.id)} onChange={e => upd({ subjectIds: e.target.checked ? [...p.subjectIds, x.id] : p.subjectIds.filter(y => y !== x.id) })} />
          <span className="grow">{x.name}</span>
          <span className="muted">run #{order.findIndex(o => o.id === x.id) + 1 || '—'}</span>
          <input type="number" min={1} aria-label={'Priority for ' + x.name} style={{ width: 72, minHeight: 34 }} value={prio[x.id] ?? ''} onChange={e => { setPrio({ ...prio, [x.id]: e.target.value }); setPreview(null); }} placeholder="—" />
        </div>)}</div></details>
      <div className="row"><button className="btn" onClick={onClose}>Cancel</button><button className="btn" disabled={busy} onClick={doPreview}>{busy ? 'Calculating…' : 'Preview schedule'}</button>
        <button className="btn primary" disabled={!preview || busy || !preview.result.placements.length} onClick={async () => { setBusy(true); await createPlan(p); toast('Plan created. Previous plans were paused, not deleted.'); onClose(); }}>Create plan</button></div>
      {preview && <div className="card stack">
        <div className="kpis">
          <div className="kpi"><div className="v">{preview.items.length}</div><div className="l">tasks</div></div>
          <div className="kpi"><div className="v">{fmtHours(preview.result.capacityUsedSeconds)}</div><div className="l">workload @ speed</div></div>
          <div className="kpi"><div className="v">{fmtDuration(preview.result.dailyCapacitySeconds, 'hm')}</div><div className="l">daily capacity</div></div>
          <div className="kpi"><div className="v">{preview.result.daysUsed}</div><div className="l">study days</div></div>
          <div className="kpi"><div className="v">{fmtDate(preview.result.finishDate, s.dateFormat)}</div><div className="l">forecast finish</div></div>
        </div>
        {preview.result.warnings.map((w, i) => <div key={i} className="banner warn small">{w}</div>)}
        <div className="small muted">Run order: {preview.order.map(o => o.name).join(' → ')}</div>
      </div>}
    </div>
  );
}

function Recovery({ planId, s, onClose }: { planId: string; s: Settings; onClose: () => void }) {
  const [pr, setPr] = useState<Awaited<ReturnType<typeof previewReschedule>>>(null);
  const toast = useToast();
  useEffect(() => { previewReschedule(planId).then(setPr); }, [planId]);
  if (!pr) return <div className="muted small">Calculating…</div>;
  const days = [...pr.diff.perDay].filter(([d]) => d >= today()).sort().slice(0, 10);
  return <div className="stack">
    <p className="small" style={{ margin: 0 }}>{pr.overdue} overdue task(s). This preview moves every unpinned task you haven't edited, starting today, within your daily capacity ({fmtDuration(pr.placements.length ? Math.max(...days.map(d => d[1])) : 0, 'hm')} max on any day). Pinned and manually moved tasks stay where they are. Daily hours are never raised above your limits.</p>
    <div className="kpis"><div className="kpi"><div className="v">{pr.diff.moved.length}</div><div className="l">tasks moved</div></div>
      <div className="kpi"><div className="v">{fmtDate(pr.diff.oldFinish, s.dateFormat)}</div><div className="l">old finish</div></div>
      <div className="kpi"><div className="v">{fmtDate(pr.diff.newFinish, s.dateFormat)}</div><div className="l">new finish</div></div></div>
    {pr.diff.warnings.map((w, i) => <div key={i} className="banner warn small">{w}</div>)}
    <table className="t"><thead><tr><th>Date</th><th className="r">New workload</th></tr></thead><tbody>{days.map(([d, sec]) => <tr key={d}><td>{fmtDate(d, s.dateFormat)} {WEEKDAYS[weekday(d)]}</td><td className="r">{fmtDuration(sec, 'hm')}</td></tr>)}</tbody></table>
    <div className="row"><button className="btn" onClick={onClose}>Keep my schedule</button><button className="btn primary" onClick={async () => { await applyReschedule(planId); toast('Schedule updated. Old placements kept in history.'); onClose(); }}>Apply suggested changes</button></div>
  </div>;
}

export default function Schedule({ s }: { s: Settings }) {
  const c = useCatalog();
  const [params, setParams] = useSearchParams();
  const plans = useLiveQuery(() => db.plans.orderBy('createdAt').reverse().toArray(), []);
  const active = plans?.find(p => p.status === 'active') ?? null;
  const [view, setView] = useState<'day' | 'week' | 'days' | 'subjects' | 'plans'>('day');
  const [date, setDate] = useState(today());
  const [editor, setEditor] = useState<StudyPlan | 'new' | null>(null);
  const [recover, setRecover] = useState(params.get('recover') === '1');
  const [archive, setArchive] = useState<StudyPlan | null>(null);
  const tasks = useLiveQuery(() => active ? db.tasks.where('planId').equals(active.id).toArray().then(x => x.filter(t => t.status !== 'removed')) : Promise.resolve([] as ScheduledTask[]), [active?.id]);
  if (!c || !plans) return null;
  const t0 = today();
  const overdue = (tasks ?? []).filter(t => t.status === 'pending' && t.scheduledDate < t0);
  const dayTasks = (tasks ?? []).filter(t => t.scheduledDate === date).sort((a, b) => a.orderIndex - b.orderIndex);
  const byDay = new Map<string, ScheduledTask[]>(); for (const t of tasks ?? []) (byDay.get(t.scheduledDate) ?? byDay.set(t.scheduledDate, []).get(t.scheduledDate)!).push(t);
  const ws = startOfWeek(date, s.weekStart);

  if (editor) return <div className="stack"><h1>{editor === 'new' ? 'New study plan' : 'Duplicate plan'}</h1><PlanEditor s={s} c={c} base={editor === 'new' ? undefined : editor} onClose={() => setEditor(null)} /></div>;
  if (!active) return <div className="stack"><h1>Schedule</h1>
    <div className="card"><Empty title="No active plan">Make a deterministic day-by-day schedule from your selected lectures, playback speed and available time.<div style={{ marginTop: 12 }}><button className="btn primary" onClick={() => setEditor('new')} disabled={!c.videos.length}>Create a study plan</button></div>{!c.videos.length && <p>Import the catalogue first.</p>}</Empty></div>
    {plans.length > 0 && <div className="card"><h3>Previous plans</h3>{plans.map(p => <div className="li small" key={p.id}><span className="grow">{p.name} · {p.status}</span><button className="btn sm" onClick={() => db.plans.update(p.id, { status: 'active' })}>Resume</button></div>)}</div>}
  </div>;

  return (
    <div className="stack">
      <div className="row between"><div><h1>{active.name}</h1><div className="small muted">{active.mode} mode · {active.dailyTargetMinutes} min/day · from {fmtDate(active.startDate, s.dateFormat)}{active.targetDate ? ` · target ${fmtDate(active.targetDate, s.dateFormat)}` : ''}</div></div>
        <button className="btn primary sm" onClick={() => setEditor('new')}>New plan</button></div>
      {overdue.length > 0 && <div className="banner warn row between"><span>{overdue.length} overdue task(s), {fmtDuration(overdue.reduce((a, t) => a + t.plannedSeconds, 0), 'hm')}. These stay pending until you act on them.</span><button className="btn sm" onClick={() => setRecover(true)}>Recovery plan</button></div>}
      <div className="tabs" role="tablist">{([['day', 'Day'], ['week', 'Week'], ['days', 'Day summary'], ['subjects', 'Subjects'], ['plans', 'Plans']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}</div>

      {view === 'day' && <div className="card">
        <div className="row between" style={{ marginBottom: 8 }}>
          <button className="iconbtn" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}><Icon name="back" /></button>
          <div style={{ textAlign: 'center' }}><b>{WEEKDAYS[weekday(date)]}, {fmtDate(date, s.dateFormat)}</b><div className="small muted">{dayTasks.length} tasks · {fmtDuration(dayTasks.reduce((a, t) => a + t.plannedSeconds, 0), 'hm')} planned{date !== t0 && <> · <button className="btn ghost sm" onClick={() => setDate(t0)}>Today</button></>}</div></div>
          <button className="iconbtn" aria-label="Next day" onClick={() => setDate(addDays(date, 1))} style={{ transform: 'scaleX(-1)' }}><Icon name="back" /></button>
        </div>
        {dayTasks.length ? <div className="list">{dayTasks.map(t => <TaskRow key={t.id} t={t} c={c} s={s} />)}</div> : <Empty title={active.offDays.includes(weekday(date)) ? 'Off day' : 'Nothing scheduled'} />}
        {date === t0 && overdue.length > 0 && <><h3 style={{ marginTop: 14 }}>Overdue</h3><div className="list">{overdue.slice(0, 20).map(t => <TaskRow key={t.id} t={t} c={c} s={s} showDate />)}</div></>}
      </div>}

      {view === 'week' && <div className="card">
        <div className="row between" style={{ marginBottom: 10 }}><button className="btn sm" onClick={() => setDate(addDays(date, -7))}>← Prev</button><b className="small">Week of {fmtDate(ws, s.dateFormat)}</b><button className="btn sm" onClick={() => setDate(addDays(date, 7))}>Next →</button></div>
        <div className="week">{Array.from({ length: 7 }, (_, i) => addDays(ws, i)).map(d => { const ts = byDay.get(d) ?? []; const sec = ts.reduce((a, t) => a + t.plannedSeconds, 0); const dn = ts.filter(t => t.status === 'done').length;
          return <button key={d} className={'daycell ' + (d === t0 ? 'today ' : '') + (active.offDays.includes(weekday(d)) ? 'off' : '')} style={{ border: 'none', textAlign: 'left', cursor: 'pointer', color: 'inherit' }} onClick={() => { setDate(d); setView('day'); }}>
            <div><b>{WEEKDAYS[weekday(d)]}</b> {d.slice(8)}</div><div className="num">{ts.length ? fmtDuration(sec, 'hm') : '—'}</div><div className="muted">{ts.length ? `${dn}/${ts.length}` : ''}</div></button>; })}</div>
      </div>}

      {view === 'days' && <div className="card scroll-x"><table className="t"><thead><tr><th>Date</th><th className="r">Tasks</th><th className="r">Planned</th><th className="r">Done</th><th>Subjects</th></tr></thead>
        <tbody>{[...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([d, ts]) => { const subs = [...new Set(ts.map(t => c.videos.find(v => v.id === t.videoId)?.subjectId).filter(Boolean))].map(id => c.subjectMap.get(id!)?.name);
          return <tr key={d} style={{ background: d === t0 ? 'var(--accent-soft)' : undefined }}><td>{fmtDate(d, s.dateFormat)} <span className="muted">{WEEKDAYS[weekday(d)]}</span></td><td className="r">{ts.length}</td><td className="r">{fmtDuration(ts.reduce((a, t) => a + t.plannedSeconds, 0), 'hm')}</td><td className="r">{ts.filter(t => t.status === 'done').length}</td><td className="small">{subs.join(', ') || (ts.some(t => t.taskType === 'revision') ? 'Revisions' : '')}</td></tr>; })}</tbody></table></div>}

      {view === 'subjects' && <div className="card scroll-x"><table className="t"><thead><tr><th>Subject</th><th className="r">Tasks</th><th className="r">Planned</th><th>Starts</th><th>Ends</th><th className="r">Done</th></tr></thead>
        <tbody>{c.subjects.map(sub => { const ts = (tasks ?? []).filter(t => t.videoId && c.videos.find(v => v.id === t.videoId)?.subjectId === sub.id); if (!ts.length) return null; const ds = ts.map(t => t.scheduledDate).sort();
          return <tr key={sub.id}><td>{sub.name}</td><td className="r">{ts.length}</td><td className="r">{fmtHours(ts.reduce((a, t) => a + t.plannedSeconds, 0))}</td><td>{fmtDate(ds[0], s.dateFormat)}</td><td>{fmtDate(ds[ds.length - 1], s.dateFormat)}</td><td className="r">{ts.filter(t => t.status === 'done').length}</td></tr>; })}</tbody></table></div>}

      {view === 'plans' && <div className="card"><div className="list">{plans.map(p => <div className="li" key={p.id}><div className="grow"><div className="title">{p.name}</div><div className="small muted">{p.mode} · {p.dailyTargetMinutes} min/day · created {new Date(p.createdAt).toLocaleDateString()}</div></div>
        <span className={'chip ' + (p.status === 'active' ? 'ok' : '')}>{p.status}</span>
        {p.status === 'active' && <button className="btn sm" onClick={() => db.plans.update(p.id, { status: 'paused' })}>Pause</button>}
        {p.status === 'paused' && <button className="btn sm" onClick={async () => { for (const x of plans.filter(x => x.status === 'active')) await db.plans.update(x.id, { status: 'paused' }); await db.plans.update(p.id, { status: 'active' }); }}>Resume</button>}
        <button className="btn sm" onClick={() => setEditor(p)}>Duplicate / regenerate</button>
        {p.status !== 'archived' && <button className="btn sm" onClick={() => setArchive(p)}>Archive</button>}</div>)}</div>
        <p className="tiny muted">Schedules are never erased. Archived and paused plans keep all their tasks and history.</p></div>}

      <Modal open={recover} onClose={() => { setRecover(false); setParams({}); }} title="Daily recovery plan"><Recovery planId={active.id} s={s} onClose={() => { setRecover(false); setParams({}); }} /></Modal>
      <Confirm open={!!archive} onClose={() => setArchive(null)} title="Archive plan?" body="The plan and its task history are kept. It just stops being active." onConfirm={() => archive && db.plans.update(archive.id, { status: 'archived' })} />
    </div>
  );
}
