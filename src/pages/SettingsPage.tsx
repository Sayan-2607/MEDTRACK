import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, SPEEDS, SCHEMA_VERSION, type Speed } from '../db/schema';
import { patchSettings, restoreDefaultSettings, DEFAULT_WIDGETS, type Settings } from '../data/settings';
import { wipeAllData } from '../data/repo';
import { WEEKDAYS } from '../domain/dates';
import { requestPermission, tick } from '../notify';
import { buildArchive, download } from '../backup/archive';
import { ImportWizard } from './ImportWizard';
import { Seg, Confirm, Modal, useToast } from '../ui/components';

const W_LABEL: Record<string, string> = { countdown: 'Exam countdown', today: "Today's plan", progress: 'Lecture progress', modules: 'By content type', debt: 'Preparation debt', revision: 'Revisions', readiness: 'Readiness index', weekly: 'Weekly hours', subjects: 'Subjects', health: 'Data health' };
const PRESETS = [{ n: 'Teal', a: '#0f766e' }, { n: 'Indigo', a: '#4f46e5' }, { n: 'Crimson', a: '#be123c' }, { n: 'Amber', a: '#b45309' }, { n: 'Slate', a: '#334155' }, { n: 'Violet', a: '#7c3aed' }];

function Sec({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section id={id} className="card stack"><h2>{title}</h2>{children}</section>;
}
function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <div className="row between" style={{ alignItems: 'flex-start' }}><div style={{ minWidth: 160, flex: '1 1 160px' }}><div className="small">{label}</div>{hint && <div className="tiny muted">{hint}</div>}</div><div style={{ flex: '2 1 240px' }}>{children}</div></div>;
}

