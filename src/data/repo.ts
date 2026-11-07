/** Repository / use-case layer: every mutation goes through here, inside transactions, with audit events. */
import { db, uid, audit, type Video, type VideoProgress, type VideoStatus, type Speed, type Subject, type StudyPlan, type ScheduledTask, type ModuleType, type RevisionItem } from '../db/schema';
import { loadSettings } from './settings';
import { estimatedSeconds, effectiveSpeed } from '../domain/calc';
import { schedule, subjectRunOrder, diffSchedules, type SchedItem, type SchedConfig, type RescheduleDiff } from '../domain/scheduler';
import { addDays, today, rangeDates } from '../domain/dates';
import { subjectIdFor, type NormRecord, type ImportDiff, type ValidationIssue } from '../domain/importer';

// ---------- progress ----------
export function blankProgress(videoId: string): VideoProgress {
  return { videoId, status: 'not_started', speedOverride: null, completedAt: null, completedSpeed: null, actualTimeSeconds: 0, notes: '', lastUpdatedAt: Date.now() };
}
export async function setVideoStatus(videoId: string, status: VideoStatus) {
  await db.transaction('rw', [db.progress, db.audit, db.videos, db.subjects, db.settings, db.tasks, db.revisionItems, db.revisionEvents], async () => {
    const before = (await db.progress.get(videoId)) ?? blankProgress(videoId);
    const v = await db.videos.get(videoId); const s = v ? await db.subjects.get(v.subjectId) : undefined;
    const g = (await loadSettings()).globalSpeed;
    const after: VideoProgress = { ...before, status, lastUpdatedAt: Date.now(),
      completedAt: status === 'completed' ? Date.now() : null,
      completedSpeed: status === 'completed' ? effectiveSpeed(before, s, g) : null };
    await db.progress.put(after);
    await audit('video', videoId, 'status:' + status, before.status, status);
    // mark scheduled tasks for this video
    const tasks = await db.tasks.where('videoId').equals(videoId).toArray();
    for (const t of tasks) if (t.status === 'pending' || t.status === 'done') await db.tasks.update(t.id, { status: status === 'completed' ? 'done' : status === 'skipped' ? 'skipped' : 'pending', updatedAt: Date.now() });
  });
}
export async function setSpeedOverride(videoIds: string[], speed: Speed | null, preserveExisting: boolean) {
  await db.transaction('rw', db.progress, db.audit, async () => {
    for (const id of videoIds) {
      const p = (await db.progress.get(id)) ?? blankProgress(id);
      if (preserveExisting && p.speedOverride != null && speed != null) continue;
      await db.progress.put({ ...p, speedOverride: speed, lastUpdatedAt: Date.now() });
    }
    await audit('video', videoIds.length + ' videos', 'speed', null, speed);
  });
}
export async function setIncluded(videoIds: string[], included: boolean) {
  await db.transaction('rw', db.videos, db.audit, async () => {
    for (const id of videoIds) await db.videos.update(id, { includedInPlan: included, updatedAt: Date.now() });
    await audit('video', videoIds.length + ' videos', included ? 'include' : 'exclude', null, null);
  });
}
export async function updateProgressFields(videoId: string, patch: Partial<VideoProgress>) {
  const p = (await db.progress.get(videoId)) ?? blankProgress(videoId);
  await db.progress.put({ ...p, ...patch, lastUpdatedAt: Date.now() });
}

