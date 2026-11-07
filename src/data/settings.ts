import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Speed, type PlanMode } from '../db/schema';
import { DEFAULT_WEIGHTS, type ReadinessWeights } from '../domain/analytics';

export interface Settings {
  onboarded: boolean;
  theme: 'system' | 'light' | 'dark';
  accent: string;
  surfaceTint: 'neutral' | 'warm' | 'cool';
  fontFamily: 'system' | 'serif' | 'mono' | 'rounded';
  fontScale: number;
  fontWeight: 400 | 500;
  radius: number;
  density: 'compact' | 'comfortable';
  cardStyle: 'flat' | 'outlined' | 'elevated';
  reduceMotion: boolean;
  navStyle: 'bottom' | 'rail';
  dashboardWidgets: { id: string; visible: boolean }[];
  globalSpeed: Speed;
  dailyHours: number;
  maxDailyHours: number;
  offDays: number[];
  scheduleMode: PlanMode;
  splitLongVideos: boolean;
  studyWindowStart: string;
  studyWindowEnd: string;
  breakMinutes: number;
  taskOrder: 'revisions_first' | 'videos_first';
  revisionIntervals: number[];
  revisionDailyLimitMin: number;
  productiveThresholdPct: number;
  graceDays: number;
  readinessWeights: ReadinessWeights;
  weakAccuracyPct: number;
  notif: {
    enabled: boolean; morning: { on: boolean; time: string }; mcq: { on: boolean; time: string }; revision: { on: boolean; time: string };
    evening: { on: boolean; time: string }; weekly: { on: boolean; day: number; time: string }; tasks: { on: boolean };
    quietStart: string; quietEnd: string; days: number[]; sound: boolean; vibrate: boolean; dailyLimit: number;
  };
  dateFormat: 'DD MMM YYYY' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
  timeFormat: '24h' | '12h';
  weekStart: 0 | 1;
  precision: 0 | 1 | 2;
  backup: { autoDaily: boolean; retention: number; retentionConfirmed: boolean; lastAutoAttempt: number | null };
}

export const DEFAULT_WIDGETS = ['countdown', 'today', 'progress', 'modules', 'debt', 'revision', 'readiness', 'weekly', 'subjects', 'health'];

export const DEFAULTS: Settings = {
  onboarded: false, theme: 'system', accent: '#0f766e', surfaceTint: 'neutral', fontFamily: 'system', fontScale: 1, fontWeight: 400,
  radius: 14, density: 'comfortable', cardStyle: 'outlined', reduceMotion: false, navStyle: 'bottom',
  dashboardWidgets: DEFAULT_WIDGETS.map(id => ({ id, visible: true })),
  globalSpeed: 1.5, dailyHours: 4, maxDailyHours: 10, offDays: [], scheduleMode: 'balanced', splitLongVideos: false,
  studyWindowStart: '07:00', studyWindowEnd: '22:00', breakMinutes: 10, taskOrder: 'revisions_first',
  revisionIntervals: [1, 3, 7, 15, 30], revisionDailyLimitMin: 60, productiveThresholdPct: 80, graceDays: 1,
  readinessWeights: DEFAULT_WEIGHTS, weakAccuracyPct: 60,
  notif: { enabled: false, morning: { on: true, time: '07:00' }, mcq: { on: true, time: '18:00' }, revision: { on: true, time: '08:00' },
    evening: { on: true, time: '21:30' }, weekly: { on: true, day: 0, time: '19:00' }, tasks: { on: false },
    quietStart: '23:00', quietEnd: '06:30', days: [0, 1, 2, 3, 4, 5, 6], sound: true, vibrate: true, dailyLimit: 5 },
  dateFormat: 'DD MMM YYYY', timeFormat: '24h', weekStart: 1, precision: 1,
  backup: { autoDaily: false, retention: 10, retentionConfirmed: false, lastAutoAttempt: null }
};

const KEYS = Object.keys(DEFAULTS) as (keyof Settings)[];

export async function loadSettings(): Promise<Settings> {
  const rows = await db.settings.bulkGet(KEYS as string[]);
  const s: any = structuredClone(DEFAULTS);
  rows.forEach((r, i) => { if (r) s[KEYS[i]] = typeof DEFAULTS[KEYS[i]] === 'object' && !Array.isArray(DEFAULTS[KEYS[i]]) ? { ...(DEFAULTS as any)[KEYS[i]], ...(r.value as object) } : r.value; });
  return s;
}
export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  await db.settings.put({ key, value, updatedAt: Date.now() });
}
export async function patchSettings(p: Partial<Settings>) {
  const now = Date.now();
  await db.settings.bulkPut(Object.entries(p).map(([key, value]) => ({ key, value, updatedAt: now })));
}
/** Resets settings only — never touches progress (spec §19). Keeps onboarding flag. */
export async function restoreDefaultSettings() {
  await db.transaction('rw', db.settings, async () => {
    const keep = await db.settings.get('onboarded');
    await db.settings.clear();
    if (keep) await db.settings.put(keep);
  });
}

export function useSettings(): Settings | undefined {
  return useLiveQuery(loadSettings, [], undefined);
}