export default function SettingsPage({ s }: { s: Settings }) {
  const toast = useToast(); const loc = useLocation();
  const exams = useLiveQuery(() => db.examTargets.toArray(), []);
  const batches = useLiveQuery(() => db.importBatches.orderBy('importedAt').reverse().toArray(), []);
  const issues = useLiveQuery(() => db.importIssues.toArray(), []);
  const counts = useLiveQuery(async () => Object.fromEntries(await Promise.all(db.tables.map(async t => [t.name, await t.count()] as const))), []);
  const [confirm, setConfirm] = useState<null | 'settings' | 'progress' | 'all'>(null);
  const [imp, setImp] = useState(false); const [ivText, setIvText] = useState(s.revisionIntervals.join(', '));
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied');
  useEffect(() => { if (loc.hash) setTimeout(() => document.getElementById(loc.hash.slice(1))?.scrollIntoView({ behavior: s.reduceMotion ? 'auto' : 'smooth' }), 50); }, [loc.hash]);
  const set = (p: Partial<Settings>) => patchSettings(p);
  const n = s.notif; const setN = (p: Partial<Settings['notif']>) => set({ notif: { ...n, ...p } });
  const moveW = (i: number, d: number) => { const w = [...s.dashboardWidgets]; const j = i + d; if (j < 0 || j >= w.length) return; [w[i], w[j]] = [w[j], w[i]]; set({ dashboardWidgets: w }); };
  const exam = (k: 'NEET PG' | 'INI-CET') => exams?.find(e => e.examType === k);
  return (
    <div className="stack">
      <h1>Settings</h1>
      <nav className="row small">{[['appearance', 'Appearance'], ['dashboard', 'Dashboard'], ['study', 'Study'], ['revision', 'Revision'], ['notifications', 'Notifications'], ['data', 'Data'], ['advanced', 'Advanced'], ['privacy', 'Privacy']].map(([id, l]) => <a key={id} href={'#' + id} className="chip">{l}</a>)}</nav>

      <Sec id="appearance" title="Appearance">
        <Row label="Theme"><Seg value={s.theme} onChange={v => set({ theme: v })} options={[{ v: 'system', l: 'System' }, { v: 'light', l: 'Light' }, { v: 'dark', l: 'Dark' }]} /></Row>
        <Row label="Accent colour"><div className="row">{PRESETS.map(p => <button key={p.a} aria-label={p.n} title={p.n} onClick={() => set({ accent: p.a })} style={{ width: 32, height: 32, borderRadius: 16, background: p.a, border: s.accent === p.a ? '3px solid var(--text)' : '2px solid var(--line)', cursor: 'pointer' }} />)}<input type="color" aria-label="Custom accent" value={s.accent} onChange={e => set({ accent: e.target.value })} style={{ width: 40, height: 32, border: 'none', background: 'none' }} /></div></Row>
        <Row label="Surface tint"><Seg value={s.surfaceTint} onChange={v => set({ surfaceTint: v })} options={[{ v: 'neutral', l: 'Neutral' }, { v: 'warm', l: 'Warm' }, { v: 'cool', l: 'Cool' }]} /></Row>
        <Row label="Font"><Seg value={s.fontFamily} onChange={v => set({ fontFamily: v })} options={[{ v: 'system', l: 'System' }, { v: 'rounded', l: 'Rounded' }, { v: 'serif', l: 'Serif' }, { v: 'mono', l: 'Mono' }]} /></Row>
        <Row label={`Font size (${Math.round(s.fontScale * 100)}%)`} hint="Your browser's text-size setting still applies on top"><input type="range" min={0.85} max={1.4} step={0.05} value={s.fontScale} onChange={e => set({ fontScale: Number(e.target.value) })} /></Row>
        <Row label="Font weight"><Seg value={s.fontWeight} onChange={v => set({ fontWeight: v })} options={[{ v: 400, l: 'Regular' }, { v: 500, l: 'Medium' }]} /></Row>
        <Row label={`Corner radius (${s.radius}px)`}><input type="range" min={0} max={24} value={s.radius} onChange={e => set({ radius: Number(e.target.value) })} /></Row>
        <Row label="Card style"><Seg value={s.cardStyle} onChange={v => set({ cardStyle: v })} options={[{ v: 'outlined', l: 'Outlined' }, { v: 'flat', l: 'Flat' }, { v: 'elevated', l: 'Elevated' }]} /></Row>
        <Row label="Density"><Seg value={s.density} onChange={v => set({ density: v })} options={[{ v: 'comfortable', l: 'Comfortable' }, { v: 'compact', l: 'Compact' }]} /></Row>
        <Row label="Navigation" hint="Side rail on wide screens only"><Seg value={s.navStyle} onChange={v => set({ navStyle: v })} options={[{ v: 'bottom', l: 'Bottom bar' }, { v: 'rail', l: 'Side rail' }]} /></Row>
        <Row label="Reduce motion"><input type="checkbox" checked={s.reduceMotion} onChange={e => set({ reduceMotion: e.target.checked })} /></Row>
      </Sec>

      <Sec id="dashboard" title="Dashboard widgets">
        <div className="list">{s.dashboardWidgets.map((w, i) => <div className="li small" key={w.id} style={{ minHeight: 44, padding: '4px 2px' }}><input type="checkbox" aria-label={'Show ' + W_LABEL[w.id]} checked={w.visible} onChange={e => set({ dashboardWidgets: s.dashboardWidgets.map(x => x.id === w.id ? { ...x, visible: e.target.checked } : x) })} /><span className="grow">{W_LABEL[w.id]}</span><button className="btn sm" onClick={() => moveW(i, -1)} aria-label="Move up">↑</button><button className="btn sm" onClick={() => moveW(i, 1)} aria-label="Move down">↓</button></div>)}</div>
        <div><button className="btn sm" onClick={() => set({ dashboardWidgets: DEFAULT_WIDGETS.map(id => ({ id, visible: true })) })}>Reset layout</button></div>
      </Sec>

      <Sec id="study" title="Study defaults">
        <Row label="Exam dates" hint="Optional and editable; leave blank if not announced"><div className="grid-2">{(['NEET PG', 'INI-CET'] as const).map(k => <label key={k} className="field">{k}<input type="date" value={exam(k)?.targetDate ?? ''} onChange={e => db.examTargets.put({ examType: k, targetDate: e.target.value || null, enabled: !!e.target.value })} /></label>)}</div></Row>
        <Row label="Global playback speed" hint="Per-lecture override → subject default → this"><Seg value={s.globalSpeed} onChange={v => set({ globalSpeed: v as Speed })} options={SPEEDS.map(x => ({ v: x, l: x + 'x' }))} /></Row>
        <Row label="Daily study hours"><input type="number" min={0.25} max={16} step={0.25} value={s.dailyHours} onChange={e => set({ dailyHours: Number(e.target.value) })} /></Row>
        <Row label="Maximum daily workload (h)" hint="The scheduler never goes above this, even to recover backlog"><input type="number" min={0.5} max={18} step={0.5} value={s.maxDailyHours} onChange={e => set({ maxDailyHours: Number(e.target.value) })} /></Row>
        <Row label="Study window"><div className="grid-2"><input type="time" aria-label="Start" value={s.studyWindowStart} onChange={e => set({ studyWindowStart: e.target.value })} /><input type="time" aria-label="End" value={s.studyWindowEnd} onChange={e => set({ studyWindowEnd: e.target.value })} /></div></Row>
        <Row label="Break between sessions (min)" hint="Shown in the timer and used to warn when the window can't fit the target"><input type="number" min={0} max={60} value={s.breakMinutes} onChange={e => set({ breakMinutes: Number(e.target.value) })} />
          {(() => { const [a, b] = [s.studyWindowStart, s.studyWindowEnd].map(t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; }); return b - a < s.dailyHours * 60 ? <div className="banner warn tiny" style={{ marginTop: 6 }}>Your study window ({Math.round((b - a) / 6) / 10} h) is shorter than your daily target.</div> : null; })()}</Row>
        <Row label="Weekly off days"><div className="row">{WEEKDAYS.map((d, i) => <label key={d} className="row small" style={{ gap: 4 }}><input type="checkbox" checked={s.offDays.includes(i)} onChange={e => set({ offDays: e.target.checked ? [...s.offDays, i] : s.offDays.filter(x => x !== i) })} />{d}</label>)}</div></Row>
        <Row label="Default scheduling mode"><Seg value={s.scheduleMode} onChange={v => set({ scheduleMode: v })} options={[{ v: 'balanced', l: 'Balanced' }, { v: 'deadline', l: 'Deadline' }, { v: 'flexible', l: 'Flexible' }]} /></Row>
        <Row label="Split long videos by default"><input type="checkbox" checked={s.splitLongVideos} onChange={e => set({ splitLongVideos: e.target.checked })} /></Row>
        <Row label="Productive day threshold (%)" hint="Share of the day's scheduled work that counts as a productive day"><input type="number" min={10} max={100} value={s.productiveThresholdPct} onChange={e => set({ productiveThresholdPct: Number(e.target.value) })} /></Row>
        <Row label="Streak grace days"><input type="number" min={0} max={3} value={s.graceDays} onChange={e => set({ graceDays: Number(e.target.value) })} /></Row>
        <Row label="Weak-topic accuracy threshold (%)"><input type="number" min={10} max={95} value={s.weakAccuracyPct} onChange={e => set({ weakAccuracyPct: Number(e.target.value) })} /></Row>
        <p className="tiny muted">Changing these affects new plans and forecasts. To re-plan existing tasks, use Schedule → Recovery plan or regenerate the plan.</p>
      </Sec>

      <Sec id="revision" title="Revision">
        <Row label="Default intervals (days)" hint="Applies to items added from now on"><div className="row"><input type="text" value={ivText} onChange={e => setIvText(e.target.value)} style={{ flex: 1 }} /><button className="btn sm" onClick={() => { const a = ivText.split(',').map(x => parseInt(x)).filter(x => x >= 0).sort((x, y) => x - y); if (a.length) { set({ revisionIntervals: a }); toast('Intervals saved'); } }}>Save</button></div></Row>
        <Row label="Revision reminder time"><input type="time" value={n.revision.time} onChange={e => setN({ revision: { ...n.revision, time: e.target.value } })} /></Row>
      </Sec>

      <Sec id="notifications" title="Notifications">
        <div className="banner info small">Reminders are generated on this device; no server is used. Browsers only deliver them while MEDTRACK is open or installed and running. Missed reminders arrive as one combined catch-up the next time you open the app. Exact timing isn't guaranteed.</div>
        <Row label="Permission"><div className="row"><span className="chip">{perm}</span>{perm !== 'granted' && <button className="btn sm" onClick={async () => setPerm(await requestPermission())}>Allow notifications</button>}</div></Row>
        <Row label="Enable reminders"><input type="checkbox" checked={n.enabled} onChange={e => setN({ enabled: e.target.checked })} /></Row>
        {([['morning', 'Morning plan'], ['mcq', 'MCQ reminder'], ['revision', 'Revision due'], ['evening', 'Evening audit']] as const).map(([k, l]) => <Row key={k} label={l}><div className="row"><input type="checkbox" aria-label={l + ' on'} checked={n[k].on} onChange={e => setN({ [k]: { ...n[k], on: e.target.checked } } as any)} /><input type="time" aria-label={l + ' time'} value={n[k].time} onChange={e => setN({ [k]: { ...n[k], time: e.target.value } } as any)} style={{ maxWidth: 140 }} /></div></Row>)}
        <Row label="Weekly summary"><div className="row"><input type="checkbox" checked={n.weekly.on} onChange={e => setN({ weekly: { ...n.weekly, on: e.target.checked } })} /><select value={n.weekly.day} onChange={e => setN({ weekly: { ...n.weekly, day: Number(e.target.value) } })} style={{ maxWidth: 110 }}>{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select><input type="time" value={n.weekly.time} onChange={e => setN({ weekly: { ...n.weekly, time: e.target.value } })} style={{ maxWidth: 140 }} /></div></Row>
        <Row label="Active days"><div className="row">{WEEKDAYS.map((d, i) => <label key={d} className="row small" style={{ gap: 4 }}><input type="checkbox" checked={n.days.includes(i)} onChange={e => setN({ days: e.target.checked ? [...n.days, i] : n.days.filter(x => x !== i) })} />{d}</label>)}</div></Row>
        <Row label="Quiet hours"><div className="grid-2"><input type="time" aria-label="Quiet start" value={n.quietStart} onChange={e => setN({ quietStart: e.target.value })} /><input type="time" aria-label="Quiet end" value={n.quietEnd} onChange={e => setN({ quietEnd: e.target.value })} /></div></Row>
        <Row label="Sound / vibration"><div className="row small"><label className="row"><input type="checkbox" checked={n.sound} onChange={e => setN({ sound: e.target.checked })} />Sound</label><label className="row"><input type="checkbox" checked={n.vibrate} onChange={e => setN({ vibrate: e.target.checked })} />Vibrate</label></div></Row>
        <Row label="Daily notification limit" hint="When exceeded, reminders are combined into one"><input type="number" min={1} max={10} value={n.dailyLimit} onChange={e => setN({ dailyLimit: Number(e.target.value) })} /></Row>
        <div><button className="btn sm" disabled={perm !== 'granted' || !n.enabled} onClick={async () => { localStorage.removeItem('mt_notif_sent'); await tick(true); toast('Catch-up check run'); }}>Test reminders now</button></div>
      </Sec>

      <Sec id="data" title="Data">
        <div className="row"><button className="btn primary" onClick={() => setImp(true)}>Import / re-import catalogue</button><Link className="btn" to="/backup">Backup & restore</Link>
          <button className="btn" onClick={async () => { const { blob } = await buildArchive(null); download(blob, `medtrack-export-${new Date().toISOString().slice(0, 10)}.json`); }}>Export all data (JSON)</button>
          <button className="btn" onClick={async () => { const v = await db.videos.toArray(); const p = new Map((await db.progress.toArray()).map(x => [x.videoId, x])); const sub = new Map((await db.subjects.toArray()).map(x => [x.id, x.name]));
            const esc = (x: unknown) => `"${String(x ?? '').replace(/"/g, '""')}"`; const csv = ['id,subject,module,title,minutes,included,status,completedAt,speedOverride,actualMinutes,sourcePage'].concat(v.map(x => [x.id, sub.get(x.subjectId), x.moduleType, x.title, x.originalDurationSeconds / 60, x.includedInPlan, p.get(x.id)?.status ?? 'not_started', p.get(x.id)?.completedAt ? new Date(p.get(x.id)!.completedAt!).toISOString() : '', p.get(x.id)?.speedOverride ?? '', ((p.get(x.id)?.actualTimeSeconds ?? 0) / 60).toFixed(1), x.sourcePage].map(esc).join(','))).join('\n');
            download(new Blob([csv], { type: 'text/csv' }), 'medtrack-progress.csv'); }}>Export progress (CSV)</button></div>
        <details><summary>Import history & validation reports ({batches?.length ?? 0})</summary>{batches?.map(b => <div key={b.id} className="small" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}><b>{b.fileName}</b> · {b.datasetVersion} · {new Date(b.importedAt).toLocaleString()}<div className="muted">{Object.entries(b.counts).map(([k, v]) => `${k}: ${v}`).join(' · ')}</div>
          <details><summary className="tiny">Issues ({issues?.filter(i => i.batchId === b.id).length})</summary><div className="tiny stack" style={{ maxHeight: 220, overflow: 'auto' }}>{issues?.filter(i => i.batchId === b.id).map(i => <div key={i.id}><span className="chip">{i.type}</span> {i.detail}</div>)}</div></details></div>)}</details>
        <details><summary>Database information</summary><div className="tiny">Schema v{SCHEMA_VERSION} · IndexedDB "medtrack" (this browser only)<br />{counts && Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(' · ')}</div></details>
        <div className="row"><button className="btn" onClick={() => setConfirm('settings')}>Restore default settings</button><button className="btn danger" onClick={() => setConfirm('progress')}>Reset progress</button><button className="btn danger" onClick={() => setConfirm('all')}>Delete all data</button></div>
      </Sec>

      <Sec id="advanced" title="Advanced">
        <Row label="Date format"><select value={s.dateFormat} onChange={e => set({ dateFormat: e.target.value as any })}>{['DD MMM YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'].map(f => <option key={f}>{f}</option>)}</select></Row>
        <Row label="Time format"><Seg value={s.timeFormat} onChange={v => set({ timeFormat: v })} options={[{ v: '24h', l: '24h' }, { v: '12h', l: '12h' }]} /></Row>
        <Row label="Week starts on"><Seg value={s.weekStart} onChange={v => set({ weekStart: v })} options={[{ v: 1, l: 'Monday' }, { v: 0, l: 'Sunday' }]} /></Row>
        <Row label="Backup retention (versions)" hint="Old Drive backups are only deleted after you confirm the policy on the Backup page"><input type="number" min={1} max={100} value={s.backup.retention} onChange={e => set({ backup: { ...s.backup, retention: Number(e.target.value), retentionConfirmed: false } })} /></Row>
      </Sec>

      <Sec id="privacy" title="Privacy">
        <div className="small stack">
          <p style={{ margin: 0 }}>All your data (catalogue, progress, schedules, MCQ logs, settings) is stored in this browser's IndexedDB on this device. MEDTRACK has no backend, no analytics, no ads and no third-party trackers.</p>
          <p style={{ margin: 0 }}><b>Network use.</b> Loading or updating the app (static files from the host). If, and only if, you connect Google Drive: accounts.google.com for sign-in and www.googleapis.com for uploading or downloading your encrypted backups to the hidden app-data folder. A Content Security Policy blocks every other destination.</p>
          <p style={{ margin: 0 }}><b>Permissions.</b> Notifications (optional) and files you choose yourself. No camera, microphone, location or contacts.</p>
          <p style={{ margin: 0 }}><b>Marrow content.</b> MEDTRACK stores lecture titles and durations only. It never accesses, downloads or plays Marrow videos.</p>
          <p style={{ margin: 0 }}>Deleting data here doesn't delete backups already in your Google Drive. Remove those from the Backup page or in Drive settings (Manage apps).</p>
        </div>
      </Sec>

      <Modal open={imp} onClose={() => setImp(false)} title="Import catalogue"><ImportWizard onDone={() => setTimeout(() => setImp(false), 1200)} /></Modal>
      <Confirm open={confirm === 'settings'} onClose={() => setConfirm(null)} title="Restore default settings?" body="Appearance, study, notification and advanced settings go back to defaults. Your lecture progress, plans and logs aren't touched." onConfirm={async () => { await restoreDefaultSettings(); toast('Settings restored'); }} />
      <Confirm open={confirm === 'progress'} onClose={() => setConfirm(null)} danger title="Reset all progress?" body="Clears completion status, speed overrides, actual time and notes for every lecture. The catalogue, plans, MCQ logs and settings are kept. This can't be undone, so export a backup first." confirmLabel="Reset progress" onConfirm={async () => { await db.progress.clear(); toast('Progress reset'); }} />
      <Confirm open={confirm === 'all'} onClose={() => setConfirm(null)} danger title="Delete ALL local data?" body="Removes the catalogue, progress, plans, logs and settings from this browser. Remote Google Drive backups are separate and are NOT deleted. This can't be undone." confirmLabel="Delete everything" onConfirm={async () => { await wipeAllData(); location.reload(); }} />
    </div>
  );
}
