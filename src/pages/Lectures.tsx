import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { Settings } from '../data/settings';
import { useCatalog, subjectWorkload, videoEstimate, STATUS_LABEL } from '../data/hooks';
import { fmtHours, fmtDuration, percent } from '../domain/calc';
import { Bar, Empty } from '../ui/components';
import { db } from '../db/schema';

export default function Lectures({ s }: { s: Settings }) {
  const c = useCatalog(); const [q, setQ] = useState(''); const [showHidden, setShowHidden] = useState(false);
  const hits = useMemo(() => {
    if (!c || q.trim().length < 2) return [];
    const n = q.toLowerCase(); return c.videos.filter(v => v.active && v.title.toLowerCase().includes(n)).slice(0, 60);
  }, [c, q]);
  if (!c) return null;
  if (!c.videos.length) return <div className="card"><Empty title="No catalogue imported"><Link className="btn primary" to="/settings#data">Import</Link></Empty></div>;
  const subs = c.subjects.filter(x => x.active && (showHidden || !x.hidden));
  return (
    <div className="stack">
      <div className="row between"><h1>Lectures</h1><label className="row small"><input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} />Show hidden</label></div>
      <input type="search" placeholder="Search all lecture titles…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search lectures" />
      {q.trim().length >= 2 ? <div className="card"><div className="small muted" style={{ marginBottom: 6 }}>{hits.length}{hits.length === 60 ? '+' : ''} results</div><div className="list">{hits.map(v => {
        const e = videoEstimate(c, v, s.globalSpeed); const st = c.progress.get(v.id)?.status ?? 'not_started';
        return <Link key={v.id} to={`/video/${v.id}`} className="li" style={{ textDecoration: 'none', color: 'inherit' }}><div className="grow"><div className="title">{v.title}</div><div className="small muted row" style={{ gap: 6 }}><span className={'chip ' + v.moduleType}>{v.moduleType}</span>{c.subjectMap.get(v.subjectId)?.name} · {fmtDuration(e.seconds)} @ {e.speed}x · {STATUS_LABEL[st]}</div></div></Link>; })}</div></div> :
      <div className="grid">{subs.map(sub => {
        const w = subjectWorkload(c, sub.id, s.globalSpeed); const p = percent(w.completed, w.included);
        const mods = (['Main', 'Revision', 'MCQ'] as const).map(m => c.videos.filter(v => v.active && v.subjectId === sub.id && v.moduleType === m).length);
        return <Link key={sub.id} to={`/lectures/${sub.id}`} className="card" style={{ textDecoration: 'none', color: 'inherit', opacity: sub.hidden ? .6 : 1 }}>
          <div className="card-h"><h3>{sub.name}</h3><span className="small muted num">{sub.priority ? `P${sub.priority}` : ''}</span></div>
          {sub.coverageStatus === 'no_records_in_source' ? <div className="banner warn small">No catalogue records for this subject. Coverage unknown.</div> : <>
            <div className="row between small" style={{ marginBottom: 6 }}><span className="muted">{w.completed}/{w.included} done</span><span className="num">{p == null ? 'No videos selected' : p.toFixed(0) + '%'}</span></div>
            <Bar pct={p} />
            <div className="row small muted" style={{ marginTop: 8, gap: 6 }}><span className="chip Main">{mods[0]} Main</span><span className="chip Revision">{mods[1]} Rev</span><span className="chip MCQ">{mods[2]} MCQ</span></div>
            <div className="small muted" style={{ marginTop: 6 }}>{fmtHours(w.remainingEstimatedSeconds)} left @ speed · {fmtHours(w.catalogueSeconds)} total @1x</div></>}
        </Link>; })}</div>}
      <details className="card"><summary>Manage subjects (rename, reorder, hide, archive)</summary><SubjectManager /></details>
    </div>
  );
}

function SubjectManager() {
  const c = useCatalog(); if (!c) return null;
  const subs = c.subjects;
  const swap = async (i: number, j: number) => { if (j < 0 || j >= subs.length) return; await db.transaction('rw', db.subjects, async () => { await db.subjects.update(subs[i].id, { sortOrder: subs[j].sortOrder }); await db.subjects.update(subs[j].id, { sortOrder: subs[i].sortOrder }); }); };
  return <div className="list">{subs.map((x, i) => <div className="li small" key={x.id} style={{ minHeight: 44, padding: '6px 2px' }}>
    <input type="text" aria-label={'Name for ' + x.sourceName} defaultValue={x.name} onBlur={e => e.target.value.trim() && db.subjects.update(x.id, { name: e.target.value.trim(), updatedAt: Date.now() })} style={{ maxWidth: 220, minHeight: 34 }} />
    <span className="tiny muted grow">source: {x.sourceName}</span>
    <button className="btn sm" aria-label="Move up" onClick={() => swap(i, i - 1)}>↑</button><button className="btn sm" aria-label="Move down" onClick={() => swap(i, i + 1)}>↓</button>
    <label className="row tiny" style={{ gap: 3 }}><input type="checkbox" checked={x.hidden} onChange={e => db.subjects.update(x.id, { hidden: e.target.checked })} />hide</label>
    <label className="row tiny" style={{ gap: 3 }}><input type="checkbox" checked={!x.active} onChange={e => db.subjects.update(x.id, { active: !e.target.checked })} />archive</label>
  </div>)}<p className="tiny muted">Hiding or archiving never deletes records or progress.</p></div>;
}
