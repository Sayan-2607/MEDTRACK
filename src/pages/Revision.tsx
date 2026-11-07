import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type RevisionEvent } from '../db/schema';
import type { Settings } from '../data/settings';
import { useCatalog } from '../data/hooks';
import { addToRevision, setRevisionIntervals } from '../data/repo';
import { revisionStats } from '../domain/analytics';
import { today, fmtDate } from '../domain/dates';
import { Modal, Empty, Seg, useToast } from '../ui/components';

export default function Revision({ s }: { s: Settings }) {
  const c = useCatalog(); const toast = useToast();
  const events = useLiveQuery(() => db.revisionEvents.toArray(), []);
  const items = useLiveQuery(() => db.revisionItems.toArray(), []);
  const [tab, setTab] = useState<'today' | 'overdue' | 'upcoming' | 'done'>('today');
  const [doneEv, setDoneEv] = useState<RevisionEvent | null>(null); const [conf, setConf] = useState(3); const [notes, setNotes] = useState('');
  const [topic, setTopic] = useState(''); const [topicSub, setTopicSub] = useState('');
  const [edit, setEdit] = useState<string | null>(null); const [iv, setIv] = useState('');
  if (!c || !events || !items) return null;
  const st = revisionStats(events, today()); const im = new Map(items.map(i => [i.id, i]));
  const label = (e: RevisionEvent) => { const it = im.get(e.itemId); const v = it?.videoId ? c.videos.find(x => x.id === it.videoId) : null; return { it, v, title: v?.title ?? it?.topic ?? '—' }; };
  const list = tab === 'today' ? st.today : tab === 'overdue' ? st.overdue : tab === 'upcoming' ? st.upcoming.slice(0, 100) : events.filter(e => e.status === 'done').sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)).slice(0, 100);
  return (
    <div className="stack">
      <h1>Revision queue</h1>
      <div className="kpis"><div className="kpi"><div className="v">{st.today.length}</div><div className="l">due today</div></div><div className="kpi"><div className="v" style={{ color: st.overdue.length ? 'var(--warn)' : undefined }}>{st.overdue.length}</div><div className="l">overdue</div></div><div className="kpi"><div className="v">{st.upcoming.length}</div><div className="l">upcoming</div></div><div className="kpi"><div className="v">{items.filter(i => i.active).length}</div><div className="l">items in plan</div></div></div>
      <Seg value={tab} onChange={setTab} options={[{ v: 'today', l: 'Today' }, { v: 'overdue', l: 'Overdue' }, { v: 'upcoming', l: 'Upcoming' }, { v: 'done', l: 'Done' }]} />
      <div className="card">{list.length ? <div className="list">{list.map(e => { const { it, v, title } = label(e);
        return <div key={e.id} className="li"><div className="grow"><div className="title">{v ? <Link className="title" to={`/video/${v.id}`}>{title}</Link> : title}</div>
          <div className="small muted">Cycle {e.cycle} (day {e.intervalDays}) · due {fmtDate(e.dueDate, s.dateFormat)}{e.confidence ? ` · confidence ${e.confidence}/5` : ''}{it?.subjectId ? ` · ${c.subjectMap.get(it.subjectId)?.name}` : ''}</div></div>
          {e.status === 'due' ? <><button className="btn sm primary" onClick={() => { setDoneEv(e); setConf(3); setNotes(''); }}>Done</button><button className="btn sm" onClick={() => db.revisionEvents.update(e.id, { status: 'skipped' })}>Skip</button></>
            : <button className="btn sm" onClick={() => db.revisionEvents.update(e.id, { status: 'due', completedAt: null })}>Undo</button>}
          {it && <button className="btn sm ghost" onClick={() => { setEdit(it.id); setIv((it.intervals ?? s.revisionIntervals).join(', ')); }}>Intervals</button>}
        </div>; })}</div> : <Empty title={tab === 'today' ? 'Nothing due today' : 'Nothing here'}>Add lectures from their detail page, or add a topic below. A revision is never marked complete just because the lecture is.</Empty>}</div>
      <div className="card stack"><h3>Add a topic to revise</h3>
        <div className="row"><input type="text" placeholder="Topic, e.g. Glaucoma" value={topic} onChange={e => setTopic(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
          <select value={topicSub} onChange={e => setTopicSub(e.target.value)} style={{ width: 'auto' }}><option value="">Subject…</option>{c.subjects.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          <button className="btn primary" disabled={!topic.trim()} onClick={async () => { await addToRevision({ topic: topic.trim(), subjectId: topicSub || null }); setTopic(''); toast('Topic added'); }}>Add</button></div>
        <div className="tiny muted">Default intervals: day {s.revisionIntervals.join(', ')} (change them in Settings → Revision).</div></div>
      <Modal open={!!doneEv} onClose={() => setDoneEv(null)} title="Complete revision">
        <div className="stack"><div className="small muted">Confidence (optional)</div><Seg value={conf} onChange={setConf} options={[1, 2, 3, 4, 5].map(n => ({ v: n, l: String(n) }))} />
          <label className="field">Notes<textarea value={notes} onChange={e => setNotes(e.target.value)} /></label>
          <button className="btn primary" onClick={async () => { await db.revisionEvents.update(doneEv!.id, { status: 'done', completedAt: Date.now(), confidence: conf, notes }); const tasks = await db.tasks.where('revisionEventId').equals(doneEv!.id).toArray(); for (const t of tasks) await db.tasks.update(t.id, { status: 'done' }); setDoneEv(null); }}>Mark done</button></div>
      </Modal>
      <Modal open={!!edit} onClose={() => setEdit(null)} title="Intervals for this item">
        <div className="stack"><label className="field">Days after adding (comma separated)<input type="text" value={iv} onChange={e => setIv(e.target.value)} /></label>
          <button className="btn primary" onClick={async () => { const arr = iv.split(',').map(x => parseInt(x.trim())).filter(x => x >= 0).sort((a, b) => a - b); if (arr.length) await setRevisionIntervals(edit!, arr); setEdit(null); }}>Save</button>
          <p className="tiny muted">Pending cycles are recalculated. Completed cycles are kept.</p></div>
      </Modal>
    </div>
  );
}
