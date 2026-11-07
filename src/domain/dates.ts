/** Local calendar-date helpers. Dates are 'YYYY-MM-DD' in the device's local zone. */
export function toISODate(d: Date): string {
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
export function parseISODate(s: string): Date { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); }
export const today = () => toISODate(new Date());
export function addDays(s: string, n: number): string { const d = parseISODate(s); d.setDate(d.getDate() + n); return toISODate(d); }
export function diffDays(a: string, b: string): number { return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / 86400000); }
export const weekday = (s: string) => parseISODate(s).getDay(); // 0 = Sunday
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function startOfWeek(s: string, weekStart: number): string { const wd = weekday(s); return addDays(s, -((wd - weekStart + 7) % 7)); }
export function fmtDate(s: string | null | undefined, fmt: string = 'DD MMM YYYY'): string {
  if (!s) return '—';
  const d = parseISODate(s);
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dd = String(d.getDate()).padStart(2, '0'), mm = String(d.getMonth() + 1).padStart(2, '0');
  switch (fmt) {
    case 'YYYY-MM-DD': return s;
    case 'DD/MM/YYYY': return `${dd}/${mm}/${d.getFullYear()}`;
    case 'MM/DD/YYYY': return `${mm}/${dd}/${d.getFullYear()}`;
    default: return `${dd} ${M[d.getMonth()]} ${d.getFullYear()}`;
  }
}
export function rangeDates(from: string, to: string): string[] { const out: string[] = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; }
