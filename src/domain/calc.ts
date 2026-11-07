/** Pure calculation rules (spec §7, §22). All internal math in seconds, floating; round only for display. */
import type { Speed, Video, VideoProgress, Subject } from '../db/schema';

export function estimatedSeconds(originalSeconds: number, speed: number): number {
  if (!(speed > 0)) throw new Error('speed must be > 0');
  if (!(originalSeconds >= 0)) return 0;
  return originalSeconds / speed;
}
export function timeSavedSeconds(originalSeconds: number, speed: number) {
  return originalSeconds - estimatedSeconds(originalSeconds, speed);
}
/** Precedence: per-video override → subject default → global default. */
export function effectiveSpeed(p: VideoProgress | undefined, s: Subject | undefined, globalSpeed: Speed): Speed {
  return (p?.speedOverride ?? s?.defaultSpeed ?? globalSpeed) as Speed;
}

export function accuracy(correct: number, attempted: number): number | null {
  if (!attempted) return null;
  return (correct / attempted) * 100;
}
export function percent(n: number, d: number): number | null { return d > 0 ? (n / d) * 100 : null; }

export interface McqInput { totalQuestions: number; attempted: number; correct: number; incorrect: number; skipped: number; }
/** Input model: attempted = correct + incorrect; skipped = questions seen but not answered;
 *  attempted + skipped ≤ total. (Spec §8: correct+incorrect+skipped = attempted is the "skipped-inside-attempted"
 *  variant; we use the clearer model where skipped is excluded from attempted, matching the accuracy rule.) */
export function validateMcq(m: McqInput): string[] {
  const e: string[] = [];
  for (const k of ['totalQuestions', 'attempted', 'correct', 'incorrect', 'skipped'] as const) { const v = m[k]; if (!Number.isInteger(v) || v < 0) e.push(`${k} must be a whole number ≥ 0`); }
  if (m.correct + m.incorrect !== m.attempted) e.push('Correct + incorrect must equal attempted');
  if (m.attempted + m.skipped > m.totalQuestions) e.push('Attempted + skipped cannot exceed total questions');
  return e;
}

export function fmtDuration(seconds: number, style: 'short' | 'hm' | 'precise' = 'short'): string {
  if (!isFinite(seconds)) return '—';
  const neg = seconds < 0; let s = Math.abs(seconds);
  if (style === 'precise') {
    const m = Math.floor(s / 60), sec = Math.round(s - m * 60);
    const mm = sec === 60 ? m + 1 : m, ss = sec === 60 ? 0 : sec;
    return (neg ? '-' : '') + (ss ? `${mm} min ${ss} s` : `${mm} min`);
  }
  const totalMin = Math.round(s / 60);
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  if (style === 'hm' || h > 0) return (neg ? '-' : '') + (h ? `${h}h ${m.toString().padStart(2, '0')}m` : `${m}m`);
  return (neg ? '-' : '') + `${totalMin} min`;
}
export const fmtHours = (seconds: number, dp = 1) => (seconds / 3600).toFixed(dp) + ' h';

export interface WorkloadTotals {
  catalogueSeconds: number; includedSeconds: number; completedSeconds: number; remainingOriginalSeconds: number;
  remainingEstimatedSeconds: number; savedSeconds: number; included: number; completed: number; remaining: number;
  skipped: number; total: number;
}
/** Remaining = included, active, not completed, not skipped. Excluded videos never count as remaining or completed-in-plan. */
export function workload(videos: Video[], prog: Map<string, VideoProgress>, subjects: Map<string, Subject>, globalSpeed: Speed): WorkloadTotals {
  const t: WorkloadTotals = { catalogueSeconds: 0, includedSeconds: 0, completedSeconds: 0, remainingOriginalSeconds: 0, remainingEstimatedSeconds: 0, savedSeconds: 0, included: 0, completed: 0, remaining: 0, skipped: 0, total: 0 };
  for (const v of videos) {
    if (!v.active) continue;
    t.total++; t.catalogueSeconds += v.originalDurationSeconds;
    if (!v.includedInPlan) continue;
    const p = prog.get(v.id);
    t.included++; t.includedSeconds += v.originalDurationSeconds;
    if (p?.status === 'completed') { t.completed++; t.completedSeconds += v.originalDurationSeconds; continue; }
    if (p?.status === 'skipped') { t.skipped++; continue; }
    const sp = effectiveSpeed(p, subjects.get(v.subjectId), globalSpeed);
    t.remaining++; t.remainingOriginalSeconds += v.originalDurationSeconds;
    const est = estimatedSeconds(v.originalDurationSeconds, sp);
    t.remainingEstimatedSeconds += est; t.savedSeconds += v.originalDurationSeconds - est;
  }
  return t;
}
