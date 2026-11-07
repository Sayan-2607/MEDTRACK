import { useState } from 'react';
import { db, SPEEDS, type Speed } from '../db/schema';
import { patchSettings } from '../data/settings';
import { ImportWizard } from './ImportWizard';
import { Seg } from '../ui/components';
import { WEEKDAYS } from '../domain/dates';
import { requestPermission } from '../notify';

export function Onboarding() {
  const [step, setStep] = useState(0);
  const [speed, setSpeed] = useState<Speed | null>(null);
  const [hours, setHours] = useState('');
  const [neet, setNeet] = useState(''); const [ini, setIni] = useState('');
  const [off, setOff] = useState<number[]>([]);
  const [imported, setImported] = useState(false);
  const [notif, setNotif] = useState(false);

  async function finish() {
    await patchSettings({ globalSpeed: speed ?? 1, dailyHours: Number(hours), offDays: off, onboarded: true, notif: { ...(await import('../data/settings')).DEFAULTS.notif, enabled: notif } });
    await db.examTargets.bulkPut([{ examType: 'NEET PG', targetDate: neet || null, enabled: !!neet }, { examType: 'INI-CET', targetDate: ini || null, enabled: !!ini }]);
  }
  const steps = ['Welcome', 'Study defaults', 'Exam dates', 'Catalogue', 'Reminders'];
  return (
    <div className="main" style={{ maxWidth: 640 }}>
      <div className="row between" style={{ marginBottom: 14 }}>
        <div className="brand"><span className="brand-mark"><svg width="16" height="16" viewBox="0 0 512 512"><path d="M96 280h80l40-96 64 176 44-112 24 32h68" fill="none" stroke="#fff" strokeWidth="44" strokeLinecap="round" strokeLinejoin="round" /></svg></span>MEDTRACK</div>
        <span className="small muted">Step {step + 1} of {steps.length} · {steps[step]}</span>
      </div>
      <div className="bar" style={{ marginBottom: 18 }}><span style={{ width: `${((step + 1) / steps.length) * 100}%` }} /></div>

      {step === 0 && <div className="stack">
        <h1>Your NEET PG & INI-CET preparation, audited.</h1>
        <p className="muted">MEDTRACK organises your Marrow lecture catalogue, tracks lectures and QBank work separately, plans realistic schedules and keeps a truthful record of what you've done.</p>
        <div className="card stack small">
          <div><b>Works offline.</b> Your data stays in this browser on this device. There's no MEDTRACK server, no analytics and no tracking.</div>
          <div><b>Google Drive is optional.</b> It's used only for encrypted backups, and only if you connect it yourself.</div>
          <div><b>No video playback.</b> MEDTRACK is a planner. It never accesses, downloads or plays Marrow content.</div>
        </div>
        <div><button className="btn primary" onClick={() => setStep(1)}>Get started</button></div>
      </div>}

      {step === 1 && <div className="stack">
        <h2>Study defaults</h2>
        <div className="card stack">
          <div><div className="small muted" style={{ marginBottom: 6 }}>Default playback speed you usually watch at</div>
            <Seg value={speed ?? (0 as any)} onChange={v => setSpeed(v as Speed)} options={SPEEDS.map(s => ({ v: s, l: s.toFixed(1) + 'x' }))} label="Playback speed" /></div>
          <label className="field">Daily study hours you can realistically commit<input type="number" min={0.25} max={16} step={0.25} value={hours} onChange={e => setHours(e.target.value)} placeholder="e.g. 4" /></label>
          <div><div className="small muted" style={{ marginBottom: 6 }}>Weekly off days (optional)</div>
            <div className="row">{WEEKDAYS.map((d, i) => <label key={d} className="row small" style={{ gap: 4 }}><input type="checkbox" checked={off.includes(i)} onChange={e => setOff(e.target.checked ? [...off, i] : off.filter(x => x !== i))} />{d}</label>)}</div></div>
        </div>
        <p className="tiny muted">The PDF's sample workbook uses 1.8x and 2 h/day. Those are sample inputs, not your preferences, so nothing is pre-selected.</p>
        <div className="row"><button className="btn" onClick={() => setStep(0)}>Back</button><button className="btn primary" disabled={!speed || !(Number(hours) > 0)} onClick={() => setStep(2)}>Continue</button></div>
      </div>}

      {step === 2 && <div className="stack">
        <h2>Target exam dates</h2>
        <p className="small muted">Optional. Leave blank if the date isn't announced yet. You can change these any time.</p>
        <div className="card grid-2">
          <label className="field">NEET PG<input type="date" value={neet} onChange={e => setNeet(e.target.value)} /></label>
          <label className="field">INI-CET<input type="date" value={ini} onChange={e => setIni(e.target.value)} /></label>
        </div>
        <div className="row"><button className="btn" onClick={() => setStep(1)}>Back</button><button className="btn primary" onClick={() => setStep(3)}>Continue</button></div>
      </div>}

      {step === 3 && <div className="stack">
        <h2>Import your lecture catalogue</h2>
        {imported ? <div className="banner ok">Catalogue imported.</div> : <ImportWizard compact onDone={() => setImported(true)} />}
        <div className="row"><button className="btn" onClick={() => setStep(2)}>Back</button><button className="btn primary" onClick={() => setStep(4)}>{imported ? 'Continue' : 'Skip for now'}</button></div>
      </div>}

      {step === 4 && <div className="stack">
        <h2>Daily reminders</h2>
        <div className="card stack small">
          <p style={{ margin: 0 }}>MEDTRACK can remind you about your morning plan, due revisions, MCQ practice and an evening audit. Reminders are created on this device. No server is involved.</p>
          <p className="muted" style={{ margin: 0 }}>Browser limitation: reminders are delivered while MEDTRACK is open or running in the background. If the app was closed, you'll get one combined catch-up reminder the next time you open it. Exact timing isn't guaranteed.</p>
          <div><button className="btn" onClick={async () => setNotif((await requestPermission()) === 'granted')}>{notif ? '✓ Notifications allowed' : 'Allow notifications'}</button></div>
        </div>
        <div className="row"><button className="btn" onClick={() => setStep(3)}>Back</button><button className="btn primary" onClick={finish}>Finish setup</button></div>
      </div>}
    </div>
  );
}
