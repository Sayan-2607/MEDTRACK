import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Subject, type Video, type VideoProgress, type Speed } from '../db/schema';
import { workload, effectiveSpeed, estimatedSeconds } from '../domain/calc';

export interface Catalog { subjects: Subject[]; subjectMap: Map<string, Subject>; videos: Video[]; progress: Map<string, VideoProgress>; }
export function useCatalog(): Catalog | undefined {
  return useLiveQuery(async () => {
    const [subjects, videos, progress] = await Promise.all([db.subjects.orderBy('sortOrder').toArray(), db.videos.toArray(), db.progress.toArray()]);
    return { subjects, subjectMap: new Map(subjects.map(s => [s.id, s])), videos, progress: new Map(progress.map(p => [p.videoId, p])) };
  }, []);
}
export function subjectWorkload(c: Catalog, subjectId: string | null, globalSpeed: Speed, module?: string) {
  return workload(c.videos.filter(v => (!subjectId || v.subjectId === subjectId) && (!module || v.moduleType === module)), c.progress, c.subjectMap, globalSpeed);
}
export function videoEstimate(c: Catalog, v: Video, g: Speed) {
  const sp = effectiveSpeed(c.progress.get(v.id), c.subjectMap.get(v.subjectId), g);
  return { speed: sp, seconds: estimatedSeconds(v.originalDurationSeconds, sp) };
}
export const STATUS_LABEL: Record<string, string> = { not_started: 'Not started', in_progress: 'In progress', completed: 'Completed', skipped: 'Skipped', revisit: 'Revisit required' };
