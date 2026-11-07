import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid, SPEEDS, type Speed, type VideoStatus } from '../db/schema';
import type { Settings } from '../data/settings';
import { useCatalog, videoEstimate, STATUS_LABEL } from '../data/hooks';
import { setVideoStatus, setSpeedOverride, setIncluded, updateProgressFields, addToRevision } from '../data/repo';
import { fmtDuration, estimatedSeconds, timeSavedSeconds } from '../domain/calc';
import { Icon, Seg, Empty, useToast } from '../ui/components';

export default function LectureDetail({ s }: { s: Settings }) {
  const { videoId } = useParams(); const nav = useNavigate(); const c = useCatalog(); const toast = useToast();
  const history = useLiveQuery(() => db.audit.where('entityId').equals(videoId!).reverse().sortBy('at'), [videoId]);
  const revItems = useLiveQuery(() => db.revisionItems.where('videoId').equals(videoId!).toArray(), [videoId]);
  const [addMin, setAddMin] = useState('');
  const v = c?.videos.find(x => x.id === videoId);
  if (!c) return null; if (!v) return <Empty title="Lecture not found" />;
  const pr = c.progress.get(v.id); const sub = c.subjectMap.get(v.subjectId)!; const e = videoEstimate(c, v, s.globalSpeed);
  const st = pr?.status ?? 'not_started';
  return (
    <div className="stack">
      <div className="row"><button className="iconbtn" onClick={() => nav(-1)} aria-label="Back"><Icon name="back" /></button><Link to={`/lectures/${sub.id}`} className="small">{sub.name}</Link></div>
      <h1>{v.title}</h1>
      <div className="row small" style={{ gap: 6 }}><span className={'chip ' + v.moduleType}>{v.moduleType === 'MCQ' ? 'MCQ Discussion video' : v.moduleType}</span><span className="muted">Source: page {v.sourcePage}, order {v.sourceOrder} · {v.datasetVersion}</span></div>
      <div className="card stack">
        <div className="kpis">
          <div className="kpi"><div className="v">{fmtDuration(v.originalDurationSeconds, 'precise')}</div><div className="l">original @1x</div></div>
          <div className="kpi"><div className="v">{fmtDuration(e.seconds, 'precise')}</div><div className="l">estimated @ {e.speed}x</div></div>
          <div className="kpi"><div className="v">{fmtDuration(pr?.actualTimeSeconds ?? 0, 'precise')}</div><div className="l">actual time logged</div></div>
        </div>
        <div><div className="small muted" style={{ marginBottom: 6 }}>Speed for this lecture {pr?.speedOverride ? '(override)' : `(from ${sub.defaultSpeed ? 'subject' : 'global'} default)`}</div>
          <Seg value={(pr?.speedOverride ?? 0) as number} onChange={x => setSpeedOverride([v.id], x ? (x as Speed) : null, false)} options={[{ v: 0, l: 'Default' }, ...SPEEDS.map(x => ({ v: x as number, l: x + 'x' }))]} /></div>
        <table className="t"><thead><tr><th>Speed</th><th className="r">Time</th><th className="r">Saved</th></tr></thead><tbody>{SPEEDS.map(x => <tr key={x} style={{ fontWeight: x === e.speed ? 650 : 400 }}><td>{x.toFixed(1)}x</td><td className="r">{fmtDuration(estimatedSeconds(v.originalDurationSeconds, x), 'precise')}</td><td className="r">{fmtDuration(timeSavedSeconds(v.originalDurationSeconds, x), 'precise')}</td></tr>)}</tbody></table>
      </div>
      <div className="card stack">
        <div className="small muted">Status</div>
        <Seg value={st} onChange={x => setVideoStatus(v.id, x as VideoStatus)} options={Object.entries(STATUS_LABEL).map(([k, l]) => ({ v: k as VideoStatus, l }))} />
        {pr?.completedAt && <div className="small muted">Completed {new Date(pr.completedAt).toLocaleString()} at {pr.completedSpeed}x</div>}
        <label className="row small"><input type="checkbox" checked={v.includedInPlan} onChange={x => setIncluded([v.id], x.target.checked)} />Include in study plan (separate from completion)</label>
        <div className="row"><input type="number" min={0} placeholder="Minutes watched" value={addMin} onChange={x => setAddMin(x.target.value)} style={{ maxWidth: 160 }} aria-label="Minutes to add" />
          <button className="btn sm" disabled={!(Number(addMin) > 0)} onClick={async () => { const sec = Number(addMin) * 60; await updateProgressFields(v.id, { actualTimeSeconds: (pr?.actualTimeSeconds ?? 0) + sec });
            await db.studySessions.add({ id: uid('ss_'), startTime: Date.now() - sec * 1000, endTime: Date.now(), durationSeconds: sec, category: 'lecture', linkedTaskId: null, videoId: v.id, notes: 'manual', manual: true }); setAddMin(''); toast('Time logged'); }}>Add actual time</button>
          <Link className="btn sm" to={`/timer?video=${v.id}`}>Start timer</Link></div>
        <label className="field">Notes<textarea defaultValue={pr?.notes ?? ''} onBlur={x => updateProgressFields(v.id, { notes: x.target.value })} /></label>
        <label className="field">Your tags (comma separated, kept separate from source fields)<input type="text" defaultValue={v.tags.join(', ')} onBlur={x => db.videos.update(v.id, { tags: x.target.value.split(',').map(t => t.trim()).filter(Boolean) })} /></label>
        <div className="row small"><span className="muted">Exam relevance (your tag):</span>{(['NEET PG', 'INI-CET'] as const).map(t => <label key={t} className="row" style={{ gap: 4 }}><input type="checkbox" checked={v.examTags.includes(t)} onChange={x => db.videos.update(v.id, { examTags: x.target.checked ? [...v.examTags, t] : v.examTags.filter(y => y !== t) })} />{t}</label>)}</div>
      </div>
      <div className="card stack">
        <div className="card-h"><h3>Revision</h3>{!revItems?.length && <button className="btn sm" onClick={async () => { await addToRevision({ videoId: v.id, subjectId: v.subjectId }); toast(`Added: revisions on day ${s.revisionIntervals.join(', ')}`); }}>Add to revision plan</button>}</div>
        {revItems?.length ? <Link to="/revision" className="small">In your revision plan → view queue</Link> : <div className="small muted">Adding to revision doesn't change this lecture's completion record.</div>}
      </div>
      <details className="card"><summary>History ({history?.length ?? 0})</summary><div className="stack tiny">{history?.map(h => <div key={h.id}>{new Date(h.at).toLocaleString()} · {h.action} {h.before != null ? `(${JSON.stringify(h.before)} → ${JSON.stringify(h.after)})` : ''}</div>)}</div></details>
    </div>
  );
}
