/**
 * Local reminders (no server, no push). Web platform limitation, stated honestly in the UI:
 * browsers cannot wake a closed web app at an exact time without a push server (which this app must not use).
 * Reminders fire while MEDTRACK is open or installed-and-running in the background; missed reminders are
 * consolidated into one catch-up notification next time the app opens. Daily limit + quiet hours enforced.
 */
import { db } from './db/schema';
import { loadSettings, type Settings } from './data/settings';
import { today, weekday } from './domain/dates';

const SENT_KEY = 'mt_notif_sent';
function sentLog(): Record<string, string[]> { try { return JSON.parse(localStorage.getItem(SENT_KEY) || '{}'); } catch { return {}; } }
function saveLog(l: Record<string, string[]>) { try { localStorage.setItem(SENT_KEY, JSON.stringify({ [today()]: l[today()] ?? [] })); } catch { /* ignore */ } }

const hm = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
function inQuiet(now: number, s: Settings['notif']) { const a = hm(s.quietStart), b = hm(s.quietEnd); return a <= b ? now >= a && now < b : now >= a || now < b; }

export async function requestPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied';
  return Notification.requestPermission();
}

async function show(title: string, body: string, s: Settings['notif']) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const opts: NotificationOptions & { vibrate?: number[] } = { body, icon: '/icon-192.png', badge: '/icon-192.png', silent: !s.sound, tag: 'medtrack-' + title };
  if (s.vibrate) opts.vibrate = [80, 40, 80];
  const reg = await navigator.serviceWorker?.getRegistration();
  if (reg) await reg.showNotification(title, opts); else new Notification(title, opts);
}

async function content(kind: string): Promise<[string, string] | null> {
  const t = today();
  const tasks = (await db.tasks.where('scheduledDate').equals(t).toArray()).filter(x => x.status !== 'removed');
  const pend = tasks.filter(x => x.status === 'pending');
  const revDue = (await db.revisionEvents.where('status').equals('due').toArray()).filter(e => e.dueDate <= t).length;
  const min = Math.round(pend.reduce((a, x) => a + x.plannedSeconds, 0) / 60);
  switch (kind) {
    case 'morning': return tasks.length ? ['Today\'s plan', `${pend.length} task(s), ~${min} min planned.${revDue ? ` ${revDue} revision(s) due.` : ''}`] : null;
    case 'mcq': return ['QBank practice', 'Log today\'s MCQ session when you finish.'];
    case 'revision': return revDue ? ['Revisions due', `${revDue} revision(s) due today or overdue.`] : null;
    case 'evening': return ['Evening audit', pend.length ? `${pend.length} task(s) still pending today. Review and reschedule if needed.` : 'All of today\'s tasks are done. Review your daily audit.'];
    case 'weekly': return ['Weekly summary', 'Your weekly summary is ready in Analytics.'];
  }
  return null;
}

export async function tick(catchUp = false) {
  const s = await loadSettings(); const n = s.notif;
  if (!n.enabled || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const d = new Date(); const now = d.getHours() * 60 + d.getMinutes(); const t = today();
  if (!n.days.includes(weekday(t)) || inQuiet(now, n)) return;
  const log = sentLog(); const sent = log[t] ?? [];
  const due: string[] = [];
  const check = (k: string, on: boolean, time: string) => { if (on && !sent.includes(k) && now >= hm(time) && (catchUp || now - hm(time) < 30)) due.push(k); };
  check('morning', n.morning.on, n.morning.time); check('revision', n.revision.on, n.revision.time);
  check('mcq', n.mcq.on, n.mcq.time); check('evening', n.evening.on, n.evening.time);
  if (weekday(t) === n.weekly.day) check('weekly', n.weekly.on, n.weekly.time);
  if (!due.length) return;
  const room = Math.max(0, n.dailyLimit - sent.length); if (!room) return;
  const msgs = (await Promise.all(due.map(content))).filter(Boolean) as [string, string][];
  if (msgs.length > 1 || room < due.length) await show('MEDTRACK reminders', msgs.map(m => `${m[0]}: ${m[1]}`).join('\n'), n); // consolidated
  else if (msgs[0]) await show(msgs[0][0], msgs[0][1], n);
  log[t] = [...sent, ...due]; saveLog(log);
}

export function startReminderLoop() {
  tick(true);
  const id = setInterval(() => tick(false), 60_000);
  return () => clearInterval(id);
}