// ---------- import ----------
export async function commitImport(fileName: string, datasetVersion: string, recs: NormRecord[], diff: ImportDiff, issues: ValidationIssue[],
  opts: { archiveMissing: boolean; subjectsMeta?: { name: string; sourceName: string; sourceOrder: number }[]; priorities?: Record<string, number> }) {
  const now = Date.now(); const batchId = uid('imp_');
  await db.transaction('rw', [db.subjects, db.videos, db.progress, db.importBatches, db.importIssues, db.audit], async () => {
    // subjects
    const order: string[] = []; for (const r of recs) if (!order.includes(r.subjectSourceName)) order.push(r.subjectSourceName);
    (opts.subjectsMeta ?? []).forEach(m => { if (!order.includes(m.sourceName)) order.push(m.sourceName); });
    for (const [i, src] of order.entries()) {
      const id = subjectIdFor(src); const ex = await db.subjects.get(id);
      const meta = opts.subjectsMeta?.find(m => m.sourceName === src);
      const has = recs.some(r => r.subjectSourceName === src);
      if (!ex) await db.subjects.add({ id, name: meta?.name ?? recs.find(r => r.subjectSourceName === src)?.subjectName ?? src, sourceName: src,
        priority: opts.priorities?.[src] ?? null, sortOrder: meta?.sourceOrder ?? i + 1, sourceOrder: meta?.sourceOrder ?? i + 1, active: true, hidden: false,
        coverageStatus: has ? 'records_present' : 'no_records_in_source', defaultSpeed: null, createdAt: now, updatedAt: now });
      else await db.subjects.update(id, { coverageStatus: has ? 'records_present' : 'no_records_in_source', updatedAt: now });
    }
    const mk = (r: NormRecord, prev?: Video): Video => {
      if (!r.id || !r.subjectSourceName || !Number.isFinite(r.seconds) || r.seconds < 0) throw new Error(`Invalid record "${r.title}" (${r.sourceRowId})`);
      return { id: r.id, subjectId: subjectIdFor(r.subjectSourceName), moduleType: r.moduleType, title: r.title,
      originalDurationSeconds: r.seconds, sourcePage: r.sourcePage, sourceRow: r.sourceRow, sourceRowId: r.sourceRowId, sourceOrder: r.sourceOrder,
      manualOrder: prev?.manualOrder ?? null, datasetVersion, includedInPlan: prev?.includedInPlan ?? true, active: true, tags: prev?.tags ?? [],
      examTags: prev?.examTags ?? [], topic: prev?.topic ?? null, createdAt: prev?.createdAt ?? now, updatedAt: now }; };
    for (const r of diff.added) await db.videos.put(mk(r));
    for (const r of diff.unchanged) { const prev = await db.videos.get(r.id); await db.videos.put(mk(r, prev)); }
    for (const { rec, oldId } of diff.changed) {
      // edited record: new id, carry progress & flags over; archive the old row (keeps traceability)
      const prev = await db.videos.get(oldId);
      await db.videos.put(mk(rec, prev));
      const p = await db.progress.get(oldId); if (p) await db.progress.put({ ...p, videoId: rec.id });
      await db.videos.update(oldId, { active: false, updatedAt: now });
      await audit('video', oldId, 'import:changed→' + rec.id, prev?.title, rec.title);
    }
    if (opts.archiveMissing) for (const m of diff.missing) await db.videos.update(m.id, { active: false, updatedAt: now });
    await db.importBatches.add({ id: batchId, fileName, datasetVersion, importedAt: now,
      counts: { records: recs.length, added: diff.added.length, changed: diff.changed.length, unchanged: diff.unchanged.length, missing: diff.missing.length },
      report: { issues: issues.length } });
    await db.importIssues.bulkAdd(issues.map(i => ({ id: uid('iss_'), batchId, ...i })));
    await audit('import', batchId, 'import', null, { fileName, records: recs.length });
  });
  return batchId;
}

// ---------- revision ----------
export async function addToRevision(ref: { videoId?: string; topic?: string; subjectId?: string | null }, intervals?: number[]) {
  const s = await loadSettings(); const iv = intervals ?? s.revisionIntervals; const anchor = today();
  const item: RevisionItem = { id: uid('rev_'), refType: ref.videoId ? 'video' : 'topic', videoId: ref.videoId ?? null, topic: ref.topic ?? null,
    subjectId: ref.subjectId ?? null, intervals: intervals ?? null, anchorDate: anchor, createdAt: Date.now(), active: true };
  await db.transaction('rw', db.revisionItems, db.revisionEvents, async () => {
    await db.revisionItems.add(item);
    await db.revisionEvents.bulkAdd(iv.map((d, i) => ({ id: uid('rve_'), itemId: item.id, cycle: i + 1, intervalDays: d, dueDate: addDays(anchor, d), status: 'due' as const, completedAt: null, confidence: null, notes: '' })));
  });
  return item.id;
}
export async function setRevisionIntervals(itemId: string, intervals: number[]) {
  await db.transaction('rw', db.revisionItems, db.revisionEvents, async () => {
    const it = await db.revisionItems.get(itemId); if (!it) return;
    await db.revisionItems.update(itemId, { intervals });
    const evs = await db.revisionEvents.where('itemId').equals(itemId).toArray();
    for (const e of evs) if (e.status === 'due') await db.revisionEvents.delete(e.id);
    const doneCycles = evs.filter(e => e.status !== 'due').length;
    await db.revisionEvents.bulkAdd(intervals.slice(doneCycles).map((d, i) => ({ id: uid('rve_'), itemId, cycle: doneCycles + i + 1, intervalDays: d, dueDate: addDays(it.anchorDate, d), status: 'due' as const, completedAt: null, confidence: null, notes: '' })));
  });
}

