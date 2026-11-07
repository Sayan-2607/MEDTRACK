import { useEffect, useState, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Link, useLocation } from 'react-router-dom';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useSettings, type Settings } from './data/settings';
import { Icon, ToastProvider } from './ui/components';
import { Onboarding } from './pages/Onboarding';
import { startReminderLoop } from './notify';
import { flushPending } from './backup/drive';
import { Home } from './pages/Home';

const Schedule = lazy(() => import('./pages/Schedule'));
const Lectures = lazy(() => import('./pages/Lectures'));
const SubjectDetail = lazy(() => import('./pages/SubjectDetail'));
const LectureDetail = lazy(() => import('./pages/LectureDetail'));
const Mcq = lazy(() => import('./pages/Mcq'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Revision = lazy(() => import('./pages/Revision'));
const Timer = lazy(() => import('./pages/Timer'));
const Audit = lazy(() => import('./pages/Audit'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const Backup = lazy(() => import('./pages/Backup'));

function applyTheme(s: Settings) {
  const r = document.documentElement;
  r.dataset.theme = s.theme === 'system' ? '' : s.theme;
  if (s.theme === 'system') delete r.dataset.theme;
  r.dataset.tint = s.surfaceTint; r.dataset.font = s.fontFamily; r.dataset.density = s.density; r.dataset.card = s.cardStyle;
  r.dataset.motion = s.reduceMotion ? 'reduce' : '';
  r.style.setProperty('--accent', s.accent); r.style.setProperty('--radius', s.radius + 'px');
  r.style.setProperty('--font-scale', String(s.fontScale)); r.style.setProperty('--fw', String(s.fontWeight));
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', s.accent);
}

const NAV = [
  { to: '/', icon: 'home', label: 'Home' }, { to: '/schedule', icon: 'cal', label: 'Schedule' },
  { to: '/lectures', icon: 'play', label: 'Lectures' }, { to: '/mcq', icon: 'check', label: 'MCQs' }, { to: '/analytics', icon: 'chart', label: 'Analytics' }
];

function Shell({ s }: { s: Settings }) {
  const [menu, setMenu] = useState(false);
  const loc = useLocation();
  useEffect(() => setMenu(false), [loc.pathname]);
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => { const on = () => { setOnline(true); flushPending(); }, off = () => setOnline(false); addEventListener('online', on); addEventListener('offline', off); return () => { removeEventListener('online', on); removeEventListener('offline', off); }; }, []);
  useEffect(() => startReminderLoop(), []);
  const nav = NAV.map(n => <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}><span className="ico"><Icon name={n.icon} /></span>{n.label}</NavLink>);
  return (
    <div className={'shell ' + (s.navStyle === 'rail' ? 'rail' : '')}>
      <header className="topbar">
        <Link to="/" className="brand" aria-label="MEDTRACK home"><span className="brand-mark"><svg width="15" height="15" viewBox="0 0 512 512"><path d="M96 280h80l40-96 64 176 44-112 24 32h68" fill="none" stroke="#fff" strokeWidth="46" strokeLinecap="round" strokeLinejoin="round" /></svg></span>MEDTRACK</Link>
        <div className="grow" />
        {!online && <span className="chip" title="All core features work offline">Offline</span>}
        <Link to="/timer" className="iconbtn" aria-label="Study timer"><Icon name="timer" /></Link>
        <Link to="/revision" className="iconbtn" aria-label="Revision queue"><Icon name="repeat" /></Link>
        <div style={{ position: 'relative' }}>
          <button className="iconbtn" aria-label="More" aria-expanded={menu} onClick={() => setMenu(!menu)}><Icon name="more" /></button>
          {menu && <div className="card" style={{ position: 'absolute', right: 0, top: 44, width: 220, padding: 6, zIndex: 30, boxShadow: 'var(--shadow)' }}>
            {[['/audit', 'Daily audit'], ['/revision', 'Revision queue'], ['/timer', 'Study timer'], ['/backup', 'Backup & restore'], ['/settings', 'Settings'], ['/settings#privacy', 'Privacy']].map(([to, l]) =>
              <Link key={to} to={to} className="btn ghost" style={{ width: '100%', justifyContent: 'flex-start' }}>{l}</Link>)}
          </div>}
        </div>
        <Link to="/settings" className="iconbtn" aria-label="Settings"><Icon name="gear" /></Link>
      </header>
      {s.navStyle === 'rail' && <nav className="railnav" aria-label="Primary">{nav}</nav>}
      <main className="main">
        {needRefresh && <div className="banner info row between" style={{ marginBottom: 12 }}>A new version is available.<button className="btn sm primary" onClick={() => updateServiceWorker(true)}>Update</button></div>}
        <Suspense fallback={<div className="muted small">Loading…</div>}>
          <Routes>
            <Route path="/" element={<Home s={s} />} />
            <Route path="/schedule" element={<Schedule s={s} />} />
            <Route path="/lectures" element={<Lectures s={s} />} />
            <Route path="/lectures/:subjectId" element={<SubjectDetail s={s} />} />
            <Route path="/video/:videoId" element={<LectureDetail s={s} />} />
            <Route path="/mcq" element={<Mcq s={s} />} />
            <Route path="/analytics" element={<Analytics s={s} />} />
            <Route path="/revision" element={<Revision s={s} />} />
            <Route path="/timer" element={<Timer s={s} />} />
            <Route path="/audit" element={<Audit s={s} />} />
            <Route path="/settings" element={<SettingsPage s={s} />} />
            <Route path="/backup" element={<Backup s={s} />} />
            <Route path="*" element={<Home s={s} />} />
          </Routes>
        </Suspense>
      </main>
      <nav className="bottomnav" aria-label="Primary">{nav}</nav>
    </div>
  );
}

export default function App() {
  const s = useSettings();
  useEffect(() => { if (s) applyTheme(s); }, [s]);
  if (!s) return <div className="main muted small">Opening local database…</div>;
  return <ToastProvider><BrowserRouter>{s.onboarded ? <Shell s={s} /> : <Onboarding />}</BrowserRouter></ToastProvider>;
}
