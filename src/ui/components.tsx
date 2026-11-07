import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const p: Record<string, ReactNode> = {
    home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
    cal: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
    play: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m10 9 5 3-5 3z" /></>,
    check: <path d="m5 12 5 5L20 7" />,
    chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
    gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
    timer: <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2M9 2h6" /></>,
    repeat: <path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" />,
    clip: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
    back: <path d="M15 18 9 12l6-6" />,
    more: <><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></>,
    pin: <path d="M12 17v5M9 3h6l-1 6 4 4H6l4-4z" />,
    cloud: <path d="M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19 10a4 4 0 0 1 0 8z" />,
    x: <path d="M6 6l12 12M18 6 6 18" />,
    flag: <path d="M5 21V4h11l-2 4 2 4H5" />,
    up: <path d="m6 15 6-6 6 6" />, down: <path d="m6 9 6 6 6-6" />,
    skip: <path d="M5 5l10 7-10 7zM19 5v14" />,
    dots: <circle cx="12" cy="12" r="2" />
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{p[name]}</svg>;
}

export function Bar({ pct, color }: { pct: number | null; color?: string }) {
  return <div className="bar" role="progressbar" aria-valuenow={pct ?? 0} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%`, background: color }} /></div>;
}

export function Ring({ pct, size = 92, label, sub }: { pct: number | null; size?: number; label?: string; sub?: string }) {
  const r = (size - 10) / 2, c = 2 * Math.PI * r, v = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }} role="img" aria-label={`${label ?? ''} ${pct == null ? 'no data' : v.toFixed(0) + '%'}`}>
      <svg width={size} height={size}><circle cx={size / 2} cy={size / 2} r={r} stroke="var(--surface-2)" strokeWidth="9" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--accent)" strokeWidth="9" fill="none" strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dasharray .5s' }} /></svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <div><div style={{ fontWeight: 700, fontSize: size > 80 ? '1.15rem' : '.85rem' }} className="num">{pct == null ? '—' : v.toFixed(0) + '%'}</div>{sub && <div className="tiny muted">{sub}</div>}</div>
      </div>
    </div>
  );
}

/** Minimal SVG bar chart. Values in arbitrary units; labels under bars; optional secondary series (planned). */
export function BarChart({ data, height = 150, fmt = (v: number) => v.toFixed(1), secondary }: { data: { label: string; value: number }[]; height?: number; fmt?: (v: number) => string; secondary?: number[] }) {
  const max = Math.max(1e-9, ...data.map(d => d.value), ...(secondary ?? []));
  const w = 100 / Math.max(1, data.length);
  return (
    <svg viewBox={`0 0 100 ${height / 3}`} width="100%" height={height} preserveAspectRatio="none" role="img" aria-label="bar chart">
      {data.map((d, i) => {
        const h = (d.value / max) * (height / 3 - 8); const sh = secondary ? (secondary[i] / max) * (height / 3 - 8) : 0;
        return <g key={i}>
          {secondary && <rect x={i * w + w * 0.15} y={height / 3 - 6 - sh} width={w * 0.7} height={sh} fill="none" stroke="var(--muted)" strokeWidth=".3" strokeDasharray="1 .8" rx=".6" />}
          <rect x={i * w + w * 0.22} y={height / 3 - 6 - h} width={w * 0.56} height={Math.max(0, h)} fill="var(--accent)" rx=".8"><title>{d.label}: {fmt(d.value)}{secondary ? ` (planned ${fmt(secondary[i])})` : ''}</title></rect>
          <text x={i * w + w / 2} y={height / 3 - 1} fontSize="2.6" textAnchor="middle" fill="var(--muted)">{d.label}</text>
        </g>;
      })}
    </svg>
  );
}

export function LineChart({ points, height = 140 }: { points: { label: string; value: number }[]; height?: number }) {
  if (points.length < 2) return <div className="muted small">Not enough data for a trend yet.</div>;
  const max = Math.max(1e-9, ...points.map(p => p.value)); const H = 40;
  const xy = points.map((p, i) => [(i / (points.length - 1)) * 96 + 2, H - 4 - (p.value / max) * (H - 10)]);
  return <svg viewBox={`0 0 100 ${H}`} width="100%" height={height} preserveAspectRatio="none" role="img" aria-label="trend line">
    <polyline points={xy.map(p => p.join(',')).join(' ')} fill="none" stroke="var(--accent)" strokeWidth=".8" vectorEffect="non-scaling-stroke" />
    {xy.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r=".9" fill="var(--accent)"><title>{points[i].label}: {points[i].value.toFixed(1)}</title></circle>)}
  </svg>;
}

export function Heatmap({ days }: { days: { date: string; value: number }[] }) {
  const max = Math.max(1, ...days.map(d => d.value));
  return <div className="scroll-x"><div className="heat" role="img" aria-label="study calendar heatmap">
    {days.map(d => <i key={d.date} title={`${d.date}: ${Math.round(d.value / 60)} min`} style={{ background: d.value > 0 ? `color-mix(in srgb, var(--accent) ${20 + (d.value / max) * 80}%, var(--surface-2))` : undefined }} />)}
  </div></div>;
}

export function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void; label?: string }) {
  return <div className="seg" role="radiogroup" aria-label={label}>{options.map(o => <button type="button" role="radio" aria-checked={o.v === value} key={String(o.v)} className={o.v === value ? 'on' : ''} onClick={() => onChange(o.v)}>{o.l}</button>)}</div>;
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return <div className="modal-bg" onClick={onClose}><div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
    <div className="card-h"><h2>{title}</h2><button className="iconbtn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>{children}</div></div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><h3>{title}</h3><div className="small">{children}</div></div>;
}

export function Info({ text }: { text: string }) {
  return <span title={text} aria-label={text} tabIndex={0} style={{ cursor: 'help', display: 'inline-grid', placeItems: 'center', width: 16, height: 16, borderRadius: 8, border: '1px solid var(--line)', fontSize: 10, color: 'var(--muted)', marginLeft: 4 }}>i</span>;
}

const ToastCtx = createContext<(m: string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const show = useCallback((m: string) => { setMsg(m); setTimeout(() => setMsg(x => (x === m ? null : x)), 3200); }, []);
  return <ToastCtx.Provider value={show}>{children}{msg && <div className="toast" role="status">{msg}</div>}</ToastCtx.Provider>;
}
export const useToast = () => useContext(ToastCtx);

export function Confirm({ open, title, body, confirmLabel = 'Confirm', danger, onConfirm, onClose }: { open: boolean; title: string; body: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onClose: () => void }) {
  return <Modal open={open} onClose={onClose} title={title}><div className="stack"><div className="small">{body}</div>
    <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Cancel</button><button className={'btn ' + (danger ? 'danger' : 'primary')} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button></div></div></Modal>;
}