// ---------- planning ----------
export async function buildItems(plan: StudyPlan): Promise<{ items: SchedItem[]; order: Subject[] }> {
  const st = await loadSettings();
  const subjects = (await db.subjects.toArray()).filter(s => s.active && plan.subjectIds.includes(s.id));
  const order = subjectRunOrder(subjects);
  const prog = new Map((await db.progress.toArray()).map(p => [p.videoId, p]));
  const modRank: Record<ModuleType, number> = { Main: 0, Revision: 1, MCQ: 2 };
  const items: SchedItem[] = [];
  for (const s of order) {
    const vids = (await db.videos.where('subjectId').equals(s.id).toArray())
      .filter(v => v.active && v.includedInPlan && plan.modules.includes(v.moduleType))
      .filter(v => !['completed', 'skipped'].includes(prog.get(v.id)?.status ?? ''))
      .sort((a, b) => (a.manualOrder ?? Infinity) - (b.manualOrder ?? Infinity) || modRank[a.moduleType] - modRank[b.moduleType] || a.sourceOrder - b.sourceOrder);
    for (const v of vids) items.push({ key: v.id, kind: 'video', seconds: estimatedSeconds(v.originalDurationSeconds, effectiveSpeed(prog.get(v.id), s, st.globalSpeed)), subjectId: s.id });
  }
  if (plan.includeRevisions) {
    const due = (await db.revisionEvents.where('status').equals('due').toArray());
    const per = 20 * 60; // default revision block: 20 min (editable per task once scheduled)
    for (const e of due) items.push({ key: e.id, kind: 'revision', seconds: per, subjectId: null, fixedDate: e.dueDate < plan.startDate ? plan.startDate : e.dueDate });
  }
  return { items, order };
}

async function recentDailyActual(days = 14): Promise<number[]> {
  const from = addDays(today(), -days); const sessions = await db.studySessions.where('startTime').above(new Date(from).getTime()).toArray();
  const m = new Map<string, number>(); for (const d of rangeDates(from, addDays(today(), -1))) m.set(d, 0);
  for (const s of sessions) { const d = new Date(s.startTime); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; if (m.has(k)) m.set(k, m.get(k)! + s.durationSeconds); }
  return [...m.values()];
}
export async function dailyActualHistory(days = 28) { return recentDailyActual(days); }

export async function planConfig(plan: StudyPlan, startOverride?: string): Promise<SchedConfig> {
  const hist = await recentDailyActual(14); const has = hist.filter(x => x > 0).length >= 7;
  return { startDate: startOverride ?? plan.startDate, dailyTargetSeconds: plan.dailyTargetMinutes * 60, maxDailySeconds: plan.maxDailyMinutes * 60,
    offDays: plan.offDays, allowOffDays: plan.allowOffDays, targetDate: plan.targetDate, mode: plan.mode, split: plan.splitLongVideos,
    recentDailyActualSeconds: has ? hist.reduce((a, b) => a + b, 0) / hist.length : null };
}

export async function previewPlan(plan: StudyPlan) {
  const { items, order } = await buildItems(plan); const cfg = await planConfig(plan);
  return { result: schedule(items, [], cfg), order, items };
}

