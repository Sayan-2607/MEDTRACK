import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid, type McqSession } from '../db/schema';
import type { Settings } from '../data/settings';
import { useCatalog } from '../data/hooks';
import { validateMcq, accuracy, fmtDuration } from '../domain/calc';
import { today, fmtDate } from '../domain/dates';
import { Modal, Empty, Bar, Icon, Confirm, useToast } from '../ui/components';
import { addToRevision } from '../data/repo';
import { parseCSV } from '../domain/importer';

const blank = (): Omit<McqSession, 'id' | 'createdAt'> => ({ subjectId: null, topic: '', source: 'Marrow QBank', sessionDate: today(), totalQuestions: 0, attempted: 0, correct: 0, incorrect: 0, skipped: 0, durationSeconds: 0, notes: '', completed: true, flagged: false, mistakes: '', markForRevision: false, origin: 'user' });

export default function Mcq({ s }: { s: Settings }) {
  const c = useCatalog(); const toast = useToast();
  const sessions = useLiveQuery(() => db.mcqSessions.orderBy('sessionDate').reverse().toArray(), []);
  const targets = useLiveQuery(() => db.mcqTargets.toArray(), []);
  const [form, setForm] = useState<ReturnType<typeof blank> & { id?: string } | null>(null);
  const [mins, setMins] = useState('');
  const [tForm, setTForm] = useState(false); const [tTopic, setTTopic] = useState(''); const [tSub, setTSub] = useState(''); const [tN, setTN] = useState(''); const [tDaily, setTDaily] = useState('');
  const [del, setDel] = useState<string | null>(null);
  const [sub, setSub] = useState('');
  if (!c || !sessions || !targets) return null;
  const list = sub ? sessions.filter(x => x.subjectId === sub) : sessions;
  const att = list.reduce((a, x) => a + x.attempted, 0), cor = list.reduce((a, x) => a + x.correct, 0);
  const acc = accuracy(cor, att);
  const todayAtt = sessions.filter(x => x.sessionDate === today()).reduce((a, x) => a + x.attempted, 0);
  const dailyTarget = targets.reduce((a, t) => a + (t.dailyTarget ?? 0), 0);
  const errs = form ? validateMcq(form) : [];
  const subName = (id: string | null) => (id ? c.subjectMap.get(id)?.name : 'General') ?? '—';

  async function save() {
    if (!form || errs.length) return;
    const rec: McqSession = { ...form, id: form.id ?? uid('mcq_'), durationSeconds: Math.round(Number(mins || 0) * 60), createdAt: Date.now() };
    await db.mcqSessions.put(rec);
    if (rec.markForRevision && rec.topic && !form.id) await addToRevision({ topic: rec.topic, subjectId: rec.subjectId });
    toast('Session saved'); setForm(null);
  }
  async function importCsv(f: File) {
    const rows = parseCSV(await f.text()); const h = rows[0].map(x => x.trim().toLowerCase());
    const g = (r: string[], k: string) => r[h.indexOf(k)] ?? '';
    const recs: McqSession[] = []; const bad: number[] = [];
    rows.slice(1).forEach((r, i) => {
      const subj = c!.subjects.find(x => x.name.toLowerCase() === g(r, 'subject').toLowerCase() || x.sourceName.toLowerCase() === g(r, 'subject').toLowerCase());
      const m = { totalQuestions: +g(r, 'total'), attempted: +g(r, 'attempted'), correct: +g(r, 'correct'), incorrect: +g(r, 'incorrect'), skipped: +g(r, 'skipped') || 0 };
      if (validateMcq(m).length) { bad.push(i + 2); return; }
      recs.push({ ...blank(), ...m, id: uid('mcq_'), subjectId: subj?.id ?? null, topic: g(r, 'topic'), source: g(r, 'source') || 'Imported', sessionDate: g(r, 'date') || today(), durationSeconds: (+g(r, 'minutes') || 0) * 60, origin: 'import', createdAt: Date.now() });
    });
    await db.mcqSessions.bulkAdd(recs); toast(`Imported ${recs.length} sessions${bad.length ? `, skipped invalid rows ${bad.join(', ')}` : ''}`);
  }
  const num = (k: keyof McqSession) => <label className="field">{k === 'totalQuestions' ? 'Total questions' : k[0].toUpperCase() + k.slice(1)}<input type="number" min={0} inputMode="numeric" value={(form as any)[k]} onChange={e => setForm({ ...form!, [k]: Math.max(0, Math.round(Number(e.target.value))) })} /></label>;

  return (
    <div className="stack">
      <div className="row between"><h1>QBank / MCQs</h1><button className="btn primary" onClick={() => { setForm(blank()); setMins(''); }}>Log session</button></div>
      <div className="banner info small">QBank practice is tracked separately from MCQ Discussion videos (those live under Lectures). The Crambook PDF has no QBank question counts, so totals here come only from what you enter or import.</div>
      <div className="card">
        <div className="row between"><select value={sub} onChange={e => setSub(e.target.value)} style={{ width: 'auto' }} aria-label="Filter by subject"><option value="">All subjects</option>{c.subjects.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
        <div className="kpis" style={{ marginTop: 10 }}>
          <div className="kpi"><div className="v">{list.length}</div><div className="l">sessions</div></div>
          <div className="kpi"><div className="v">{att}</div><div className="l">attempted</div></div>
          <div className="kpi"><div className="v">{acc == null ? '—' : acc.toFixed(1) + '%'}</div><div className="l">{acc == null ? 'No attempts yet' : 'accuracy (correct ÷ attempted)'}</div></div>
          <div className="kpi"><div className="v">{todayAtt}{dailyTarget ? `/${dailyTarget}` : ''}</div><div className="l">today{dailyTarget ? ' vs daily target' : ''}</div></div>
        </div>
      </div>
      <div className="card">
        <div className="card-h"><h3>Targets</h3><button className="btn sm" onClick={() => setTForm(true)}>Add target</button></div>
        {targets.length ? <div className="stack">{targets.map(t => { const done = sessions.filter(x => (!t.subjectId || x.subjectId === t.subjectId) && (!t.topic || x.topic.toLowerCase() === t.topic.toLowerCase())).reduce((a, x) => a + x.attempted, 0);
          return <div key={t.id}><div className="row between small"><span>{subName(t.subjectId)}{t.topic ? ` · ${t.topic}` : ''}</span><span className="num">{done}/{t.targetQuestions} ({((done / t.targetQuestions) * 100).toFixed(0)}%) <button className="btn ghost sm" onClick={() => db.mcqTargets.delete(t.id)} aria-label="Delete target"><Icon name="x" size={14} /></button></span></div><Bar pct={(done / t.targetQuestions) * 100} /></div>; })}</div>
          : <div className="small muted">No targets set. Completion percentages show up once you enter a known question count.</div>}
      </div>
      <div className="card">
        <div className="card-h"><h3>Sessions</h3><label className="btn sm">Import CSV<input type="file" accept=".csv" hidden onChange={e => e.target.files?.[0] && importCsv(e.target.files[0])} /></label></div>
        <p className="tiny muted" style={{ marginTop: -4 }}>CSV columns: date, subject, topic, source, total, attempted, correct, incorrect, skipped, minutes</p>
        {list.length ? <div className="list">{list.map(x => { const a = accuracy(x.correct, x.attempted);
          return <div className="li" key={x.id}><div className="grow"><div className="title">{x.topic || subName(x.subjectId)} {x.flagged && <span className="chip warn">difficult</span>} {x.origin === 'import' && <span className="chip">imported</span>}</div>
            <div className="small muted">{fmtDate(x.sessionDate, s.dateFormat)} · {subName(x.subjectId)} · {x.source} · {x.attempted}/{x.totalQuestions} attempted · {a == null ? 'no attempts' : a.toFixed(0) + '%'}{x.durationSeconds ? ` · ${fmtDuration(x.durationSeconds)}` : ''}</div>
            {x.mistakes && <div className="small" style={{ marginTop: 2 }}>Mistakes: {x.mistakes}</div>}</div>
            <button className="btn sm" onClick={() => { setForm({ ...x }); setMins(String(x.durationSeconds / 60)); }}>Edit</button><button className="iconbtn" aria-label="Delete" onClick={() => setDel(x.id)}><Icon name="x" size={16} /></button></div>; })}</div>
          : <Empty title="No sessions logged">Log your first QBank session to track accuracy and weak topics.</Empty>}
      </div>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Edit session' : 'Log QBank session'}>
        {form && <div className="stack">
          <div className="grid-2">
            <label className="field">Date<input type="date" value={form.sessionDate} onChange={e => setForm({ ...form, sessionDate: e.target.value })} /></label>
            <label className="field">Subject<select value={form.subjectId ?? ''} onChange={e => setForm({ ...form, subjectId: e.target.value || null })}><option value="">General / mixed</option>{c.subjects.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <label className="field">Topic<input type="text" value={form.topic} onChange={e => setForm({ ...form, topic: e.target.value })} /></label>
            <label className="field">Source<input type="text" value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} /></label>
            {num('totalQuestions')}{num('attempted')}{num('correct')}{num('incorrect')}{num('skipped')}
            <label className="field">Time spent (min)<input type="number" min={0} value={mins} onChange={e => setMins(e.target.value)} /></label>
          </div>
          <div className="tiny muted">Attempted = correct + incorrect. Skipped questions aren't counted as attempted, and attempted + skipped can't exceed the total.</div>
          {errs.map(e => <div key={e} className="banner bad small">{e}</div>)}
          {!errs.length && form.attempted > 0 && <div className="small">Accuracy: <b>{accuracy(form.correct, form.attempted)!.toFixed(1)}%</b></div>}
          <label className="field">Recurring mistakes / notes on errors<textarea value={form.mistakes} onChange={e => setForm({ ...form, mistakes: e.target.value })} /></label>
          <label className="field">Notes<textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label>
          <div className="row small"><label className="row"><input type="checkbox" checked={form.completed} onChange={e => setForm({ ...form, completed: e.target.checked })} />Session complete</label>
            <label className="row"><input type="checkbox" checked={form.flagged} onChange={e => setForm({ ...form, flagged: e.target.checked })} />Flag as difficult</label>
            <label className="row"><input type="checkbox" checked={form.markForRevision} onChange={e => setForm({ ...form, markForRevision: e.target.checked })} />Mark topic for revision</label></div>
          <div className="row"><button className="btn" onClick={() => setForm(null)}>Cancel</button><button className="btn primary" disabled={errs.length > 0} onClick={save}>Save</button></div>
        </div>}
      </Modal>
      <Modal open={tForm} onClose={() => setTForm(false)} title="QBank target">
        <div className="stack">
          <label className="field">Subject<select value={tSub} onChange={e => setTSub(e.target.value)}><option value="">All / general</option>{c.subjects.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label className="field">Topic (optional)<input type="text" value={tTopic} onChange={e => setTTopic(e.target.value)} /></label>
          <label className="field">Known total questions<input type="number" min={1} value={tN} onChange={e => setTN(e.target.value)} /></label>
          <label className="field">Daily target (optional)<input type="number" min={0} value={tDaily} onChange={e => setTDaily(e.target.value)} /></label>
          <button className="btn primary" disabled={!(Number(tN) > 0)} onClick={async () => { await db.mcqTargets.add({ id: uid('mt_'), subjectId: tSub || null, topic: tTopic, targetQuestions: Number(tN), dailyTarget: tDaily ? Number(tDaily) : null }); setTForm(false); setTN(''); setTTopic(''); setTDaily(''); }}>Save target</button>
        </div>
      </Modal>
      <Confirm open={!!del} onClose={() => setDel(null)} danger title="Delete session?" body="This permanently removes the logged session." confirmLabel="Delete" onConfirm={() => del && db.mcqSessions.delete(del)} />
    </div>
  );
}
