import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid, type StudySession } from '../db/schema';
import type { Settings } from '../data/settings';
import { useCatalog } from '../data/hooks';
import { updateProgressFields } from '../data/repo';
import { fmtDuration } from '../domain/calc';
import { Seg, Empty, Icon, useToast } from '../ui/components';

/** Timer state persists in localStorage so a reload or tab switch doesn't lose a running session. */
interface TState { running: boolean; startedAt: number | null; accumulated: number; category: StudySession['category']; videoId: string | null; }
const KEY = 'mt_timer';
const load = (): TState => { try { return JSON.parse(localStorage.getItem(KEY) || '') as TState; } catch { return { running: false, startedAt: null, accumulated: 0, category: 'lecture', videoId: null }; } };
const save = (t: TState) => { try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* ignore */ } };

export default function Timer({ s }: { s: Settings }) {
  const [params] = useSearchParams(); const c = useCatalog(); const toast = useToast();
  const [t, setT] = useState<TState>(() => { const x = load(); const v = params.get('video'); return v && !x.running && !x.accumulated ? { ...x, videoId: v, category: 'lecture' } : x; });
  const [, force] = useState(0); const [corr, setCorr] = useState(''); const [notes, setNotes] = useState('');
  const [manDate, setManDate] = useState(''); const [manMin, setManMin] = useState('');
  useEffect(() => { save(t); }, [t]);
  useEffect(() => { if (!t.running) return; const i = setInterval(() => force(n => n + 1), 500); return () => clearInterval(i); }, [t.running]);
  const recent = useLiveQuery(() => db.studySessions.orderBy('startTime').reverse().limit(15).toArray(), []);
  const elapsed = t.accumulated + (t.running && t.startedAt ? (Date.now() - t.startedAt) / 1000 : 0);
  const hh = Math.floor(elapsed / 3600), mm = Math.floor((elapsed % 3600) / 60), ss = Math.floor(elapsed % 60);
  async function stop() {
    let dur = Math.round(elapsed); if (corr.trim()) dur = Math.round(Number(corr) * 60);
    if (dur < 1) { setT({ ...t, running: false, startedAt: null, accumulated: 0 }); return; }
    const end = Date.now();
    await db.studySessions.add({ id: uid('ss_'), startTime: end - dur * 1000, endTime: end, durationSeconds: dur, category: t.category, linkedTaskId: null, videoId: t.videoId, notes, manual: !!corr.trim() });
    if (t.videoId) { const p = await db.progress.get(t.videoId); await updateProgressFields(t.videoId, { actualTimeSeconds: (p?.actualTimeSeconds ?? 0) + dur, status: p?.status === 'not_started' || !p ? 'in_progress' : p.status }); }
    setT({ running: false, startedAt: null, accumulated: 0, category: t.category, videoId: null }); setCorr(''); setNotes(''); toast(`Saved ${fmtDuration(dur)}`);
  }
  const video = t.videoId ? c?.videos.find(v => v.id === t.videoId) : null;
  return (
    <div className="stack">
      <h1>Study timer</h1>
      <div className="card stack" style={{ alignItems: 'center' }}>
        <Seg value={t.category} onChange={v => setT({ ...t, category: v })} options={[{ v: 'lecture', l: 'Lecture' }, { v: 'mcq', l: 'QBank' }, { v: 'revision', l: 'Revision' }, { v: 'other', l: 'Other' }]} />
        {video && <div className="small">Linked: <b>{video.title}</b> <button className="btn ghost sm" onClick={() => setT({ ...t, videoId: null })}><Icon name="x" size={14} /></button></div>}
        <div className="timer-face" aria-live="polite">{String(hh).padStart(2, '0')}:{String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}</div>
        <div className="row">
          {!t.running ? <button className="btn primary" onClick={() => setT({ ...t, running: true, startedAt: Date.now() })}>{t.accumulated ? 'Resume' : 'Start'}</button>
            : <button className="btn" onClick={() => setT({ ...t, running: false, startedAt: null, accumulated: elapsed })}>Pause</button>}
          <button className="btn" disabled={elapsed < 1} onClick={stop}>Stop & save</button>
          <button className="btn ghost" disabled={elapsed < 1} onClick={() => setT({ ...t, running: false, startedAt: null, accumulated: 0 })}>Discard</button>
        </div>
        <div className="row" style={{ width: '100%' }}><input type="number" min={0} placeholder="Correct total (min), optional" value={corr} onChange={e => setCorr(e.target.value)} style={{ flex: 1 }} aria-label="Manual correction minutes" /><input type="text" placeholder="Notes" value={notes} onChange={e => setNotes(e.target.value)} style={{ flex: 1 }} /></div>
      </div>
      <div className="card stack"><h3>Add a past session manually</h3>
        <div className="row"><input type="datetime-local" value={manDate} onChange={e => setManDate(e.target.value)} style={{ flex: 1 }} aria-label="Session start" /><input type="number" min={1} placeholder="Minutes" value={manMin} onChange={e => setManMin(e.target.value)} style={{ maxWidth: 120 }} />
          <button className="btn" disabled={!manDate || !(Number(manMin) > 0)} onClick={async () => { const st = new Date(manDate).getTime(); const d = Number(manMin) * 60; await db.studySessions.add({ id: uid('ss_'), startTime: st, endTime: st + d * 1000, durationSeconds: d, category: t.category, linkedTaskId: null, videoId: null, notes: 'manual entry', manual: true }); setManMin(''); toast('Added'); }}>Add</button></div></div>
      <div className="card"><h3 style={{ marginBottom: 6 }}>Recent sessions</h3>{recent?.length ? <div className="list">{recent.map(r => <div className="li small" key={r.id}><span className="grow">{new Date(r.startTime).toLocaleString()} · {r.category}{r.manual ? ' · manual' : ''}{r.notes && r.notes !== 'manual' && r.notes !== 'manual entry' ? ` · ${r.notes}` : ''}</span><b className="num">{fmtDuration(r.durationSeconds)}</b><button className="iconbtn" aria-label="Delete session" onClick={() => db.studySessions.delete(r.id)}><Icon name="x" size={14} /></button></div>)}</div> : <Empty title="No sessions yet" />}</div>
    </div>
  );
}