export async function createPlan(plan: StudyPlan) {
  const { result } = await previewPlan(plan); const now = Date.now();
  await db.transaction('rw', db.plans, db.tasks, db.audit, async () => {
    // keep history: previous active plans are paused, never deleted
    for (const p of await db.plans.where('status').equals('active').toArray()) await db.plans.update(p.id, { status: 'paused', updatedAt: now });
    await db.plans.put({ ...plan, status: 'active', createdAt: now, updatedAt: now });
    await db.tasks.bulkAdd(result.placements.map((p, i) => taskFromPlacement(plan.id, p, i, now)));
    await audit('plan', plan.id, 'create', null, { tasks: result.placements.length, finish: result.finishDate });
  });
  return result;
}
function taskFromPlacement(planId: string, p: { key: string; kind: 'video' | 'revision'; date: string; seconds: number; part: number; parts: number; overrunSeconds: number }, i: number, now: number): ScheduledTask {
  return { id: uid('t_'), planId, taskType: p.kind, videoId: p.kind === 'video' ? p.key : null, revisionEventId: p.kind === 'revision' ? p.key : null, mcqLabel: null,
    scheduledDate: p.date, plannedSeconds: p.seconds, partIndex: p.part, partCount: p.parts, status: 'pending', pinned: false, manual: false, orderIndex: i,
    overrunSeconds: p.overrunSeconds, createdAt: now, updatedAt: now };
}

/** Recovery preview: re-place all unpinned, non-manual pending tasks from today; pinned/manual stay put and consume capacity. */
export async function previewReschedule(planId: string): Promise<{ diff: RescheduleDiff; placements: ReturnType<typeof schedule>['placements']; overdue: number } | null> {
  const plan = await db.plans.get(planId); if (!plan) return null;
  const t0 = today();
  const pending = (await db.tasks.where('planId').equals(planId).toArray()).filter(t => t.status === 'pending');
  const fixed = pending.filter(t => t.pinned || t.manual);
  const movable = pending.filter(t => !t.pinned && !t.manual);
  const { items } = await buildItems({ ...plan, startDate: t0 });
  const fixedKeys = new Set(fixed.map(t => t.videoId ?? t.revisionEventId));
  const its = items.filter(i => !fixedKeys.has(i.key));
  const cfg = await planConfig(plan, t0);
  const res = schedule(its, fixed.filter(t => t.scheduledDate >= t0).map(t => ({ date: t.scheduledDate, seconds: t.plannedSeconds })), cfg);
  const diff = diffSchedules(movable.map(t => ({ key: (t.videoId ?? t.revisionEventId)!, date: t.scheduledDate, part: t.partIndex })), res);
  return { diff, placements: res.placements, overdue: pending.filter(t => t.scheduledDate < t0).length };
}
export async function applyReschedule(planId: string) {
  const pr = await previewReschedule(planId); if (!pr) return;
  const now = Date.now();
  await db.transaction('rw', db.tasks, db.audit, async () => {
    const pending = (await db.tasks.where('planId').equals(planId).toArray()).filter(t => t.status === 'pending' && !t.pinned && !t.manual);
    // old movable tasks are marked 'removed' (kept for history), replaced by new placements
    for (const t of pending) await db.tasks.update(t.id, { status: 'removed', updatedAt: now });
    await db.tasks.bulkAdd(pr.placements.map((p, i) => taskFromPlacement(planId, p, 10000 + i, now)));
    await audit('plan', planId, 'reschedule', { moved: pr.diff.moved.length }, { finish: pr.diff.newFinish });
  });
}
export async function moveTask(taskId: string, date: string) {
  const t = await db.tasks.get(taskId); if (!t) return;
  await db.tasks.update(taskId, { scheduledDate: date, manual: true, updatedAt: Date.now() });
  await audit('task', taskId, 'move', t.scheduledDate, date);
}
export async function setTaskStatus(taskId: string, status: ScheduledTask['status']) {
  const t = await db.tasks.get(taskId); if (!t) return;
  await db.tasks.update(taskId, { status, updatedAt: Date.now() });
  await audit('task', taskId, 'status', t.status, status);
  if (t.videoId && t.partIndex === t.partCount) {
    if (status === 'done') await setVideoStatus(t.videoId, 'completed');
    if (status === 'skipped') await setVideoStatus(t.videoId, 'skipped');
    if (status === 'pending') await setVideoStatus(t.videoId, 'not_started');
  }
  if (t.revisionEventId && status === 'done') await db.revisionEvents.update(t.revisionEventId, { status: 'done', completedAt: Date.now() });
}

export async function getActivePlan() { return (await db.plans.where('status').equals('active').toArray())[0] ?? null; }

export async function wipeAllData() {
  await db.transaction('rw', db.tables, async () => { for (const t of db.tables) await t.clear(); });
}
