import { useMemo, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { db, SPEEDS, type Speed, type VideoStatus } from '../db/schema';
import type { Settings } from '../data/settings';
import { useCatalog, subjectWorkload, videoEstimate, STATUS_LABEL } from '../data/hooks';
import { setVideoStatus, setIncluded, setSpeedOverride } from '../data/repo';
import { fmtDuration, fmtHours, percent } from '../domain/calc';
import { Icon, Seg, Modal, Bar, Empty, useToast } from '../ui/components';

const NEXT: Record<VideoStatus, VideoStatus> = { not_started: 'completed', in_progress: 'completed', completed: 'not_started', skipped: 'not_started', revisit: 'completed' };

export default function SubjectDetail({ s }: { s: Settings }) {
  const { subjectId } = useParams(); const nav = useNavigate(); const c = useCatalog(); const toast = useToast();
  const [mod, setMod] = useState<'all' | 'Main' | 'Revision' | 'MCQ'>('all');
  const [status, setStatus] = useState<'all' | VideoStatus | 'excluded'>('all');
  const [q, setQ] = useState(''); const [sort, setSort] = useState<'source' | 'title' | 'duration'>('source');
  const [sel, setSel] = useState<Set<string>>(new Set()); const [bulk, setBulk] = useState(false);
  const [bulkSpeed, setBulkSpeed] = useState<Speed | 0>(0); const [preserve, setPreserve] = useState(true);
  const sub = c?.subjectMap.get(subjectId!);
  const list = useMemo(() => {
    if (!c) return [];
    let l = c.videos.filter(v => v.subjectId === subjectId && v.active);
    if (mod !== 'all') l = l.filter(v => v.moduleType === mod);
    if (status === 'excluded') l = l.filter(v => !v.includedInPlan); else if (status !== 'all') l = l.filter(v => (c.progress.get(v.id)?.status ?? 'not_started') === status);
    if (q) l = l.filter(v => v.title.toLowerCase().includes(q.toLowerCase()));
    const mr = { Main: 0, Revision: 1, MCQ: 2 };
    return l.sort(sort === 'title' ? (a, b) => a.title.localeCompare(b.title) : sort === 'duration' ? (a, b) => b.originalDurationSeconds - a.originalDurationSeconds : (a, b) => (a.manualOrder ?? Infinity) - (b.manualOrder ?? Infinity) || mr[a.moduleType] - mr[b.moduleType] || a.sourceOrder - b.sourceOrder);
  }, [c, subjectId, mod, status, q, sort]);
  if (!c) return null;
  if (!sub) return <Empty title="Subject not found" />;
  const w = subjectWorkload(c, sub.id, s.globalSpeed); const p = percent(w.completed, w.included);
  const ids = [...sel];
  return (
    <div className="stack">
      <div className="row"><button className="iconbtn" onClick={() => nav('/lectures')} aria-label="Back"><Icon name="back" /></button><h1 className="grow">{sub.name}</h1></div>
      <div className="card">
        <div className="row between small"><span>{w.completed}/{w.included} included videos complete</span><b className="num">{p == null ? 'No videos selected' : p.toFixed(1) + '%'}</b></div>
        <Bar pct={p} />
        <div className="kpis" style={{ marginTop: 10 }}>
          <div className="kpi"><div className="v">{fmtHours(w.catalogueSeconds)}</div><div className="l">catalogue @1x</div></div>
          <div className="kpi"><div className="v">{fmtHours(w.remainingEstimatedSeconds)}</div><div className="l">remaining @ speed</div></div>
          <div className="kpi"><div className="v">{fmtHours(w.savedSeconds)}</div><div className="l">saved by speed</div></div>
        </div>
        <div className="row small" style={{ marginTop: 10 }}><span className="muted">Subject default speed:</span>
          <Seg value={(sub.defaultSpeed ?? 0) as number} onChange={v => db.subjects.update(sub.id, { defaultSpeed: v ? (v as Speed) : null })} options={[{ v: 0, l: `Global (${s.globalSpeed}x)` }, ...SPEEDS.map(x => ({ v: x as number, l: x + 'x' }))]} /></div>
      </div>
      <div className="row"><input type="search" className="grow" placeholder="Search in subject" value={q} onChange={e => setQ(e.target.value)} style={{ flex: 1, minWidth: 160 }} aria-label="Search in subject" />
        <select value={status} onChange={e => setStatus(e.target.value as any)} style={{ width: 'auto' }} aria-label="Status filter"><option value="all">All statuses</option>{Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}<option value="excluded">Excluded from plan</option></select>
        <select value={sort} onChange={e => setSort(e.target.value as any)} style={{ width: 'auto' }} aria-label="Sort"><option value="source">Source order</option><option value="title">Title</option><option value="duration">Longest first</option></select></div>
      <Seg value={mod} onChange={setMod} options={[{ v: 'all', l: 'All' }, { v: 'Main', l: 'Main' }, { v: 'Revision', l: 'Revision' }, { v: 'MCQ', l: 'MCQ Discussion' }]} label="Module" />
      <div className="card">
        <div className="row between small" style={{ marginBottom: 4 }}><label className="row"><input type="checkbox" checked={sel.size > 0 && sel.size === list.length} onChange={e => setSel(e.target.checked ? new Set(list.map(v => v.id)) : new Set())} />Select all ({list.length})</label>{sel.size > 0 && <span>{sel.size} selected</span>}</div>
        {list.length ? <div className="list">{list.map(v => {
          const pr = c.progress.get(v.id); const st = pr?.status ?? 'not_started'; const e = videoEstimate(c, v, s.globalSpeed);
          return <div className="li" key={v.id} style={{ opacity: v.includedInPlan ? 1 : .55 }}>
            <input type="checkbox" aria-label={'Select ' + v.title} checked={sel.has(v.id)} onChange={ev => { const n = new Set(sel); ev.target.checked ? n.add(v.id) : n.delete(v.id); setSel(n); }} />
            <button className={'status-btn ' + st} title={STATUS_LABEL[st]} aria-label={`${STATUS_LABEL[st]}: tap to ${st === 'completed' ? 'undo' : 'complete'}`} onClick={() => setVideoStatus(v.id, NEXT[st])}>{st === 'completed' && <Icon name="check" size={16} />}{st === 'skipped' && <Icon name="skip" size={12} />}{st === 'revisit' && <Icon name="flag" size={12} />}{st === 'in_progress' && <Icon name="dots" size={12} />}</button>
            <Link to={`/video/${v.id}`} className="grow" style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="title">{v.title}</div>
              <div className="small muted row" style={{ gap: 6 }}><span className={'chip ' + v.moduleType}>{v.moduleType}</span>
                <span className="num">{fmtDuration(v.originalDurationSeconds)} @1x → {fmtDuration(e.seconds)} @ {e.speed}x{pr?.speedOverride ? '*' : ''}</span>
                {!v.includedInPlan && <span className="chip">excluded</span>}</div>
            </Link>
          </div>; })}</div> : <Empty title="No lectures match these filters" />}
      </div>
      {sel.size > 0 && <div className="sticky-actions row">
        <button className="btn sm" onClick={async () => { for (const id of ids) await setVideoStatus(id, 'completed'); toast(`${ids.length} marked complete`); setSel(new Set()); }}>Complete</button>
        <button className="btn sm" onClick={async () => { for (const id of ids) await setVideoStatus(id, 'not_started'); setSel(new Set()); }}>Reset</button>
        <button className="btn sm" onClick={async () => { await setIncluded(ids, true); setSel(new Set()); }}>Include</button>
        <button className="btn sm" onClick={async () => { await setIncluded(ids, false); setSel(new Set()); }}>Exclude</button>
        <button className="btn sm primary" onClick={() => setBulk(true)}>Speed…</button>
      </div>}
      <Modal open={bulk} onClose={() => setBulk(false)} title={`Set speed for ${sel.size} lectures`}>
        <div className="stack">
          <Seg value={bulkSpeed as number} onChange={v => setBulkSpeed(v as any)} options={[{ v: 0, l: 'Clear override' }, ...SPEEDS.map(x => ({ v: x as number, l: x + 'x' }))]} />
          <label className="row small"><input type="checkbox" checked={preserve} onChange={e => setPreserve(e.target.checked)} />Keep lectures that already have their own speed override</label>
          {(() => { const vids = c.videos.filter(v => sel.has(v.id)); const before = vids.reduce((a, v) => a + videoEstimate(c, v, s.globalSpeed).seconds, 0);
            const after = vids.reduce((a, v) => { const pr = c.progress.get(v.id); const sp = bulkSpeed === 0 ? (sub.defaultSpeed ?? s.globalSpeed) : preserve && pr?.speedOverride ? pr.speedOverride : bulkSpeed; return a + v.originalDurationSeconds / sp; }, 0);
            return <div className="small">Estimated time: <b>{fmtHours(before)}</b> → <b>{fmtHours(after)}</b></div>; })()}
          <div className="row"><button className="btn" onClick={() => setBulk(false)}>Cancel</button><button className="btn primary" onClick={async () => { await setSpeedOverride(ids, bulkSpeed === 0 ? null : bulkSpeed, preserve); setBulk(false); setSel(new Set()); toast('Speeds updated. Estimates recalculated.'); }}>Apply</button></div>
          <p className="tiny muted">Existing schedules keep their planned times until you regenerate the plan or run the recovery plan.</p>
        </div>
      </Modal>
    </div>
  );
}
